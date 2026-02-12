import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../services/AuthContext';

const Navbar = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div>
        <h1>📚 Flipbook SaaS</h1>
        {user && (
          <span style={{ fontSize: '0.9rem', opacity: 0.8 }}>
            {user.email}
          </span>
        )}
      </div>
      
      {user && (
        <button onClick={handleLogout}>
          Cerrar Sesión
        </button>
      )}
    </nav>
  );
};

export default Navbar;
