# 🚀 GUÍA DE DESARROLLO - Flipbook SaaS

## 📋 Para el Desarrollador que Continúe el Proyecto

### 🎯 Stack Tecnológico

**Backend:**
- **Lenguaje:** Python 3.11
- **Framework:** FastAPI 0.109.0
- **ORM:** SQLAlchemy 2.0.25
- **Base de datos:** PostgreSQL 15
- **Autenticación:** JWT (python-jose)
- **Validación:** Pydantic 2.5.3

**Frontend:**
- **Lenguaje:** JavaScript (JSX)
- **Framework:** React 18
- **Build Tool:** Vite 5
- **Router:** React Router v6
- **HTTP Client:** Axios
- **State Management:** Context API

---

## 📁 Estructura del Proyecto y Dónde Colocar el Código
```
/opt/flipbook-saas/ (AWS) o ~/flipbook-saas/ (Raspberry Pi)
│
├── backend/
│   ├── app/
│   │   ├── api/                    ← CREAR NUEVOS ENDPOINTS AQUÍ
│   │   │   ├── auth.py            (Autenticación - YA EXISTE)
│   │   │   ├── publications.py    ← CREAR: CRUD de flipbooks
│   │   │   ├── users.py           ← CREAR: Gestión de usuarios
│   │   │   └── analytics.py       ← CREAR: Estadísticas
│   │   │
│   │   ├── models/                 ← CREAR MODELOS DE BD AQUÍ
│   │   │   ├── __init__.py        (Importar todos los modelos)
│   │   │   ├── user.py            (Usuario - YA EXISTE)
│   │   │   ├── tenant.py          (Tenant - YA EXISTE)
│   │   │   ├── publication.py     ← CREAR: Modelo de flipbook
│   │   │   ├── page.py            ← CREAR: Páginas del flipbook
│   │   │   └── asset.py           ← CREAR: Multimedia
│   │   │
│   │   ├── schemas/                ← CREAR SCHEMAS PYDANTIC AQUÍ
│   │   │   ├── user.py            (Validación usuario - YA EXISTE)
│   │   │   ├── publication.py     ← CREAR: Validación flipbooks
│   │   │   └── analytics.py       ← CREAR: Validación stats
│   │   │
│   │   ├── services/               ← CREAR LÓGICA DE NEGOCIO AQUÍ
│   │   │   ├── publication_service.py  ← CREAR: Lógica flipbooks
│   │   │   ├── pdf_processor.py        ← CREAR: Procesar PDFs
│   │   │   └── storage_service.py      ← CREAR: MinIO/S3
│   │   │
│   │   ├── core/                   ← UTILIDADES CENTRALES
│   │   │   ├── security.py        (JWT, passwords - YA EXISTE)
│   │   │   ├── config.py          (Configuración)
│   │   │   └── dependencies.py    ← CREAR: Dependencias comunes
│   │   │
│   │   ├── db/                     ← BASE DE DATOS
│   │   │   ├── base.py            (SQLAlchemy base - YA EXISTE)
│   │   │   ├── session.py         (DB session - YA EXISTE)
│   │   │   └── init_db.py         (Inicialización - YA EXISTE)
│   │   │
│   │   └── main.py                 ← REGISTRAR ROUTERS AQUÍ
│   │
│   ├── tests/                      ← CREAR TESTS AQUÍ
│   │   ├── test_auth.py
│   │   ├── test_publications.py   ← CREAR
│   │   └── test_users.py          ← CREAR
│   │
│   ├── requirements.txt            ← AGREGAR DEPENDENCIAS AQUÍ
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── pages/                  ← CREAR PÁGINAS AQUÍ
│   │   │   ├── Login.jsx          (YA EXISTE)
│   │   │   ├── Dashboard.jsx      (YA EXISTE)
│   │   │   ├── Publications.jsx   ← CREAR: Lista de flipbooks
│   │   │   ├── Editor.jsx         ← CREAR: Editor de flipbooks
│   │   │   ├── Viewer.jsx         ← CREAR: Visor de flipbooks
│   │   │   └── Users.jsx          ← CREAR: Gestión usuarios
│   │   │
│   │   ├── components/             ← CREAR COMPONENTES AQUÍ
│   │   │   ├── common/
│   │   │   │   ├── Navbar.jsx     (YA EXISTE)
│   │   │   │   └── ProtectedRoute.jsx (YA EXISTE)
│   │   │   │
│   │   │   ├── publications/       ← CREAR
│   │   │   │   ├── PublicationCard.jsx
│   │   │   │   ├── PublicationList.jsx
│   │   │   │   └── UploadPDF.jsx
│   │   │   │
│   │   │   ├── editor/             ← CREAR
│   │   │   │   ├── Canvas.jsx
│   │   │   │   ├── Toolbar.jsx
│   │   │   │   └── PageThumbnails.jsx
│   │   │   │
│   │   │   └── viewer/             ← CREAR
│   │   │       ├── FlipbookViewer.jsx
│   │   │       └── PageControls.jsx
│   │   │
│   │   ├── services/               ← SERVICIOS API
│   │   │   ├── api.js             (HTTP client - YA EXISTE)
│   │   │   ├── AuthContext.jsx    (Auth context - YA EXISTE)
│   │   │   ├── publicationAPI.js  ← CREAR: API flipbooks
│   │   │   └── userAPI.js         ← CREAR: API usuarios
│   │   │
│   │   ├── styles/                 ← ESTILOS CSS
│   │   │   └── global.css         (YA EXISTE)
│   │   │
│   │   ├── App.jsx                 ← AGREGAR NUEVAS RUTAS AQUÍ
│   │   └── main.jsx
│   │
│   └── package.json                ← AGREGAR DEPENDENCIAS AQUÍ
│
└── k8s/                            ← MANIFIESTOS KUBERNETES
    └── (no tocar a menos que cambies infraestructura)
```

