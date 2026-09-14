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

## 4b. Cómo desplegar/migrar este proyecto a un servidor nuevo (receta para cualquier agente de IA -- Claude, Codex, Antigravity, Arnes Agent, etc.)

Esta sección existe para que CUALQUIER agente de IA, sin contexto previo
de esta conversación, pueda levantar una copia de este proyecto en un
servidor distinto (otro VPS, otro entorno de pruebas, o producción el día
que exista) sin adivinar nada. El proyecto está diseñado deliberadamente
para que esto sea "copiar una carpeta + un archivo de variables", no una
instalación manual pieza por pieza -- ver también la sección 4 (reglas de
infraestructura) y el encabezado de `docker-compose.dev.yml`.

### Requisitos del servidor destino

- Linux (Ubuntu 22.04/24.04 LTS o Debian 12 recomendado).
- **Docker Engine + el plugin `docker compose`** (el comando es
  `docker compose ...`, NO el binario viejo `docker-compose` standalone).
  Esto es la ÚNICA dependencia de sistema real -- todo lo demás (Python,
  Node, Postgres, Redis, MinIO, y las librerías de sistema que necesita
  el backend como `poppler-utils`/`libpango` para generación de PDF) vive
  dentro de las imágenes de los contenedores y se instala solo al hacer
  `docker compose build`/`up`. NO instalar Python/Node/Postgres/Redis a
  mano en el host -- no hace falta y rompe la portabilidad del diseño.
- Git.
- Tamaño mínimo razonable para esta etapa (proyecto en desarrollo, sin
  carga real de tenants todavía): 2 vCPU / 4 GB RAM / 40-60 GB disco SSD.
  El disco es lo único que puede crecer con el tiempo (los assets subidos
  por los tenants -- imágenes/audio/video -- se guardan en MinIO, dentro
  de `data/minio/`).
- Si el servidor va a quedar en red privada (como ia-lavatur): cliente
  `tailscale` instalado y unido al mismo tailnet.
- Si el servidor va a tener IP pública/dominio propio (escenario NO usado
  todavía en este proyecto): además hace falta un reverse proxy con TLS
  (nginx o Caddy) delante de los puertos publicados -- hoy no existe
  ningún proxy de este tipo en el stack porque ia-lavatur solo se usa por
  Tailscale.

### Qué mover desde el servidor origen

1. **El repositorio completo** -- preferir `git clone` de la rama
   correspondiente (`redesign/editor-v2` a la fecha de este documento) en
   el servidor nuevo, en vez de copiar archivos a mano: trae el historial
   completo y evita arrastrar basura (`node_modules`, `__pycache__`, etc.,
   ya cubiertos por `.gitignore`).
2. **La carpeta `data/`** (`data/postgres`, `data/redis`, `data/minio`) --
   AQUÍ VIVEN LOS DATOS REALES (la base de datos completa y los archivos
   subidos por los tenants). NO está en git a propósito (son datos, no
   código). Copiar con `rsync -av` o `tar` + `scp`, y SIEMPRE con los
   contenedores origen DETENIDOS (`docker compose stop`) antes de copiar
   `data/postgres` -- copiar Postgres con el proceso corriendo puede
   producir un backup corrupto/inconsistente.
3. **El archivo `.env` real** -- tampoco está en git (solo existe
   `.env.example` como plantilla documentada, con explicación de cada
   variable). Hay que crear un `.env` nuevo en el servidor destino
   copiando `.env.example` y rellenando con: credenciales reales
   (Postgres/MinIO/JWT -- generar nuevas, no reutilizar las del servidor
   origen si el destino no es una réplica de confianza equivalente), y
   sobre todo actualizar `API_PORT`, `FRONTEND_PORT`, `CORS_ORIGINS` y
   `VITE_API_URL` para que apunten a la IP/dominio del SERVIDOR NUEVO
   (nunca dejar la IP de Tailscale del servidor origen, ni usar
   `localhost` -- el navegador del usuario no corre en el servidor).

### Pasos de despliegue (servidor destino)

```bash
# 1. Dependencias de sistema (una sola vez)
curl -fsSL https://get.docker.com | sh   # o el método oficial de Docker para la distro
sudo usermod -aG docker $USER            # cerrar sesión/reconectar para que aplique
sudo apt-get install -y git

# 2. Clonar el repo
git clone <url-del-repo> flipbook-saas
cd flipbook-saas
git checkout redesign/editor-v2   # o la rama que corresponda en ese momento

# 3. Traer los datos y el .env desde el servidor origen (con los
#    contenedores origen detenidos antes del paso de datos)
rsync -av origen:/ruta/al/proyecto/data/ ./data/
cp .env.example .env
nano .env   # rellenar credenciales + IP/dominio/puertos del servidor NUEVO

# 4. Levantar el stack (primera vez en este servidor -- SÍ corresponde
#    `up`/`build` normal aquí, a diferencia de un restart de un stack ya
#    corriendo en el MISMO servidor, ver advertencia de la sección 4/9)
docker compose -f docker-compose.dev.yml up -d --build

# 5. Verificar
docker ps --format '{{.Names}}	{{.Status}}'
docker inspect flipbook-dev-backend --format '{{json .Mounts}}'   # confirmar bind-mounts correctos
curl http://<ip-o-dominio>:<API_PORT>/health
```

### Qué NO hace falta instalar a mano

`backend/requirements.txt` (FastAPI, SQLAlchemy, Pillow, WeasyPrint,
python-jose, etc.) se instala solo al construir la imagen del backend
(`docker compose build` ejecuta el `Dockerfile`, que ya incluye
`apt-get install poppler-utils libpango-1.0-0 libpangoft2-1.0-0` -- las
dependencias de sistema que necesita `pdf2image`/`weasyprint`). El
frontend (React + Vite + Konva + Zustand, ver `frontend/package.json`) se
instala solo al arrancar el contenedor `frontend`
(`npm install && npm run dev`, ver el `command:` del servicio en
`docker-compose.dev.yml`). Ningún agente de IA debe intentar `pip install`
o `npm install` en el host -- todo corre dentro de los contenedores.

### Si el destino es PRODUCCIÓN real (no otro entorno de pruebas)

`docker-compose.dev.yml` es justamente eso, de DESARROLLO: `DEBUG=True`,
`uvicorn --reload` (recarga en caliente, no apto para producción),
credenciales pensadas para ser rotadas fácilmente. Antes de usar esto
como base de producción real (con tenants/datos reales), hace falta un
lote aparte, no implementado todavía a la fecha de este documento:
- Un `docker-compose.prod.yml` separado sin `--reload`/`DEBUG=True`, con
  un proceso de arranque de producción (p.ej. `uvicorn` sin `--reload`,
  o `gunicorn` con workers uvicorn).
- Secretos rotados y gestionados fuera del repo (nunca reutilizar los
  valores de ejemplo ni los de un entorno de pruebas).
- Backups automáticos y probados de `data/postgres` (y de `data/minio` si
  el volumen de assets lo justifica).
- Reverse proxy con TLS real si el servidor tiene IP pública/dominio.
- Revisar la sección 11 de `docs/arquitectura-editor-2026-09-12.md`
  (aislamiento de Contabo 2 para cómputo pesado de imagen/video) antes de
  asumir que todo corre en una sola máquina.

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

Pendientes (próximos lotes, no bloquean lo ya entregado):
Library + Blocks (Lote 7). YouTube/Vimeo se completaron en el Lote 5 (ver
sección 9c) y SoundCloud + Quick Actions en el Lote 6 (ver sección 9d).

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

## 9c. Lote 5 -- YouTube/Vimeo (embeds de video) (12-sep-2026)

Nuevo `PageElementKind.embed` (`props = {provider, video_id, url}`) para
insertar videos de YouTube y Vimeo desde el rail de herramientas. Konva no
puede reproducir un iframe real dentro del canvas -- se sigue el mismo
patrón que `AudioElement` (Lote 3): el elemento se representa con un
placeholder (`Konva.Group` con fondo + icono del proveedor + etiqueta),
arrastrable/seleccionable/transformable como cualquier otro elemento. La
reproducción real vía iframe queda diferida al Reader (Fase E), tal como
estaba planificado desde el inicio (ver sección 6 de
`docs/arquitectura-editor-2026-09-12.md`).

**`parseVideoUrl(url)`** (función pura, exportada desde
`CanvasEditorV2.jsx`, sin dependencias de React): reconoce los formatos
comunes de YouTube (`watch?v=`, `youtu.be/`, `/embed/`, `/shorts/`) y Vimeo
(`vimeo.com/`, `player.vimeo.com/video/`) y devuelve `{provider,
video_id}`, o `null` si no reconoce el formato. Se guardan tanto el
`video_id` extraído como la `url` original pegada por el usuario, para que
un futuro embed real en el Reader no tenga que volver a parsear nada.

**UI de inserción**: este proyecto no usa `window.prompt`/diálogos nativos
para insertar contenido (la única excepción, deuda anterior sin tocar en
este lote, es la edición simplificada de `TextElement`) -- se implementó un
popover propio (`.editor-v2-embed-menu`, mismo lenguaje visual que
`.editor-v2-plugins-menu` del Lote 2) con un `<input type="text">` para
pegar la URL y un botón "Insertar". Una URL no reconocida muestra un error
inline (`.editor-v2-embed-error`) sin crear ningún elemento -- nunca un
`alert()`.

**Decisión de diseño (no fijada explícitamente por el encargo, resuelta con
criterio)**: los botones de rail "YouTube" y "Vimeo" abren el MISMO
popover; el proveedor que se guarda es siempre el que `parseVideoUrl()`
detecta en la URL pegada, **no** el botón que se usó para abrirlo. Si
Carlos pega por error una URL de Vimeo tras abrir el popover de "YouTube",
se inserta igual como Vimeo -- rechazar una URL válida solo porque no
coincide con el botón clicado parecía peor experiencia que simplemente
usar el proveedor real detectado. El error inline solo aparece cuando el
formato no se reconoce para NINGÚN proveedor. Si Carlos prefiere el
comportamiento estricto (rechazar si no coincide con el botón), es un
cambio acotado a `handleInsertEmbed()`.

**Panel de propiedades**: sección "YouTube"/"Vimeo" (según
`props.provider`) con un enlace clicable (`<a target="_blank">`) a la URL
original -- sustituye a una vista previa real, ya que Konva no puede
embeber el iframe ahí, y un `<iframe>` HTML suelto en el panel se evitó
deliberadamente por el riesgo de CSP/mixed-content en ia-lavatur (HTTP, no
HTTPS) -- y `video_id` de solo lectura para depuración.

**Bug real preexistente encontrado y corregido de paso**: el
`CheckConstraint` declarado en el modelo Python de SQLAlchemy
(`backend/app/models/page_element.py`) se había quedado sin `'gallery'`
desde el Lote 4 -- el CHECK real en la base de datos sí lo tenía (se
administra aparte, con migraciones SQL crudas, nunca con
`metadata.create_all`), así que esto nunca causó un fallo real, pero era
una inconsistencia de documentación-como-código que podía confundir a
quien leyera el modelo. Corregido junto con el `embed` de este lote.

**Backend**: `PageElementKind.embed` en schemas y modelo, migración
`0003_lote5_embed_kind.sql` (`ALTER TABLE ... DROP/ADD CONSTRAINT`) para
bases existentes + `0001_editor_v2.sql` actualizado para bases nuevas,
aplicada también contra la base real de ia-lavatur.

