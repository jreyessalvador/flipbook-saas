# flipbook-saas — Rediseño desde cero del editor de páginas

**Versión:** 1.0 — 2026-09-12
**Autor:** Claude (rol: arquitecto de software senior K8s/Docker), a partir de decisiones de Carlos
**Alcance:** Rediseño completo del editor canvas (imagen, texto, figuras, video, audio, hotspots). No cubre infraestructura de despliegue (Fase 0, en pausa) ni multi-tenant de facturación.

---

## 1. Resumen ejecutivo

El editor anterior (rama `desarrollo`, Fabric.js) se abandonó por bugs estructurales, no por fallos puntuales. La auditoría de Antigravity (25-feb-2026) identificó la causa raíz real:

- El estado de la aplicación se mutaba directamente (`sort()` sobre `window.editorConfig.pages`, un array global compartido) en vez de tratarse como inmutable.
- Los objetos del canvas no llevaban una referencia explícita a su página (`pageOriginId` ausente o no copiada al duplicar), así que un objeto nuevo podía "aparecer" en todas las páginas del spread.
- Había `await` dentro de un `forEach` (que no espera nada, por diseño de JS), generando condiciones de carrera entre la carga de portada y la de los objetos JSON.
- Doble inicialización de Alpine.js (`x-data`/`x-init` duplicado) creaba dos instancias del editor con canvas y auto-guardado independientes compitiendo entre sí.

Ninguno de estos son bugs de Fabric.js: son bugs de **modelo de datos y de gestión de estado**. Por eso el rediseño no empieza eligiendo una librería de canvas distinta como solución mágica — empieza fijando un modelo de datos que hace estos bugs estructuralmente imposibles, y sobre ese modelo se elige la librería que mejor encaja.

**Detalle adicional confirmado por Carlos (12-sep-2026), que refina el diagnóstico:** el síntoma no era solo "un objeto se filtra a la página vecina del spread" — era más grave: al editar la portada (imagen + texto) y guardar, la contraportada (al otro extremo de la publicación) a veces mostraba el mismo contenido, y al volver a la portada esta aparecía vacía; además la **orientación de la publicación completa** (vertical/horizontal) cambiaba sola. Esto no se explica solo con `pageOriginId` faltante — apunta a que **todo el objeto de configuración (`window.editorConfig`), incluida la orientación a nivel de publicación, era una única referencia mutable compartida** que el código reasignaba/sobreescribía en el lugar en vez de sustituir de forma controlada al navegar entre páginas. Es decir: no había fuga solo de objetos individuales, había fuga del *objeto de estado completo*. Esto refuerza — no cambia — la solución de este documento: ninguna entidad (ni un elemento, ni la orientación, ni el conteo de páginas) puede vivir en un objeto compartido y mutable; cada una tiene su fila propia en BD y se recarga fresca, nunca se "arrastra" de una página a otra en memoria.

Decisiones de alcance ya tomadas contigo:
- Objetivo: SaaS comercial para terceros (no solo uso interno).
- Edición libre tipo canvas (no por plantillas fijas).
- Tipos de contenido por hoja: imagen, texto, figuras vectoriales, video embebido, audio embebido, hotspots interactivos.
- Guardado explícito (botón "Guardar"), no autoguardado continuo.
- Un editor a la vez por publicación, con bloqueo — sin edición colaborativa en tiempo real.
- Escala inicial: 1-20 tenants piloto.

Estas cuatro últimas decisiones son las que más simplifican el diseño: al descartar autoguardado continuo y colaboración en tiempo real, evitamos toda la complejidad de resolución de conflictos concurrentes (CRDT, operational transform) que un SaaS tipo Figma necesitaría. Es la elección correcta para una escala piloto de 1-20 tenants.

---

## 2. Decisión de motor de canvas: Konva.js (react-konva), no Fabric.js ni tldraw

