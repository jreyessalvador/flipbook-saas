// Enlaces de compartir para una publicacion (2026-09-27, pedido de Carlos).
// La URL publica es la del Reader (/leer/:id) sobre el mismo origen desde el
// que se usa el panel, asi funciona igual en DEV y en produccion.

export const publicReaderUrl = (pubId) =>
  `${window.location.origin}/leer/${pubId}`;

export const isShareable = (pub) =>
  pub?.status === 'published' && pub?.is_public === true;

export const shareChannels = (pub) => {
  const url = publicReaderUrl(pub.id);
  const title = pub.title || 'Revista digital';
  const text = `${title} — léela aquí: ${url}`;
  const e = encodeURIComponent;
  return [
    { key: 'whatsapp', label: 'WhatsApp', icon: '💬', href: `https://wa.me/?text=${e(text)}` },
    { key: 'telegram', label: 'Telegram', icon: '✈️', href: `https://t.me/share/url?url=${e(url)}&text=${e(title)}` },
    { key: 'email', label: 'Correo', icon: '✉️', href: `mailto:?subject=${e(title)}&body=${e(text)}` },
    { key: 'facebook', label: 'Facebook', icon: '📘', href: `https://www.facebook.com/sharer/sharer.php?u=${e(url)}` },
    { key: 'x', label: 'X (Twitter)', icon: '𝕏', href: `https://twitter.com/intent/tweet?url=${e(url)}&text=${e(title)}` },
    { key: 'linkedin', label: 'LinkedIn', icon: '💼', href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
  ];
};

// Nombre de archivo seguro para descargas (QR)
export const slugify = (s) =>
  (s || 'publicacion')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'publicacion';
