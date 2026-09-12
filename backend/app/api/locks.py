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
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
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

    # UPSERT atomico (INSERT ... ON CONFLICT DO UPDATE) en vez de
    # SELECT-luego-INSERT/UPDATE: la version anterior (SELECT para ver si
    # existe, despues decidir INSERT o UPDATE) tenia una ventana de carrera
    # real entre el SELECT y el INSERT -- dos peticiones POST /lock casi
    # simultaneas para la MISMA publicacion (el doble-efecto de React 18 en
    # modo desarrollo la dispara siempre; dos pestañas reales tambien
    # podrian) veian ambas "no existe" y ambas intentaban el INSERT, y un
    # primer intento de arreglarlo con try/except+re-consulta seguia
    # teniendo su propia ventana de carrera (encontrado verificando Fase B
    # con un navegador real, ver RECETA-DESARROLLO.md). Un UPSERT de una
    # sola sentencia resuelto por Postgres es atomico por construccion: no
    # hay ventana entre "ver si existe" y "escribir".
    #
    # La condicion en DO UPDATE ... WHERE replica la regla de negocio: solo
    # se permite tomar/renovar el lock si ya es del mismo usuario, o si el
    # lock existente esta expirado (heartbeat viejo). Si ninguna se cumple
    # (lock vigente de OTRO usuario), el UPDATE simplemente no se aplica y
    # RETURNING no devuelve fila -- eso es como sabemos que hubo conflicto.
    expiry_cutoff = datetime.now(timezone.utc) - timedelta(seconds=LOCK_TIMEOUT_SECONDS)

    stmt = pg_insert(EditLock).values(
        publication_id=publication_id,
        locked_by_user=current_user.id,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[EditLock.publication_id],
        set_={
            "locked_by_user": stmt.excluded.locked_by_user,
            "heartbeat_at": func.now(),
        },
        where=(
            (EditLock.locked_by_user == current_user.id)
            | (EditLock.heartbeat_at < expiry_cutoff)
        ),
    ).returning(
        EditLock.publication_id,
        EditLock.locked_by_user,
        EditLock.locked_at,
        EditLock.heartbeat_at,
    )

    # OJO -- construimos la respuesta DIRECTAMENTE de la fila que devuelve
    # RETURNING, sin volver a consultar la tabla despues del commit. Una
    # version anterior hacia un SELECT adicional tras el UPSERT para
    # obtener el lock completo, pero eso reabre una ventana de carrera: si
    # otra peticion (p.ej. un DELETE de liberar lock disparado por el
    # cleanup de un efecto en React, o el doble-efecto de StrictMode)
    # borraba la fila justo entre el commit del UPSERT y ese SELECT, la
    # consulta devolvia None y FastAPI fallaba con
    # ResponseValidationError (el navegador lo reporta como error de CORS
    # porque la respuesta nunca llega a tener los headers de
    # CORSMiddleware -- encontrado verificando el Lote 4 con Playwright,
    # ver RECETA-DESARROLLO.md). RETURNING ya trae todo lo que necesita
    # LockResponse salvo locked_by_name (que sigue siendo opcional).
    applied = db.execute(stmt).fetchone()
    db.commit()

    if applied:
        return LockResponse(
            publication_id=applied.publication_id,
            locked_by_user=applied.locked_by_user,
            locked_by_name=None,
            locked_at=applied.locked_at,
            heartbeat_at=applied.heartbeat_at,
        )

    # No se aplico: hay un lock vigente de otro usuario. Consultar para el mensaje.
    existing = db.query(EditLock).filter(EditLock.publication_id == publication_id).first()
    holder = db.query(User).filter(User.id == existing.locked_by_user).first() if existing else None
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Publicacion bloqueada por {holder.full_name if holder else 'otro usuario'}",
    )


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
