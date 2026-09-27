"""RBAC dentro de la empresa (Lote C2, 2026-09-27).

Roles de tenant (tabla ``roles`` scope='tenant') y lo que permite cada uno:

| rol      | rank | puede                                                          |
|----------|------|----------------------------------------------------------------|
| reader   | 10   | ver colecciones, ediciones y paginas (panel en solo lectura)   |
| reviewer | 30   | lo mismo que reader (reservado para comentarios/aprobacion)    |
| editor   | 50   | + crear/editar/importar ediciones, paginas, assets, mover      |
| admin    | 70   | + publicar/despublicar/visibilidad, borrar ediciones,          |
|          |      |   crear/editar/borrar colecciones, gestionar equipo            |
|          |      |   (invitar editor/reviewer/reader)                             |
| owner    | 90   | + invitar/gestionar administradores                            |

Super Admin CETRIX actua como ``owner`` en la empresa sobre la que trabaja.
El rol efectivo lo calcula ``get_current_user`` (``current_user.tenant_role``).
El frontend oculta botones segun rol, pero la autoridad es SIEMPRE el backend.
"""
from fastapi import Depends, HTTPException, status

from app.api.auth import get_current_user
from app.models.user import User

ROLE_RANK = {"reader": 10, "reviewer": 30, "editor": 50, "admin": 70, "owner": 90}
ROLE_LABEL = {"reader": "Lector", "reviewer": "Revisor", "editor": "Editor", "admin": "Administrador", "owner": "Propietario"}


def role_rank(code) -> int:
    return ROLE_RANK.get(code or "", 0)


def has_role(user: User, min_code: str) -> bool:
    return role_rank(getattr(user, "tenant_role", None)) >= ROLE_RANK[min_code]


def require_role(min_code: str):
    """Dependencia FastAPI: exige al menos ``min_code`` en la empresa efectiva."""
    if min_code not in ROLE_RANK:
        raise ValueError(f"Rol desconocido: {min_code}")

    def _dep(current_user: User = Depends(get_current_user)) -> User:
        if not has_role(current_user, min_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Tu rol ({ROLE_LABEL.get(getattr(current_user, 'tenant_role', ''), 'sin rol')}) no permite esta acción. Requiere {ROLE_LABEL[min_code]} o superior.",
            )
        return current_user

    return _dep
