from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid

from app.db.base import Base


class PublicationVersion(Base):
    """Snapshot inmutable de una publicacion completa (todas sus paginas +
    elementos) en el momento de "Publicar". El Reader publico SIEMPRE lee de
    aqui, nunca de las tablas editables -- asi una edicion a medias nunca
    llega a un lector, y queda historial para poder revertir."""
    __tablename__ = "publication_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot = Column(JSONB, nullable=False)  # {orientation, page_width, page_height, pages: [{page_number, page_type, elements: [...]}]}
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
