import React, { useEffect, useState } from 'react';
import { superadminAPI } from '../../services/collectionAPI';
import { getTenantContext, setTenantContext } from '../../services/tenantContext';
import '../../styles/Collections.css';
import { can, ROLE_LABEL } from '../../services/permissions';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../services/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const isActive = (path) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`) ? 'nav-link active' : 'nav-link';
  };

  // Selector de empresa (solo Super Admin CETRIX, Lote C)
  const [tenants, setTenants] = useState([]);
  const tenantCtx = getTenantContext();
  useEffect(() => {
    if (!user?.is_superadmin) return;
    superadminAPI.tenants().then(setTenants).catch(() => setTenants([]));
  }, [user?.is_superadmin]);

  const switchTenant = (id) => {
    const t = tenants.find((x) => x.id === id);
    // Vacio o la propia empresa = contexto propio (sin cabecera)
    setTenantContext(t && user?.tenant_id !== t.id ? { id: t.id, name: t.name } : null);
    window.location.href = '/collections';
  };

  return (
    <>
    {user?.acting_as_tenant && (
      <div className="tenant-banner">
        Super Admin trabajando dentro de <strong>{user.tenant_name}</strong>: todo lo que crees o cambies se guarda en esa empresa.
        <button type="button" onClick={() => { setTenantContext(null); window.location.href = '/collections'; }}>Volver a mi empresa</button>
      </div>
    )}
    <nav className="navbar">
      <div className="navbar-brand">
        <h1><img src="/favicon.svg" alt="" width="26" height="26" style={{ marginRight: 8, verticalAlign: '-6px', borderRadius: 6 }} />Cetrix Revistas</h1>
      </div>
      
      <div className="navbar-menu">
        {user?.is_superadmin && <button className={isActive('/superadmin')} onClick={() => navigate('/superadmin')}>Super Admin</button>}
        <button 
          className={isActive('/dashboard')}
          onClick={() => navigate('/dashboard')}
        >
          Dashboard
        </button>
        <button 
          className={isActive('/collections')}
          onClick={() => navigate('/collections')}
        >
          Colecciones
        </button>
        {can(user, 'admin') && (
          <button className={isActive('/team')} onClick={() => navigate('/team')}>
            Equipo
          </button>
        )}
      </div>

      <div className="navbar-user">
        {user?.is_superadmin && tenants.length > 0 && (
          <label className="tenant-switcher" title="Empresa sobre la que trabajas">
            <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Empresa</span>
            <select value={tenantCtx?.id || user.tenant_id || ''} onChange={(e) => switchTenant(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.status !== 'active' ? ` (${t.status})` : ''}</option>
              ))}
            </select>
          </label>
        )}
        {user && (
          <>
            <span style={{ fontSize: '0.9rem', opacity: 0.8, marginRight: '1rem' }}>
              {user.email}{user.tenant_role ? ` · ${ROLE_LABEL[user.tenant_role] || user.tenant_role}` : ''}
            </span>
            <button onClick={handleLogout} className="btn-logout">
              Cerrar Sesión
            </button>
          </>
        )}
      </div>
    </nav>
    </>
  );
};

export default Navbar;
