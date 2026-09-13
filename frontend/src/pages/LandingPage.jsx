import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../services/AuthContext';
import { API_URL } from '../services/api';

const LandingPage = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [publications, setPublications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
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
      const response = await axios.get(`${API_URL}/api/public/publications`);
      setPublications(response.data || []);
    } catch (err) {
      console.error('Error al cargar publicaciones públicas:', err);
    } finally {
      setLoading(false);
    }
  };

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
            📖
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>CETRIX Flipbooks</span>
        </div>

        <nav style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <a href="#showcase" style={{ color: '#e2e8f0', textDecoration: 'none', fontSize: '0.95rem', fontWeight: 500 }}>Showcase</a>
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
            <h2 style={{ fontSize: '2.25rem', fontWeight: 700, marginBottom: '0.75rem' }}>Publicaciones Destacadas</h2>
            <p style={{ color: '#94a3b8', fontSize: '1rem' }}>Explora la experiencia de lectura interactiva en nuestro catálogo público</p>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Cargando catálogo...</div>
          ) : publications.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
              Próximamente estaremos publicando nuestros primeros catálogos interactivos.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '2rem'
            }}>
              {publications.map((pub) => (
                <div
                  key={pub.id}
                  onClick={() => navigate(`/leer/${pub.id}`)}
                  style={{
                    backgroundColor: 'var(--color-navy-dark, #0c1526)',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    transition: 'transform 0.2s, border-color 0.2s',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.borderColor = 'var(--color-gold, #c9a24b)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  }}
                >
                  <div style={{
                    height: '240px',
                    backgroundColor: '#1e293b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    {pub.cover_url ? (
                      <img
                        src={pub.cover_url.startsWith('http') ? pub.cover_url : `${API_URL}${pub.cover_url}`}
                        alt={pub.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ fontSize: '3rem' }}>📘</div>
                    )}
                    <div style={{
                      position: 'absolute',
                      bottom: '10px',
                      right: '10px',
                      backgroundColor: 'rgba(12, 21, 38, 0.85)',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      color: 'var(--color-gold, #c9a24b)',
                      fontWeight: 600
                    }}>
                      {pub.total_pages} Páginas
                    </div>
                  </div>

                  <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '0.5rem', color: '#ffffff' }}>{pub.title}</h3>
                      <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {pub.description || 'Publicación digital interactiva.'}
                      </p>
                    </div>

                    <button style={{
                      marginTop: '1.25rem',
                      backgroundColor: 'transparent',
                      color: 'var(--color-gold, #c9a24b)',
                      border: '1px solid var(--color-gold, #c9a24b)',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      width: '100%',
                      cursor: 'pointer'
                    }}>
                      Abrir Revista 📖
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Capacidades B2B */}
      <section id="capacidades" style={{ padding: '4rem 2rem', maxWidth: '1100px', margin: '0 auto' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, textAlign: 'center', marginBottom: '3rem' }}>Diseñado para Necesidades Corporativas</h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎨</div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Editor HTML5 Libre</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Posicionamiento libre tipo canvas de textos, imágenes, figuras geométricas y fondos dinámicos sin restricción de plantillas rígidas.
            </p>
          </div>

          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎬</div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>Enriquecimiento Multimedia</h3>
            <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Integra galerías de imágenes con rotación en vivo (slideshow), reproductores de audio, videos de YouTube/Vimeo y contenidos embebidos.
            </p>
          </div>

          <div style={{ backgroundColor: 'rgba(255,255,255,0.03)', padding: '2rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🔒</div>
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
            >
              ✕
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
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
