from sqlalchemy import Column, String, BigInteger, Integer, Numeric, DateTime, ForeignKey, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid

from app.db.base import Base


class Asset(Base):
    """Metadatos de un archivo subido a MinIO (imagen/video/audio), independiente
    de en cuantos page_elements se use. api/assets.py ya sube el binario a MinIO;
    este modelo es la pieza que faltaba para poder referenciar assets por id
    desde props de page_elements en vez de guardar URLs sueltas."""
    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint("kind IN ('image','video','audio')", name="ck_assets_kind"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False, index=True)
    kind = Column(String(10), nullable=False)
    storage_key = Column(String(500), nullable=False)
    mime_type = Column(String(100), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    width_px = Column(Integer, nullable=True)
    height_px = Column(Integer, nullable=True)
    duration_seconds = Column(Numeric, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
