import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import axios from 'axios';
import Icon from '../components/common/Icon';
import KioskCard from '../components/public/KioskCard';
import '../styles/Kiosk.css';

// Pagina publica de una coleccion: /r/{empresa}/{coleccion} (Lote 3, kiosco).
const PublicCollection = () => {
  const { tenant, collection } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

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

  return (
    <div className="kiosk-page">
      <header className="kiosk-top">
        <Link to="/" className="kiosk-brand"><span className="mark"><Icon name="book" size={18} strokeWidth={2} /></span>Cetrix Revistas</Link>
        <Link to="/#showcase" className="kiosk-chip" style={{ textDecoration: 'none' }}>Ver kiosco</Link>
      </header>
      <main className="kiosk-main">
        {error ? (
          <div className="kiosk-state">
            <p>{error}</p>
            <p><Link to="/" style={{ color: 'var(--color-gold, #c9a24b)' }}>Volver al kiosco</Link></p>
          </div>
        ) : !data ? (
          <div className="kiosk-state">Cargando colección…</div>
        ) : (
          <>
            <nav className="kiosk-crumbs" aria-label="Ruta">
              <Link to="/">Kiosco</Link>
              {data.collection.category && <> · <Link to={`/?categoria=${encodeURIComponent(data.collection.category.slug)}#showcase`}>{data.collection.category.name}</Link></>}
              {' · '}{data.tenant.name}
            </nav>
            <h1 className="kiosk-title">{data.collection.name}</h1>
            <p className="kiosk-lead">
              {data.collection.description || `Ediciones de ${data.collection.name}, publicadas por ${data.tenant.name}.`}
              {' '}{data.editions.length === 1 ? '1 edición' : `${data.editions.length} ediciones`}.
            </p>
            <div className="kiosk-grid">
              {data.editions.map((pub) => <KioskCard key={pub.id} pub={pub} />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default PublicCollection;
