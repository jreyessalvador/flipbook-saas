import React, { useState, useEffect } from 'react';
import { publicationAPI } from '../services/publicationAPI';
import '../styles/Publications.css';

const Publications = () => {
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPublication, setNewPublication] = useState({
    title: '',
    description: '',
    is_public: false
  });

  useEffect(() => {
    loadPublications();
  }, []);

  const loadPublications = async () => {
    try {
      setLoading(true);
      const data = await publicationAPI.list();
      setPublications(data);
      setError(null);
    } catch (err) {
      console.error('Error loading publications:', err);
      setError('Error al cargar las publicaciones');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await publicationAPI.create(newPublication);
      setShowCreateModal(false);
      setNewPublication({ title: '', description: '', is_public: false });
      loadPublications();
    } catch (err) {
      console.error('Error creating publication:', err);
      alert('Error al crear la publicación');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Estás seguro de eliminar esta publicación?')) return;
    
    try {
      await publicationAPI.delete(id);
      loadPublications();
    } catch (err) {
      console.error('Error deleting publication:', err);
      alert('Error al eliminar la publicación');
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      draft: { text: 'Borrador', class: 'badge-draft' },
      published: { text: 'Publicado', class: 'badge-published' },
      archived: { text: 'Archivado', class: 'badge-archived' }
    };
    const badge = badges[status] || badges.draft;
    return <span className={`badge ${badge.class}`}>{badge.text}</span>;
  };

  if (loading) {
    return (
      <div className="publications-container">
        <div className="loading">Cargando publicaciones...</div>
      </div>
    );
  }

  return (
    <div className="publications-container">
      <div className="publications-header">
        <h2>Mis Publicaciones</h2>
        <button 
          className="btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + Nueva Publicación
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {publications.length === 0 ? (
        <div className="empty-state">
          <p>No tienes publicaciones aún</p>
          <button 
            className="btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            Crear tu primera publicación
          </button>
        </div>
      ) : (
        <div className="publications-grid">
          {publications.map(pub => (
            <div key={pub.id} className="publication-card">
              <div className="card-header">
                {pub.cover_image_url ? (
                  <img src={pub.cover_image_url} alt={pub.title} />
                ) : (
                  <div className="placeholder-image">
                    <span>📖</span>
                  </div>
                )}
              </div>
              <div className="card-body">
                <h3>{pub.title}</h3>
                <p className="description">{pub.description || 'Sin descripción'}</p>
                <div className="card-stats">
                  <span>📄 {pub.total_pages} páginas</span>
                  <span>👁️ {pub.views_count} vistas</span>
                </div>
                <div className="card-footer">
                  {getStatusBadge(pub.status)}
                  <div className="card-actions">
                    <button className="btn-secondary">Editar</button>
                    <button 
                      className="btn-danger"
                      onClick={() => handleDelete(pub.id)}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Crear Publicación */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Nueva Publicación</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Título *</label>
                <input
                  type="text"
                  required
                  maxLength="200"
                  value={newPublication.title}
                  onChange={(e) => setNewPublication({
                    ...newPublication,
                    title: e.target.value
                  })}
                  placeholder="Ej: Revista Mensual - Enero 2026"
                />
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  maxLength="500"
                  value={newPublication.description}
                  onChange={(e) => setNewPublication({
                    ...newPublication,
                    description: e.target.value
                  })}
                  placeholder="Describe brevemente el contenido..."
                  rows="4"
                />
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={newPublication.is_public}
                    onChange={(e) => setNewPublication({
                      ...newPublication,
                      is_public: e.target.checked
                    })}
                  />
                  {' '}Publicación pública
                </label>
              </div>
              <div className="modal-actions">
                <button 
                  type="button" 
                  className="btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Publications;
