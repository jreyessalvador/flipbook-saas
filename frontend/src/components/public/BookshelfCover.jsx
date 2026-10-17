import React from 'react';
import { Link } from 'react-router-dom';
import { API_URL } from '../../services/api';
import Icon from '../common/Icon';

// Portada de la estanteria publica (kiosco). Usa la portada COMPLETA renderizada
// (cover_url, 400 px, + cover_url_2x, 800 px) que genera el worker al publicar (L7a).
const abs = (u) => (u ? (u.startsWith('http') ? u : `${API_URL}${u}`) : null);

const NEW_DAYS = 15;
// Cinta «NUEVO» automatica: solo si la version vigente se publico hace menos de 15 dias.
export const isNewEdition = (publishedAt, now = Date.now()) => {
  const t = publishedAt ? Date.parse(publishedAt) : NaN;
  return Number.isFinite(t) && t <= now + 60_000 && now - t < NEW_DAYS * 86_400_000;
};

// En la version insertable (/embed) las ediciones se abren tambien en su version insertable.
export const editionPath = (pub, embed) => {
  const base = pub.url_path || `/leer/${pub.id}`;
  return embed ? `/embed${base}` : base;
};

const BookshelfCover = ({ pub, featured = false, embed = false, priority = false }) => {
  const src = abs(pub.cover_url);
  const src2x = abs(pub.cover_url_2x);
  const w = pub.page_width || 210;
  const h = pub.page_height || 297;
  const label = `Leer ${pub.title}${pub.edition_label ? ` · ${pub.edition_label}` : ''}`;
  return (
    <li className={`shelf-item${featured ? ' is-featured' : ''}`}>
      <div className="shelf-stage">
        {featured && <span className="shelf-flag">Último número</span>}
        <Link to={editionPath(pub, embed)} className="shelf-cover" aria-label={label} style={{ aspectRatio: `${w} / ${h}` }}>
          {src ? (
            <img
              src={src}
              srcSet={src2x ? `${src} 400w, ${src2x} 800w` : undefined}
              sizes={featured ? '(max-width: 640px) 46vw, 220px' : '(max-width: 640px) 46vw, 160px'}
              alt=""
              width={400}
              height={Math.round((400 * h) / w)}
              loading={priority ? 'eager' : 'lazy'}
              fetchpriority={priority ? 'high' : undefined}
              decoding="async"
            />
          ) : (
            <span className="shelf-empty"><Icon name="book" size={40} strokeWidth={1.4} /></span>
          )}
          {isNewEdition(pub.published_at) && <span className="shelf-new">Nuevo</span>}
          <span className="shelf-hover" aria-hidden="true">
            <strong>{pub.title}</strong>
            {pub.edition_label && <em>{pub.edition_label}</em>}
            <small>{pub.total_pages} págs.</small>
          </span>
        </Link>
      </div>
      <div className="shelf-caption">
        <strong>{pub.title}</strong>
        {pub.edition_label && <span>{pub.edition_label}</span>}
      </div>
    </li>
  );
};

export default BookshelfCover;
