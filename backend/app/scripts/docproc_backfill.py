"""Lote DOC-1 (11-oct-2026): migra las ediciones importadas ANTES de docproc.

Para cada edicion creada desde PDF:
  1. envia el PDF original a cetrix-docproc (optimizar + paginas WebP),
  2. sube las paginas WebP y sustituye TODAS las referencias a los JPEG viejos
     (elementos, snapshots publicados, trabajos de render, miniaturas, portada;
     incluye clones, que apuntan a las paginas de su original),
  3. sustituye el PDF original por el optimizado (misma clave),
  4. borra los JPEG viejos que ya no referencia nadie.
Idempotente: el PDF optimizado lleva el metadato docproc y una edicion sin
fondos .jpg y con ese metadato se salta.

Uso (dentro del contenedor pdf-worker del entorno):
  python -m app.scripts.docproc_backfill --dry-run
  python -m app.scripts.docproc_backfill [--only <publication_id>]
  python -m app.scripts.docproc_backfill --orphans [--dry-run]
      borra paginas WebP/JPEG de importacion que ya no referencia nadie
      (solo objetos con mas de 1 hora, para no tocar importaciones en curso).
Solo una ejecucion a la vez (bloqueo consultivo de PostgreSQL).
"""
import argparse
import datetime
import re
import sys
import uuid
from io import BytesIO

from sqlalchemy import text

from app.db.session import SessionLocal
from app.api.assets import minio_client, BUCKET_NAME, build_asset_url
from app.services import docproc
from app.services.trash import storage_key_from_url, _is_referenced
from app.config import settings

META = "docproc"


def replace_everywhere(db, old, new):
    pat = "%" + old.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    p = {"old": old, "new": new, "pat": pat}
    n = 0
    for sql in (
        "UPDATE page_elements SET props = replace(props::text, :old, :new)::jsonb WHERE props::text LIKE :pat ESCAPE '\\'",
        "UPDATE publication_versions SET snapshot = replace(snapshot::text, :old, :new)::jsonb WHERE snapshot::text LIKE :pat ESCAPE '\\'",
        "UPDATE render_jobs SET snapshot = replace(snapshot::text, :old, :new)::jsonb WHERE snapshot::text LIKE :pat ESCAPE '\\'",
        "UPDATE pages SET content = replace(content::text, :old, :new)::json WHERE content::text LIKE :pat ESCAPE '\\'",
        "UPDATE pages SET thumbnail_url = replace(thumbnail_url, :old, :new) WHERE thumbnail_url LIKE :pat ESCAPE '\\'",
        "UPDATE publications SET cover_image_url = replace(cover_image_url, :old, :new) WHERE cover_image_url LIKE :pat ESCAPE '\\'",
    ):
        n += db.execute(text(sql), p).rowcount or 0
    return n


def old_backgrounds(db, pub_id):
    """{indice_pagina_pdf: url_jpeg} de los fondos rasterizados por el import antiguo."""
    rx = re.compile(r"/publications/" + re.escape(str(pub_id)) + r"/pages/(\d+)-[0-9a-f-]+\.jpg$")
    rows = db.execute(text("""
        SELECT DISTINCT pe.props->>'src' FROM page_elements pe
        WHERE pe.props->>'src' LIKE :pat
    """), {"pat": f"%/publications/{pub_id}/pages/%.jpg"}).all()
    out = {}
    for (src,) in rows:
        m = rx.search(src or "")
        if m:
            out.setdefault(int(m.group(1)), set()).add(src)
    return out


LOCK_ID = 7_311_001  # pg_advisory_lock: una sola ejecucion del backfill a la vez


