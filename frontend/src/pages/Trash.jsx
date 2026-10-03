// Lote L5 (2026-10-03): Papelera de ediciones.
// - Borrar una edición la trae aquí (no se elimina al instante).
// - Administrador+: restaurar (vuelve PRIVADA a su colección, con su URL).
// - Propietario: eliminar definitivamente.
// - A los 30 días se eliminan solas (tarea diaria en el servidor).
// ?coleccion=<id> filtra por colección (enlace «Papelera (N)» de cada colección).
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { publicationAPI } from '../services/publicationAPI';
import { API_URL } from '../services/api';
import { useAuth } from '../services/AuthContext';
import { can } from '../services/permissions';
import Icon from '../components/common/Icon';
import '../styles/Publications.css';
import '../styles/Trash.css';

const coverSrc = (url) => (url ? (url.startsWith('http') ? url : `${API_URL}${url}`) : null);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const daysText = (n) => (n <= 0 ? 'Se elimina hoy' : n === 1 ? 'Queda 1 día' : `Quedan ${n} días`);

export default function Trash() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const collectionId = params.get('coleccion');
  const { user } = useAuth();
  const isAdmin = can(user, 'admin');
  const isOwner = can(user, 'owner');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = async () => {
    try {
      setError(null);
      setData(await publicationAPI.trash(collectionId));
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo cargar la papelera');
    }
  };
  useEffect(() => { if (isAdmin) load(); }, [collectionId, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = async (item) => {
    setBusy(item.id);
    try {
      await publicationAPI.restore(item.id);
      setNotice({ type: 'success', text: `“${item.title}” se restauró en «${item.collection_name || 'su colección'}». Queda privada: muéstrala en el catálogo cuando quieras.`, collectionId: item.collection_id });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err?.response?.data?.detail || 'No se pudo restaurar la edición' });
    } finally { setBusy(null); }
  };

  const purge = async (item) => {
    if (!window.confirm(`¿Eliminar DEFINITIVAMENTE “${item.title}”?\n\nSe borrarán sus páginas, versiones publicadas y archivos que no use ninguna otra edición. Esta acción no se puede deshacer.`)) return;
    setBusy(item.id);
    try {
      await publicationAPI.purge(item.id);
      setNotice({ type: 'info', text: `“${item.title}” se eliminó definitivamente.` });
      await load();
    } catch (err) {
      setNotice({ type: 'error', text: err?.response?.data?.detail || 'No se pudo eliminar la edición' });
    } finally { setBusy(null); }
  };

  if (!isAdmin) {
    return (
      <div className="publications-container">
        <div className="empty-state"><p>La papelera solo está disponible para administradores de la empresa.</p>
          <button type="button" className="btn-secondary" onClick={() => navigate('/collections')}>Volver a colecciones</button></div>
      </div>
    );
  }

  const items = data?.items || [];
  const filterName = collectionId ? items[0]?.collection_name : null;

  return (
    <div className="publications-container trash-page">
      <div className="publications-header">
        <div>
          <div className="collection-breadcrumb">
            <button type="button" onClick={() => navigate(collectionId ? `/collections/${collectionId}` : '/collections')}>
              ← {collectionId ? 'Volver a la colección' : 'Colecciones'}
            </button>
          </div>
          <h2><Icon name="trash" size={26} style={{ marginRight: 10, color: 'var(--color-gold-dark)' }} />Papelera{filterName ? ` · ${filterName}` : ''}</h2>
          <p className="collections-subtitle">
            Las ediciones borradas se guardan aquí {data?.retention_days || 30} días y después se eliminan solas.
            {isOwner ? ' Puedes restaurarlas o eliminarlas definitivamente.' : ' Puedes restaurarlas; eliminarlas definitivamente es solo del propietario.'}
          </p>
        </div>
        {collectionId && (
          <button type="button" className="btn-secondary" onClick={() => setParams({})}>Ver toda la papelera</button>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {notice && (
        <div className={`import-notice import-notice-${notice.type}`}>
          {notice.text}
          {notice.collectionId && <> <button type="button" className="trash-inline-link" onClick={() => navigate(`/collections/${notice.collectionId}`)}>Ir a la colección</button></>}
        </div>
      )}

      {data === null && !error && <div className="loading">Cargando papelera...</div>}
      {data !== null && items.length === 0 && (
        <div className="empty-state"><p>{collectionId ? 'No hay ediciones de esta colección en la papelera.' : 'La papelera está vacía.'}</p></div>
      )}

      {items.length > 0 && (
        <ul className="trash-list">
          {items.map((it) => (
            <li key={it.id} className="trash-item">
              <div className="trash-cover">
                {coverSrc(it.cover_image_url) ? <img src={coverSrc(it.cover_image_url)} alt="" loading="lazy" /> : <div className="placeholder-image placeholder-image-empty" />}
              </div>
              <div className="trash-info">
                {it.edition_label && <span className="edition-label">{it.edition_label}</span>}
                <h3>{it.title}</h3>
                <p className="trash-meta">
                  {!collectionId && <><span>{it.collection_name || 'Sin colección'}</span> · </>}
                  <span>{it.total_pages} páginas</span>
                  {it.creation_type === 'pdf' && <> · <span>importada de PDF</span></>}
                </p>
                <p className="trash-meta">Borrada el {fmtDate(it.deleted_at)}{it.deleted_by_name ? ` por ${it.deleted_by_name}` : ''}</p>
              </div>
              <div className="trash-side">
                <span className={`trash-days ${it.days_left <= 3 ? 'trash-days-soon' : ''}`}>{daysText(it.days_left)}</span>
                <div className="trash-actions">
                  <button type="button" className="btn-primary btn-card-action" disabled={busy === it.id} onClick={() => restore(it)}>
                    <Icon name="restore" size={15} style={{ marginRight: 6 }} />Restaurar
                  </button>
                  {isOwner && (
                    <button type="button" className="btn-danger" disabled={busy === it.id} onClick={() => purge(it)}>
                      Eliminar definitivamente
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
