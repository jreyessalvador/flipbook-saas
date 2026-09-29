import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../services/AuthContext';
import { API_URL } from '../services/api';

import Icon from '../components/common/Icon';
import KioskCard from '../components/public/KioskCard';
import '../styles/Kiosk.css';
const LandingPage = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [publications, setPublications] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('categoria') || '';
  const [loading, setLoading] = useState(true);
  // ?acceso=1 abre directamente el modal de acceso (enlaces de vuelta desde
  // recuperar/restablecer contraseña).
  const [showLoginModal, setShowLoginModal] = useState(() => searchParams.get('acceso') === '1');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchPublicPublications();
  }, []);

  const fetchPublicPublications = async () => {
    try {
      setLoading(true);
      const API_URL = import.meta.env.VITE_API_URL || '';
      const [response, cats] = await Promise.all([
        axios.get(`${API_URL}/api/public/publications`),
        axios.get(`${API_URL}/api/public/categories`).catch(() => ({ data: [] })),
      ]);
      setPublications(response.data || []);
      setCategories(cats.data || []);
    } catch (err) {
      console.error('Error al cargar publicaciones públicas:', err);
    } finally {
      setLoading(false);
    }
  };

  const selectCategory = (slug) => {
    const next = new URLSearchParams(searchParams);
    if (slug) next.set('categoria', slug); else next.delete('categoria');
    setSearchParams(next, { replace: true });
  };

  // Kiosco agrupado por coleccion (orden: la coleccion con la edicion mas reciente primero)
  const groups = React.useMemo(() => {
    const map = new Map();
    publications
      .filter((p) => !category || p.collection?.category?.slug === category)
      .forEach((p) => {
        const key = p.collection?.id || 'sin-coleccion';
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: p.collection?.name || 'Publicaciones',
            tenant: p.tenant?.name || '',
            category: p.collection?.category?.name || '',
            path: p.tenant?.slug && p.collection?.slug ? `/r/${p.tenant.slug}/${p.collection.slug}` : null,
            items: [],
          });
        }
        map.get(key).items.push(p);
      });
    return [...map.values()];
  }, [publications, category]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      setShowLoginModal(false);
      navigate('/dashboard');
    } catch (err) {
      setLoginError(err.response?.data?.detail || 'Credenciales incorrectas o error en servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-navy-dark, #0c1526)', color: '#ffffff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header / Navbar */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1.25rem 2.5rem',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        backgroundColor: 'var(--color-navy, #14213d)',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'linear-gradient(135deg, var(--color-gold, #c9a24b), #e5c158)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: '#000' }}>
            <Icon name="book" size={20} strokeWidth={2} />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Cetrix Revistas</span>
        </div>

        <nav style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <a href="#showcase" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 500 }}>Kiosco</a>
          <a href="#capacidades" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 500 }}>Capacidades B2B</a>
          <a href="#contacto" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 500 }}>Contacto</a>
          
          {isAuthenticated ? (
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                backgroundColor: 'var(--color-gold, #c9a24b)',
                color: '#0c1526',
                border: 'none',
                padding: '0.6rem 1.25rem',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Ir a mi Panel
            </button>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              style={{
                backgroundColor: 'transparent',
                color: 'var(--color-gold, #c9a24b)',
                border: '1.5px solid var(--color-gold, #c9a24b)',
                padding: '0.55rem 1.2rem',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Acceso Clientes
            </button>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <section style={{
        padding: '5rem 2rem',
        textAlign: 'center',
        maxWidth: '900px',
        margin: '0 auto'
      }}>
        <div style={{
          display: 'inline-block',
          padding: '0.35rem 1rem',
          borderRadius: '20px',
          backgroundColor: 'rgba(201, 162, 75, 0.15)',
          color: 'var(--color-gold, #c9a24b)',
          fontSize: '0.85rem',
          fontWeight: 600,
          marginBottom: '1.5rem',
          border: '1px solid rgba(201, 162, 75, 0.3)'
        }}>
          Solución Enterprise de Publicaciones Digitales HTML5
        </div>

        <h1 style={{ fontSize: '3rem', fontWeight: 800, lineHeight: 1.15, marginBottom: '1.5rem', letterSpacing: '-0.03em' }}>
          Transforma tus documentos en publicaciones interactivas de alto impacto
        </h1>
        
        <p style={{ fontSize: '1.15rem', color: '#94a3b8', lineHeight: 1.6, marginBottom: '2.5rem', maxWidth: '750px', margin: '0 auto 2.5rem' }}>
          Crea revistas, catálogos e informes corporativos con animaciones enriquecidas, galerías en vivo y reproducción multimedia sin fisuras en cualquier dispositivo.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
          <a
            href="#showcase"
            style={{
              backgroundColor: 'var(--color-gold, #c9a24b)',
              color: '#0c1526',
              padding: '0.85rem 2rem',
              borderRadius: '8px',
              fontWeight: 700,
              textDecoration: 'none',
              fontSize: '1rem'
            }}
          >
            Explorar Ejemplo
          </a>
          <a
            href="#contacto"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
              color: '#ffffff',
              border: '1px solid rgba(255,255,255,0.2)',
              padding: '0.85rem 2rem',
              borderRadius: '8px',
              fontWeight: 600,
              textDecoration: 'none',
              fontSize: '1rem'
            }}
          >
            Solicitar Demostración B2B
          </a>
        </div>
      </section>

      {/* Showcase / Galería pública */}
      <section id="showcase" style={{ padding: '4rem 2rem', backgroundColor: 'var(--color-navy, #14213d)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, marginBottom: '0.75rem' }}>Kiosco de publicaciones</h2>
            <p style={{ color: '#94a3b8', fontSize: '1rem' }}>Revistas y catálogos publicados con Cetrix Revistas, organizados por colección</p>
          </div>

          {!loading && categories.length > 1 && (
            <div className="kiosk-chips" role="group" aria-label="Filtrar por categoría">
              <button type="button" className="kiosk-chip" aria-pressed={!category} onClick={() => selectCategory('')}>Todas</button>
              {categories.map((c) => (
                <button key={c.slug} type="button" className="kiosk-chip" aria-pressed={category === c.slug} onClick={() => selectCategory(c.slug)}>
                  {c.name}<small>{c.count}</small>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="kiosk-state">Cargando catálogo…</div>
          ) : groups.length === 0 ? (
            <div className="kiosk-state">
              {category ? 'No hay ediciones públicas en esta categoría.' : 'Próximamente estaremos publicando nuestros primeros catálogos interactivos.'}
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} className="kiosk-group" aria-labelledby={`col-${g.key}`}>
                <div className="kiosk-group-head">
                  <div>
                    <h3 id={`col-${g.key}`}>{g.name}</h3>
                    <p>{g.tenant}{g.category ? ` · ${g.category}` : ''} · {g.items.length === 1 ? '1 edición' : `${g.items.length} ediciones`}</p>
                  </div>
                  {g.path && <Link to={g.path}>Ver colección →</Link>}
                </div>
                <div className="kiosk-grid">
                  {g.items.slice(0, 8).map((pub) => <KioskCard key={pub.id} pub={pub} />)}
                </div>
              </section>
            ))
          )}
        </div>
      </section>

      {/* Capacidades B2B */}
      <section id="capacidades" style={{ padding: '4rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, textAlign: 'center', marginBottom: '3rem' }}>Diseñado para Necesidades Corporativas</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ marginBottom: '1rem', color: 'var(--color-gold, #c9a24b)' }}><Icon name="palette" size={32} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Editor HTML5 Libre</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Posicionamiento libre tipo canvas de textos, imágenes, figuras geométricas y fondos dinámicos sin restricción de plantillas rígidas.
            </p>
          </div>

          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ marginBottom: '1rem', color: 'var(--color-gold, #c9a24b)' }}><Icon name="film" size={32} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Enriquecimiento Multimedia</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Integra galerías de imágenes con rotación en vivo (slideshow), reproductores de audio, videos de YouTube/Vimeo y contenidos embebidos.
            </p>
          </div>

          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ marginBottom: '1rem', color: 'var(--color-gold, #c9a24b)' }}><Icon name="lock" size={32} /></div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Publicación Directa y Segura</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Control total sobre publicaciones públicas y privadas, congelamiento de snapshots inmutables para lectores y gestión multi-inquilino.
            </p>
          </div>
        </div>
      </section>

      {/* Formulario de Contacto B2B */}
      <section id="contacto" style={{ padding: '4rem 2rem', backgroundColor: 'var(--color-navy, #14213d)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.75rem' }}>Solicita una Propuesta a Medida</h2>
          <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>Ponte en contacto con nuestro equipo comercial para activar tu cuenta de empresa.</p>

          <form onSubmit={(e) => { e.preventDefault(); alert('Gracias por tu interés. Un asesor comercial te contactará a la brevedad.'); }} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Nombre Completo</label>
              <input required type="text" placeholder="Ej. Carlos Reyes" style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Correo Corporativo</label>
              <input required type="email" placeholder="carlos@empresa.com" style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Empresa / Organización</label>
              <input required type="text" placeholder="Nombre de tu empresa" style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Mensaje</label>
              <textarea rows={4} placeholder="Cuéntanos acerca de tus publicaciones requeridas..." style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}></textarea>
            </div>
            <button type="submit" style={{ backgroundColor: 'var(--color-gold, #c9a24b)', color: '#0c1526', padding: '0.85rem', borderRadius: '6px', fontWeight: 700, border: 'none', cursor: 'pointer', marginTop: '0.5rem' }}>
              Enviar Mensaje
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: '2rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        © 2026 CETRIX Software. Todos los derechos reservados.
      </footer>

      {/* Modal de Login B2B */}
      {showLoginModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--color-navy, #14213d)',
            padding: '2.5rem',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '420px',
            border: '1px solid rgba(255,255,255,0.1)',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowLoginModal(false)}
              style={{
                position: 'absolute',
                top: '1rem',
                right: '1rem',
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                fontSize: '1.25rem',
                cursor: 'pointer'
              }}
            aria-label="Cerrar">
              <Icon name="close" size={20} />
            </button>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem', textAlign: 'center' }}>Acceso a Plataforma</h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', textAlign: 'center', marginBottom: '1.5rem' }}>
              Ingresa tus credenciales B2B provistas por CETRIX
            </p>

            {loginError && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '0.75rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {loginError}
              </div>
            )}

            <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Correo Electrónico</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.4rem', color: '#cbd5e1' }}>Contraseña</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', backgroundColor: 'var(--color-navy-dark, #0c1526)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' }}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  backgroundColor: 'var(--color-gold, #c9a24b)',
                  color: '#0c1526',
                  padding: '0.85rem',
                  borderRadius: '6px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  marginTop: '0.5rem',
                  opacity: isSubmitting ? 0.7 : 1
                }}
              >
                {isSubmitting ? 'Iniciando Sesión...' : 'Ingresar'}
              </button>
            </form>
            <p style={{ textAlign: 'center', marginTop: '1.1rem', fontSize: '0.9rem' }}>
              <Link to="/recuperar-contrasena" onClick={() => setShowLoginModal(false)} style={{ color: 'var(--color-gold, #c9a24b)' }}>
                ¿Olvidaste tu contraseña?
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
