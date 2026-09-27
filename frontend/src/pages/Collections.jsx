import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectionAPI } from '../services/collectionAPI';
import { API_URL } from '../services/api';
import '../styles/Publications.css';
import '../styles/Collections.css';

// Lote C (2026-09-27): Colecciones -> Ediciones. Una coleccion agrupa las
// ediciones de una revista/catalogo (p.ej. "Destinos y Negocios": No. 33,
// No. 34...). Cada empresa solo ve las suyas; Super Admin las de la empresa
// elegida en el selector de la barra.

const emptyForm = { name: '', description: '', category_id: '' };

const Collections = () => {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null); // null | { id?, name, description, category_id }
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const [cols, cats] = await Promise.all([collectionAPI.list(), collectionAPI.categories()]);
      setCollections(cols);
      setCategories(cats);
      setError(null);
    } catch (err) {
      console.error('Error cargando colecciones:', err);
      setError(err?.response?.data?.detail || 'Error al cargar las colecciones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setFormError(null); setForm({ ...emptyForm }); };
  const openEdit = (c) => {
    setFormError(null);
    setForm({ id: c.id, name: c.name, description: c.description || '', category_id: c.category_id || '' });
  };

  const save = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { setFormError('El nombre es obligatorio'); return; }
    setSaving(true); setFormError(null);
    const payload = { name, description: form.description.trim(), category_id: form.category_id || null };
    try {
      if (form.id) await collectionAPI.update(form.id, payload);
      else {
        const created = await collectionAPI.create(payload);
        setForm(null);
        navigate(`/collections/${created.id}`);
        return;
      }
      setForm(null);
      await load();
    } catch (err) {
      const d = err?.response?.data?.detail;
      setFormError(typeof d === 'string' ? d : 'No se pudo guardar la colección');
    } finally { setSaving(false); }
  };

  const remove = async (c) => {
    if (!window.confirm(`¿Eliminar la colección “${c.name}”?`)) return;
    try { await collectionAPI.remove(c.id); await load(); }
    catch (err) { alert(err?.response?.data?.detail || 'No se pudo eliminar la colección'); }
  };

  const coverSrc = (url) => (url ? (url.startsWith('http') ? url : `${API_URL}${url}`) : null);

  if (loading) return <div className="publications-container"><div className="loading">Cargando colecciones...</div></div>;

  return (
    <div className="publications-container">
      <div className="publications-header">
        <div>
          <h2>Colecciones</h2>
          <p className="collections-subtitle">Cada colección agrupa las ediciones de una revista o catálogo.</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Nueva colección</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="publications-grid">
        {collections.map((c) => (
          <div key={c.id} className="publication-card collection-card">
            <button type="button" className="card-header collection-cover" onClick={() => navigate(`/collections/${c.id}`)} aria-label={`Abrir ${c.name}`}>
              {coverSrc(c.cover_image_url)
                ? <img src={coverSrc(c.cover_image_url)} alt={c.name} />
                : <div className="placeholder-image placeholder-image-empty" />}
              <span className="collection-count">{c.edition_count} {c.edition_count === 1 ? 'edición' : 'ediciones'}</span>
            </button>
            <div className="card-body">
              <div className="card-title-row">
                <h3>{c.name}</h3>
                <button type="button" className="btn-edit-meta" onClick={() => openEdit(c)} title="Editar colección" aria-label={`Editar ${c.name}`}>✏️</button>
              </div>
              <p className="description">{c.description || 'Sin descripción'}</p>
              <div className="card-meta">
                {c.category_name && <span className="card-size">{c.category_name}</span>}
                {c.is_default && <span className="card-size">Por defecto</span>}
                <span className="card-size">{c.published_count} publicada{c.published_count === 1 ? '' : 's'}</span>
              </div>
              <div className="card-actions">
                <button className="btn-primary btn-card-action" onClick={() => navigate(`/collections/${c.id}`)}>Ver ediciones</button>
                {!c.is_default && (
                  <button className="btn-danger" onClick={() => remove(c)} disabled={c.edition_count > 0}
                    title={c.edition_count > 0 ? 'Mueve o elimina sus ediciones antes' : 'Eliminar colección'}>
                    Eliminar
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div className="modal-overlay" onClick={() => !saving && setForm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? 'Editar colección' : 'Nueva colección'}</h3>
            <form onSubmit={save}>
              <div className="form-group">
                <label>Nombre *</label>
                <input type="text" required maxLength="150" autoFocus value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej: Destinos y Negocios" />
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea rows="3" maxLength="1000" value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="De qué trata esta revista o catálogo" />
              </div>
              <div className="form-group">
                <label>Categoría (kiosco público)</label>
                <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                  <option value="">— Sin categoría —</option>
                  {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>
              {formError && <div className="error-message">{formError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setForm(null)} disabled={saving}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Collections;
