from sqlalchemy import Column, String, Integer, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.db.base import Base

class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    subdomain = Column(String(100), unique=True, nullable=False)
    schema_name = Column(String(100), unique=True, nullable=False)
    plan = Column(String(50), default="free")  # free, pro, enterprise
    status = Column(String(20), default="active")  # active, suspended, cancelled
    max_publications = Column(Integer, default=1)
    max_storage_mb = Column(Integer, default=500)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relaciones
    publications = relationship("Publication", back_populates="tenant")
