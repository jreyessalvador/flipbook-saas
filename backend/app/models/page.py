from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.db.base import Base

class Page(Base):
    __tablename__ = "pages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id"), nullable=False)
    page_number = Column(Integer, nullable=False)  # 1, 2, 3, ...
    page_type = Column(String(20), default="content")  # cover, content, back_cover
    
    # Contenido de la página (JSON con elementos)
    content = Column(JSON, default={})  # Guardará hotspots, textos, imágenes, etc.
    
    # Thumbnail de la página
    thumbnail_url = Column(String(500))
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones ORM
    publication = relationship("Publication", back_populates="pages")
