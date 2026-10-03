from typing import List, Optional
import uuid
import html
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, and_, func

from app.db.session import get_db
from app.models.publication import Publication
from app.models.publication_version import PublicationVersion
from app.models.collection import Collection, Category
from app.models.tenant import Tenant
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


def _public_catalog_stmt():
    """Publicaciones visibles en el kiosco: publicas, con version publicada y de
    una empresa activa. Devuelve (Publication, snapshot, Collection, Tenant, Category)."""
    return (
        select(Publication, PublicationVersion.snapshot, Collection, Tenant, Category)
        .join(PublicationVersion, Publication.published_version_id == PublicationVersion.id)
        .join(Collection, Publication.collection_id == Collection.id)
        .join(Tenant, Publication.tenant_id == Tenant.id)
        .outerjoin(Category, Collection.category_id == Category.id)
        .where(
            and_(
                Publication.is_public == True,
                Publication.published_version_id.isnot(None),
                Publication.deleted_at.is_(None),  # Lote L5 (defensa en profundidad)
                func.coalesce(Tenant.status, "active") == "active",
            )
        )
    )


def _download_path(pub) -> Optional[str]:
    """Lote L5: URL de descarga del PDF original, solo si la empresa lo permite."""
    if pub.allow_download and pub.pdf_url:
        return f"/api/public/publications/{pub.id}/download"
    return None


def _url_path(tenant: Tenant, collection: Collection, pub: Publication) -> str:
    if pub.slug and collection.slug and tenant.subdomain:
        return f"/r/{tenant.subdomain}/{collection.slug}/{pub.slug}"
    return f"/leer/{pub.id}"


def _catalog_item(pub, snapshot, collection, tenant, category) -> dict:
    return {
        "id": pub.id,
        "title": pub.title,
        "description": pub.description,
        "edition_label": pub.edition_label,
        "slug": pub.slug,
        "orientation": pub.orientation,
        "page_width": pub.page_width,
        "page_height": pub.page_height,
        "total_pages": pub.total_pages,
        "created_at": pub.created_at.isoformat() if pub.created_at else None,
        "updated_at": pub.updated_at.isoformat() if pub.updated_at else None,
        "cover_url": _cover_from_snapshot(snapshot),
        "collection": {
            "id": collection.id,
            "name": collection.name,
            "slug": collection.slug,
            "category": {"slug": category.slug, "name": category.name} if category else None,
        },
        "tenant": {"name": tenant.name, "slug": tenant.subdomain},
        "url_path": _url_path(tenant, collection, pub),
        # Lote L4: ajustes del visor y SEO, leidos en vivo (no del snapshot)
        "viewer": {
            "sound_enabled": bool(pub.sound_enabled) if pub.sound_enabled is not None else True,
            "sound_url": pub.page_turn_sound_url,
            "download_url": _download_path(pub),
        },
        "seo": {
            "title": pub.seo_title,
            "description": pub.seo_description,
            "indexable": bool(pub.seo_indexable) if pub.seo_indexable is not None else True,
        },
    }


@router.get("/publications", response_model=List[dict])
def list_public_publications(category: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Kiosco: publicaciones is_public=True con version publicada, de empresas
    activas. Filtro opcional ?category=<slug>.
    """
    stmt = _public_catalog_stmt()
    if category:
        stmt = stmt.where(Category.slug == category)
    stmt = stmt.order_by(Publication.updated_at.desc())
    return [_catalog_item(*row) for row in db.execute(stmt).all()]


@router.get("/categories", response_model=List[dict])
def list_public_categories(db: Session = Depends(get_db)):
    """Categorias con al menos una edicion visible en el kiosco, con su recuento."""
    stmt = (
        select(Category.slug, Category.name, func.count().label("count"))
        .select_from(Publication)
        .join(PublicationVersion, Publication.published_version_id == PublicationVersion.id)
        .join(Collection, Publication.collection_id == Collection.id)
        .join(Tenant, Publication.tenant_id == Tenant.id)
        .join(Category, Collection.category_id == Category.id)
        .where(
            and_(
                Publication.is_public == True,
                Publication.published_version_id.isnot(None),
                func.coalesce(Tenant.status, "active") == "active",
                Category.is_active == True,
            )
        )
        .group_by(Category.slug, Category.name, Category.sort_order)
        .order_by(Category.sort_order, Category.name)
    )
    return [{"slug": r.slug, "name": r.name, "count": r.count} for r in db.execute(stmt).all()]


@router.get("/r/{tenant_slug}/{collection_slug}", response_model=dict)
def get_public_collection(tenant_slug: str, collection_slug: str, db: Session = Depends(get_db)):
    """Pagina publica de una coleccion: datos basicos y sus ediciones visibles."""
    rows = db.execute(
        _public_catalog_stmt()
        .where(and_(Tenant.subdomain == tenant_slug, Collection.slug == collection_slug))
        .order_by(Publication.updated_at.desc())
    ).all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Colección no encontrada o sin ediciones públicas")
    _, _, collection, tenant, category = rows[0]
    return {
        "collection": {
            "id": collection.id,
            "name": collection.name,
            "slug": collection.slug,
            "description": collection.description,
            "category": {"slug": category.slug, "name": category.name} if category else None,
        },
        "tenant": {"name": tenant.name, "slug": tenant.subdomain},
        "editions": [_catalog_item(*row) for row in rows],
    }


def _resolve_friendly(db: Session, tenant_slug: str, collection_slug: str, edition_slug: str):
    return db.execute(
        _public_catalog_stmt().where(
            and_(
                Tenant.subdomain == tenant_slug,
                Collection.slug == collection_slug,
                Publication.slug == edition_slug,
            )
        )
    ).first()


@router.get("/r/{tenant_slug}/{collection_slug}/{edition_slug}", response_model=dict)
def resolve_public_edition(tenant_slug: str, collection_slug: str, edition_slug: str, db: Session = Depends(get_db)):
    """Resuelve una URL amigable a la edicion publica (id + metadatos)."""
    row = _resolve_friendly(db, tenant_slug, collection_slug, edition_slug)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edición no encontrada o no es pública")
    return _catalog_item(*row)


@router.get("/publications/{id}", response_model=dict)
def get_public_publication(id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Obtiene metadatos de una publicación pública. 404 si es privada o sin publicar.
    """
    row = db.execute(_public_catalog_stmt().where(Publication.id == id)).first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Publicación no encontrada o no es pública"
        )
    return _catalog_item(*row)


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
                Publication.published_version_id.isnot(None),
                Publication.deleted_at.is_(None),
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