---

## 🔨 CÓMO DESARROLLAR NUEVAS FUNCIONALIDADES

### Ejemplo Completo: Crear CRUD de Publicaciones (Flipbooks)

#### **1️⃣ Backend: Crear Modelo de Base de Datos**

**Archivo:** `backend/app/models/publication.py`
```python
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.db.base import Base

class Publication(Base):
    __tablename__ = "publications"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(String(200), nullable=False)
    description = Column(String(500))
    cover_image_url = Column(String(500))
    pdf_url = Column(String(500))
    status = Column(String(50), default="draft")  # draft, published, archived
    total_pages = Column(Integer, default=0)
    views_count = Column(Integer, default=0)
    is_public = Column(Boolean, default=False)
    
    # Relaciones
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relaciones ORM
    tenant = relationship("Tenant", back_populates="publications")
    creator = relationship("User", back_populates="publications")
    pages = relationship("Page", back_populates="publication", cascade="all, delete-orphan")
```

**IMPORTANTE:** Agregar al `backend/app/models/__init__.py`:
```python
from app.models.publication import Publication
__all__ = ["Base", "Tenant", "User", "Publication"]
```

---

#### **2️⃣ Backend: Crear Schema de Validación**

**Archivo:** `backend/app/schemas/publication.py`
```python
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid

class PublicationBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    is_public: bool = False

class PublicationCreate(PublicationBase):
    pass

class PublicationUpdate(PublicationBase):
    title: Optional[str] = None
    status: Optional[str] = None

class PublicationResponse(PublicationBase):
    id: uuid.UUID
    cover_image_url: Optional[str]
    total_pages: int
    views_count: int
    status: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
```

---

#### **3️⃣ Backend: Crear Endpoints API**

**Archivo:** `backend/app/api/publications.py`
```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.user import User
from app.models.publication import Publication
from app.schemas.publication import PublicationCreate, PublicationUpdate, PublicationResponse
from app.api.auth import get_current_user

router = APIRouter()

@router.post("/", response_model=PublicationResponse, status_code=status.HTTP_201_CREATED)
def create_publication(
    publication_data: PublicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear una nueva publicación"""
    new_publication = Publication(
        **publication_data.dict(),
        tenant_id=current_user.tenant_id,
        created_by=current_user.id
    )
    
    db.add(new_publication)
    db.commit()
    db.refresh(new_publication)
    
    return new_publication

@router.get("/", response_model=List[PublicationResponse])
def list_publications(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Listar publicaciones del tenant"""
    publications = db.query(Publication)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .offset(skip)\
        .limit(limit)\
        .all()
    
    return publications

@router.get("/{publication_id}", response_model=PublicationResponse)
def get_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener una publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    
    return publication

@router.put("/{publication_id}", response_model=PublicationResponse)
def update_publication(
    publication_id: str,
    publication_data: PublicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Actualizar publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    
    for key, value in publication_data.dict(exclude_unset=True).items():
        setattr(publication, key, value)
    
    db.commit()
    db.refresh(publication)
    
    return publication

@router.delete("/{publication_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Eliminar publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    
    db.delete(publication)
    db.commit()
    
    return None
```

---

#### **4️⃣ Backend: Registrar Router en main.py**

