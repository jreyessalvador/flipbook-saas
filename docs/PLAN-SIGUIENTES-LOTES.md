# Cetrix Revistas — Plan de los siguientes lotes (para retomar en otra sesión)

> Redactado el 28-sep-2026 al cierre de la sesión que dejó en producción FLIP-2, L4 y FLIP-3.
> **Estado de partida:** producción (`revistas.cetrix.com.mx`) = DEV (`dev-revistas.cetrix.com.mx`) = rama `redesign/editor-v2`.
> Nada de este documento está implementado todavía. Cada lote se hace en DEV, lo valida Carlos y después pasa a producción.

---

## 0. Antes de empezar (checklist de arranque de sesión)

1. Leer `agents-memory` → `projects/flipbook-saas/context.md`, bloque **«ESTADO CONSOLIDADO 28-sep-2026»** (Contabo 2, `/home/claude/projects/agents-memory`).
2. Leer `RECETA-DESARROLLO.md` §14 (procedimiento de producción), §15-§17 (últimos lotes) y `docs/HANDOFF-AGENTES.md`.
3. Comprobar que PROD y DEV siguen en el mismo commit:
   ```bash
   # Contabo 1
   git -C /srv/apps/flipbook -c safe.directory=/srv/apps/flipbook log --oneline -1
   git -C /srv/apps/flipbook-dev -c safe.directory=/srv/apps/flipbook-dev log --oneline -1
   ```
4. Crear rama `feat/<lote>` desde `origin/redesign/editor-v2`.

### Flujo de trabajo (sin cambios)
| Paso | Dónde | Cómo |
|---|---|---|
| Código y commit | clon del agente o raspi-2 | raspi-2 es el **único host con credenciales git** (`~/flipbook-saas`). Un agente cloud sin credenciales: `git format-patch -1 --stdout \| gzip -9 \| base64 -w0`, transferir por SSH a raspi-2 en trozos de ~7 KB verificados con `md5sum`, y allí `git am` + `git push`. |
| DEV | Contabo 1 `/srv/apps/flipbook-dev` | `git fetch && git checkout <rama>`; frontend con vite (HMR) y backend con `--reload` por bind-mount. Migraciones: `pg_dump` previo a `~/backups/flipbook-dev/` y `psql -v ON_ERROR_STOP=1`. |
| QA | contenedor `flipbook-dev-backend` | `docker cp backend/tests/<qa>.py flipbook-dev-backend:/tmp/ && docker exec flipbook-dev-backend python /tmp/<qa>.py`. Siempre también `qa_lote_c_tenant_isolation.py` (26) y `qa_lote_c2_rbac_team.py` (37). |
| Validación | Carlos | Revisa en dev-revistas y aprueba. |
| Producción | Contabo 1 `/srv/apps/flipbook` | Merge ff a `redesign/editor-v2` en raspi-2 → RECETA §14: `pg_dump` a `~/backups/flipbook-prod-pre-<lote>-<fecha>.dump`, tag `rollback-pre-<lote>` de las imágenes afectadas, `git pull --ff-only`, migración si la hay, `docker compose -f docker-compose.prod.yml up -d --build <servicios>`, verificación (`/health`, lector público, API). |
| Documentar | repo + agents-memory | Sección nueva en `RECETA-DESARROLLO.md`, fila en `HANDOFF-AGENTES.md`, entrada en `agents-memory`. |

**Prohibido en Contabo 1:** `docker system prune`, `docker volume prune`, `docker compose down -v`, tocar otros stacks.

---

## 1. Orden recomendado

| # | Lote | Por qué en este orden | Toca BD | Tamaño |
|---|---|---|---|---|
| 1 | **L5** Descarga PDF por edición + papelera 30 días | ✅ EN PRODUCCIÓN 03-oct-2026 (RECETA §20) | Sí (0011) | M |
| 2 | **L7a** Miniaturas de portada completas + imagen OG 1200×630 | Prerrequisito de la estantería y mejora inmediata al compartir | Sí (0012) | M |
| 3 | **Estantería pública** (azul marino + dorado) | Decidido por Carlos «para después»; depende de L7a | No | M |
| 4 | **PDF → hotspots** (enlaces del PDF importado) | Aprovecha FLIP-3 (brillo en hotspots) | No | S |
| 5 | **L6** Estadísticas sin cookies + `views_count` | Da datos reales para la web comercial | Sí (0013) | M |
| 6 | **L8** UI de categorías en Super Admin | API ya existe; solo falta pantalla | No | S |
| 7 | **L9** Correo (SMTP IONOS no-reply@cetrix.com.mx) | ✅ EN PRODUCCIÓN 29-sep-2026 (RECETA §19) | No | S |
| 8 | **Web profesional** (landing) | Sigue el Claude Doc «Propuesta web Cetrix Revistas» | No | L |

