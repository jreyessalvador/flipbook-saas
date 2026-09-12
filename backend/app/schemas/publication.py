from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
import uuid

class PublicationBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    is_public: bool = False

class PublicationCreate(PublicationBase):
    # Configuración de revista
    page_size: Optional[str] = Field("A4", pattern="^(A4|Letter|Legal|Custom)$")
    page_width: Optional[int] = Field(210, ge=50, le=500)  # mm
    page_height: Optional[int] = Field(297, ge=50, le=1000)  # mm
    orientation: Optional[str] = Field("portrait", pattern="^(portrait|landscape)$")
    creation_type: Optional[str] = Field("blank", pattern="^(blank|pdf)$")
    total_pages: Optional[int] = Field(10, ge=2, le=500)  # Mínimo 2 (portada + contraportada)

class PublicationUpdate(PublicationBase):
    """
    DECISION (2026-09-12, ver docs/arquitectura-editor-2026-09-12.md seccion 3.1):
    orientation/page_width/page_height/total_pages se fijan al CREAR la
    publicacion y NO son editables via este endpoint -- deliberadamente, para
    que la orientacion nunca pueda "cambiar sola" como en el editor anterior.
    Cambiarlas requeriria una operacion explicita aparte (no implementada aun,
    ver seccion 3.1 y 12 del documento de arquitectura).
    """
    title: Optional[str] = None
    status: Optional[str] = None

class PublicationResponse(PublicationBase):
    id: uuid.UUID
    cover_image_url: Optional[str]
    pdf_url: Optional[str]
    total_pages: int
    views_count: int
    status: str
    page_size: str
    page_width: int
    page_height: int
    orientation: str
    creation_type: str
    created_at: datetime
    updated_at: datetime
    tenant_id: uuid.UUID
    created_by: uuid.UUID

    class Config:
        from_attributes = True
