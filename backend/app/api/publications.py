from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.db.session import get_db
from app.models.user import User
from app.models.publication import Publication
from app.models.page import Page
from app.models.page_element import PageElement
from app.models.asset import Asset
from app.schemas.publication import (
    PublicationCreate,
    PublicationUpdate,
    PublicationVisibilityUpdate,
    PublicationResponse,
)
from app.api.auth import get_current_user

router = APIRouter()


@router.get("/stats/summary")
def get_publications_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Resumen para el Dashboard (Lote UX-1) -- antes el Dashboard mostraba
    0/0/0 MB fijos en el frontend, sin llamar a ningun endpoint. Todo se
    calcula aqui con agregados de SQL (COUNT/SUM) filtrados por
    current_user.tenant_id -- nunca se trae la lista completa a Python solo
    para contarla/sumarla. Ruta declarada ANTES de GET /{publication_id}
    para que FastAPI no intente interpretar 'stats' como un publication_id
    (aunque al tener 2 segmentos de ruta no colisiona, se deja aqui arriba
    por claridad).
    """
    tenant_id = current_user.tenant_id

    total_publications = db.query(func.count(Publication.id))\
        .filter(Publication.tenant_id == tenant_id)\
        .scalar() or 0

    total_views = db.query(func.coalesce(func.sum(Publication.views_count), 0))\
        .filter(Publication.tenant_id == tenant_id)\
        .scalar() or 0

    storage_bytes = db.query(func.coalesce(func.sum(Asset.size_bytes), 0))\
        .filter(Asset.tenant_id == tenant_id)\
        .scalar() or 0

    return {
        "total_publications": int(total_publications),
        "total_views": int(total_views),
        "storage_bytes": int(storage_bytes),
    }

@router.post("/", response_model=PublicationResponse, status_code=status.HTTP_201_CREATED)
def create_publication(
    publication_data: PublicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crear una nueva publicación con sus páginas"""
    
    # Extraer total_pages antes de crear la publicación
    total_pages = publication_data.total_pages if publication_data.total_pages else 10
    
    # Crear publicación
    publication_dict = publication_data.dict(exclude={'total_pages'})
    new_publication = Publication(
        **publication_dict,
        total_pages=total_pages,
        tenant_id=current_user.tenant_id,
        created_by=current_user.id
    )

    db.add(new_publication)
    db.flush()  # Para obtener el ID sin hacer commit todavía

    # Crear páginas automáticamente
    for page_num in range(1, total_pages + 1):
        if page_num == 1:
            page_type = "cover"
        elif page_num == total_pages:
            page_type = "back_cover"
        else:
            page_type = "content"
        
        page = Page(
            publication_id=new_publication.id,
            page_number=page_num,
            page_type=page_type,
            content={}
        )
        db.add(page)
    
    db.commit()
    db.refresh(new_publication)

    return new_publication

