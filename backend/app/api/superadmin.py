from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.api.auth import get_current_user
from app.models.user import User
from app.models.tenant import Tenant
from app.models.commercial import Plan, TenantSubscription, TenantUsage, Role, UserPlatformRole

router = APIRouter()

def require_superadmin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    allowed = db.query(UserPlatformRole).join(Role).filter(UserPlatformRole.user_id == current_user.id, Role.scope == "platform", Role.code == "superadmin").first()
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Requiere rol Super Admin CETRIX")
    return current_user

@router.get("/overview")
def overview(_: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    tenants = db.query(Tenant).all()
    usage = {str(row.tenant_id): row for row in db.query(TenantUsage).all()}
    subscriptions = {str(row.tenant_id): row for row in db.query(TenantSubscription).filter(TenantSubscription.status.in_(["trial", "active", "grace", "past_due", "suspended"])).all()}
    plans = {str(row.id): row for row in db.query(Plan).all()}
    return {"tenants": [{"id": str(t.id), "name": t.name, "status": t.status, "subdomain": t.subdomain, "usage": {"storage_bytes": usage.get(str(t.id)).storage_bytes if usage.get(str(t.id)) else 0, "active_publications": usage.get(str(t.id)).active_publications if usage.get(str(t.id)) else 0, "seats": usage.get(str(t.id)).seats if usage.get(str(t.id)) else 0}, "subscription": ({"plan": plans.get(str(subscriptions[str(t.id)].plan_id)).name if plans.get(str(subscriptions[str(t.id)].plan_id)) else "Plan eliminado", "currency": subscriptions[str(t.id)].currency, "unit_amount": float(subscriptions[str(t.id)].unit_amount), "status": subscriptions[str(t.id)].status} if str(t.id) in subscriptions else None)} for t in tenants]}

@router.get("/plans")
def plans(_: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return [{"id": str(p.id), "code": p.code, "name": p.name, "currency": p.currency, "unit_amount": float(p.unit_amount), "billing_interval": p.billing_interval, "max_seats": p.max_seats, "max_active_publications": p.max_active_publications, "max_storage_bytes": p.max_storage_bytes, "is_sellable": p.is_sellable, "is_active": p.is_active} for p in db.query(Plan).order_by(Plan.unit_amount).all()]
