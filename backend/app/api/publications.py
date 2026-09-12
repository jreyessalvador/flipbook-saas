from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.user import User
from app.models.publication import Publication
from app.models.page import Page
from app.schemas.publication import PublicationCreate, PublicationUpdate, PublicationResponse
from app.api.auth import get_current_user

router = APIRouter()

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

    return publications

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
