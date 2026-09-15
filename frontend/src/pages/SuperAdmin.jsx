import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../services/AuthContext';
import '../styles/SuperAdmin.css';

const formatBytes = (bytes = 0) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  let value = bytes;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
};

export default function SuperAdmin() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [plans, setPlans] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', subdomain: '', plan_code: 'professional' });
  const [ownerEmail, setOwnerEmail] = useState('');
  const [invite, setInvite] = useState('');
  const [members, setMembers] = useState(null);

  const load = () => api.get('/api/superadmin/overview')
    .then((response) => setData(response.data))
    .catch((requestError) => setError(requestError.response?.data?.detail || 'No autorizado'));

  useEffect(() => {
    load();
    api.get('/api/superadmin/plans').then((response) => setPlans(response.data));
  }, []);

  const createTenant = async (event) => {
    event.preventDefault();
    try {
      await api.post('/api/superadmin/tenants', form);
      setForm({ name: '', subdomain: '', plan_code: 'professional' });
      load();
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo crear la empresa');
    }
  };

  const toggle = async (tenant) => {
    await api.patch(`/api/superadmin/tenants/${tenant.id}/status`, {
      status: tenant.status === 'active' ? 'suspended' : 'active',
    });
    load();
  };

  const inviteOwner = async (tenant) => {
    if (!ownerEmail) {
      setError('Introduce el correo del propietario');
      return;
    }
    try {
      const response = await api.post(`/api/superadmin/tenants/${tenant.id}/owner-invitations`, { email: ownerEmail });
      setInvite(`${window.location.origin}/aceptar-invitacion?token=${response.data.invite_token}`);
      setOwnerEmail('');
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo crear la invitación');
    }
  };

  const changePlan = async (tenant, planCode) => {
    if (!window.confirm(`Cambiar ${tenant.name} al plan ${planCode}?`)) return;
    await api.patch(`/api/superadmin/tenants/${tenant.id}/plan`, { plan_code: planCode });
    load();
  };

  const loadMembers = async (tenant) => {
    const response = await api.get(`/api/superadmin/tenants/${tenant.id}/memberships`);
    setMembers({ tenant, rows: response.data });
  };

  const revoke = async (membershipId) => {
    await api.delete(`/api/superadmin/memberships/${membershipId}`);
    loadMembers(members.tenant);
  };

  const resetPassword = async (member) => {
    try {
      const response = await api.post(`/api/superadmin/users/${member.user_id}/password-reset`);
      setInvite(`${window.location.origin}/restablecer-contrasena?token=${response.data.reset_token}`);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo crear el enlace de restablecimiento');
    }
  };

  if (error) return <main className="superadmin-page"><div className="superadmin-error"><h2>Acceso Super Admin</h2><p>{error}</p></div></main>;

  const totals = (data?.tenants || []).reduce(
    (sum, tenant) => ({ tenants: sum.tenants + 1, seats: sum.seats + tenant.usage.seats, storage: sum.storage + tenant.usage.storage_bytes }),
    { tenants: 0, seats: 0, storage: 0 },
  );

  return (
    <main className="superadmin-page">
      <header className="superadmin-hero">
        <div><span className="superadmin-eyebrow">CETRIX SOFTWARE · OPERACIÓN</span><h2>Administración de plataforma</h2><p>Gestiona empresas, contratos, consumo y accesos de forma centralizada.</p></div>
        <div className="superadmin-session">Sesión Super Admin<br /><strong>{user?.email}</strong></div>
      </header>
      <section className="superadmin-stats"><article><span>Empresas</span><strong>{totals.tenants}</strong></article><article><span>Usuarios asignados</span><strong>{totals.seats}</strong></article><article><span>Almacenamiento usado</span><strong>{formatBytes(totals.storage)}</strong></article></section>
      <section className="superadmin-card">
        <div className="section-heading"><div><span className="section-kicker">ALTA CONTROLADA</span><h3>Nueva empresa</h3></div><p>El propietario se invita después; nunca se asignan contraseñas.</p></div>
        <form className="tenant-form" onSubmit={createTenant}>
          <label>Empresa<input required placeholder="Ej. Editorial Horizonte" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Subdominio<input required placeholder="editorial-horizonte" value={form.subdomain} onChange={(event) => setForm({ ...form, subdomain: event.target.value.toLowerCase() })} /></label>
          <label>Plan<select value={form.plan_code} onChange={(event) => setForm({ ...form, plan_code: event.target.value })}>{plans.filter((plan) => plan.is_sellable && plan.is_active).map((plan) => <option key={plan.code} value={plan.code}>{plan.name} · {plan.currency} {plan.unit_amount}</option>)}</select></label>
          <button className="primary-action" type="submit">Crear empresa</button>
        </form>
      </section>
      {invite && <section className="superadmin-invite"><strong>Enlace temporal creado</strong><p>Compártelo solo con la persona correspondiente y antes de que caduque.</p><code>{invite}</code></section>}
      <section className="superadmin-card">
        <div className="section-heading"><div><span className="section-kicker">CARTERA ACTIVA</span><h3>Empresas registradas</h3></div><p>{data ? `${data.tenants.length} empresa(s) gestionada(s)` : 'Cargando información…'}</p></div>
        {!data ? <div className="superadmin-loading">Cargando panel…</div> : <div className="tenant-table-wrap"><table className="tenant-table"><thead><tr><th>Empresa</th><th>Estado</th><th>Contrato</th><th>Consumo</th><th>Gestión</th></tr></thead><tbody>{data.tenants.map((tenant) => <tr key={tenant.id}><td><strong>{tenant.name}</strong><small>{tenant.subdomain}</small></td><td><span className={`status-pill ${tenant.status}`}>{tenant.status === 'active' ? 'Activa' : 'Suspendida'}</span></td><td>{tenant.subscription ? <><strong>{tenant.subscription.plan}</strong><small>{tenant.subscription.currency} {tenant.subscription.unit_amount} / mes</small><select onChange={(event) => changePlan(tenant, event.target.value)} defaultValue=""><option value="" disabled>Cambiar plan…</option>{plans.filter((plan) => plan.is_active).map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></> : <span className="muted">Sin suscripción</span>}</td><td><strong>{formatBytes(tenant.usage.storage_bytes)}</strong><small>{tenant.usage.seats} seats · {tenant.usage.active_publications} publicaciones</small></td><td><div className="tenant-actions"><button className="secondary-action" onClick={() => toggle(tenant)}>{tenant.status === 'active' ? 'Suspender' : 'Reactivar'}</button><button className="link-action" onClick={() => loadMembers(tenant)}>Miembros</button><div className="invite-inline"><input type="email" placeholder="owner@empresa.com" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} /><button className="link-action" onClick={() => inviteOwner(tenant)}>Invitar owner</button></div></div></td></tr>)}</tbody></table></div>}
      </section>
      {members && <section className="superadmin-card"><div className="section-heading"><h3>Miembros · {members.tenant.name}</h3><button className="link-action" onClick={() => setMembers(null)}>Cerrar</button></div>{members.rows.map((member) => <div className="invite-inline" key={member.id}><span>{member.email} · {member.role} · {member.status}</span>{member.status !== 'revoked' && <><button className="link-action" onClick={() => resetPassword(member)}>Restablecer contraseña</button><button className="secondary-action" onClick={() => revoke(member.id)}>Revocar</button></>}</div>)}</section>}
    </main>
  );
}