**Archivo:** `backend/app/main.py`
```python
from app.api import auth, publications  # ← AGREGAR IMPORT

# ... código existente ...

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(publications.router, prefix="/api/publications", tags=["Publications"])  # ← AGREGAR
```

---

#### **5️⃣ Frontend: Crear Servicio API**

**Archivo:** `frontend/src/services/publicationAPI.js`
```javascript
import api from './api';

export const publicationAPI = {
  // Listar publicaciones
  list: async (skip = 0, limit = 20) => {
    const response = await api.get(`/api/publications?skip=${skip}&limit=${limit}`);
    return response.data;
  },
  
  // Crear publicación
  create: async (data) => {
    const response = await api.post('/api/publications', data);
    return response.data;
  },
  
  // Obtener una publicación
  get: async (id) => {
    const response = await api.get(`/api/publications/${id}`);
    return response.data;
  },
  
  // Actualizar publicación
  update: async (id, data) => {
    const response = await api.put(`/api/publications/${id}`, data);
    return response.data;
  },
  
  // Eliminar publicación
  delete: async (id) => {
    await api.delete(`/api/publications/${id}`);
  },
};
```

---

#### **6️⃣ Frontend: Crear Página de Publicaciones**

**Archivo:** `frontend/src/pages/Publications.jsx`
```javascript
import React, { useState, useEffect } from 'react';
import { publicationAPI } from '../services/publicationAPI';

const Publications = () => {
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublications();
  }, []);

  const loadPublications = async () => {
    try {
      const data = await publicationAPI.list();
      setPublications(data);
    } catch (error) {
      console.error('Error loading publications:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Cargando...</div>;

  return (
    <div className="publications-container">
      <h2>Mis Publicaciones</h2>
      
      <button onClick={() => {/* TODO: Abrir modal crear */}}>
        Nueva Publicación
      </button>

      <div className="publications-grid">
        {publications.map(pub => (
          <div key={pub.id} className="publication-card">
            <h3>{pub.title}</h3>
            <p>{pub.description}</p>
            <p>Páginas: {pub.total_pages}</p>
            <p>Vistas: {pub.views_count}</p>
            <p>Estado: {pub.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Publications;
```

---

#### **7️⃣ Frontend: Agregar Ruta**

**Archivo:** `frontend/src/App.jsx`
```javascript
import Publications from './pages/Publications';  // ← AGREGAR IMPORT

// ... dentro de Routes ...

<Route
  path="/publications"
  element={
    <ProtectedRoute>
      <>
        <Navbar />
        <Publications />
      </>
    </ProtectedRoute>
  }
/>
```

---

## 🔄 WORKFLOW DE DESARROLLO

### **En Desarrollo (Raspberry Pi):**
```bash
# 1. Ir a branch desarrollo
cd ~/flipbook-saas
git checkout desarrollo
git pull origin desarrollo

# 2. Crear nueva funcionalidad
# Editar archivos según estructura arriba

# 3. Probar backend
cd backend
docker build -t flipbook-backend:latest .
docker save flipbook-backend:latest | sudo k3s ctr images import -
kubectl rollout restart deployment/backend -n flipbook-dev

# Ver logs
kubectl logs -f -n flipbook-dev deployment/backend

# 4. Probar frontend
cd ../frontend
docker build -t flipbook-frontend:latest .
docker save flipbook-frontend:latest | sudo k3s ctr images import -
kubectl rollout restart deployment/frontend -n flipbook-dev

# 5. Probar en navegador
# http://flipbook.local

# 6. Si funciona, hacer commit
git add .
git commit -m "feat: Add publications CRUD"
git push origin desarrollo
```

---

### **Deploy a Producción (AWS):**
```bash
# 1. Merge a staging
git checkout staging
git merge desarrollo
git push origin staging

# 2. En AWS, probar en staging
cd /opt/flipbook-saas
git pull origin staging
./scripts/build-backend.sh
./scripts/build-frontend.sh
# ... deploy y probar ...

# 3. Si OK, merge a main
git checkout main
git merge staging
git push origin main

# 4. Deploy final
./scripts/build-backend.sh
./scripts/build-frontend.sh
# Deploy a K8s...
```

---

## 📚 LIBRERÍAS ÚTILES PARA PRÓXIMAS FUNCIONALIDADES

### **Backend (agregar a `requirements.txt`):**
```txt
# Para procesar PDFs
PyPDF2==3.0.1
pdf2image==1.17.0

# Para MinIO/S3
minio==7.2.3

# Para tasks asíncronas
celery==5.3.4

# Para websockets (real-time)
websockets==12.0

# Para generación de thumbnails
Pillow==10.2.0
```

