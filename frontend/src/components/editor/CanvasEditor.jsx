import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fabric } from 'fabric';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import { assetAPI } from '../../services/assetAPI';
import '../../styles/CanvasEditor.css';

// ─── Modal de imagen ───────────────────────────────────────────────────────────
const ImageModal = ({ onClose, onInsert }) => {
  const [tab, setTab] = useState('upload');
  const [uploading, setUploading] = useState(false);
  const [library, setLibrary] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (tab === 'library') loadLibrary();
  }, [tab]);

  const loadLibrary = async () => {
    setLoadingLib(true);
    try {
      const data = await assetAPI.list();
      setLibrary(data.assets || []);
    } catch { setError('Error cargando galería'); }
    finally { setLoadingLib(false); }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setError('');
    try {
      const result = await assetAPI.upload(file);
      onInsert(result.url); onClose();
    } catch { setError('Error al subir la imagen. Intenta de nuevo.'); }
    finally { setUploading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-image" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>🖼️ Insertar Imagen</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-tabs">
          <button className={`modal-tab ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>⬆️ Subir nueva</button>
          <button className={`modal-tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')}>📁 Mis imágenes</button>
        </div>
        <div className="modal-body">
          {error && <div className="modal-error">{error}</div>}
          {tab === 'upload' && (
            <div className="upload-area" onClick={() => fileInputRef.current?.click()}>
              {uploading ? (
                <div className="upload-progress"><div className="spinner"></div><p>Subiendo imagen...</p></div>
              ) : (
                <><div className="upload-icon">📤</div><p>Haz clic o arrastra una imagen aquí</p><small>JPG, PNG, GIF, WEBP — máx. 10MB</small></>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} disabled={uploading} />
            </div>
          )}
          {tab === 'library' && (
            <div className="library-grid">
              {loadingLib && <div className="library-loading"><div className="spinner"></div></div>}
              {!loadingLib && library.length === 0 && (
                <div className="library-empty"><p>No tienes imágenes aún.</p><p>Sube tu primera imagen en la pestaña "Subir nueva"</p></div>
              )}
              {library.map((asset, i) => (
                <div key={i} className="library-item" onClick={() => { onInsert(asset.url); onClose(); }}>
                  <img src={asset.url} alt={asset.object_name} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Panel de propiedades (texto, imagen, forma) ───────────────────────────────
const PropertiesPanel = ({ selectedObject, canvas }) => {
  const isText = selectedObject?.type === 'i-text';
  const isImage = selectedObject?.type === 'image';

  const [props, setProps] = useState({
    fontFamily: 'Arial', fontSize: 24, fill: '#000000',
    fontWeight: '400', fontStyle: 'normal',
    underline: false, linethrough: false,
    textAlign: 'left', charSpacing: 0, lineHeight: 1.16,
    left: 0, top: 0, angle: 0, opacity: 100,
    width: 0, height: 0,
    listStyle: 'none', indent: 0, columns: 1,
    hotspotUrl: '',
  });

  const [open, setOpen] = useState({ transform: true, text: true, paragraph: true, color: true, appearance: true, hotspot: false, layer: false });
  const tog = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    if (!selectedObject) return;
    const o = selectedObject;
    setProps(prev => ({
      ...prev,
      left: Math.round(o.left || 0),
      top: Math.round(o.top || 0),
      angle: Math.round(o.angle || 0),
      opacity: Math.round((o.opacity ?? 1) * 100),
      width: Math.round((o.width || 0) * (o.scaleX || 1)),
      height: Math.round((o.height || 0) * (o.scaleY || 1)),
      fill: typeof o.fill === 'string' ? o.fill : '#000000',
      hotspotUrl: o.hotspotUrl || '',
      ...(o.type === 'i-text' ? {
        fontFamily: o.fontFamily || 'Arial',
        fontSize: o.fontSize || 24,
        fontWeight: String(o.fontWeight || '400'),
        fontStyle: o.fontStyle || 'normal',
        underline: o.underline || false,
        linethrough: o.linethrough || false,
        textAlign: o.textAlign || 'left',
        charSpacing: o.charSpacing || 0,
        lineHeight: o.lineHeight || 1.16,
        indent: o.indent || 0,
        columns: o.columns || 1,
        listStyle: o.listStyle || 'none',
      } : {}),
    }));
  }, [selectedObject]);

  const apply = (key, value) => {
    if (!selectedObject || !canvas) return;
    selectedObject.set(key, value);
    canvas.renderAll();
    setProps(p => ({ ...p, [key]: value }));
  };

  const applyTransform = (key, value) => {
    if (!selectedObject || !canvas) return;
    if (key === 'width') selectedObject.set('scaleX', value / Math.max(1, selectedObject.width || 1));
    else if (key === 'height') selectedObject.set('scaleY', value / Math.max(1, selectedObject.height || 1));
    else if (key === 'opacity') selectedObject.set('opacity', value / 100);
    else selectedObject.set(key, value);
    selectedObject.setCoords();
    canvas.renderAll();
    setProps(p => ({ ...p, [key]: value }));
  };

  const toggleList = (style) => {
    if (!isText) return;
    const lines = selectedObject.text.split('\n');
    const current = selectedObject.listStyle || 'none';
    const clean = lines.map(l => l.replace(/^(•\s|\d+\.\s)/, ''));
    let newText;
    if (current === style) {
      newText = clean.join('\n');
      selectedObject.set({ text: newText, listStyle: 'none' });
      setProps(p => ({ ...p, listStyle: 'none' }));
    } else {
      newText = style === 'bullet'
        ? clean.map(l => `• ${l}`).join('\n')
        : clean.map((l, i) => `${i + 1}. ${l}`).join('\n');
      selectedObject.set({ text: newText, listStyle: style });
      setProps(p => ({ ...p, listStyle: style }));
    }
    canvas?.renderAll();
  };

  const changeIndent = (delta) => {
    const n = Math.max(0, Math.min(120, (props.indent || 0) + delta));
    selectedObject.set({ padding: n, indent: n });
    canvas?.renderAll();
    setProps(p => ({ ...p, indent: n }));
  };

  const changeLayer = (dir) => {
    if (!canvas || !selectedObject) return;
    if (dir === 'up') canvas.bringForward(selectedObject);
    if (dir === 'top') canvas.bringToFront(selectedObject);
    if (dir === 'down') canvas.sendBackwards(selectedObject);
    if (dir === 'bot') canvas.sendToBack(selectedObject);
    canvas.renderAll();
  };

  if (!selectedObject) return null;

  const FONTS = ['Arial', 'Arial Black', 'Times New Roman', 'Georgia', 'Garamond', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Impact', 'Comic Sans MS', 'Palatino', 'Book Antiqua'];
  const WEIGHTS = [{ l: 'Thin', v: '100' }, { l: 'ExtraLight', v: '200' }, { l: 'Light', v: '300' }, { l: 'Regular', v: '400' }, { l: 'Medium', v: '500' }, { l: 'SemiBold', v: '600' }, { l: 'Bold', v: '700' }, { l: 'ExtraBold', v: '800' }, { l: 'Black', v: '900' }];

  const Hd = ({ id, label }) => (
    <button className="pp-section-head" onClick={() => tog(id)}>
      <span style={{ marginRight: 6 }}>{open[id] ? '▾' : '▸'}</span>{label}
    </button>
  );

  return (
    <div className="props-panel">

      {/* POSICIÓN Y TAMAÑO */}
      <Hd id="transform" label="POSICIÓN Y TAMAÑO" />
      {open.transform && (
        <div className="pp-body">
          <div className="pp-grid2">
            {[['left', 'X'], ['top', 'Y'], ['width', 'W'], ['height', 'H']].map(([k, lbl]) => (
              <div className="pp-field" key={k}>
                <span className="pp-label">{lbl}</span>
                <input type="number" value={props[k]} onChange={e => applyTransform(k, Number(e.target.value))} />
              </div>
            ))}
          </div>
          <div className="pp-field pp-field-inline">
            <span className="pp-label">↺</span>
            <input type="number" min="-360" max="360" value={props.angle}
              onChange={e => applyTransform('angle', Number(e.target.value))} style={{ width: 72 }} />
            <span className="pp-unit">°</span>
          </div>
        </div>
      )}

      {/* CAPA */}
      <Hd id="layer" label="CAPA" />
      {open.layer && (
        <div className="pp-body">
          <label className="pp-label-block">Orden en capa</label>
          <div className="pp-btn-row">
            <button className="pp-icon-btn" title="Al frente" onClick={() => changeLayer('top')}>⏫</button>
            <button className="pp-icon-btn" title="Subir" onClick={() => changeLayer('up')}>🔼</button>
            <button className="pp-icon-btn" title="Bajar" onClick={() => changeLayer('down')}>🔽</button>
            <button className="pp-icon-btn" title="Al fondo" onClick={() => changeLayer('bot')}>⏬</button>
          </div>
        </div>
      )}

      {/* TEXTO */}
      {isText && <>
        <Hd id="text" label="TEXTO" />
        {open.text && (
          <div className="pp-body">
            <label className="pp-label-block">Tipografía</label>
            <select value={props.fontFamily} onChange={e => apply('fontFamily', e.target.value)} style={{ fontFamily: props.fontFamily }}>
              {FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
            <div className="pp-row pp-row-gap mt8">
              <div style={{ flex: 1.5 }}>
                <label className="pp-label-block">Peso</label>
                <select value={props.fontWeight} onChange={e => apply('fontWeight', e.target.value)}>
                  {WEIGHTS.map(w => <option key={w.v} value={w.v}>{w.l}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label className="pp-label-block">Estilo</label>
                <select value={props.fontStyle} onChange={e => apply('fontStyle', e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="italic">Italic</option>
                  <option value="oblique">Oblique</option>
                </select>
              </div>
            </div>
            <label className="pp-label-block mt8">Tamaño (pt)</label>
            <div className="pp-row">
              <input type="range" min="6" max="200" value={props.fontSize}
                onChange={e => apply('fontSize', parseInt(e.target.value))}
                style={{ flex: 1, accentColor: '#667eea' }} />
              <input type="number" min="6" max="200" value={props.fontSize}
                onChange={e => apply('fontSize', parseInt(e.target.value))} style={{ width: 55 }} />
            </div>
            <label className="pp-label-block mt8">Decoración</label>
            <div className="pp-btn-row">
              <button className={`pp-icon-btn ${props.underline ? 'active' : ''}`} onClick={() => apply('underline', !props.underline)} title="Subrayado"><u>U</u></button>
              <button className={`pp-icon-btn ${props.linethrough ? 'active' : ''}`} onClick={() => apply('linethrough', !props.linethrough)} title="Tachado"><s>S</s></button>
            </div>
          </div>
        )}

        {/* PÁRRAFO */}
        <Hd id="paragraph" label="PÁRRAFO" />
        {open.paragraph && (
          <div className="pp-body">
            <label className="pp-label-block">Alineación</label>
            <div className="pp-btn-row">
              {[['left', '⬅'], ['center', '↔'], ['right', '➡'], ['justify', '≡']].map(([v, ic]) => (
                <button key={v} className={`pp-icon-btn ${props.textAlign === v ? 'active' : ''}`} onClick={() => apply('textAlign', v)} title={v}>{ic}</button>
              ))}
            </div>
            <label className="pp-label-block mt8">Listas</label>
            <div className="pp-btn-row">
              <button className={`pp-icon-btn ${props.listStyle === 'bullet' ? 'active' : ''}`} onClick={() => toggleList('bullet')} title="Viñetas">•≡</button>
              <button className={`pp-icon-btn ${props.listStyle === 'numbered' ? 'active' : ''}`} onClick={() => toggleList('numbered')} title="Numeración">1≡</button>
            </div>
            <label className="pp-label-block mt8">Sangría</label>
            <div className="pp-btn-row">
              <button className="pp-icon-btn" onClick={() => changeIndent(-20)} title="Reducir">⇤</button>
              <span style={{ flex: 1, textAlign: 'center', color: '#aaa', fontSize: 11 }}>{props.indent}px</span>
              <button className="pp-icon-btn" onClick={() => changeIndent(20)} title="Aumentar">⇥</button>
            </div>
            <label className="pp-label-block mt8">Interlineado</label>
            <div className="pp-row">
              <input type="range" min="0.5" max="4" step="0.05" value={props.lineHeight}
                onChange={e => apply('lineHeight', parseFloat(e.target.value))} style={{ flex: 1, accentColor: '#667eea' }} />
              <span className="pp-unit">{props.lineHeight.toFixed(2)}</span>
            </div>
            <label className="pp-label-block mt8">Espaciado letras</label>
            <div className="pp-row">
              <input type="range" min="-100" max="800" step="5" value={props.charSpacing}
                onChange={e => apply('charSpacing', parseInt(e.target.value))} style={{ flex: 1, accentColor: '#667eea' }} />
              <span className="pp-unit">{props.charSpacing}</span>
            </div>
            <label className="pp-label-block mt8">Columnas</label>
            <div className="pp-btn-row">
              {[1, 2, 3, 4].map(n => (
                <button key={n} className={`pp-col-btn ${props.columns === n ? 'active' : ''}`}
                  onClick={() => { selectedObject.set('columns', n); canvas?.renderAll(); setProps(p => ({ ...p, columns: n })); }}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </>}

      {/* COLOR */}
      {!isImage && (
        <>
          <Hd id="color" label="COLOR" />
          {open.color && (
            <div className="pp-body">
              <label className="pp-label-block">{isText ? 'Color de texto' : 'Relleno'}</label>
              <div className="pp-row" style={{ gap: 8 }}>
                <input type="color" value={props.fill} onChange={e => apply('fill', e.target.value)}
                  style={{ width: 36, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
                <input type="text" value={props.fill}
                  onChange={e => { setProps(p => ({ ...p, fill: e.target.value })); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) apply('fill', e.target.value); }}
                  style={{ flex: 1, fontFamily: 'monospace' }} />
              </div>
            </div>
          )}
        </>
      )}

      {/* APARIENCIA */}
      <Hd id="appearance" label="APARIENCIA" />
      {open.appearance && (
        <div className="pp-body">
          <label className="pp-label-block">Opacidad</label>
          <div className="pp-row">
            <input type="range" min="0" max="100" value={props.opacity}
              onChange={e => applyTransform('opacity', parseInt(e.target.value))} style={{ flex: 1, accentColor: '#667eea' }} />
            <input type="number" min="0" max="100" value={props.opacity}
              onChange={e => applyTransform('opacity', parseInt(e.target.value))} style={{ width: 50 }} />
            <span className="pp-unit">%</span>
          </div>
        </div>
      )}

      {/* HOTSPOT */}
      <Hd id="hotspot" label="HOTSPOT" />
      {open.hotspot && (
        <div className="pp-body">
          <label className="pp-label-block">URL del enlace</label>
          <input type="url" placeholder="https://..." value={props.hotspotUrl}
            onChange={e => apply('hotspotUrl', e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 11 }} />
          <p style={{ color: '#666', fontSize: 10, margin: '4px 0 0' }}>Al publicar, el elemento será clicable y abrirá esta URL.</p>
        </div>
      )}
    </div>
  );
};

// ─── Componente principal ──────────────────────────────────────────────────────
// ARQUITECTURA: Canvas unificado por spread.
// Un solo Fabric.Canvas por spread (width = pageW×2 + gap para dobles).
// Los objetos tienen coordenadas absolutas dentro del spread.
// Al guardar: se dividen por su centro X entre página izquierda y derecha.
const CanvasEditor = () => {
  const { id, pageId } = useParams();
  const navigate = useNavigate();

  // ── Ref del canvas unificado ──────────────────────────────────────────────
  const canvasWrapperRef = useRef(null);  // DOM <div> contenedor del lienzo
  const spreadFabricRef = useRef(null);   // fabric.Canvas instance
  const spreadScaleRef = useRef(1);      // escala actual
  const spreadPageWidthRef = useRef(0);      // ancho en píxeles de UNA página
  const SPREAD_GAP = 4;              // px entre páginas

  const [publication, setPublication] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentSpreadIndex, setCurrentSpreadIndex] = useState(0);
  const [selectedObject, setSelectedObject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showImageModal, setShowImageModal] = useState(false);
  const isChangingSpreadRef = useRef(false);

  useEffect(() => { loadData(); }, [id]);

  useEffect(() => {
    if (publication && pages.length > 0 && pageId) navigateToPage(pageId);
  }, [pageId, pages, publication]);

  // Actualiza canvas cuando cambia el spread. Reset del flag SÓLO aquí.
  useEffect(() => {
    if (publication && pages.length > 0) {
      // Pequeño timeout para asegurar que el DOM `.spread-canvas-container` tiene las dimensiones correctas pintadas
      const t = setTimeout(() => {
        const spread = getCurrentSpread();
        updateCanvases(spread);
        isChangingSpreadRef.current = false;
      }, 150);
      return () => clearTimeout(t);
    }
  }, [publication, currentSpreadIndex]);

  // ── Datos ──────────────────────────────────────────────────────────────────
  const [spreadKey, setSpreadKey] = useState(Date.now()); // key dura para forzar desmontaje del contendor cada vez

  const loadData = async () => {
    try {
      setLoading(true);
      const [pubData, pagesData] = await Promise.all([
        publicationAPI.get(id),
        pageAPI.getPublicationPages(id)
      ]);
      setPublication(pubData);
      setPages(pagesData);
      setSpreadKey(Date.now());
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  };

  // ── Navegación ────────────────────────────────────────────────────────────
  const navigateToPage = (targetPageId) => {
    const pageIndex = pages.findIndex(p => p.id === targetPageId);
    if (pageIndex === -1) return;
    const page = pages[pageIndex];
    const pt = page.page_type;
    if (pt === 'cover') goToSpread(0);
    else if (pt === 'back_cover') goToSpread(getTotalSpreads() - 1);
    else goToSpread(Math.floor((pageIndex + 1) / 2));
  };

  const getSpread = (index) => {
    if (pages.length === 0) return { left: null, right: null };
    const lastSpread = Math.ceil((pages.length - 1) / 2);
    if (index === lastSpread && pages[pages.length - 1]?.page_type === 'back_cover') {
      // Contraportada siempre a la izquierda
      return { left: pages[pages.length - 1], right: null };
    }
    // Portada: índice 0, siempre a la derecha
    if (index === 0) return { left: null, right: pages[0] };

    // Spreads intermedios
    const leftIndex = (index * 2) - 1;
    const rightIndex = index * 2;
    return { left: pages[leftIndex] || null, right: pages[rightIndex] || null };
  };

  const getCurrentSpread = () => getSpread(currentSpreadIndex);
  const getTotalSpreads = () => pages.length > 0 ? Math.ceil((pages.length - 1) / 2) + 1 : 0;

  // ── Canvas: una sola instancia por spread ─────────────────────────────────
  const setupCanvasEvents = (c) => {
    c.on('selection:created', e => setSelectedObject(e.selected[0]));
    c.on('selection:updated', e => setSelectedObject(e.selected[0]));
    c.on('selection:cleared', () => setSelectedObject(null));
    // Actualizar coordenadas en el panel cuando el objeto se mueve/escala
    c.on('object:modified', e => setSelectedObject(e.target));
    c.on('object:moving', e => setSelectedObject(e.target));
    c.on('object:scaling', e => setSelectedObject(e.target));
    c.on('object:rotating', e => setSelectedObject(e.target));
  };

  const updateCanvases = (spread) => {
    if (!publication || !canvasWrapperRef.current) return;

    // Calcular dimension base tomando el 95% del area visible de la ventana para dejar márgenes
    const viewportW = window.innerWidth * 0.95;
    const viewportH = window.innerHeight * 0.95;
    const isDouble = !!(spread.left && spread.right);

    // Medidas base en px de 1 página
    const baseW = publication.page_width * 3.78;
    const baseH = publication.page_height * 3.78;

    // Si es doble, el diseño requiere el doble de ancho más la división (gap)
    const requiredW = isDouble ? (baseW * 2) + SPREAD_GAP : baseW;
    const requiredH = baseH;

    // Factor de escala: qué tan grande o pequeño debe ser el documento para caber
    const scaleW = viewportW / requiredW;
    const scaleH = viewportH / requiredH;
    const scale = Math.min(scaleW, scaleH, 1); // Nunca escalar más del tamaño original (opcional)

    const pageW = baseW * scale;
    const pageH = baseH * scale;

    spreadScaleRef.current = scale;
    spreadPageWidthRef.current = pageW;
    const totalW = isDouble ? pageW * 2 + SPREAD_GAP : pageW;
    const rightOffset = isDouble ? pageW + SPREAD_GAP : 0;

    // ── Destruir instancia anterior por completo para forzar un render limpio ──
    const oldC = spreadFabricRef.current;
    if (oldC) {
      try {
        oldC.off(); // Quitar eventos
        oldC.dispose();
      } catch (err) {}
    }
    spreadFabricRef.current = null;

    // ── Inyectar elemento canvas nativo quemado para que React no lo sobreceda ──
    const wrapper = canvasWrapperRef.current;
    wrapper.innerHTML = ''; // Eliminar todo rastro del virtual DOM manipulado por FabricJS

    const rawCanvas = document.createElement('canvas');
    rawCanvas.id = 'fabric-canvas-spread';
    rawCanvas.width = totalW;
    rawCanvas.height = pageH;
    // Forzar en el estilo explícito
    rawCanvas.style.width = `${totalW}px`;
    rawCanvas.style.height = `${pageH}px`;
    wrapper.appendChild(rawCanvas);

    // Crear nueva instancia de Fabric acoplada al nuevo DOM
    let c;
    try {
      c = new fabric.Canvas(rawCanvas, {
        width: totalW, height: pageH,
        backgroundColor: '#ffffff',
        renderOnAddRemove: false,
      });
      spreadFabricRef.current = c;
      setupCanvasEvents(c);
    } catch (err) {
      console.error('Error creando canvas limpio:', err);
      return;
    }

    // ── Cargar páginas: mezclar JSON con offset para página derecha ───────
    const mergeAndLoad = () => {
      const merged = {
        version: '5.3.0',
        objects: [],
        background: '#ffffff',
      };

      const addObjects = (content, offsetX) => {
        if (!content?.objects?.length) return;
        content.objects.forEach(obj => {
          merged.objects.push(offsetX > 0 ? { ...obj, left: (obj.left || 0) + offsetX } : obj);
        });
      };

      addObjects(spread.left?.content, 0);
      addObjects(spread.right?.content, rightOffset);

      c.loadFromJSON(merged, () => {
        // Línea guía de separación de páginas (no exportable, no seleccionable)
        if (isDouble) {
          const sep = new fabric.Line([pageW + SPREAD_GAP / 2, 0, pageW + SPREAD_GAP / 2, pageH], {
            stroke: '#cccccc', strokeWidth: 1, strokeDashArray: [4, 4],
            selectable: false, evented: false, excludeFromExport: true,
            data: { _type: 'page-separator' },
          });
          c.add(sep);
          c.sendToBack(sep);
        }
        c.renderOnAddRemove = true;
        c.renderAll();
      });
    };

    mergeAndLoad();
  };

  // ── Guardado: dividir objetos por su centro X ─────────────────────────────
  const CUSTOM_FABRIC_PROPS = ['pageOriginId', 'linkUrl', 'customId', 'hotspotData', 'hotspotUrl', 'listStyle', 'indent', 'columns'];

  const saveContent = async (showAlert = true) => {
    const spread = getCurrentSpread();
    const c = spreadFabricRef.current;
    if (!c) return;

    const pageW = spreadPageWidthRef.current;
    const rightOffset = (spread.left && spread.right) ? pageW + SPREAD_GAP : 0;

    // Filtrar separadores de página
    const allObjects = c.getObjects().filter(obj => obj.data?._type !== 'page-separator');

    const leftObjs = [];
    const rightObjs = [];

    allObjects.forEach(obj => {
      const json = obj.toObject(CUSTOM_FABRIC_PROPS);
      if (rightOffset > 0) {
        const centerX = (obj.left || 0) + ((obj.width || 0) * (obj.scaleX || 1)) / 2;
        if (centerX < rightOffset) {
          leftObjs.push(json);
        } else {
          rightObjs.push({ ...json, left: (json.left || 0) - rightOffset });
        }
      } else {
        leftObjs.push(json);
      }
    });

    const base = { version: '5.3.0', background: '#ffffff' };

    try {
      const updates = [];
      if (spread.left && spread.right) {
        updates.push(pageAPI.update(spread.left.id, { content: { ...base, objects: leftObjs } }));
        updates.push(pageAPI.update(spread.right.id, { content: { ...base, objects: rightObjs } }));
      } else if (spread.left) {
        updates.push(pageAPI.update(spread.left.id, { content: { ...base, objects: leftObjs } }));
      } else if (spread.right) {
        updates.push(pageAPI.update(spread.right.id, { content: { ...base, objects: leftObjs } }));
      }
      await Promise.all(updates);
      if (showAlert) alert('✅ Guardado correctamente');
    } catch (err) {
      console.error('Error saving:', err);
      if (showAlert) alert('❌ Error al guardar');
    }
  };

  // ── Navegación entre spreads ───────────────────────────────────────────────
  const [isSavingSpread, setIsSavingSpread] = useState(false);

  const goToSpread = async (index) => {
    const total = getTotalSpreads();
    // Validar si index es igual al actual para no volver a renderizar por gusto
    if (index === currentSpreadIndex) return;

    if (index >= 0 && index < total && !isChangingSpreadRef.current) {
      isChangingSpreadRef.current = true;
      setIsSavingSpread(true);
      try {
        await saveContent(false); // Guardar asíncrono sin alert
        setSelectedObject(null);
        setCurrentSpreadIndex(index);
        setSpreadKey(Date.now()); // forzar regeneración del dom div wrapper
      } finally {
        setIsSavingSpread(false);
        // isChangingSpreadRef.current se liberará en el useEffect (línea ~406) luego de updateCanvases
      }
    }
  };

  // ── Herramientas de edición ────────────────────────────────────────────────
  const getCanvas = () => spreadFabricRef.current;

  const addText = () => {
    const c = getCanvas(); if (!c) return;
    const text = new fabric.IText('Haz doble clic para editar', {
      left: 100, top: 100, fontSize: 24, fontFamily: 'Arial', fill: '#000000'
    });
    c.add(text); c.setActiveObject(text); c.renderAll();
  };

  const addRectangle = () => {
    const c = getCanvas(); if (!c) return;
    const rect = new fabric.Rect({ left: 100, top: 100, width: 200, height: 150, fill: '#667eea', stroke: '#5568d3', strokeWidth: 2 });
    c.add(rect); c.setActiveObject(rect); c.renderAll();
  };

  const addCircle = () => {
    const c = getCanvas(); if (!c) return;
    const circle = new fabric.Circle({ left: 100, top: 100, radius: 75, fill: '#764ba2', stroke: '#667eea', strokeWidth: 2 });
    c.add(circle); c.setActiveObject(circle); c.renderAll();
  };

  const insertImageFromURL = (url) => {
    const c = getCanvas(); if (!c) { console.error('No hay canvas activo'); return; }
    
    // Convertir una posible URL relativa en absoluta para que Fabric no de fallo en render
    const fullUrl = url.startsWith('/') || url.startsWith('http') ? url : `http://${window.location.host}${url}`;
    
    fabric.Image.fromURL(fullUrl, (img) => {
      if (!img) {
         console.error('La imagen no devolvió resultado o tuvo un error CORS.');
         return;
      }
      
      const maxW = c.width * 0.4;
      const maxH = c.height * 0.4;
      if (img.width > maxW || img.height > maxH) {
        img.scale(Math.min(maxW / img.width, maxH / img.height));
      }
      
      img.set({
        left: (c.width / 2) - (img.getScaledWidth() / 2),
        top: (c.height / 2) - (img.getScaledHeight() / 2),
        crossOrigin: 'anonymous', // Prevenir canvas tinting
      });
      c.add(img); c.setActiveObject(img); c.renderAll();
    }, { crossOrigin: 'anonymous' });
  };

  const deleteSelected = () => {
    const c = getCanvas(); if (!c) return;
    const obj = c.getActiveObject();
    if (obj && obj.data?._type !== 'page-separator') { c.remove(obj); setSelectedObject(null); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading">Cargando editor...</div>;
  if (!publication || pages.length === 0) return <div className="loading">Preparando editor...</div>;

  const spread = getCurrentSpread();
  const totalSpreads = getTotalSpreads();

  const pageLabel = spread.left && spread.right
    ? `Págs. ${spread.left.page_number}-${spread.right.page_number}`
    : spread.left ? `Pág. ${spread.left.page_number}`
      : spread.right ? `Pág. ${spread.right.page_number}`
        : '';

  return (
    <div className="canvas-editor-container">

      {/* Header */}
      <div className="editor-header">
        <div className="header-left">
          <button onClick={() => navigate(`/publications/${id}/view`)} className="btn-back">← Volver</button>
          <h2>{publication.title}</h2>
          <span className="page-info">{pageLabel}</span>
        </div>
        <div className="header-right">
          <button onClick={saveContent} className="btn-save">💾 Guardar</button>
        </div>
      </div>

      {/* Sidebar izquierdo */}
      <div className="editor-sidebar">
        <div className="toolbar">
          <h3>HERRAMIENTAS</h3>
          <button onClick={addText} className="tool-btn"><span className="tool-icon">T</span><span className="tool-label">Texto</span></button>
          <button onClick={addRectangle} className="tool-btn"><span className="tool-icon">▭</span><span className="tool-label">Rectángulo</span></button>
          <button onClick={addCircle} className="tool-btn"><span className="tool-icon">●</span><span className="tool-label">Círculo</span></button>
          <button onClick={() => setShowImageModal(true)} className="tool-btn"><span className="tool-icon">🖼️</span><span className="tool-label">Imagen</span></button>
          {selectedObject && (
            <>
              <hr />
              <button onClick={deleteSelected} className="tool-btn tool-btn-danger">
                <span className="tool-icon">🗑️</span><span className="tool-label">Eliminar</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas central — UN SOLO canvas por spread */}
      <div className={`editor-canvas-area ${isSavingSpread ? 'saving-overlay' : ''}`}>
        <div className="canvas-spread-wrapper">
          {isSavingSpread && (
            <div className="saving-spinner-overlay" style={{ position: 'absolute', zIndex: 9999, background: 'rgba(44, 62, 80, 0.7)', padding: '20px 40px', borderRadius: '10px', color: '#1abc9c', fontSize: '1.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
              <div className="spinner"></div>
              <span>Guardando hoja actual...</span>
            </div>
          )}
          {/* Contenedor del spread unificado forzado por clave dinámica key={spreadKey} para remontaje completo */}
          <div className="spread-canvas-container" key={spreadKey}>
            {/* Etiquetas de página SOBRE el canvas */}
            {spread.left && spread.right && (
              <div className="spread-labels">
                <div className="spread-label-left">Pág. {spread.left.page_number}</div>
                <div className="spread-label-right">Pág. {spread.right.page_number}</div>
              </div>
            )}
            {/* Etiqueta para página única */}
            {(!spread.left || !spread.right) && (
              <div className="page-label">
                {spread.right ? `Pág. ${spread.right.page_number}` : spread.left ? `Pág. ${spread.left.page_number}` : ''}
              </div>
            )}

            {/* Div estático para incrustar el <canvas> que manejará Fabric */}
            <div ref={canvasWrapperRef} className="inner-fabric-wrapper" />
          </div>
        </div>

        <div className="canvas-nav-controls">
          <button onClick={() => goToSpread(currentSpreadIndex - 1)} disabled={currentSpreadIndex === 0} className="btn-nav">← Anterior</button>
          <span className="spread-info">Spread {currentSpreadIndex + 1} de {totalSpreads}</span>
          <button onClick={() => goToSpread(currentSpreadIndex + 1)} disabled={currentSpreadIndex >= totalSpreads - 1} className="btn-nav">Siguiente →</button>
        </div>
      </div>

      {/* Panel derecho de propiedades */}
      {selectedObject && (
        <div className="editor-sidebar-right">
          <PropertiesPanel selectedObject={selectedObject} canvas={spreadFabricRef.current} />
        </div>
      )}

      {/* Barra de páginas */}
      <div className="editor-pages-bar">
        {pages.map((page, index) => (
          <div
            key={page.id}
            className={`page-thumb ${(spread.left?.id === page.id || spread.right?.id === page.id) ? 'active' : ''}`}
            onClick={() => {
              const pt = page.page_type;
              if (pt === 'cover') goToSpread(0);
              else if (pt === 'back_cover') goToSpread(totalSpreads - 1);
              else goToSpread(Math.floor((index + 1) / 2));
            }}
          >
            <div className="thumb-number">{page.page_number}</div>
          </div>
        ))}
      </div>

      {/* Modal imagen */}
      {showImageModal && (
        <ImageModal onClose={() => setShowImageModal(false)} onInsert={insertImageFromURL} />
      )}
    </div>
  );
};

export default CanvasEditor;
