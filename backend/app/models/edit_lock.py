from sqlalchemy import Column, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base


class EditLock(Base):
    """
    Bloqueo de "un editor a la vez por publicacion" (decision de Carlos,
    2026-09-12). publication_id es la PK: solo puede existir un lock activo
    por publicacion. El frontend refresca heartbeat_at cada ~20s mientras el
    editor esta abierto; si pasan >60s sin heartbeat, el backend lo trata
    como expirado y lo libera (evita locks "zombis" por cierres abruptos).
    """
    __tablename__ = "edit_locks"

    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id", ondelete="CASCADE"), primary_key=True)
    locked_by_user = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    locked_at = Column(DateTime(timezone=True), server_default=func.now())
    heartbeat_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
