import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import '../../styles/FlipBook.css';

// ---------------------------------------------------------------------------
// FlipBook -- Lote FLIP-2 (28-sep-2026)
//
// Sustituye el efecto de UX-12 (todo el spread giraba como una puerta hasta
// quedar de canto, se cambiaba el contenido y volvía; además las páginas
// nuevas se cargaban DESPUÉS del giro, así que se veía una hoja gris y luego
// "Cargando página…"). Carlos: "no tiene la impresión de hojas de revista,
// solo el sonido".
//
// Modelo nuevo, como una revista física:
//   - Libro de 2 huecos (izquierdo | derecho) unidos por el lomo. La portada
//     va en el hueco DERECHO y la contraportada en el IZQUIERDO; el libro se
//     desplaza medio ancho para que queden centradas (igual que Issuu/Joomag).
//   - Al avanzar, SOLO la hoja derecha gira sobre el lomo. Esa hoja tiene dos
//     caras reales: el anverso es la página derecha actual y el reverso es la
//     página izquierda del destino. Debajo ya está la página derecha del
//     destino. Al retroceder, lo mismo en espejo con la hoja izquierda.
//   - Las 4 páginas implicadas se montan y precargan ANTES de empezar a girar
//     (estado "prep", visualmente idéntico al reposo), así nunca se ve una
//     hoja vacía ni "Cargando página…" durante el giro.
//   - Sombras dinámicas: sombra proyectada sobre la página que se descubre y
//     sobre la que se va a cubrir (siguiendo el borde proyectado de la hoja
//     con la misma perspectiva del CSS), brillo/curvatura sobre la propia
//     hoja y sombra de lomo.
//   - Arrastre con ratón o dedo desde el borde exterior (la hoja sigue al
//     puntero; si se suelta antes de ~30 % vuelve a su sitio).
//   - Modo "single" (móvil / vista simple): una sola página; la hoja actual
//     gira sobre su borde izquierdo y descubre la siguiente.
//
// El progreso de la animación NO pasa por React: se escribe en variables CSS
// (--fb-angle, --fb-s, --fb-er, --fb-el, --fb-shift, --fb-backfade) del nodo
// del libro con requestAnimationFrame, para no re-renderizar los Stage de
// Konva 60 veces por segundo.
// ---------------------------------------------------------------------------

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const nextFrames = (n = 2) => new Promise((resolve) => {
  const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
  tick(n);
});
const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Qué página ocupa cada hueco en una vista dada.
export function slotsOf(view, idx, mode) {
  if (!view) return { L: null, R: null, C: null };
  if (mode === 'single') return { C: view.left || view.right || null };
  if (view.right) return { L: view.left, R: view.right };
  if (idx === 0) return { L: null, R: view.left }; // portada: a la derecha del lomo
  return { L: view.left, R: null }; // contraportada / interior suelto: a la izquierda
}

function restShiftOf(slots, mode, w) {
  if (mode === 'single') return 0;
  if (slots.L && !slots.R) return w / 2;
  if (!slots.L && slots.R) return -w / 2;
  return 0;
}

// Capas visibles (página + papel) según estado de reposo o de giro.
function computeLayers(views, index, flip, mode) {
  if (!flip) {
    const s = slotsOf(views[index], index, mode);
    if (mode === 'single') return [{ page: s.C, role: 'base', slot: 'center' }];
    return [
      { page: s.L, role: 'base', slot: 'left' },
      { page: s.R, role: 'base', slot: 'right' },
    ];
  }
  const A = slotsOf(views[flip.from], flip.from, mode);
  const B = slotsOf(views[flip.to], flip.to, mode);
  if (mode === 'single') {
    const leafPage = flip.dir === 'next' ? A.C : B.C;
    const basePage = flip.dir === 'next' ? B.C : A.C;
    return [
      { page: basePage, role: 'base', slot: 'center' },
      { page: leafPage, role: 'front', slot: 'center', blankIfEmpty: true },
      { page: null, role: 'back', slot: 'center', blankIfEmpty: true },
    ];
  }
  if (flip.dir === 'next') {
    return [
      { page: A.L, role: 'base', slot: 'left' },
      { page: B.R, role: 'base', slot: 'right' },
      { page: A.R, role: 'front', slot: 'right', blankIfEmpty: true },
      { page: B.L, role: 'back', slot: 'right', blankIfEmpty: true },
    ];
  }
  return [
    { page: B.L, role: 'base', slot: 'left' },
    { page: A.R, role: 'base', slot: 'right' },
    { page: A.L, role: 'front', slot: 'left', blankIfEmpty: true },
    { page: B.R, role: 'back', slot: 'left', blankIfEmpty: true },
  ];
}

