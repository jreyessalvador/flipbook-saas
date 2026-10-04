from sqlalchemy import Column, String, Integer, BigInteger, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid

from app.db.base import Base


class RenderJob(Base):
    """Lote F (migracion 0013): trabajo de exportacion a PDF (worker Contabo 2)."""
    __tablename__ = "render_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id", ondelete="CASCADE"), nullable=False)
    version_id = Column(UUID(as_uuid=True), nullable=True)
    source = Column(String(12), nullable=False, default="published")
    kind = Column(String(12), nullable=False, default="pdf")
    status = Column(String(12), nullable=False, default="queued")
    snapshot = Column(JSONB, nullable=False)
    snapshot_hash = Column(String(64), nullable=False)
    title = Column(String(200), nullable=False, default="")
    page_width = Column(Integer, nullable=False)
    page_height = Column(Integer, nullable=False)
    page_count = Column(Integer, nullable=False, default=0)
    requested_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    result_key = Column(Text, nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    error = Column(Text, nullable=True)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    claimed_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
