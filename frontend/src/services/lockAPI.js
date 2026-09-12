import api from './api';

// Bloqueo de edicion de una publicacion completa (un editor a la vez, sin
// colaboracion en tiempo real -- decision confirmada con Carlos). El lock
// expira solo tras ~60s sin heartbeat (ver backend/app/api/locks.py).
export const lockAPI = {
  // Intenta adquirir el lock. Si otro usuario lo tiene (no expirado), el
  // backend responde 409 -- dejar que el caller (componente) capture el error
  // y muestre quien lo tiene (err.response.data.locked_by_name).
  acquire: async (publicationId) => {
    const response = await api.post(`/api/publications/${publicationId}/lock`);
    return response.data; // LockResponse
  },

  // Refresca el lock para que no expire mientras se sigue editando.
  // Llamar periodicamente (p.ej. cada 20s) mientras el editor esta abierto.
  heartbeat: async (publicationId) => {
    const response = await api.put(`/api/publications/${publicationId}/lock/heartbeat`);
    return response.data; // LockResponse
  },

  // Libera el lock explicitamente (al salir del editor). Idempotente.
  release: async (publicationId) => {
    await api.delete(`/api/publications/${publicationId}/lock`);
  },
};
