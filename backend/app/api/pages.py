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


# ---------------------------------------------------------------------------
# Editor v2 (ver docs/arquitectura-editor-2026-09-12.md, secciones 5 y 6):
# reemplaza el uso de Page.content (JSON blob compartido) por la tabla
# page_elements, con guardado explicito y concurrencia optimista via
# Page.version. Una sola peticion trae/envia TODOS los elementos de una
# pagina -- nunca un forEach asincrono por elemento (causa raiz de uno de
# los bugs del editor anterior).
# ---------------------------------------------------------------------------
from app.models.page_element import PageElement
from app.schemas.page_element import PageElementsSaveRequest, PageElementsResponse


def _get_page_in_tenant(db: Session, page_id: str, tenant_id) -> Page:
    page = db.query(Page).filter(Page.id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Page not found")
    publication = db.query(Publication)\
        .filter(Publication.id == page.publication_id)\
        .filter(Publication.tenant_id == tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Page not found")
    return page


@router.get("/{page_id}/elements", response_model=PageElementsResponse)
def get_page_elements(
    page_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Carga completa de una pagina: UNA sola peticion, sin cascada async por elemento."""
    page = _get_page_in_tenant(db, page_id, current_user.tenant_id)
    elements = db.query(PageElement)\
        .filter(PageElement.page_id == page.id)\
        .order_by(PageElement.z_index)\
        .all()
    return PageElementsResponse(page_id=page.id, version=page.version, elements=elements)


@router.put("/{page_id}/elements", response_model=PageElementsResponse)
def save_page_elements(
    page_id: str,
    body: PageElementsSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Guardado EXPLICITO (boton "Guardar", no autoguardado -- decision de Carlos).
    Concurrencia optimista: si body.version no coincide con page.version en BD,
    se rechaza con 409 SIN escribir nada, en vez de sobrescribir en silencio.
    Dentro de una transaccion: se reemplazan por completo los elementos de
    ESTA pagina (y solo esta -- page_id es explicito en cada INSERT, nunca se
    tocan elementos de otras paginas).
    """
    page = _get_page_in_tenant(db, page_id, current_user.tenant_id)

    if page.version != body.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"La pagina cambio desde que la cargaste (version actual: {page.version}). Recarga antes de guardar.",
        )

    db.query(PageElement).filter(PageElement.page_id == page.id).delete()

    new_elements = [
        PageElement(
            page_id=page.id,
            kind=el.kind.value,
            x=el.x, y=el.y, width=el.width, height=el.height,
            rotation_deg=el.rotation_deg, z_index=el.z_index,
            props=el.props,
        )
        for el in body.elements
    ]
    db.add_all(new_elements)

    page.version = page.version + 1
    db.commit()

    saved = db.query(PageElement)\
        .filter(PageElement.page_id == page.id)\
        .order_by(PageElement.z_index)\
        .all()
    return PageElementsResponse(page_id=page.id, version=page.version, elements=saved)
