import axios from 'axios';
import { withTenantHeader } from './tenantContext';

// Asegurar que si el navegador está en HTTPS, la API también sea HTTPS ignorando strings HTTP en el .env
let baseApiUrl = import.meta.env.VITE_API_URL || 'https://api.flipbook.local';
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && baseApiUrl.startsWith('http://')) {
  baseApiUrl = baseApiUrl.replace('http://', 'https://');
}
const API_URL = baseApiUrl;

// Exportado para construir URLs absolutas a partir de rutas relativas que
// devuelve el backend (p.ej. /api/assets/serve/... -- ver assetAPI.upload y
// CanvasEditorV2). Antes esas URLs venian con host hardcodeado; ya no.
export { API_URL };

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Lote SEC-2: enviar/recibir la cookie HttpOnly de sesion
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para agregar token a todas las requests
api.interceptors.request.use(
  (config) => {
    // Lote SEC-2: el JWT va en cookie HttpOnly (withCredentials). Ya no se lee
    // de localStorage ni se pone la cabecera Authorization desde JS.
    return withTenantHeader(config);
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  login: async (email, password) => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);

    const response = await axios.post(`${API_URL}/api/auth/login`, formData, {
      withCredentials: true, // Lote SEC-2: recibir la cookie HttpOnly
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },

  getMe: async () => {
    const response = await api.get('/api/auth/me');
    return response.data;
  },

  logout: async () => {
    // Lote SEC-2: el backend borra la cookie HttpOnly.
    try { await api.post('/api/auth/logout'); } catch { /* best-effort */ }
    try { localStorage.removeItem('token'); localStorage.removeItem('user'); } catch { /* noop */ }
  },
};

export default api;
