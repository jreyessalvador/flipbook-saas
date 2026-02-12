cd /opt/flipbook-saas

cat > DOCUMENTATION.md << 'EOF'
# 📚 Flipbook SaaS - Documentación Completa del Proyecto

**Fecha de creación:** Febrero 11-12, 2026
**Desarrollador:** Carlos (@jreyessalvador)
**Repositorio:** https://github.com/jreyessalvador/flipbook-saas

---

## 🎯 Descripción del Proyecto

Plataforma SaaS profesional para crear, gestionar y publicar revistas digitales interactivas (flipbooks). Sistema multi-tenant con editor visual, visor de flipbooks, gestión de usuarios y analytics.

---

## 🏗️ Arquitectura Técnica

### Stack Tecnológico

**Backend:**
- FastAPI 0.109.0 (Python 3.11)
- PostgreSQL 15 (Base de datos principal)
- Redis 7 (Cache y sesiones)
- SQLAlchemy 2.0 (ORM)
- JWT (Autenticación)
- Celery (Tasks asíncronas)

**Frontend:**
- React 18
- Vite 5
- React Router v6
- Axios
- Context API

**Infraestructura:**
- AWS EC2 (Amazon Linux 2023)
- K3s (Kubernetes ligero)
- Docker
- Nginx Ingress Controller
- Cert-Manager (SSL Let's Encrypt)
- MinIO (S3-compatible storage)

**DevOps:**
- Git/GitHub
- Docker multi-stage builds
- Kubernetes manifests
- Automated SSL certificates

---

## 🌐 URLs del Sistema

- **Frontend:** https://miflipbook.duckdns.org
- **Backend API:** https://api.miflipbook.duckdns.org
- **API Docs (Swagger):** https://api.miflipbook.duckdns.org/api/docs
- **API Redoc:** https://api.miflipbook.duckdns.org/api/redoc

---

## 🔐 Credenciales

### Usuario Admin
```
Email: admin@flipbook.app
Password: admin123
Role: admin
⚠️ CAMBIAR EN PRODUCCIÓN
```

### Base de Datos PostgreSQL
```
Host: postgresql.flipbook-prod.svc.cluster.local
Port: 5432
Database: flipbook
User: flipbook
Password: qxc1nQDSHnmUB3z31CDHhLHxyBRbl+gQZpm/7tFbZJQ=
```

### Redis
```
Host: redis.flipbook-prod.svc.cluster.local
Port: 6379
```

### MinIO
```
Endpoint: minio.flipbook-prod.svc.cluster.local:9000
Access Key: admin
Secret Key: LHQGOE5cI7RuBnGmonml9XRWmWR/dRhTO18w4qLkVKs=
Console: http://minio:9001
```

### AWS EC2
```
Instance: ip-172-31-23-97.ec2.internal
Public IP: 34.229.172.251
User: ec2-user
OS: Amazon Linux 2023
```

---

## 📁 Estructura del Proyecto
```
/opt/flipbook-saas/
├── backend/                    # Backend FastAPI
│   ├── app/
│   │   ├── api/               # Endpoints
│   │   │   └── auth.py        # Autenticación
│   │   ├── core/              # Configuración central
│   │   │   └── security.py    # JWT, hashing
│   │   ├── db/                # Base de datos
│   │   │   ├── base.py        # SQLAlchemy Base
│   │   │   ├── session.py     # DB Session
│   │   │   └── init_db.py     # Inicialización
│   │   ├── models/            # Modelos SQLAlchemy
│   │   │   ├── user.py
│   │   │   └── tenant.py
│   │   ├── schemas/           # Pydantic schemas
│   │   │   └── user.py
│   │   ├── services/          # Lógica de negocio
│   │   ├── utils/             # Utilidades
│   │   ├── config.py          # Configuración
│   │   └── main.py            # Entry point
│   ├── tests/                 # Tests
│   ├── Dockerfile             # Docker image
│   ├── requirements.txt       # Dependencias Python
│   └── .env.example          # Variables de entorno
│
├── frontend/                  # Frontend React
│   ├── src/
│   │   ├── components/
│   │   │   └── common/
│   │   │       ├── Navbar.jsx
│   │   │       └── ProtectedRoute.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   └── Dashboard.jsx
│   │   ├── services/
│   │   │   ├── api.js
│   │   │   └── AuthContext.jsx
│   │   ├── styles/
│   │   │   └── global.css
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── public/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
│
├── workers/                   # Celery workers
│   ├── tasks/
│   └── celery_app.py
│
├── k8s/                       # Kubernetes manifests
│   ├── base/                  # Namespace, RBAC
│   ├── backend/
│   │   ├── configmap.yaml
│   │   ├── secret.yaml
│   │   └── deployment.yaml
│   ├── frontend/
│   │   ├── configmap.yaml
│   │   └── deployment.yaml
│   ├── database/
│   │   ├── postgresql.yaml
│   │   ├── redis.yaml
│   │   └── minio.yaml
│   ├── ingress/
│   │   └── ingress.yaml
│   ├── monitoring/
│   └── workers/
│
├── scripts/                   # Automation scripts
│   ├── build-backend.sh
│   ├── build-frontend.sh
│   └── bootstrap.sh           # Server setup
│
├── docs/                      # Documentation
│   └── DOCUMENTATION.md       # Este archivo
│
├── docker-compose.yml         # Desarrollo local
├── Makefile                   # Build commands
├── .gitignore
└── README.md
```

---

## 🚀 Instalación y Configuración

### 1. Configuración del Servidor AWS EC2

**Requisitos:**
- Amazon Linux 2023
- 2+ vCPUs
- 4+ GB RAM
- 20+ GB Storage
- Security Group: puertos 22, 80, 443 abiertos

**Bootstrap inicial:**
```bash
# Script de instalación automática
curl -O https://raw.githubusercontent.com/jreyessalvador/flipbook-saas/main/scripts/bootstrap.sh
chmod +x bootstrap.sh
sudo ./bootstrap.sh
```

**Componentes instalados:**
- K3s (Kubernetes)
- Docker
- kubectl
- Nginx Ingress Controller
- Cert-Manager
- PostgreSQL (StatefulSet)
- Redis (StatefulSet)
- MinIO (StatefulSet)

### 2. Configuración de DNS

**DuckDNS:**
```
Dominio: miflipbook.duckdns.org
IP: 34.229.172.251
Subdominio API: api.miflipbook.duckdns.org
```

### 3. Configuración de iptables

**Problema resuelto:** iptables bloqueaba tráfico de contenedores

**Solución:**
```bash
# Eliminar reglas genéricas
iptables -t nat -D PREROUTING 3
iptables -t nat -D PREROUTING 4

# Agregar reglas específicas para interfaz externa
iptables -t nat -A PREROUTING -i ens5 -p tcp --dport 80 -j REDIRECT --to-port 30767
iptables -t nat -A PREROUTING -i ens5 -p tcp --dport 443 -j REDIRECT --to-port 30484

# Guardar
iptables-save > /etc/sysconfig/iptables
```

### 4. Configuración de Docker DNS
```bash
cat > /etc/docker/daemon.json << 'EOF'
{
  "dns": ["8.8.8.8", "8.8.4.4"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker
```

---

## 🔧 Comandos de Desarrollo

### Backend
```bash
# Build imagen
cd /opt/flipbook-saas
./scripts/build-backend.sh

# Importar a K3s
docker save flipbook-backend:latest | k3s ctr images import -

# Deploy
kubectl apply -f k8s/backend/
kubectl rollout restart deployment/backend -n flipbook-prod

# Logs
kubectl logs -n flipbook-prod deployment/backend --tail=100

# Inicializar base de datos
kubectl exec -it -n flipbook-prod deployment/backend -- python -m app.db.init_db
```

### Frontend
```bash
# Instalar dependencias
cd /opt/flipbook-saas/frontend
npm install

# Build imagen
./scripts/build-frontend.sh

# Importar a K3s
docker save flipbook-frontend:latest | k3s ctr images import -

# Deploy
kubectl apply -f k8s/frontend/
kubectl rollout restart deployment/frontend -n flipbook-prod

# Logs
kubectl logs -n flipbook-prod deployment/frontend --tail=100
```

### Kubernetes
```bash
# Ver todos los recursos
kubectl get all -n flipbook-prod

# Ver pods
kubectl get pods -n flipbook-prod

# Ver logs de un pod específico
kubectl logs -n flipbook-prod <pod-name>

# Entrar a un pod
kubectl exec -it -n flipbook-prod <pod-name> -- /bin/sh

# Ver ingress
kubectl get ingress -n flipbook-prod

# Ver certificados SSL
kubectl get certificate -n flipbook-prod

# Restart deployment
kubectl rollout restart deployment/<name> -n flipbook-prod
```

---

## 🔄 Workflow Git

### Branches

- **main** - Producción
- **staging** - Pre-producción (testing)
- **desarrollo** - Desarrollo activo

### Flujo de trabajo
```bash
# 1. Desarrollo
git checkout desarrollo
# ... hacer cambios ...
git add .
git commit -m "feat: nueva funcionalidad"
git push origin desarrollo

# 2. Testing en staging
git checkout staging
git merge desarrollo
git push origin staging

# 3. Deploy a producción
git checkout main
git merge staging
git push origin main

# 4. En servidor (producción)
cd /opt/flipbook-saas
git pull origin main
./scripts/build-backend.sh
./scripts/build-frontend.sh
# ... import y deploy ...
```

---

## 🗄️ Base de Datos

### Schema Multi-Tenant

**Tablas públicas (compartidas):**
- `tenants` - Organizaciones/empresas
- `users` - Usuarios del sistema

**Tablas por tenant (schema dedicado):**
- `publications` - Flipbooks
- `pages` - Páginas de flipbooks
- `assets` - Archivos multimedia
- `analytics` - Estadísticas

### Modelo de Datos

**Tenant:**
```python
id: UUID
name: str
subdomain: str
schema_name: str
plan: str (free, pro, enterprise)
status: str (active, suspended, cancelled)
max_publications: int
max_storage_mb: int
created_at: datetime
updated_at: datetime
```

**User:**
```python
id: UUID
email: str (unique)
password_hash: str
full_name: str
role: str (admin, editor, viewer)
is_active: bool
tenant_id: UUID (FK)
last_login: datetime
created_at: datetime
updated_at: datetime
```

---

## 🔐 Seguridad

### Autenticación JWT

- **Algoritmo:** HS256
- **Expiración:** 60 minutos
- **Secret Key:** Almacenado en Kubernetes Secret

### Passwords

- **Hashing:** bcrypt
- **Rounds:** Default (10)

### SSL/TLS

- **Proveedor:** Let's Encrypt
- **Renovación:** Automática con Cert-Manager
- **Certificado:** Válido para miflipbook.duckdns.org y api.miflipbook.duckdns.org

### CORS

Actualmente configurado como `allow_origins=["*"]` para desarrollo.

**⚠️ En producción cambiar a:**
```python
allow_origins=[
    "https://miflipbook.duckdns.org",
    "https://www.miflipbook.duckdns.org"
]
```

---

## 📊 Monitoreo y Logs

### Ver logs en tiempo real
```bash
# Backend
kubectl logs -f -n flipbook-prod deployment/backend

# Frontend
kubectl logs -f -n flipbook-prod deployment/frontend

# Todos los pods
kubectl logs -f -n flipbook-prod --all-containers=true
```

### Health Checks

- **Backend:** https://api.miflipbook.duckdns.org/health
- **Ready:** https://api.miflipbook.duckdns.org/ready

---

## 🐛 Troubleshooting

### Problema: Pods en CrashLoopBackOff
```bash
# Ver logs del pod
kubectl logs -n flipbook-prod <pod-name>

# Describe pod para ver eventos
kubectl describe pod -n flipbook-prod <pod-name>
```

### Problema: No puedo acceder a la API
```bash
# Verificar ingress
kubectl get ingress -n flipbook-prod

# Verificar certificado SSL
kubectl get certificate -n flipbook-prod
kubectl describe certificate flipbook-tls -n flipbook-prod

# Probar desde dentro del cluster
kubectl run test --rm -it --image=curlimages/curl -n flipbook-prod -- curl http://backend:8000/health
```

### Problema: Error de autenticación en base de datos
```bash
# Verificar contraseña en secret
kubectl get secret backend-secret -n flipbook-prod -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d

# Verificar variable de entorno en pod
kubectl exec -n flipbook-prod deployment/backend -- env | grep DATABASE_URL
```

### Problema: DNS no resuelve
```bash
# En servidor
dig miflipbook.duckdns.org +short

# Limpiar cache DNS
systemctl restart systemd-resolved
```

---

## 📈 Métricas Actuales

**Infraestructura:**
- Pods ejecutándose: 7
- Réplicas Backend: 2
- Réplicas Frontend: 2
- Uso CPU: ~500m
- Uso RAM: ~1.5GB
- Storage: ~5GB

**Imágenes Docker:**
- Backend: 675MB
- Frontend: 62MB

---

## 🚧 Pendientes y Roadmap

### Fase 1 - MVP Completado ✅
- [x] Infraestructura Kubernetes
- [x] Base de datos PostgreSQL
- [x] Backend API con FastAPI
- [x] Sistema de autenticación JWT
- [x] Frontend React básico
- [x] Login funcional
- [x] Dashboard simple
- [x] SSL con Let's Encrypt
- [x] Repositorio Git

### Fase 2 - Funcionalidades Core
- [ ] CRUD de publicaciones
- [ ] Editor de flipbooks (canvas)
- [ ] Importar PDFs
- [ ] Viewer de flipbooks interactivo
- [ ] Sistema de permisos granular
- [ ] Gestión de usuarios (CRUD)

### Fase 3 - Features Avanzadas
- [ ] Upload de multimedia (imágenes, videos, audio)
- [ ] MinIO integration completa
- [ ] Analytics y estadísticas
- [ ] URLs públicas para flipbooks
- [ ] Password protection para flipbooks
- [ ] SEO optimization

### Fase 4 - Producción
- [ ] Tests automatizados
- [ ] CI/CD pipeline
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Backups automáticos
- [ ] Rate limiting
- [ ] CDN integration

---

## 📞 Contacto y Soporte

**Developer:** Carlos
**Email:** jreyes.salvador@gmail.com
**GitHub:** https://github.com/jreyessalvador
**Repository:** https://github.com/jreyessalvador/flipbook-saas

---

## 📝 Notas Importantes

### Problemas Resueltos Durante el Desarrollo

1. **iptables bloqueando Docker:** Configurar reglas específicas por interfaz
2. **Cert-Manager no podía conectar a Let's Encrypt:** Problema de iptables en puerto 443
3. **Email validation con .local:** Cambiar a dominio válido (.app)
4. **ImagePullBackOff:** Importar imágenes locales a K3s con `ctr images import`
5. **Foreign key error:** Faltaba importar modelos en `__init__.py`
6. **bcrypt compatibility:** Fijar versión compatible en requirements.txt

### Lecciones Aprendidas

- K3s es excelente para producción en recursos limitados
- iptables requiere configuración cuidadosa en AWS
- Let's Encrypt automation con Cert-Manager es muy confiable
- Multi-stage Docker builds reducen significativamente tamaño de imágenes
- Context API es suficiente para state management en apps pequeñas

---

**Última actualización:** Febrero 12, 2026
**Versión:** 1.0.0
EOF
