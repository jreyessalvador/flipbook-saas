import React, { useState, useEffect } from 'react';
import { publicationAPI } from '../services/publicationAPI';
import { API_URL } from '../services/api';
import '../styles/Publications.css';

const Publications = () => {
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showConfigStep, setShowConfigStep] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  
  const [newPublication, setNewPublication] = useState({
    title: '',
    description: '',
    is_public: false,
    // Configuración
    page_size: 'A4',
    page_width: 210,
    page_height: 297,
    orientation: 'portrait',
    creation_type: 'blank',
    total_pages: 10
  });

  // Presets de tamaños
  const pageSizePresets = {
    'A4': { width: 210, height: 297 },
    'Letter': { width: 216, height: 279 },
    'Legal': { width: 216, height: 356 },
    'Custom': { width: 210, height: 297 }
  };

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

  const handlePageSizeChange = (size) => {
    const preset = pageSizePresets[size];
    setNewPublication({
      ...newPublication,
      page_size: size,
      page_width: preset.width,
      page_height: preset.height
    });
  };

  const handleOrientationChange = (orientation) => {
    const { page_width, page_height } = newPublication;
    setNewPublication({
      ...newPublication,
      orientation,
      page_width: orientation === 'landscape' ? page_height : page_width,
      page_height: orientation === 'landscape' ? page_width : page_height
    });
  };

  const handleNextStep = () => {
    if (!newPublication.title) {
      alert('Por favor ingresa un título');
      return;
    }
    setShowConfigStep(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      if (newPublication.creation_type === 'pdf') {
        if (!pdfFile) throw new Error('Selecciona un PDF');
        const data = new FormData();
        data.append('file', pdfFile); data.append('title', newPublication.title); data.append('description', newPublication.description || '');
        await publicationAPI.importPdf(data);
      } else await publicationAPI.create(newPublication);
      setShowCreateModal(false);
      setShowConfigStep(false);
      setNewPublication({
        title: '',
        description: '',
        is_public: false,
        page_size: 'A4',
        page_width: 210,
        page_height: 297,
        orientation: 'portrait',
        creation_type: 'blank',
        total_pages: 10
      });
      loadPublications();
    } catch (err) {
      console.error('Error creating publication:', err);
      alert(err?.response?.data?.detail || err.message || 'Error al crear la publicación');
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

  const handlePublish = async (pub) => {
    if (!window.confirm(`¿Publicar los cambios guardados de “${pub.title}”? Se creará una versión para el Reader.`)) return;

    try {
      await publicationAPI.publish(pub.id);
      await loadPublications();
    } catch (err) {
      console.error('Error publishing publication:', err);
      alert(err?.response?.data?.detail || 'No se pudo publicar la revista');
    }
  };

  const handleUnpublish = async (pub) => {
    if (!window.confirm(`¿Volver “${pub.title}” a borrador? Se retirará del Reader y del catálogo público, pero se conservará su historial de versiones.`)) return;

    try {
      await publicationAPI.unpublish(pub.id);
      await loadPublications();
    } catch (err) {
      console.error('Error unpublishing publication:', err);
      alert(err?.response?.data?.detail || 'No se pudo volver la revista a borrador');
    }
  };

  const handleVisibility = async (pub) => {
    const nextVisibility = !pub.is_public;
    const action = nextVisibility ? 'mostrarla en el catálogo y Reader públicos' : 'ocultarla del catálogo y Reader públicos';
    if (!window.confirm(`¿Quieres ${action}?`)) return;

    try {
      await publicationAPI.setVisibility(pub.id, nextVisibility);
      await loadPublications();
    } catch (err) {
      console.error('Error changing publication visibility:', err);
      alert(err?.response?.data?.detail || 'No se pudo actualizar la visibilidad');
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

  const closeModal = () => {
    setShowCreateModal(false);
    setShowConfigStep(false);
    setNewPublication({
      title: '',
      description: '',
      is_public: false,
      page_size: 'A4',
      page_width: 210,
      page_height: 297,
      orientation: 'portrait',
      creation_type: 'blank',
      total_pages: 10
    });
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
                  <img
                    src={pub.cover_image_url.startsWith('http') ? pub.cover_image_url : `${API_URL}${pub.cover_image_url}`}
                    alt={pub.title}
                  />
                ) : (
                  // Lote UX-3: si la portada todavia no tiene ningun elemento
                  // de imagen, se deja en blanco -- a proposito, ya no un
                  // icono generico de libro (pedido explicito de Carlos).
                  <div className="placeholder-image placeholder-image-empty" />
                )}
              </div>
              <div className="card-body">
                <h3>{pub.title}</h3>
                <p className="description">{pub.description || 'Sin descripción'}</p>
                <div className="card-stats">
                  <span>📄 {pub.total_pages} páginas</span>
                  <span>👁️ {pub.views_count} vistas</span>
                </div>
                <div className="card-meta">
                  <span className="card-size">{pub.page_size} • {pub.orientation}</span>
                </div>
                <div className="card-footer">
                  <div className="publication-state">
                    {getStatusBadge(pub.status)}
                    {pub.status === 'published' && (
                      <span className={`visibility-badge ${pub.is_public ? 'visibility-public' : 'visibility-private'}`}>
                        {pub.is_public ? 'Visible públicamente' : 'Solo privado'}
                      </span>
                    )}
                  </div>
                  <div className="card-actions">
                    <button className="btn-secondary" onClick={() => window.location.href = `/publications/${pub.id}/view`}>Ver Páginas</button>
                    {pub.status === 'published' ? (
                      <>
                        <button className="btn-secondary" onClick={() => handleVisibility(pub)}>
                          {pub.is_public ? 'Ocultar del catálogo' : 'Mostrar en catálogo'}
                        </button>
                        {pub.is_public && (
                          <button className="btn-secondary" onClick={() => window.location.href = `/leer/${pub.id}`}>
                            Abrir lector público
                          </button>
                        )}
                        <button className="btn-warning" onClick={() => handleUnpublish(pub)}>
                          Volver a borrador
                        </button>
                      </>
                    ) : (
                      <button className="btn-primary btn-card-action" onClick={() => handlePublish(pub)}>
                        Publicar
                      </button>
                    )}
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
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h3>{!showConfigStep ? 'Nueva Publicación' : 'Configurar Revista'}</h3>
            
            {!showConfigStep ? (
              // Paso 1: Información básica
              <form onSubmit={(e) => { e.preventDefault(); handleNextStep(); }}>
                <div className="form-group">
                  <label>Origen</label>
                  <div className="radio-group"><label><input type="radio" checked={newPublication.creation_type === 'blank'} onChange={() => setNewPublication({...newPublication, creation_type:'blank'})} /> En blanco</label><label><input type="radio" checked={newPublication.creation_type === 'pdf'} onChange={() => setNewPublication({...newPublication, creation_type:'pdf'})} /> Importar PDF</label><label><input type="radio" disabled /> Plantilla (próximamente)</label></div>
                </div>
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
                    onClick={closeModal}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary">
                    Siguiente →
                  </button>
                </div>
              </form>
            ) : (
              // Paso 2: Configuración de revista
              <form onSubmit={handleCreate}>
                {newPublication.creation_type === 'pdf' ? <div className="form-group"><label>Archivo PDF (máx. 50 MB)</label><input type="file" accept="application/pdf,.pdf" onChange={(e) => setPdfFile(e.target.files?.[0] || null)} /><small>Las páginas se crearán automáticamente al terminar la conversión.</small></div> : <div className="config-grid">
                  <div className="form-group">
                    <label>Tamaño de Página</label>
                    <select
                      value={newPublication.page_size}
                      onChange={(e) => handlePageSizeChange(e.target.value)}
                    >
                      <option value="A4">A4 (210 x 297 mm)</option>
                      <option value="Letter">Carta (216 x 279 mm)</option>
                      <option value="Legal">Oficio (216 x 356 mm)</option>
                      <option value="Custom">Personalizado</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Orientación</label>
                    <div className="radio-group">
                      <label>
                        <input
                          type="radio"
                          value="portrait"
                          checked={newPublication.orientation === 'portrait'}
                          onChange={(e) => handleOrientationChange(e.target.value)}
                        />
                        {' '}Vertical
                      </label>
                      <label>
                        <input
                          type="radio"
                          value="landscape"
                          checked={newPublication.orientation === 'landscape'}
                          onChange={(e) => handleOrientationChange(e.target.value)}
                        />
                        {' '}Horizontal
                      </label>
                    </div>
                  </div>

                  {newPublication.page_size === 'Custom' && (
                    <>
                      <div className="form-group">
                        <label>Ancho (mm)</label>
                        <input
                          type="number"
                          min="50"
                          max="500"
                          value={newPublication.page_width}
                          onChange={(e) => setNewPublication({
                            ...newPublication,
                            page_width: parseInt(e.target.value)
                          })}
                        />
                      </div>
                      <div className="form-group">
                        <label>Alto (mm)</label>
                        <input
                          type="number"
                          min="50"
                          max="1000"
                          value={newPublication.page_height}
                          onChange={(e) => setNewPublication({
                            ...newPublication,
                            page_height: parseInt(e.target.value)
                          })}
                        />
                      </div>
                    </>
                  )}

                  <div className="form-group">
                    <label>Número de Páginas</label>
                    <input
                      type="number"
                      min="2"
                      max="500"
                      value={newPublication.total_pages}
                      onChange={(e) => setNewPublication({
                        ...newPublication,
                        total_pages: parseInt(e.target.value)
                      })}
                    />
                    <small>Mínimo 2 (portada + contraportada)</small>
                  </div>
                </div>}

                <div className="config-preview">
                  <h4>Vista Previa</h4>
                  <div className="preview-info">
                    <p><strong>Tipo:</strong> {newPublication.creation_type === 'pdf' ? 'Importación PDF' : 'Revista en blanco'}</p>
                    {newPublication.creation_type !== 'pdf' && <><p><strong>Tamaño:</strong> {newPublication.page_size}</p>
                    <p><strong>Dimensiones:</strong> {newPublication.page_width} x {newPublication.page_height} mm</p>
                    <p><strong>Orientación:</strong> {newPublication.orientation === 'portrait' ? 'Vertical' : 'Horizontal'}</p>
                    <p><strong>Total de páginas:</strong> {newPublication.total_pages}</p>
                    </>}
                  </div>
                </div>

                <div className="modal-actions">
                  <button 
                    type="button" 
                    className="btn-secondary"
                    onClick={() => setShowConfigStep(false)}
                  >
                    ← Anterior
                  </button>
                  <button type="submit" className="btn-primary">
                    {newPublication.creation_type === 'pdf' ? 'Importar PDF' : 'Crear Revista'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Publications;
