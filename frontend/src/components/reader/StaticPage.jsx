import React, { useLayoutEffect, useState } from 'react';
import { PageCanvas } from '../editor/CanvasEditorV2';
import { createPageEditorStore } from '../../store/pageEditorStore';

// Página de solo lectura para el FlipBook (Lote FLIP-2). Recibe los elementos
// ya cargados (no hace fetch): así el visor puede precargar las páginas de la
// hoja siguiente y montarlas al instante. El store se inicializa en el propio
// useState para que el PRIMER render ya pinte el contenido (sin frame vacío).
const snapshot = (page, elements, loading, error) => ({
  pageId: page?.id || `public-${page?.page_number}`,
  version: 0,
  elements: (elements || []).map((el) => ({ ...el })),
  selectedElementIds: [],
  isLoading: !!loading,
  loadError: error || null,
});

export default function StaticPage({ page, elements, loading = false, error = null, publication, totalPages, scale, onHotspotActivate }) {
  const [useStore] = useState(() => {
    const store = createPageEditorStore();
    store.setState(snapshot(page, elements, loading, error));
    return store;
  });
  const [lastInput, setLastInput] = useState({ elements, loading, error, id: page?.id });

  useLayoutEffect(() => {
    if (lastInput.elements === elements && lastInput.loading === loading && lastInput.error === error && lastInput.id === page?.id) return;
    useStore.setState(snapshot(page, elements, loading, error));
    setLastInput({ elements, loading, error, id: page?.id });
  }, [page, elements, loading, error]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageCanvas
      useStoreHook={useStore}
      canEdit={false}
      publication={publication}
      pageNumber={page.page_number}
      totalPages={totalPages}
      onFocus={() => {}}
      onHotspotActivate={onHotspotActivate ? (hotspot) => onHotspotActivate(hotspot, page) : undefined}
      scale={scale}
    />
  );
}
