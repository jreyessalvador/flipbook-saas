import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

const api = axios.create({ baseURL: BASE });

api.interceptors.request.use(config => {
  const t = localStorage.getItem('token');
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  login: async (email, password) => {
    const fd = new URLSearchParams({ username: email, password });
    const r = await axios.post(`${BASE}/api/auth/login`, fd, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return r.data;
  },
  me: () => api.get('/api/auth/me').then(r => r.data),
};

export const pubAPI = {
  list: (params) => api.get('/api/publications', { params }).then(r => r.data),
  get: (id) => api.get(`/api/publications/${id}`).then(r => r.data),
  create: (data) => api.post('/api/publications', data).then(r => r.data),
  update: (id, data) => api.put(`/api/publications/${id}`, data).then(r => r.data),
  delete: (id) => api.delete(`/api/publications/${id}`),
  publish: (id) => api.post(`/api/publications/${id}/publish`).then(r => r.data),
  uploadPDF: (id, file, onProgress) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post(`/api/publications/${id}/upload-pdf`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress && onProgress(Math.round(e.loaded * 100 / e.total))
    }).then(r => r.data);
  },
  analytics: (id) => api.get(`/api/publications/${id}/analytics`).then(r => r.data),
  publicView: (slug) => axios.get(`${BASE}/api/p/${slug}`).then(r => r.data),
};

export const assetAPI = {
  upload: (file, onProgress) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post('/api/assets/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => onProgress && onProgress(Math.round(e.loaded * 100 / e.total))
    }).then(r => r.data);
  },
};

export default api;
