from typing import List, Optional
import uuid
import html
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, and_

from app.db.session import get_db
from app.models.publication import Publication
from app.models.publication_version import PublicationVersion
from app.schemas.publication import PublicationResponse
from app.schemas.page import PageResponse

router = APIRouter()

def _get_snapshot_pages(snapshot: dict) -> List[dict]:
    """Helper para extraer y formatear páginas desde el snapshot congelado."""
    pages_data = snapshot.get("pages", [])
    result = []
    for page_index, p in enumerate(pages_data):
        # El snapshot no conserva las claves de base de datos de Page ni de
        # PageElement: son datos inmutables del Reader. Se asignan claves
        # estables de lectura para React/Konva, sin intentar validarlos como
        # registros editables (lo que provocaba un 500 al abrir el Reader).
        elements = [
            {**el, "id": el.get("id") or f"snapshot-{page_index}-{element_index}"}
            for element_index, el in enumerate(p.get("elements", []))
            if isinstance(el, dict)
        ]
        page_dict = {
            "id": p.get("id") or f"snapshot-page-{page_index}",
            "publication_id": snapshot.get("publication_id", 0),
            "page_number": p.get("page_number", 1),
            "page_type": p.get("page_type", "inner"),
            "elements": elements
        }
        result.append(page_dict)
    return result

def _cover_from_snapshot(snapshot: Optional[dict]) -> Optional[str]:
    """Imagen de mayor area de la portada del snapshot publicado (o la primera
    imagen de una galeria). Compartido por el catalogo y las meta Open Graph."""
    cover_url = None
    if snapshot and "pages" in snapshot:
        for page in snapshot["pages"]:
            if page.get("page_type") == "front_cover" or page.get("page_number") == 1:
                best_area = 0
                for el in page.get("elements", []):
                    props = el.get("props", {}) or {}
                    image_src = props.get("src")
                    if el.get("kind") == "gallery":
                        image_src = next(
                            (item.get("src") for item in props.get("images", []) if item.get("src")),
                            None,
                        )
                    if image_src:
                        area = (el.get("width", 0) or 0) * (el.get("height", 0) or 0)
                        if area > best_area or cover_url is None:
                            best_area = area
                            cover_url = image_src
                if cover_url:
                    break
    return cover_url


@router.get("/publications", response_model=List[dict])
def list_public_publications(db: Session = Depends(get_db)):
    """
    Lista únicamente las publicaciones marcadas como is_public=True
    Y que tengan una versión publicada activa (published_version_id IS NOT NULL).
    """
    stmt = (
        select(Publication, PublicationVersion.snapshot)
        .join(PublicationVersion, Publication.published_version_id == PublicationVersion.id)
        .where(
            and_(
                Publication.is_public == True,
                Publication.published_version_id.isnot(None)
            )
        )
        .order_by(Publication.updated_at.desc())
    )
    results = db.execute(stmt).all()

    public_list = []
    for pub, snapshot in results:
        cover_url = _cover_from_snapshot(snapshot)

        public_list.append({
            "id": pub.id,
            "title": pub.title,
            "description": pub.description,
            "orientation": pub.orientation,
            "page_width": pub.page_width,
            "page_height": pub.page_height,
            "total_pages": pub.total_pages,
            "created_at": pub.created_at.isoformat() if pub.created_at else None,
            "cover_url": cover_url
        })

    return public_list


@router.get("/publications/{id}", response_model=dict)
def get_public_publication(id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Obtiene metadatos de una publicación pública. 404 si es privada o sin publicar.
    """
    stmt = (
        select(Publication, PublicationVersion.snapshot)
        .outerjoin(PublicationVersion, Publication.published_version_id == PublicationVersion.id)
        .where(
            and_(
                Publication.id == id,
                Publication.is_public == True,
                Publication.published_version_id.isnot(None)
            )
        )
    )
    result = db.execute(stmt).first()
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Publicación no encontrada o no es pública"
        )
    
    pub, snapshot = result
    return {
        "id": pub.id,
        "title": pub.title,
        "description": pub.description,
        "orientation": pub.orientation,
        "page_width": pub.page_width,
        "page_height": pub.page_height,
        "total_pages": pub.total_pages,
        "created_at": pub.created_at.isoformat() if pub.created_at else None
    }


@router.get("/publications/{id}/pages", response_model=List[dict])
def get_public_publication_pages(id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Lee las páginas y elementos congelados en el snapshot publicado de la revista.
    Nunca lee borradores en vivo.
    """
    stmt = (
        select(PublicationVersion.snapshot)
        .join(Publication, Publication.published_version_id == PublicationVersion.id)
        .where(
            and_(
                Publication.id == id,
                Publication.is_public == True,
                Publication.published_version_id.isnot(None)
            )
        )
    )
    snapshot = db.execute(stmt).scalar_one_or_none()
    if not snapshot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Publicación no encontrada, privada o sin versión publicada"
        )

    return _get_snapshot_pages(snapshot)


@router.get("/og/{id}", response_class=HTMLResponse, include_in_schema=False)
def public_open_graph(id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    """
    HTML minimo con meta Open Graph / Twitter Card para que WhatsApp, Telegram,
    Facebook, X, LinkedIn... muestren portada, titulo y descripcion al
    compartir /leer/{id}. El Reader es una SPA y los crawlers no ejecutan JS:
    nginx enruta aqui /leer/{id} SOLO para user-agents de bots (ver
    RECETA-DESARROLLO.md). Un humano que llegue aqui se redirige al Reader.
    Misma regla que el resto del router: solo publicas y publicadas.
    """
    stmt = (
        select(Publication, PublicationVersion.snapshot)
        .join(PublicationVersion, Publication.published_version_id == PublicationVersion.id)
        .where(and_(Publication.id == id, Publication.is_public == True,
                    Publication.published_version_id.isnot(None)))
    )
    result = db.execute(stmt).first()
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicación no encontrada o no es pública")
    pub, snapshot = result

    origin = str(request.base_url).rstrip("/")
    reader_url = f"{origin}/leer/{pub.id}"
    cover = _cover_from_snapshot(snapshot)
    image_url = None
    if cover:
        image_url = cover if cover.startswith(("http://", "https://")) else f"{origin}{cover if cover.startswith('/') else '/' + cover}"

    e = lambda v: html.escape(str(v or ""), quote=True)
    title = pub.title or "Revista digital"
    description = pub.description or f"Lee «{title}» en formato revista digital interactiva."
    image_tags = (
        f'<meta property="og:image" content="{e(image_url)}">\n'
        f'<meta property="og:image:alt" content="{e(title)}">\n'
        f'<meta name="twitter:image" content="{e(image_url)}">\n'
    ) if image_url else ""
    body = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(reader_url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Revistas digitales">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(reader_url)}">
{image_tags}<meta name="twitter:card" content="{'summary_large_image' if image_url else 'summary'}">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(description)}">
<meta http-equiv="refresh" content="0; url={e(reader_url)}">
</head><body><p><a href="{e(reader_url)}">{e(title)}</a></p></body></html>"""
    return HTMLResponse(content=body, headers={"Cache-Control": "public, max-age=300"})
