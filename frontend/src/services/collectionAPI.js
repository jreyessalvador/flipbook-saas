import api from './api';

export const collectionAPI = {
  list: async () => (await api.get('/api/collections')).data,
  get: async (id) => (await api.get(`/api/collections/${id}`)).data,
  create: async (data) => (await api.post('/api/collections', data)).data,
  update: async (id, data) => (await api.put(`/api/collections/${id}`, data)).data,
  remove: async (id) => { await api.delete(`/api/collections/${id}`); },
  categories: async () => (await api.get('/api/categories')).data,
  moveEdition: async (publicationId, collectionId) =>
    (await api.post(`/api/publications/${publicationId}/move`, { collection_id: collectionId })).data,
};

export const superadminAPI = {
  tenants: async () => (await api.get('/api/superadmin/overview')).data.tenants || [],
};