export function pagesOfView(view) {
  return [view?.left, view?.right].filter(Boolean);
}

const FlipBook = forwardRef(function FlipBook(
  {
    views,
    index,
    onIndexChange,
    mode = 'spread', // 'spread' | 'single'
    pageWidth,
    pageHeight,
    renderPage,
    getPageKey = (p) => p.id ?? `n${p.page_number}`,
    duration = 820,
    onFlipStart,
    onBusyChange,
    preparePages, // (pages[]) => Promise -- datos + imágenes listos antes de girar
    dragEnabled = true,
    className = '',
    style,
  },
  ref,
) {
  const bookRef = useRef(null);
  const [flip, setFlip] = useState(null); // { from, to, dir }
  const flipRef = useRef(null);
  const indexRef = useRef(index);
  const busyRef = useRef(false);
  const pendingRef = useRef(null);
  const tokenRef = useRef(0);
  const rafRef = useRef(0);
  const progressRef = useRef(0);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [hoverZone, setHoverZone] = useState(null);

  // Props "vivas" para los callbacks asíncronos.
  const live = useRef({});
  live.current = { views, mode, pageWidth, duration, onIndexChange, onFlipStart, onBusyChange, preparePages };

  const w = pageWidth;
  const bookW = mode === 'single' ? w : w * 2;
  const perspective = Math.round(Math.max(1600, w * 4.2));

  const setBusy = (b) => {
    if (busyRef.current === b) return;
    busyRef.current = b;
    live.current.onBusyChange?.(b);
  };

  // --- Progreso -> variables CSS -------------------------------------------
  const applyProgress = useCallback((p, f) => {
    const node = bookRef.current;
    if (!node || !f) return;
    const { mode: m, pageWidth: pw, views: vs } = live.current;
    const single = m === 'single';
    const angle = single
      ? (f.dir === 'next' ? -180 * p : -180 * (1 - p))
      : (f.dir === 'next' ? -180 * p : 180 * p);
    const a = (Math.abs(angle) * Math.PI) / 180;
    const s = Math.sin(a);
    // Borde libre de la hoja proyectado con la misma perspectiva que el CSS
    // (perspective-origin = centro del libro): así la sombra arranca justo
    // donde el ojo ve terminar la hoja.
    const W = single ? pw : pw * 2;
    const hinge = single ? 0 : pw;
    const leafOnLeft = !single && f.dir === 'prev';
    const d = Math.max(1600, pw * 4.2);
    const xEdge = hinge + (leafOnLeft ? -1 : 1) * pw * Math.cos(a);
    const z = pw * Math.sin(a);
    const ox = W / 2;
    const X = ox + ((xEdge - ox) * d) / Math.max(1, d - z);
    const er = clamp01((X - hinge) / pw);
    const el = clamp01((hinge - X) / pw);
    const shiftA = restShiftOf(slotsOf(vs[f.from], f.from, m), m, pw);
    const shiftB = restShiftOf(slotsOf(vs[f.to], f.to, m), m, pw);
    const shift = shiftA + (shiftB - shiftA) * p;
    const backfade = Math.abs(angle) <= 90 ? 1 : 1 - ((Math.abs(angle) - 90) / 90) * 0.9;
    const st = node.style;
    st.setProperty('--fb-angle', angle.toFixed(3));
    st.setProperty('--fb-s', s.toFixed(4));
    st.setProperty('--fb-er', er.toFixed(4));
    st.setProperty('--fb-el', el.toFixed(4));
    st.setProperty('--fb-shift', `${shift.toFixed(2)}px`);
    st.setProperty('--fb-backfade', backfade.toFixed(3));
  }, []);

  const clearProgressVars = () => {
    const st = bookRef.current?.style;
    if (!st) return;
    ['--fb-angle', '--fb-s', '--fb-er', '--fb-el', '--fb-shift', '--fb-backfade'].forEach((v) => st.removeProperty(v));
  };

  const animate = (from, to, ms, f, ease = easeInOut) => new Promise((resolve) => {
    cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const step = (now) => {
      const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
      const p = from + (to - from) * ease(t);
      progressRef.current = p;
      applyProgress(p, f);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else resolve();
    };
    rafRef.current = requestAnimationFrame(step);
  });

  // Monta las páginas del destino en estado "prep" (idéntico al reposo).
  const prepareFlip = async (to) => {
    const { views: vs, preparePages: prep } = live.current;
    const from = indexRef.current;
    const f = { from, to, dir: to > from ? 'next' : 'prev' };
    const token = ++tokenRef.current;
    setBusy(true);
    if (prep) {
      try { await prep([...pagesOfView(vs[to]), ...pagesOfView(vs[from])]); } catch { /* nunca bloquea */ }
    }
    if (token !== tokenRef.current) return null;
    applyProgress(0, f);
    flipRef.current = f;
    setFlip(f);
    await nextFrames(2);
    if (token !== tokenRef.current) return null;
    return f;
  };

  const finish = (f, committed) => {
    cancelAnimationFrame(rafRef.current);
    flipRef.current = null;
    progressRef.current = 0;
    if (committed) indexRef.current = f.to;
    setFlip(null);
    if (committed) live.current.onIndexChange?.(f.to);
    setBusy(false);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending != null && pending !== indexRef.current) {
      // clic repetido durante el giro: se encadena un giro más rápido
      window.setTimeout(() => runFlip(pending, 0.6), 0); // eslint-disable-line no-use-before-define
    }
  };

  const runFlip = async (target, speed = 1) => {
    const { views: vs, duration: dur } = live.current;
    if (target == null || target < 0 || target >= vs.length || target === indexRef.current) return;
    if (busyRef.current) { pendingRef.current = target; return; }
    if (prefersReducedMotion()) {
      live.current.onFlipStart?.(target > indexRef.current ? 'next' : 'prev');
      indexRef.current = target;
      live.current.onIndexChange?.(target);
      return;
    }
    const f = await prepareFlip(target);
    if (!f) return;
    live.current.onFlipStart?.(f.dir);
    await animate(0, 1, dur * speed, f);
    if (flipRef.current !== f) return;
    finish(f, true);
  };

  useImperativeHandle(ref, () => ({
    flipTo: (i) => runFlip(i),
    next: () => runFlip((busyRef.current && pendingRef.current != null ? pendingRef.current : indexRef.current) + 1),
    prev: () => runFlip((busyRef.current && pendingRef.current != null ? pendingRef.current : indexRef.current) - 1),
    isBusy: () => busyRef.current,
  }));

  // Cambio de índice/vistas desde fuera (cambio de modo, salto externo):
  // cancela cualquier giro en curso y se queda en reposo.
  useLayoutEffect(() => {
    if (flipRef.current && (index !== flipRef.current.from)) {
      tokenRef.current += 1;
      cancelAnimationFrame(rafRef.current);
      flipRef.current = null;
      setFlip(null);
      setBusy(false);
    }
    indexRef.current = index;
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!flipRef.current && !dragRef.current?.f) return;
    tokenRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    flipRef.current = null;
    dragRef.current = null;
    setFlip(null);
    setBusy(false);
  }, [views, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!flip) clearProgressVars();
  }, [flip]);

  useEffect(() => () => { tokenRef.current += 1; cancelAnimationFrame(rafRef.current); }, []);

  // --- Arrastre (ratón / táctil) ---------------------------------------------
  const zoneAt = (clientX, pointerType) => {
    const node = bookRef.current;
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const { mode: m } = live.current;
    const edge = pointerType === 'mouse' ? 0.3 : 0.5;
    if (m === 'single') {
      if (fx >= 1 - edge) return 'next';
      if (fx <= edge) return 'prev';
      return null;
    }
    const s = slotsOf(live.current.views[indexRef.current], indexRef.current, m);
    // Solo se puede agarrar una hoja que existe en ese lado
    if (fx >= 1 - edge / 2 && s.R) return 'next';
    if (fx <= edge / 2 && s.L) return 'prev';
    return null;
  };

  const onPointerDown = (e) => {
    if (!dragEnabled || busyRef.current || dragRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((window.visualViewport?.scale || 1) > 1.05) return; // zoom por pellizco activo
    const dir = zoneAt(e.clientX, e.pointerType);
    if (!dir) return;
    const target = indexRef.current + (dir === 'next' ? 1 : -1);
    if (target < 0 || target >= live.current.views.length) return;
    dragRef.current = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, dir, target,
      started: false, f: null, preparing: null, lastX: e.clientX, lastT: performance.now(), vx: 0, released: false,
      travel: bookRef.current.getBoundingClientRect().width * (live.current.mode === 'single' ? 0.85 : 0.9),
    };
  };

  const dragProgress = (drag, clientX) => {
    const dx = clientX - drag.x0;
    const signed = drag.dir === 'next' ? -dx : dx;
    return clamp01(signed / drag.travel);
  };

  const releaseDrag = async (drag) => {
    const f = drag.f;
    if (!f) return;
    const p = progressRef.current;
    const fling = drag.dir === 'next' ? drag.vx < -0.45 : drag.vx > 0.45; // px/ms
    const commit = p > 0.3 || (fling && p > 0.04);
    const { duration: dur } = live.current;
    if (commit) {
      await animate(p, 1, Math.max(160, dur * 0.75 * (1 - p)), f, easeOut);
      if (flipRef.current === f) finish(f, true);
    } else {
      await animate(p, 0, Math.max(120, dur * 0.6 * p), f, easeOut);
      if (flipRef.current === f) finish(f, false);
    }
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) {
      if (e.pointerType === 'mouse' && dragEnabled && !busyRef.current) {
        const z = zoneAt(e.clientX, 'mouse');
        const idx = indexRef.current + (z === 'next' ? 1 : -1);
        const ok = z && idx >= 0 && idx < live.current.views.length;
        setHoverZone(ok ? z : null);
      }
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    const now = performance.now();
    drag.vx = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
    drag.lastX = e.clientX;
    drag.lastT = now;
    if (!drag.started) {
      const rightWay = drag.dir === 'next' ? dx < 0 : dx > 0;
      if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) { dragRef.current = null; return; }
      if (Math.abs(dx) < 10 || !rightWay || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      drag.started = true;
      suppressClickRef.current = true;
      try { bookRef.current.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      live.current.onFlipStart?.(drag.dir);
      drag.preparing = prepareFlip(drag.target).then((f) => {
        if (dragRef.current !== drag) return;
        if (!f) { dragRef.current = null; setBusy(false); return; }
        drag.f = f;
        if (drag.released) {
          releaseDrag(drag).finally(() => { if (dragRef.current === drag) dragRef.current = null; });
        } else {
          progressRef.current = dragProgress(drag, drag.lastX);
          applyProgress(progressRef.current, f);
        }
      });
      return;
    }
    if (drag.f) {
      const p = dragProgress(drag, e.clientX);
      progressRef.current = p;
      applyProgress(p, drag.f);
    }
  };

  const onPointerUp = (e) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.started) { dragRef.current = null; return; }
    drag.released = true;
    if (drag.f) {
      releaseDrag(drag).finally(() => { if (dragRef.current === drag) dragRef.current = null; });
    }
    // si aún está preparando, releaseDrag se lanza al terminar la preparación
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  };

  // pointerup/cancel se escuchan en NATIVO y en fase de captura: tras un
  // arrastre hay que cortar el evento antes de que llegue al canvas (Konva
  // dispararía el "click" de un hotspot/enlace), y cortarlo impediría que
  // llegara al manejador delegado de React -- por eso se procesa aquí mismo.
  const upHandlerRef = useRef(null);
  upHandlerRef.current = onPointerUp;
  useEffect(() => {
    const node = bookRef.current;
    if (!node) return undefined;
    const onUp = (ev) => {
      const wasDragging = !!dragRef.current?.started;
      upHandlerRef.current?.(ev);
      if (wasDragging) ev.stopPropagation();
    };
    const stop = (ev) => {
      if (suppressClickRef.current || dragRef.current?.started) {
        ev.stopPropagation();
        if (ev.type === 'click') ev.preventDefault();
      }
    };
    node.addEventListener('pointerup', onUp, true);
    node.addEventListener('pointercancel', onUp, true);
    const types = ['mouseup', 'touchend', 'click'];
    types.forEach((t) => node.addEventListener(t, stop, true));
    return () => {
      node.removeEventListener('pointerup', onUp, true);
      node.removeEventListener('pointercancel', onUp, true);
      types.forEach((t) => node.removeEventListener(t, stop, true));
    };
  }, []);

  // --- Render ----------------------------------------------------------------
  const layers = computeLayers(views, index, flip, mode);
  const restSlots = slotsOf(views[index], index, mode);
  const restShift = restShiftOf(restSlots, mode, w);

  const hingeOf = (layer) => {
    if (layer.role === 'base') return layer.slot === 'left' ? 'right' : layer.slot === 'right' ? 'left' : null;
    const leafOnLeft = layer.slot === 'left';
    if (layer.role === 'front') return leafOnLeft ? 'right' : 'left';
    return leafOnLeft ? 'left' : 'right'; // reverso: espejado
  };

  const rendered = layers
    .filter((l) => l.page || l.blankIfEmpty)
    .map((l) => ({ ...l, key: l.page ? getPageKey(l.page) : `__blank-${l.role}` }))
    // Orden DOM estable (por clave): al cambiar de rol una página no se mueve
    // en el DOM (mover un <iframe> lo recargaría); el apilado va por z-index.
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const hasBase = (slot) => layers.some((l) => l.role === 'base' && l.slot === slot && l.page);

  return (
    <div
      ref={bookRef}
      className={`fb-book fb-mode-${mode}${flip ? ` fb-flipping fb-dir-${flip.dir}` : ''}${hoverZone ? ` fb-hover-${hoverZone}` : ''} ${className}`}
      style={{
        width: bookW,
        height: pageHeight,
        perspective: `${perspective}px`,
        '--fb-w': `${w}px`,
        '--fb-rest-shift': `${restShift}px`,
        ...style,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHoverZone(null)}
    >
      {rendered.map((l) => {
        const hinge = hingeOf(l);
        const leaf = l.role !== 'base';
        const cls = [
          'fb-page',
          leaf ? 'fb-leaf' : 'fb-base',
          leaf ? `fb-${l.role}` : '',
          `fb-slot-${l.slot}`,
          leaf ? (l.slot === 'left' ? 'fb-origin-right' : 'fb-origin-left') : '',
          hinge ? `fb-hinge-${hinge}` : '',
          l.page ? '' : 'fb-blank',
        ].filter(Boolean).join(' ');
        return (
          <div key={l.key} className={cls} aria-hidden={leaf && l.role === 'back' ? true : undefined}>
            {l.page ? renderPage(l.page) : null}
            <div className="fb-shade" />
          </div>
        );
      })}
      {flip && mode !== 'single' && hasBase('left') && <div className="fb-cast fb-cast-left" />}
      {flip && hasBase(mode === 'single' ? 'center' : 'right') && <div className="fb-cast fb-cast-right" />}
    </div>
  );
});

export default FlipBook;
