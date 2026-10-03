"""Borrado logico de ediciones (Lote L5, 2026-10-03).

Las ediciones en la papelera (``publications.deleted_at`` no nulo) se ocultan
de TODAS las consultas ORM automaticamente -- panel, kiosco, /r/..., /leer/,
editor, paginas, bloqueos, stats del Dashboard y cuota -- sin tener que
acordarse de anadir el filtro en cada endpoint (patron oficial de SQLAlchemy
"soft delete" con ``with_loader_criteria``).

Para leer tambien las borradas (papelera, restaurar, purgar, calculo de
slugs unicos) hay que pedirlo explicitamente::

    db.query(Publication).execution_options(include_deleted=True)

Los endpoints publicos ademas filtran ``deleted_at IS NULL`` a mano
(defensa en profundidad) y el borrado pone ``is_public = False``.
"""
from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria

from app.models.publication import Publication

INCLUDE_DELETED = "include_deleted"


@event.listens_for(Session, "do_orm_execute")
def _hide_trashed_publications(execute_state):
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
        and not execute_state.execution_options.get(INCLUDE_DELETED, False)
    ):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                Publication,
                lambda cls: cls.deleted_at.is_(None),
                include_aliases=True,
            )
        )
