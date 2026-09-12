import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { elementAPI } from '../services/elementAPI';

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
 */
export const usePageEditorStore = create(
  immer((set, get) => ({
    // --- Estado ---
    pageId: null,
    version: null,
    elements: [], // [{ id (temporal o real), kind, x, y, width, height, rotation_deg, z_index, props }]
    selectedElementId: null,
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
        state.selectedElementId = null;
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
          id: `tmp-${crypto.randomUUID()}`,
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
        if (state.selectedElementId === id) state.selectedElementId = null;
        state.isDirty = true;
      });
    },

    selectElement: (id) => {
      set((state) => {
        state.selectedElementId = id;
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

    // --- Limpieza al salir del editor ---
    reset: () => {
      set((state) => {
        state.loadToken += 1; // invalida cualquier fetch en vuelo
        state.pageId = null;
        state.version = null;
        state.elements = [];
        state.selectedElementId = null;
        state.isLoading = false;
        state.isSaving = false;
        state.isDirty = false;
        state.loadError = null;
        state.saveError = null;
      });
    },
  }))
);