| Opción | Licencia / coste | Encaje con el problema |
|---|---|---|
| **Fabric.js** (el que ya tenían) | MIT, gratis | Capaz técnicamente, pero mantiene un modelo de objetos mutables por diseño (`canvas.getObjects()` es un array vivo) — invita al mismo patrón de bug que causó el colapso anterior si no se disciplina con una capa de estado externa. |
| **tldraw** | **Comercial de pago obligatorio en producción** — el SDK exige license key activa para funcionar fuera de desarrollo; el precio se negocia con su equipo de ventas (no público). Sin licencia, no arranca en producción. | Pensado para whiteboards colaborativos tipo Miro, no para maquetación editorial de páginas fijas con tamaño de impresión — es una herramienta más grande y cara de lo que este editor necesita. Fuente: tldraw.dev/community/license. |
| **Konva.js / react-konva** (elegido) | **MIT, gratis, sin coste ni límite de uso comercial** | Misma familia de capacidades que Fabric (canvas 2D con objetos, transformaciones, eventos), pero con una API que se integra de forma natural con un store de estado inmutable en React (los nodos Konva se re-renderizan desde props derivadas del store, no se mutan directamente) — esto hace mucho más difícil reproducir el bug de mutación global. Mantenimiento activo, usado en producción por editores visuales similares (documentado oficialmente incluso el patrón de "video en canvas" que necesitamos: konvajs.org/docs/sandbox/Video_On_Canvas.html). |

**Decisión: Konva.js + react-konva.** Elimina el coste de licencia de tldraw (relevante para un SaaS que aún no factura) y, combinado con el modelo de estado de la sección 4, ataca directamente la causa raíz de los bugs anteriores en vez de solo cambiar de librería y arrastrar el mismo patrón de mutación.

Nota técnica sobre video y audio en canvas (relevante porque Canvas 2D no reproduce medios nativamente):
- **Video**: Konva soporta pintar un elemento `<video>` HTML oculto sobre un `Konva.Image` en un loop de `requestAnimationFrame`, actualizando el frame en cada tick — es el patrón documentado oficialmente por Konva. El elemento de video real (controles play/pause) vive fuera del canvas, sincronizado por posición.
- **Audio**: no tiene representación visual nativa. Se modela como un elemento de tipo `audio` en el lienzo con un ícono/miniatura fijo (waveform estático o ícono de altavoz) que el lector puede pulsar; el `<audio>` real se monta como overlay posicionado absolutamente sobre las coordenadas del elemento, igual que el video.

---

## 3. Modelo de datos (PostgreSQL) — implementado en Fase A, ver backend/migrations/0001_editor_v2.sql

Principio de diseño: **todo elemento pertenece a una única página por clave foránea obligatoria (`NOT NULL`), nunca por posición en un array compartido.** No existe ningún array global de páginas en memoria del backend ni en el store del frontend — cada página se carga, edita y guarda de forma aislada.

El repo ya traía `publications.orientation` (portrait/landscape) y `total_pages` desde antes de este rediseño -- la Fase A NO los reemplazó, solo agregó lo que faltaba: `page_elements`, `edit_locks`, `assets`, `publication_versions`, y la columna `pages.version`. Ver el SQL real en `backend/migrations/0001_editor_v2.sql` (fuente de verdad ejecutable) y los modelos SQLAlchemy en `backend/app/models/`.

**Por qué esto arregla los bugs concretos de la auditoría:**

