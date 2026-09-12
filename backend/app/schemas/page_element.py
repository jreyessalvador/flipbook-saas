from pydantic import BaseModel, ConfigDict, Field
from typing import Dict, Any, List
import uuid
from datetime import datetime
from enum import Enum


class PageElementKind(str, Enum):
    image = "image"
    text = "text"
    shape = "shape"
    video = "video"
    audio = "audio"
    hotspot = "hotspot"
    gallery = "gallery"  # Lote 4: galeria/collage/GIF -- galeria y collage
    # comparten este kind (solo difiere props.layout: 'grid'|'mosaic'); GIF
    # sigue usando kind='image' (Konva no anima GIFs, se documenta como
    # limitacion conocida -- ver RECETA-DESARROLLO.md).
    embed = "embed"  # Lote 5: YouTube/Vimeo -- props: {provider, video_id, url}.
    # Konva no puede reproducir un iframe real: en el editor se muestra un
    # placeholder (icono + etiqueta); la reproduccion real via iframe queda
    # diferida al Reader (Fase E).


class PageElementBase(BaseModel):
    kind: PageElementKind
    x: float
    y: float
    width: float
    height: float
    rotation_deg: float = Field(default=0.0)
    z_index: int = Field(default=0)
    props: Dict[str, Any] = Field(default_factory=dict)


class PageElementCreate(PageElementBase):
    """Un elemento tal como lo manda el frontend al guardar (sin id: se re-crea siempre)."""
    pass


class PageElementResponse(PageElementBase):
    id: uuid.UUID
    page_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PageElementsSaveRequest(BaseModel):
    """Body de PUT /pages/{id}/elements -- concurrencia optimista via 'version'."""
    version: int
    elements: List[PageElementCreate]


class PageElementsResponse(BaseModel):
    page_id: uuid.UUID
    version: int
    elements: List[PageElementResponse]
