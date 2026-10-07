// Lote EQ-1 (2026-10-04): «Mi cuenta» -- cambiar la propia contraseña.
// Al cambiarla se cierran TODAS las demás sesiones abiertas del usuario (el
// backend sube su versión de sesión) y esta continúa con el token nuevo.
import React, { useState } from 'react';
import { useAuth } from '../services/AuthContext';
import { ROLE_LABEL } from '../services/permissions';
import api from '../services/api';
import '../styles/Publications.css';
import '../styles/EditionSettings.css';

const MIN = 12;

export default function MiCuenta() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const problems = [];
  if (form.next && form.next.length < MIN) problems.push(`Al menos ${MIN} caracteres (llevas ${form.next.length}).`);
  if (form.repeat && form.next !== form.repeat) problems.push('Las dos contraseñas nuevas no coinciden.');
  if (form.next && form.current && form.next === form.current) problems.push('Debe ser distinta de la actual.');
  const ready = form.current && form.next.length >= MIN && form.next === form.repeat && form.next !== form.current;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.post('/api/auth/change-password', { current_password: form.current, new_password: form.next });
      // Lote SEC-2: el backend refresca la cookie HttpOnly; no guardamos token en JS.
      setForm({ current: '', next: '', repeat: '' });
      setMsg({ type: 'success', text: `Contraseña cambiada. Se han cerrado tus otras sesiones abiertas${r.data.email_sent ? ' y te hemos enviado un correo de aviso' : ''}.` });
    } catch (err) {
      const d = err?.response?.data?.detail;
      setMsg({ type: 'error', text: typeof d === 'string' ? d : 'No se pudo cambiar la contraseña.' });
    } finally { setBusy(false); }
  };

  return (
    <div className="publications-container">
      <div className="publications-header">
        <div>
          <h2>Mi cuenta</h2>
          <p className="collections-subtitle">{user?.email}{user?.tenant_role ? ` · ${ROLE_LABEL[user.tenant_role] || user.tenant_role}` : ''}{user?.tenant_name ? ` · ${user.tenant_name}` : ''}</p>
        </div>
      </div>
      <div className="es-card" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>Cambiar contraseña</h2>
        <p className="es-muted es-small" style={{ marginBottom: 16 }}>Al cambiarla se cerrarán tus sesiones abiertas en otros navegadores y dispositivos. Esta sesión sigue abierta.</p>
        <form onSubmit={submit} autoComplete="on">
          <input type="email" name="username" autoComplete="username" value={user?.email || ''} readOnly hidden />
          <label className="es-field">
            <span>Contraseña actual</span>
            <input type={show ? 'text' : 'password'} autoComplete="current-password" value={form.current} onChange={(e) => set('current', e.target.value)} required />
          </label>
          <label className="es-field">
            <span>Nueva contraseña <em>(mínimo {MIN} caracteres)</em></span>
            <input type={show ? 'text' : 'password'} autoComplete="new-password" value={form.next} onChange={(e) => set('next', e.target.value)} minLength={MIN} maxLength={128} required />
          </label>
          <label className="es-field">
            <span>Repite la nueva contraseña</span>
            <input type={show ? 'text' : 'password'} autoComplete="new-password" value={form.repeat} onChange={(e) => set('repeat', e.target.value)} required />
          </label>
          <div style={{ margin: '4px 0 16px' }}>
            <label className="es-switch">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              <span className="es-switch-ui" aria-hidden="true" />
              <span>Mostrar contraseñas</span>
            </label>
          </div>
          {problems.length > 0 && <ul className="es-small" style={{ color: '#b45309', margin: '0 0 12px', paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {msg && <div className={`import-notice import-notice-${msg.type}`} style={{ marginBottom: 12 }}>{msg.text}</div>}
          <div>
            <button type="submit" className="btn-primary" disabled={!ready || busy} style={{ width: 'auto', padding: '10px 18px' }}>
              {busy ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </div>
        </form>
        <p className="es-muted es-small" style={{ marginTop: 16 }}>¿No recuerdas la actual? Cierra sesión y usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.</p>
      </div>
    </div>
  );
}
