from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, EmailStr
from datetime import datetime, timedelta
import hashlib, secrets
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.api.auth import get_current_user
from app.models.user import User
from app.models.tenant import Tenant
from app.models.commercial import Plan, TenantSubscription, TenantUsage, TenantDomain, Role, UserPlatformRole
from app.models.commercial import TenantMembership
from app.core.security import get_password_hash

router = APIRouter()

class TenantCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    subdomain: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$")
    plan_code: str

class TenantStatusRequest(BaseModel):
    status: str = Field(pattern=r"^(active|suspended)$")

class OwnerInviteRequest(BaseModel):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=255)

class InviteAcceptRequest(BaseModel):
    token: str = Field(min_length=32)
    password: str = Field(min_length=12, max_length=128)

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

@router.post("/tenants", status_code=status.HTTP_201_CREATED)
def create_tenant(data: TenantCreateRequest, current_user: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Crea solo la empresa y su contrato. El propietario se añade después por invitación segura."""
    subdomain = data.subdomain.lower()
    if db.query(Tenant).filter(Tenant.subdomain == subdomain).first():
        raise HTTPException(status_code=409, detail="El subdominio ya está en uso")
    plan = db.query(Plan).filter(Plan.code == data.plan_code, Plan.is_active.is_(True), Plan.is_sellable.is_(True)).first()
    if not plan:
        raise HTTPException(status_code=422, detail="Plan comercial no disponible")
    tenant = Tenant(name=data.name.strip(), subdomain=subdomain, schema_name=f"tenant_{subdomain.replace('-', '_')}", plan=plan.code, status="active", max_publications=plan.max_active_publications or 0, max_storage_mb=(plan.max_storage_bytes or 0) // (1024 * 1024))
    db.add(tenant); db.flush()
    limits = {"max_seats": plan.max_seats, "max_active_publications": plan.max_active_publications, "max_storage_bytes": plan.max_storage_bytes, "max_import_jobs_period": plan.max_import_jobs_period, "max_import_pages_period": plan.max_import_pages_period}
    db.add(TenantSubscription(tenant_id=tenant.id, plan_id=plan.id, status="active", currency=plan.currency, unit_amount=plan.unit_amount, billing_interval=plan.billing_interval, tax_included=plan.tax_included, limits_snapshot=limits, source="superadmin", created_by=current_user.id))
    db.add(TenantUsage(tenant_id=tenant.id))
    db.add(TenantDomain(tenant_id=tenant.id, hostname=subdomain, kind="platform_subdomain", status="verified"))
    db.commit(); db.refresh(tenant)
    return {"id": str(tenant.id), "name": tenant.name, "subdomain": tenant.subdomain, "owner_invitation_pending": True}

@router.patch("/tenants/{tenant_id}/status")
def set_tenant_status(tenant_id: str, data: TenantStatusRequest, _: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")
    tenant.status = data.status
    db.commit()
    return {"id": str(tenant.id), "status": tenant.status}

@router.post("/tenants/{tenant_id}/owner-invitations", status_code=status.HTTP_201_CREATED)
def invite_owner(tenant_id: str, data: OwnerInviteRequest, current_user: User = Depends(require_superadmin), db: Session = Depends(get_db)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant: raise HTTPException(status_code=404, detail="Tenant no encontrado")
    user = db.query(User).filter(User.email == str(data.email).lower()).first()
    if not user:
        # Usuario inactivo hasta que el destinatario defina su propia contraseña.
        user = User(email=str(data.email).lower(), full_name=data.full_name, password_hash="!invitation-pending!", is_active=False, role="editor", tenant_id=tenant.id)
        db.add(user); db.flush()
    owner_role = db.query(Role).filter(Role.scope == "tenant", Role.code == "owner").first()
    if not owner_role: raise HTTPException(status_code=500, detail="Roles base no inicializados")
    membership = db.query(TenantMembership).filter(TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id).first()
    raw_token = secrets.token_urlsafe(32)
    if not membership:
        membership = TenantMembership(tenant_id=tenant.id, user_id=user.id, role_id=owner_role.id)
        db.add(membership)
    membership.role_id, membership.status = owner_role.id, "invited"
    membership.invited_by, membership.invite_token_hash = current_user.id, hashlib.sha256(raw_token.encode()).hexdigest()
    membership.invite_expires_at, membership.accepted_at, membership.revoked_at = datetime.utcnow() + timedelta(days=7), None, None
    db.commit()
    # El token solo se devuelve ahora para que el panel lo entregue por canal seguro.
    return {"email": user.email, "expires_at": membership.invite_expires_at, "invite_token": raw_token}

@router.post("/invitations/accept")
def accept_invitation(data: InviteAcceptRequest, db: Session = Depends(get_db)):
    digest = hashlib.sha256(data.token.encode()).hexdigest()
    membership = db.query(TenantMembership).filter(TenantMembership.invite_token_hash == digest, TenantMembership.status == "invited").first()
    if not membership or not membership.invite_expires_at or membership.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invitación inválida o caducada")
    user = db.query(User).filter(User.id == membership.user_id).first()
    user.password_hash, user.is_active = get_password_hash(data.password), True
    membership.status, membership.accepted_at, membership.invite_token_hash = "active", datetime.utcnow(), None
    db.commit()
    return {"status": "accepted"}
