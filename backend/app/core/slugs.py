"""Slugs para URLs amigables del kiosco (/r/{empresa}/{coleccion}/{edicion})."""
import re
import unicodedata


def slugify(value: str, max_len: int = 80) -> str:
    v = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode()
    v = re.sub(r"[^a-zA-Z0-9]+", "-", v).strip("-").lower()
    return v[:max_len].strip("-") or "edicion"


def unique_publication_slug(db, collection_id, base: str, exclude_id=None) -> str:
    """Slug unico dentro de la coleccion (sufijo -2, -3... si ya existe)."""
    from app.models.publication import Publication
    root = slugify(base, 76)
    candidate, n = root, 2
    while True:
        # include_deleted: las ediciones en la papelera conservan su slug (el
        # indice unico de BD las cubre) para que restaurar nunca choque.
        q = db.query(Publication.id).execution_options(include_deleted=True).filter(Publication.collection_id == collection_id, Publication.slug == candidate)
        if exclude_id is not None:
            q = q.filter(Publication.id != exclude_id)
        if not q.first():
            return candidate
        candidate, n = f"{root}-{n}", n + 1
