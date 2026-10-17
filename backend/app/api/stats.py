"""Lote L6: panel de estadisticas de lectura (solo la propia empresa)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.rbac import require_role
from app.db.session import get_db
from app.models.publication import Publication
from app.models.user import User
from app.services.reader_stats import stats_for

router = APIRouter()


@router.get("/publications/{publication_id}/stats")
def publication_stats(publication_id: str, days: int = Query(30, ge=1, le=730), db: Session = Depends(get_db),
                      current_user: User = Depends(require_role("editor"))):
    try:
        pid = uuid.UUID(publication_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Publication not found")
    pub = db.query(Publication).filter(Publication.id == pid, Publication.tenant_id == current_user.effective_tenant_id).first()
    if not pub:
        raise HTTPException(status_code=404, detail="Publication not found")
    return stats_for(db, current_user.effective_tenant_id, pid, days)


@router.get("/stats/overview")
def overview_stats(days: int = Query(30, ge=1, le=730), db: Session = Depends(get_db),
                   current_user: User = Depends(require_role("editor"))):
    return stats_for(db, current_user.effective_tenant_id, None, days)
