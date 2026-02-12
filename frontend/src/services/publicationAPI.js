import api from './api';

export const publicationAPI = {
  // Listar publicaciones
  list: async (skip = 0, limit = 20) => {
    const response = await api.get(`/api/publications?skip=${skip}&limit=${limit}`);
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

  // Eliminar publicación
  delete: async (id) => {
    await api.delete(`/api/publications/${id}`);
  },
};
