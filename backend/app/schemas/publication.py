from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid

class PageBase(BaseModel):
    page_number: int
    image_url: str
    thumbnail_url: Optional[str] = None
    width: int = 794
    height: int = 1123
    elements: Optional[List] = []

class PageResponse(PageBase):
    id: uuid.UUID
    publication_id: uuid.UUID
    class Config:
        from_attributes = True

class PublicationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    flip_duration: int = 800
    background_color: str = "#FFFFFF"
    show_controls: bool = True
    allow_download: bool = False

class PublicationUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[str] = None
    flip_duration: Optional[int] = None
    background_color: Optional[str] = None
    show_controls: Optional[bool] = None
    allow_download: Optional[bool] = None
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None

class PublicationResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    created_by: uuid.UUID
    title: str
    description: Optional[str] = None
    slug: str
    cover_url: Optional[str] = None
    status: str
    page_count: int
    flip_duration: int
    background_color: str
    show_controls: bool
    allow_download: bool
    password_protected: bool
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    view_count: int
    unique_views: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    published_at: Optional[datetime] = None
    pages: List[PageResponse] = []
    class Config:
        from_attributes = True

class PublicationList(BaseModel):
    items: List[PublicationResponse]
    total: int
    page: int
    per_page: int
    pages: int

class AssetResponse(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    filename: str
    original_filename: Optional[str] = None
    content_type: Optional[str] = None
    file_size: int
    asset_type: str
    url: Optional[str] = None
    created_at: datetime
    class Config:
        from_attributes = True

class AnalyticsResponse(BaseModel):
    publication_id: uuid.UUID
    total_views: int
    unique_views: int
    avg_pages_read: float
    avg_time_spent: float
    views_by_day: List[dict] = []