| Bug detectado (25-feb-2026) | Causa | Mitigación en este modelo |
|---|---|---|
| Objetos "se filtran" a otras páginas del spread | `pageOriginId` no se asignaba/copiaba al crear o duplicar objetos | `page_elements.page_id` es `NOT NULL` con FK — un elemento **no puede existir** sin una página, y duplicar un elemento significa `INSERT` de una fila nueva con el `page_id` explícito de destino, nunca una copia "flotante" sin dueño. |
| `sort()` mutando `window.editorConfig.pages` global | Estado global mutable compartido entre componentes | No existe estado global de "todas las páginas" en memoria — el store de frontend (sección 4) carga y opera sobre **una página a la vez**; el orden de páginas es una columna (`page_number`) actualizada vía transacción SQL explícita, nunca un `.sort()` en el cliente sobre un array compartido. |
| `await` dentro de `forEach` | Malentendido de JS: `forEach` no espera promesas | Regla de lint obligatoria (`no-await-in-loop` + revisión de PR) y, en la práctica, la carga de elementos de una página es **una sola petición HTTP** (`GET /api/pages/{id}/elements`) que trae el array completo ya resuelto. |
| Doble instancia del editor (`x-data`/`x-init` duplicado) | Alpine.js + HTML mal formado inicializaba el componente dos veces | Al migrar a React con un componente `<PageEditor pageId=... />` montado una única vez por `page_id` (clave de React), este bug desaparece por construcción. |

### 3.1 Flujo de creación de una publicación (tenant → bloque → publicación)

1. El usuario, dentro de su tenant, pulsa "Nueva publicación" y completa un formulario mínimo: título, orientación y número total de hojas (mínimo 2: portada + contraportada).
2. El backend ejecuta **una sola transacción atómica**: `INSERT` en `publications`, y a continuación `INSERT` de `total_pages` filas en `pages` (page_number 1..N), marcando `page_type='cover'` en la página 1, `page_type='back_cover'` en la página N, `page_type='content'` en el resto. Ya implementado desde antes en `api/publications.py::create_publication` -- Fase A no lo tocó, solo se verificó que sigue cumpliendo el principio.
3. **Cambiar orientación o número de hojas después de creada la publicación no es una edición libre**: `PublicationUpdate` (schemas/publication.py) fue modificado explícitamente en Fase A para NO aceptar `orientation`/`page_width`/`page_height`/`total_pages` -- ver el docstring en ese archivo.

---

## 4. Arquitectura de estado en el frontend (React + Zustand + Immer) — Fase B, aún no implementada

- **Store por página, no store global de la publicación.** El editor monta un store Zustand con scope al `pageId` actual. Al cambiar de página se descarta el store anterior y se crea uno nuevo.
- **Todas las mutaciones pasan por Immer** (`produce()`), nunca `array.sort()`, `array.push()` ni mutación directa de objetos de estado.
- **Konva se alimenta 100% de props derivadas del store**, nunca al revés.
- **Undo/redo** como pila de snapshots inmutables (Immer `patches`).

---

## 5. Ciclo de guardado explícito, bloqueo y publicación inmutable — IMPLEMENTADO en Fase A

**Bloqueo** (`backend/app/api/locks.py`, `backend/app/models/edit_lock.py`):
1. `POST /api/publications/{id}/lock` — toma el lock; 409 si otro usuario lo tiene y no expiró (>60s sin heartbeat = expirado).
2. `PUT /api/publications/{id}/lock/heartbeat` — refrescar cada ~20s desde el frontend (Fase B).
3. `DELETE /api/publications/{id}/lock` — liberar; idempotente.

**Guardado explícito** (`backend/app/api/pages.py`, funciones `get_page_elements`/`save_page_elements`):
- `GET /api/pages/{id}/elements` — una sola petición, trae `version` + todos los elementos.
- `PUT /api/pages/{id}/elements` — body `{version, elements[]}`; si `version` no coincide con `pages.version` en BD, 409 sin escribir nada. Si coincide: reemplaza TODOS los `page_elements` de esa página dentro de una transacción e incrementa `pages.version`.

**Publicación = snapshot inmutable** (`backend/app/api/publications.py`, `backend/app/models/publication_version.py`):
- `POST /api/publications/{id}/publish` — congela el estado actual (todas las páginas + sus elementos) en `publication_versions.snapshot` (JSONB) y actualiza `publications.published_version_id`.
- `GET /api/publications/{id}/versions` — historial de versiones publicadas.
- El Reader (Fase E) debe leer SIEMPRE de `publication_versions`, nunca de `pages`/`page_elements` directamente.

---

