// Contexto de empresa para Super Admin CETRIX (Lote C, 2026-09-27).
// Cuando el Super Admin elige una empresa en el selector de la barra, todas
// las llamadas a la API llevan la cabecera X-Tenant-Id y el backend actua en
// esa empresa. Para cualquier otro usuario la cabecera se ignora en el
// servidor, asi que esto no concede acceso a nada por si mismo.
import axios from 'axios';

const KEY = 'tenantContext';

export const getTenantContext = () => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

export const setTenantContext = (ctx) => {
  try {
    if (ctx) localStorage.setItem(KEY, JSON.stringify({ id: ctx.id, name: ctx.name }));
    else localStorage.removeItem(KEY);
  } catch { /* sin storage: se queda en la empresa propia */ }
};

export const withTenantHeader = (config) => {
  const ctx = getTenantContext();
  if (ctx?.id && config?.headers && !String(config.url || '').includes('/api/public/')) {
    config.headers['X-Tenant-Id'] = ctx.id;
  }
  return config;
};

// Tambien para las llamadas que usan el axios global (assetAPI, editor...)
axios.interceptors.request.use(withTenantHeader);
