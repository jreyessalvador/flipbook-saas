# RECETA DE DESARROLLO — flipbook-saas (leer ANTES de tocar código)

Este archivo existe para que Claude, Codex o Antigravity puedan retomar este
proyecto en cualquier momento SIN depender de esta conversación ni de que
Carlos re-explique nada. Léelo completo antes de escribir una sola línea.

## 0. Regla de oro

**No re-inventes el diseño.** El editor anterior se abandonó por bugs
arquitectónicos reales (ver `docs/arquitectura-editor-2026-09-12.md`, sección
1). Cualquier cambio de diseño debe justificarse contra esa causa raíz, no
contra gusto personal. Si algo en este documento parece contradecir el código
real, el código real manda y hay que actualizar este documento -- nunca al
revés en silencio.

## 1. Dónde está todo

- **Código**: `github.com/jreyessalvador/flipbook-saas`, working copy en
  `raspi-2` (`/home/administracion/flipbook-saas`), rama activa de este
  rediseño: **`redesign/editor-v2`** (creada desde `desarrollo` el
  12-sep-2026 -- `desarrollo` conserva el editor viejo intacto por si hace
  falta comparar, NUNCA hacer merge de `redesign/editor-v2` de vuelta sin
  que Carlos lo revise).
- **Documento de arquitectura completo**: `docs/arquitectura-editor-2026-09-12.md`
  en este mismo repo (fuente de verdad técnica detallada).
- **Memoria compartida entre agentes**: `agents-memory` repo
  (`~/projects/agents-memory` en Contabo 2, conector `ssh-vps-codex`) --
  `projects/flipbook-saas/context.md` tiene el historial de decisiones con
  fechas; `projects/ia-lavatur/context.md` tiene los guardarraíles del
  entorno de desarrollo; `projects/contabo-2/context.md` tiene el plan del
  worker de imagen/video. **Siempre `git pull` en agents-memory antes de
  asumir que sabes el estado actual** -- puede haber cambiado desde la
  última vez que leíste esto.
- **Entorno de desarrollo con UI** (cuando exista, Fase B en adelante):
  `ia-lavatur` (`srv01-ai-romeral-spain`, conector `ssh-server-ai-lan`),
  carpeta autocontenida `/home/administracion/dev/flipbook-saas/` (Docker
  Compose plano, NUNCA Kubernetes/kubectl para esto -- ver sección 4).

## 2. Estado real a fecha 12-sep-2026 (Fase A completada)

Backend FastAPI existente (`backend/app/`) extendido con:
- Modelos nuevos: `PageElement`, `EditLock`, `Asset`, `PublicationVersion`
  (`backend/app/models/`).
- `Page` ganó columna `version` (concurrencia optimista); `Page.content`
  (el JSON blob viejo) queda DEPRECADO, no se borra pero no se usa desde el
  editor nuevo.
- `Publication` ganó `page_turn_sound_asset_id` y `published_version_id`.
- `PublicationUpdate` (schema) ya NO acepta cambiar orientation/page_width/
  page_height/total_pages -- deliberado, ver docstring en el archivo.
- Endpoints nuevos: `backend/app/api/locks.py` (bloqueo), y en
  `backend/app/api/pages.py`/`publications.py` los endpoints de
  elementos/publish/versions (buscar el comentario "Editor v2" en esos
  archivos para ubicar exactamente qué se agregó vs qué ya existía).
- Migración SQL: `backend/migrations/0001_editor_v2.sql` -- para BD fresca
  se usó `python -m app.db.init_db` (equivalente, crea las 8 tablas vía
  `Base.metadata.create_all()`); para una BD de producción existente con
  datos, usar el script `.sql` directamente.

**Fase A CERRADA de verdad el 12-sep-2026** (no solo "el código compila" --
verificado contra un stack real):
1. ✅ Stack completo (Postgres 15 + Redis + MinIO + FastAPI) levantado con
   Docker Compose en `ia-lavatur` (`/home/administracion/dev/flipbook-saas/`),
   `python -m app.db.init_db` ejecutado contra esa Postgres real -- las 8
   tablas (`assets`, `edit_locks`, `page_elements`, `pages`,
   `publication_versions`, `publications`, `tenants`, `users`) más tenant y
   admin por defecto se crearon sin errores.
