import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { elementAPI } from '../services/elementAPI';

// crypto.randomUUID() exige un "secure context" (HTTPS o localhost) segun el
// estandar Web Crypto API -- en cualquier otro origen (p.ej. http://<IP> como
// el entorno de desarrollo en ia-lavatur via Tailscale, sin TLS) NO EXISTE
// (queda undefined) y llamarla lanza una excepcion silenciosa dentro del
// updater de Zustand/Immer, abortando el cambio de estado sin ningun error
// visible en la UI. Bug real encontrado verificando Fase B en un navegador
// real contra ese entorno (ver RECETA-DESARROLLO.md). Este id es solo un
// identificador LOCAL temporal (nunca se envia al backend, que siempre
// re-crea los elementos), asi que no necesita ser criptograficamente fuerte:
// basta con que sea unico dentro de esta sesion de edicion.
function genTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Store del editor de UNA PÁGINA a la vez.
 *
 * REGLA DE ORO (ver docs/arquitectura-editor-2026-09-12.md, sección 1 y 4):
 * el editor anterior compartía un único objeto mutable (`window.editorConfig`)
 * entre TODAS las páginas de la publicación, incluida la orientación. Al
 * navegar de página se reasignaba/mutaba ese mismo objeto en el lugar, lo que
 * causaba que el contenido de una página "se filtrara" a otra (incluida la
 * portada hacia la contraportada) y que la orientación cambiara sola.
 *
 * Este store evita esa clase de bug estructuralmente:
 *   1. Nunca conserva estado de una página al cargar otra: `loadPage()`
 *      REEMPLAZA todo el estado, nunca lo mezcla con el anterior.
 *   2. Usa un `loadToken` para descartar respuestas de red que lleguen
 *      tarde después de que el usuario ya navegó a otra página (evita que
 *      una respuesta "vieja" sobrescriba el estado de la página nueva).
 *   3. `pageId` vive en el propio store: cualquier componente puede verificar
 *      que sigue editando la página que cree estar editando.
 *   4. El `version` que se manda al guardar es siempre el que devolvió el
 *      último GET/PUT de ESTA página -- nunca un valor cacheado de otra.
 *
 * VISTA DE HOJA DOBLE (spread, añadido en esta ronda -- ver
 * docs/arquitectura-editor-2026-09-12.md sección 6): Carlos pidió que, en
 * páginas interiores, el editor muestre DOS páginas lado a lado, AMBAS
 * editables simultáneamente (como InDesign), nunca solo una "activa". Un
 * único store global ya no alcanza para eso -- por eso este archivo exporta
 * una FÁBRICA (`createPageEditorStore()`) en vez de un store singleton: el
 * componente crea DOS instancias independientes (una por lado del spread),
 * cada una con su propio pageId/version/elements/loadToken, exactamente la
 * misma lógica de aislamiento de arriba pero replicada por instancia -- así
 * es estructuralmente imposible que el contenido de la página izquierda se
 * filtre a la derecha (o a la portada/contraportada) al navegar, igual que
 * ya era imposible que se filtrara entre páginas con el store singleton.
 */
