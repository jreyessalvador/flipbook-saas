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

## 7. Próximo paso concreto (para quien retome esto)

Fase A ya está cerrada de verdad (ver sección 2) -- verificada con un stack
real en `ia-lavatur`, no solo con imports de Python. Commits en
`redesign/editor-v2`: `da9aa7a` (fundaciones) y `718ccde` (smoke test de
regresión).

**Siguiente: Fase B -- editor canvas mínimo.**
1. React + `react-konva` en el frontend existente (o uno nuevo si el actual
   está muy acoplado al editor viejo -- decidir revisando el código actual
   primero, no asumir).
2. Store de estado con Zustand + Immer, un store POR PÁGINA (nunca un
   objeto global mutable compartido entre páginas -- esa fue la causa raíz
   original, ver sección 1 de la arquitectura).
3. Solo tipos `image`, `text`, `shape` al inicio (video/audio/hotspot en
   Fase C/D, ya modelados en la BD pero sin UI todavía).
4. Flujo de guardado EXPLÍCITO (botón "Guardar", no autosave) contra
   `PUT /pages/{id}/elements` con `version` -- manejar el 409 mostrando al
   usuario que alguien más guardó primero (no sobreescribir en silencio).
5. Reproducir el escenario de `test_editor_v2_regression.sh` manualmente en
   el navegador contra `ia-lavatur` (Tailscale) antes de dar la fase por
   cerrada -- el test de backend no prueba la UI.
