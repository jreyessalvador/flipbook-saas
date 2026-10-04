import React, { useState } from 'react';
import { publicReaderUrl, shortReaderUrl, shareChannels } from './shareLinks';
import './share.css';

import Icon from '../common/Icon';
// Modal "Compartir": canales habituales + copiar enlace + menu nativo del
// sistema (movil) cuando el navegador lo soporta.
const ShareModal = ({ pub, onClose }) => {
  const [copied, setCopied] = useState(null);
  // Lote S1: se comparte el enlace corto; el completo queda como alternativa
  const url = shortReaderUrl(pub);
  const longUrl = publicReaderUrl(pub);
  const hasShort = Boolean(pub?.short_path);
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async (value = url, which = 'short') => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Fallback para contextos sin Clipboard API
      const ta = document.createElement('textarea');
      ta.value = value; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const nativeShare = async () => {
    try { await navigator.share({ title: pub.title, text: pub.title, url }); } catch { /* cancelado */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content share-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Compartir ${pub.title}`}>
        <h3>Compartir publicación</h3>
        <p className="share-subtitle">{pub.title}</p>

        <div className="share-url-row">
          <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={hasShort ? 'Enlace corto' : 'Enlace público'} />
          <button type="button" className="btn-primary" onClick={() => copy(url, 'short')}>{copied === 'short' ? '¡Copiado!' : 'Copiar enlace'}</button>
        </div>
        {hasShort && (
          <p className="share-long">
            Enlace completo: <button type="button" className="share-long-copy" onClick={() => copy(longUrl, 'long')} title="Copiar enlace completo">{copied === 'long' ? '¡Copiado!' : longUrl.replace(/^https?:\/\//, '')}</button>
          </p>
        )}

        <div className="share-grid">
          {shareChannels(pub).map((c) => (
            <a key={c.key} className={`share-channel share-${c.key}`} href={c.href} target={c.key === 'email' ? '_self' : '_blank'} rel="noopener noreferrer">
              <span className="share-icon" aria-hidden="true"><Icon name={c.icon} size={20} /></span>
              <span>{c.label}</span>
            </a>
          ))}
          {canNativeShare && (
            <button type="button" className="share-channel share-native" onClick={nativeShare}>
              <span className="share-icon" aria-hidden="true"><Icon name="share" size={20} /></span>
              <span>Más opciones…</span>
            </button>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
};

export default ShareModal;
