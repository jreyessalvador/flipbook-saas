import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './services/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Navbar from './components/common/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Publications from './pages/Publications';
import PageViewer from './components/editor/PageViewer';
import CanvasEditor from './components/editor/CanvasEditor';
import CanvasEditorV2 from './components/editor/CanvasEditorV2';

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <Dashboard />
                </>
              </ProtectedRoute>
            }
          />

          <Route
            path="/publications"
            element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <Publications />
                </>
              </ProtectedRoute>
            }
          />

          <Route
            path="/publications/:id/view"
            element={
              <ProtectedRoute>
                <PageViewer />
              </ProtectedRoute>
            }
          />

          {/* Editor v2 (Fase B, react-konva) -- reemplaza al editor viejo basado en
              Fabric.js/objeto global mutable que causaba la fuga portada<->contraportada.
              Ver docs/arquitectura-editor-2026-09-12.md. El componente viejo
              (CanvasEditor) se deja sin usar en el repo por ahora como referencia,
              no se borra hasta confirmar que v2 cubre todos los casos. */}
          <Route
            path="/publications/:id/edit/:pageId?"
            element={
              <ProtectedRoute>
                <CanvasEditorV2 />
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
