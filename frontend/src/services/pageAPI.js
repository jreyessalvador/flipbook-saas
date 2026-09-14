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

  // Inserta un bloque de páginas en blanco después de la página indicada.
  // El backend renumera el resto en una transacción y preserva las cubiertas.
  insertAfter: async (publicationId, afterPageId, count) => {
    const response = await api.post(`/api/pages/publications/${publicationId}/pages/insert`, {
      after_page_id: afterPageId,
      count,
    });
    return response.data;
  },
};