def orphans(db, dry_run):
    rx = re.compile(r"^tenant-[^/]+/publications/[^/]+/pages/[^/]+\.(webp|jpg)$")
    limit = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
    n = size = 0
    for obj in minio_client.list_objects(BUCKET_NAME, recursive=True):
        if not rx.match(obj.object_name) or obj.last_modified > limit:
            continue
        if _is_referenced(db, obj.object_name):
            continue
        n += 1
        size += obj.size
        print(("  [dry-run] " if dry_run else "  borrado ") + obj.object_name)
        if not dry_run:
            minio_client.remove_object(BUCKET_NAME, obj.object_name)
    print(f"huerfanos: {n} objetos, {size/1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--orphans", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    if not db.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar():
        sys.exit("Ya hay otra ejecucion del backfill en curso")
    if args.orphans:
        return orphans(db, args.dry_run)
    if not docproc.enabled():
        sys.exit("DOCPROC_URL/DOCPROC_TOKEN no configurados")
    h = docproc.health()
    print("docproc:", h)
    if not h.get("worker_online") and not args.dry_run:
        sys.exit("worker docproc sin conexion")

    q = "SELECT id, tenant_id, pdf_url, status, title FROM publications WHERE creation_type='pdf' AND pdf_url IS NOT NULL"
    params = {}
    if args.only:
        q += " AND id = :id"
        params["id"] = args.only
    pubs = db.execute(text(q + " ORDER BY created_at"), params).all()
    tot_before = tot_after = 0
    for pub_id, tenant_id, pdf_url, status, title in pubs:
        key = storage_key_from_url(pdf_url)
        try:
            st = minio_client.stat_object(BUCKET_NAME, key)
        except Exception:
            print(f"- {pub_id} {title!r}: PDF no encontrado en MinIO, se salta")
            continue
        meta = {k.lower(): v for k, v in (st.metadata or {}).items()}
        backgrounds = old_backgrounds(db, pub_id)
        done_pdf = any(k.endswith(META) for k in meta)
        if done_pdf and not backgrounds:
            print(f"- {pub_id} {title!r}: ya migrada")
            continue
        old_keys = {storage_key_from_url(u) for urls in backgrounds.values() for u in urls}
        old_bytes = 0
        for k in old_keys:
            try:
                old_bytes += minio_client.stat_object(BUCKET_NAME, k).size
            except Exception:
                pass
        print(f"- {pub_id} {title!r} [{status}]: PDF {st.size/1e6:.1f} MB, {len(backgrounds)} fondos JPEG ({old_bytes/1e6:.1f} MB)")
        if args.dry_run:
            tot_before += st.size + old_bytes
            continue

        resp = minio_client.get_object(BUCKET_NAME, key)
        pdf_bytes = resp.read(); resp.close(); resp.release_conn()
        job_id, job = docproc.optimize_pdf(pdf_bytes, render_pages=bool(backgrounds))
        try:
            res = job["result"]
            new_bytes = 0
            for pg in res.get("page_images") or []:
                urls = backgrounds.get(pg["n"])
                if not urls:
                    continue
                data = docproc.fetch(job_id, pg["file"])
                nkey = f"tenant-{tenant_id}/publications/{pub_id}/pages/{pg['n']}-{uuid.uuid4()}.webp"
                minio_client.put_object(BUCKET_NAME, nkey, BytesIO(data), len(data), content_type="image/webp")
                new_bytes += len(data)
                for old in urls:
                    replace_everywhere(db, old, build_asset_url(nkey))
            pdf_after = st.size
            if not done_pdf and res.get("method") != "original":
                opt = docproc.fetch(job_id, "document.pdf")
                if opt[:5] == b"%PDF-" and len(opt) < st.size:
                    minio_client.put_object(BUCKET_NAME, key, BytesIO(opt), len(opt), content_type="application/pdf",
                                            metadata={META: settings.DOCPROC_PDF_PROFILE})
                    pdf_after = len(opt)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            docproc.delete(job_id)
        removed = 0
        for k in old_keys:
            if not _is_referenced(db, k):
                minio_client.remove_object(BUCKET_NAME, k)
                removed += 1
            else:
                print(f"    aviso: {k} sigue referenciado, no se borra")
        tot_before += st.size + old_bytes
        tot_after += pdf_after + new_bytes
        print(f"    -> PDF {pdf_after/1e6:.1f} MB, WebP {new_bytes/1e6:.1f} MB, {removed} JPEG borrados")
    print(f"TOTAL antes {tot_before/1e6:.1f} MB" + ("" if args.dry_run else f" -> despues {tot_after/1e6:.1f} MB"))
    db.close()


if __name__ == "__main__":
    main()
