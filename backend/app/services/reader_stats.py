"""Lote L6 (17-oct-2026): estadisticas de lectura sin cookies.

Privacidad por diseno (RGPD / LFPDPPP):
- No se guarda IP ni user-agent. Solo clases ("mobile", "chrome", "MX"...).
- El visitante es un hash diario: HMAC(sal del dia, ip|user-agent|edicion). La sal se deriva del
  secreto del servidor y de la fecha, y rota cada dia: no permite seguir a una persona entre dias.
- Respeta DNT y Sec-GPC (no se registra nada) y descarta bots / previsualizadores de enlaces.
- El pais sale de una base local (DB-IP Lite); la IP nunca sale del servidor.
"""
import hashlib
import hmac
import ipaddress
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import text

logger = logging.getLogger("flipbook.reader_stats")

GEO_DB_PATH = os.getenv("GEO_DB_PATH", "/app/data/geo/dbip-country-lite.mmdb")
EVENTS = {"open", "view", "time", "click"}
ACTS = {"url", "email", "phone", "page"}
SRC_RE = re.compile(r"^[a-z0-9]{1,12}$")
HOST_RE = re.compile(r"^[a-z0-9.-]{3,120}$")
MAX_MS = 300_000          # tope por pagina: una pestana olvidada no infla el tiempo
RATE_PER_MIN = 300        # eventos por IP y minuto

_geo = None
_geo_failed = False


# ---------------------------------------------------------------- pais por IP
def country_of(ip: Optional[str]) -> Optional[str]:
    global _geo, _geo_failed
    if not ip or _geo_failed:
        return None
    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private or addr.is_loopback or addr.is_reserved or addr.is_link_local:
            return None
        if _geo is None:
            import maxminddb
            _geo = maxminddb.open_database(GEO_DB_PATH)
        rec = _geo.get(ip) or {}
        code = (rec.get("country") or {}).get("iso_code")
        return code if code and len(code) == 2 else None
    except FileNotFoundError:
        _geo_failed = True
        logger.warning("Base de paises no encontrada en %s; las estadisticas sin pais", GEO_DB_PATH)
    except Exception:
        logger.exception("country_of")
    return None


# ---------------------------------------------------------------- clases de UA
def classify_ua(ua: str):
    u = (ua or "").lower()
    device = "tablet" if ("ipad" in u or "tablet" in u or ("android" in u and "mobile" not in u)) \
        else "mobile" if ("mobi" in u or "iphone" in u or "android" in u) else "desktop"
    browser = ("edge" if ("edg/" in u or "edge/" in u) else "opera" if ("opr/" in u or "opera" in u)
               else "samsung" if "samsungbrowser" in u else "firefox" if ("firefox" in u or "fxios" in u)
               else "chrome" if ("chrome" in u or "crios" in u) else "safari" if "safari" in u else "otro")
    os_ = ("ios" if ("iphone" in u or "ipad" in u or "ipod" in u) else "android" if "android" in u
           else "windows" if "windows" in u else "macos" if ("mac os" in u or "macintosh" in u)
           else "linux" if ("linux" in u or "x11" in u) else "otro")
    return device, browser, os_


def visitor_hash(ip: str, ua: str, publication_id: str, day: date) -> str:
    from app.config import settings
    key = f"{settings.JWT_SECRET_KEY}:reader:{day.isoformat()}".encode()
    return hmac.new(key, f"{ip}|{ua}|{publication_id}".encode(), hashlib.sha256).hexdigest()[:16]