## 6. Especificación de cada tipo de elemento (`page_elements.kind`) — `image`/`text`/`shape` con UI (Fase B); `video`/`audio`/`hotspot` modelados en BD, UI pendiente (Fase C/D)

**Shell de UI del editor (Fase B, 12-sep-2026)**: layout de dos paneles
inspirado en Photoshop/Joomag (sin copiarlos), ver
`frontend/src/components/editor/CanvasEditorV2.jsx`:
- **Rail de herramientas (izquierda, iconos SVG propios)**: Seleccionar,
  Hotspot*, Texto, Línea, Rectángulo, Círculo, Estrella, Imagen,
  Galería*, GIF*, Collage*, YouTube*, Vimeo*, Audio*, SoundCloud*,
  Plugins (shortcodes de texto), Library*, Blocks*.
- **Panel de propiedades (derecha)**: Alinear y distribuir (8 operaciones,
  requiere selección múltiple -- funcional, Lote 1), Transformar (X/Y/
  ancho/alto/rotación -- funcional, conectado a `updateElement()`),
  Apariencia (color de relleno para figura/texto, radio de esquina para
  figura, tamaño de fuente para texto -- funcional), Quick Actions*
  (Configuración del elemento, Guardar como bloque, Animar).
- `*` = placeholder deshabilitado ("próximamente"), sin funcionalidad de
  fondo todavía. Línea/Círculo/Estrella + Alinear/Distribuir (selección
  múltiple, shift+click y marquee-select) se activaron en el Lote 1;
  Plugins (shortcodes de texto plano `{{fecha}}`, `{{numero_pagina}}`,
  `{{total_paginas}}`, `{{titulo_publicacion}}` -- NUNCA HTML/JS/iframes
  arbitrarios, decisión explícita de Carlos) se activó en el Lote 2 --
  ver RECETA-DESARROLLO.md secciones 8-9 para el detalle y el resto de
  lotes pendientes (Audio, Galería/Collage/GIF, YouTube/Vimeo,
  SoundCloud+Quick Actions, Library+Blocks).

Todos los `kind` comparten `x, y, width, height, rotation_deg, z_index` (columnas propias). `props` (JSONB) guarda lo específico:

| kind | `props` (JSONB) | Editor (Fase B/C/D) | Reader (Fase E) |
|---|---|---|---|
| `image` | `{ asset_id, alt_text, object_fit }` | `Konva.Image` con transformer | `<img>` o `Konva.Image` |
| `text` | `{ content_html, font_family, font_size, color, align }` | `Konva.Text` + `<textarea>` overlay para edición | Texto estático |
| `shape` | `{ shape_type: rect\|circle\|line, fill, stroke, stroke_width }` | `Konva.Rect`/`Circle`/`Line` | Igual, estático |
| `video` | `{ asset_id, autoplay, loop, muted, poster_asset_id }` | `<video>` oculto + `Konva.Image` con `requestAnimationFrame` | Overlay `<video controls>` |
| `audio` | `{ asset_id, autoplay, loop, icon_style }` | Ícono fijo + `<audio>` overlay | Igual |
| `hotspot` | `{ action_type: link\|goto_page\|gallery\|form, target }` | Rectángulo semitransparente con ícono | Zona invisible clicable |

---

## 7. Endpoints de API — estado real tras Fase A

```
IMPLEMENTADOS (Fase A):
POST   /api/publications/{id}/lock
PUT    /api/publications/{id}/lock/heartbeat
DELETE /api/publications/{id}/lock
GET    /api/pages/{id}/elements
PUT    /api/pages/{id}/elements
POST   /api/publications/{id}/publish
GET    /api/publications/{id}/versions

YA EXISTIAN (sin cambios de fondo):
POST   /api/publications/            (crea publicacion + paginas)
GET    /api/publications/            (lista)
GET    /api/publications/{id}
PUT    /api/publications/{id}        (ya NO acepta orientation/page_width/page_height/total_pages)
DELETE /api/publications/{id}
GET    /api/publications/{id}/pages
GET    /api/pages/{id}
PUT    /api/pages/{id}                (deprecado a favor de PUT .../elements, ver nota abajo)
POST   /api/assets/upload

PENDIENTE (Fase C/D):
POST   /api/assets                    -- version con metadatos completos en tabla assets (hoy assets.py sube a MinIO sin fila en BD)
GET    /api/assets/{id}
```

