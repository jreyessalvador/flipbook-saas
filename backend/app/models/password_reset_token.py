import uuid
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from app.db.base import Base
class PasswordResetToken(Base):
    __tablename__="password_reset_tokens"
    id=Column(UUID(as_uuid=True),primary_key=True,default=uuid.uuid4); user_id=Column(UUID(as_uuid=True),ForeignKey("users.id",ondelete="CASCADE"),nullable=False); token_hash=Column(String(128),unique=True,nullable=False); expires_at=Column(DateTime(timezone=True),nullable=False); used_at=Column(DateTime(timezone=True)); requested_by=Column(UUID(as_uuid=True),ForeignKey("users.id")); created_at=Column(DateTime(timezone=True),server_default=func.now())
