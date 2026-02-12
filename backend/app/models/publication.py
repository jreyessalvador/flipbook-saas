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
