import React from 'react';
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
    return location.pathname === path ? 'nav-link active' : 'nav-link';
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <h1>📚 Flipbook SaaS</h1>
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
          className={isActive('/publications')}
          onClick={() => navigate('/publications')}
        >
          Publicaciones
        </button>
      </div>

      <div className="navbar-user">
        {user && (
          <>
            <span style={{ fontSize: '0.9rem', opacity: 0.8, marginRight: '1rem' }}>
              {user.email}
            </span>
            <button onClick={handleLogout} className="btn-logout">
              Cerrar Sesión
            </button>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
