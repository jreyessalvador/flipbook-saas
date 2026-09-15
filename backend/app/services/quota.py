from fastapi import HTTPException, status
from sqlalchemy import func
from app.models.commercial import TenantSubscription, TenantUsage
from app.models.publication import Publication
from app.models.asset import Asset

def usage_and_limits(db, tenant_id):
    sub = db.query(TenantSubscription).filter(TenantSubscription.tenant_id == tenant_id, TenantSubscription.status.in_(("trial", "active", "grace"))).first()
    if not sub:
        return None, None
    storage = int(db.query(func.coalesce(func.sum(Asset.size_bytes), 0)).filter(Asset.tenant_id == tenant_id).scalar() or 0)
    active = int(db.query(func.count(Publication.id)).filter(Publication.tenant_id == tenant_id, Publication.status != "archived").scalar() or 0)
    usage = db.query(TenantUsage).filter(TenantUsage.tenant_id == tenant_id).first()
    if usage:
        usage.storage_bytes, usage.active_publications = storage, active
    return {"storage_bytes": storage, "active_publications": active}, sub.limits_snapshot or {}

def require_publication_quota(db, tenant_id):
    usage, limits = usage_and_limits(db, tenant_id)
    if usage is None: return
    limit = limits.get("max_active_publications")
    if limit is not None and usage["active_publications"] >= int(limit):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Has alcanzado el límite de publicaciones activas de tu plan")

def require_storage_quota(db, tenant_id, incoming_bytes):
    usage, limits = usage_and_limits(db, tenant_id)
    if usage is None: return
    limit = limits.get("max_storage_bytes")
    if limit is not None and usage["storage_bytes"] + incoming_bytes > int(limit):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="La subida excede el almacenamiento incluido en tu plan")
