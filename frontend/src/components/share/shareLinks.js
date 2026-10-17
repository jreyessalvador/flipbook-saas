// Enlaces de compartir para una publicacion (2026-09-27, pedido de Carlos).
// La URL publica es la amigable /r/{empresa}/{coleccion}/{edicion} (public_path
// del backend) o, si falta, la del Reader /leer/:id, sobre el mismo origen desde
// el que se usa el panel: funciona igual en DEV y en produccion.

export const publicReaderUrl = (pubOrId) => {
  const path = typeof pubOrId === 'object' && pubOrId
    ? (pubOrId.public_path || pubOrId.url_path || `/leer/${pubOrId.id}`)
    : `/leer/${pubOrId}`;
  return `${window.location.origin}${path}`;
};

// Lote S1: enlace corto propio /s/{code} (fijo por edicion; no cambia aunque
// se renombre o se mueva). Si la edicion aun no tiene, se usa el largo.
export const shortReaderUrl = (pub) =>
  (pub && pub.short_path ? `${window.location.origin}${pub.short_path}` : publicReaderUrl(pub));

// Marca el origen del enlace (?src=) para que las estadisticas distingan QR, WhatsApp, etc.
export const withSrc = (url, src) => `${url}${url.includes('?') ? '&' : '?'}src=${src}`;

export const isShareable = (pub) =>
  pub?.status === 'published' && pub?.is_public === true;

export const shareChannels = (pub) => {
  const base = shortReaderUrl(pub);
  const title = pub.title || 'Revista digital';
  const e = encodeURIComponent;
  const u = (src) => withSrc(base, src);                 // cada canal marca su origen (?src=)
  const text = (src) => `${title} — léela aquí: ${u(src)}`;
  return [
    { key: 'whatsapp', label: 'WhatsApp', icon: 'message', href: `https://wa.me/?text=${e(text('wa'))}` },
    { key: 'telegram', label: 'Telegram', icon: 'send', href: `https://t.me/share/url?url=${e(u('tg'))}&text=${e(title)}` },
    { key: 'email', label: 'Correo', icon: 'mail', href: `mailto:?subject=${e(title)}&body=${e(text('mail'))}` },
    { key: 'facebook', label: 'Facebook', icon: 'facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${e(u('fb'))}` },
    { key: 'x', label: 'X (Twitter)', icon: 'x', href: `https://twitter.com/intent/tweet?url=${e(u('tw'))}&text=${e(title)}` },
    { key: 'linkedin', label: 'LinkedIn', icon: 'linkedin', href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(u('li'))}` },
  ];
};

// Nombre de archivo seguro para descargas (QR)
export const slugify = (s) =>
  (s || 'publicacion')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'publicacion';
