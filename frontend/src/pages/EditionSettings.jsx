import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api, { API_URL } from '../services/api';
import { publicationAPI } from '../services/publicationAPI';
import { collectionAPI } from '../services/collectionAPI';
import { assetAPI } from '../services/assetAPI';
import { useAuth } from '../services/AuthContext';
import { can } from '../services/permissions';
import { publicReaderUrl, isShareable } from '../components/share/shareLinks';
import Icon from '../components/common/Icon';
import '../styles/EditionSettings.css';

// ---------------------------------------------------------------------------
// Ajustes de edición -- Lote L4 (28-sep-2026)
// Página con pestañas (decisión de Carlos, estilo Joomag):
//   Info · Visor · SEO · Compartir e insertar
// Sustituye al modal "Editar edición" de Mis publicaciones. Los ajustes de
// Visor y SEO se leen en vivo en el Reader público (no hace falta volver a
// publicar para que se apliquen).
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'info', label: 'Info' },
  { key: 'visor', label: 'Visor' },
  { key: 'seo', label: 'SEO' },
  { key: 'insertar', label: 'Compartir e insertar' },
];
const DEFAULT_SOUND = '/sounds/page-turn.mp3';
const absUrl = (u) => (!u ? null : u.startsWith('http') ? u : `${API_URL}${u}`);
const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const pickForm = (p) => ({
  title: p.title || '',
  edition_label: p.edition_label || '',
  description: p.description || '',
  sound_enabled: p.sound_enabled !== false,
  page_turn_sound_asset_id: p.page_turn_sound_asset_id || null,
  seo_title: p.seo_title || '',
  seo_description: p.seo_description || '',
  seo_indexable: p.seo_indexable !== false,
  allow_download: p.allow_download === true, // Lote L5
});

