import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../services/AuthContext';

export default function SuperAdmin() {
  const { user } = useAuth(); const [data, setData] = useState(null); const [error, setError] = useState('');
  useEffect(() => { api.get('/api/superadmin/overview').then(r => setData(r.data)).catch(e => setError(e.response?.data?.detail || 'No autorizado')); }, []);
  if (error) return <main className="page-container"><h2>Panel Super Admin CETRIX</h2><p>{error}</p><p>Tu cuenta aún debe recibir el rol global <code>superadmin</code>; no se asigna automáticamente por seguridad.</p></main>;
  return <main className="page-container"><h2>Panel Super Admin CETRIX</h2><p>Vista operativa de tenants, consumo y suscripción. Sesión: {user?.email}</p>{!data ? <p>Cargando…</p> : <table><thead><tr><th>Empresa</th><th>Estado</th><th>Plan</th><th>Consumo</th></tr></thead><tbody>{data.tenants.map(t => <tr key={t.id}><td>{t.name}<br/><small>{t.subdomain}</small></td><td>{t.status}</td><td>{t.subscription ? `${t.subscription.plan} · ${t.subscription.currency} ${t.subscription.unit_amount}` : 'Sin suscripción'}</td><td>{t.usage.seats} seats · {t.usage.active_publications} publicaciones · {t.usage.storage_bytes} bytes</td></tr>)}</tbody></table>}</main>;
}
