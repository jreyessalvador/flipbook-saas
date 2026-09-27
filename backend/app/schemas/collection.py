from typing import Optional
from datetime import datetime
import uuid
from pydantic import BaseModel, Field


class CategoryResponse(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    sort_order: int
    is_active: bool

    class Config:
        from_attributes = True


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    sort_order: int = 500


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    category_id: Optional[uuid.UUID] = None


class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    description: Optional[str] = Field(None, max_length=1000)
    category_id: Optional[uuid.UUID] = None


class CollectionResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    slug: str
    description: Optional[str] = None
    category_id: Optional[uuid.UUID] = None
    category_name: Optional[str] = None
    is_default: bool
    edition_count: int = 0
    published_count: int = 0
    cover_image_url: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MoveEditionRequest(BaseModel):
    collection_id: uuid.UUID