**Verificación**: nuevo `frontend/tests/verify_lote5_embed.js` cubre
insertar YouTube (`youtu.be/XXXX`), insertar Vimeo (`vimeo.com/XXXXXXXX`),
URL inválida (error inline, cero elementos creados), panel de propiedades
(enlace/provider correctos para ambos) y persistencia tras
guardar+recargar. Los 6 scripts de regresión existentes
(`e2e_editor_v2_regression.js`, `verify_lote1.js`,
`verify_lote2_shortcodes.js`, `verify_lote3_audio.js`,
`verify_lote4_gallery.js`, `verify_spread_view.js`) se re-ejecutaron uno
por uno tras el cambio: **todos pasan limpio, sin errores de consola, sin
regresiones**.

## 9d. Lote 6 -- SoundCloud + Quick Actions (12-sep-2026)

**SoundCloud**: se modeló como un tercer `provider` (`'soundcloud'`) dentro
del `kind='embed'` ya existente (Lote 5) -- NO se agregó un
`PageElementKind` nuevo. Decisión de diseño y por qué: conceptualmente
SoundCloud es lo mismo que YouTube/Vimeo desde la perspectiva del editor
(el usuario pega una URL externa, no hay archivo que subir, Konva no puede
reproducirlo, se ve como un placeholder con icono+etiqueta y el panel de
propiedades muestra un enlace clicable) -- reutilizar `EmbedElement`, el
popover de pegar URL (ahora `renderEmbedPopover()`, extraído de la
duplicación YouTube/Vimeo del Lote 5 a una sola función ya que el
contenido es idéntico para los 3 proveedores) y la sección del panel de
propiedades evita otra migración de `CHECK CONSTRAINT` en Postgres, ya que
`provider` vive libremente dentro de `props` (JSONB) sin tocar el modelo,
el schema Pydantic ni el enum `PageElementKind`.

`parseVideoUrl()` ahora también reconoce `soundcloud.com`/
`m.soundcloud.com`. A diferencia de YouTube/Vimeo, SoundCloud no tiene un
`video_id` numérico simple -- su iframe de embed real
(`w.soundcloud.com/player/?url=...`) solo necesita la URL completa. En vez
de dejar `video_id` vacío para este proveedor, se guarda ahí la ruta
`"usuario/track-slug"` (o `"usuario/sets/playlist-slug"`) extraída de la
URL -- sigue siendo un dato útil (identifica el track sin volver a
parsear la URL completa) y reutiliza el mismo campo del panel de
propiedades sin agregar uno nuevo solo para este proveedor. Como
validación mínima de formato (SoundCloud no tiene nada tan verificable
como el id numérico de Vimeo o el patrón alfanumérico de YouTube) se
exige al menos 2 segmentos de ruta -- rechaza un campo vacío y un enlace
de perfil suelto (`soundcloud.com/usuario`, sin track), pero acepta
cualquier otra URL de ese dominio con esa forma.

**Quick Actions -- "Configuración del elemento"**: deja de ser placeholder.
Al hacer clic se expande un panel inline (`.editor-v2-element-settings`,
mismo lenguaje visual del resto del panel de propiedades -- se prefirió
esto sobre un popover flotante o un modal centrado por simplicidad y para
no introducir problemas de posicionamiento/z-index en un panel que ya vive
en un contenedor angosto y con scroll) con:
- **Nombre del elemento** (`props.element_name`) -- se guarda dentro de
  `props` como cualquier otro campo, sin tocar el esquema de BD (deliberado,
  para minimizar invasividad); el header del panel de propiedades lo
  refleja entre paréntesis cuando está seleccionado un único elemento con
  nombre. Útil de cara al Lote 7 (Library/Blocks) para identificar
  elementos en una lista.
- **Bloquear elemento** (`props.locked: boolean`) -- funcionalidad REAL,
  no solo una bandera decorativa: `draggable` se condiciona en TODOS los
  componentes de elemento (`ImageElement`, `AudioElement`, `GalleryElement`,
  `EmbedElement`, `TextElement`, y el objeto `common` de `ShapeElement`) a
  `canEdit && !el.props?.locked`. Además, el `useEffect` de `PageCanvas`
  que calcula qué nodos recibe el `Transformer` excluye deliberadamente los
  elementos bloqueados de esa lista -- sin esto, aunque `draggable={false}`
  ya impediría arrastrarlo, sus asas de redimensionar/rotar seguirían
  funcionando si estuviera seleccionado junto con otros elementos
  desbloqueados. El elemento bloqueado SIGUE siendo seleccionable (para
  poder desbloquearlo desde el mismo panel). Cuando `props.locked` es
  `undefined` (elemento creado antes de este lote, o simplemente nunca
  tocado) se comporta como no bloqueado -- `!undefined === true` -- así que
  no hay ninguna migración de datos necesaria ni riesgo de romper
  elementos ya existentes.
- **Ocultar en el Reader** (`props.hidden_in_reader: boolean`) -- por ahora
  solo se guarda en `props`; no hay Reader real todavía que la respete
  (Fase E), pero dejar la bandera lista es de bajo costo y evitará otra
  migración de datos cuando el Reader exista.

**Quick Actions -- "Animar"**: pasa de botón deshabilitado a un `<select>`
real dentro de la propia sección Quick Actions (no un popover separado,
es un único campo) con opciones `Ninguna` (default) / `Aparecer (fade)` /
`Deslizar desde abajo` / `Deslizar desde la izquierda` / `Zoom`, que
guarda la elección en `props.animation`. **NO implementa la animación
real** -- eso es explícitamente Fase E, cuando exista el Reader que pueda
reproducirla -- documentado con un comentario en el código, mismo
criterio que otras "limitaciones conocidas" ya presentes en el archivo
(GIF/Konva del Lote 4, iframe de embeds del Lote 5).

**"Guardar como bloque de plantilla"** sigue como placeholder -- es
trabajo del Lote 7 (Library/Blocks), fuera de alcance de este lote.

**Sin cambios de backend/BD**: `props` es JSONB de forma libre, así que
ni `element_name`/`locked`/`hidden_in_reader`/`animation` ni
`provider='soundcloud'` requirieron tocar el modelo SQLAlchemy, el schema
Pydantic ni el `CHECK CONSTRAINT` de `page_elements` -- únicamente se
actualizó el comentario de documentación en
`backend/app/schemas/page_element.py` para reflejar el nuevo provider.
Esto es diferente de los Lotes 4/5, que sí necesitaron una migración SQL
nueva por agregar un `PageElementKind` a nivel de columna/CHECK.

**Verificación**: nuevo `frontend/tests/verify_lote6_soundcloud_quickactions.js`
cubre insertar SoundCloud con URL válida (kind/provider/video_id/url +
enlace en el panel), rechazo de campo vacío y de un enlace de perfil
suelto, Quick Actions completo sobre un rectángulo (nombrar, bloquear con
verificación REAL de arrastre de mouse en ambos sentidos -- incluyendo que
`props.locked` `undefined` se comporta como no bloqueado por defecto --,
que el elemento bloqueado siga siendo seleccionable, ocultar en el
Reader, cambiar Animar) y persistencia de todo tras guardar+recargar. Los
7 scripts de regresión existentes (`e2e_editor_v2_regression.js`,
`verify_lote1.js`, `verify_lote2_shortcodes.js`, `verify_lote3_audio.js`,
`verify_lote4_gallery.js`, `verify_spread_view.js`, `verify_lote5_embed.js`)
se re-ejecutaron uno por uno tras el cambio: **todos pasan limpio, sin
errores de consola, sin regresiones** -- en particular, el drag por
defecto de elementos sin `props.locked` (Lote 1, spread view) sigue
funcionando exactamente igual que antes.

## 9e. Lote 7 -- Library (biblioteca de assets por tenant) + subida de video real (13-sep-2026)

Carlos amplio explicitamente el alcance de este lote antes de empezarlo:
"para el video tambien habria que considerar el tener una biblioteca que
se va creando desde el ordenador, lo cual implica toda la logica de
almacenamiento por tenant, porque muchos videos, audios, gif e imagenes se
pueden reciclar en un mismo tenant". Preguntado explicitamente (AskUserQuestion)
si el video debia soportar SOLO reutilizacion de enlaces de YouTube/Vimeo
o TAMBIEN subida de archivo real, eligio **"Tambien permitir subir video
real"** -- decision vinculante, ya implementada.

**Backend -- catalogar cada subida en `assets`** (`backend/app/api/assets.py`):
la tabla `assets` (modelo `backend/app/models/asset.py`) ya existia desde
antes (tenant-scoped: `tenant_id`, `kind`, `storage_key`, `mime_type`,
`size_bytes`, `created_by`, `created_at`) pero `POST /api/assets/upload`
nunca escribia una fila ahi -- solo subia el binario a MinIO. Se agrego el
`INSERT` (via SQLAlchemy `Asset(...)`) inmediatamente despues de la subida
exitosa a MinIO, para las 3 categorias (imagen/audio/video). `width_px`,
`height_px` y `duration_seconds` quedan en `None` por ahora -- extraer
metadatos del archivo es una mejora futura opcional, no bloqueante.

**Backend -- soporte de subida de VIDEO real**: `upload_asset()` ahora
acepta `video/mp4`, `video/webm` y `video/quicktime`, validados contra un
nuevo `MAX_VIDEO_SIZE` (100MB, `backend/app/config.py`) -- mismo patron
que `MAX_IMAGE_SIZE`/`MAX_AUDIO_SIZE`, nunca se valida el tamano de un
tipo contra el limite de otro. La tabla `page_elements` YA permitia
`kind='video'` en su `CHECK CONSTRAINT` desde la Fase A (nunca se habia
usado) -- este lote NO necesito ninguna migracion SQL nueva, a diferencia
de los Lotes 4 y 5.

**Backend -- nuevo `GET /api/assets`** (`?kind=image|video|audio`
opcional): biblioteca de assets del TENANT del usuario autenticado (no
solo del usuario, a diferencia del legado `GET /api/assets/list` que lista
objetos de MinIO por usuario desde el editor v1) -- cualquier asset subido
por cualquier usuario del mismo tenant puede reciclarse. Sin paginacion en
este MVP (limite fijo de 100, mas reciente primero); si el volumen crece
lo suficiente para que haga falta, se agrega cursor/paginacion despues.

**Frontend -- boton "Video" en el rail**: sube un archivo real via
`assetAPI.upload()` con validacion de tipo del lado cliente (mismo patron
que Audio/GIF -- alert claro, sin llamar a la API, si el archivo no es un
tipo de video reconocido) y crea `kind='video'` con
`props={src, autoplay: false, loop: false, muted: false}`.

**Frontend -- `VideoElement`**: placeholder en el canvas (`Group` con
icono + etiqueta), mismo criterio que `AudioElement`/`EmbedElement` --
Konva no puede reproducir video de forma confiable entre navegadores, la
reproduccion real queda para el Reader (Fase E).

**Frontend -- panel de propiedades, seccion "Video"**: `<video controls>`
nativo (vista previa de ESCUCHA/VISTA para validar el archivo subido, no
la reproduccion real del Reader) + 3 checkboxes (autoplay/loop/muted) que
escriben en `props`.

