import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import api from '../services/api';
import '../styles/Stats.css';

// Estadisticas de lectura (lote L6). Sin cookies: los datos son agregados y anonimos.
// /publications/:id/estadisticas -> una edicion · /estadisticas -> todas las ediciones.

const RANGES = [{ d: 7, l: '7 días' }, { d: 30, l: '30 días' }, { d: 90, l: '90 días' }, { d: 365, l: '12 meses' }];
const METRICS = [
  { k: 'opens', l: 'Lecturas', u: '' },
  { k: 'views', l: 'Páginas vistas', u: '' },
  { k: 'time_ms', l: 'Tiempo de lectura', u: 'min' },
];
const SRC = { qr: 'Código QR', wa: 'WhatsApp', fb: 'Facebook', ig: 'Instagram', tw: 'X / Twitter', mail: 'Correo', sms: 'SMS', web: 'Web', tg: 'Telegram', li: 'LinkedIn' };
const DEVICE = { mobile: 'Móvil', tablet: 'Tableta', desktop: 'Ordenador' };
const BROWSER = { chrome: 'Chrome', safari: 'Safari', firefox: 'Firefox', edge: 'Edge', opera: 'Opera', samsung: 'Samsung Internet', otro: 'Otro' };
const OS = { ios: 'iOS', android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', otro: 'Otro' };
const ACT = { url: 'Enlaces a webs', email: 'Correos', phone: 'Teléfonos', page: 'Saltos de página' };

const nf = new Intl.NumberFormat('es');
const fmtMs = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
};
const flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐');
let regionNames = null;
const countryName = (cc) => {
  try { regionNames = regionNames || new Intl.DisplayNames(['es'], { type: 'region' }); return regionNames.of(cc) || cc; } catch { return cc; }
};
const niceMax = (v) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v) || v;
};
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short' });

// ---- lista de barras horizontales (ranking) -------------------------------------------------
const BarList = ({ items, label = (k) => k, total }) => {
  if (!items?.length) return <p className="st-empty-small">Sin datos todavía.</p>;
  const max = Math.max(...items.map((i) => i.n));
  const sum = total ?? items.reduce((a, i) => a + i.n, 0);
  return (
    <ul className="st-bars">
      {items.map((i) => (
        <li key={i.key} title={`${label(i.key)}: ${nf.format(i.n)} (${sum ? Math.round((100 * i.n) / sum) : 0} %)`}>
          <span className="st-bars-label">{label(i.key)}</span>
          <span className="st-bars-track"><span style={{ width: `${Math.max(2, (100 * i.n) / max)}%` }} /></span>
          <span className="st-bars-n">{nf.format(i.n)}<small> {sum ? Math.round((100 * i.n) / sum) : 0}%</small></span>
        </li>
      ))}
    </ul>
  );
};

