from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import uuid

class PublicationBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    is_public: bool = False

class PublicationCreate(PublicationBase):
    pass

class PublicationUpdate(PublicationBase):
    title: Optional[str] = None
    status: Optional[str] = None

class PublicationResponse(PublicationBase):
    id: uuid.UUID
    cover_image_url: Optional[str]
    pdf_url: Optional[str]
    total_pages: int
    views_count: int
    status: str
    created_at: datetime
    updated_at: datetime
    tenant_id: uuid.UUID
    created_by: uuid.UUID

    class Config:
        from_attributes = True
