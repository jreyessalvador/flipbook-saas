from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
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
    
    # DEPRECADO (ver docs/arquitectura-editor-2026-09-12.md, seccion 1): este
    # blob JSON compartido fue la causa raiz de la fuga de contenido entre
    # paginas (incl. portada<->contraportada) y del cambio de orientacion
    # "solo" del editor anterior. Ya NO se escribe desde el editor nuevo -- los
    # elementos viven en la tabla page_elements (relacion "elements" abajo).
    # Se deja la columna sin borrar por si hace falta migrar datos historicos.
    content = Column(JSON, default={})
    
    # Thumbnail de la página
    thumbnail_url = Column(String(500))
    
    # Concurrencia optimista (ver docs/arquitectura-editor-2026-09-12.md, seccion 5):
    # PUT /pages/{id}/elements debe enviar este valor; si no coincide con el
    # actual en BD, se rechaza con 409 en vez de sobrescribir en silencio.
    version = Column(BigInteger, nullable=False, default=1)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones ORM
    publication = relationship("Publication", back_populates="pages")
    elements = relationship("PageElement", back_populates="page", cascade="all, delete-orphan", order_by="PageElement.z_index")
