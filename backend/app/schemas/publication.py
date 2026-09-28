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
    collection_id: Optional[uuid.UUID] = None  # Lote C: sin valor = coleccion "General"
    edition_label: Optional[str] = Field(None, max_length=100)

class PublicationUpdate(PublicationBase):
    """
    DECISION (2026-09-12, ver docs/arquitectura-editor-2026-09-12.md seccion 3.1):
    orientation/page_width/page_height/total_pages se fijan al CREAR la
    publicacion y NO son editables via este endpoint -- deliberadamente, para
    que la orientacion nunca pueda "cambiar sola" como en el editor anterior.
    Cambiarlas requeriria una operacion explicita aparte (no implementada aun,
    ver seccion 3.1 y 12 del documento de arquitectura).
    """
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=500)
    edition_label: Optional[str] = Field(None, max_length=100)
    # Lote L4: ajustes de la edicion (pestanas Visor y SEO)
    sound_enabled: Optional[bool] = None
    page_turn_sound_asset_id: Optional[uuid.UUID] = None  # null explicito = sonido por defecto
    seo_title: Optional[str] = Field(None, max_length=70)
    seo_description: Optional[str] = Field(None, max_length=160)
    seo_indexable: Optional[bool] = None


class PublicationClone(BaseModel):
    """Clonar una edicion (Lote L4): copia completa como borrador privado."""
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    edition_label: Optional[str] = Field(None, max_length=100)
    collection_id: Optional[uuid.UUID] = None  # sin valor = misma coleccion


class PublicationVisibilityUpdate(BaseModel):
    """Control explícito de presencia en el catálogo/Reader público.

    El estado editorial (borrador/publicado) se cambia exclusivamente con
    las operaciones ``/publish`` y ``/unpublish``. Así no se puede dejar una
    publicación con una etiqueta incoherente respecto a su snapshot vigente.
    """
    is_public: bool

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
    collection_id: Optional[uuid.UUID] = None
    edition_label: Optional[str] = None
    slug: Optional[str] = None
    public_path: Optional[str] = None
    sound_enabled: bool = True
    page_turn_sound_asset_id: Optional[uuid.UUID] = None
    page_turn_sound_url: Optional[str] = None
    seo_title: Optional[str] = None
    seo_description: Optional[str] = None
    seo_indexable: bool = True

    class Config:
        from_attributes = True