def host_of(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        h = (urlparse(url if "//" in url else f"//{url}").hostname or "").lower().strip(".")
        if h.startswith("www."):
            h = h[4:]
        return h if HOST_RE.match(h) else None
    except Exception:
        return None


# ---------------------------------------------------------------- limite por IP (Redis, falla abierto)
def rate_ok(ip: str) -> bool:
    try:
        import redis
        from app.config import settings
        r = redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
        key = f"rs:{hashlib.sha1(ip.encode()).hexdigest()[:12]}:{int(datetime.now(timezone.utc).timestamp() // 60)}"
        n = r.incr(key)
        if n == 1:
            r.expire(key, 90)
        return n <= RATE_PER_MIN
    except Exception:
        return True


# ---------------------------------------------------------------- consultas del panel
def _days_range(days: int):
    days = max(1, min(int(days), 730))
    today = datetime.now(timezone.utc).date()
    return today - timedelta(days=days - 1), today, days


def _rows(db, sql, **p):
    return [dict(r._mapping) for r in db.execute(text(sql), p).all()]


def stats_for(db, tenant_id, publication_id=None, days: int = 30) -> dict:
    d0, d1, days = _days_range(days)
    pub_sql = "AND publication_id = :pid" if publication_id else ""
    p = {"t": tenant_id, "d0": d0, "d1": d1}
    if publication_id:
        p["pid"] = publication_id
    base = f"FROM reader_events WHERE tenant_id = :t AND day BETWEEN :d0 AND :d1 {pub_sql}"

    tot = _rows(db, f"""SELECT
        count(*) FILTER (WHERE event='open') AS opens,
        count(*) FILTER (WHERE event='view') AS page_views,
        count(*) FILTER (WHERE event='click') AS clicks,
        coalesce(sum(ms) FILTER (WHERE event='time'),0) AS time_ms,
        count(DISTINCT country) FILTER (WHERE event='open' AND country IS NOT NULL) AS countries,
        count(*) FILTER (WHERE event='open' AND embed) AS embed_opens {base}""", **p)[0]
    opens = int(tot["opens"] or 0)

    by_day = {r["day"]: r for r in _rows(db, f"""SELECT day,
        count(*) FILTER (WHERE event='open') AS opens, count(*) FILTER (WHERE event='view') AS views,
        coalesce(sum(ms) FILTER (WHERE event='time'),0) AS time_ms {base} GROUP BY day""", **p)}
    series = []
    d = d0
    while d <= d1:
        r = by_day.get(d)
        series.append({"day": d.isoformat(), "opens": int(r["opens"]) if r else 0, "views": int(r["views"]) if r else 0,
                       "time_ms": int(r["time_ms"]) if r else 0})
        d += timedelta(days=1)

    def top(col, where="event='open'", n=12):
        return [{"key": r["k"], "n": int(r["n"])} for r in _rows(db, f"""SELECT {col} AS k, count(*) AS n {base}
            AND {where} AND {col} IS NOT NULL GROUP BY 1 ORDER BY n DESC, k LIMIT {n}""", **p)]

    out = {
        "range": {"from": d0.isoformat(), "to": d1.isoformat(), "days": days},
        "totals": {
            "opens": opens, "page_views": int(tot["page_views"] or 0), "clicks": int(tot["clicks"] or 0),
            "avg_time_ms": int((tot["time_ms"] or 0) / opens) if opens else 0,
            "pages_per_read": round((tot["page_views"] or 0) / opens, 1) if opens else 0,
            "countries": int(tot["countries"] or 0), "embed_opens": int(tot["embed_opens"] or 0),
        },
        "series": series,
        "countries": top("country"),
        "devices": top("device"), "browsers": top("browser"), "systems": top("os"),
        "sources": top("src"), "referrers": top("ref_host", "event='open' AND NOT embed"),
        "embeds": top("ref_host", "event='open' AND embed"),
        "click_acts": top("act", "event='click'"), "click_targets": top("target", "event='click' AND act='url'"),
        "hourly_utc": [0] * 24,
    }
    for r in _rows(db, f"""SELECT extract(hour from created_at at time zone 'UTC')::int AS h, count(*) AS n {base}
                           AND event='open' GROUP BY 1""", **p):
        out["hourly_utc"][int(r["h"])] = int(r["n"])

    if publication_id:
        pages = _rows(db, f"""SELECT page, count(*) FILTER (WHERE event='view') AS views,
            count(DISTINCT (day, visitor)) FILTER (WHERE event='view') AS readers,
            coalesce(avg(ms) FILTER (WHERE event='time'),0)::int AS avg_ms {base}
            AND page IS NOT NULL GROUP BY page ORDER BY page""", **p)
        out["pages"] = [{"page": r["page"], "views": int(r["views"]), "readers": int(r["readers"]),
                         "avg_ms": int(r["avg_ms"]), "reach": round(100 * int(r["readers"]) / opens, 1) if opens else 0}
                        for r in pages]
        life = db.execute(text("SELECT views_count, total_pages, title FROM publications WHERE id = :pid AND tenant_id = :t"),
                          {"pid": publication_id, "t": tenant_id}).first()
        out["publication"] = {"id": str(publication_id), "title": life.title if life else "",
                              "views_count": int(life.views_count or 0) if life else 0,
                              "total_pages": int(life.total_pages or 0) if life else 0}
    else:
        out["editions"] = [
            {"id": str(r["id"]), "title": r["title"], "collection": r["collection_name"], "opens": int(r["opens"]),
             "page_views": int(r["views"]), "avg_time_ms": int(r["time_ms"] / r["opens"]) if r["opens"] else 0,
             "lifetime": int(r["views_count"] or 0), "last": r["last"].isoformat() if r["last"] else None}
            for r in _rows(db, """SELECT p.id, p.title, p.views_count, c.name AS collection_name,
                count(e.*) FILTER (WHERE e.event='open') AS opens, count(e.*) FILTER (WHERE e.event='view') AS views,
                coalesce(sum(e.ms) FILTER (WHERE e.event='time'),0) AS time_ms, max(e.created_at) AS last
                FROM publications p JOIN collections c ON c.id = p.collection_id
                LEFT JOIN reader_events e ON e.publication_id = p.id AND e.day BETWEEN :d0 AND :d1
                WHERE p.tenant_id = :t AND p.deleted_at IS NULL
                GROUP BY p.id, p.title, p.views_count, c.name ORDER BY opens DESC, p.title LIMIT 200""", **p)
        ]
    return out
