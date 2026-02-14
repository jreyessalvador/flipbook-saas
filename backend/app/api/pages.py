from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.session import get_db
from app.models.user import User
from app.models.page import Page
from app.models.publication import Publication
from app.schemas.page import PageResponse, PageUpdate
from app.api.auth import get_current_user

router = APIRouter()

@router.get("/publications/{publication_id}/pages", response_model=List[PageResponse])
def get_publication_pages(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener todas las páginas de una publicación"""
    # Verificar que la publicación existe y pertenece al tenant
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    
    # Obtener páginas ordenadas por número
    pages = db.query(Page)\
        .filter(Page.publication_id == publication_id)\
        .order_by(Page.page_number)\
        .all()
    
    return pages

@router.get("/{page_id}", response_model=PageResponse)
def get_page(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Obtener una página específica"""
    page = db.query(Page).filter(Page.id == page_id).first()
    
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Verificar que la página pertenece a una publicación del tenant
    publication = db.query(Publication)\
        .filter(Publication.id == page.publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Page not found")
    
    return page

@router.put("/{page_id}", response_model=PageResponse)
def update_page(
    page_id: str,
    page_data: PageUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Actualizar contenido de una página"""
    page = db.query(Page).filter(Page.id == page_id).first()
    
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Verificar permisos
    publication = db.query(Publication)\
        .filter(Publication.id == page.publication_id)\
        .filter(Publication.tenant_id == current_user.tenant_id)\
        .first()
    
    if not publication:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Actualizar campos
    for key, value in page_data.dict(exclude_unset=True).items():
        setattr(page, key, value)
    
    db.commit()
    db.refresh(page)
    
    return page
