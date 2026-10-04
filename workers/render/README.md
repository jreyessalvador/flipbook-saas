# Worker de render de flipbook-saas (Lote F) — Contabo 2

Copia de referencia de lo desplegado en Contabo 2 (`/srv/flipbook-worker/`).
Detalle completo y aislamiento: `RECETA-DESARROLLO.md` §24 y §25.

| Archivo | Destino en Contabo 2 |
|---|---|
| `worker.py`, `smoke_test.py` | `/srv/flipbook-worker/app/` (root:flipbook-worker 640, montado `:ro`) |
| `Dockerfile` | `/srv/flipbook-worker/Dockerfile` → imagen `flipbook-render-worker:f1` |
| `docker-compose.yml` | `/srv/flipbook-worker/docker-compose.yml` (proyecto `flipbook-worker`) |
| `flipbook-worker-fw.sh` | `/usr/local/sbin/` (cortafuegos de `br-flipbook`) |
| `flipbook-worker-fw.service` | `/etc/systemd/system/` |

Los tokens viven SOLO en `/srv/flipbook-worker/{dev,prod}.env` (root 600) y en el `.env`
de cada entorno de Contabo 1 (`RENDER_WORKER_TOKEN`). Nunca en el repo.

Actualizar el worker: copiar `worker.py` a `/srv/flipbook-worker/app/` y
`sudo docker compose -f /srv/flipbook-worker/docker-compose.yml -p flipbook-worker up -d --force-recreate`.
