from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    role = Column(String(20), default="editor")  # admin, editor, viewer
    is_active = Column(Boolean, default=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    last_login = Column(DateTime(timezone=True))
    # Lote EQ-1 (migracion 0014): version de sesion (va en el JWT como "tv").
    # Subirla invalida al instante todos los tokens anteriores del usuario.
    token_version = Column(Integer, nullable=False, default=0)
    password_changed_at = Column(DateTime(timezone=True), nullable=True)
    pw_change_failures = Column(Integer, nullable=False, default=0)
    pw_change_locked_until = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    publications = relationship("Publication", back_populates="creator", foreign_keys="Publication.created_by")