---

## 2. L5 — Descarga del PDF por edición + papelera 30 días

**Objetivo:** el lector puede descargar la revista en PDF si la empresa lo permite; borrar una edición la manda a una papelera recuperable durante 30 días en vez de eliminarla al instante.

### Estado actual (verificado en código)
- `Publication.pdf_url` solo existe en ediciones **importadas desde PDF** (original en MinIO `tenant-{id}/imports/{uuid}.pdf`). Las creadas en el editor no tienen PDF.
- `DELETE /api/publications/{id}` (rol admin) hace **borrado físico** (`db.delete`), sin papelera.
- El worker de importación (`backend/app/workers/pdf_import.py`, Celery, `pdf2image` a 144 dpi) no genera PDF de salida.

### Decisiones pendientes de Carlos (preguntar al empezar)
1. Descarga para ediciones creadas en el editor: ¿se genera PDF (render de páginas) o solo se ofrece en las importadas? *Recomendación:* fase 1 solo importadas; generar PDF desde el editor = lote F (worker en Contabo 2, ya previsto en el plan).
2. ¿Botón de descarga activado por defecto o desactivado? *Recomendación:* desactivado (protege el contenido del cliente).
3. ¿Quién puede vaciar la papelera / restaurar? *Recomendación:* admin+ restaura; borrado definitivo manual solo owner; purga automática a los 30 días.

### Modelo — migración `0011_download_trash.sql` (idempotente)
```sql
ALTER TABLE publications ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE publications ADD COLUMN IF NOT EXISTS deleted_by UUID NULL REFERENCES users(id);
CREATE INDEX IF NOT EXISTS ix_publications_deleted_at ON publications(deleted_at) WHERE deleted_at IS NOT NULL;
```
- El índice único parcial de slug (`uq_publications_collection_slug`) debe **seguir aplicando** a las borradas, o al restaurar puede chocar: al restaurar, recalcular slug con `unique_publication_slug(..., exclude_id=pub.id)` si colisiona.

### API
- **Todas** las consultas de ediciones (panel, `_public_catalog_stmt`, resolvers `/r/...`, `/leer/{id}`, stats del Dashboard, cuota `require_publication_quota`) añaden `Publication.deleted_at.is_(None)`. Buscar con `grep -n "query(Publication)\|select(Publication" backend/app`.
- `DELETE /api/publications/{id}` → soft delete: `deleted_at=now()`, `deleted_by`, `is_public=False` (sale del kiosco al instante). Mantener `require_role("admin")`.
- `GET /api/publications/trash` (admin): borradas del tenant con `días_restantes`.
- `POST /api/publications/{id}/restore` (admin): `deleted_at=NULL`; no restaura `is_public` (queda privada, el admin decide).
- `DELETE /api/publications/{id}/purge` (owner): borrado físico + objetos MinIO que solo use esa edición (ojo: los clones comparten archivos por referencia → **no** borrar objetos referenciados por otra edición; comprobar en `page_elements.props->>'src'` y `assets`).
- Purga automática: tarea Celery beat diaria (`purge_trash_task`) que purga `deleted_at < now() - interval '30 days'`. Si beat no está configurado aún, alternativa: cron del host que ejecute `docker exec flipbook-prod-backend python -m app.scripts.purge_trash`.
- `GET /api/public/publications/{id}/download` → 302 a URL firmada de MinIO (caducidad 10 min) **solo si** edición pública + publicada + `allow_download` + `pdf_url`. Si no, 404. Nombre de descarga: `Content-Disposition: attachment; filename="<slug>.pdf"`.
- `PublicationUpdate` acepta `allow_download`; la API pública añade `viewer.download_url` (o `null`).