2. ✅ Prueba end-to-end real con `curl` reproduciendo EXACTAMENTE el bug
   original de Carlos: publicación de 4 páginas (portrait) → lock → guardar
   2 elementos (imagen+texto) en la portada (version 1→2) → **contraportada
   con 0 elementos (sin fuga)** → portada conserva sus 2 elementos al
   releer → guardar con version vieja devuelve 409 sin sobreescribir →
   `orientation` se mantiene "portrait" en todo momento → publish crea
   `PublicationVersion` → listar versions muestra `is_current: true` →
   unlock (204) → re-lock (200). **TODOS los checks pasaron.**
3. ✅ Checklist de la sección 10 automatizada como script de smoke test:
   `backend/tests/test_editor_v2_regression.sh` (bash + curl, ejecutable,
   con asserts y mensajes de fallo explícitos si el bug reapareciera).
   Pendiente (no bloqueante): convertirlo a pytest real más adelante.

Hallazgo de infraestructura de paso: `minio/minio` ya NO se puede jalar de
Docker Hub ("pull access denied", repo retirado) -- hay que usar
`quay.io/minio/minio` en cualquier compose que use MinIO (afecta también a
otros proyectos, no solo este; no propagado aún a otros repos).

## 3. Cómo verificar que el código compila sin desplegar nada

No hace falta Docker para un chequeo rápido de sintaxis/imports:

```bash
cd /home/administracion/flipbook-saas/backend
python3 -m venv /tmp/venvcheck
/tmp/venvcheck/bin/pip install fastapi sqlalchemy pydantic pydantic-settings \
  python-jose[cryptography] passlib[bcrypt] python-multipart minio \
  psycopg2-binary redis email-validator
DATABASE_URL="postgresql://flipbook:x@localhost:5432/flipbook" \
  /tmp/venvcheck/bin/python -c "from app.main import app; print('OK', len(app.routes))"
rm -rf /tmp/venvcheck
```

Esto NO conecta a una BD real (create_engine es perezoso) -- solo confirma
que todo importa y las rutas se registran. Para probar de verdad hace falta
Postgres/Redis/MinIO corriendo (docker-compose.dev.yml del propio repo).

## 4. Reglas de infraestructura (NO NEGOCIABLES, ya acordadas con Carlos)

- **Contabo 1**: solo para producción futura, sigue en pausa (Fase 0).
- **Contabo 2**: reservado para el futuro worker de imagen/video, CON
  aislamiento estricto (usuario dedicado, contenedor sin privilegios, red
  propia, túnel WireGuard `wg-flipbook` propio). No implementado aún.
- **ia-lavatur**: EXCEPCIÓN acotada y fechada (12-sep-2026) para desarrollo/
  pruebas visuales SOLAMENTE. Reglas estrictas:
  - Nada de `kubectl` ni namespaces nuevos en el cluster de Lavatur.
  - Docker Compose plano (`/usr/bin/docker`, ya instalado, independiente
    del cluster) en una carpeta autocontenida y PORTABLE (código +
    docker-compose.yml + .env + datos como bind-mounts dentro de la misma
    carpeta -- mover a otro servidor = copiar la carpeta + `docker compose
    up -d`, sin buscar/reemplazar rutas).
  - Sin exposición pública ni túnel Cloudflare. Acceso de Carlos SOLO vía
    Tailscale (`http://100.71.185.7:<puerto>`, puerto a definir en Fase B).
  - Marcado como DEV/TEST -- nunca datos reales de tenants, nunca se
    convierte en el servidor de producción del SaaS por inercia.
  - **Resuelto (12-sep-2026)**: Carlos aplicó `sudo usermod -aG docker
    administracion` en ia-lavatur -- confirmado con `id` (grupo `docker`
    gid 995 presente) y `docker ps` funcionando sin sudo. Entorno de
    desarrollo ya levantado y verificado en
    `/home/administracion/dev/flipbook-saas/` (clon de `redesign/editor-v2`,
    `.env` propio, `docker-compose.dev.yml` portable con bind-mounts en
    `./data/`).
  - Cualquier otro uso de ia-lavatur fuera de esto sigue PROHIBIDO por la
    regla general del 25-ago-2026 (ver `projects/ia-lavatur/context.md`).

