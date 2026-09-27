import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/AuthContext';
import { publicationAPI } from '../services/publicationAPI';
import { can } from '../services/permissions';
import Icon from '../components/common/Icon';

// Formatea bytes a una unidad legible (KB/MB/GB); el backend devuelve bytes crudos.
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

const ROLE_LABELS = { owner: 'Propietario', admin: 'Administrador', editor: 'Editor', reviewer: 'Revisor', reader: 'Lector' };

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicationAPI.statsSummary()
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStatsError(true); });
    return () => { cancelled = true; };
  }, []);

  const pending = statsError ? '—' : '…';
  const plan = stats?.plan || null;
  const maxPubs = plan?.max_active_publications;
  const maxStorage = plan?.max_storage_bytes;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>Hola{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}</h2>
        <p className="dashboard-sub">
          {user?.tenant_name || 'Tu empresa'} · {ROLE_LABELS[user?.tenant_role] || user?.tenant_role || '—'}
          {user?.acting_as_tenant ? ' (como Super Admin)' : ''}
        </p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Ediciones</h3>
          <div className="value">{stats ? stats.total_publications : pending}</div>
          <p className="stat-note">
            {stats ? `${stats.published_publications ?? 0} publicadas` : ' '}
            {maxPubs ? ` · máximo ${maxPubs} activas` : ''}
          </p>
        </div>

        <div className="stat-card">
          <h3>Lecturas</h3>
          <div className="value">{stats ? stats.total_views : pending}</div>
          <p className="stat-note">Aperturas acumuladas de tus revistas publicadas</p>
        </div>

        <div className="stat-card">
          <h3>Almacenamiento</h3>
          <div className="value">{stats ? formatBytes(stats.storage_bytes) : pending}</div>
          <p className="stat-note">{maxStorage ? `De ${formatBytes(maxStorage)} de tu plan` : 'Imágenes, PDF y audio subidos'}</p>
        </div>

        <div className="stat-card">
          <h3>Plan</h3>
          <div className="value" style={{ fontSize: '1.5rem' }}>{stats ? (plan?.name || 'Sin plan') : pending}</div>
          <p className="stat-note">
            {plan?.max_seats ? `Hasta ${plan.max_seats} usuarios` : (stats && !plan ? 'Pídelo al administrador de Cetrix' : ' ')}
          </p>
        </div>
      </div>

      <div className="dashboard-actions">
        <button type="button" className="btn-primary" onClick={() => navigate('/collections')}>
          <Icon name="book" size={18} style={{ marginRight: 8 }} />Ir a mis colecciones
        </button>
        {can(user, 'admin') && (
          <button type="button" className="btn-secondary" onClick={() => navigate('/team')}>
            Gestionar equipo
          </button>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
