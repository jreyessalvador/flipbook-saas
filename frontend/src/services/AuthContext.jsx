import React, { createContext, useState, useContext, useEffect } from 'react';
import { setTenantContext } from './tenantContext';
import { authAPI } from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Lote SEC-2: la sesion vive en una cookie HttpOnly; preguntamos al backend
    // quien somos. 200 = sesion valida; 401 = sin sesion.
    authAPI.getMe()
      .then((userData) => { setUser(userData); })
      .catch(() => { setUser(null); })
      .finally(() => { setLoading(false); });
  }, []);

  const login = async (email, password) => {
    await authAPI.login(email, password); // Lote SEC-2: deja la cookie HttpOnly
    const userData = await authAPI.getMe();
    setUser(userData);
    return userData;
  };

  const logout = async () => {
    setTenantContext(null);
    await authAPI.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