**Nota sobre `PUT /api/pages/{id}` (el endpoint viejo que actualiza `Page.content`):** se deja intacto por compatibilidad pero NO debe usarse desde el editor nuevo -- `Page.content` es el campo deprecado (ver comentario en `models/page.py`). El editor Fase B debe usar exclusivamente `GET/PUT /api/pages/{id}/elements`.

---

## 8. Sonido y renderizado de cambio de página (Reader) — diseño fijado, implementación en Fase C/E

**Sonido:** ya cubierto por `page_elements.kind='audio'` (contenido) + `publications.page_turn_sound_asset_id` (opcional, aún no agregado como columna -- ver Pendiente abajo, no crítico para Fase A).

**Renderizado de cambio de página:** responsabilidad exclusiva del Reader (Fase E), con `react-pageflip` (MIT) + cada hoja como Konva Stage en modo solo-lectura (no imagen aplanada, para no perder video/audio/hotspots interactivos).

> Nota de implementación (Fase A, 12-sep-2026): la columna `publications.page_turn_sound_asset_id` SI se agregó en la migración 0001 y en el modelo `Publication`. Queda pendiente que el flujo de creación/edición de publicación permita setearla (Fase B/D, no bloqueante).

---

## 9. Plan de implementación por fases — ESTADO REAL

1. **Fase A — Fundaciones de datos y bloqueo — ✅ COMPLETADA Y VERIFICADA CONTRA STACK REAL (12-sep-2026), rama `redesign/editor-v2`, commits `da9aa7a` y `718ccde`.** Migraciones SQL, modelos SQLAlchemy, endpoints de lock/heartbeat/unlock, endpoint de guardado con concurrencia optimista, endpoint de publish/versions. Verificado en dos niveles: (a) import real de la app FastAPI sin errores, (b) stack completo Postgres+Redis+MinIO+FastAPI levantado con Docker en `ia-lavatur` y prueba end-to-end con `curl` reproduciendo el bug original de Carlos (fuga portada→contraportada) -- **el bug NO se reproduce**, ver checklist sección 10 y `backend/tests/test_editor_v2_regression.sh`.
2. **Fase B — Editor canvas mínimo — ✅ COMPLETADA Y VERIFICADA CONTRA NAVEGADOR REAL (12-sep-2026), rama `redesign/editor-v2`.** React + react-konva (pinned `18.2.16`), store Zustand/Immer por página, tipos `image`/`text`/`shape`, guardado explícito con 409, lock+heartbeat. Verificado con Playwright (Chromium real vía Docker en `ia-lavatur`, `frontend/tests/e2e_editor_v2_regression.js`) reproduciendo el escenario exacto del bug original -- **no se reproduce, sin fugas ni errores de consola**. 4 bugs reales encontrados y corregidos en esta ronda (condición de carrera en lock, `crypto.randomUUID` fuera de secure context, warning de key en spread, URLs/CORS hardcodeados) -- ver RECETA-DESARROLLO.md sección 7 para el detalle. Además se reestructuró la UI a un shell de dos paneles inspirado en Photoshop/Joomag (ver sección 6 más abajo); las categorías de herramienta nuevas quedan como placeholders visuales, su funcionalidad de fondo es trabajo de Fase C/D.
3. **Fase C — Medios**: tipos `video` y `audio`. NO INICIADA.
4. **Fase D — Hotspots**: tipo `hotspot` + acciones. NO INICIADA.
5. **Fase E — Reader público**. NO INICIADA.

## 10. Checklist de pruebas específico (regresión de los bugs conocidos) — automatizado como smoke test, ejecutado y PASÓ (12-sep-2026)

