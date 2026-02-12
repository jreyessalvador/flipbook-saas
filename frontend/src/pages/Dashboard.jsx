import React from 'react';
import { useAuth } from '../services/AuthContext';

const Dashboard = () => {
  const { user } = useAuth();

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
          <div className="value">0</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Total de flipbooks
          </p>
        </div>

        <div className="stat-card">
          <h3>Visitas</h3>
          <div className="value">0</div>
          <p style={{ color: '#888', fontSize: '0.9rem', marginTop: '0.5rem' }}>
            Este mes
          </p>
        </div>

        <div className="stat-card">
          <h3>Almacenamiento</h3>
          <div className="value">0 MB</div>
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
