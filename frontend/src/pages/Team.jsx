import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../services/AuthContext';
import { can, ROLE_LABEL, ROLE_HELP } from '../services/permissions';
import '../styles/Publications.css';
import '../styles/Collections.css';

// Lote C2 (2026-09-27): el propietario/administrador gestiona su equipo.
// Sin SMTP todavia: al invitar se muestra el enlace para enviarlo por un
// canal seguro (WhatsApp, correo propio...). Caduca en 7 dias.
const inviteLink = (token) => `${window.location.origin}/aceptar-invitacion?token=${encodeURIComponent(token)}`;

const Team = () => {
  const { user } = useAuth();
  const [data, setData] = useState({ members: [], seats_used: 0, seats_limit: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState(null); // { email, url }
  const [copied, setCopied] = useState(false);

  const assignable = can(user, 'owner') ? ['admin', 'editor', 'reviewer', 'reader'] : ['editor', 'reviewer', 'reader'];

  const load = async () => {
    try {
      setLoading(true);
      setData((await api.get('/api/team/members')).data);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar el equipo');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = (await api.post('/api/team/invitations', form)).data;
      setForm(null);
      setLink({ email: res.email, url: res.invite_token ? inviteLink(res.invite_token) : null, emailSent: !!res.email_sent });
      await load();
    } catch (err) {
      alert(err?.response?.data?.detail || 'No se pudo invitar');
    } finally { setBusy(false); }
  };

  const resend = async (m) => {
    try {
      const res = (await api.post(`/api/team/members/${m.id}/resend`)).data;
      setLink({ email: res.email, url: res.invite_token ? inviteLink(res.invite_token) : null, emailSent: !!res.email_sent });
    } catch (err) { alert(err?.response?.data?.detail || 'No se pudo reenviar la invitación'); }
  };

  const changeRole = async (m, role) => {
    try { await api.patch(`/api/team/members/${m.id}`, { role }); await load(); }
    catch (err) { alert(err?.response?.data?.detail || 'No se pudo cambiar el rol'); }
  };

  const revoke = async (m) => {
    if (!window.confirm(`¿Quitar el acceso de ${m.email}? Dejará de poder entrar inmediatamente.`)) return;
    try { await api.delete(`/api/team/members/${m.id}`); await load(); }
    catch (err) { alert(err?.response?.data?.detail || 'No se pudo revocar'); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); } catch { /* sin permiso de portapapeles */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  if (!can(user, 'admin')) {
    return <div className="publications-container"><div className="error-message">Solo propietarios y administradores gestionan el equipo.</div></div>;
  }
  if (loading) return <div className="publications-container"><div className="loading">Cargando equipo...</div></div>;

  const full = data.seats_limit !== null && data.seats_used >= data.seats_limit;

  return (
    <div className="publications-container">
      <div className="publications-header">
        <div>
          <h2>Equipo</h2>
          <p className="collections-subtitle">
            {user?.tenant_name} · {data.seats_used}{data.seats_limit !== null ? ` de ${data.seats_limit}` : ''} usuarios del plan
          </p>
        </div>
        <button className="btn-primary" disabled={full} title={full ? 'Has llegado al límite de usuarios de tu plan' : ''}
          onClick={() => setForm({ email: '', full_name: '', role: 'editor' })}>+ Invitar persona</button>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="team-table-wrap">
        <table className="team-table">
          <thead><tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th aria-label="Acciones" /></tr></thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.id}>
                <td><strong>{m.full_name || m.email}</strong>{m.full_name && <div className="team-email">{m.email}</div>}{m.is_self && <span className="team-you">tú</span>}</td>
                <td>
                  {m.can_manage ? (
                    <select value={m.role} onChange={(e) => changeRole(m, e.target.value)} aria-label={`Rol de ${m.email}`}>
                      {assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  ) : ROLE_LABEL[m.role] || m.role}
                </td>
                <td>{m.status === 'invited' ? <span className="team-badge team-badge-pending">Invitación pendiente</span> : <span className="team-badge team-badge-active">Activo</span>}</td>
                <td>{m.last_login ? new Date(m.last_login).toLocaleString() : '—'}</td>
                <td className="team-actions">
                  {m.can_manage && m.status === 'invited' && <button className="btn-secondary" onClick={() => resend(m)}>Nuevo enlace</button>}
                  {m.can_manage && <button className="btn-danger" onClick={() => revoke(m)}>Quitar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="team-roles-help">
        {Object.keys(ROLE_HELP).reverse().map((r) => <div key={r}><strong>{ROLE_LABEL[r]}:</strong> {ROLE_HELP[r]}</div>)}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => !busy && setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Invitar persona</h3>
            <form onSubmit={invite}>
              <div className="form-group"><label>Email *</label>
                <input type="email" required autoFocus value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="form-group"><label>Nombre</label>
                <input type="text" maxLength="255" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="form-group"><label>Rol</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <p className="collections-subtitle">{ROLE_HELP[form.role]}</p></div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Invitando…' : 'Crear invitación'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {link && (
        <div className="modal-overlay" onClick={() => setLink(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{link.emailSent ? 'Invitación enviada' : 'Enlace de invitación'}</h3>
            {link.emailSent ? (
              <p className="collections-subtitle">Hemos enviado la invitación por correo a <strong>{link.email}</strong>. El enlace caduca en 7 días y solo sirve una vez; con él define su propia contraseña. Si no la encuentra, que revise la carpeta de spam o usa «Reenviar».</p>
            ) : (
              <>
                <p className="collections-subtitle">No se pudo enviar el correo. Envíale este enlace a <strong>{link.email}</strong> por un canal de confianza. Caduca en 7 días y solo sirve una vez; con él define su propia contraseña.</p>
                <div className="share-url-row" style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
                  <input type="text" readOnly value={link.url || ''} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0, padding: '10px 12px' }} />
                  <button type="button" className="btn-primary" onClick={copy}>{copied ? '¡Copiado!' : 'Copiar'}</button>
                </div>
              </>
            )}
            <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setLink(null)}>Cerrar</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Team;
