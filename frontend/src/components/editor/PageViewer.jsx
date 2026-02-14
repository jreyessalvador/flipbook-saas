import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import '../../styles/PageViewer.css';

const PageViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [viewMode, setViewMode] = useState('dual'); // dual o single
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadPublication();
    loadPages();
  }, [id]);

  const loadPublication = async () => {
    try {
      const data = await publicationAPI.get(id);
      setPublication(data);
    } catch (err) {
      console.error('Error loading publication:', err);
      setError('Error al cargar la publicación');
    }
  };

  const loadPages = async () => {
    try {
      setLoading(true);
      const data = await pageAPI.getPublicationPages(id);
      setPages(data);
      setError(null);
    } catch (err) {
      console.error('Error loading pages:', err);
      setError('Error al cargar las páginas');
    } finally {
      setLoading(false);
    }
  };

  const goToPage = (index) => {
    if (index >= 0 && index < pages.length) {
      setCurrentPageIndex(index);
    }
  };

  const nextPage = () => {
    if (viewMode === 'dual') {
      goToPage(currentPageIndex + 2);
    } else {
      goToPage(currentPageIndex + 1);
    }
  };

  const prevPage = () => {
    if (viewMode === 'dual') {
      goToPage(currentPageIndex - 2);
    } else {
      goToPage(currentPageIndex - 1);
    }
  };

  const getCurrentPages = () => {
    const currentPage = pages[currentPageIndex];
    
    // Portada y contraportada siempre en modo single
    if (currentPage?.page_type === 'cover' || currentPage?.page_type === 'back_cover') {
      return [currentPage];
    }
    
    // Modo dual: mostrar dos páginas
    if (viewMode === 'dual' && currentPageIndex + 1 < pages.length) {
      return [currentPage, pages[currentPageIndex + 1]];
    }
    
    // Modo single o última página
    return [currentPage];
  };

  const getPageTypeLabel = (pageType) => {
    const labels = {
      'cover': 'Portada',
      'back_cover': 'Contraportada',
      'content': 'Contenido'
    };
    return labels[pageType] || 'Página';
  };

  if (loading) {
    return (
      <div className="page-viewer-container">
        <div className="loading">Cargando páginas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-viewer-container">
        <div className="error-message">{error}</div>
        <button onClick={() => navigate('/publications')} className="btn-secondary">
          Volver a Publicaciones
        </button>
      </div>
    );
  }

  const currentPages = getCurrentPages();
  const canGoPrev = currentPageIndex > 0;
  const canGoNext = viewMode === 'dual' 
    ? currentPageIndex + 2 < pages.length 
    : currentPageIndex + 1 < pages.length;

  return (
    <div className="page-viewer-container">
      {/* Header */}
      <div className="viewer-header">
        <div className="header-left">
          <button onClick={() => navigate('/publications')} className="btn-back">
            ← Volver
          </button>
          <h2>{publication?.title}</h2>
        </div>
        <div className="header-right">
          <div className="view-mode-toggle">
            <button
              className={viewMode === 'single' ? 'active' : ''}
              onClick={() => setViewMode('single')}
              title="Vista simple"
            >
              📄
            </button>
            <button
              className={viewMode === 'dual' ? 'active' : ''}
              onClick={() => setViewMode('dual')}
              title="Vista dual"
            >
              📖
            </button>
          </div>
          <button className="btn-primary">
            Editar Contenido
          </button>
        </div>
      </div>

      {/* Visor de páginas */}
      <div className="viewer-content">
        <div className={`pages-display ${viewMode}`}>
          {currentPages.map((page, index) => (
            <div 
              key={page.id} 
              className={`page ${page.page_type}`}
              style={{
                width: `${publication.page_width}mm`,
                height: `${publication.page_height}mm`,
                aspectRatio: `${publication.page_width}/${publication.page_height}`
              }}
            >
              <div className="page-number">
                {page.page_number}
              </div>
              <div className="page-type-badge">
                {getPageTypeLabel(page.page_type)}
              </div>
              <div className="page-content">
                {Object.keys(page.content).length === 0 ? (
                  <div className="empty-page">
                    <p>Página vacía</p>
                    <small>Haz clic en "Editar Contenido" para agregar elementos</small>
                  </div>
                ) : (
                  <pre>{JSON.stringify(page.content, null, 2)}</pre>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Controles de navegación */}
      <div className="viewer-controls">
        <button 
          onClick={prevPage} 
          disabled={!canGoPrev}
          className="btn-nav"
        >
          ← Anterior
        </button>
        
        <div className="page-indicator">
          Página {currentPageIndex + 1} de {pages.length}
        </div>
        
        <button 
          onClick={nextPage} 
          disabled={!canGoNext}
          className="btn-nav"
        >
          Siguiente →
        </button>
      </div>

      {/* Thumbnails */}
      <div className="thumbnails-bar">
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={`thumbnail ${index === currentPageIndex ? 'active' : ''}`}
            onClick={() => goToPage(index)}
          >
            <div className="thumbnail-preview">
              {page.page_number}
            </div>
            <small>{getPageTypeLabel(page.page_type)}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PageViewer;
