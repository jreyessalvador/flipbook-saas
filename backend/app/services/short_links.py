"""Lote S1 (2026-10-04): enlaces cortos propios /s/{code}.

- Un codigo por edicion, aleatorio, base62 SIN caracteres ambiguos (0/O, 1/l/I)
  para que se pueda dictar o teclear desde un impreso.
- Se crea al crear/importar/clonar/publicar (y la migracion 0012 rellena las
  existentes). Nunca cambia: renombrar, cambiar slug o mover de coleccion no
  rompe el enlace ni los QR ya impresos.
- La redireccion solo funciona mientras la edicion es publica (kiosco); si no,
  se manda al inicio sin revelar empresa/coleccion/slug.
"""
import re
import secrets

from app.models.short_link import ShortLink

ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
CODE_LEN = 6
CODE_RE = re.compile(r"^[A-Za-z0-9]{4,16}$")
# Previsualizadores de enlaces y buscadores: siguen la redireccion pero no son
# lectores, asi que no cuentan como clic.
BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|"
    r"linkedin|slack|discord|skype|embedly|preview|pinterest|vkshare|quora|redditbot|"
    r"bingpreview|google-inspectiontool|headless|curl|wget|python-requests|httpx",
    re.I,
)


def new_code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))


def short_path(code: str) -> str:
    return f"/s/{code}"


def ensure_short_link(db, pub) -> ShortLink:
    """Devuelve el enlace corto de la edicion, creandolo si falta (hace flush)."""
    link = db.query(ShortLink).filter(ShortLink.publication_id == pub.id).first()
    if link is not None:
        return link
    for _ in range(20):
        code = new_code()
        if db.query(ShortLink.code).filter(ShortLink.code == code).first() is None:
            link = ShortLink(code=code, publication_id=pub.id, tenant_id=pub.tenant_id, clicks=0)
            db.add(link)
            db.flush()
            return link
    raise RuntimeError("No se pudo generar un codigo corto unico")


def is_bot(user_agent: str) -> bool:
    return not user_agent or bool(BOT_RE.search(user_agent))
