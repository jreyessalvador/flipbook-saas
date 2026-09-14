import api from './api';

export const publicationAPI = {
  // Listar publicaciones
  list: async (skip = 0, limit = 20) => {
    const response = await api.get(`/api/publications?skip=${skip}&limit=${limit}`);
    return response.data;
  },

  // Resumen para el Dashboard (Lote UX-1): total de publicaciones, vistas
  // acumuladas y almacenamiento usado (bytes) del tenant -- calculado en el
  // backend con agregados SQL, no en el cliente.
  statsSummary: async () => {
    const response = await api.get('/api/publications/stats/summary');
    return response.data;
  },

  // Crear publicación
  create: async (data) => {
    const response = await api.post('/api/publications', data);
    return response.data;
  },

  // Obtener una publicación
  get: async (id) => {
    const response = await api.get(`/api/publications/${id}`);
    return response.data;
  },

  // Actualizar publicación
  update: async (id, data) => {
    const response = await api.put(`/api/publications/${id}`, data);
    return response.data;
  },

  importPdf: async (formData) => {
    const response = await api.post('/api/publications/import-pdf', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
    return response.data;
  },

  // Congelar la versión vigente para el Reader.
  publish: async (id) => {
    const response = await api.post(`/api/publications/${id}/publish`);
    return response.data;
  },

  // Retirar la versión vigente sin eliminar el historial de versiones.
  unpublish: async (id) => {
    const response = await api.post(`/api/publications/${id}/unpublish`);
    return response.data;
  },

  // Control independiente de visibilidad pública.
  setVisibility: async (id, isPublic) => {
    const response = await api.put(`/api/publications/${id}/visibility`, {
      is_public: isPublic,
    });
    return response.data;
  },

  // Eliminar publicación
  delete: async (id) => {
    await api.delete(`/api/publications/${id}`);
  },
};
