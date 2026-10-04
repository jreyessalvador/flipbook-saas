from sqlalchemy import Column, String, BigInteger, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class ShortLink(Base):
    """Lote S1 (migracion 0012): enlace corto FIJO por edicion (/s/{code})."""
    __tablename__ = "short_links"

    code = Column(String(16), primary_key=True)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id", ondelete="CASCADE"), nullable=False, unique=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    clicks = Column(BigInteger, nullable=False, default=0)
    last_click_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