export function createPageEditorStore() {
  return create(
    immer((set, get) => ({
      // --- Estado ---
      pageId: null,
      version: null,
      elements: [], // [{ id (temporal o real), kind, x, y, width, height, rotation_deg, z_index, props }]
      selectedElementIds: [], // seleccion multiple -- array de ids (vacio = nada seleccionado)
      isLoading: false,
      isSaving: false,
      isDirty: false,
      loadError: null,
      saveError: null, // { status, detail } -- status 409 = conflicto de version
      loadToken: 0,

      // --- Carga ---
      loadPage: async (pageId) => {
        const myToken = get().loadToken + 1;

        // Reemplazo TOTAL del estado ANTES de que llegue la respuesta de red:
        // así, si el componente sigue montado con la página vieja durante el
        // fetch, ya no puede seguir mostrando/editando elementos de otra página.
        set((state) => {
          state.loadToken = myToken;
          state.pageId = pageId;
          state.version = null;
          state.elements = [];
          state.selectedElementIds = [];
          state.isLoading = true;
          state.isDirty = false;
          state.loadError = null;
          state.saveError = null;
        });

        try {
          const data = await elementAPI.get(pageId);

          // Si mientras esperábamos la respuesta el usuario ya navegó a otra
          // página (loadToken avanzó), esta respuesta está obsoleta: descartar.
          if (get().loadToken !== myToken) return;

          set((state) => {
            state.version = data.version;
            state.elements = data.elements.map((el) => ({ ...el }));
            state.isLoading = false;
          });
        } catch (err) {
          if (get().loadToken !== myToken) return;
          set((state) => {
            state.isLoading = false;
            state.loadError = err?.response?.data?.detail || 'No se pudo cargar la página';
          });
        }
      },

      // --- Edición local (no persiste hasta llamar a save()) ---
      addElement: (kind, partial = {}) => {
        set((state) => {
          const maxZ = state.elements.reduce((m, e) => Math.max(m, e.z_index ?? 0), -1);
          state.elements.push({
            // id temporal, solo para el 'key' de React y selección local -- el
            // backend siempre re-crea los elementos al guardar (ver
            // PageElementCreate: sin id), así que este valor nunca se envía.
            id: `tmp-${genTempId()}`,
            kind,
            x: 50,
            y: 50,
            width: kind === 'text' ? 200 : 150,
            height: kind === 'text' ? 40 : 150,
            rotation_deg: 0,
            z_index: maxZ + 1,
            props: {},
            ...partial,
          });
          state.isDirty = true;
        });
      },

      updateElement: (id, patch) => {
        set((state) => {
          const el = state.elements.find((e) => e.id === id);
          if (el) {
            Object.assign(el, patch);
            state.isDirty = true;
          }
        });
      },

      removeElement: (id) => {
        set((state) => {
          state.elements = state.elements.filter((e) => e.id !== id);
          state.selectedElementIds = state.selectedElementIds.filter((sid) => sid !== id);
          state.isDirty = true;
        });
      },

      // Orden de capas (Lote UX-5, 13-sep-2026) -- pedido explicito de
      // Carlos: aceptó la version simple (traer al frente / enviar al
      // fondo, mas subir/bajar un nivel) en vez de un panel de capas
      // completo estilo Photoshop, por menor costo de implementacion.
      // Reutiliza el campo z_index que ya existia desde la Fase A (nunca
      // antes expuesto en la UI) -- sin migracion, sin cambios de schema.
      // 'front'/'back' saltan al extremo (maxZ+1 / minZ-1); 'up'/'down'
      // intercambian z_index con el vecino inmediato en el orden actual
      // (nunca simplemente +1/-1, que podria chocar con un z_index ya
      // usado por otro elemento y dejar el orden ambiguo).
      reorderElement: (id, direction) => {
        set((state) => {
          const el = state.elements.find((e) => e.id === id);
          if (!el) return;
          if (direction === 'front' || direction === 'back') {
            const zs = state.elements.map((e) => e.z_index ?? 0);
            const target = direction === 'front' ? Math.max(...zs) : Math.min(...zs);
            if (el.z_index === target) return; // ya esta en el extremo, nada que hacer
            el.z_index = direction === 'front' ? target + 1 : target - 1;
            state.isDirty = true;
            return;
          }
          const sorted = [...state.elements].sort((a, b) => (a.z_index ?? 0) - (b.z_index ?? 0));
          const idx = sorted.findIndex((e) => e.id === id);
          const neighborIdx = direction === 'up' ? idx + 1 : idx - 1;
          if (neighborIdx < 0 || neighborIdx >= sorted.length) return; // ya esta en ese extremo
          const neighbor = sorted[neighborIdx];
          const tmp = el.z_index;
          el.z_index = neighbor.z_index;
          neighbor.z_index = tmp;
          state.isDirty = true;
        });
      },

      // Elimina TODOS los elementos actualmente seleccionados (boton "Eliminar
      // seleccionado" / tecla Delete con seleccion multiple).
      removeSelectedElements: () => {
        set((state) => {
          if (state.selectedElementIds.length === 0) return;
          const toRemove = new Set(state.selectedElementIds);
          state.elements = state.elements.filter((e) => !toRemove.has(e.id));
          state.selectedElementIds = [];
          state.isDirty = true;
        });
      },

      // id === null limpia la seleccion. options.additive (shift+click) agrega/
      // quita ese id de la seleccion actual en vez de reemplazarla.
      selectElement: (id, options = {}) => {
        set((state) => {
          if (id === null) {
            state.selectedElementIds = [];
            return;
          }
          if (options.additive) {
            const idx = state.selectedElementIds.indexOf(id);
            if (idx >= 0) state.selectedElementIds.splice(idx, 1);
            else state.selectedElementIds.push(id);
          } else {
            state.selectedElementIds = [id];
          }
        });
      },

      // Reemplaza la seleccion completa por este conjunto de ids (usado por el
      // rectangulo de seleccion / marquee-select).
      selectElements: (ids) => {
        set((state) => {
          state.selectedElementIds = [...ids];
        });
      },

      // Aplica un patch DISTINTO a cada elemento en un solo set() -- usado por
      // Alinear/Distribuir, que calcula una x/y nueva por elemento seleccionado.
      updateElements: (patchesById) => {
        set((state) => {
          let changed = false;
          for (const el of state.elements) {
            const patch = patchesById[el.id];
            if (patch) {
              Object.assign(el, patch);
              changed = true;
            }
          }
          if (changed) state.isDirty = true;
        });
      },

      // --- Guardado explícito ---
      save: async () => {
        const { pageId, version, elements } = get();
        if (!pageId || version === null) return { ok: false };

        set((state) => {
          state.isSaving = true;
          state.saveError = null;
        });

        // El backend re-crea todos los elementos (sin id de cliente): se manda
        // solo la forma que espera PageElementCreate.
        const payload = elements.map(({ kind, x, y, width, height, rotation_deg, z_index, props }) => ({
          kind,
          x,
          y,
          width,
          height,
          rotation_deg,
          z_index,
          props,
        }));

        try {
          const data = await elementAPI.save(pageId, version, payload);

          // Si el usuario ya navegó a otra página mientras se guardaba, no
          // pisar el estado de esa página nueva con la respuesta de esta.
          if (get().pageId !== pageId) return { ok: true };

          set((state) => {
            state.version = data.version;
            state.elements = data.elements.map((el) => ({ ...el }));
            state.isSaving = false;
            state.isDirty = false;
          });
          return { ok: true };
        } catch (err) {
          if (get().pageId !== pageId) return { ok: false };

          const status = err?.response?.status;
          set((state) => {
            state.isSaving = false;
            state.saveError = {
              status,
              detail:
                status === 409
                  ? 'Otra persona guardó esta página mientras editabas. Recarga para ver los cambios antes de volver a guardar.'
                  : err?.response?.data?.detail || 'No se pudo guardar la página',
            };
          });
          return { ok: false, status };
        }
      },

      // --- Limpieza al salir del editor / al no tener página asignada ---
      reset: () => {
        set((state) => {
          state.loadToken += 1; // invalida cualquier fetch en vuelo
          state.pageId = null;
          state.version = null;
          state.elements = [];
          state.selectedElementIds = [];
          state.isLoading = false;
          state.isSaving = false;
          state.isDirty = false;
          state.loadError = null;
          state.saveError = null;
        });
      },
    }))
  );
}

// Alias de compatibilidad: por si algún código externo a este repo (o algún
// import futuro) sigue esperando un store singleton exportado directamente.
// Nada dentro de este repo lo usa ya -- CanvasEditorV2.jsx pasó a crear sus
// propias instancias vía createPageEditorStore() -- pero se conserva para no
// romper nada que no se haya podido revisar en esta ronda.
export const usePageEditorStore = createPageEditorStore();
