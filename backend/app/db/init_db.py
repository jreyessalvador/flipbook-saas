from sqlalchemy.orm import Session
from app.models.tenant import Tenant
from app.models.user import User
# Importar el catálogo comercial y RBAC antes de create_all: una instalación
# nueva debe crear estas tablas igual que una existente las recibe por 0004.
from app.models.commercial import Plan, TenantSubscription, TenantUsage, TenantDomain, Role, UserPlatformRole, TenantMembership
from app.core.security import get_password_hash
from app.db.base import Base
from app.db.session import engine
import uuid

def init_db(db: Session):
    # Crear las tablas
    Base.metadata.create_all(bind=engine)
    
    # Verificar si ya existe un tenant
    tenant = db.query(Tenant).first()
    if not tenant:
        # Crear tenant por defecto
        tenant = Tenant(
            id=uuid.uuid4(),
            name="Default Organization",
            subdomain="default",
            schema_name="tenant_default",
            plan="pro",
            status="active",
            max_publications=50,
            max_storage_mb=10240
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        print(f"✅ Tenant creado: {tenant.name}")
    
    # Usuario admin inicial: SOLO si se pasa INIT_ADMIN_EMAIL + INIT_ADMIN_PASSWORD
    # (sin credenciales por defecto: antes sembraba admin@flipbook.app / admin123).
    import os
    email = (os.getenv("INIT_ADMIN_EMAIL") or "").strip().lower()
    password = os.getenv("INIT_ADMIN_PASSWORD") or ""
    admin = None
    if not email or len(password) < 12:
        print("Sin INIT_ADMIN_EMAIL/INIT_ADMIN_PASSWORD (min. 12 caracteres): no se crea usuario admin.")
        return tenant, admin
    admin = db.query(User).filter(User.email == email).first()
    if not admin:
        admin = User(
            id=uuid.uuid4(),
            email=email,
            password_hash=get_password_hash(password),
            full_name="Administrador",
            role="admin",
            is_active=True,
            tenant_id=tenant.id
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(f"Usuario admin creado: {email}")

    return tenant, admin

if __name__ == "__main__":
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()
