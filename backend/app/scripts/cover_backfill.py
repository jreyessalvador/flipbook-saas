"""Lote L7a: encola el render de portada de las ediciones publicadas que aun no
tienen portada renderizada (o cuya portada es de una version anterior).

  docker exec flipbook-dev-backend python -m app.scripts.cover_backfill --dry-run
  docker exec flipbook-dev-backend python -m app.scripts.cover_backfill [--limit N]
  ... --only-video   re-renderiza solo las ediciones cuya hoja 1 tiene un video (fotograma)
  ... --force        re-renderiza aunque ya tengan portada vigente (cada render usa claves nuevas)

Re-ejecutable: request_cover reutiliza el trabajo si ya existe para esa version.
El worker de Contabo 2 los va procesando de uno en uno.
"""
import argparse
import sys

sys.path.insert(0, "/app")
from app.db.session import SessionLocal  # noqa: E402
from app.models.publication import Publication  # noqa: E402
from app.models.publication_version import PublicationVersion  # noqa: E402
from app.services.render_jobs import request_cover, _first_page  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only-video", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        q = db.query(Publication).filter(Publication.published_version_id.isnot(None))
        if not (args.force or args.only_video):
            q = q.filter((Publication.cover_key.is_(None)) | (Publication.cover_version_id != Publication.published_version_id))
        pubs = q.order_by(Publication.created_at).all()
        if args.limit:
            pubs = pubs[: args.limit]
        queued = skipped = 0
        for pub in pubs:
            ver = db.query(PublicationVersion).filter(PublicationVersion.id == pub.published_version_id).first()
            if ver is None:
                skipped += 1
                continue
            if args.only_video:
                first = _first_page(ver.snapshot or {}) or {}
                if not any(el.get("kind") == "video" for el in first.get("elements") or []):
                    continue
            print(("[dry-run] " if args.dry_run else "") + f"{pub.id}  {pub.title[:50]!r}")
            if not args.dry_run:
                job = request_cover(db, pub, ver, force=args.force or args.only_video)
                queued += 1 if job is not None else 0
                skipped += 0 if job is not None else 1
        print(f"Ediciones candidatas: {len(pubs)} | encoladas/reutilizadas: {queued} | omitidas: {skipped}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
