"""Gestion de equipo por la propia empresa (Lote C2, 2026-09-27).

Hasta ahora solo Super Admin podia invitar (y solo propietarios). Aqui el
owner/admin de cada empresa gestiona su equipo dentro de su ambito:
- listar miembros, invitar, cambiar rol, reenviar invitacion y revocar;
- respeta ``max_seats`` del plan (miembros activos + invitados);
- admin solo gestiona editor/reviewer/reader; owner tambien admin;
- nadie puede tocar al propietario ni a si mismo desde aqui.
L9 (29-sep-2026): la invitacion se envia por correo. Solo si el correo NO
sale se devuelve el enlace (invite_token) para entregarlo por canal seguro.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.rbac import ROLE_RANK, require_role, role_rank
from app.services import mailer
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.commercial import Role, TenantMembership, TenantSubscription
from app.models.user import User

router = APIRouter()

INVITABLE = ("admin", "editor", "reviewer", "reader")
INVITE_DAYS = 7


class InviteRequest(BaseModel):
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=255)
    role: str = Field(pattern="^(admin|editor|reviewer|reader)$")


class RoleChangeRequest(BaseModel):
    role: str = Field(pattern="^(admin|editor|reviewer|reader)$")


def _audit(db, actor, action, tenant_id, entity_id=None, details=None):
    db.add(AuditLog(actor_user_id=actor.id, tenant_id=tenant_id, action=action, entity_type="membership",
                    entity_id=str(entity_id) if entity_id else None, details=details or {}))


def _can_manage(actor: User, target_role: str) -> bool:
    """owner gestiona admin/editor/reviewer/reader; admin solo por debajo de admin."""
    if target_role == "owner":
        return False
    actor_rank = role_rank(actor.tenant_role)
    if actor_rank >= ROLE_RANK["owner"]:
        return True
    return actor_rank > role_rank(target_role)


def _seat_limit(db: Session, tenant_id):
    sub = db.query(TenantSubscription).filter(
        TenantSubscription.tenant_id == tenant_id,
        TenantSubscription.status.in_(("trial", "active", "grace", "past_due")),
    ).first()
    if not sub:
        return None
    limit = (sub.limits_snapshot or {}).get("max_seats")
    return int(limit) if limit is not None else None


def _seats_used(db: Session, tenant_id) -> int:
    return db.query(TenantMembership).filter(
        TenantMembership.tenant_id == tenant_id,
        TenantMembership.status.in_(("active", "invited")),
    ).count()


def _get_member(db, membership_id, tenant_id):
    row = db.query(TenantMembership, User, Role).join(User, User.id == TenantMembership.user_id)\
        .join(Role, Role.id == TenantMembership.role_id)\
        .filter(TenantMembership.id == membership_id, TenantMembership.tenant_id == tenant_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    return row


def _new_invite_token(membership, actor):
    raw = secrets.token_urlsafe(32)
    membership.invite_token_hash = hashlib.sha256(raw.encode()).hexdigest()
    membership.invite_expires_at = datetime.now(timezone.utc) + timedelta(days=INVITE_DAYS)
    membership.invited_by = actor.id
    return raw


def _deliver_invite(db, email, raw, tenant_id, role_code, actor):
    """Envia la invitacion por correo. Devuelve el payload comun de respuesta:
    el token solo viaja al cliente si el correo NO salio (respaldo)."""
    from app.models.tenant import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    sent = mailer.send_invitation(email, raw, tenant.name if tenant else "tu empresa", role_code,
                                  getattr(actor, "full_name", None) or None, days_valid=INVITE_DAYS)
    return {"email_sent": sent, "invite_token": None if sent else raw}


@router.get("/members")
def list_members(db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    tenant_id = current_user.effective_tenant_id
    rows = db.query(TenantMembership, User, Role).join(User, User.id == TenantMembership.user_id)\
        .join(Role, Role.id == TenantMembership.role_id)\
        .filter(TenantMembership.tenant_id == tenant_id, TenantMembership.status != "revoked")\
        .order_by(Role.rank.desc(), User.email).all()
    return {
        "seats_used": _seats_used(db, tenant_id),
        "seats_limit": _seat_limit(db, tenant_id),
        "members": [{
            "id": str(m.id), "user_id": str(u.id), "email": u.email, "full_name": u.full_name,
            "role": r.code, "status": m.status, "last_login": u.last_login,
            "invite_expires_at": m.invite_expires_at if m.status == "invited" else None,
            "is_self": u.id == current_user.id,
            "can_manage": _can_manage(current_user, r.code) and u.id != current_user.id,
        } for m, u, r in rows],
    }


@router.post("/invitations", status_code=status.HTTP_201_CREATED)
def invite_member(data: InviteRequest, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    tenant_id = current_user.effective_tenant_id
    if not _can_manage(current_user, data.role):
        raise HTTPException(status_code=403, detail="Solo el propietario puede invitar administradores")
    email = str(data.email).lower().strip()

    user = db.query(User).filter(User.email == email).first()
    if user and user.tenant_id != tenant_id:
        # Cada usuario pertenece a UNA empresa. Nunca reutilizar/reactivar una
        # cuenta de otra empresa (evita secuestro de cuenta via invitacion).
        raise HTTPException(status_code=409, detail="Ese email ya tiene cuenta en otra empresa. Usa otro email.")
    membership = None
    if user:
        membership = db.query(TenantMembership).filter(TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user.id).first()
        if membership and membership.status == "active":
            raise HTTPException(status_code=409, detail="Esa persona ya es miembro activo del equipo")
        if user.is_active and user.password_hash and not user.password_hash.startswith("!"):
            raise HTTPException(status_code=409, detail="Esa cuenta ya existe y está activa")

    reuse_seat = membership is not None and membership.status == "invited"
    limit = _seat_limit(db, tenant_id)
    if limit is not None and not reuse_seat and _seats_used(db, tenant_id) >= limit:
        raise HTTPException(status_code=403, detail=f"Tu plan incluye {limit} usuarios y ya están ocupados. Amplía el plan o revoca a alguien.")

    role = db.query(Role).filter(Role.scope == "tenant", Role.code == data.role).first()
    if not user:
        user = User(email=email, full_name=(data.full_name or "").strip() or None, password_hash="!invitation-pending!",
                    is_active=False, role="editor", tenant_id=tenant_id)
        db.add(user); db.flush()
    elif data.full_name:
        user.full_name = data.full_name.strip()
    if not membership:
        membership = TenantMembership(tenant_id=tenant_id, user_id=user.id, role_id=role.id)
        db.add(membership)
    membership.role_id, membership.status = role.id, "invited"
    membership.accepted_at, membership.revoked_at = None, None
    raw = _new_invite_token(membership, current_user)
    db.flush()
    _audit(db, current_user, "team.invited", tenant_id, membership.id, {"email": email, "role": data.role})
    db.commit()
    return {"membership_id": str(membership.id), "email": email, "role": data.role,
            "expires_at": membership.invite_expires_at,
            **_deliver_invite(db, email, raw, tenant_id, data.role, current_user)}


@router.post("/members/{membership_id}/resend")
def resend_invite(membership_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    m, u, r = _get_member(db, membership_id, current_user.effective_tenant_id)
    if m.status != "invited":
        raise HTTPException(status_code=409, detail="Solo se reenvían invitaciones pendientes")
    if not _can_manage(current_user, r.code):
        raise HTTPException(status_code=403, detail="No puedes gestionar a este miembro")
    raw = _new_invite_token(m, current_user)
    _audit(db, current_user, "team.invite_resent", m.tenant_id, m.id, {"email": u.email})
    db.commit()
    return {"email": u.email, "expires_at": m.invite_expires_at,
            **_deliver_invite(db, u.email, raw, m.tenant_id, r.code, current_user)}


@router.patch("/members/{membership_id}")
def change_role(membership_id: str, data: RoleChangeRequest, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    m, u, r = _get_member(db, membership_id, current_user.effective_tenant_id)
    if u.id == current_user.id:
        raise HTTPException(status_code=403, detail="No puedes cambiar tu propio rol")
    if not _can_manage(current_user, r.code) or not _can_manage(current_user, data.role):
        raise HTTPException(status_code=403, detail="No puedes asignar ese rol a este miembro")
    role = db.query(Role).filter(Role.scope == "tenant", Role.code == data.role).first()
    m.role_id = role.id
    _audit(db, current_user, "team.role_changed", m.tenant_id, m.id, {"email": u.email, "from": r.code, "to": data.role})
    db.commit()
    return {"id": str(m.id), "role": data.role}


@router.delete("/members/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_member(membership_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_role("admin"))):
    m, u, r = _get_member(db, membership_id, current_user.effective_tenant_id)
    if u.id == current_user.id:
        raise HTTPException(status_code=403, detail="No puedes revocarte a ti mismo")
    if not _can_manage(current_user, r.code):
        raise HTTPException(status_code=403, detail="No puedes revocar a este miembro")
    m.status, m.revoked_at, m.invite_token_hash = "revoked", datetime.now(timezone.utc), None
    _audit(db, current_user, "team.revoked", m.tenant_id, m.id, {"email": u.email, "role": r.code})
    db.commit()
