# Flipbook SaaS

**Plataforma multi-tenant B2B para revistas digitales interactivas**

Stack: FastAPI + React + PostgreSQL + Redis + MinIO + Celery
Infra: Docker Compose + Nginx en host + Certbot SSL
CI/CD: GitHub Actions -> GHCR -> SSH deploy

---

## Inicio rapido — Desarrollo

```bash
git clone git@github.com:jreyessalvador/flipbook-saas.git
cd flipbook-saas
make dev
make db-migrate
make db-seed
# Frontend : http://localhost:5174
# API Docs : http://localhost:8001/api/docs
# MinIO    : http://localhost:9003
```

---

## Arquitectura

```
Internet -> Nginx (host) SSL Certbot
  miflipbook.duckdns.org       -> frontend:80   (5100)
  api.miflipbook.duckdns.org   -> backend:8000  (5101)

Docker Compose (flipbook-prod-net)
  frontend  (React/Nginx)
  backend   (FastAPI)
  celery_worker / celery_beat
  postgres  (PostgreSQL 15)
  redis  (Redis 7)
  minio  (S3-compat)
```

### Multi-tenancy B2B

- Subdominio propio: cliente.miflipbook.duckdns.org
- Bucket MinIO aislado: tenant-{slug}/
- Planes: free / pro / enterprise
- Limites por tenant: publicaciones, almacenamiento, usuarios

---

## Estructura

```
flipbook-saas/
|-- backend/      FastAPI Python 3.11, Dockerfile multi-stage
|-- frontend/     React 18 + Vite 5, Dockerfile multi-stage
|-- workers/      Celery: pdf_import, pdf_export, image_opt
|-- deploy/       nginx config + scripts backup/migrate
|-- k8s/          Manifests K8s (referencia historica)
|-- .github/      CI/CD GitHub Actions
|-- docker-compose.yml       Desarrollo
|-- docker-compose.prod.yml  Produccion
|-- .env.prod.example        Plantilla variables
`-- Makefile                 Comandos
```

---

## Deploy

```bash
cp .env.prod.example .env.prod
make prod && make db-migrate
```

Secrets: PROD_HOST, PROD_USER, PROD_SSH_KEY

## Roadmap

- [x] Multi-tenancy, JWT, MinIO, Celery, Docker, CI/CD
- [ ] API publicaciones, Editor, Stripe, SSO

*Cetrix Solutions*