@router.get("/", response_model=List[PublicationResponse])
def list_publications(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Listar publicaciones del tenant"""
    publications = db.query(Publication)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .offset(skip)\
        .limit(limit)\
        .all()

    _attach_cover_thumbnails(db, publications)
    return publications


def _attach_cover_thumbnails(db: Session, publications: List[Publication]):
    """
    Miniatura de portada para las fichas de "Mis Publicaciones" (Lote UX-3) --
    antes cada ficha mostraba siempre el mismo icono de libro generico
    (Publications.jsx ya sabia renderizar `cover_image_url` si existiera, pero
    NADA lo poblaba jamas -- el campo existe en el modelo desde el diseño
    original y siempre quedaba en NULL).

    No persiste nada en la BD (Publication.cover_image_url sigue en NULL) --
    se calcula al vuelo en cada listado y se asigna como atributo transitorio
    del objeto ORM antes de serializar (Pydantic con from_attributes=True lo
    lee vía getattr, funciona igual que una columna real sin necesitar
    migracion ni mantener el dato sincronizado cuando el usuario edita la
    portada). Si la pagina 1 (portada) no tiene ningun elemento kind='image',
    se deja cover_image_url en None -- el frontend ya sabe caer a un estado
    vacio/blanco en ese caso, no a un icono generico (ver Publications.jsx).

    Heuristica para elegir CUAL imagen si hay varias en la portada: la de
    mayor area (width * height) -- normalmente es la foto/fondo principal de
    la portada, no un logo o icono decorativo pequeño superpuesto.

    Tambien contempla elementos kind='gallery' (Lote UX-10/UX-11, slideshow):
    estos NO tienen `props.src` (tienen `props.images[]`, un array de
    {src, title, description}) -- antes de este fix quedaban simplemente
    ignorados por el filtro `kind == 'image'`, asi que una portada armada
    con un slideshow en vez de una imagen fija se veia siempre en blanco en
    la ficha de "Mis Publicaciones", aunque el visor publico si la mostrara
    bien. Se usa la primera imagen no vacia del array como miniatura.
    """
    pub_ids = [p.id for p in publications]
    if not pub_ids:
        return

    cover_pages = db.query(Page.id, Page.publication_id)\
        .filter(Page.publication_id.in_(pub_ids), Page.page_number == 1)\
        .all()
    page_id_to_pub_id = {page_id: pub_id for page_id, pub_id in cover_pages}
    if not page_id_to_pub_id:
        return

    image_elements = db.query(PageElement)\
        .filter(PageElement.page_id.in_(page_id_to_pub_id.keys()), PageElement.kind.in_(["image", "gallery"]))\
        .all()

    best_by_pub = {}  # pub_id -> (area, src)
    for el in image_elements:
        if el.kind == "gallery":
            images = (el.props or {}).get("images") or []
            src = next((img.get("src") for img in images if img.get("src")), None)
        else:
            src = (el.props or {}).get("src")
        if not src:
            continue
        pub_id = page_id_to_pub_id.get(el.page_id)
        if pub_id is None:
            continue
        area = float(el.width or 0) * float(el.height or 0)
        current = best_by_pub.get(pub_id)
        if current is None or area > current[0]:
            best_by_pub[pub_id] = (area, src)

    for pub in publications:
        best = best_by_pub.get(pub.id)
        pub.cover_image_url = best[1] if best else None

@router.get("/{publication_id}", response_model=PublicationResponse)
def get_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener una publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()

    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    return publication

@router.put("/{publication_id}", response_model=PublicationResponse)
def update_publication(
    publication_id: str,
    publication_data: PublicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Actualizar publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()

    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    for key, value in publication_data.dict(exclude_unset=True).items():
        setattr(publication, key, value)

    db.commit()
    db.refresh(publication)

    return publication

@router.delete("/{publication_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Eliminar publicación"""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()

    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    db.delete(publication)
    db.commit()

    return None


# ---------------------------------------------------------------------------
# Editor v2: publicacion como snapshot inmutable (ver docs/arquitectura-editor-
# 2026-09-12.md, seccion 5). El Reader publico debe leer SIEMPRE de
# PublicationVersion.snapshot, nunca de Page/PageElement directamente -- asi
# una edicion a medias nunca llega a un lector.
# ---------------------------------------------------------------------------
from app.models.page_element import PageElement
from app.models.publication_version import PublicationVersion
from app.models.edit_lock import EditLock


def _serialize_publication_snapshot(db: Session, publication: Publication) -> dict:
    pages = db.query(Page)\
        .filter(Page.publication_id == publication.id)\
        .order_by(Page.page_number)\
        .all()
    return {
        "title": publication.title,
        "orientation": publication.orientation,
        "page_width": publication.page_width,
        "page_height": publication.page_height,
        "page_turn_sound_asset_id": str(publication.page_turn_sound_asset_id) if publication.page_turn_sound_asset_id else None,
        "pages": [
            {
                "page_number": page.page_number,
                "page_type": page.page_type,
                "elements": [
                    {
                        "kind": el.kind,
                        "x": float(el.x), "y": float(el.y),
                        "width": float(el.width), "height": float(el.height),
                        "rotation_deg": float(el.rotation_deg), "z_index": el.z_index,
                        "props": el.props,
                    }
                    for el in db.query(PageElement)
                        .filter(PageElement.page_id == page.id)
                        .order_by(PageElement.z_index)
                        .all()
                ],
            }
            for page in pages
        ],
    }


@router.post("/{publication_id}/publish", status_code=status.HTTP_201_CREATED)
def publish_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Congela el estado actual en un PublicationVersion nuevo y lo marca como vigente."""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    snapshot = _serialize_publication_snapshot(db, publication)
    version = PublicationVersion(
        publication_id=publication.id,
        snapshot=snapshot,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()

    publication.published_version_id = version.id
    publication.status = "published"
    db.commit()

    return {"version_id": str(version.id), "created_at": version.created_at.isoformat()}


@router.post("/{publication_id}/unpublish")
def unpublish_publication(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Vuelve al borrador sin eliminar el historial de snapshots.

    La última versión permanece almacenada para auditoría o una futura
    restauración, pero deja de ser la versión vigente y no puede ser leída
    desde el catálogo público.
    """
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    publication.published_version_id = None
    publication.status = "draft"
    publication.is_public = False
    db.commit()

    return {"status": publication.status, "is_public": publication.is_public}


@router.put("/{publication_id}/visibility", response_model=PublicationResponse)
def set_publication_visibility(
    publication_id: str,
    visibility: PublicationVisibilityUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Muestra u oculta una versión vigente del catálogo y Reader públicos."""
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    if visibility.is_public and not publication.published_version_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Publica la revista antes de mostrarla en el catálogo público",
        )

    publication.is_public = visibility.is_public
    db.commit()
    db.refresh(publication)
    return publication


@router.get("/{publication_id}/versions")
def list_publication_versions(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")

    versions = db.query(PublicationVersion)\
        .filter(PublicationVersion.publication_id == publication_id)\
        .order_by(PublicationVersion.created_at.desc())\
        .all()
    return [
        {
            "id": str(v.id),
            "created_at": v.created_at.isoformat(),
            "created_by": str(v.created_by),
            "is_current": v.id == publication.published_version_id,
        }
        for v in versions
    ]
