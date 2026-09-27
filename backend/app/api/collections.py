"""Lote C (2026-09-27): Colecciones -> Ediciones + categorias comunes.

Toda operacion se limita a ``current_user.effective_tenant_id`` (ver
get_current_user): un usuario de empresa solo ve/gestiona sus colecciones;
Super Admin CETRIX puede operar sobre cualquier empresa con el selector
"Empresa" (cabecera X-Tenant-Id).
"""
import re
import unicodedata
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, case
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.core.rbac import require_role
from app.db.session import get_db
from app.models.collection import Category, Collection
from app.models.publication import Publication
from app.models.user import User
from app.schemas.collection import (
    CategoryResponse, CollectionCreate, CollectionResponse, CollectionUpdate,
)

router = APIRouter()


def slugify(value: str, max_len: int = 80) -> str:
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return (value[:max_len].strip("-")) or "coleccion"


def unique_collection_slug(db: Session, tenant_id, name: str, exclude_id=None) -> str:
    base = slugify(name)
    slug, n = base, 2
    while True:
        q = db.query(Collection.id).filter(Collection.tenant_id == tenant_id, Collection.slug == slug)
        if exclude_id is not None:
            q = q.filter(Collection.id != exclude_id)
        if not q.first():
            return slug
        slug = f"{base}-{n}"
        n += 1


def get_collection_in_tenant(db: Session, collection_id, tenant_id) -> Collection:
    try:
        cid = uuid.UUID(str(collection_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Colección no encontrada")
    col = db.query(Collection).filter(Collection.id == cid, Collection.tenant_id == tenant_id).first()
    if not col:
        raise HTTPException(status_code=404, detail="Colección no encontrada")
    return col


def get_default_collection(db: Session, tenant_id) -> Collection:
    col = db.query(Collection).filter(Collection.tenant_id == tenant_id, Collection.is_default.is_(True)).first()
    if col:
        return col
    # Red de seguridad (el trigger de BD ya la crea al dar de alta la empresa)
    col = Collection(tenant_id=tenant_id, name="General", slug=unique_collection_slug(db, tenant_id, "general"),
                     description="Colección por defecto.", is_default=True)
    db.add(col)
    db.flush()
    return col


def validate_category(db: Session, category_id: Optional[uuid.UUID]) -> Optional[Category]:
    if category_id is None:
        return None
    cat = db.query(Category).filter(Category.id == category_id, Category.is_active.is_(True)).first()
    if not cat:
        raise HTTPException(status_code=422, detail="Categoría no válida")
    return cat


def _serialize(db: Session, cols: List[Collection]) -> List[dict]:
    if not cols:
        return []
    ids = [c.id for c in cols]
    counts = dict()
    for cid, total, published in db.query(
        Publication.collection_id,
        func.count(Publication.id),
        func.sum(case((Publication.status == "published", 1), else_=0)),
    ).filter(Publication.collection_id.in_(ids)).group_by(Publication.collection_id).all():
        counts[cid] = (int(total or 0), int(published or 0))

    # Portada de la coleccion = portada de su edicion mas reciente que tenga imagen
    from app.api.publications import _attach_cover_thumbnails
    latest = db.query(Publication).filter(Publication.collection_id.in_(ids))\
        .order_by(Publication.updated_at.desc()).all()
    _attach_cover_thumbnails(db, latest)
    cover_by_col = {}
    for pub in latest:
        if pub.collection_id not in cover_by_col and getattr(pub, "cover_image_url", None):
            cover_by_col[pub.collection_id] = pub.cover_image_url

    cat_names = {c.id: c.name for c in db.query(Category).filter(
        Category.id.in_([c.category_id for c in cols if c.category_id])).all()} if any(c.category_id for c in cols) else {}

    out = []
    for c in cols:
        total, published = counts.get(c.id, (0, 0))
        out.append({
            "id": c.id, "tenant_id": c.tenant_id, "name": c.name, "slug": c.slug,
            "description": c.description, "category_id": c.category_id,
            "category_name": cat_names.get(c.category_id), "is_default": c.is_default,
            "edition_count": total, "published_count": published,
            "cover_image_url": cover_by_col.get(c.id),
            "created_at": c.created_at, "updated_at": c.updated_at,
        })
    return out


@router.get("/categories", response_model=List[CategoryResponse])
def list_categories(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.query(Category).filter(Category.is_active.is_(True))\
        .order_by(Category.sort_order, Category.name).all()


@router.get("/collections", response_model=List[CollectionResponse])
def list_collections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tenant_id = current_user.effective_tenant_id
    get_default_collection(db, tenant_id)
    db.commit()
    cols = db.query(Collection).filter(Collection.tenant_id == tenant_id)\
        .order_by(Collection.is_default.desc(), Collection.sort_order, Collection.name).all()
    return _serialize(db, cols)


@router.post("/collections", response_model=CollectionResponse, status_code=status.HTTP_201_CREATED)
def create_collection(data: CollectionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    tenant_id = current_user.effective_tenant_id
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="El nombre no puede estar vacío")
    validate_category(db, data.category_id)
    col = Collection(
        tenant_id=tenant_id, name=name, slug=unique_collection_slug(db, tenant_id, name),
        description=(data.description or "").strip() or None, category_id=data.category_id,
        created_by=current_user.id,
    )
    db.add(col)
    db.commit()
    db.refresh(col)
    return _serialize(db, [col])[0]


@router.get("/collections/{collection_id}", response_model=CollectionResponse)
def get_collection(collection_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    col = get_collection_in_tenant(db, collection_id, current_user.effective_tenant_id)
    return _serialize(db, [col])[0]


@router.put("/collections/{collection_id}", response_model=CollectionResponse)
def update_collection(collection_id: str, data: CollectionUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    col = get_collection_in_tenant(db, collection_id, current_user.effective_tenant_id)
    changes = data.dict(exclude_unset=True)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="El nombre no puede estar vacío")
        if name != col.name:
            col.slug = unique_collection_slug(db, col.tenant_id, name, exclude_id=col.id)
        col.name = name
    if "description" in changes:
        col.description = (changes["description"] or "").strip() or None
    if "category_id" in changes:
        validate_category(db, changes["category_id"])
        col.category_id = changes["category_id"]
    db.commit()
    db.refresh(col)
    return _serialize(db, [col])[0]


@router.delete("/collections/{collection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_collection(collection_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    col = get_collection_in_tenant(db, collection_id, current_user.effective_tenant_id)
    if col.is_default:
        raise HTTPException(status_code=409, detail="La colección por defecto no se puede eliminar")
    editions = db.query(func.count(Publication.id)).filter(Publication.collection_id == col.id).scalar() or 0
    if editions:
        raise HTTPException(status_code=409, detail=f"La colección tiene {editions} edición(es). Muévelas o elimínalas antes.")
    db.delete(col)
    db.commit()
