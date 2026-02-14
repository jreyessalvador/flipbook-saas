import api from './api';

export const pageAPI = {
  // Obtener todas las páginas de una publicación
  getPublicationPages: async (publicationId) => {
    const response = await api.get(`/api/pages/publications/${publicationId}/pages`);
    return response.data;
  },

  // Obtener una página específica
  get: async (pageId) => {
    const response = await api.get(`/api/pages/${pageId}`);
    return response.data;
  },

  // Actualizar contenido de una página
  update: async (pageId, data) => {
    const response = await api.put(`/api/pages/${pageId}`, data);
    return response.data;
  },
};
