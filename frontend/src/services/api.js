import axios from 'axios';

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
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor para agregar token a todas las requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
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

  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
};

export default api;
