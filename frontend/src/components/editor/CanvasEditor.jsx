import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fabric } from 'fabric';
import { publicationAPI } from '../../services/publicationAPI';
import { pageAPI } from '../../services/pageAPI';
import '../../styles/CanvasEditor.css';

const CanvasEditor = () => {
  const { id, pageId } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  
  const [publication, setPublication] = useState(null);
  const [currentPage, setCurrentPage] = useState(null);
  const [pages, setPages] = useState([]);
  const [activeTool, setActiveTool] = useState(null);
  const [selectedObject, setSelectedObject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPublication();
    loadPages();
  }, [id]);

  useEffect(() => {
    if (pageId && pages.length > 0) {
      const page = pages.find(p => p.id === pageId);
      if (page) {
        setCurrentPage(page);
        initCanvas(page);
      }
    } else if (pages.length > 0) {
      // Cargar primera página por defecto
      setCurrentPage(pages[0]);
      initCanvas(pages[0]);
    }
  }, [pageId, pages]);

  const loadPublication = async () => {
    try {
      const data = await publicationAPI.get(id);
      setPublication(data);
    } catch (err) {
      console.error('Error loading publication:', err);
    }
  };

  const loadPages = async () => {
    try {
      setLoading(true);
      const data = await pageAPI.getPublicationPages(id);
      setPages(data);
    } catch (err) {
      console.error('Error loading pages:', err);
    } finally {
      setLoading(false);
    }
  };

  const initCanvas = (page) => {
    if (!publication || !canvasRef.current) return;

    // Limpiar canvas existente
    if (fabricCanvasRef.current) {
      fabricCanvasRef.current.dispose();
    }

    // Crear nuevo canvas con dimensiones de la publicación
    const canvas = new fabric.Canvas(canvasRef.current, {
      width: publication.page_width * 3.78, // Convertir mm a px (1mm ≈ 3.78px)
      height: publication.page_height * 3.78,
      backgroundColor: '#ffffff',
    });

    fabricCanvasRef.current = canvas;

    // Cargar contenido existente si hay
    if (page.content && Object.keys(page.content).length > 0) {
      canvas.loadFromJSON(page.content, () => {
        canvas.renderAll();
      });
    }

    // Event listeners
    canvas.on('selection:created', (e) => {
      setSelectedObject(e.selected[0]);
    });

    canvas.on('selection:updated', (e) => {
      setSelectedObject(e.selected[0]);
    });

    canvas.on('selection:cleared', () => {
      setSelectedObject(null);
    });
  };

  const addText = () => {
    if (!fabricCanvasRef.current) return;

    const text = new fabric.IText('Haz doble clic para editar', {
      left: 100,
      top: 100,
      fontSize: 24,
      fontFamily: 'Arial',
      fill: '#000000',
    });

    fabricCanvasRef.current.add(text);
    fabricCanvasRef.current.setActiveObject(text);
    setActiveTool(null);
  };

  const addRectangle = () => {
    if (!fabricCanvasRef.current) return;

    const rect = new fabric.Rect({
      left: 100,
      top: 100,
      width: 200,
      height: 150,
      fill: '#667eea',
      stroke: '#5568d3',
      strokeWidth: 2,
    });

    fabricCanvasRef.current.add(rect);
    fabricCanvasRef.current.setActiveObject(rect);
    setActiveTool(null);
  };

  const addCircle = () => {
    if (!fabricCanvasRef.current) return;

    const circle = new fabric.Circle({
      left: 100,
      top: 100,
      radius: 75,
      fill: '#764ba2',
      stroke: '#667eea',
      strokeWidth: 2,
    });

    fabricCanvasRef.current.add(circle);
    fabricCanvasRef.current.setActiveObject(circle);
    setActiveTool(null);
  };

  const deleteSelected = () => {
    if (!fabricCanvasRef.current) return;
    const activeObject = fabricCanvasRef.current.getActiveObject();
    if (activeObject) {
      fabricCanvasRef.current.remove(activeObject);
      setSelectedObject(null);
    }
  };

  const bringToFront = () => {
    if (!fabricCanvasRef.current || !selectedObject) return;
    fabricCanvasRef.current.bringToFront(selectedObject);
    fabricCanvasRef.current.renderAll();
  };

  const sendToBack = () => {
    if (!fabricCanvasRef.current || !selectedObject) return;
    fabricCanvasRef.current.sendToBack(selectedObject);
    fabricCanvasRef.current.renderAll();
  };

  const saveContent = async () => {
    if (!fabricCanvasRef.current || !currentPage) return;

    try {
      const content = fabricCanvasRef.current.toJSON();
      await pageAPI.update(currentPage.id, { content });
      alert('✅ Contenido guardado correctamente');
    } catch (err) {
      console.error('Error saving content:', err);
      alert('❌ Error al guardar el contenido');
    }
  };

  const goToPage = (page) => {
    navigate(`/publications/${id}/edit/${page.id}`);
  };

  if (loading) {
    return <div className="loading">Cargando editor...</div>;
  }

  return (
    <div className="canvas-editor-container">
      {/* Header */}
      <div className="editor-header">
        <div className="header-left">
          <button onClick={() => navigate(`/publications/${id}/view`)} className="btn-back">
            ← Volver al Visor
          </button>
          <h2>{publication?.title}</h2>
          <span className="page-info">
            Página {currentPage?.page_number} - {currentPage?.page_type === 'cover' ? 'Portada' : currentPage?.page_type === 'back_cover' ? 'Contraportada' : 'Contenido'}
          </span>
        </div>
        <div className="header-right">
          <button onClick={saveContent} className="btn-save">
            💾 Guardar
          </button>
        </div>
      </div>

      {/* Toolbar lateral */}
      <div className="editor-sidebar">
        <div className="toolbar">
          <h3>Herramientas</h3>
          
          <button onClick={addText} className="tool-btn" title="Agregar texto">
            <span className="tool-icon">T</span>
            <span className="tool-label">Texto</span>
          </button>

          <button onClick={addRectangle} className="tool-btn" title="Agregar rectángulo">
            <span className="tool-icon">▭</span>
            <span className="tool-label">Rectángulo</span>
          </button>

          <button onClick={addCircle} className="tool-btn" title="Agregar círculo">
            <span className="tool-icon">●</span>
            <span className="tool-label">Círculo</span>
          </button>

          <hr />

          {selectedObject && (
            <>
              <h3>Capas</h3>
              <button onClick={bringToFront} className="tool-btn" title="Traer al frente">
                <span className="tool-icon">↑</span>
                <span className="tool-label">Al frente</span>
              </button>

              <button onClick={sendToBack} className="tool-btn" title="Enviar atrás">
                <span className="tool-icon">↓</span>
                <span className="tool-label">Atrás</span>
              </button>

              <hr />

              <button onClick={deleteSelected} className="tool-btn tool-btn-danger" title="Eliminar">
                <span className="tool-icon">🗑️</span>
                <span className="tool-label">Eliminar</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas principal */}
      <div className="editor-canvas-area">
        <div className="canvas-wrapper">
          <canvas ref={canvasRef} id="fabric-canvas"></canvas>
        </div>
      </div>

      {/* Thumbnails de páginas */}
      <div className="editor-pages-bar">
        {pages.map((page) => (
          <div
            key={page.id}
            className={`page-thumb ${page.id === currentPage?.id ? 'active' : ''}`}
            onClick={() => goToPage(page)}
          >
            <div className="thumb-number">{page.page_number}</div>
            <small>{page.page_type === 'cover' ? 'Port.' : page.page_type === 'back_cover' ? 'Contra.' : 'Cont.'}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CanvasEditor;
