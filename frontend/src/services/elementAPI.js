import api from './api';

// Endpoints de Fase A (ver docs/arquitectura-editor-2026-09-12.md, seccion 7).
// IMPORTANTE: nunca cachear ni reutilizar "elements" entre paginas distintas
// en el frontend -- siempre recargar desde aqui al cambiar de pagina. Esa
// mutacion compartida fue la causa raiz del bug de fuga portada<->contraportada
// del editor anterior.
export const elementAPI = {
  // Obtiene los elementos de una pagina + su 'version' actual (necesaria para guardar).
  get: async (pageId) => {
    const response = await api.get(`/api/pages/${pageId}/elements`);
    return response.data; // { page_id, version, elements: [...] }
  },

  // Guarda el set COMPLETO de elementos de una pagina (reemplaza todos los existentes).
  // Debe incluir la 'version' leida en el ultimo GET; si no coincide con la
  // version actual en BD, el backend responde 409 (alguien mas guardo primero).
  save: async (pageId, version, elements) => {
    const response = await api.put(`/api/pages/${pageId}/elements`, {
      version,
      elements,
    });
    return response.data; // { page_id, version (incrementada), elements: [...] }
  },
};