## 5. Uso de LLMs locales para ahorrar tokens de Claude/Codex

ia-lavatur tiene modelos Ollama locales (namespace `ai-platform-v2`,
servicio ClusterIP `ollama-server-v2:11434`, catálogo incluye
`qwen2.5-coder:14b` -- recomendado para código -- y `deepseek-v2:16b`).
Patrón ya usado con éxito en Fase A (ver commit de esta rama): abrir un
`kubectl port-forward` de solo lectura, temporal, matar el proceso apenas
se obtiene la respuesta -- NO modifica el cluster, es el mismo nivel de
intrusión que un `kubectl get`:

```bash
kubectl port-forward -n ai-platform-v2 svc/ollama-server-v2 18434:11434 &
PF_PID=$!
sleep 3
curl -s http://127.0.0.1:18434/api/generate -d '{
  "model": "qwen2.5-coder:14b",
  "stream": false,
  "prompt": "..."
}' | python3 -c "import json,sys; print(json.load(sys.stdin)['response'])"
kill $PF_PID
```

Úsalo para boilerplate mecánico (schemas Pydantic, migraciones repetitivas,
tests parametrizados) -- SIEMPRE revisar/compilar el resultado antes de
commitear, el modelo local no sustituye la verificación (`py_compile`,
import real, sección 3).

## 6. Convenciones de código a respetar (ya existentes en el repo, no romperlas)

- Backend síncrono (SQLAlchemy `create_engine`/`sessionmaker`, no async
  pese a que `asyncpg` esté en requirements.txt sin usarse).
- Cada endpoint filtra explícitamente por `current_user.tenant_id` --
  aislamiento multi-tenant a nivel de query, no de schema de BD. Cualquier
  endpoint nuevo debe seguir este mismo patrón.
- UUIDs como PK en todas las tablas (`sqlalchemy.dialects.postgresql.UUID`).
- Comentarios en español explicando el POR QUÉ de una decisión, no solo el
  QUÉ (ver ejemplo real ya en el repo: el comentario de `assets.ensure_bucket`
  sobre el crash loop de MinIO). Sigue ese estilo en código nuevo.

## 7. Fase B -- CERRADA de verdad (12-sep-2026)

Editor canvas mínimo implementado y verificado contra navegador real (no
solo backend): React + `react-konva` (pinned `18.2.16` -- la versión
reciente exige React 19), store Zustand + Immer **por página** (nunca un
objeto global mutable compartido entre páginas -- ver sección 1), tipos
`image`/`text`/`shape`, guardado explícito con manejo de 409, lock de
edición con heartbeat cada 20s.

Verificación real (Playwright dentro de un contenedor Docker oficial
corriendo directo en `ia-lavatur`, `--network host` -- el navegador
embebido de Claude no es viable contra IPs Tailscale por su modelo de
permisos por-acción):
`frontend/tests/e2e_editor_v2_regression.js` reproduce el bug original
(editar portada → guardar → navegar a contraportada → volver) contra un
Chromium real. **Pasa sin fugas de contenido ni errores de consola.**