**Frontend -- "Library" (el corazon de este lote)**: el boton de rail deja
de ser placeholder. Popover (`.editor-v2-library-menu`) que consulta
`GET /api/assets`, con pestanas de filtro por tipo (Todos/Imagen/Video/
Audio), miniaturas reales para imagenes y icono+etiqueta para audio/video,
y al hacer click INSERTA el elemento correspondiente reutilizando la URL
ya existente -- **sin volver a llamar a `/api/assets/upload`**. Inserta
siempre en la pagina ENFOCADA del spread (mismo `focusedSide`/store hook
que usa el resto del rail desde la ronda 11), para respetar la arquitectura
de dos stores independientes del spread.

**Fuera de alcance, deliberado**: "Blocks" (guardar/reutilizar un bloque de
plantilla con uno o varios elementos) sigue como placeholder sin cambios
-- Carlos definio el alcance de este lote solo para Library de assets
(imagen/audio/video/GIF), no para plantillas de pagina. Queda como lote
futuro si lo pide.

**Verificacion**: nuevo `frontend/tests/verify_lote7_library_video.js`
(Playwright real contra ia-lavatur) cubre: rechazo de tipo invalido en el
boton Video (alert, sin llamar a la API), subida real de un webm VP8
decodificable (fixture generado con el ffmpeg bundleado de Playwright,
ver comentario en el propio script), Library mostrando imagen+video
recien subidos, insercion desde la Library reutilizando la URL sin
resubir, filtro por tipo, panel de propiedades del elemento video, y
persistencia de todo tras guardar+recargar. Los 9 scripts de regresion
existentes (`e2e_editor_v2_regression.js`, `verify_lote1*.js`,
`verify_lote2_shortcodes.js`, `verify_lote3_audio.js`,
`verify_lote4_gallery.js`, `verify_spread_view.js`, `verify_lote5_embed.js`,
`verify_lote6_soundcloud_quickactions.js`) se re-ejecutaron uno por uno
(nunca en paralelo, mismo criterio de siempre por la contencion del lock
de edicion): **todos pasan limpio, sin errores de consola, sin
regresiones**.

**No se encontraron bugs reales en este lote** -- `page_elements` ya
permitia `kind='video'` desde la Fase A, asi que no hubo sorpresas de
`CHECK CONSTRAINT` como en los Lotes 4/5.

Commits en `redesign/editor-v2` (todos en raspi-2, pusheados): `88b1590`
(feat Lote 7 -- video real + Library), `2d09b7a` (test Lote 7). ia-lavatur
resincronizado con `git pull` (misma limpieza de siempre de copias sin
trackear de scripts/fixtures de test creados directamente ahi durante la
verificacion).

## 9f. Lotes UX-1, UX-3 y UX-3b -- Dashboard real, miniaturas de portada, fit-to-screen y visor con contenido real (13-sep-2026)

Carlos revisó el shell de UI ya funcional con capturas de pantalla reales
y dio feedback puntual (sin pedir cambios de codigo todavia -- primero
"Sin hacer nada lee todo lo que he colocado y dame tus comentarios", luego
confirmo el plan punto por punto). Instruccion final para arrancar:
"arranca y asegurate que funciona bien y me notificas para probar".

**Lote UX-1 -- Dashboard conectado a datos reales**: el Dashboard mostraba
numeros estaticos/de ejemplo, no reflejaba las publicaciones reales del
tenant. Se agrego `GET /api/publications/stats/summary`
(`backend/app/api/publications.py`) con agregados SQL tenant-scoped
(`func.count`, `func.coalesce(func.sum(...), 0)` sobre `Publication` y
`Asset` -- nunca se trae el resultset completo a Python solo para contar/
sumar, patron a reutilizar en cualquier endpoint futuro de este tipo).
`frontend/src/pages/Dashboard.jsx` consume esto via
`publicationAPI.statsSummary()`, con estado de carga (`'...'`) y de error
(`'—'`) explicitos, y un helper `formatBytes()` para el storage usado.
"Plan Actual: Pro" se dejo deliberadamente estatico (comentario en el
codigo) -- no existe todavia sistema de facturacion/planes.

**Lote UX-3 (parte 1) -- Miniaturas reales de portada en "Publicaciones"**:
cada ficha de publicacion ahora muestra la imagen real de su portada (si
existe) en vez de un placeholder generico. Nuevo helper
`_attach_cover_thumbnails()` en `publications.py`: por cada publicacion,
busca su pagina `page_number==1`, toma todos sus `page_elements` de
`kind='image'`, y elige el de **mayor area** (`width*height`) como "foto
principal" -- evita que un logo o icono pequeno le gane a la foto real de
portada. El resultado se asigna como atributo transitorio
(`pub.cover_image_url = ...`) sobre la instancia de SQLAlchemy antes de
serializar -- funciona sin migracion porque `PublicationResponse` usa
`from_attributes = True` (lee via `getattr`), patron reutilizable para
cualquier otro campo "calculado al listar, no almacenado". Si la portada
no tiene imagen, la ficha queda en blanco/gris (`.placeholder-image-empty`
en `Publications.css`) tal como pidio Carlos explicitamente -- nunca un
placeholder generico con icono.

**Lote UX-3 (parte 2) -- Zoom fit-to-screen + visor publico con contenido
real (el hallazgo mas importante de esta ronda)**: Carlos pidio que al
entrar al editor la pagina se vea completa sin necesidad de la barra de
desplazamiento lateral. Se implemento `fitScale` (ResizeObserver sobre
`.editor-v2-canvas-wrap` + `useLayoutEffect`, recalculado en resize y en
cambio de pagina/vista) aplicado **siempre via las props nativas de Konva**
(`Stage` `scaleX`/`scaleY` + `width`/`height` ajustados a
`stageWidthPx * scale`), **nunca con un `transform: scale()` de CSS** --
un transform de CSS rompe el calculo de coordenadas de puntero/clic que
hace Konva internamente. `fitScale` nunca sobre-escala (tope en 1.0, solo
reduce si no cabe). `PageCanvas` se exporto desde `CanvasEditorV2.jsx`
para poder reutilizarse.

Al revisar el punto de Carlos sobre el visor publico ("Ver Páginas"
mostraba "Página vacía" en una portada que SI tenia imagen), se encontro
que **no era un problema cosmetico sino un bug funcional real**:
`PageViewer.jsx` (version vieja) revisaba `page.content` -- un campo JSON
deprecado de la arquitectura original (documentado como deprecated en
`backend/app/models/page.py`), que el editor v2 basado en `page_elements`
JAMAS escribe. Es decir, el visor publico SIEMPRE mostraba "Página vacía"
sin importar el contenido real guardado. Se **reescribio por completo**
`frontend/src/components/editor/PageViewer.jsx` para reutilizar
directamente el renderer real del editor (`PageCanvas` + `computeSpreadViews`,
ambos exportados de `CanvasEditorV2.jsx`) en modo solo-lectura
(`canEdit={false}`), cargando los `page_elements` reales via el mismo
`createPageEditorStore()`/`loadPage()` que usa el editor -- nunca logica
de renderizado duplicada. De paso se reemplazo el footer viejo (barra de
navegacion separada + franja completa de miniaturas, muy alto en pantalla)
por el mismo footer compacto `.editor-v2-pagenav` del editor (con salto de
pagina por numero), y se limpio `PageViewer.css` de reglas muertas.

Carlos tambien referencio 2 capturas de un editor externo (no
flipbook-saas) como inspiracion de layout -- se le aclaro y confirmo
explicitamente que la implementacion debia ser **"parecido, no igual"**
(mismo comportamiento de footer compacto + fit-to-screen), nunca una copia
visual literal, para evitar cualquier reclamo de "copiar" un producto de
terceros.

**Verificacion**: `frontend/tests/verify_lote_ux1_dashboard.js` (Dashboard
vs. stats reales del backend, sin placeholders atascados),
`verify_lote_ux3_thumbnails.js` (miniatura real vs. blanco segun exista o
no imagen de portada -- verificado directo contra el backend con
`GET /api/publications?limit=500` por el volumen acumulado de
publicaciones de prueba en sesiones previas, mas un chequeo suelto sobre
lo que renderiza la vista paginada por defecto), y
`verify_lote_ux3_fit_and_viewer.js` (portada sin scroll vertical al
entrar al editor, visor sin "Página vacía" con contenido real, footer
compacto sin la franja vieja de miniaturas, salto manual de pagina, y
spread interior tambien sin scroll vertical). Se re-ejecutaron ademas
`e2e_editor_v2_regression.js` y `verify_spread_view.js` completos (el
cambio toca `PageCanvas`/`CanvasEditorV2.css`, compartidos por editor y
visor) -- **todos pasan limpio, sin errores de consola, sin regresiones**.

**Hallazgo fuera de alcance (no corregido, solo documentado)**: durante la
verificacion de UX-3 parte 1 se detecto que `GET /api/publications` no
tiene paginacion ni un `ORDER BY` explicito (limite fijo de 20, orden no
garantizado) -- no es un bug bloqueante hoy, pero puede empezar a importar
segun crezca el volumen de publicaciones por tenant. Queda para cuando
Carlos lo priorice.

**Pendiente de este mismo bloque de feedback de Carlos (todavia sin
implementar)**:
- **Lote UX-2** -- paleta/tipografia mas corporativa para "Publicaciones"
  y el resto del shell. Carlos confirmo que hoy no existe paleta de marca
  definida y pidio posicionar el producto como "empresa seria, editorial
  que busca formar mercado digital" -- sin colores especificos dados, asi
  que este lote implica proponer una paleta editorial razonable (no solo
  aplicar valores ya decididos).
- **Lote UX-4** -- extender el redondeo de esquinas (ya existente para
  figuras) a imagenes, mas brillo/contraste via `Konva.Filters.Brighten`/
  `Konva.Filters.Contrast`. Carlos fue explicito: **solo brillo y
  contraste, no un retoque completo**.
- **Lote UX-5** -- orden de capas. Carlos preferiria un panel de capas
  completo estilo Photoshop, pero confirmo que si eso es mucho mas trabajo
  prefiere la version simple: traer al frente / enviar al fondo (y
  idealmente subir/bajar un nivel), reutilizando el campo `z_index` que
  `PageElement` ya tiene desde la Fase A.

Commits en `redesign/editor-v2` (todos en raspi-2, pusheados): `f5dbca3`
(feat Lote UX-1 -- Dashboard real), `55d454a` (test Lote UX-1), `4ab9c6a`
(feat Lote UX-3 parte 1 -- miniaturas de portada), `a50bed2` (test Lote
UX-3 parte 1), `f94f07c` (feat Lote UX-3 parte 2 -- fit-to-screen + visor
real), `25b6129` (test Lote UX-3 parte 2). ia-lavatur resincronizado con
`git pull --ff-only` despues de cada tanda (misma limpieza de siempre de
copias sin trackear de scripts de test creados directamente ahi durante
la verificacion).

## 9g. Lote UX-6 -- edicion inline de texto + miniatura de portada sin recortar (13-sep-2026)

Segunda ronda de feedback de Carlos sobre el shell ya funcional (tras
verificar los Lotes UX-1/UX-3, ver seccion 9f), otra vez con capturas
reales: (1) la miniatura de portada en "Publicaciones" mostraba un
recorte de la imagen en vez de la pagina completa "en tamaño mini" como
en una de las fichas de referencia que compartio; (2) al editar un texto
en el editor aparecia una ventana nativa del navegador (window.prompt),
y preguntó explicitamente si esa era la mejor opcion o si se podia editar
"en el mismo elemento" (adjunto una captura de otra plataforma con edicion
inline).

