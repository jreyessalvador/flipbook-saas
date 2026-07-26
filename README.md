# Flipbook SaaS

Plataforma multi-tenant para crear y publicar revistas digitales interactivas (flipbooks) con editor visual tipo canvas.

**Repo:** github.com/jreyessalvador/flipbook-saas · **Rama activa:** `desarrollo`

---

## Estado actual (2026-07-26)

- **Progreso funcional:** ~46-50%. Fase 1 (config. de publicación) y Fase 2 (sistema de páginas) completas. Fase 3 (editor canvas con Fabric.js) avanzada. Fases 4-6 (hotspots, galería, acciones) sin empezar.
- **Entorno vivo:** solo existe el de desarrollo, corriendo en la Raspberry Pi (`raspi-II`, namespace `flipbook-dev` en k3s). No hay entorno de producción activo ahora mismo.
- **Bug de arranque corregido (commit `433d959`):** el backend reiniciaba en crash loop (21-22 veces) porque `assets.py` verificaba/creaba el bucket de MinIO a nivel de import del módulo, sin reintentos, y solo capturaba `S3Error` (no errores de DNS/red). Si CoreDNS no había resuelto aún `minio.flipbook-dev.svc.cluster.local` al arrancar, la app moría. Solución: el chequeo se movió a un evento de `startup` de FastAPI con reintentos y backoff (`assets.ensure_bucket()`), y no tumba la app si falla — se reintenta de forma perezosa en el primer upload. Verificado con prueba de estrés (borrado forzado de pods) sin reincidencia.
- **Celery / workers: configurado pero NO desplegado ni funcional.** `workers/celery_app.py` referencia tareas (`pdf_import_task`, `pdf_export_task`, `image_optimization_task`) que **no existen como archivos** — ni siquiera hay carpeta `workers/tasks/`. No hay ningún manifiesto de worker en `k8s/`, y no se invoca Celery desde ningún endpoint del backend todavía. No es un bug activo (nadie lo usa aún), pero hay que implementarlo antes de construir Fase 4-6 (procesamiento de PDF/imágenes es async por diseño).
- **Repo limpio:** se eliminaron 13 archivos de respaldo manual (`CanvasEditor.jsx.backup2..8`, etc.) que estaban sueltos o mal commiteados, y se agregó regla a `.gitignore` para que no vuelva a pasar. Usar `git`, no copias `.backupN`.

---

## Hallazgo importante para la réplica: ya existe diseño de producción

En `k8s/backend/`, `k8s/frontend/` y `k8s/database/` hay manifiestos **distintos** a los `*-dev` de la raspi: apuntan al namespace `flipbook-prod`, usan `Secret` de Kubernetes (`backend-secret`) en vez de credenciales en texto plano en el ConfigMap, y el plan documentado originalmente (`DOCUMENTATION.md`) era **AWS EC2 + K3s + Nginx Ingress + Cert-Manager (Let's Encrypt)** — no Contabo ni Raspberry Pi.

Esto coincide con el conector SSH `ssh-aws-flipbook` (100.27.230.32) que **no responde** (timeout de conexión). Antes de construir de cero en Contabo, vale la pena confirmar el estado real de esa instancia AWS (¿detenida? ¿firewall bloqueando SSH? ¿sigue facturando sin usarse?) — puede que la base de producción ya esté más avanzada de lo que la raspi sugiere, o que sea una instancia abandonada generando costo.

---

## Stack técnico

**Backend:** FastAPI 0.109 (Python 3.11), SQLAlchemy 2.0 async + Alembic, PostgreSQL 15, Redis 7, JWT + bcrypt, MinIO (S3-compatible), Celery (sin desplegar aún), procesamiento de PDF con PyPDF2/pdf2image/WeasyPrint.

**Frontend:** React 18 + Vite 5, React Router v6, Axios, Fabric.js (editor canvas), servido por Nginx en producción (build estático).

**Modelo de datos:** multi-tenant desde el diseño — `tenant`, `user`, `publication`, `page`.

**Infraestructura objetivo (diseño original):** Kubernetes (k3s), Nginx/Traefik Ingress, Cert-Manager para TLS, MinIO para storage de objetos.

---

## Cómo levantarlo desde cero (para replicar en Contabo u otro servidor)

### Requisitos del servidor
- Linux con Docker y k3s (o Docker Compose para algo más simple/rápido de validar).
- Dominio o subdominio apuntando al servidor si se quiere TLS real (Cert-Manager + Let's Encrypt).
- Recursos mínimos observados en uso real (dev, sin tráfico): ~380MB RAM para todo el stack de datos (postgres+redis+minio), backend ~75MB por réplica. Para producción con tráfico real, dimensionar con margen.

### Variables de entorno necesarias (ver `backend/.env.example`)
```
DATABASE_URL, REDIS_URL
MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_SECURE
JWT_SECRET_KEY   <- generar uno nuevo, no reusar el de dev
CELERY_BROKER_URL, CELERY_RESULT_BACKEND
```

### Pasos (entorno de desarrollo rápido, con Docker Compose)
```bash
git clone git@github.com:jreyessalvador/flipbook-saas.git
cd flipbook-saas
git checkout desarrollo
docker-compose up -d
# backend en :8000, frontend en :5173, minio console en :9001
```

### Pasos (producción real, Kubernetes)
```bash
# 1. Build de imágenes
docker build -t flipbook-backend:latest ./backend
docker build -t flipbook-frontend:latest ./frontend

# 2. Importar a k3s (si el registry es local, sin push a un registry remoto)
docker save flipbook-backend:latest | sudo k3s ctr images import -
docker save flipbook-frontend:latest | sudo k3s ctr images import -

# 3. Aplicar manifiestos de PRODUCCIÓN (no los *-dev)
kubectl apply -f k8s/database/       # postgresql, redis, minio
kubectl apply -f k8s/backend/        # requiere Secret backend-secret creado antes
kubectl apply -f k8s/frontend/
kubectl apply -f k8s/ingress.yaml    # ajustar hosts reales, no *.local

# 4. Verificar arranque limpio (el bug de MinIO ya está corregido, pero
#    conviene confirmar igual con un reinicio forzado de pods):
kubectl delete pod -n flipbook-prod -l app=backend
kubectl get pods -n flipbook-prod -w
```

**Importante:** el `Makefile` del repo (`make deploy`) referencia rutas (`k8s/base/`, `k8s/workers/`) que **no existen** en la estructura real — está desactualizado, no usarlo tal cual hasta corregirlo. Usar los comandos de arriba o `kubectl apply -f k8s/database/ -f k8s/backend/ -f k8s/frontend/`.

### Antes de considerarlo listo para vender como SaaS, falta
1. Implementar los workers de Celery (`workers/tasks/`) que hoy no existen — necesarios para import/export de PDF y optimización de imágenes async.
2. Reemplazar credenciales de ejemplo (`admin`/`dev_password`) por secrets reales gestionados (no en ConfigMap ni en git).
3. CI/CD — hoy el despliegue es 100% manual (`docker build` + `k3s ctr images import` + `rollout restart`). Ya existe Jenkins en `raspi-I`, sin pipeline conectado a este repo todavía.
4. Definir en firme el servidor de producción: revisar si la instancia AWS (`ssh-aws-flipbook`, 100.27.230.32) sigue siendo el plan, o migrar el diseño `k8s/backend` (prod) a Contabo, ajustando namespace y dominio.
