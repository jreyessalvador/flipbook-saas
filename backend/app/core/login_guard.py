"""Lote SEC-1 (2026-10-07): proteccion del login contra fuerza bruta.

Capa de aplicacion que complementa el limite por IP de nginx:

- Cuenta los fallos por cuenta en Redis (ventana deslizante) y, superado el
  umbral, bloquea esa cuenta un tiempo corto. Devuelve SIEMPRE un 429 generico
  (no revela si la cuenta existe ni cuantos intentos quedan).
- Expira solo (TTL de Redis); no necesita migracion ni tarea de limpieza.
- Si Redis no esta disponible, NO bloquea el acceso legitimo (falla abierto):
  la seguridad de volumen la garantiza igualmente nginx.

El fix del oraculo de tiempos (ejecutar bcrypt tambien cuando la cuenta no
existe) vive en el endpoint de login, no aqui.
"""
import logging
import os
import redis

logger = logging.getLogger("flipbook.login_guard")

# Hash bcrypt (coste 12) de una constante: se usa para gastar el mismo tiempo
# de verificacion cuando la cuenta no existe, y asi no filtrar por tiempos que
# correos estan registrados. NO es una credencial.
DUMMY_HASH = "$2b$12$bLMZQHXgsIlESUnHgKVfaubMMMCoH2.OuYiclRHq0WI7Ax2SsR.um"

# Umbrales por cuenta (nginx cubre el limite por IP).
WINDOW_SECONDS = 900      # ventana de conteo: 15 min
MAX_FAILURES = 10         # fallos por cuenta dentro de la ventana...
LOCK_SECONDS = 900        # ...bloquean esa cuenta 15 min

_PREFIX = "lg:"

_pool = None


def _client():
    global _pool
    if _pool is None:
        url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        _pool = redis.from_url(url, socket_connect_timeout=1, socket_timeout=1,
                               decode_responses=True)
    return _pool


def _norm(email: str) -> str:
    return (email or "").strip().lower()


def is_locked(email: str) -> bool:
    """True si la cuenta esta en cooldown. Falla abierto si Redis no responde."""
    try:
        return _client().exists(_PREFIX + "lock:" + _norm(email)) == 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_guard Redis no disponible (is_locked): %s", exc)
        return False


def register_failure(email: str, ip: str | None = None) -> bool:
    """Suma un fallo a la cuenta. Devuelve True si acaba de quedar bloqueada."""
    e = _norm(email)
    try:
        c = _client()
        key = _PREFIX + "fail:" + e
        n = c.incr(key)
        if n == 1:
            c.expire(key, WINDOW_SECONDS)
        if n >= MAX_FAILURES:
            c.setex(_PREFIX + "lock:" + e, LOCK_SECONDS, "1")
            c.delete(key)
            logger.warning("login bloqueado por fuerza bruta cuenta=%s ip=%s", e, ip)
            return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_guard Redis no disponible (register_failure): %s", exc)
    return False


def clear(email: str) -> None:
    """Login correcto: borra contador y bloqueo de esa cuenta."""
    e = _norm(email)
    try:
        c = _client()
        c.delete(_PREFIX + "fail:" + e, _PREFIX + "lock:" + e)
    except Exception as exc:  # noqa: BLE001
        logger.warning("login_guard Redis no disponible (clear): %s", exc)