@router.get("/publications/{id}/download", include_in_schema=False)
def download_public_pdf(id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Lote L5: descarga del PDF original de una edicion publica. 404 (sin dar
    pistas) si la edicion no es publica, no esta publicada, esta en la
    papelera, su empresa no esta activa, no permite descarga o no tiene PDF.
    """
    from app.api.assets import minio_client, BUCKET_NAME
    from app.services.trash import storage_key_from_url
    from app.core.slugs import slugify
    row = db.execute(_public_catalog_stmt().where(Publication.id == id)).first()
    pub = row[0] if row else None
    key = storage_key_from_url(pub.pdf_url) if pub is not None and pub.allow_download else None
    if not key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Descarga no disponible")
    try:
        obj = minio_client.get_object(BUCKET_NAME, key)
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Descarga no disponible")

    def stream():
        try:
            for chunk in obj.stream(64 * 1024):
                yield chunk
        finally:
            obj.close()
            obj.release_conn()

    name = slugify(pub.slug or pub.title or "revista", 80) + ".pdf"
    headers = {
        "Content-Disposition": f'attachment; filename="{name}"',
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
    }
    size = obj.headers.get("Content-Length")
    if size:
        headers["Content-Length"] = size
    return StreamingResponse(stream(), media_type="application/pdf", headers=headers)


def _open_graph_html(request: Request, row) -> HTMLResponse:
    pub, snapshot, collection, tenant, category = row
    origin = str(request.base_url).rstrip("/")
    reader_url = f"{origin}{_url_path(tenant, collection, pub)}"
    cover = _cover_from_snapshot(snapshot)
    image_url = None
    if cover:
        image_url = cover if cover.startswith(("http://", "https://")) else f"{origin}{cover if cover.startswith('/') else '/' + cover}"

    e = lambda v: html.escape(str(v or ""), quote=True)
    base_title = pub.title or "Revista digital"
    title = f"{base_title} · {pub.edition_label}" if pub.edition_label and pub.edition_label not in base_title else base_title
    if pub.seo_title:  # Lote L4: titulo SEO propio de la edicion
        title = pub.seo_title
    description = pub.seo_description or pub.description or f"Lee «{base_title}» de {tenant.name} en formato revista digital interactiva."
    robots = "" if (pub.seo_indexable is None or pub.seo_indexable) else '<meta name="robots" content="noindex, nofollow">\n'

    image_tags = (
        f'<meta property="og:image" content="{e(image_url)}">\n'
        f'<meta property="og:image:alt" content="{e(title)}">\n'
        f'<meta name="twitter:image" content="{e(image_url)}">\n'
    ) if image_url else ""
    body = f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>{e(title)} · Cetrix Revistas</title>
<meta name="description" content="{e(description)}">
{robots}<link rel="canonical" href="{e(reader_url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Cetrix Revistas">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(reader_url)}">
{image_tags}<meta name="twitter:card" content="{'summary_large_image' if image_url else 'summary'}">
<meta name="twitter:title" content="{e(title)}">
<meta name="twitter:description" content="{e(description)}">
<meta http-equiv="refresh" content="0; url={e(reader_url)}">
</head><body><p><a href="{e(reader_url)}">{e(title)}</a></p></body></html>"""
    headers = {"Cache-Control": "public, max-age=300"}
    if robots:
        headers["X-Robots-Tag"] = "noindex, nofollow"
    return HTMLResponse(content=body, headers=headers)


@router.get("/og/{id}", response_class=HTMLResponse, include_in_schema=False)
def public_open_graph(id: uuid.UUID, request: Request, db: Session = Depends(get_db)):
    """
    HTML minimo con meta Open Graph / Twitter Card para que WhatsApp, Telegram,
    Facebook, X, LinkedIn... muestren portada, titulo y descripcion al
    compartir. El Reader es una SPA y los crawlers no ejecutan JS: nginx enruta
    aqui /leer/{id} y /r/... SOLO para user-agents de bots (ver
    RECETA-DESARROLLO.md). Un humano que llegue aqui se redirige al Reader.
    La URL canonica es la amigable /r/{empresa}/{coleccion}/{edicion}.
    """
    row = db.execute(_public_catalog_stmt().where(Publication.id == id)).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Publicación no encontrada o no es pública")
    return _open_graph_html(request, row)


@router.get("/og/r/{tenant_slug}/{collection_slug}/{edition_slug}", response_class=HTMLResponse, include_in_schema=False)
def public_open_graph_friendly(tenant_slug: str, collection_slug: str, edition_slug: str, request: Request, db: Session = Depends(get_db)):
    row = _resolve_friendly(db, tenant_slug, collection_slug, edition_slug)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edición no encontrada o no es pública")
    return _open_graph_html(request, row)
