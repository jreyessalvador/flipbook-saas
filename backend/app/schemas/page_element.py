from pydantic import BaseModel, ConfigDict, Field, model_validator
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
    embed = "embed"  # Lote 5: YouTube/Vimeo; Lote 6: SoundCloud -- props:
    # {provider, video_id, url}. provider in ('youtube','vimeo','soundcloud');
    # para SoundCloud, video_id guarda 'usuario/track-slug' (no hay id numerico).
    # Konva no puede reproducir un iframe/audio embebido real: en el editor se
    # muestra un placeholder (icono + etiqueta); la reproduccion real queda
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

    @model_validator(mode="after")
    def validate_hotspot_action(self):
        """Impide guardar hotspots incompletos o con destinos ejecutables inseguros."""
        if self.kind != PageElementKind.hotspot:
            return self

        action = self.props.get("action")
        if action not in {"page", "next", "previous", "cover", "back_cover", "url", "email", "phone"}:
            raise ValueError("El hotspot debe tener una acción válida.")

        value = self.props.get("value")
        if action == "page":
            try:
                uuid.UUID(str(self.props.get("target_page_id")))
            except (ValueError, TypeError, AttributeError):
                raise ValueError("El hotspot debe apuntar a una página válida.")
        elif action == "url":
            from urllib.parse import urlparse
            parsed = urlparse(str(value or ""))
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError("El enlace del hotspot debe usar una URL https válida.")
        elif action == "email":
            from email_validator import validate_email, EmailNotValidError
            try:
                validate_email(str(value or ""), check_deliverability=False)
            except EmailNotValidError:
                raise ValueError("El correo del hotspot no es válido.")
        elif action == "phone":
            import re
            if not re.fullmatch(r"[+0-9(). -]{3,32}", str(value or "")):
                raise ValueError("El teléfono del hotspot no es válido.")
        return self


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
