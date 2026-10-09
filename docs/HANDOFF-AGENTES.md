# flipbook-saas — Handoff para agentes (Claude, Codex, Antigravity)

> **Documento de entrada obligatorio.** Estado a **27-sep-2026**. Léelo completo antes de tocar código o servidores.
> Detalle histórico por lote en `RECETA-DESARROLLO.md` (secciones 9–12). Memoria compartida entre agentes:
> repo `agents-memory` en Contabo 2 → `projects/flipbook-saas/context.md` y `_global/infraestructura.md`
> (**siempre `git pull` allí antes de empezar y registrar allí lo que hagas**).

---

## 1. Qué es el producto

SaaS comercial multi-empresa de **revistas y catálogos digitales interactivos** (referencia funcional: Joomag).
Propiedad de Cetrix (Carlos Reyes, arquitecto único). Marca comercial provisional: **revistas.cetrix.com.mx**
(dominio `sapherion.com` en valoración).

Jerarquía de datos: **Empresa (tenant) → Colección → Ediciones → Páginas → Elementos**.

- Una **Colección** agrupa las ediciones de una revista/catálogo (p.ej. "Destinos y Negocios": No. 33, No. 34…).
- Una **Edición** es una fila de `publications` (el nombre técnico no se cambió para no romper nada).
- Las ediciones se crean en blanco o **importando un PDF** (worker Celery rasteriza las páginas).
- Se **publican** como snapshot inmutable (`publication_versions`); el lector público `/leer/:id` lee SOLO el snapshot.

## 2. Entornos y dónde está todo

| Qué | Dónde |
|---|---|
| Repo | `github.com/jreyessalvador/flipbook-saas`, rama activa **`redesign/editor-v2`** (`desarrollo` = editor viejo, NO mergear sin revisión de Carlos) |
| Donde se escribe/commitea/pushea | **`raspi-2`** (`/home/administracion/flipbook-saas`, conector `ssh-raspi-ii`). Es el único host con permiso de push |
| DEV (único entorno activo) | **Contabo 1** `vmi3411029` (62.171.163.215, conector `ssh-vps-contabo`), carpeta **`/srv/apps/flipbook-dev`** (clon con **deploy key de solo lectura**, alias ssh `github-flipbook`; aquí solo `git pull --ff-only`) |
| URL DEV | **https://dev-revistas.cetrix.com.mx** — nginx con allowlist `85.86.0.0/16` + Contabo 2 (169.58.102.22) + basic auth (`carlos`, clave en `~/.dev-revistas-basic-auth.txt` de `administracion` en Contabo 1). `/api` sin basic auth (la SPA manda Bearer) pero con la allowlist |
| Producción futura | Contabo 1, hostname reservado **revistas.cetrix.com.mx**, puertos reservados en `/srv/apps/PORTS.md` (3400/4400/5443/6390/9012-9013) |
| Antiguo DEV | `ia-lavatur` (servidor del CLIENTE Lavatur). **Apagado** (`docker stop`, no arranca solo). **No encender** salvo petición explícita de Carlos |
| Workers pesados futuros | Contabo 2 (solo workers; nunca host completo — aloja las llaves SSH de los agentes). Túnel WireGuard `wg-pdf` C1↔C2 cerrado por defecto |

### Flujo de trabajo estándar
1. En `raspi-2`: `cd ~/flipbook-saas && git pull` → cambios → `npx vite build --outDir /tmp/x` (frontend) / `python3 -c "import ast..."` (backend) → commit (con las líneas `Co-Authored-By`/`Claude-Session` si eres Claude) → `git push origin redesign/editor-v2`.
2. En Contabo 1: `cd /srv/apps/flipbook-dev && git pull --ff-only`. El backend (`uvicorn --reload`) y el frontend (Vite HMR) recogen el código montado solos. Si cambian dependencias npm: `docker restart flipbook-dev-frontend`. Si cambia el Dockerfile/requirements: `docker compose -f docker-compose.dev.yml up -d --build backend pdf-worker`.
3. Migraciones SQL: `backend/migrations/NNNN_*.sql`, **idempotentes**, se aplican a mano: backup primero
   (`docker exec flipbook-dev-postgres pg_dump -U flipbook -d flipbook -Fc > ~/backups/flipbook-dev/pre-NNNN-$(date +%F).dump`)
   y luego `docker exec -i flipbook-dev-postgres psql -v ON_ERROR_STOP=1 -U flipbook -d flipbook < backend/migrations/NNNN_x.sql`. Aplicadas: 0001–0008.
