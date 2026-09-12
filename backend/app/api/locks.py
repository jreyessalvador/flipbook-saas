"""
Bloqueo de edicion "un editor a la vez por publicacion".
Ver docs/arquitectura-editor-2026-09-12.md, seccion 5.

Reglas:
- POST   /publications/{id}/lock            -> intenta tomar el lock
- PUT    /publications/{id}/lock/heartbeat  -> refresca heartbeat (frontend cada ~20s)
- DELETE /publications/{id}/lock            -> libera el lock (guardar o salir)

Un lock se considera expirado si heartbeat_at tiene mas de LOCK_TIMEOUT_SECONDS
de antiguedad -- en ese caso cualquiera puede tomarlo de nuevo sin error.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.db.session import get_db
from app.models.user import User
from app.models.publication import Publication
from app.models.edit_lock import EditLock
from app.schemas.lock import LockResponse
from app.api.auth import get_current_user

router = APIRouter()

LOCK_TIMEOUT_SECONDS = 60


def _is_expired(lock: EditLock) -> bool:
    heartbeat = lock.heartbeat_at
    if heartbeat.tzinfo is None:
        heartbeat = heartbeat.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - heartbeat) > timedelta(seconds=LOCK_TIMEOUT_SECONDS)


def _get_publication_or_404(db: Session, publication_id: str, tenant_id) -> Publication:
    publication = db.query(Publication)\
        .filter(Publication.id == publication_id)\
        .filter(Publication.tenant_id == tenant_id)\
        .first()
    if not publication:
        raise HTTPException(status_code=404, detail="Publication not found")
    return publication


@router.post("/{publication_id}/lock", response_model=LockResponse)
def acquire_lock(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_publication_or_404(db, publication_id, current_user.tenant_id)

    existing = db.query(EditLock).filter(EditLock.publication_id == publication_id).first()

    if existing and str(existing.locked_by_user) != str(current_user.id) and not _is_expired(existing):
        holder = db.query(User).filter(User.id == existing.locked_by_user).first()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Publicacion bloqueada por {holder.full_name if holder else 'otro usuario'}",
        )

    if existing:
        # Ya expirado, o es el mismo usuario reabriendo -- se toma/renueva.
        existing.locked_by_user = current_user.id
        db.commit()
        db.refresh(existing)
        return existing

    # Bug real encontrado en Fase B (12-sep-2026, ver RECETA-DESARROLLO.md):
    # entre el SELECT de arriba y este INSERT hay una ventana de carrera --
    # dos peticiones POST /lock casi simultaneas para la MISMA publicacion
    # (p.ej. el doble-efecto de React 18 en modo desarrollo, o dos pestañas
    # abriendo el editor al mismo tiempo) pueden ambas ver "no hay lock" y
    # ambas intentar el INSERT. La segunda choca contra la PK de
    # edit_locks (publication_id) y antes tumbaba la peticion con un 500 sin
    # manejar. Se captura el conflicto y se resuelve como si hubiera llegado
    # tarde al SELECT: re-consultar y aplicar la misma logica de arriba.
    try:
        new_lock = EditLock(publication_id=publication_id, locked_by_user=current_user.id)
        db.add(new_lock)
        db.commit()
        db.refresh(new_lock)
        return new_lock
    except IntegrityError:
        db.rollback()
        existing = db.query(EditLock).filter(EditLock.publication_id == publication_id).first()
        if existing and str(existing.locked_by_user) != str(current_user.id) and not _is_expired(existing):
            holder = db.query(User).filter(User.id == existing.locked_by_user).first()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Publicacion bloqueada por {holder.full_name if holder else 'otro usuario'}",
            )
        if existing:
            existing.locked_by_user = current_user.id
            db.commit()
            db.refresh(existing)
            return existing
        # No deberia poder pasar (alguien mas borro el lock entre el fallo y
        # esta reconsulta) -- lo tratamos como error transitorio.
        raise HTTPException(status_code=409, detail="Conflicto adquiriendo el lock, reintenta")


@router.put("/{publication_id}/lock/heartbeat", response_model=LockResponse)
def refresh_heartbeat(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lock = db.query(EditLock).filter(EditLock.publication_id == publication_id).first()
    if not lock or str(lock.locked_by_user) != str(current_user.id):
        raise HTTPException(status_code=409, detail="No tienes el lock de esta publicacion (recargala)")

    # onupdate=func.now() en el modelo actualiza heartbeat_at con cualquier UPDATE;
    # forzamos un cambio real reasignando el mismo valor de locked_by_user.
    lock.locked_by_user = current_user.id
    db.commit()
    db.refresh(lock)
    return lock


@router.delete("/{publication_id}/lock", status_code=status.HTTP_204_NO_CONTENT)
def release_lock(
    publication_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lock = db.query(EditLock).filter(EditLock.publication_id == publication_id).first()
    if lock and str(lock.locked_by_user) == str(current_user.id):
        db.delete(lock)
        db.commit()
    # Si no es el dueño o ya no existe, no es un error -- salir es idempotente.
    return None
