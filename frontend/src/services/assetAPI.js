import axios from 'axios';

// Asegurar que si el navegador está en HTTPS, la API también sea HTTPS ignorando strings HTTP
let baseApiUrl = import.meta.env.VITE_API_URL || 'https://api.flipbook.local';
if (typeof window !== 'undefined' && window.location.protocol === 'https:' && baseApiUrl.startsWith('http://')) {
  baseApiUrl = baseApiUrl.replace('http://', 'https://');
}
const API_URL = baseApiUrl;
const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const assetAPI = {
  // Upload imagen
  upload: async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await axios.post(`${API_URL}/api/assets/upload`, formData, {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'multipart/form-data'
      }
    });

    return response.data;
  },

  // Listar imágenes del usuario
  list: async () => {
    const response = await axios.get(`${API_URL}/api/assets/list`, {
      headers: getAuthHeader()
    });

    return response.data;
  }
};