**Miniatura sin recortar**: `.card-header img` usaba `object-fit: cover`
dentro de una caja de altura fija (200px) mas ancha que alta -- en una
portada vertical (A4 retrato) eso recorta la parte de arriba/abajo de la
imagen. Cambiado a `object-fit: contain` (+ `background: #f5f5f7` para la
franja neutra que queda a los lados cuando la proporcion no coincide) --
ahora se ve la portada COMPLETA en miniatura, igual que una revista real
en pequeño.

**Edicion inline de texto (reemplaza `window.prompt()`)**: doble clic
sobre un texto ya no abre un dialogo nativo -- oculta el nodo de Konva y
superpone un `<textarea>` HTML posicionado exactamente encima, siguiendo
el patron oficial de la propia libreria ("Editable Text" de Konva, no una
libreria de terceros). El calculo de posicion usa
`node.getAbsolutePosition()`, que YA incluye el scale del Stage (el zoom
fit-to-screen del Lote UX-3) -- no hace falta multiplicarlo de nuevo --
mas el `getBoundingClientRect()` del contenedor del Stage correcto
(funciona igual para el lado izquierdo o derecho de un spread, cada uno
con su propio contenedor). Ancho/alto/tamaño de fuente del textarea SI se
multiplican por `stage.scaleX()` porque esos son valores propios del nodo
en coordenadas de pagina sin escalar. Enter confirma el cambio, Escape
cancela, y un clic fuera del textarea tambien confirma (evita perder el
cambio por descuido). Sigue editando la PLANTILLA con shortcodes sin
resolver (p.ej. `{{fecha}}`), nunca el valor ya resuelto que se ve en el
canvas -- mismo criterio que tenia el prompt() original.

**Hallazgo importante durante la verificacion -- bug de TEST, no de
producto**: al re-ejecutar toda la suite de regresion,
`verify_lote6_soundcloud_quickactions.js` y `verify_lote1_visual.js`
fallaron en sus aserciones de arrastre con mouse real. La causa: esas
aserciones asumian una relacion 1:1 entre pixeles de pantalla y
coordenadas de pagina (guardadas en mm×3), valida solo cuando el zoom
fit-to-screen del Lote UX-3 no reduce el canvas (`fitScale === 1`). Con
un canvas escalado hacia abajo para caber en pantalla, un arrastre de
"60px en pantalla" corresponde a un desplazamiento MAYOR en coordenadas
de pagina (÷scale) -- el arrastre en la app en si SIEMPRE funciono
correctamente (Konva ya transforma la posicion del puntero usando el
propio scale del Stage, que es justamente la razon documentada en la
seccion 9f para aplicar el scale via las props nativas de Konva y nunca
via CSS `transform`), pero las aserciones de los tests comparaban mal.
Corregido calculando el scale real (`stageBox.width / anchoNativoDePagina`)
y comparando siempre en espacio de PANTALLA (multiplicando el delta
guardado por ese scale) en vez de comparar unidades de pagina contra
pixeles de arrastre fijos; en `verify_lote1_visual.js` ademas se alejaron
las posiciones de las 3 formas de prueba del borde derecho de la pagina,
que con el canvas reducido dejaban al marquee-select sin margen real para
cubrir la ultima forma de forma confiable. **Leccion para el futuro**:
cualquier test Playwright nuevo que calcule una posicion de clic/arrastre
a partir de `el.x`/`el.y`/`el.width`/`el.height` del store debe multiplicar
por `stageBox.width / (page_width_mm * 3)` para convertir a espacio de
pantalla -- NUNCA asumir que 1px de pantalla equivale a 1 unidad de pagina,
desde que existe el zoom fit-to-screen.

**Verificacion**: nuevo `frontend/tests/verify_lote_ux6_thumbnail_inline_text.js`
(miniatura con `object-fit: contain`, textarea inline sin dialogo nativo,
Enter confirma y persiste tras guardar+recargar, Escape cancela sin
aplicar el cambio). Tras corregir los 2 tests con el bug de scale
descrito arriba, TODA la suite de regresion existente
(`e2e_editor_v2_regression.js`, `verify_lote1.js`, `verify_lote1_visual.js`,
`verify_lote2_shortcodes.js`, `verify_lote3_audio.js`,
`verify_lote4_gallery.js`, `verify_lote5_embed.js`,
`verify_lote6_soundcloud_quickactions.js`, `verify_lote7_library_video.js`,
`verify_spread_view.js`, `verify_lote_ux1_dashboard.js`,
`verify_lote_ux3_thumbnails.js`, `verify_lote_ux3_fit_and_viewer.js`) se
re-ejecuto completa: **todos pasan limpio, sin errores de consola, sin
regresiones**.

Commits en `redesign/editor-v2` (raspi-2, pusheados): `02a3147` (feat
Lote UX-6 -- edicion inline + miniatura sin recortar + fix de los 2 tests
de scale). ia-lavatur resincronizado con `git pull --ff-only`.

## 9h. Lote UX-5 -- orden de capas + Lote UX-7 -- audio/video real en el visor publico (13-sep-2026)

Tercera ronda de feedback de Carlos sobre el shell ya funcional: pidio (a)
poder "traer al frente" / "enviar al fondo" los objetos del canvas para
poder superponerlos, y (b) reporto que al intentar seleccionar un audio
"simplemente no hace nada", pidiendo ademas que tanto audio como video
tengan controles reales y se autoreproduzcan "en el frontend".

**Diagnostico del reporte de audio**: se reproducjo primero en el editor
con un script aislado (clic con coordenadas correctas, considerando el
`fitScale` del Lote UX-3) -- la seleccion en el EDITOR funciona bien. El
reporte de Carlos resulto ser sobre el VISOR PUBLICO
(`PageViewer.jsx`, que renderiza con `canEdit={false}`, donde `onSelect`
no hace nada a proposito): ahi no existia ninguna reproduccion real de
audio ni de video, solo el placeholder estatico de Konva (un rectangulo
con un icono), porque el "Reader" de la Fase E nunca se llego a construir
-- `PageViewer.jsx` es hoy, de facto, el "frontend" publico. Esto
reencuadro los puntos (b) y (c) del pedido de Carlos como la MISMA
funcionalidad faltante.

**Lote UX-5 -- orden de capas**: nueva accion `reorderElement(id,
direction)` en el store (`pageEditorStore.js`) con 4 direcciones:
`'front'`/`'back'` saltan al `z_index` maximo+1 / minimo-1 de TODOS los
elementos de la pagina; `'up'`/`'down'` intercambian el `z_index` con el
vecino inmediato en el orden actual (nunca `+1`/`-1` a secas, para no
colisionar con un `z_index` ya usado por otro elemento). Se expuso como 4
botones nuevos ("Traer al frente", "Subir un nivel", "Bajar un nivel",
"Enviar al fondo") en una fila "Orden" del panel de Quick Actions,
siguiendo la preferencia que Carlos ya habia expresado antes por la
version simple de 4 botones en vez de un panel de capas completo.

**Lote UX-7 -- audio/video real en el visor publico**: se instalo
`react-konva-utils@2.0.0`, que aporta el componente oficial `<Html>` de
la propia libreria de react-konva -- envuelve el contenido en un `Group`
de Konva real y sincroniza un `<div>` HTML pegado a `document.body` con
el `getAbsoluteTransform()` de ese Group, que YA incluye automaticamente
TODOS los transforms ancestros, incluido el `scaleX`/`scaleY` del propio
Stage (el zoom fit-to-screen del Lote UX-3) -- mas simple y menos
propenso a errores que el calculo manual usado para el editor de texto
inline del Lote UX-6. `AudioElement` y `VideoElement` ahora, SOLO en modo
de solo-lectura (`canEdit === false`), renderizan un `<audio>`/`<video>`
NATIVO real dentro de `<Html>` con `controls`, `autoPlay` y `loop` segun
`props.autoplay`/`props.loop` (ya editables desde el panel de propiedades
desde el Lote 3/7); el video ademas honra `props.muted` (checkbox
"Silenciado" ya existente). En modo edicion (`canEdit === true`) se sigue
mostrando el placeholder de Konva sin ningun cambio.

**Limite honesto de la plataforma (no es un bug, es politica del
navegador)**: ningun navegador permite el autoplay CON sonido salvo que
el elemento este `muted` o el usuario ya haya interactuado con la
pagina. El video logra autoplay confiable porque ya tenia su propio
campo "Silenciado" desde antes. El audio NO tiene ese campo -- se dejo el
atributo `autoplay` tal cual, fiel al checkbox "Reproducir
automaticamente" que Carlos ya conoce, sin forzar el mute (que
contradiria silenciosamente la intencion del checkbox); el autoplay CON
sonido del audio puede ser bloqueado por el navegador si el visitante no
interactuo antes con la pagina -- esto se le explico a Carlos al
notificarle.

**Verificacion**: nuevo `frontend/tests/verify_lote_ux5_ux7_layers_media.js`
(Playwright), 9 pasos: crea una publicacion con fixtures REALES de audio
(WAV valido de 1 sample) y video (el mismo WEBM VP8 real de 751 bytes que
ya usa `verify_lote7_library_video.js`) subidos via API; en el editor
prueba las 4 acciones de orden sobre un rectangulo rojo (`z_index=0`,
detras de uno verde) verificando el `z_index` tras cada click; guarda,
recarga la pagina completa y confirma que el orden de capas persistio
(re-ubicando los elementos por color, ya que el backend regenera los ids
al guardar -- no hay `id` en `PageElementCreate`); en el VISOR PUBLICO
confirma que existe un `<audio controls>` real con `src` apuntando a
`/api/assets/serve/...`, y un `<video controls muted>` real con `src`
correcto. Paso completo, sin errores de consola en ningun punto.

**Bug de fixture encontrado y corregido (solo del test nuevo, no de
producto)**: el fixture WEBM reutilizado (string base64 de 1005
caracteres, `1005 % 4 !== 0`, tecnicamente invalido segun la especificacion
estricta de base64) decodifica sin problema con `Buffer.from(str,
'base64')` de Node (tolerante), pero revienta con `InvalidCharacterError`
si se decodifica con `atob()` DENTRO del navegador (estricto) --
`verify_lote7_library_video.js` nunca lo sufrio porque escribe el Buffer a
disco con Node y lo sube via `setInputFiles`, sin pasar nunca por
`atob()`. Corregido decodificando siempre del lado de Node
(`Array.from(Buffer.from(b64, 'base64'))`) y pasando el arreglo de bytes
YA decodificados a `page.evaluate()`, construyendo el `Uint8Array`/`Blob`
directamente en el navegador sin usar `atob()` en absoluto.

Tras esto se re-ejecuto TODA la suite de regresion existente (14 scripts,
incluyendo los 2 corregidos en la seccion 9g) sin fallos ni regresiones.

Commits en `redesign/editor-v2` (raspi-2, pusheados): `d320c09` (feat
Lote UX-5 -- orden de capas + Lote UX-7 -- audio/video real en el visor).
ia-lavatur resincronizado con `git pull --ff-only`.

## 9i. Fix -- popovers del rail (YouTube/Vimeo/SoundCloud/Plugins/Library) recortados fuera de vista (13-sep-2026)

Carlos reportó con una captura de pantalla que al hacer clic en el icono de
YouTube para insertar un video, la ventana de "pegar URL" aparecía "oculta,
fuera del alcance visual" -- una cajita parcialmente visible en la esquina
inferior izquierda de la ventana del navegador, encimada con los iconos de
la barra lateral del propio navegador (Opera, en su caso).

