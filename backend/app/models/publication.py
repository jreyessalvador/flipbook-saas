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

    # Configuración de revista -- orientation/page_width/page_height se fijan al
    # crear la publicacion y NO deben cambiarse via PUT /publications/{id} normal
    # (ver PublicationUpdate en schemas/publication.py): el editor anterior
    # sufria un bug donde la orientacion "cambiaba sola"; aqui se trata como un
    # dato inmutable salvo una operacion explicita aparte, no implementada aun.
    page_size = Column(String(20), default="A4")  # A4, Letter, Legal, Custom
    page_width = Column(Integer, default=210)  # mm
    page_height = Column(Integer, default=297)  # mm
    orientation = Column(String(20), default="portrait")  # portrait, landscape
    creation_type = Column(String(20), default="blank")  # blank, pdf

    # Sonido de "pase de pagina" del Reader (opcional, ver seccion 8 del doc de arquitectura)
    page_turn_sound_asset_id = Column(UUID(as_uuid=True), ForeignKey("assets.id"), nullable=True)

    # Publicacion inmutable actualmente vigente para el Reader (seccion 5)
    published_version_id = Column(UUID(as_uuid=True), ForeignKey("publication_versions.id"), nullable=True)

    # Relaciones
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relaciones ORM
    tenant = relationship("Tenant", back_populates="publications")
    creator = relationship("User", back_populates="publications")
    pages = relationship("Page", back_populates="publication", cascade="all, delete-orphan")
