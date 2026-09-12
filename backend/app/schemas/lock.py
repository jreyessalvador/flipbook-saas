from pydantic import BaseModel
from datetime import datetime
import uuid


class LockResponse(BaseModel):
    publication_id: uuid.UUID
    locked_by_user: uuid.UUID
    locked_by_name: str | None = None
    locked_at: datetime
    heartbeat_at: datetime


class LockConflict(BaseModel):
    detail: str
    locked_by_name: str | None = None
    heartbeat_at: datetime
