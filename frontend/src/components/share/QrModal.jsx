import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { shortReaderUrl, slugify } from './shareLinks';
import './share.css';

// Modal "QR": QR del Reader publico, descargable en PNG (alta resolucion,
// apto para imprimir) y SVG (vectorial, para imprenta/diseno).
const QR_OPTS = { errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0f1b33', light: '#ffffff' } };

const QrModal = ({ pub, onClose }) => {
  // Lote S1: el QR apunta al enlace corto (menos modulos = se escanea mejor
  // impreso pequeno, y no se rompe si la edicion se renombra o se mueve).
  const url = shortReaderUrl(pub);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    QRCode.toDataURL(url, { ...QR_OPTS, width: 320 })
      .then(setPreview)
      .catch(() => setError('No se pudo generar el código QR'));
  }, [url]);

  const download = (href, ext) => {
    const a = document.createElement('a');
    a.href = href; a.download = `qr-${slugify(pub.title)}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const downloadPng = async () => {
    download(await QRCode.toDataURL(url, { ...QR_OPTS, width: 1200 }), 'png');
  };

  const downloadSvg = async () => {
    const svg = await QRCode.toString(url, { ...QR_OPTS, type: 'svg' });
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    download(blobUrl, 'svg');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content qr-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Código QR de ${pub.title}`}>
        <h3>Código QR</h3>
        <p className="share-subtitle">{pub.title}</p>
        <div className="qr-box">
          {error ? <div className="error-message">{error}</div>
            : preview ? <img src={preview} alt={`Código QR que abre ${url}`} width="320" height="320" />
            : <div className="qr-loading">Generando…</div>}
        </div>
        <p className="qr-url">{url}</p>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cerrar</button>
          <button type="button" className="btn-secondary" onClick={downloadSvg} disabled={!preview}>Descargar SVG</button>
          <button type="button" className="btn-primary" onClick={downloadPng} disabled={!preview}>Descargar PNG</button>
        </div>
      </div>
    </div>
  );
};

export default QrModal;