4 bugs reales encontrados y corregidos durante esta verificación (ninguno
hubiera aparecido con solo revisión de código o `curl`):
1. **Condición de carrera en adquisición de lock**: React 18 StrictMode
   invoca los efectos dos veces en dev, lo que disparaba
   `IntegrityError: duplicate key` en `edit_locks`. Corregido reemplazando
   SELECT+INSERT/UPDATE por un UPSERT atómico de Postgres
   (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`) en
   `backend/app/api/locks.py`.
2. **`crypto.randomUUID()` no existe fuera de un secure context**: el
   entorno de dev sirve por HTTP sobre una IP Tailscale (no HTTPS ni
   localhost), así que `crypto.randomUUID` es `undefined` y
   `addElement()` fallaba en silencio. Corregido con un generador de ID
   temporal con fallback en `pageEditorStore.js`.
3. Warning de React por pasar `key` dentro de un objeto esparcido en vez
   de como prop directa de JSX -- inofensivo pero corregido.
4. URLs de assets y orígenes CORS hardcodeados a un host de producción --
   corregido a rutas relativas / variable de entorno
   (`CORS_ORIGINS`), ver `backend/app/config.py` y `backend/app/api/assets.py`.

**Además, en esta misma ronda**: se reestructuró la UI del editor con un
shell de dos paneles inspirado en Photoshop/Joomag (sin copiarlos) --
rail de herramientas por iconos a la izquierda (Seleccionar, Hotspot,
Texto, Línea, Rectángulo, Círculo, Estrella, Imagen/Galería/GIF/Collage/
YouTube/Vimeo/Audio/SoundCloud, Plugins, Library, Blocks) y panel de
propiedades a la derecha (Alinear/distribuir, X/Y/ancho/alto/rotación,
Apariencia, Quick Actions). En esta ronda inicial solo
Seleccionar/Texto/Rectángulo/Imagen y los campos de Transformar+Apariencia
quedaron funcionales; el resto placeholders "próximamente" -- ver sección
9 para el trabajo posterior que ya los activó.

## 8. Decisiones explícitas de Carlos (no revisitar sin que él lo pida)

- **Ritmo de entrega**: "por lotes, verificando cada uno" -- cada lote se
  implementa, se verifica de verdad contra el stack real (Playwright, no
  solo lectura de código) y se commitea/pushea ANTES de pasar al
  siguiente, sin pausar a pedir confirmación entre lotes salvo que algo
  requiera de verdad su validación.
- **Alcance de Plugins/shortcodes: SOLO shortcodes de texto seguros.**
  Únicamente variables de texto plano predefinidas (`{{fecha}}`,
  `{{numero_pagina}}`, etc.) resueltas en el momento de renderizar --
  **NUNCA HTML/JS/iframes arbitrarios.** Motivo: riesgo real de XSS si el
  producto llega a tener contenido self-service multi-tenant. Cualquier
  ampliación de este alcance (por ejemplo permitir HTML) requiere que
  Carlos lo reabra explícitamente.

## 9. Lotes de funcionalidad completados sobre el shell de UI (12-sep-2026)

Tras el shell-only inicial (sección 7), Carlos pidió continuar hasta dejar
todo funcional. Se avanza por lotes (ver sección 8):

**Lote 1 -- Selección múltiple, Alinear/Distribuir, formas Línea/Círculo/
Estrella.** `selectedElementIds` (array) reemplaza el `selectedElementId`
único en `pageEditorStore.js`; shift+click (aditivo) y marquee-select
(arrastre sobre el fondo del canvas, axis-aligned, no considera rotación)
como mecanismos de selección múltiple. 8 operaciones de alinear/distribuir
(`computeAlignPatches`) operan en "unidades de página" (nunca píxeles de
pantalla), independientes del zoom. Nuevas formas Línea/Círculo/Estrella
reutilizan el `kind: 'shape'` existente vía `props.shape_type`. **Bug real
evitado proactivamente** (no por fallo de test sino por razonamiento sobre
el código antes de que se enviara): `Ellipse`/`Star` de Konva usan
coordenadas de CENTRO, no de esquina superior-izquierda como el resto del
modelo de datos -- se creó `handleTransformEndCentered()` dedicado para
evitar que la figura "saltara" de posición al redimensionar/rotar.
Verificado con dos scripts Playwright reales contra `ia-lavatur`:
`frontend/tests/verify_lote1.js` (vía `window.__pageEditorStore`) y
`frontend/tests/verify_lote1_visual.js` (arrastre de mouse real,
capturas de pantalla incluidas). Ambos pasan.

**Lote 2 -- Shortcodes de texto (Plugins).** Catálogo fijo `SHORTCODES`
(`{{fecha}}`, `{{numero_pagina}}`, `{{total_paginas}}`,
`{{titulo_publicacion}}`) resuelto por `resolveShortcodes()` -- ver
decisión de alcance en sección 8. La plantilla sin resolver se guarda
siempre en `props.text` (re-editar el texto muestra `{{fecha}}`, no la
fecha de hoy); solo la vista previa en el canvas (Konva `<Text>`) muestra
el valor ya resuelto, calculado en cada render a partir de
`shortcodeCtx` (página activa, total de páginas, título de la
publicación -- estos tres viven en estado de React del componente, NO en
el store Zustand). El botón "Plugins" del rail abre un popover con la
lista de shortcodes: si hay un único texto seleccionado, el shortcode se
AGREGA a su plantilla; si no, crea un elemento de texto nuevo. Un
shortcode no reconocido se deja intacto (nunca rompe el render). Verificado
con `frontend/tests/verify_lote2_shortcodes.js` (inserción, concatenación,
creación sin selección, shortcode desconocido, persistencia tras
guardar+recargar) y confirmado visualmente por captura de pantalla que el
canvas muestra el valor resuelto ("Texto 12/9/2026 2"), nunca las llaves
literales. `e2e_editor_v2_regression.js` y `verify_lote1.js` re-ejecutados
sin regresiones.

**Lote 3 -- elemento de audio.** Backend: `POST /api/assets/upload` acepta
ahora también `audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/x-wav`,
`audio/ogg`, `audio/webm` (antes solo imagen), validando el tamaño contra
`MAX_AUDIO_SIZE` (20MB, ya existía en `config.py` sin usarse) en vez del
límite de imagen (10MB). Frontend: el botón "Audio" del rail deja de ser
placeholder -- sube el archivo y crea un elemento `kind='audio'` con
`props.src/autoplay/loop`. En el canvas se representa con un icono fijo
(`AudioElement`: `Group` con `Rect` + `Path` del icono de altavoz +
etiqueta) -- Konva no reproduce audio, así que es arrastrable/
seleccionable/transformable como cualquier otro elemento pero no suena en
el canvas mismo. El panel de propiedades gana una sección "Audio" con un
`<audio controls>` nativo (vista previa de escucha para validar el
archivo, no el Reader final) y checkboxes de autoplay/loop.

**Bug real (pre-existente, no introducido en este lote) encontrado y
corregido durante la verificación**: en `upload_asset()`
(`backend/app/api/assets.py`) un `except Exception` genérico atrapaba
también las `HTTPException(400, ...)` ya deliberadas (tipo de archivo no
permitido / archivo demasiado grande), reenvolviéndolas como 500 y
ocultando el código de estado correcto al frontend. Corregido con un
`except HTTPException: raise` antes del except genérico.

**Incidente de infraestructura en ia-lavatur durante este lote (para que
no se repita)**: `docker-compose.dev.yml`, tal como está en este repo, NO
refleja la configuración real con la que se levantó el stack de
ia-lavatur (nombres de contenedor `flipbook-dev-*`, puertos/binds
definidos en `.env`, ver sección 4) -- es un archivo genérico más viejo
que quedó desincronizado (probablemente por un `git reset --hard` de una
ronda anterior, ver agents-memory ronda 8). Ejecutar
`docker compose -f docker-compose.dev.yml up` contra este archivo
RECREA los contenedores con OTRO nombre/config y puede *borrar* el
contenedor real en uso (pasó con `flipbook-dev-backend` durante este
lote). **Regla para el futuro: en ia-lavatur, para reiniciar/actualizar
un contenedor de este stack, usar `docker restart <nombre-real>` o
`docker cp` + `docker restart` sobre el contenedor `flipbook-dev-*` que
ya existe -- nunca `docker compose up` contra `docker-compose.dev.yml` sin
antes verificar con `docker inspect <contenedor> --format '{{json .Mounts}}'`
que su configuración coincide con el archivo.** Recuperado sin pérdida de
datos (los volúmenes con los datos reales viven en `./data/` en el host,
no en volúmenes nombrados de Docker) reconstruyendo el contenedor a mano
con `docker run` replicando la config real inspeccionada de los demás
contenedores del stack.

**Cerrado**: `docker-compose.dev.yml` fue reescrito para coincidir
exactamente con la configuración real (nombres `flipbook-dev-*`, binds a
`./data/`, todo valor específico del entorno vía `.env` -- ver el nuevo
`.env.example`) y validado con `docker compose -f docker-compose.dev.yml
config` (solo renderiza la config fusionada, no toca contenedores) --
coincide campo por campo con lo que `docker inspect` reporta de los
contenedores reales. **Sigue siendo cierto que no se debe correr
`docker compose up`/`--force-recreate` contra un stack ya en marcha sin
verificar antes con `docker inspect` que nada se desincronizó de nuevo**;
la diferencia es que ahora, si hiciera falta recrear algo desde cero, este
archivo SÍ reproduce el stack real.

**Lote 4 -- Galería, Collage y GIF.** Backend: nuevo
`PageElementKind.gallery`, compartido por Galería y Collage (solo difieren
en `props.layout`: `'grid'` o `'mosaic'`) -- ver
`backend/app/schemas/page_element.py`. GIF reutiliza `kind='image'`: Konva
no anima GIFs (pinta el primer frame), limitación conocida y documentada,
no bloqueante. Frontend: los tres botones del rail ("Galería", "GIF",
"Collage") dejan de ser placeholders. Galería/Collage suben varios
archivos en secuencia (`uploadFilesSequentially` -- el backend solo acepta
un archivo por llamada; si alguno falla a mitad de camino se avisa pero se
conservan los que sí subieron) y crean UN elemento `kind='gallery'` con
`props.images` (array de `{src}`) y el `layout` correspondiente.
`GalleryElement`/`computeGalleryTiles` calculan el recorte de cada
miniatura dentro del elemento: cuadrícula (`grid`, filas/columnas lo más
cuadradas posible) o mosaico (`mosaic`, una imagen grande a la izquierda +
el resto apilado a la derecha). El panel de propiedades gana una sección
"Galería / Collage" con miniaturas (con botón para quitar cada una),
"Agregar imágenes" (anexa, no reemplaza) y un toggle Cuadrícula/Mosaico
que cambia `props.layout` en caliente (y con él, el encabezado del panel
entre "Galería" y "Collage").

**Bug real (pre-existente, no introducido en este lote) encontrado y
corregido durante la verificación**: la tabla `page_elements` tiene un
`CHECK CONSTRAINT` a nivel de base de datos (`ck_page_elements_kind`) que
enumera los `kind` permitidos -- se había mantenido sincronizado a mano
con el enum de Python, pero nadie lo había vuelto a tocar desde que se creó
la tabla. Al guardar el primer elemento `kind='gallery'` la base real
(creada antes de este lote) lo rechazaba con
`psycopg2.errors.CheckViolation`, un 500 en `PUT
/api/pages/{id}/elements`. Corregido con
`backend/migrations/0002_lote4_gallery_kind.sql` (agrega `'gallery'` al
`CHECK` vía `ALTER TABLE`, para bases de datos ya existentes) y aplicado
también contra la base real de ia-lavatur; `0001_editor_v2.sql` (para
bases nuevas) también se actualizó para incluir `'gallery'` desde el
`CREATE TABLE`.

**Segundo bug real (pre-existente, no introducido en este lote) encontrado
y corregido durante la verificación**: `POST /api/publications/{id}/lock`
podía devolver 500 de forma intermitente, que el navegador reportaba
engañosamente como un bloqueo de CORS (la respuesta nunca llega a tener
los headers de `CORSMiddleware` porque la excepción ocurre después de que
la respuesta ya empezó). Causa real: tras el `UPSERT` atómico que toma el
lock, el código hacía un `SELECT` adicional para reconstruir la respuesta
completa -- si un `DELETE /lock` concurrente (el cleanup de un efecto de
React, o el doble-efecto de StrictMode en desarrollo) borraba la fila
justo entre el `commit()` del `UPSERT` y ese `SELECT`, la consulta
devolvía `None` y `FastAPI` fallaba validando la respuesta contra
`LockResponse`. Corregido construyendo la respuesta directamente de la
cláusula `RETURNING` del propio `UPSERT`, sin ninguna consulta adicional
después del commit -- ver `backend/app/api/locks.py`.

Pendientes (próximos lotes, no bloquean lo ya entregado): YouTube/Vimeo
(Lote 5), SoundCloud + Quick Actions -- Element Settings/Animate
(Lote 6), Library + Blocks (Lote 7).

## 9b. Vista de hoja doble (spread) + navegación inferior (12-sep-2026)

Feedback textual de Carlos sobre una captura del editor real: retirar la
barra lateral con la lista de páginas para ganar espacio de canvas,
mostrar las páginas interiores a doble hoja (portada/contraportada
siempre a una sola hoja), y sustituir la lista por una navegación inferior
(Anterior/Siguiente + número de hoja activa/total editable manualmente).
Al preguntársele explícitamente si ambas páginas del spread debían ser
editables simultáneamente (como InDesign) o solo una activa con clic para
enfocar, **eligió explícitamente "Ambas editables simultáneamente"** --
decisión ya tomada, no revisitar.

**Cambios de layout**: `.editor-v2-sidebar`/`.editor-v2-pagelist` (la lista
larga de páginas) se retiran por completo. El título de la publicación y
"Volver a publicaciones" pasan a una franja superior compacta
(`.editor-v2-header`, oscura, una sola línea). Debajo del canvas se agrega
`.editor-v2-pagenav`: flecha "← Anterior", campo numérico editable (salta a
la hoja que contiene esa página al confirmar con Enter/blur, posicionándola
en el lado que le corresponda del spread) con la posición actual ("2-3 / 4"
en spread, "1 / 4" en hoja simple), flecha "Siguiente →". Anterior/Siguiente
avanzan por VISTA (hoja simple o spread completo), no por página individual.

**Agrupación en spreads** (`computeSpreadViews(pages, total)`, función pura
exportada desde `CanvasEditorV2.jsx`, sin dependencias de React -- fácil de
razonar/testear en aislamiento): `page_number === 1` (portada) y
`page_number === total` (contraportada) siempre van solas; el resto se
agrupa de a 2 EN ORDEN (2,3), (4,5), (6,7)... -- si el número de páginas
interiores es impar, el último spread interior queda con un solo lado
(el derecho simplemente no se renderiza, no hay un segundo Stage vacío).

**Refactor de `pageEditorStore.js`: de singleton a fábrica.** Para que
ambas páginas de un spread sean independiente y SIMULTÁNEAMENTE editables,
un único store global ya no alcanzaba. `export const usePageEditorStore =
create(...)` pasó a ser `export function createPageEditorStore() { return
create(...); }`, manteniendo EXACTAMENTE la misma lógica interna (la
"regla de oro" de la sección 0 sigue intacta y ahora aplica por instancia:
cada spread lado tiene su propio `pageId`/`version`/`elements`/`loadToken`,
estructuralmente aislado del otro). Se conserva `export const
usePageEditorStore = createPageEditorStore();` como alias de
compatibilidad -- nada dentro del repo lo usa ya (`CanvasEditorV2.jsx` crea
sus propias instancias), pero se deja por si algo externo lo importara.

**`CanvasEditorV2.jsx`**: crea `useLeftStore`/`useRightStore` con
`useState(() => createPageEditorStore())` (estables a través de renders,
nunca en un array/loop condicional). En hoja simple solo `useLeftStore`
está en uso; en spread, `useLeftStore` carga la página izquierda y
`useRightStore` la derecha, cada una con su propio `loadPage`/`save`/ciclo
de vida, igual que el store único hacía antes para una sola página. El
bloque de render de UNA página (Stage/Layer/Transformer/marquee-select,
más los handlers de mouse) se extrajo a `<PageCanvas useStoreHook={...}>`,
montado una vez (hoja simple) o dos veces lado a lado (spread) -- cada
instancia tiene sus PROPIOS `stageRef`/`trRef`/`shapeRefs` (nunca
compartidos entre lados). El lock de edición (`lockAPI`) sigue siendo por
publicación, sin cambios -- ya cubría ambas páginas del spread. El rail de
herramientas y el panel de propiedades actúan sobre la página "enfocada"
(`focusedSide`, estado `'left'`/`'right'` que se actualiza al hacer clic en
el fondo o al seleccionar un elemento en cualquiera de los dos Stages; se
resetea a `'left'` al cambiar de vista). "Guardar" persiste ambos lados si
tienen cambios pendientes (no solo el enfocado).

**Compatibilidad con los scripts de verificación previos**: todos ellos
(`e2e_editor_v2_regression.js`, `verify_lote1(.js/_visual.js)`,
`verify_lote2_shortcodes.js`, `verify_lote3_audio.js`,
`verify_lote4_gallery.js`) usan `window.__pageEditorStore` (sin sufijo)
como el store "activo" -- ninguno de ellos navega jamás a un spread real
(siempre portada/contraportada o una página interior solitaria), así que
`window.__pageEditorStore` se conserva como alias del store izquierdo (el
único garantizado de existir), junto a `window.__pageEditorStoreLeft`/
`window.__pageEditorStoreRight` (nuevos, para scripts que sí necesiten
distinguir ambos lados de un spread, como `verify_spread_view.js`).
`e2e_editor_v2_regression.js` tuvo que actualizarse aparte: navegaba a la
contraportada con `page.click('li:has-text("Contraportada")')`, selector
de la sidebar retirada -- ahora usa el campo de salto de la barra inferior.

**Verificación**: nuevo `frontend/tests/verify_spread_view.js` (publicación
de 5 hojas: portada + 3 interiores + contraportada) cubre hoja simple en
portada/contraportada, spread de 2 Stages en interiores, edición
independiente y simultánea de ambos lados (texto a la izquierda, figura a
la derecha, sin fuga cruzada verificada vía `window.__pageEditorStoreLeft`/
`Right`), persistencia tras guardar+recargar, el caso impar (último spread
interior con un solo lado), y salto manual por número de página
posicionando la página en el lado correcto. Los 5 scripts de regresión
existentes se re-ejecutaron uno por uno (nunca en paralelo, por la
contención ya conocida del lock de edición) tras el cambio: **todos pasan
limpio, sin errores de consola, sin regresiones**.

**Bug de test (no de producto) encontrado escribiendo `verify_spread_view.js`**:
`locator.click({ position })` sobre el `<canvas>` de cada Stage del spread
quedaba reintentando indefinidamente (`'<html>' intercepts pointer
events`) -- posiblemente por el contenedor `.editor-v2-canvas-wrap-spread`
con `overflow-x: auto` interfiriendo con el scroll-into-view automático de
Playwright. Corregido usando el mismo patrón ya probado en
`verify_lote1_visual.js`: `boundingBox()` + `page.mouse.click()` con
coordenadas absolutas de pantalla, en vez de `locator.click({position})`.

No hubo bugs reales de producto que corregir en esta ronda (solo el de
test descrito arriba).

## 10. Próximo paso concreto (para quien retome esto)

Seguir con el Lote 5 (YouTube/Vimeo) siguiendo el mismo patrón:
implementar, verificar con Playwright real contra `ia-lavatur` (screenshots
incluidos cuando aplique), commitear+pushear desde `raspi-2` (única
máquina con credenciales de git para este repo), sincronizar `ia-lavatur`
con `git pull`, y solo entonces pasar al siguiente lote -- sin pausar a
pedir confirmación salvo que algo requiera de verdad la validación de
Carlos. Antes de tocar `docker-compose.dev.yml` o recrear contenedores en
ia-lavatur, releer el aviso de infraestructura de la sección 9 (Lote 3).
Si un lote nuevo agrega un `PageElementKind`, recordar el
`CHECK CONSTRAINT` de la sección de Lote 4 -- hace falta una migración SQL
(`ALTER TABLE ... DROP/ADD CONSTRAINT`) aplicada tanto en el repo
(`0001_editor_v2.sql` para bases nuevas + un `000N_*.sql` nuevo para
bases existentes) como en la base real de ia-lavatur, o el primer guardado
de ese elemento fallará con 500.

Antes de dar por cerrado cualquier lote nuevo: reproducir manualmente (o
vía script Playwright) el escenario de fuga portada→contraportada -- el
test de backend por sí solo no prueba la UI.