**Causa raíz**: `.editor-v2-tools-rail` (el panel de herramientas de 56px de
ancho a la izquierda) tiene `overflow-y: auto` para poder hacer scroll
cuando hay muchos grupos de herramientas. Por una regla poco conocida de la
spec de CSS, cuando UNO de los dos ejes de overflow (`overflow-x` u
`overflow-y`) se declara distinto de `visible`, el OTRO eje -- aunque nunca
se haya tocado explícitamente -- deja de comportarse como `visible` también
y pasa a recortar su contenido igual que si fuera `overflow-x: auto`. Los
popovers de YouTube/Vimeo/SoundCloud/Plugins/Library (`.editor-v2-plugins-
menu`, ancho fijo de 240px, `position: absolute` dentro del propio rail de
solo 56px) quedaban por lo tanto RECORTADOS por el propio rail en vez de
flotar libremente por encima de todo lo demás -- el popover seguía
"existiendo" en el DOM (por eso los botones respondían al clic y los
formularios funcionaban si se interactuaba con ellos a ciegas), pero
visualmente solo se veía el pequeño trozo que caía dentro de los 56px del
rail. El botón de YouTube, además, está bastante abajo en un rail alto con
9+ grupos de herramientas, así que el recorte resultaba aún más notorio y
confuso (parecía "colgar" cerca del borde inferior de la ventana).

**Por qué ningún test anterior lo detectó**: todos los tests Playwright de
este proyecto interactúan con los popovers directamente vía selectores CSS
(`page.fill(...)`, `page.click(...)`), que funcionan sobre el DOM sin
importar si el elemento es visualmente recortado por el `overflow` de un
ancestro -- nunca se había verificado con un `boundingBox()` real si el
popover completo caía dentro del viewport visible.

**Fix**: nuevo componente `RailPopover` (`CanvasEditorV2.jsx`) que saca el
popover del flujo normal del rail vía un Portal de React (`createPortal`) a
`document.body`, posicionándolo con `position: fixed` y coordenadas
calculadas en tiempo de ejecución a partir del `getBoundingClientRect()` del
botón que lo abrió -- en dos pasadas: (1) al abrir, se coloca pegado al
borde derecho del botón; (2) tras el primer render (`useLayoutEffect`, que
corre después de que el DOM ya está pintado), mide su propio tamaño real y
se reacomoda si se sale del viewport -- lo voltea a la izquierda del botón
si no cabe a la derecha, y lo pega al borde inferior/superior del viewport
si no cabe verticalmente. También se reubica en `resize`/`scroll` mientras
está abierto. Se aplicó a los 5 popovers del rail que compartían el patrón
recortado: YouTube, Vimeo, SoundCloud, Plugins (shortcodes) y Library. CSS
de `.editor-v2-plugins-menu` simplificado (ya no lleva `position`/`top`/
`left`, eso ahora lo controla `RailPopover` vía estilo inline).

**Verificación**: nuevo `frontend/tests/verify_lote_ux8_rail_popover_visibility.js`
-- a diferencia de los tests anteriores, verifica con `boundingBox()` REAL
del navegador que cada uno de los 5 popovers cae COMPLETAMENTE dentro del
viewport (en una ventana angosta de 1024×700 a propósito, el escenario más
exigente), y que YouTube sigue insertando embeds correctamente tras el
cambio de posicionamiento. Tras el fix, se re-ejecutó TODA la suite de
regresión existente (15 scripts en total): todos pasan limpio, sin errores
de consola, sin regresiones -- en particular los tests que interactúan con
Plugins/Library/embeds (Lotes 2, 5, 6, 7) siguen funcionando exactamente
igual, confirmando que el fix es puramente de posicionamiento visual y no
tocó ninguna lógica funcional.

Commits en `redesign/editor-v2` (raspi-2, pusheados): `b33c992` (fix del
posicionamiento de popovers del rail). ia-lavatur resincronizado con
`git pull --ff-only`.

## 9j. Lote UX-9 -- embed real (iframe) con miniatura en el visor público (13-sep-2026)

**Pedido explícito de Carlos** (con 4 capturas): "ya coloque video tanto en
archivo mp4 y coloque un enlace de youtube y se ve asi, pero no se muestra
la miniatura". El mp4 y el audio (Lote UX-7) ya mostraban reproducción real
en el visor; el embed de YouTube/Vimeo/SoundCloud (Lote 5/6) se había
quedado con el placeholder estático de Konva (rectángulo + ícono +
etiqueta) también en modo LECTURA -- nunca recibió el mismo tratamiento
`canEdit`-branching que Audio/Video.

**Fix** (mismo criterio exacto que AudioElement/VideoElement): `EmbedElement`
ahora, cuando `canEdit === false` y `el.props.video_id` existe, renderiza un
`<iframe>` real embebido del proveedor (`youtube-nocookie.com/embed/<id>`,
`player.vimeo.com/video/<id>`, o el widget de `w.soundcloud.com/player`)
vía `<Html>` de `react-konva-utils` -- el iframe trae su propia miniatura
NATIVA del video/track real, sin que el editor tenga que descargar/cachear
ninguna imagen aparte. En modo EDICIÓN el placeholder de Konva sigue
exactamente igual (nada cambia ahí).

## 9k. Lote UX-10 -- galería tipo slideshow real + modal "Propiedades de la galería" (13-sep-2026)

**Pedido explícito de Carlos** (con 2 capturas de la plataforma de
referencia que usa habitualmente, tipo "Creative Studio" con un ícono de
engranaje sobre el elemento que abre un modal "Slideshow properties"):
la galería debía comportarse como un slider real -- imágenes rotando una
a la vez, con un ícono/botón que abre una ventana donde se puede subir o
seleccionar de biblioteca, ver las imágenes cargadas, y configurar
controles de transición y tiempo. La implementación anterior (Lote 4) solo
pintaba todas las imágenes simultáneamente en grid/mosaico (nunca hubo
lógica de slideshow), y el panel de propiedades solo ofrecía cambiar el
layout y agregar/quitar imágenes -- sin título/descripción por imagen, sin
selector de biblioteca, sin ajustes de transición/autoplay/controles.

**Decisión de diseño**: el ícono "engranaje" que abre el modal se puso como
botón dentro del panel de propiedades derecho (sección de Galería/Collage,
"⚙ Configurar galería"), NO superpuesto sobre el elemento en el canvas de
Konva -- superponer un ícono HTML real sobre un `Group` de Konva que
también es arrastrable/seleccionable habría requerido sincronizar
manualmente su posición con `getAbsoluteTransform()` en cada frame (similar
al truco de `<Html>` de Audio/Video/Embed) y arriesgaba interferir con el
drag/click del elemento mismo -- el panel de propiedades ya es el lugar
donde viven todos los demás ajustes de cada elemento, así que es
consistente con el resto del editor.

**Modelo de datos nuevo** en `props` (JSONB sin migración, ver Lote 4/5):
cada imagen de `props.images[]` ahora es `{ src, title, description }` (antes
solo `{ src }`, compatible hacia atrás -- `title`/`description` faltantes se
tratan como `''`), y el elemento `gallery` gana `image_mode` ('crop'|'fit',
default 'crop'), `transition_effect` ('fade'|'slide'|'none', default
'fade'), `captions_enabled`/`controls_enabled`/`autoplay` (booleans) y
`transition_duration` (segundos, default 3).

**`GalleryModal`** (nuevo componente, portal a `document.body` con
backdrop propio, mismo patrón de `createPortal` que `RailPopover` pero
centrado en vez de anclado a un botón del rail): botón "Subir imágenes"
(input file oculto propio, reutiliza `uploadFilesSequentially`) y
"Seleccionar de biblioteca" (reutiliza el fetch de biblioteca ya
existente, filtrado a `kind=image`); lista editable de imágenes con
campos Título/Descripción y botón de quitar; selects de Modo de imagen y
Efecto de transición; campo numérico de Duración; checkboxes de
Leyendas/Controles/Autoplay. Los cambios quedan en estado LOCAL
(`useState`) dentro del modal -- solo se aplican al elemento real al
presionar "Actualizar" (`onSave`); "Cancelar" descarta todo sin tocar el
store. Igual que en el modal de referencia de Carlos (Cancel/Update).

**`GalleryElement` en modo LECTURA** (visor público, mismo criterio
`canEdit`-branching que Audio/Video/Embed): reemplaza el grid/mosaico
ESTÁTICO (que sigue siendo la vista de EDICIÓN sin cambios) por un
slideshow real en HTML puro vía `<Html>` -- todas las imágenes se
posicionan superpuestas (`position: absolute`) y solo la activa tiene
`opacity: 1`/`transform` neutro; un `setInterval` (activo solo si
`autoplay !== false` y hay más de 1 imagen) avanza el índice cada
`transition_duration` segundos; la transición es CSS pura (`opacity` para
"fade", `opacity` + `translateX` para "slide", sin transición para
"none"). Si `controls_enabled !== false` se muestran botones prev/next y
"dots" de navegación (clicables, pausan implícitamente el avance visual
hasta el siguiente tick del autoplay); si `captions_enabled` está activo
se muestra un overlay inferior con el título/descripción de la imagen
activa.

**Verificación**: `frontend/tests/verify_lote_ux9_ux10_embed_gallery.js`
(Playwright real contra ia-lavatur) -- inserta un embed de YouTube, sube 3
imágenes para crear una galería, abre el modal y edita título/descripción
de la 1ra imagen + activa leyendas + transición "Deslizar" + duración 1s,
guarda, confirma los props guardados, y luego abre el VISOR PÚBLICO (misma
sesión de navegador autenticada, igual que los demás tests -- una pestaña
nueva sin login se queda en `/login` porque `/publications/:id/view` es una
ruta protegida) para confirmar: (a) el `<iframe>` real de YouTube con el
`video_id` correcto en el `src`, (b) 3 `<img>` del slideshow con
`object-fit`, botones prev/next, 3 dots, y la leyenda de la imagen activa
visible, y (c) que la imagen activa efectivamente ROTA tras esperar más del
intervalo de autoplay configurado (1s). Los 16 scripts de verificación
previos (Fase B, Lotes 1-7, UX-1/UX-3/UX-5/UX-6/UX-7/UX-8, spread view)
se re-corrieron completos sin regresiones.

## 9l. Lote UX-2 (paleta editorial navy+dorado) + Lote UX-4 (brillo/contraste + esquinas redondeadas en imagenes) (13-sep-2026)

- **Contexto**: retomado explicitamente por Carlos ("vamos por el punto 2 a
  continuar", refiriendose al bloque UX-2/UX-4 que quedaba en pausa por
  detras del frente de landing+Reader publico de la seccion 11). Al no
  haber colores definidos aun, se pregunto a Carlos (AskUserQuestion) entre
  4 opciones de paleta -- eligio explicitamente **"Azul marino + dorado"**
  (editorial serio/premium).
