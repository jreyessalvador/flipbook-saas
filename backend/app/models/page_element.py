from sqlalchemy import Column, String, Integer, Numeric, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid

from app.db.base import Base


class PageElement(Base):
    """
    Un elemento de canvas (imagen/texto/figura/video/audio/hotspot).

    DECISION DE DISENO (ver docs/arquitectura-editor-2026-09-12.md, seccion 3):
    page_id es NOT NULL con FK -- un elemento NUNCA puede existir sin pagina, y
    nunca se infiere ni se copia por posicion de array. Esto reemplaza el
    campo Page.content (JSON blob con "hotspots, textos, imagenes, etc.") que
    causaba fuga de contenido entre paginas (incluida portada<->contraportada)
    porque era un unico objeto mutable compartido.
    """
    __tablename__ = "page_elements"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('image','text','shape','video','audio','hotspot','gallery','embed')",
            name="ck_page_elements_kind",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id = Column(UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)

    x = Column(Numeric, nullable=False)
    y = Column(Numeric, nullable=False)
    width = Column(Numeric, nullable=False)
    height = Column(Numeric, nullable=False)
    rotation_deg = Column(Numeric, nullable=False, default=0)
    z_index = Column(Integer, nullable=False, default=0)

    props = Column(JSONB, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    page = relationship("Page", back_populates="elements")
