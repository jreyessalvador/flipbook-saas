from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime
import uuid

class PageBase(BaseModel):
    page_number: int = Field(..., ge=1)
    page_type: str = Field("content", pattern="^(cover|content|back_cover)$")
    content: Optional[Dict[str, Any]] = Field(default_factory=dict)

class PageCreate(PageBase):
    publication_id: uuid.UUID

class PageUpdate(BaseModel):
    content: Optional[Dict[str, Any]] = None
    thumbnail_url: Optional[str] = None

class PageResponse(PageBase):
    id: uuid.UUID
    publication_id: uuid.UUID
    thumbnail_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
