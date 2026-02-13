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