4. Registrar lo hecho en `agents-memory` y, si es un lote, en `RECETA-DESARROLLO.md`.

### Reglas duras en Contabo 1 (aloja producción de otros productos)
- **Prohibido** `docker system prune`, `docker volume prune`, `docker compose down -v` o cualquier comando fuera de `/srv/apps/flipbook-dev`.
- Antes de publicar un puerto: leer y actualizar **`/srv/apps/PORTS.md`**.
- Todo contenedor publica en `127.0.0.1`; solo nginx expone 80/443.
- SSH endurecido (solo llave; password de `administracion` solo desde 85.86.0.0/16; root sin SSH).

## 3. Stack y contenedores DEV (proyecto Compose `flipbook-dev`)

| Contenedor | Qué | Puerto host |
|---|---|---|
| flipbook-dev-postgres | PostgreSQL 15 (`./data/postgres`) | 127.0.0.1:5442 |
| flipbook-dev-redis | Redis app + broker Celery | 127.0.0.1:6389 |
| flipbook-dev-pdf-queue | Redis cola PDF | interno |
| flipbook-dev-minio | MinIO `minio/minio:RELEASE.2025-04-22T22-12-26Z` (quay.io ya da 401), bucket privado `flipbook-assets` | 127.0.0.1:9010/9011 |
| flipbook-dev-backend | FastAPI (`uvicorn --reload --proxy-headers --forwarded-allow-ips=*`) | 127.0.0.1:8010 |
| flipbook-dev-pdf-worker | Celery import PDF (healthcheck propio con `celery inspect ping`) | — |
| flipbook-dev-frontend | Vite dev server (React 18 + react-konva + zustand) | 127.0.0.1:5173 |

Todos con `mem_limit`/`cpus`. Backup diario cifrado a S3: función `backup_flipbookdev` en `/usr/local/bin/backup-others.sh` (cron 03:45 de `administracion`).
`.env` DEV con secretos propios (no copiar a otros entornos). Variables clave: `COMPOSE_PROJECT_NAME`, `VITE_API_URL`, `VITE_ALLOWED_HOSTS`, `VITE_HMR_CLIENT_PORT=443`, `CORS_ORIGINS`.

## 4. Multi-empresa, contexto y permisos (LO MÁS IMPORTANTE)

### 4.1 Contexto de empresa — regla de oro
`get_current_user` (`backend/app/api/auth.py`) devuelve el usuario con atributos de instancia (NO columnas):
- `effective_tenant_id` — **filtrar SIEMPRE por esto**, nunca por `current_user.tenant_id`.
- `tenant_role` — rol efectivo en esa empresa.
- `is_platform_superadmin`, `acting_as_tenant`.

Reglas: usuario normal = su empresa, exige usuario activo + membresía activa + empresa no suspendida/cancelada (403).
**Super Admin CETRIX** (rol de plataforma en `user_platform_roles`) = su empresa o la indicada en la cabecera
**`X-Tenant-Id`** (selector "Empresa" de la barra); para cualquier otro usuario la cabecera se ignora. Super Admin actúa como `owner`.

### 4.2 Roles dentro de la empresa (`backend/app/core/rbac.py`)
| Rol | Puede |
|---|---|
| reader (Lector) | ver colecciones/ediciones/páginas |
| reviewer (Revisor) | igual que lector (reservado para comentarios/aprobación) |
| editor | + crear/editar/importar ediciones, páginas, assets, locks, mover ediciones |
| admin | + publicar/despublicar/visibilidad, borrar ediciones, CRUD colecciones, gestionar equipo (editor/revisor/lector) |
| owner (Propietario) | + gestionar administradores |

Uso: `current_user: User = Depends(require_role("editor"))`. Todo endpoint nuevo de escritura DEBE llevarlo.
El frontend oculta botones con `services/permissions.js` (`can(user, 'admin')`), pero la autoridad es el backend.

### 4.3 Aislamiento en base de datos
FK compuesta `publications(collection_id, tenant_id) → collections(id, tenant_id)`: imposible que una edición cuelgue de una colección de otra empresa.
Cada empresa nace con colección `General` (`is_default`, trigger `tenant_default_collection`).