// ---- serie diaria (columnas) con tooltip -----------------------------------------------------
const Series = ({ series, metric }) => {
  const [hover, setHover] = useState(null);
  const W = 860; const H = 240; const L = 44; const R = 8; const T = 12; const B = 28;
  const vals = series.map((s) => (metric === 'time_ms' ? s.time_ms / 60000 : s[metric]));
  const max = niceMax(Math.max(1, ...vals));
  const bw = (W - L - R) / series.length;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const fmtV = (v) => (metric === 'time_ms' ? `${v.toLocaleString('es', { maximumFractionDigits: 1 })} min` : nf.format(v));
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W - L;
    setHover(Math.max(0, Math.min(series.length - 1, Math.floor(x / bw))));
  };
  const step = Math.ceil(series.length / 6);
  return (
    <div className="st-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="st-chart" role="img" aria-label={`Gráfico diario de ${METRICS.find((m) => m.k === metric).l.toLowerCase()}`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={(e) => onMove(e.touches[0] && { currentTarget: e.currentTarget, clientX: e.touches[0].clientX })}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="st-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="st-axis">{t >= 10 ? Math.round(t) : t.toLocaleString('es', { maximumFractionDigits: 1 })}</text>
          </g>
        ))}
        {vals.map((v, i) => {
          const h = Math.max(v > 0 ? 2 : 0, (H - T - B) - (y(v) - T));
          const w = Math.max(1, bw - Math.min(2, bw * 0.25));
          return <rect key={series[i].day} x={L + i * bw + (bw - w) / 2} y={H - B - h} width={w} height={h} rx={Math.min(3, w / 2)} className={hover === i ? 'st-col is-hover' : 'st-col'} />;
        })}
        {series.map((s, i) => (i % step === 0 || i === series.length - 1) && (
          <text key={s.day} x={L + i * bw + bw / 2} y={H - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} className="st-axis">{dayLabel(s.day)}</text>
        ))}
        {hover != null && <line x1={L + hover * bw + bw / 2} x2={L + hover * bw + bw / 2} y1={T} y2={H - B} className="st-cross" />}
      </svg>
      {hover != null && (
        <div className="st-tip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }} role="status">
          <strong>{new Date(`${series[hover].day}T00:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'long' })}</strong>
          <span>{fmtV(vals[hover])}</span>
        </div>
      )}
    </div>
  );
};

const Hours = ({ utc }) => {
  const off = -new Date().getTimezoneOffset() / 60;       // horas respecto a UTC del navegador
  const local = Array.from({ length: 24 }, (_, h) => utc[(((h - off) % 24) + 24) % 24]);
  const max = Math.max(1, ...local);
  return (
    <div className="st-hours" role="img" aria-label="Lecturas por hora del día">
      {local.map((n, h) => (
        <div key={h} className="st-hour" title={`${String(h).padStart(2, '0')}:00 — ${nf.format(n)} lecturas`}>
          <span style={{ height: `${Math.max(n ? 4 : 0, (100 * n) / max)}%` }} />
          {h % 3 === 0 && <small>{h}</small>}
        </div>
      ))}
    </div>
  );
};

const Kpi = ({ label, value, hint }) => (
  <div className="st-kpi"><span className="st-kpi-v">{value}</span><span className="st-kpi-l">{label}</span>{hint && <span className="st-kpi-h">{hint}</span>}</div>
);

const Card = ({ title, children, wide }) => <section className={`st-card${wide ? ' st-wide' : ''}`}><h3>{title}</h3>{children}</section>;

const EditionStats = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState('opens');
  const [table, setTable] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    api.get(id ? `/api/publications/${id}/stats` : '/api/stats/overview', { params: { days } })
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(e.response?.status === 404 ? 'No se encontró la edición.' : 'No se pudieron cargar las estadísticas.'); });
    return () => { alive = false; };
  }, [id, days]);

  const t = data?.totals;
  const empty = t && t.opens === 0 && t.page_views === 0;
  const sources = useMemo(() => (data?.sources || []).map((s) => ({ ...s })), [data]);

  return (
    <div className="st-page">
      <div className="st-head">
        <div>
          <p className="st-crumb"><Link to="/collections">Colecciones</Link>{id && <> · <button type="button" className="st-link" onClick={() => navigate(-1)}>volver</button></>}</p>
          <h1>Estadísticas{data?.publication ? <span> · {data.publication.title}</span> : <span> · todas las ediciones</span>}</h1>
          <p className="st-sub">Lecturas anónimas, sin cookies ni datos personales. {id ? <Link to="/estadisticas">Ver todas las ediciones</Link> : null}</p>
        </div>
        <div className="st-ranges" role="group" aria-label="Periodo">
          {RANGES.map((r) => <button key={r.d} type="button" className={days === r.d ? 'is-on' : ''} onClick={() => setDays(r.d)}>{r.l}</button>)}
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {!data && !error && <div className="st-loading">Cargando estadísticas…</div>}

      {data && (
        <>
          <div className="st-kpis">
            <Kpi label="Lecturas" value={nf.format(t.opens)} hint="aperturas únicas por día" />
            <Kpi label="Páginas vistas" value={nf.format(t.page_views)} hint={`${t.pages_per_read} por lectura`} />
            <Kpi label="Tiempo medio" value={fmtMs(t.avg_time_ms)} hint="por lectura" />
            <Kpi label="Clics en enlaces" value={nf.format(t.clicks)} />
            <Kpi label="Países" value={nf.format(t.countries)} />
            {data.publication && <Kpi label="Lecturas históricas" value={nf.format(data.publication.views_count)} hint="desde el inicio" />}
          </div>

          {empty && (
            <div className="st-empty">
              <strong>Todavía no hay lecturas en este periodo.</strong>
              <p>Los datos aparecen en cuanto alguien abre la revista desde el kiosco, un enlace, un QR o una web donde esté insertada.</p>
            </div>
          )}

          <Card title="Evolución diaria" wide>
            <div className="st-toolbar">
              <div className="st-ranges" role="group" aria-label="Métrica">
                {METRICS.map((m) => <button key={m.k} type="button" className={metric === m.k ? 'is-on' : ''} onClick={() => setMetric(m.k)}>{m.l}</button>)}
              </div>
              <button type="button" className="st-link" onClick={() => setTable((v) => !v)}>{table ? 'Ver gráfico' : 'Ver como tabla'}</button>
            </div>
            {table ? (
              <div className="st-table-wrap"><table className="st-table">
                <thead><tr><th>Día</th><th>Lecturas</th><th>Páginas vistas</th><th>Tiempo</th></tr></thead>
                <tbody>{[...data.series].reverse().map((s) => <tr key={s.day}><td>{dayLabel(s.day)}</td><td>{nf.format(s.opens)}</td><td>{nf.format(s.views)}</td><td>{fmtMs(s.time_ms)}</td></tr>)}</tbody>
              </table></div>
            ) : <Series series={data.series} metric={metric} />}
          </Card>

          <div className="st-grid-cards">
            <Card title="Países"><BarList items={data.countries} label={(k) => `${flag(k)}  ${countryName(k)}`} /></Card>
            <Card title="Dispositivos"><BarList items={data.devices} label={(k) => DEVICE[k] || k} /></Card>
            <Card title="Origen del enlace"><BarList items={sources} label={(k) => SRC[k] || k} /></Card>
            <Card title="Webs de referencia"><BarList items={data.referrers} /></Card>
            <Card title="Webs donde está insertada"><BarList items={data.embeds} /></Card>
            <Card title="Navegadores"><BarList items={data.browsers} label={(k) => BROWSER[k] || k} /></Card>
            <Card title="Sistemas"><BarList items={data.systems} label={(k) => OS[k] || k} /></Card>
            <Card title="Clics"><BarList items={data.click_acts} label={(k) => ACT[k] || k} /><h4>Webs más visitadas desde la revista</h4><BarList items={data.click_targets} /></Card>
            <Card title="Hora del día" wide><Hours utc={data.hourly_utc} /><p className="st-note">Hora local de tu navegador.</p></Card>
          </div>

          {data.pages && (
            <Card title="Páginas" wide>
              {data.pages.length === 0 ? <p className="st-empty-small">Sin datos todavía.</p> : (
                <div className="st-table-wrap"><table className="st-table">
                  <thead><tr><th>Página</th><th>Vistas</th><th>Lectores</th><th>Alcance</th><th>Tiempo medio</th></tr></thead>
                  <tbody>{data.pages.map((p) => (
                    <tr key={p.page}><td>{p.page}</td><td>{nf.format(p.views)}</td><td>{nf.format(p.readers)}</td>
                      <td><span className="st-reach"><span style={{ width: `${Math.min(100, p.reach)}%` }} /></span> {p.reach} %</td><td>{p.avg_ms ? fmtMs(p.avg_ms) : '—'}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              <p className="st-note">Alcance: porcentaje de lecturas que llegaron a esa página.</p>
            </Card>
          )}

          {data.editions && (
            <Card title="Ediciones" wide>
              <div className="st-table-wrap"><table className="st-table">
                <thead><tr><th>Edición</th><th>Colección</th><th>Lecturas</th><th>Páginas vistas</th><th>Tiempo medio</th><th>Histórico</th><th></th></tr></thead>
                <tbody>{data.editions.map((e) => (
                  <tr key={e.id}><td>{e.title}</td><td>{e.collection}</td><td>{nf.format(e.opens)}</td><td>{nf.format(e.page_views)}</td><td>{fmtMs(e.avg_time_ms)}</td><td>{nf.format(e.lifetime)}</td>
                    <td><Link to={`/publications/${e.id}/estadisticas`}>Ver</Link></td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          )}

          <p className="st-foot">
            Privacidad: no se usan cookies ni se guarda la IP. El lector se identifica con un código diario que no permite seguirlo entre días, y se respeta «No rastrear» (DNT / GPC).
            País por IP: <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">IP Geolocation by DB-IP</a>.
          </p>
        </>
      )}
    </div>
  );
};

export default EditionStats;