### **Frontend (agregar a `package.json`):**
```json
{
  "dependencies": {
    // Para drag & drop
    "react-dnd": "^16.0.1",
    
    // Para canvas/editor
    "fabric": "^5.3.0",
    "konva": "^9.2.0",
    "react-konva": "^18.2.10",
    
    // Para flipbook viewer
    "turn.js": "^4.1.0",
    "react-pageflip": "^2.0.3",
    
    // Para upload de archivos
    "react-dropzone": "^14.2.3",
    
    // Para formularios
    "react-hook-form": "^7.49.2",
    
    // Para notificaciones
    "react-toastify": "^9.1.3"
  }
}
```

---

## 🎯 PRÓXIMAS FUNCIONALIDADES PRIORITARIAS

### **Fase 2 - Funcionalidades Core (Próximo Sprint)**

1. **✅ CRUD Publicaciones** (ejemplo completo arriba)
   - Crear, listar, editar, eliminar flipbooks
   - Modelo de datos con metadata
   - API REST completa

2. **📤 Upload de PDFs**
   - Frontend: React Dropzone para arrastrar PDFs
   - Backend: Endpoint para recibir archivos
   - Storage: Guardar en MinIO
   - Validación: Tamaño máximo, tipo de archivo

3. **🔧 Procesador de PDFs**
   - Servicio para convertir PDF a imágenes
   - Usar pdf2image + Pillow
   - Generar thumbnails
   - Guardar metadata (número de páginas)

4. **🎨 Editor Básico**
   - Canvas con Fabric.js o Konva
   - Agregar texto sobre páginas
   - Agregar imágenes
   - Cambiar orden de páginas

5. **📖 Viewer de Flipbooks**
   - Efecto de hojas girando
   - Controles de navegación
   - Zoom
   - Pantalla completa

6. **📊 Analytics**
   - Contador de vistas
   - Tiempo de lectura
   - Páginas más vistas
   - Gráficas con Chart.js

7. **👥 Gestión de Usuarios**
   - CRUD de usuarios del tenant
   - Asignación de roles
   - Permisos por publicación

8. **🔗 Compartir Publicaciones**
   - URLs públicas
   - Protección con contraseña opcional
   - Embed code para sitios web

---

## 📝 COMANDOS ÚTILES

### **Desarrollo Local:**
```bash
# Ver pods
kubectl get pods -n flipbook-dev

# Ver logs en tiempo real
kubectl logs -f -n flipbook-dev deployment/backend
kubectl logs -f -n flipbook-dev deployment/frontend

# Entrar a un pod
kubectl exec -it -n flipbook-dev deployment/backend -- /bin/sh

# Reiniciar deployment
kubectl rollout restart deployment/backend -n flipbook-dev

# Ver servicios
kubectl get svc -n flipbook-dev

# Ver ingress
kubectl get ingress -n flipbook-dev

# Ver base de datos
kubectl exec -it -n flipbook-dev postgresql-0 -- psql -U flipbook -d flipbook
```

### **Probar API directamente:**
```bash
# Login
curl -X POST "http://api.flipbook.local/api/auth/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin@flipbook.app&password=admin123"

# Obtener usuario actual (con token)
curl -X GET "http://api.flipbook.local/api/auth/me" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Listar publicaciones
curl -X GET "http://api.flipbook.local/api/publications" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

## 🐛 TROUBLESHOOTING

### **Pod en CrashLoopBackOff:**
```bash
kubectl logs -n flipbook-dev <pod-name>
kubectl describe pod -n flipbook-dev <pod-name>
```

### **Backend no conecta a BD:**
```bash
# Verificar contraseña
kubectl get secret backend-secret -n flipbook-dev -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d

# Verificar variable de entorno en pod
kubectl exec -n flipbook-dev deployment/backend -- env | grep DATABASE_URL
```

### **Frontend no conecta a Backend:**
```bash
# Verificar ConfigMap
kubectl get configmap frontend-config -n flipbook-dev -o yaml

# Reconstruir con URL correcta
cd frontend
echo 'VITE_API_URL=http://api.flipbook.local' > .env
docker build -t flipbook-frontend:latest .
```

---

## 📞 INFORMACIÓN DE CONTACTO

**Repositorio:** https://github.com/jreyessalvador/flipbook-saas  
**Documentación Principal:** `/docs/DOCUMENTATION.md`  
**Developer Original:** Carlos (@jreyessalvador)  
**Email:** jreyes.salvador@gmail.com

---

**Última actualización:** Febrero 12, 2026  
**Versión:** 1.0.0