### 4.4 Usuarios e invitaciones
- Un usuario pertenece a **una sola empresa** (`users.tenant_id`). No se reutilizan emails entre empresas (409).
- Registro abierto `/api/auth/register` **cerrado** (404). Altas solo por invitación:
  Super Admin → propietario (`/api/superadmin/tenants/{id}/owner-invitations`); propietario/admin → equipo (`/api/team/invitations`).
- Aceptación: `POST /api/superadmin/invitations/accept` (pública, token de un solo uso, 7 días) — **nunca** cambia la contraseña de una cuenta ya activa.
- Sin SMTP aún: la API devuelve el token y el panel muestra el enlace `/aceptar-invitacion?token=…` para enviarlo por canal seguro.
- Asientos: `/api/team` respeta `limits_snapshot.max_seats` de la suscripción (activos + invitados).

## 5. Mapa de API (prefijo `/api`)

| Área | Endpoints |
|---|---|
| Auth | `POST /auth/login` (form), `GET /auth/me` (incluye `tenant_id`, `tenant_name`, `tenant_role`, `is_superadmin`, `acting_as_tenant`), `POST /auth/password-reset/confirm` |
| Colecciones | `GET /categories`; `GET/POST /collections`; `GET/PUT/DELETE /collections/{id}` (DELETE 409 si tiene ediciones o es la por defecto) |
| Ediciones | `GET /publications?collection_id=&limit≤200`, `POST /publications` (`collection_id`, `edition_label`), `POST /publications/import-pdf` (form: file,title,description,collection_id), `GET/PUT/DELETE /publications/{id}`, `POST /publications/{id}/move`, `/publish`, `/unpublish`, `PUT /visibility`, `GET /versions`, `GET /publications/stats/summary` |
| Páginas | `GET /pages/publications/{id}/pages`, `POST /pages/publications/{id}/pages/insert`, `GET/PUT /pages/{id}`, `GET/PUT /pages/{id}/elements` (concurrencia optimista por `version`) |
| Locks | `POST/PUT heartbeat/DELETE /publications/{id}/lock` |
| Assets | `POST /upload`, `GET /list`, `GET /serve/{object}` (público, proxy MinIO) |
| Equipo | `GET /team/members`, `POST /team/invitations`, `POST /team/members/{id}/resend`, `PATCH /team/members/{id}`, `DELETE /team/members/{id}` |
| Público (sin auth) | `GET /public/publications` (catálogo), `/public/publications/{id}`, `/public/publications/{id}/pages` (snapshot), `/public/og/{id}` (HTML Open Graph para bots) |
| Super Admin | `/superadmin/overview`, tenants (alta, plan, estado), memberships, invitaciones owner, reset de contraseña asistido, `GET/POST/PATCH /superadmin/categories` |

## 6. Mapa de frontend (`frontend/src`)

| Ruta | Componente | Notas |
|---|---|---|
| `/` | `pages/LandingPage.jsx` | landing B2B + catálogo público |
| `/leer/:id` | `pages/PublicReader.jsx` | responsive (página a página en móvil), flip 3D + sonido, zoom, pantalla completa, swipe/teclado |
| `/login`, `/aceptar-invitacion`, `/restablecer-contrasena` | páginas públicas | |
| `/dashboard` | `pages/Dashboard.jsx` | |
| `/collections` | `pages/Collections.jsx` | tarjetas de colección |
| `/collections/:collectionId` | `pages/Publications.jsx` | ediciones de la colección: crear/importar, editar (lápiz), Edición, Mover, Compartir, QR, publicar |
| `/team` | `pages/Team.jsx` | admin+ |
| `/superadmin` | `pages/SuperAdmin.jsx` | |
| `/publications/:id/view` | `components/editor/PageViewer.jsx` | visor interno |
| `/publications/:id/edit/:pageId?` | `components/editor/CanvasEditorV2.jsx` | editor (Konva) |
| `/publications` | redirige a `/collections` | |

Servicios: `services/api.js` (axios + token + `X-Tenant-Id`), `services/tenantContext.js` (selector de empresa del Super Admin, también en axios global), `services/permissions.js`, `services/collectionAPI.js`, `services/publicationAPI.js`. Compartir/QR: `components/share/*` (dependencia `qrcode`).