### Frontend
- **Ajustes → Visor:** interruptor «Permitir descargar el PDF» (deshabilitado con explicación si la edición no tiene PDF).
- **Reader público y `/embed/`:** botón de descarga (icono) en la cabecera solo si `viewer.download_url`.
- **Mis publicaciones:** «Eliminar» pasa a «Mover a la papelera» (confirmación que menciona los 30 días). Enlace «Papelera (N)» en la cabecera de la colección → lista con Restaurar / Eliminar definitivamente (owner).
- `Icon.jsx`: añadir iconos `download`, `trash`, `restore`.

### QA — `backend/tests/qa_lote_l5.py`
Soft delete oculta en panel, kiosco, `/r/...`, `/leer/`, stats y cuota; restaurar vuelve privada; purge solo owner (admin → 403); descarga 404 si `allow_download=false`, si privada, si sin PDF; 302 válido si todo OK; otra empresa no puede restaurar/purgar/descargar (404); purga automática con `deleted_at` antiguo; clon comparte imagen → purgar el original no borra el objeto usado por el clon.

### Criterios de aceptación
- [ ] Borrar desde el panel no elimina: aparece en Papelera con días restantes.
- [ ] Restaurar la devuelve privada a su colección, con su URL intacta.
- [ ] Tras 30 días se purga sola (probado forzando fecha en DEV).
- [ ] Descargar PDF solo visible y funcional cuando la empresa lo permite.
- [ ] QA L5 + aislamiento 26 + RBAC 37 en verde.

**Producción:** migración 0011 + `up -d --build backend pdf-worker frontend` (+ servicio beat si se añade).

---

## 3. L7a — Miniaturas de portada completas + imagen Open Graph 1200×630

**Problema:** `cover_url` (kiosco, tarjetas, OG) es la **imagen de mayor área de la página 1** (`_cover_from_snapshot` en `public.py`, `_attach_cover_thumbnails` en `publications.py`). Se pierden logo, titulares y demás capas, y se sirve el original (~460 KB). WhatsApp puede no mostrar miniaturas pesadas.

### Diseño
- Al **publicar** (`POST /publish`) se encola `render_cover_task(publication_id, version_id)` en Celery.
- El worker renderiza la página 1 del **snapshot** a PNG con todas sus capas. Opciones (decidir al empezar):
  - **A (recomendada): Playwright + Chromium headless** en el `pdf-worker`, abriendo una ruta interna del frontend `/render/cover/{version_id}?token=...` que pinta `StaticPage` sin chrome. Fidelidad total (mismo Konva que el lector). Coste: imagen del worker más pesada (~300 MB).
  - B: re-implementar el pintado en Python con Pillow (imágenes + texto) — menos fiel (fuentes, galerías, formas).
- Salidas en MinIO `tenant-{id}/covers/{version_id}/`: `cover-400.webp` (≤ 40 KB, ancho 400), `cover-800.webp` (retina) y `og-1200x630.jpg` (portada centrada sobre fondo azul marino con marca, ≤ 300 KB).
- Migración `0012_cover_renders.sql`: `publication_versions.cover_key TEXT NULL`, `publication_versions.og_key TEXT NULL`.
- `_cover_from_snapshot` / `cover_url` prefieren `cover_key` si existe; si no, fallback actual (así las versiones antiguas siguen funcionando). Script de backfill para regenerar las versiones vigentes.
- OG (`_open_graph_html`): `og:image` = `og_key` + `og:image:width/height` 1200/630.

### Criterios de aceptación
- [ ] La tarjeta del kiosco muestra la portada **completa** (con logo y titulares).
- [ ] Cada portada pesa < 40 KB en el kiosco.
- [ ] Compartir en WhatsApp muestra la miniatura grande.
- [ ] Publicar sigue respondiendo al instante (render asíncrono; mientras no exista, fallback).

---

## 4. Estantería pública (kiosco) — decidido por Carlos, «para después»

**Decisiones ya tomadas:** solo vista **pública** (el panel interno mantiene tarjetas); balda estilizada **azul marino + dorado** (sin madera ni fondos rosados de PubHTML5). Depende de L7a.

