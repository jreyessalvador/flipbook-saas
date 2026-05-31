from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
import uuid
from app.db.base import Base

class PageView(Base):
    __tablename__ = "page_views"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    publication_id = Column(UUID(as_uuid=True), ForeignKey("publications.id"), nullable=False, index=True)
    session_id = Column(String(64), index=True)
    ip_hash = Column(String(64))
    user_agent = Column(String(255))
    country = Column(String(2))
    pages_read = Column(Integer, default=1)
    time_spent = Column(Integer, default=0)
    referrer = Column(String(500))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