## 7. nginx DEV (Contabo 1, `/etc/nginx/sites-available/dev-revistas.cetrix.com.mx`)
- 80: ACME webroot `/var/www/letsencrypt` + redirect. Cert Let's Encrypt (renovación por webroot).
- 443: allowlist + basic auth; `location ~ ^/(api/|health$|docs|redoc|openapi\.json)` → 8010 con `auth_basic off`; `location ~ "^/leer/(?<revista_id>…)$"` → a `/api/public/og/$revista_id` si `$revistas_og_bot` (map de user-agents de WhatsApp/Facebook/X/Telegram/LinkedIn…); resto → Vite 5173 con WebSocket (HMR).
- **Producción**: replicar el map OG (snippet en RECETA 11b), sin basic auth ni allowlist, frontend construido (no Vite dev).

## 8. Verificación (obligatoria antes de dar algo por hecho)
- `backend/tests/qa_lote_c_tenant_isolation.py` — aislamiento entre empresas (26 PASS, re-ejecutable).
- `backend/tests/qa_lote_c2_rbac_team.py` — roles y equipo (40 PASS).
  Ejecutar dentro del backend: `docker cp backend/tests/X.py flipbook-dev-backend:/tmp/q.py && docker exec flipbook-dev-backend python /tmp/q.py`.
- E2E visual: Puppeteer (`puppeteer-core` + `/usr/bin/chromium` en raspi-2, desde IP 85.86.x) con token en `localStorage`. Chromium headless tiene ancho mínimo 500 px.
- Empresa de pruebas: **Empresa Demo** (`empresa-demo`) con owner/admin/editor/lector `*.demo@example.com` (claves en `/tmp/demo_users.txt` del contenedor backend y en `/tmp/demo_owner_pw`; regenerables con los scripts).

## 9. Hallazgos de seguridad ya corregidos (no reintroducir)
1. `/api/auth/register` creaba editores dentro del tenant `default` de CETRIX → cerrado.
2. Invitación a un email ya activo podía **cambiar su contraseña** (secuestro de cuenta) → bloqueado en accept + invitaciones.
3. Todo filtrado por `effective_tenant_id`; cabecera `X-Tenant-Id` solo para Super Admin.
4. Redirecciones 307 salían con `http://` detrás de nginx → `--proxy-headers`.

## 10. Backlog priorizado (siguiente trabajo)
| Lote | Contenido |
|---|---|
| **D — Dominios propios** | diseño en `docs/dominios-propios.md` (tabla `tenant_domains` ya existe) |
| **A — Ajustes de edición** | ventana con pestañas Info (edición, palabras clave, categoría secundaria, permitir descarga/impresión, adulto), Visor (efecto on/off, fondos/texturas), SEO; Clonar; código iframe `/embed/:id` |
| **B — PDF** | descarga del PDF original/subido con interruptor por edición; papelera 30 días |
| **Kiosco** | landing/catálogo agrupado por colección y filtrado por categoría; URLs amigables `/c/{slug}/{edicion}` |
| **Estadísticas** | eventos sin cookies (IP anonimizada, RGPD): aperturas, páginas vistas, tiempo, dispositivo, país, origen `?src=qr|wa|embed`; `views_count` hoy nunca se incrementa |
| **SEO/OG** | imagen OG 1200×630 < 300 KB generada al publicar |
| **UI Super Admin** | pantalla de categorías (API lista) |
| **SMTP** | envío real de invitaciones/restablecimientos (Resend ya usado por manten.io) |
| **F** | PDF generado desde el editor (worker en Contabo 2), IA de metadatos con Ollama local |
| **M — Mesa de trabajo** | Solo exploración (04-oct-2026): material fuera de la hoja y arrastre entre hojas, estilo InDesign. Fases M1–M3, 5–7 días. `docs/exploracion-mesa-de-trabajo.md` |

Decisiones de Carlos vigentes: Colección → Ediciones; categorías = lista común; paleta navy + dorado; orientación/tamaño no editables tras crear; curl realista de página pendiente de elegir opción (RECETA 9p).

## Actualización 27-sep-2026 — plan L1–L10 (Cetrix Revistas)

Decisiones de Carlos: nombre único **Cetrix Revistas**; trabajo **por lotes en staging (dev-revistas) y luego producción** con su aprobación; correo con **Resend** (como manten.io).