- [x] Editar la portada, guardar, navegar a la contraportada y volver: confirmar aislamiento total (reproduce el bug reportado por Carlos). **VERIFICADO 12-sep-2026 vía curl contra stack real en ia-lavatur: contraportada quedó con 0 elementos, portada conservó sus 2 elementos.**
- [x] Crear una publicación en orientación "portrait" y confirmar que tras editar/guardar varias páginas, `publications.orientation` no cambia. **VERIFICADO: se mantuvo "portrait" en todo el flujo.**
- [x] Guardar con `version` antiguo (simulando conflicto): 409, no sobrescribe. **VERIFICADO: HTTP 409 recibido, datos no sobrescritos.**
- [x] Bloqueo, publish, listar versions (`is_current: true`), unlock (204) y re-lock (200). **VERIFICADO.**
- [ ] Duplicar un elemento en la página 2 de un spread y confirmar que **no aparece** en la página 1 ni en ninguna otra página. (No probado aún -- requiere UI de Fase B para duplicar; el modelo de datos ya lo impide estructuralmente vía FK NOT NULL a una sola página.)
- [ ] Reordenar páginas y confirmar que ningún `page_element` cambia de `page_id`. (No probado aún -- reordenar páginas no implementado hasta Fase B/D.)
- [ ] Abrir la misma publicación en dos pestañas: la segunda recibe 409 al bloquear. (Lógica de lock ya verificada por API directamente; falta probar desde dos sesiones de navegador reales en Fase B.)
- [ ] Cerrar sin guardar/salir: el lock se libera solo tras ~60s sin heartbeat. (Lógica implementada y revisada en código; no cronometrado en vivo aún.)
- [x] Editar la portada, guardar, navegar a la contraportada y volver -- REPETIDO en Fase B con navegador real (Playwright/Chromium, no solo curl): **VERIFICADO 12-sep-2026, sin fuga de contenido ni errores de consola.**
- [ ] Cargar una página con 50+ elementos mixtos en una sola petición HTTP. (No probado con volumen; probado con 2 elementos. Pendiente prueba de carga.)
- [ ] Abrir la misma publicación en dos pestañas: la segunda recibe 409 al bloquear -- probado por API en Fase A; pendiente repetir desde dos sesiones de navegador reales.

Script reutilizable: `backend/tests/test_editor_v2_regression.sh` (bash + curl, ejecutable, con asserts explícitos). Hallazgo colateral: `minio/minio` fue retirado de Docker Hub ("pull access denied") -- usar `quay.io/minio/minio` en cualquier compose nuevo.

---

## 11. Infraestructura de cómputo pesado (imagen/video): Contabo 2 con aislamiento estricto — diseño fijado, no implementado

Ver `context.md` del proyecto (sección "Decisiones de arquitectura, ronda 3") para el detalle completo: worker Celery en Contabo 2, usuario Linux dedicado sin sudo, contenedor sin privilegios, red Docker propia, túnel WireGuard `wg-flipbook` separado del `wg-pdf` de nexus-cmms.

## 12. Entorno de desarrollo/pruebas visuales: ia-lavatur (EXCEPCIÓN temporal y acotada)

Ver `projects/ia-lavatur/context.md` para los guardarraíles completos (Docker plano sin tocar K8s/Mantyx, acceso solo vía Tailscale, carpeta portable). Resumen: mientras Carlos no tenga servidor propio dedicado, el entorno de desarrollo con interfaz visual (Fase B en adelante) se monta en `ia-lavatur` como carpeta Docker Compose autocontenida y portable (`cp`/`mv` a otro servidor con Docker).

## 13. Lo que queda fuera de este documento (decisiones pendientes, no bloqueantes)

- Modelo de planes/precios del SaaS comercial.
- Migración de contenido histórico desde Joomag.
- Ejecutar la migración SQL 0001 contra Postgres real y automatizar la checklist de la sección 10 como tests pytest.
