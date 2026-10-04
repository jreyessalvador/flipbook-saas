// Lote F (2026-10-04): «Descargar PDF» desde el panel (editor o superior).
// El PDF se genera en segundo plano en el motor de render aislado (Contabo 2):
// cada hoja tal cual se ve en el lector, con los hotspots como enlaces
// clicables, los videos como miniatura y las galerias en su primera imagen.
// Mismo contenido = mismo PDF (se reutiliza al instante).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import Icon from '../common/Icon';

const fmtSize = (b) => (!b ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const STATUS = { queued: 'En cola', running: 'Generando…', done: 'Listo', failed: 'Error' };

export default function PdfExportPanel({ pub, compact = false }) {
  const [info, setInfo] = useState(null);
  const [source, setSource] = useState(pub?.published_version_id || pub?.status === 'published' ? 'published' : 'draft');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/publications/${pub.id}/pdf`);
      setInfo(r.data);
      if (!r.data.has_published) setSource('draft');
      const active = (r.data.jobs || []).some((j) => j.status === 'queued' || j.status === 'running');
      window.clearTimeout(pollRef.current);
      if (active) pollRef.current = window.setTimeout(load, 2500);
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'No se pudo consultar las exportaciones.' });
    }
  }, [pub.id]);

  useEffect(() => { load(); return () => window.clearTimeout(pollRef.current); }, [load]);

  const generate = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post(`/api/publications/${pub.id}/pdf`, { source });
      setMsg(r.data.reused && r.data.status === 'done'
        ? { type: 'success', text: 'Ya había un PDF de este mismo contenido: puedes descargarlo.' }
        : { type: 'info', text: 'Generando el PDF… tarda unos segundos por página. Puedes seguir trabajando.' });
      await load();
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.detail || 'No se pudo iniciar la exportación.' });
    } finally { setBusy(false); }
  };

  const download = async (job) => {
    setDownloading(job.id);
    try {
      const r = await api.get(job.download_path, { responseType: 'blob' });
      const cd = r.headers['content-disposition'] || '';
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || 'revista.pdf';
      const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      setMsg({ type: 'error', text: 'No se pudo descargar el PDF.' });
    } finally { setDownloading(null); }
  };

  const jobs = info?.jobs || [];
  const hasPublished = info ? info.has_published : true;
  return (
    <div className={`pdf-export${compact ? ' pdf-export-compact' : ''}`}>
      {!compact && <h2>Descargar en PDF</h2>}
      <p className="pdf-export-help">
        Cada hoja tal cual se ve en el lector. Los hotspots (enlaces, correo, teléfono, ir a página) quedan <strong>clicables</strong> dentro del PDF;
        los videos aparecen como miniatura con enlace y las galerías con su primera imagen.
      </p>
      <div className="pdf-export-source" role="radiogroup" aria-label="Contenido a exportar">
        <label className={!hasPublished ? 'is-disabled' : ''}>
          <input type="radio" name={`pdfsrc-${pub.id}`} checked={source === 'published'} disabled={!hasPublished} onChange={() => setSource('published')} />
          <span>Versión publicada{!hasPublished && ' (aún no publicada)'}</span>
        </label>
        <label>
          <input type="radio" name={`pdfsrc-${pub.id}`} checked={source === 'draft'} onChange={() => setSource('draft')} />
          <span>Borrador actual <em>(lo último guardado en el editor)</em></span>
        </label>
      </div>
      <button type="button" className="btn-primary pdf-export-go" onClick={generate} disabled={busy}>
        <Icon name="download" size={16} style={{ marginRight: 8 }} />{busy ? 'Solicitando…' : 'Generar PDF'}
      </button>
      {msg && <div className={`pdf-export-msg pdf-export-${msg.type}`}>{msg.text}</div>}
      {jobs.length > 0 && (
        <ul className="pdf-export-jobs">
          {jobs.map((j) => (
            <li key={j.id}>
              <span className={`pdf-export-status st-${j.status}`}>{STATUS[j.status] || j.status}</span>
              <span className="pdf-export-meta">
                {j.source === 'draft' ? 'Borrador' : 'Publicada'} · {fmtDate(j.created_at)}
                {j.page_count ? ` · ${j.page_count} pág.` : ''}{j.size_bytes ? ` · ${fmtSize(j.size_bytes)}` : ''}
                {j.status === 'failed' && j.error ? ` · ${j.error}` : ''}
              </span>
              {j.status === 'done' && (
                <button type="button" className="btn-secondary" onClick={() => download(j)} disabled={downloading === j.id}>
                  {downloading === j.id ? 'Descargando…' : 'Descargar'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="pdf-export-note">Los PDF generados se guardan 30 días.</p>
    </div>
  );
}