| Lote | Estado |
|---|---|
| L1 Marca + favicon | Hecho (`dca418a`) |
| L2 Pulido (Dashboard real, lazy routes, fuera editor v1, sin emojis) | Hecho (`ab50fb7`, `99839a2`) |
| L3 Kiosco + URLs amigables `/r/{empresa}/{coleccion}/{edicion}` | Hecho en DEV (`008be6a`, migración 0009) — ver RECETA §13 |
| L4 Ajustes de edición (Info/Visor/SEO, clonar, iframe) | **En PRODUCCIÓN** 28-sep-2026 (`dd2f693`, `a3578f1`, `c32eeb2`, migración 0010) — ver RECETA §16 |
| Guía | Alta y operación de clientes (Super Admin, correo, kiosco) | ver `docs/OPERACION-CLIENTES.md` |
| ED-1 Hotspots visibles en editor + copiar/cortar/pegar/duplicar elementos | **En PRODUCCIÓN** 29-sep-2026 (`6840d31`, `42389e5`, solo frontend) — ver RECETA §18 |
| L9 Correo SMTP (IONOS) + recuperar contraseña + fixes Super Admin | **En PRODUCCIÓN** 29-sep-2026 (`e659af6`…`bc28e82`) — ver RECETA §19 |
| L5 Descarga PDF por edición + papelera 30 días | ✅ PRODUCCIÓN 03-oct-2026 (RECETA §20 y §20.1) |
| L6 Estadísticas sin cookies + `views_count` | Pendiente |
| L7 Imagen OG 1200x630 · L8 UI categorías Super Admin | Pendiente |
| L9 Resend (invitaciones/reset) | Descartado: se usa SMTP IONOS (L9) |
| Editorial (capas, acciones, párrafos) — Codex | ✅ PRODUCCIÓN 03-oct-2026 (RECETA §21) |
| Lector público responsive (barra lateral) — Codex | ✅ PRODUCCIÓN 04-oct-2026 (RECETA §22) |
| S1 Enlace corto `/s/{código}` | ✅ PRODUCCIÓN 04-oct-2026 (RECETA §23) |
| F1 Motor de render aislado en Contabo 2 (`wg-flipbook`) | ✅ PRODUCCIÓN 04-oct-2026 (RECETA §24) |
| F Exportar PDF desde el panel (enlaces clicables) | ✅ PRODUCCIÓN 04-oct-2026 (RECETA §25) |
| EQ-1 «Mi cuenta» (cambiar contraseña) + versión de sesión (cierre inmediato de sesiones) | ✅ PRODUCCIÓN 04-oct-2026 (RECETA §27) — QA firma tokens con `token_with_current_version` |
| L10 Producción revistas.cetrix.com.mx | **En marcha desde 27-sep-2026** con L1–L3 (`3fa9e37`), copia completa de DEV. Los lotes siguientes se suben con el procedimiento de RECETA §14 |

## Siguiente sesión (desde 28-sep-2026)
Plan detallado y listo para implementar de L5, L7a (miniaturas + OG), estantería pública, PDF→hotspots, L6, L8, L9 y la web comercial: **`docs/PLAN-SIGUIENTES-LOTES.md`** (orden recomendado, decisiones pendientes de Carlos, migraciones 0011-0013 propuestas, API, frontend, QA y criterios de aceptación).


## Estado para el equipo (04-oct-2026)
Resumen no técnico y actualizado del proyecto (funcionalidades, lotes, arquitectura, seguridad, operación, clientes, backlog): Claude Doc **«Cetrix Revistas — Estado del proyecto»** https://claude.ai/code/artifact/95dda6b1-4f56-40e6-8bb2-ef006901d664 — actualizarlo al cerrar cada lote.

## Mantenimiento automático
Temporizadores semanales `flipbook-housekeeping` (Contabo 1) y `flipbook-worker-housekeeping` (Contabo 2): rollbacks antiguos, caché Docker, copias viejas de BD/.env, logs temporales. RECETA §26 y `ops/housekeeping/`.
| SEC-1 | Endurecimiento login: rate-limit nginx + bloqueo por cuenta (Redis) + fix timing enumeración + TLS1.2/1.3 + CSP | PROD 07-oct | img rollback-pre-sec1 / nginx *.pre-sec1-* |
| SEC-2 | JWT en cookie HttpOnly (fuera localStorage) + POST /logout + CSP script-src self | PROD 07-oct | img rollback-pre-sec2 (backend+frontend) / dump pre-sec2 |
| VID-1 | Fotograma real del vídeo en el editor (contain sobre negro, igual que el lector) + aviso de proporción en el panel (RECETA §30) | PROD 09-oct | img flipbook-prod-frontend:rollback-pre-vid1 |