### Diseño
- **Landing (`LandingPage.jsx`, sección `#showcase`):** una balda por colección; encima nombre de la colección; a la izquierda el **último número** más grande con etiqueta «Último número»; a su derecha los anteriores. Chips de categoría actuales se mantienen.
- **Página de colección `/r/{empresa}/{colección}` (`PublicCollection.jsx`):** estantería completa con buscador, orden nombre / fecha y paginación (24 por página).
- **Balda:** línea dorada fina (`--color-gold`) con reflejo y sombra suave sobre `--color-navy-dark`; portadas con grosor de lomo (pseudo-elemento) y sombra; al pasar el ratón se inclinan ligeramente y muestran título, edición y páginas; en móvil el título va debajo.
- **Responsive:** 6-8 portadas por balda (escritorio), 4 (tablet), 2 (móvil) con desplazamiento horizontal por balda (scroll-snap).
- **«NUEVO» automático:** cinta dorada si `published_at` < 15 días (usar `publication_versions.created_at` de la versión vigente).
- **Insertable:** `/embed/r/{empresa}/{colección}` para que el cliente ponga su quiosco en su web (misma política `frame-ancestors *` que `/embed/`, ya cubierta por `location /embed/` en `frontend/nginx.conf`).
- Componentes nuevos sugeridos: `components/public/Bookshelf.jsx`, `BookshelfCover.jsx`, `styles/Bookshelf.css`. `KioskCard.jsx` puede quedar para otros usos.

### Criterios de aceptación
- [ ] Portadas completas y ligeras (de L7a), balda azul/dorado, sin madera.
- [ ] 360 px de ancho sin desplazamiento horizontal de página.
- [ ] Lighthouse móvil: Rendimiento ≥ 90 en la landing con 24 portadas.
- [ ] El panel interno no cambia.

---

## 5. PDF importado → hotspots automáticos

**Motivo:** en el vídeo de referencia (Joomag) brillan muchas zonas porque los enlaces venían del PDF. Nuestro import (`pdf_import.py`) rasteriza con `pdf2image` e ignora las anotaciones de enlace.

### Diseño
- En `import_pdf_task`, tras rasterizar, leer anotaciones `/Link` de cada página con **PyPDF2** (ya en requirements) o pypdf:
  - `/A /URI` → hotspot `action:'url'` (solo `https://`; `http://` se sube a https o se descarta — el validador de `page_element.py` exige https).
  - `mailto:` → `action:'email'`; `tel:` → `action:'phone'`.
  - `/Dest` o `/A /GoTo` → `action:'page'` con `target_page_id` de la página destino (segunda pasada, cuando ya existen todas las `Page`).
- Convertir el `Rect` del PDF (puntos, origen abajo-izquierda) a coordenadas del editor: `x = x0 * sx`, `y = (page_h_pt - y1) * sy`, con `sx = page_width_px / page_w_pt` (PX_PER_MM = 3 → `page_width_mm * 3`). Tener en cuenta `/Rotate` y `MediaBox` vs `CropBox`.
- `z_index` por encima de la imagen de fondo; `props.tooltip` = dominio o texto del enlace.
- Descartar áreas < 12×12 px y deduplicar rectángulos solapados con el mismo destino.
- QA: PDF de prueba con URL, mailto, tel y salto interno → 4 hotspots con acciones y posiciones correctas (±2 px).

---

## 6. L6 — Estadísticas sin cookies + `views_count`

**Objetivo:** contar lecturas reales sin cookies ni banner (compatible RGPD/LFPDPPP) y mostrarlas en el Dashboard y por edición.

