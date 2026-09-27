// Espejo en el frontend del RBAC del backend (app/core/rbac.py). Solo sirve
// para ocultar botones: la autoridad real es SIEMPRE el servidor.
export const ROLE_RANK = { reader: 10, reviewer: 30, editor: 50, admin: 70, owner: 90 };
export const ROLE_LABEL = { reader: 'Lector', reviewer: 'Revisor', editor: 'Editor', admin: 'Administrador', owner: 'Propietario' };
export const ROLE_HELP = {
  reader: 'Ve colecciones y ediciones, sin modificar nada.',
  reviewer: 'Como lector (reservado para revisión y comentarios).',
  editor: 'Crea, importa y edita ediciones y su contenido.',
  admin: 'Además publica, borra, gestiona colecciones y el equipo.',
  owner: 'Control total de la empresa, incluidos administradores.',
};
export const can = (user, minRole) => (ROLE_RANK[user?.tenant_role] || 0) >= (ROLE_RANK[minRole] || 999);
