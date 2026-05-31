from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from datetime import datetime
import uuid
from slugify import slugify

from app.db.session import get_db
from app.api.auth import get_current_user
from app.models.user import User
from app.models.publication import Publication
from app.models.page import Page
from app.schemas.publication import (
    PublicationCreate, PublicationUpdate,
    PublicationResponse, PublicationList
)

router = APIRouter()

@router.get("", response_model=PublicationList)
def list_publications(
    page: int = Query(1, ge=1),
    per_page: int = Query(12, ge=1, le=100),
    status: Optional[str] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Publication).filter(Publication.tenant_id == current_user.tenant_id)
    if status:
        query = query.filter(Publication.status == status)
    if q:
        query = query.filter(Publication.title.ilike(f"%{q}%"))
    total = query.count()
    items = query.order_by(Publication.created_at.desc()).offset((page-1)*per_page).limit(per_page).all()
    return PublicationList(
        items=items, total=total, page=page,
        per_page=per_page, pages=(total + per_page - 1) // per_page
    )

@router.post("", response_model=PublicationResponse, status_code=status.HTTP_201_CREATED)
def create_publication(
    data: PublicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == current_user.tenant_id).first()
    count = db.query(Publication).filter(Publication.tenant_id == current_user.tenant_id).count()
    if count >= tenant.max_publications:
        raise HTTPException(status_code=402, detail=f"Limite de publicaciones alcanzado ({tenant.max_publications})")
    base_slug = slugify(data.title)
    slug = base_slug
    i = 1
    while db.query(Publication).filter(
        Publication.tenant_id == current_user.tenant_id,
        Publication.slug == slug
    ).first():
        slug = f"{base_slug}-{i}"
        i += 1
    pub = Publication(
        id=uuid.uuid4(),
        tenant_id=current_user.tenant_id,
        created_by=current_user.id,
        title=data.title,
        description=data.description,
        slug=slug,
        flip_duration=data.flip_duration,
        background_color=data.background_color,
        show_controls=data.show_controls,
        allow_download=data.allow_download,
        status="draft"
    )
    db.add(pub)
    db.commit()
    db.refresh(pub)
    return pub

@router.get("/{pub_id}", response_model=PublicationResponse)
def get_publication(
    pub_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    return pub

@router.put("/{pub_id}", response_model=PublicationResponse)
def update_publication(
    pub_id: uuid.UUID,
    data: PublicationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(pub, field, value)
    if data.status == "published" and not pub.published_at:
        pub.published_at = datetime.utcnow()
    pub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pub)
    return pub

@router.delete("/{pub_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_publication(
    pub_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    db.delete(pub)
    db.commit()

@router.post("/{pub_id}/publish", response_model=PublicationResponse)
def publish_publication(
    pub_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    pub = db.query(Publication).filter(
        Publication.id == pub_id,
        Publication.tenant_id == current_user.tenant_id
    ).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publicacion no encontrada")
    if pub.page_count == 0:
        raise HTTPException(status_code=400, detail="No se puede publicar sin paginas")
    pub.status = "published"
    if not pub.published_at:
        pub.published_at = datetime.utcnow()
    pub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pub)
    return pub
