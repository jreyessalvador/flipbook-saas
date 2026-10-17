import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import Icon from '../components/common/Icon';
import Bookshelf from '../components/public/Bookshelf';
import '../styles/Kiosk.css';

const PAGE_SIZE = 24;
const norm = (s) => (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stamp = (p) => Date.parse(p.published_at || p.updated_at || p.created_at || 0) || 0;

// Pagina publica de una coleccion: /r/{empresa}/{coleccion} (estanteria con buscador,
// orden y paginacion). Con `embed` (/embed/r/{empresa}/{coleccion}) se puede insertar
// en la web del cliente: sin cabecera ni migas y con las ediciones tambien en modo embed.
const PublicCollection = ({ embed = false }) => {
  const { tenant, collection } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let alive = true;
    const API_URL = import.meta.env.VITE_API_URL || '';
    setData(null);
    setError('');
    axios.get(`${API_URL}/api/public/r/${encodeURIComponent(tenant)}/${encodeURIComponent(collection)}`)
      .then((res) => { if (alive) setData(res.data); })
      .catch((err) => { if (alive) setError(err.response?.status === 404 ? 'Esta colección no existe o todavía no tiene ediciones públicas.' : 'No se pudo cargar la colección.'); });
    return () => { alive = false; };
  }, [tenant, collection]);

  useEffect(() => {
    if (!data) return undefined;
    const prev = document.title;
    document.title = `${data.collection.name} · ${data.tenant.name} · Cetrix Revistas`;
    return () => { document.title = prev; };
  }, [data]);

  useEffect(() => { setPage(1); }, [query, sort]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = norm(query.trim());
    const list = data.editions.filter((p) => !q || norm(`${p.title} ${p.edition_label || ''}`).includes(q));
    return [...list].sort(sort === 'name'
      ? (a, b) => norm(a.title).localeCompare(norm(b.title)) || stamp(b) - stamp(a)
      : (a, b) => stamp(b) - stamp(a));
  }, [data, query, sort]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const slice = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className={`kiosk-page${embed ? ' kiosk-embed' : ''}`}>
      {!embed && (
        <header className="kiosk-top">
          <Link to="/" className="kiosk-brand"><span className="mark"><Icon name="book" size={18} strokeWidth={2} /></span>Cetrix Revistas</Link>
          <Link to="/#showcase" className="kiosk-chip" style={{ textDecoration: 'none' }}>Ver kiosco</Link>
        </header>
      )}
      <main className="kiosk-main">
        {error ? (
          <div className="kiosk-state">
            <p>{error}</p>
            {!embed && <p><Link to="/" style={{ color: 'var(--color-gold, #c9a24b)' }}>Volver al kiosco</Link></p>}
          </div>
        ) : !data ? (
          <div className="kiosk-state">Cargando colección…</div>
        ) : (
          <>
            {!embed && (
              <nav className="kiosk-crumbs" aria-label="Ruta">
                <Link to="/">Kiosco</Link>
                {data.collection.category && <> · <Link to={`/?categoria=${encodeURIComponent(data.collection.category.slug)}#showcase`}>{data.collection.category.name}</Link></>}
                {' · '}{data.tenant.name}
              </nav>
            )}
            <h1 className="kiosk-title">{data.collection.name}</h1>
            <p className="kiosk-lead">
              {data.collection.description || `Ediciones de ${data.collection.name}, publicadas por ${data.tenant.name}.`}
              {' '}{data.editions.length === 1 ? '1 edición' : `${data.editions.length} ediciones`}.
            </p>

            {data.editions.length > 1 && (
              <div className="shelf-tools">
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar edición…" aria-label="Buscar edición" />
                <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar ediciones">
                  <option value="recent">Más recientes primero</option>
                  <option value="name">Nombre (A–Z)</option>
                </select>
              </div>
            )}

            {slice.length === 0 ? (
              <div className="kiosk-state">No hay ediciones que coincidan con «{query}».</div>
            ) : (
              <Bookshelf items={slice} layout="grid" embed={embed} label={`Ediciones de ${data.collection.name}`} />
            )}

            {pages > 1 && (
              <nav className="shelf-pager" aria-label="Paginación">
                <button type="button" onClick={() => setPage(current - 1)} disabled={current <= 1}>← Anterior</button>
                <span>Página {current} de {pages}</span>
                <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages}>Siguiente →</button>
              </nav>
            )}
            {embed && <p className="shelf-embed-foot"><a href="https://revistas.cetrix.com.mx" target="_blank" rel="noopener noreferrer">Publicado con Cetrix Revistas</a></p>}
          </>
        )}
      </main>
    </div>
  );
};

export default PublicCollection;
