from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from app.db.base import Base

class Publication(Base):
    __tablename__ = "publications"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    slug = Column(String(255), nullable=False, index=True)
    cover_url = Column(String(500))
    status = Column(String(20), default="draft", nullable=False)
    page_count = Column(Integer, default=0)
    flip_duration = Column(Integer, default=800)
    background_color = Column(String(7), default="#FFFFFF")
    show_controls = Column(Boolean, default=True)
    allow_download = Column(Boolean, default=False)
    password_protected = Column(Boolean, default=False)
    password_hash = Column(String(255))
    seo_title = Column(String(255))
    seo_description = Column(Text)
    view_count = Column(Integer, default=0)
    unique_views = Column(Integer, default=0)
    meta = Column(JSONB, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    published_at = Column(DateTime(timezone=True))
    pages = relationship("Page", back_populates="publication", order_by="Page.page_number", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="publication", cascade="all, delete-orphan")
