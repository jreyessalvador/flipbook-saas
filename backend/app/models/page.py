from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from app.db.base import Base

class Page(Base):
    __tablename__ = "pages"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id"), nullable=False, index=True)
    page_number = Column(Integer, nullable=False)
    image_url = Column(String(500), nullable=False)
    thumbnail_url = Column(String(500))
    width = Column(Integer, default=794)
    height = Column(Integer, default=1123)
    elements = Column(JSONB, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    publication = relationship("Publication", back_populates="pages")
