import React, { useEffect, useState } from 'react';
import { useAuth } from '../services/AuthContext';
import { publicationAPI } from '../services/publicationAPI';

// Formatea bytes a una unidad legible (KB/MB/GB) -- el backend siempre
// devuelve bytes crudos (Lote UX-1), el formateo es responsabilidad del
// frontend para no atar la respuesta de la API a un formato de presentación.
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

const Dashboard = () => {
  const { user } = useAuth();
  // Lote UX-1: el Dashboard mostraba 0/0/0 MB fijos sin llamar nunca a la
  // API -- ahora se pide el resumen real al backend (GET
  // /api/publications/stats/summary, agregados SQL por tenant) al montar.
  // "Plan Actual" sigue siendo un valor fijo a proposito: todavia no existe
  // ningun sistema de planes/facturacion en el backend, asi que mostrar un
  // numero ahi seria inventar un dato -- queda pendiente para cuando exista
  // esa funcionalidad, no es parte de este lote.
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    publicationAPI.statsSummary()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setStatsError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const publicacionesValue = stats ? stats.total_publications : (statsError ? '—' : '…');
  const visitasValue = stats ? stats.total_views : (statsError ? '—' : '…');
  const almacenamientoValue = stats ? formatBytes(stats.storage_bytes) : (statsError ? '—' : '…');

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>¡Bienvenido al Dashboard!</h2>
        <div className="user-info">
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>Nombre:</strong> {user?.full_name || 'No especificado'}</p>
          <p><strong>Rol:</strong> {user?.role}</p>
          <p><strong>Estado:</strong> {user?.is_active ? '✅ Activo' : '❌ Inactivo'}</p>
          <p><strong>ID:</strong> {user?.id}</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Publicaciones</h3>
          <div className="value">{publicacionesValue}</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Total de flipbooks
          </p>
        </div>

        <div className="stat-card">
          <h3>Visitas</h3>
          <div className="value">{visitasValue}</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Acumuladas (todas las publicaciones)
          </p>
        </div>

        <div className="stat-card">
          <h3>Almacenamiento</h3>
          <div className="value">{almacenamientoValue}</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            De 10 GB disponibles
          </p>
        </div>

        <div className="stat-card">
          <h3>Plan Actual</h3>
          <div className="value" style={{ fontSize: '1.5rem' }}>Pro</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            50 publicaciones máx.
          </p>
        </div>
      </div>

      <div style={{ 
        marginTop: '2rem', 
        padding: '1.5rem', 
        background: 'white', 
        borderRadius: '8px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ marginBottom: '1rem', color: '#2c3e50' }}>🚀 Próximas Funcionalidades</h3>
        <ul style={{ lineHeight: '2', color: '#666' }}>
          <li>✨ Editor de flipbooks con canvas interactivo</li>
          <li>📄 Importar PDFs y convertir a flipbooks</li>
          <li>🎨 Agregar elementos multimedia (imágenes, videos, audio)</li>
          <li>👥 Gestión de usuarios y permisos</li>
          <li>📊 Analytics y estadísticas detalladas</li>
          <li>🌐 Publicación con URLs personalizadas</li>
        </ul>
      </div>
    </div>
  );
};

export default Dashboard;