export default function EditionSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = can(user, 'editor');

  const [tab, setTab] = useState(() => {
    const h = (window.location.hash || '').replace('#', '');
    return TABS.some((t) => t.key === h) ? h : 'info';
  });
  const [pub, setPub] = useState(null);
  const [form, setForm] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null); // { type, text }

  useEffect(() => {
    let cancelled = false;
    setPub(null);
    setForm(null);
    publicationAPI.get(id)
      .then((p) => { if (!cancelled) { setPub(p); setForm(pickForm(p)); } })
      .catch((err) => { if (!cancelled) setLoadError(err?.response?.status === 404 ? 'Edición no encontrada' : 'No se pudo cargar la edición'); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => { if (tab) window.history.replaceState(null, '', `#${tab}`); }, [tab]);
  useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash || '').replace('#', '');
      if (TABS.some((t) => t.key === h)) setTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const dirty = useMemo(() => {
    if (!pub || !form) return false;
    const base = pickForm(pub);
    return Object.keys(form).some((k) => (form[k] ?? '') !== (base[k] ?? ''));
  }, [pub, form]);

  // Aviso al salir con cambios sin guardar
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) { setNotice({ type: 'error', text: 'El título no puede estar vacío.' }); setTab('info'); return; }
    setSaving(true);
    setNotice(null);
    try {
      const updated = await publicationAPI.update(id, {
        title: form.title.trim(),
        edition_label: form.edition_label.trim(),
        description: form.description.trim(),
        sound_enabled: form.sound_enabled,
        page_turn_sound_asset_id: form.page_turn_sound_asset_id,
        seo_title: form.seo_title.trim(),
        seo_description: form.seo_description.trim(),
        seo_indexable: form.seo_indexable,
        allow_download: pub?.pdf_url ? form.allow_download : false, // Lote L5
      });
      setPub(updated);
      setForm(pickForm(updated));
      setNotice({ type: 'success', text: 'Cambios guardados. El lector público ya los aplica.' });
    } catch (err) {
      const d = err?.response?.data?.detail;
      setNotice({ type: 'error', text: typeof d === 'string' ? d : 'No se pudieron guardar los cambios.' });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="es-page"><div className="es-card"><p className="es-error">{loadError}</p>
        <button type="button" className="btn-secondary" onClick={() => navigate('/collections')}>Volver a colecciones</button></div></div>
    );
  }
  if (!pub || !form) return <div className="es-page"><p className="es-muted">Cargando edición…</p></div>;

  const backTo = pub.collection_id ? `/collections/${pub.collection_id}` : '/collections';
  const statusLabel = pub.status === 'published' ? (pub.is_public ? 'Publicada · visible' : 'Publicada · privada') : 'Borrador';

  return (
    <div className="es-page">
      <div className="es-head">
        <div className="es-head-left">
          <Link to={backTo} className="es-back" onClick={(e) => { if (dirty && !window.confirm('Hay cambios sin guardar. ¿Salir igualmente?')) e.preventDefault(); }}>← Volver</Link>
          <div>
            <h1>{pub.title}{pub.edition_label ? <span className="es-label">{pub.edition_label}</span> : null}</h1>
            <span className={`es-status es-status-${pub.status}${pub.is_public ? ' es-public' : ''}`}>{statusLabel}</span>
          </div>
        </div>
        <div className="es-head-actions">
          <button type="button" className="btn-secondary" onClick={() => navigate(`/publications/${id}/view`)}>Ver páginas</button>
          {canEdit && <button type="button" className="btn-secondary" onClick={() => navigate(`/publications/${id}/edit`)}>Abrir editor</button>}
        </div>
      </div>

      <div className="es-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {notice && <div className={`es-notice es-notice-${notice.type}`} role="status">{notice.text}</div>}

      <div className="es-card">
        {tab === 'info' && <InfoTab pub={pub} form={form} set={set} canEdit={canEdit} navigate={navigate} setNotice={setNotice} />}
        {tab === 'visor' && <ViewerTab pub={pub} form={form} set={set} canEdit={canEdit} setNotice={setNotice} />}
        {tab === 'seo' && <SeoTab pub={pub} form={form} set={set} canEdit={canEdit} />}
        {tab === 'insertar' && <EmbedTab pub={pub} />}
      </div>

      {canEdit && tab !== 'insertar' && (
        <div className={`es-savebar${dirty ? ' es-dirty' : ''}`}>
          <span>{dirty ? 'Tienes cambios sin guardar' : 'Todo guardado'}</span>
          <div>
            <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={() => setForm(pickForm(pub))}>Descartar</button>
            <button type="button" className="btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Info --------------------------------------------------------------------
function InfoTab({ pub, form, set, canEdit, navigate, setNotice }) {
  const [collections, setCollections] = useState([]);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [clone, setClone] = useState({ title: `${pub.title} (copia)`, edition_label: '', collection_id: pub.collection_id || '' });
  const [cloning, setCloning] = useState(false);

  useEffect(() => {
    collectionAPI.list().then((c) => setCollections(Array.isArray(c) ? c : c?.items || [])).catch(() => {});
  }, []);

  const doClone = async () => {
    setCloning(true);
    try {
      const created = await publicationAPI.clone(pub.id, {
        title: clone.title.trim() || undefined,
        edition_label: clone.edition_label.trim(),
        collection_id: clone.collection_id || undefined,
      });
      setCloneOpen(false);
      setNotice({ type: 'success', text: `Copia creada: «${created.title}» (borrador privado). Estás viendo sus ajustes.` });
      navigate(`/publications/${created.id}/ajustes`);
    } catch (err) {
      const d = err?.response?.data?.detail;
      setNotice({ type: 'error', text: typeof d === 'string' ? d : 'No se pudo clonar la edición.' });
    } finally {
      setCloning(false);
    }
  };

  const collectionName = collections.find((c) => c.id === pub.collection_id)?.name;
  return (
    <div className="es-grid">
      <section>
        <h2>Datos de la edición</h2>
        <label className="es-field">
          <span>Título *</span>
          <input type="text" maxLength={200} value={form.title} disabled={!canEdit} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="es-field">
          <span>Edición <em>(opcional)</em></span>
          <input type="text" maxLength={100} value={form.edition_label} disabled={!canEdit} placeholder="Ej: Sep 2026 · No. 35" onChange={(e) => set('edition_label', e.target.value)} />
        </label>
        <label className="es-field">
          <span>Descripción</span>
          <textarea rows={5} maxLength={500} value={form.description} disabled={!canEdit} placeholder="Resumen del contenido de este número…" onChange={(e) => set('description', e.target.value)} />
          <small className="es-count">{form.description.length}/500</small>
        </label>
      </section>
      <aside>
        <h2>Ficha técnica</h2>
        <dl className="es-facts">
          <dt>Páginas</dt><dd>{pub.total_pages}</dd>
          <dt>Tamaño</dt><dd>{pub.page_size} · {pub.page_width}×{pub.page_height} mm</dd>
          <dt>Orientación</dt><dd>{pub.orientation === 'landscape' ? 'Horizontal' : 'Vertical'}</dd>
          {collectionName && (<><dt>Colección</dt><dd>{collectionName}</dd></>)}
          <dt>Dirección</dt><dd className="es-mono">{pub.public_path || `/leer/${pub.id}`}</dd>
          <dt>Creada</dt><dd>{new Date(pub.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
        </dl>
        <p className="es-muted es-small">El tamaño y la orientación se fijan al crear la edición.</p>

        {canEdit && (
          <div className="es-clone">
            <h2>Clonar edición</h2>
            <p className="es-muted es-small">Crea una copia completa (páginas, elementos y ajustes del visor) como <strong>borrador privado</strong>. Las imágenes y vídeos se reutilizan, no ocupan espacio extra.</p>
            {!cloneOpen ? (
              <button type="button" className="btn-secondary" onClick={() => setCloneOpen(true)}><Icon name="page" size={15} /> Clonar…</button>
            ) : (
              <div className="es-clone-form">
                <label className="es-field"><span>Título de la copia</span>
                  <input type="text" maxLength={200} value={clone.title} onChange={(e) => setClone({ ...clone, title: e.target.value })} /></label>
                <label className="es-field"><span>Edición <em>(opcional)</em></span>
                  <input type="text" maxLength={100} value={clone.edition_label} placeholder="Ej: Oct 2026 · No. 36" onChange={(e) => setClone({ ...clone, edition_label: e.target.value })} /></label>
                <label className="es-field"><span>Colección destino</span>
                  <select value={clone.collection_id} onChange={(e) => setClone({ ...clone, collection_id: e.target.value })}>
                    {collections.length === 0 && <option value={pub.collection_id || ''}>{collectionName || 'Misma colección'}</option>}
                    {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></label>
                <div className="es-row">
                  <button type="button" className="btn-secondary" onClick={() => setCloneOpen(false)} disabled={cloning}>Cancelar</button>
                  <button type="button" className="btn-primary" onClick={doClone} disabled={cloning}>{cloning ? 'Clonando…' : 'Crear copia'}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

// --- Visor -------------------------------------------------------------------
function ViewerTab({ pub, form, set, canEdit, setNotice }) {
  const hasPdf = Boolean(pub?.pdf_url);
  const [sounds, setSounds] = useState(null);
  const [uploading, setUploading] = useState(false);
  const audioRef = useRef(null);
  const fileRef = useRef(null);

  const loadSounds = () => api.get('/api/assets', { params: { kind: 'audio' } })
    .then((r) => setSounds(r.data?.assets || []))
    .catch(() => setSounds([]));
  useEffect(() => { loadSounds(); }, []);

  const current = sounds?.find((s) => s.id === form.page_turn_sound_asset_id);
  const play = (url) => {
    try {
      audioRef.current?.pause();
      audioRef.current = new Audio(absUrl(url));
      audioRef.current.volume = 0.6;
      audioRef.current.play().catch(() => {});
    } catch { /* sin audio */ }
  };

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('audio/')) { setNotice({ type: 'error', text: 'El archivo debe ser de audio (MP3, OGG, WAV…).' }); return; }
    if (file.size > 2 * 1048576) { setNotice({ type: 'error', text: 'El sonido debe pesar menos de 2 MB (un efecto de pasar página dura ~1 s).' }); return; }
    setUploading(true);
    try {
      const res = await assetAPI.upload(file);
      await loadSounds();
      if (res?.asset_id) set('page_turn_sound_asset_id', res.asset_id);
    } catch (err) {
      const d = err?.response?.data?.detail;
      setNotice({ type: 'error', text: typeof d === 'string' ? d : 'No se pudo subir el sonido.' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="es-narrow">
      <h2>Sonido al pasar página</h2>
      <label className="es-switch">
        <input type="checkbox" checked={form.sound_enabled} disabled={!canEdit} onChange={(e) => set('sound_enabled', e.target.checked)} />
        <span className="es-switch-ui" aria-hidden="true" />
        <span>{form.sound_enabled ? 'Activado por defecto' : 'Desactivado por defecto'}</span>
      </label>
      <p className="es-muted es-small">El lector siempre puede silenciarlo o activarlo con el botón de altavoz; esto decide cómo empieza.</p>

      <fieldset className="es-sound" disabled={!canEdit || !form.sound_enabled}>
        <legend>Sonido</legend>
        <label className="es-radio">
          <input type="radio" name="snd" checked={!form.page_turn_sound_asset_id} onChange={() => set('page_turn_sound_asset_id', null)} />
          <span>Predeterminado (papel)</span>
          <button type="button" className="es-play" onClick={() => play(DEFAULT_SOUND)} aria-label="Escuchar sonido predeterminado"><Icon name="volume" size={16} /></button>
        </label>
        {sounds === null && <p className="es-muted es-small">Cargando tus sonidos…</p>}
        {sounds?.map((s, i) => (
          <label key={s.id} className="es-radio">
            <input type="radio" name="snd" checked={form.page_turn_sound_asset_id === s.id} onChange={() => set('page_turn_sound_asset_id', s.id)} />
            <span>Audio {sounds.length - i} <em>· {s.created_at ? new Date(s.created_at).toLocaleDateString('es-ES') : ''} · {fmtBytes(s.size_bytes || 0)}</em></span>
            <button type="button" className="es-play" onClick={() => play(s.url)} aria-label="Escuchar"><Icon name="volume" size={16} /></button>
          </label>
        ))}
        {form.page_turn_sound_asset_id && sounds && !current && (
          <p className="es-muted es-small">El sonido elegido ya no está en la biblioteca: se usará el predeterminado.</p>
        )}
        <div className="es-row">
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <button type="button" className="btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Subiendo…' : 'Subir sonido propio…'}
          </button>
          <span className="es-muted es-small">MP3/OGG/WAV, máx. 2 MB. Se guarda en la biblioteca de tu empresa.</span>
        </div>
      </fieldset>

      {/* Lote L5: descarga del PDF original (solo ediciones importadas desde PDF) */}
      <h2 className="es-section-gap">Descarga en PDF</h2>
      <label className="es-switch">
        <input type="checkbox" checked={hasPdf && form.allow_download} disabled={!canEdit || !hasPdf} onChange={(e) => set('allow_download', e.target.checked)} />
        <span className="es-switch-ui" aria-hidden="true" />
        <span>{hasPdf && form.allow_download ? 'Los lectores pueden descargar el PDF' : 'Descarga desactivada'}</span>
      </label>
      {hasPdf ? (
        <p className="es-muted es-small">
          Muestra un botón <Icon name="download" size={14} /> en el lector público (y en el insertado) para bajar el PDF original que importaste.
          Solo funciona mientras la edición esté publicada y visible en el catálogo.
          {form.allow_download ? '' : ' Desactivado por defecto para proteger tu contenido.'}
        </p>
      ) : (
        <p className="es-muted es-small">
          Esta edición se creó en el editor y no tiene un PDF original. La descarga solo está disponible en las ediciones importadas desde PDF.
        </p>
      )}
    </div>
  );
}

// --- SEO ---------------------------------------------------------------------
function SeoTab({ pub, form, set, canEdit }) {
  const effTitle = form.seo_title.trim() || [form.title.trim(), form.edition_label.trim()].filter(Boolean).join(' · ') || 'Revista digital';
  const effDesc = form.seo_description.trim() || form.description.trim() || `Lee «${form.title.trim() || 'esta revista'}» en formato revista digital interactiva.`;
  const url = publicReaderUrl(pub);
  const titleLen = form.seo_title.length;
  const descLen = form.seo_description.length;
  return (
    <div className="es-grid">
      <section>
        <h2>Buscadores y redes sociales</h2>
        <label className="es-field">
          <span>Título SEO <em>(si lo dejas vacío se usa el título de la edición)</em></span>
          <input type="text" maxLength={70} value={form.seo_title} disabled={!canEdit} placeholder={effTitle} onChange={(e) => set('seo_title', e.target.value)} />
          <small className={`es-count${titleLen > 60 ? ' es-warn' : ''}`}>{titleLen}/70 · ideal hasta 60</small>
        </label>
        <label className="es-field">
          <span>Descripción SEO <em>(si la dejas vacía se usa la descripción)</em></span>
          <textarea rows={3} maxLength={160} value={form.seo_description} disabled={!canEdit} placeholder={effDesc} onChange={(e) => set('seo_description', e.target.value)} />
          <small className={`es-count${descLen > 155 ? ' es-warn' : ''}`}>{descLen}/160</small>
        </label>
        <label className="es-switch">
          <input type="checkbox" checked={form.seo_indexable} disabled={!canEdit} onChange={(e) => set('seo_indexable', e.target.checked)} />
          <span className="es-switch-ui" aria-hidden="true" />
          <span>{form.seo_indexable ? 'Visible en Google y otros buscadores' : 'Oculta a buscadores (noindex)'}</span>
        </label>
        <p className="es-muted es-small">Con «noindex» la edición sigue abriéndose con su enlace y en el catálogo, pero se pide a Google que no la muestre en resultados.</p>
      </section>
      <aside>
        <h2>Vista previa en Google</h2>
        <div className="es-serp">
          <div className="es-serp-url">{url.replace(/^https?:\/\//, '').split('/').join(' › ')}</div>
          <div className="es-serp-title">{effTitle.length > 60 ? `${effTitle.slice(0, 60)}…` : effTitle}</div>
          <div className="es-serp-desc">{effDesc.length > 155 ? `${effDesc.slice(0, 155)}…` : effDesc}</div>
        </div>
        {!form.seo_indexable && <p className="es-warn es-small">No aparecerá en buscadores.</p>}
        <p className="es-muted es-small">WhatsApp, Facebook, Telegram, X y LinkedIn usan este mismo título y descripción al compartir el enlace.</p>
      </aside>
    </div>
  );
}

// --- Compartir e insertar ----------------------------------------------------
function EmbedTab({ pub }) {
  const shareable = isShareable(pub);
  const readerUrl = publicReaderUrl(pub);
  const embedUrl = `${window.location.origin}/embed${pub.public_path || `/leer/${pub.id}`}`;
  const [mode, setMode] = useState('responsive');
  const [w, setW] = useState(900);
  const [h, setH] = useState(600);
  const [copied, setCopied] = useState('');

  const titleAttr = (pub.title || 'Revista digital').replace(/"/g, '&quot;');
  const code = mode === 'responsive'
    ? `<div style="position:relative;width:100%;max-width:1200px;aspect-ratio:3/2;margin:0 auto;">\n  <iframe src="${embedUrl}" title="${titleAttr}" style="position:absolute;inset:0;width:100%;height:100%;border:0;" allow="fullscreen; autoplay" allowfullscreen loading="lazy"></iframe>\n</div>`
    : `<iframe src="${embedUrl}" title="${titleAttr}" width="${w}" height="${h}" style="border:0;max-width:100%;" allow="fullscreen; autoplay" allowfullscreen loading="lazy"></iframe>`;

  const copy = async (text, key) => {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(key); setTimeout(() => setCopied(''), 2000);
  };

  if (!shareable) {
    return (
      <div className="es-narrow">
        <h2>Compartir e insertar</h2>
        <p className="es-callout">{pub.status !== 'published'
          ? 'Publica la edición y muéstrala en el catálogo público para obtener el enlace y el código para insertarla en otras webs.'
          : 'Muestra la edición en el catálogo público (Mis publicaciones → «Mostrar en catálogo») para obtener el enlace y el código de inserción.'}</p>
      </div>
    );
  }

  return (
    <div className="es-embed">
      <section>
        <h2>Enlace público</h2>
        <div className="es-copyrow">
          <input type="text" readOnly value={readerUrl} onFocus={(e) => e.target.select()} aria-label="Enlace público" />
          <button type="button" className="btn-primary" onClick={() => copy(readerUrl, 'url')}>{copied === 'url' ? '¡Copiado!' : 'Copiar'}</button>
        </div>

        <h2>Insertar en otra web</h2>
        <p className="es-muted es-small">Pega este código en WordPress (bloque «HTML personalizado»), Wix, Squarespace o cualquier web. Se puede insertar en cualquier dominio.</p>
        <div className="es-seg" role="radiogroup" aria-label="Tamaño">
          <button type="button" className={mode === 'responsive' ? 'active' : ''} onClick={() => setMode('responsive')}>Adaptable</button>
          <button type="button" className={mode === 'fixed' ? 'active' : ''} onClick={() => setMode('fixed')}>Tamaño fijo</button>
        </div>
        {mode === 'fixed' && (
          <div className="es-row">
            <label className="es-inline">Ancho <input type="number" min={300} max={2400} value={w} onChange={(e) => setW(Number(e.target.value) || 900)} /> px</label>
            <label className="es-inline">Alto <input type="number" min={300} max={2000} value={h} onChange={(e) => setH(Number(e.target.value) || 600)} /> px</label>
          </div>
        )}
        <textarea className="es-code" readOnly rows={mode === 'responsive' ? 4 : 2} value={code} onFocus={(e) => e.target.select()} aria-label="Código de inserción" />
        <div className="es-row">
          <button type="button" className="btn-primary" onClick={() => copy(code, 'code')}>{copied === 'code' ? '¡Copiado!' : 'Copiar código'}</button>
          <a className="btn-secondary" href={embedUrl} target="_blank" rel="noopener noreferrer">Abrir versión insertable</a>
        </div>
      </section>
      <aside>
        <h2>Vista previa</h2>
        <div className="es-preview">
          <iframe src={embedUrl} title={`Vista previa de ${pub.title}`} allow="fullscreen; autoplay" allowFullScreen loading="lazy" />
        </div>
      </aside>
    </div>
  );
}