- **Lote UX-2 -- paleta**: reemplazado el acento indigo/purpura generico
  (`#667eea`/`#764ba2` en las paginas de auth/dashboard/publicaciones,
  `#4f46e5` en el editor) por variables CSS nuevas en `:root` de
  `global.css` -- `--color-navy` (#14213d), `--color-navy-dark` (#0c1526),
  `--color-navy-light` (#24365e), `--color-navy-tint` (#e8ebf2),
  `--color-gold` (#c9a24b), `--color-gold-dark` (#a3822f), `--color-ink`
  (#1f2430). Regla de uso: navy para superficies solidas/botones
  primarios/estados activos generales, dorado reservado como acento de
  foco/CTA principal (boton "Guardar" del editor, KPIs numericos del
  dashboard, borde de foco de inputs, outline de la pagina enfocada en el
  spread) -- para que el dorado destaque en vez de diluirse por uso
  excesivo. Aplicado en `global.css`, `Publications.css`,
  `CanvasEditorV2.css`, y los fills/strokes por defecto hardcodeados en JS
  (`CanvasEditorV2.jsx`: figuras nuevas, placeholders de audio/embed,
  marquee-select) -- estos ultimos como literales hex (`#14213d`), Canvas
  2D `fillStyle` no resuelve `var()`.
- **Lote UX-4 -- brillo/contraste + esquinas redondeadas en imagenes**:
  SOLO estos dos ajustes, no un retoque completo de imagen (alcance ya
  confirmado por Carlos en la sesion donde se definieron ambos lotes).
  `ImageElement` en `CanvasEditorV2.jsx` gana `filters={[Konva.Filters.Brighten, Konva.Filters.Contrast]}`
  + props `brightness`/`contrast`, con un `useEffect` que llama
  `node.cache()`/`node.clearCache()` -- los filtros de Konva SOLO se
  aplican sobre pixeles ya cacheados, sin este efecto los sliders no
  tendrian ningun efecto visible. Rangos elegidos por utilidad visual real:
  brillo -1..1 (Brighten de Konva satura casi por completo fuera de ese
  rango), contraste -100..100. Esquinas redondeadas: `Konva.Image` soporta
  `cornerRadius` nativamente desde hace varias versiones de Konva (igual
  que `Rect`), asi que NO hizo falta un `clipFunc` manual -- se reutilizo
  el mismo campo "Radio de esquina" del panel de Apariencia que ya existia
  para figuras rectangulares, ahora tambien visible para `kind='image'`.
  Sliders nuevos con clase `.editor-v2-field-range` (`accent-color: var(--color-gold)`).
- **Sin cambios de backend/BD**: `brightness`/`contrast`/`cornerRadius` son
  props JSONB de forma libre, igual que otros ajustes de lotes anteriores
  (locked, hidden_in_reader, animation) -- no requirio migracion.
- Verificado con nuevo `frontend/tests/verify_lote_ux2_ux4_palette_filters.js`:
  color de fondo real del navbar (`getComputedStyle`) y del boton Guardar,
  fill por defecto de una figura nueva, subida de imagen real + ajuste de
  ambos sliders + radio de esquina desde el panel, y persistencia de los 3
  valores tras guardar+recargar. Tras esto se re-ejecuto TODA la suite de
  regresion existente (16 scripts previos): **todos pasan limpio, sin
  errores de consola, sin regresiones** -- el cambio de paleta no rompio
  ningun selector ni comportamiento existente.
- Commits en `redesign/editor-v2` (raspi-2, pusheados): `5516105`
  (feat: paleta UX-2 + brillo/contraste/esquinas UX-4), `<pendiente>`
  (test + docs de esta seccion).
- **Pendiente**: retomar la seccion 11 (landing publica + Reader publico)
  que Carlos priorizo por encima de este bloque -- con UX-2/UX-4 cerrados
  ya no queda nada bloqueando ese frente. El unico placeholder deliberado
  que sigue sin implementar en el rail es "Guardar como bloque de
  plantilla" (Blocks, ver seccion 9e), a la espera de que Carlos lo pida.

## 9m. Lote UX-11 -- slideshow en vivo dentro del propio editor (Galeria/Collage) (13-sep-2026)

**Origen del requisito**: Carlos reporto que el "slider" no funcionaba como
el pedia -- adjunto 4 capturas del editor de Joomag (la plataforma que usa
como referencia) donde el MISMO elemento de la pagina se ve mostrando fotos
distintas en capturas consecutivas, es decir la rotacion de imagenes es
visible EN VIVO dentro del propio lienzo de edicion, no solo en el visor
publico. Tras varias preguntas de aclaracion (¿elemento nuevo "Slider"
distinto de Galeria? ¿la diferencia es cuantas imagenes se ven a la vez?),
Carlos pidio conectarme directamente a su Chrome real para observar su
sesion de Joomag en vivo en vez de seguir explicandolo con palabras. La
investigacion en su propio navegador (mismas cookies/sesion, sin tocar
credenciales) confirmo dos cosas: (1) Joomag NO tiene una herramienta
"Slider" separada de "Slideshow" -- el mismo icono de cuadricula abre el
mismo modal "Slideshow properties" que usamos nosotros para Galeria/
Collage; (2) observando el lienzo de edicion de Joomag sin ninguna
interaccion, la imagen visible cambia sola cada X segundos (crossfade),
confirmando que el requisito real es: nuestro propio elemento Galeria debe
rotar solo (autoplay) tambien dentro del EDITOR, no solo en el Reader
publico (Lote UX-10).

**Decision de arquitectura (deliberada, no un descuido)**: el patron ya
establecido en el codebase es que en modo edicion (`canEdit=true`) TODOS
los elementos se renderizan como formas Konva puras (para que
drag/click/Transformer funcionen de forma fiable), y solo en modo lectura
(`canEdit=false`, Reader publico) se usa DOM real via `<Html>` de
`react-konva-utils` (asi ya funcionaban Audio/Video/Embed). Se preservo
este patron: la rotacion en vivo dentro del editor se implemento como un
crossfade 100% Konva (dos `Konva.Image` superpuestas con opacidad animada
via `requestAnimationFrame`, replicando un fundido tipo CSS `opacity 0.6s
ease`), NO con DOM/`<Html>` en modo edicion. El bloque de renderizado en
modo lectura (`if (!canEdit) { ... }`, con `<img>` reales, transiciones
CSS, flechas y puntos de navegacion) se dejo completamente intacto.

**Cambios en `frontend/src/components/editor/CanvasEditorV2.jsx`**:
- `computeCoverCrop(image, boxW, boxH)` (nueva funcion pura): calcula el
  rectangulo de recorte equivalente a CSS `object-fit: cover` para pasarlo
  como prop `crop` a `Konva.Image` (Konva no tiene modo "cover" nativo).
- `GallerySlideLayer({ src, width, height, opacity, offsetX, imageMode })`
  (nuevo subcomponente): cada imagen del crossfade, con su propio
  `useHtmlImage(src)`, en modo "fit" (contain, centrado) o "crop" (cover,
  via `computeCoverCrop`), aplicando la `opacity`/`offsetX` recibidas.
- `GalleryElement`: el `useEffect` de autoplay ahora corre en AMBOS modos
  (antes tenia `if (canEdit) return;`), y anima `transitionAlpha` con
  `requestAnimationFrame`. Se agrego un hook de debug solo-DEV:
  `window.__gallerySlideDebug[el.id] = { slideIndex, autoplay, canEdit }`
  (mismo patron que `window.__pageEditorStore`, usado por los scripts
  Playwright de verificacion). El `return` en modo edicion ahora renderiza
  un Group 100% Konva: Rect de fondo negro, hasta dos `GallerySlideLayer`
  en crossfade, leyenda opcional (Rect + Text), y flechas/puntos opcionales
  (con `e.cancelBubble = true` para no disparar el drag/select del Group
  padre al hacer clic en ellos).

**Verificacion (Playwright real contra ia-lavatur)**:
`frontend/tests/verify_lote_ux11_gallery_live_editor.js` -- crea una
publicacion, sube 3 imagenes a una Galeria, configura
`transition_duration=1` (para no esperar los 3s por defecto), lee
`window.__gallerySlideDebug[galleryEl.id]` antes y despues de esperar 4.5s
SIN NINGUNA interaccion del usuario, y confirma que `slideIndex` cambio
solo (0->1) -- es decir que el slideshow rota de verdad dentro del propio
editor, sin publicar ni recargar. Ademas arrastra el elemento con el mouse
mientras el autoplay sigue corriendo y confirma que se sigue moviendo
normalmente (drag real de ~40x30px), es decir que la Galeria conserva toda
su interactividad Konva (seleccionable/arrastrable/transformable) pese a
estar rotando sola. PASO limpio, sin errores de consola.

**Regresion completa**: se re-ejecutaron los 17 scripts de verificacion
existentes (Lotes 1-7, spread, UX-1, UX-2/UX-4, UX-3, UX-3b, UX-5/UX-7,
UX-6, UX-8, UX-9/UX-10, mas este UX-11) contra `ia-lavatur` tras el cambio
-- todos pasaron sin errores de consola ni regresiones.

**Nota menor sin resolver (no reportada aun como problema)**: en el test
que paso, `slideIndex` solo avanzo en 1 durante los 4.5s de espera con
`transition_duration=1`s configurado (se esperarian ~3-4 transiciones). No
afecta al requisito principal (rotacion autonoma confirmada), pero conviene
revisar el timing del `setInterval`/`requestAnimationFrame` si Carlos u
otra prueba detecta que la cadencia real se siente mas lenta de lo
configurado.

## 9n. Fix -- miniatura de portada en blanco cuando la portada usa Galeria/slideshow en vez de imagen fija (13-sep-2026)

**Reporte de Carlos**: tras verificar el Lote UX-11 en su propia sesion,
reporto que en la ficha de "Mis Publicaciones" las 2 primeras publicaciones
(con portada de imagen fija) mostraban su miniatura correctamente, pero la
tercera (con una Galeria/slideshow como portada) se veia en blanco.

**Causa raiz**: `_attach_cover_thumbnails()` (backend, Lote UX-3) filtraba
`PageElement.kind == "image"` para elegir la miniatura, y leia
`props.src`. Un elemento `kind="gallery"` (Lote UX-9/UX-10/UX-11) no tiene
`props.src` -- tiene `props.images[]` (array de `{src, title,
description}`) -- asi que quedaba simplemente ignorado por el filtro, y si
la portada solo tenia una Galeria (sin ninguna imagen suelta de tipo
`image`), `cover_image_url` se quedaba en `None` para esa publicacion.

**Fix**: el filtro ahora incluye tambien `kind == "gallery"`
(`PageElement.kind.in_(["image", "gallery"])`), y al iterar los elementos
candidatos, si `el.kind == "gallery"` se usa la primera imagen no vacia de
`props.images[]` como `src` (en vez de `props.src`). Sin cambios de
backend adicionales ni migracion -- mismo mecanismo transitorio (no
persistido en BD) ya documentado para el Lote UX-3.

**Verificacion**: nuevo `frontend/tests/verify_lote_ux3b_gallery_cover_thumbnail.js`
-- crea una publicacion con una Galeria de 2 imagenes en la portada (sin
ningun elemento `kind=image` suelto), guarda, confirma via
`GET /api/publications` que `cover_image_url` ya NO es `None` y apunta a
una de las imagenes de la galeria, y confirma en la ficha real de
"Publicaciones" que se renderiza un `<img>` con `src` real (no en blanco).
Se re-ejecuto TODA la suite de regresion existente (19 scripts en total,
incluido este nuevo): todos pasan limpio, sin errores de consola, sin
regresiones.

## 9o. Lote UX-12 -- efecto y sonido de pasar pagina + spread "casi pegado" en el visor publico (13-sep-2026)

**Reporte de Carlos** (con capturas del visor `/view`, no del editor): al
usar el control de Siguiente en cualquier revista, entre la portada y el
spread interior 2-3 se veia un hueco grande entre ambas paginas (heredado
del `gap:24px` del editor), y no habia ningun efecto de transicion al
cambiar de pagina. Pidio que las 2 paginas de un spread se vean "casi
pegadas a efecto de revista" y que el cambio de pagina tenga efecto visual
+ sonido de pagina de papel, tipo Joomag/Issuu.

**Decisiones tomadas sin bloquear en Carlos** (via `AskUserQuestion`):
sonido unico por defecto para todas las publicaciones (no upload por
publicacion -- el campo `Publication.page_turn_sound_asset_id` existe en
el modelo desde antes pero se deja sin usar), y efecto de curva/doblez 3D
(no un simple deslizamiento lateral).

**Implementacion (solo en el visor publico -- `PageViewer.jsx`/`PageViewer.css`,
nunca en `CanvasEditorV2.jsx`/`.css` compartidos con el editor interno)**:
- `gap` del wrap de 24px a 3px (constante `CANVAS_WRAP_GAP` en el .jsx debe
  coincidir con el CSS), mas una sombra sutil de "lomo" en el centro del
  spread.
- Efecto de flip 3D (`rotateY`, maquina de estados `flipState` de 2 fases
  "out"/"in" de 220ms cada una, con el swap de `currentViewIndex` ocurriendo
  justo en el instante en que la hoja esta de canto/invisible) + sonido
  `.mp3` sintetizado con ffmpeg (ruido filtrado, sin fuente externa por
  tema de licencias) servido como estatico desde `frontend/public/sounds/`.

**Bug de la primera version -- reportado por el propio Carlos tras
revisarlo** ("el efecto de cambio de pagina no quedo bien, se ve muy
feo"): el `rotateY` se aplicaba a `.editor-v2-canvas-wrap`, el DIV que
`CanvasEditorV2.css` define con `flex:1` para ocupar TODO el ancho
disponible y centrar la(s) pagina(s) adentro con `justify-content`. Como
ese wrap es mucho mas ancho que la pagina real (sobre todo en
portada/contraportada, una sola hoja centrada en pantalla completa),
`transform-origin:100%/0%` pivotaba sobre el borde de la PANTALLA, no el
borde de la PAGINA -- resultado visual: un trapecio gris gigante de fondo
y la hoja real encogida/sesgada en el centro.

**Fix** (verificado conectandome al navegador -- Claude in Chrome -- en
vivo contra `ia-lavatur`, no solo con Playwright: se creo una publicacion
de prueba con rectangulos de color de fondo en cada pagina para que el
efecto fuera visible, y se congelo la animacion a mitad de vuelo con
`element.getAnimations()[0].pause()` para inspeccionar geometria y
`transform-origin` reales durante la transicion): se agrego un DIV interno
nuevo, `.page-viewer-flip-inner`, que envuelve solo la(s) pagina(s) --
sizeado a su ancho real (`display:flex`, `flex-shrink:0` en sus hijos
`.editor-v2-page-slot`) -- y es este el que ahora rota. El wrap exterior
(`.editor-v2-canvas-wrap`, con `canvasWrapRef`) se deja SIN rotar y sigue
siendo el `flex:1` de ancho completo que `PageViewer.jsx` necesita intacto
para el calculo de `fitScale` (el `ResizeObserver` mide su
`clientWidth`/`clientHeight`). El oscurecido (`::after`) y la sombra de
lomo (`::before`) se movieron del wrap exterior al div interno para que
cubran solo la pagina, no toda la franja gris de fondo.

**Verificacion**: `frontend/tests/verify_lote_ux12_page_flip.js` --
crea una publicacion de 4 paginas, mide el gap del spread (<=15px), hace
clic en "Siguiente" y verifica geometricamente que el DIV que rota
(`.page-viewer-flip-inner`) sea sustancialmente MAS ANGOSTO que el wrap
exterior de medicion (nueva asercion agregada especificamente como
regresion contra el bug del "trapecio gigante"), detecta la clase de
flipping y una transformacion 3D real durante la transicion, confirma que
el contenido avanza correctamente pese a la animacion, que se crea un
`Audio()` con el src correcto en cada cambio de pagina, y que
`/sounds/page-turn.mp3` se sirve con HTTP 200. Se re-ejecuto TODA la
suite de regresion existente (21 scripts en total, incluido este):
todos pasan limpio, sin errores de consola, sin regresiones.

## 9p. Investigacion -- opciones para efecto de curl real de pagina (14-sep-2026, SIN decision tomada)

**Contexto**: tras el fix de UX-12 (seccion 9o, giro rigido de hoja completa
con `rotateY`, ya corregido y funcionando), Carlos revizo el resultado en
`http://100.71.185.7:5173` y dio feedback: "mejoro bastante pero aun tenemos
area de oportunidad" -- quiere el efecto de **curl real de esquina** (la hoja
se curva/dobla como papel fisico al pasar, tipo Issuu/Joomag/PubHTML5), no
solo un giro de plano rigido tipo puerta. Para acordar el objetivo visual
exacto, Claude (Cowork) se conecto en vivo por Chrome (Claude in Chrome) a
`pubhtml5.com` -- Carlos mostro el visor de "KARE Magazine" ahi como
referencia del efecto deseado.

**Diagnostico del efecto de referencia (observado en vivo, no solo leido en
documentacion)**: el curl de PubHTML5 NO es un solo `rotateY` -- es una
aproximacion poligonal: la hoja se corta en varias franjas y cada una rota
un angulo ligeramente distinto (simulando una curva), mas 3-4 capas de
sombra superpuestas (`outerShadow`, `innerShadow`, `hardShadow`,
`hardInnerShadow`) con gradientes y `clip-path` dinamico para el borde
curvo. Sigue siendo CSS/DOM -- no usa WebGL ni recanvasea las paginas a
imagen.

**Opciones investigadas** (busqueda web + lectura de codigo fuente/READMEs,
NO se instalo ni prototipo nada aun):

1. **Turn.js** -- jQuery, en mantenimiento inactivo desde hace años.
   Descartada de entrada.

2. **StPageFlip / paquete npm `page-flip`** (repo `Nodlik/StPageFlip`,
   MIT, cero dependencias) -- tiene modo `loadFromHtml()` que renderiza
   HTML real (no solo imagenes), lo que en teoria permitiria seguir usando
   `PageCanvas`/Konva como contenido de cada hoja. Pero: mantenimiento
   debil (hay un issue pidiendo marcarlo como abandonado), varios issues
   abiertos sin respuesta del autor (fuga de memoria en `destroy()` --
   issue #71 --, roturas en limites de spread -- issues #66/#70 --,
   corrupcion en Shadow DOM -- issue #69). Riesgo alto para produccion.

3. **`@gullabs/flipbook`** (fork activo de StPageFlip, TypeScript, con
   changelog/ROADMAP/CI) -- el mas solido de los tres:
   - Corrige bugs concretos del original: el "pliegue transparente" (se
     veia el texto de abajo a traves del doblez), el evento de
     actualizacion (`onUpdate`) que nunca disparaba bien, animacion de
     retroceso poco realista en portrait.
   - **Elimino el modo canvas a proposito** (ADR 0002: "HTML mode delega
     en el navegador; canvas reimplementa el navegador") -- ahora es 100%
     HTML mode, paginas como DOM vivo. Esto es justo lo que se necesita:
     el contenido interactivo (Konva, audio, video, iframes de embed)
     seguiria siendo DOM real dentro de cada hoja, en principio
     interactivo incluso durante el giro.
   - Soporta Pointer Events, `ResizeObserver`, `prefers-reduced-motion`,
     navegacion por teclado, RTL.
   - Licencia MIT.

**Limitacion real de las 3 opciones, no resuelta por ninguna**: ninguna
libreria modela nativamente el "spread" (dos paginas visibles a la vez como
interior de revista) que ya usamos en `computeSpreadViews`
(`CanvasEditorV2.jsx`). Su modelo mental es un libro pagina-por-pagina con
portada/contraportada especiales -- adaptar esto a nuestro spread es trabajo
de integracion real, no es plug-and-play aunque se elija adoptar una
libreria.

**Opciones concretas presentadas a Carlos (esperando su decision)**:
- **A (recomendada por Claude)**: prototipo aislado (fuera del editor real)
  con `@gullabs/flipbook` en modo HTML + `PageCanvas`/Konva + el sonido de
  pagina, para validar en un par de horas si Konva se mantiene interactivo
  y sin glitches durante el giro, ANTES de tocar `PageViewer.jsx`.
- **B**: saltar el prototipo e integrar `@gullabs/flipbook` directo en
  `PageViewer.jsx`, adaptando `computeSpreadViews` a su modelo de
  pagina-por-pagina. Mas rapido si sale bien, mas riesgo si no.
- **C**: NO adoptar libreria nueva -- refinar el efecto `rotateY` actual
  dividiendo la hoja en 2-3 franjas verticales con `clip-path` y angulos
  de rotacion ligeramente distintos por franja + sombra con gradiente en
  el borde, acercandose visualmente al curl real sin nueva dependencia ni
  riesgo arquitectonico.
- **D**: dejar el efecto actual (ya corregido en UX-12) como esta, sin mas
  trabajo en esto por ahora.

**Estado**: ninguna opcion fue implementada ni elegida en esta ronda -- es
investigacion pura para que Carlos y el equipo decidan con contexto
completo. Nada de esto esta commiteado en codigo.


## 10. Próximo paso concreto (para quien retome esto)

**ACTUALIZACIÓN 14-sep-2026**: ver seccion 9p -- Carlos pidio investigar
opciones para un efecto de curl real de pagina (mas alla del giro rigido
ya corregido en UX-12); se documentaron 4 opciones (A/B/C/D) y quedan
pendientes de que Carlos decida cual seguir. No implementar nada de esto
sin su decision explicita.

**ACTUALIZACIÓN 13-sep-2026 (cierre de UX-12)**: Carlos pidio que el
spread se viera "casi pegado" tipo revista real y que el cambio de pagina
en el visor publico tuviera efecto visual + sonido de pasar pagina. Se
implemento y, tras un primer intento reportado por Carlos como "se ve muy
feo" (el trapecio gris gigante descrito en detalle en la seccion 9o), se
corrigio conectandome en vivo a su Chrome real para verificarlo con la
animacion congelada a mitad de vuelo. YA ESTA IMPLEMENTADO, CORREGIDO Y
VERIFICADO -- ver seccion 9o.

**ACTUALIZACIÓN 13-sep-2026 (cierre de UX-2/UX-4)**: los Lotes UX-2 (paleta
editorial navy+dorado) y UX-4 (brillo/contraste + esquinas redondeadas en
imagenes) que este documento marcaba como pendientes YA ESTAN
IMPLEMENTADOS Y VERIFICADOS -- ver seccion 9l.

**ACTUALIZACIÓN 13-sep-2026 (cierre de UX-11)**: Carlos reporto que el
slideshow de Galeria/Collage debia rotar EN VIVO tambien dentro del propio
editor (no solo en el Reader publico), tras pedirme conectarme a su Chrome
real y observar el comportamiento de Joomag como referencia. Esto YA ESTA
IMPLEMENTADO Y VERIFICADO -- ver seccion 9m.

**ACTUALIZACIÓN 13-sep-2026 (fix de miniatura de portada con galeria)**:
tras verificar UX-11 en vivo, Carlos reporto que la ficha de "Mis
Publicaciones" mostraba en blanco la miniatura de una portada armada con
Galeria/slideshow (mientras que las portadas de imagen fija si se veian
bien). YA ESTA CORREGIDO Y VERIFICADO -- ver seccion 9n. Con esto, no
queda ningun otro lote UX ni bug pendiente confirmado por Carlos. El
trabajo inmediato a retomar ahora es el frente de landing page + Reader
público (catálogo público para ver revistas ya publicadas, sin login)
descrito en la **sección 11** (al final de este documento), que Carlos ya
habia priorizado por encima de UX-2/UX-4/UX-11 y que ahora queda sin nada
bloqueandolo.

Con los Lotes 1-7 cerrados (seleccion multiple/alinear-distribuir/formas,
shortcodes, audio, galeria/collage/GIF, vista de hoja doble, YouTube/Vimeo,
SoundCloud+Quick Actions, y Library+video real), los Lotes UX-1/UX-3
tambien cerrados (Dashboard real, miniaturas de portada, fit-to-screen y
visor publico con contenido real -- ver seccion 9f), UX-6 (edicion inline
de texto + miniatura sin recortar -- ver seccion 9g), UX-5/UX-7 (orden de
capas + audio/video real en el visor publico -- ver seccion 9h), el fix de
popovers del rail (seccion 9i), UX-9/UX-10 (embed real con miniatura +
galeria tipo slideshow real con modal de propiedades -- ver secciones 9j y
9k), y ahora UX-2/UX-4 tambien cerrados (ver seccion 9l), no queda ningun
lote UX pendiente confirmado por Carlos.

El unico otro placeholder que sigue deliberadamente sin implementar en el
rail es **"Guardar como bloque de plantilla" (Blocks)** -- explicitamente
fuera de alcance del Lote 7 por decision propia (ver seccion 9e), a la
espera de que Carlos lo pida y aclare el alcance (¿un bloque puede mezclar
varios elementos o es siempre uno solo? ¿vive a nivel de tenant como la
Library de assets?).

Mientras tanto, seguir con la instruccion general de Carlos ("Adelante
continua y que todo quede funcional") revisando si queda alguna otra
categoria del rail o del panel de propiedades sin funcionalidad real
(Hotspot es el candidato mas probable a revisar a continuacion) --
implementar, verificar con Playwright real contra `ia-lavatur` (screenshots
incluidos cuando aplique), commitear+pushear desde `raspi-2` (unica maquina
con credenciales de git para este repo), sincronizar `ia-lavatur` con
`git pull`, y solo entonces continuar -- sin pausar a pedir confirmacion
salvo que algo requiera de verdad la validacion de Carlos.

Si un lote nuevo agrega un `PageElementKind`, recordar el
`CHECK CONSTRAINT` de la seccion de Lote 4/5 -- hace falta una migracion
SQL (`ALTER TABLE ... DROP/ADD CONSTRAINT`) aplicada tanto en el repo
(`0001_editor_v2.sql` para bases nuevas + un `000N_*.sql` nuevo para bases
existentes) como en la base real de ia-lavatur, o el primer guardado de
ese elemento fallara con 500. (El Lote 6 y el Lote 7 NO necesitaron esto
-- SoundCloud reutilizo `kind='embed'` y video ya estaba permitido desde
la Fase A.)

Antes de tocar `docker-compose.dev.yml` o recrear contenedores en
ia-lavatur, releer el aviso de infraestructura de la seccion 9 (Lote 3).

Antes de dar por cerrado cualquier lote nuevo: reproducir manualmente (o
via script Playwright) el escenario de fuga portada->contraportada -- el
test de backend por si solo no prueba la UI.

## 11. Próxima fase -- Landing page + Reader público (frontend de lectura de revistas publicadas, para cualquier agente de IA -- Claude, Codex, Antigravity, Arnes Agent, etc.)

**Contexto (13-sep-2026)**: cerrados los Lotes 1-7 y UX-1/UX-3/UX-5/UX-6/UX-7/UX-8/UX-9/UX-10 (todos sobre el EDITOR interno, que siempre requiere sesión de administrador/editor autenticada -- ver secciones 9 a 9k), Carlos pidió explícitamente empezar YA el siguiente frente: una landing page pública + un frontend de lectura para que cualquier visitante (sin cuenta) pueda entrar y ver las revistas ya publicadas. Por ahora la URL de acceso será la IP de Tailscale de `ia-lavatur` (`100.71.185.7`, puerto `5173` del frontend dev); dominio propio/TLS sigue siendo trabajo futuro no implementado (ver limitación ya documentada en la sección 4b).

**Diagnóstico -- por qué esto es trabajo nuevo, no solo "reusar el visor que ya existe"**:
- El componente `PageViewer.jsx` (`/publications/:id/view`) que se construyó en los Lotes UX-3/UX-7/UX-9/UX-10 para previsualizar el contenido real (iframes de embed, audio/video nativos, slideshow de galería, etc.) está **envuelto en `<ProtectedRoute>`** en `App.jsx` -- exige el mismo login de administrador que el editor. Es un visor interno de verificación, NO un lector público.
- **TODOS los endpoints del backend exigen `Depends(get_current_user)`** (JWT de sesión), sin excepción, en `publications.py` y `pages.py` -- confirmado por grep, no queda ningún endpoint de lectura sin auth para publicaciones/páginas/elementos. Hoy es físicamente imposible ver una revista sin loguearse primero.
- La única excepción ya pública es `GET /api/assets/serve/{object_name}` (`assets.py`) -- sirve cualquier archivo de MinIO (imagen/audio/video/portada) **sin ningún `Depends`**, ya pensado como proxy público de binarios. Esto simplifica el trabajo: solo faltan endpoints públicos de METADATOS (qué páginas/elementos tiene la revista), no de binarios.
- El modelo `PublicationVersion` (`backend/app/models/publication_version.py`) **ya fue diseñado desde la Fase A específicamente para esto** -- su propio docstring dice literalmente: *"Snapshot inmutable de una publicacion completa (todas sus paginas + elementos) en el momento de 'Publicar'. El Reader publico SIEMPRE lee de aqui, nunca de las tablas editables -- asi una edicion a medias nunca llega a un lector, y queda historial para poder revertir."* `POST /api/publications/{id}/publish` ya congela un snapshot completo (`{orientation, page_width, page_height, pages: [{page_number, page_type, elements: [...]}]}`) en `PublicationVersion.snapshot` (JSONB) y actualiza `Publication.published_version_id`. Es decir: la arquitectura de datos para separar "borrador en edición" de "lo que ve el público" **ya existe y ya se usa** -- solo falta el endpoint público que la lea y el frontend que la muestre.
- `Publication.is_public` (booleano, columna + campo de schema + checkbox ya en el formulario de `Publications.jsx`) **existe pero hoy no lo usa ni lo respeta ningún endpoint** -- es decorativo. Debe ser el filtro real que decide si una publicación aparece en el catálogo público.
- `Tenant.subdomain` (columna `unique`) ya existe en el modelo pero tampoco se usa aún para namespacing del catálogo público -- decidir con Carlos si el catálogo público se separa por tenant (subdominio/slug en la URL) o si por ahora (single-tenant real en producción) el catálogo es global; no bloquear el arranque del trabajo por esto, implementar server-side ya filtrando por `tenant_id` aunque el frontend aún no exponga selector de tenant.

**Plan concreto (seguir el mismo flujo de siempre: por lotes, verificando cada uno contra `ia-lavatur`, sin tocar el editor/rail ya cerrado)**:

1. **Backend -- nuevo router público, sin auth** (`backend/app/api/public.py`, registrado en `main.py` bajo `/api/public`, SIN `Depends(get_current_user)` en ningún endpoint de este router):
   - `GET /api/public/publications` -- catálogo: publicaciones con `is_public=True` **y** `published_version_id IS NOT NULL` (nunca listar un borrador sin publicar). Devolver id, title, orientation, miniatura de portada (mismo criterio de mayor-área ya usado en `_attach_cover_thumbnails()`, pero leyendo la portada DESDE el snapshot publicado, no desde `page_elements` en vivo).
   - `GET /api/public/publications/{id}` -- metadatos de una publicación pública+publicada (404 si `is_public=False` o si no tiene `published_version_id`, para no filtrar títulos de revistas privadas).
   - `GET /api/public/publications/{id}/pages` -- **leer directamente `PublicationVersion.snapshot` del `published_version_id` vigente**, nunca `page_elements`/`pages` en vivo (así una edición a medias jamás se le muestra a un lector real -- es literalmente para lo que se diseñó el snapshot).
   - Reusar `PageElementsResponse`/`PageResponse` (schemas ya existentes) como forma de respuesta para poder reutilizar el mismo parser del lado del frontend sin reescribirlo.

2. **Frontend -- nueva superficie pública, separada del SPA protegido**:
   - Landing page pública nueva (ruta `/` o `/catalogo`, fuera de `<ProtectedRoute>`) que liste el catálogo (`GET /api/public/publications`) con las miniaturas reales ya construidas en UX-3.
   - Reader público nuevo (ruta nueva, p.ej. `/leer/:id`, TAMBIÉN fuera de `<ProtectedRoute>`) que reutilice `PageCanvas`/`computeSpreadViews` (ya exportados de `CanvasEditorV2.jsx` para este fin exacto desde UX-3) en modo `canEdit={false}` -- el mismo componente que ya renderiza iframes reales de embed, audio/video nativo y slideshow de galería (Lotes UX-7/UX-9/UX-10) -- pero alimentado por `/api/public/publications/{id}/pages` (snapshot publicado) en vez de `/api/pages/{pageId}/elements` (contenido en vivo, que exige token).
   - **Importante**: `PageViewer.jsx` actual (el interno, protegido) NO se toca/rompe -- sigue siendo la herramienta de verificación del editor. El Reader público es un componente/ruta nueva que puede compartir subcomponentes de renderizado (`PageCanvas`) pero no la fuente de datos ni el guard de ruta.
   - Ruta raíz `/` de la SPA hoy redirige a `/dashboard` (que exige login) -- decidir con el plan de Carlos si la landing pública toma la raíz del dominio y el dashboard de administración pasa a vivir en `/admin` (o similar), o si se sirve como un build/puerto separado. No asumir unilateralmente un cambio de esa magnitud en las rutas del panel de administración sin dejarlo explícito en el commit/documentación -- es una decisión de producto, no solo técnica.

3. **Verificación**: mismo patrón Playwright de siempre -- un script nuevo que, SIN loguearse (sin `localStorage.setItem('token', ...)` ni `page.fill('input[type=email]'...)`), navegue directo a la landing pública y al reader público de una publicación marcada `is_public=True` y publicada, y confirme que carga contenido real (imagen de portada, texto, y al menos un embed/audio/video/galería reales) -- exactamente el mismo tipo de aserciones ya usadas en `verify_lote_ux9_ux10_embed_gallery.js` pero SIN el paso de login. Correr también toda la suite de regresión existente para confirmar que las rutas protegidas siguen intactas.

4. **Acceso mientras tanto**: URL de prueba = IP de Tailscale de `ia-lavatur` (`http://100.71.185.7:5173/...`), igual que el resto del stack de desarrollo -- no hay dominio público ni TLS todavía (ver limitación ya documentada en sección 4b, "qué falta antes de usar esto como base de producción real").

**Estado 13-sep-2026**: los Lotes UX-2/UX-4 mencionados como "no bloqueante" ya se implementaron y verificaron (ver sección 9l) -- este frente de landing+Reader público es ahora el ÚNICO trabajo pendiente sin nada por delante.
