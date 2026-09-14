import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { PageCanvas, computeSpreadViews } from '../components/editor/CanvasEditorV2';
import { createPageEditorStore } from '../store/pageEditorStore';

const ReaderPage = ({ page, publication, totalPages }) => {
  const [useStore] = useState(() => createPageEditorStore());

  useEffect(() => {
    useStore.setState({
      pageId: page.id || `public-${page.page_number}`,
      version: 0,
      elements: (page.elements || []).map((element) => ({ ...element })),
      selectedElementIds: [],
      isLoading: false,
      loadError: null,
    });
  }, [page, useStore]);

  return (
    <PageCanvas
      useStoreHook={useStore}
      canEdit={false}
      publication={publication}
      pageNumber={page.page_number}
      totalPages={totalPages}
      onFocus={() => {}}
      scale={0.72}
    />
  );
};

const PublicReader = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);

  useEffect(() => {
    fetchPublicData();
  }, [id]);

  const fetchPublicData = async () => {
    try {
      setLoading(true);
      setError('');
      const API_URL = import.meta.env.VITE_API_URL || '';

      const [pubRes, pagesRes] = await Promise.all([
        axios.get(`${API_URL}/api/public/publications/${id}`),
        axios.get(`${API_URL}/api/public/publications/${id}/pages`)
      ]);

      setPublication(pubRes.data);
      setPages(pagesRes.data || []);
    } catch (err) {
      console.error('Error cargando publicación pública:', err);
      setError(err.response?.data?.detail || 'No se pudo cargar la publicación solicitada.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <h2>Cargando Revista Digital...</h2>
      </div>
    );
  }

  if (error || !publication) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '2rem' }}>
        <h2 style={{ color: '#f87171' }}>{error || 'Publicación no disponible.'}</h2>
        <button
          onClick={() => navigate('/')}
          style={{ backgroundColor: 'var(--color-gold, #c9a24b)', color: '#0c1526', border: 'none', padding: '0.75rem 1.5rem', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          Volver al Inicio
        </button>
      </div>
    );
  }

  const spreadViews = computeSpreadViews(pages);
  const currentSpread = spreadViews[currentSpreadIndex] || { left: null, right: null };
  const currentPages = [currentSpread.left, currentSpread.right].filter(Boolean);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Reader Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.75rem 1.5rem',
        backgroundColor: 'var(--color-navy, #14213d)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        color: '#fff',
        zIndex: 50
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: 'var(--color-gold, #c9a24b)', fontSize: '1rem', cursor: 'pointer', fontWeight: 600 }}
          >
            ← Volver
          </button>
          <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{publication.title}</span>
        </div>

        <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
          Spread {currentSpreadIndex + 1} de {spreadViews.length}
        </div>
      </header>

      {/* Main Canvas Display (Modo Lectura / Spread View) */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: '2px', backgroundColor: '#000', padding: '4px', borderRadius: '4px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)' }}>
          {currentPages.map((p) => (
            <div key={p.id || p.page_number} style={{ backgroundColor: '#fff' }}>
              <ReaderPage page={p} publication={publication} totalPages={pages.length} />
            </div>
          ))}
        </div>
      </div>

      {/* Reader Controls (Navegación Inferior) */}
      <footer style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '1.5rem',
        padding: '1rem',
        backgroundColor: 'var(--color-navy, #14213d)',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        zIndex: 50
      }}>
        <button
          disabled={currentSpreadIndex === 0}
          onClick={() => setCurrentSpreadIndex(prev => Math.max(0, prev - 1))}
          style={{
            backgroundColor: currentSpreadIndex === 0 ? 'rgba(255,255,255,0.05)' : 'var(--color-gold, #c9a24b)',
            color: currentSpreadIndex === 0 ? '#64748b' : '#0c1526',
            border: 'none',
            padding: '0.6rem 1.25rem',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: currentSpreadIndex === 0 ? 'not-allowed' : 'pointer'
          }}
        >
          ◄ Anterior
        </button>

        <span style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500 }}>
          Página {currentPages.map(p => p.page_number).join('-')}
        </span>

        <button
          disabled={currentSpreadIndex === spreadViews.length - 1}
          onClick={() => setCurrentSpreadIndex(prev => Math.min(spreadViews.length - 1, prev + 1))}
          style={{
            backgroundColor: currentSpreadIndex === spreadViews.length - 1 ? 'rgba(255,255,255,0.05)' : 'var(--color-gold, #c9a24b)',
            color: currentSpreadIndex === spreadViews.length - 1 ? '#64748b' : '#0c1526',
            border: 'none',
            padding: '0.6rem 1.25rem',
            borderRadius: '6px',
            fontWeight: 700,
            cursor: currentSpreadIndex === spreadViews.length - 1 ? 'not-allowed' : 'pointer'
          }}
        >
          Siguiente ►
        </button>
      </footer>
    </div>
  );
};

export default PublicReader;