### Diseño
- Migración `0013_reader_stats.sql`: tabla `reader_events (id bigserial, publication_id uuid, day date, visitor_hash char(16), event text, page int null, referrer_host text null, country char(2) null, created_at timestamptz)` + índice `(publication_id, day)`.
- `visitor_hash` = primeros 16 hex de `sha256(salt_diario + ip + user_agent + publication_id)`; `salt_diario` rota cada día y **no se guarda** → no identifica personas ni permite seguimiento entre días (mismo enfoque que Plausible/Fathom).
- `POST /api/public/events` (sin auth, rate-limit por IP): `open`, `page_view` (cada vista de hoja, con `page`), `link_click` (hotspot, con acción). El Reader lo envía con `navigator.sendBeacon`; `/embed/` marca `referrer_host`.
- `views_count` = aperturas únicas por día (se actualiza con un `UPDATE ... + 1` al primer `open` del `visitor_hash` ese día).
- Panel: pestaña **Estadísticas** en Ajustes de edición (lecturas por día, páginas más vistas, clics en enlaces, webs donde está insertada) y totales en el Dashboard (ya lee `views_count`).
- Respeta `DNT`/`Sec-GPC`: si están activos, no se registra nada.

### Criterios
- [ ] Ninguna cookie ni localStorage nuevo para medir.
- [ ] Recargar 10 veces cuenta 1 lectura ese día.
- [ ] Datos solo visibles para la propia empresa (QA de aislamiento).

---

## 7. L8 — UI de categorías en Super Admin

- La API ya existe (`backend/app/api/superadmin.py`: `GET/POST /api/superadmin/categories`, `PATCH /api/superadmin/categories/{id}`). `SuperAdmin.jsx` **no** tiene pantalla de categorías.
- Añadir pestaña «Categorías»: listado (nombre, slug, nº de colecciones, activa), crear, renombrar, activar/desactivar, ordenar. Sin borrado físico si hay colecciones que la usan.
- QA: solo superadmin (owner de empresa → 403, ya cubierto en QA Lote C).

---

## 8. L9 — Correo con Resend

- **Bloqueo:** Carlos debe verificar el dominio en Resend (como en manten.io) y pasar la clave por `.env` (`RESEND_API_KEY`, `MAIL_FROM="Cetrix Revistas <no-reply@cetrix.com.mx>"`). Nunca en el repo.
- Hoy `team.py` devuelve el enlace de invitación en la respuesta («Sin SMTP todavía») y el restablecimiento de contraseña igual. Añadir `app/services/mailer.py` (HTTP a la API de Resend, reintentos, plantilla HTML con la marca) y usarlo en: invitación de equipo, reenvío de invitación, invitación de owner (Super Admin) y restablecer contraseña.
- Mantener el enlace en la respuesta **solo** para superadmin como respaldo.
- DEV: `MAIL_DRY_RUN=true` escribe el correo en el log en vez de enviarlo.

---

## 9. Web profesional (landing comercial)

- Especificación completa, con criterios de aceptación por sección, columna Estado, mapa del sitio, estándares (LCP < 2,5 s, Lighthouse ≥ 90/95/95), 3 fases y checklist de validación: **Claude Doc «Propuesta web Cetrix Revistas»** → https://claude.ai/code/artifact/61a8bab0-d714-4786-b87c-50384a4c6f64
- Decisiones pendientes de Carlos (en el doc): logos/testimonios autorizados, precios MXN/EUR, revista incrustada en la portada, variante de idioma, revisión legal RGPD/LFPDPPP.
- Fase 2 de la web depende de L7a + Estantería.
- Al implementar cada fase: actualizar la columna Estado y marcar la checklist del doc.

---

## 10. Pendientes operativos (no son lotes de código)

- Certificado Let's Encrypt de `cetrix-odoo.duckdns.org` **caduca el 03-oct-2026** y su renovación falla (webroot `/var/www/html` pero el site odoo18 redirige `/.well-known` a https). Pendiente de decisión de Carlos.
- Limpieza periódica de imágenes `rollback-pre-*` antiguas en Contabo 1 cuando los lotes estén asentados (conservar la última de cada servicio).

---

## Backlog anotado 30-sep-2026 (sin prioridad asignada por Carlos)
- **Dominio propio del cliente (Lote D)**: diseño en `docs/dominios-propios.md` (CNAME a
  `custom.revistas.cetrix.com.mx` + TXT `_cetrix-verify.<host>`); Carlos lo volvió a plantear el 29-sep
  con Destinos y Negocios como primer cliente real. Nada construido.
- Aviso en la tarjeta de la edición cuando está publicada pero no visible en el kiosco.
- Nombres de colección por defecto más descriptivos / invitar a renombrar «General».
