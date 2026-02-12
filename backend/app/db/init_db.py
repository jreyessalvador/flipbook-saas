from sqlalchemy.orm import Session
from app.models.tenant import Tenant
from app.models.user import User
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
    
    # Verificar si ya existe un usuario admin
    admin = db.query(User).filter(User.email == "admin@flipbook.app").first()
    if not admin:
        # Crear usuario admin por defecto
        admin = User(
            id=uuid.uuid4(),
            email="admin@flipbook.app",
            password_hash=get_password_hash("admin123"),
            full_name="Administrator",
            role="admin",
            is_active=True,
            tenant_id=tenant.id
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(f"✅ Usuario admin creado")
        print(f"   Email: admin@flipbook.app")
        print(f"   Password: admin123")
        print(f"   ⚠️  CAMBIAR CONTRASEÑA EN PRODUCCIÓN!")
    
    return tenant, admin

if __name__ == "__main__":
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        init_db(db)
    finally:
        db.close()
