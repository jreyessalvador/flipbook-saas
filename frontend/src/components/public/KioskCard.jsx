import React from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../../services/api';
import Icon from '../common/Icon';
import '../../styles/Kiosk.css';

// Tarjeta de edicion del kiosco publico (landing y pagina de coleccion).
// Enlaza a la URL amigable /r/{empresa}/{coleccion}/{edicion} que da el backend.
const coverSrc = (url) => (url ? (url.startsWith('http') ? url : `${API_URL}${url}`) : null);

const KioskCard = ({ pub, showCollection = false }) => {
  const src = coverSrc(pub.cover_url);
  const to = pub.url_path || `/leer/${pub.id}`;
  return (
    <Link to={to} className="kiosk-card" aria-label={`Leer ${pub.title}${pub.edition_label ? ` · ${pub.edition_label}` : ''}`}>
      <div className="kiosk-cover" style={{ aspectRatio: `${pub.page_width || 210} / ${pub.page_height || 297}` }}>
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <Icon name="book" size={44} strokeWidth={1.4} />}
        <span className="kiosk-pages">{pub.total_pages} págs.</span>
      </div>
      <div className="kiosk-body">
        {showCollection && pub.collection?.name && <span className="kiosk-kicker">{pub.collection.name}</span>}
        <h3>{pub.title}</h3>
        {pub.edition_label && <span className="kiosk-edition">{pub.edition_label}</span>}
      </div>
    </Link>
  );
};

export default KioskCard;
