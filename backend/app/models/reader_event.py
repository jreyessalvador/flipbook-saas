from sqlalchemy import Column, String, Integer, BigInteger, Boolean, Date, DateTime, ForeignKey, CHAR
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class ReaderEvent(Base):
    """Lote L6 (migracion 0017): evento anonimo de lectura (sin cookies, sin IP, sin user-agent)."""
    __tablename__ = "reader_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id", ondelete="CASCADE"), nullable=False)
    day = Column(Date, nullable=False)
    visitor = Column(CHAR(16), nullable=False)
    event = Column(String(6), nullable=False)
    page = Column(Integer, nullable=True)
    ms = Column(Integer, nullable=True)
    act = Column(String(10), nullable=True)
    target = Column(String(120), nullable=True)
    src = Column(String(12), nullable=True)
    ref_host = Column(String(120), nullable=True)
    embed = Column(Boolean, nullable=False, default=False)
    country = Column(CHAR(2), nullable=True)
    device = Column(String(8), nullable=True)
    browser = Column(String(10), nullable=True)
    os = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
