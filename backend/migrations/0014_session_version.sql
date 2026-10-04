-- Lote EQ-1 (2026-10-04): «Mi cuenta» (cambiar la propia contrasena) +
-- invalidacion de sesiones. token_version va dentro del JWT ("tv"); al subirla,
-- todos los tokens anteriores de ese usuario dejan de valer AL MOMENTO (antes
-- seguian validos hasta 60 min tras cambiar la contrasena).
-- pw_change_failures / pw_change_locked_until: freno a quien pruebe contrasenas
-- desde una sesion robada. Idempotente.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_change_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_change_locked_until TIMESTAMPTZ NULL;
COMMIT;
