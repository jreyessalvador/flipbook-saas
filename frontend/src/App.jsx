import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './services/AuthContext';
import ProtectedRoute from './components/common/ProtectedRoute';
import Navbar from './components/common/Navbar';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Publications from './pages/Publications';
import Collections from './pages/Collections';
const Team = lazy(() => import('./pages/Team'));
const PageViewer = lazy(() => import('./components/editor/PageViewer'));
const CanvasEditorV2 = lazy(() => import('./components/editor/CanvasEditorV2'));
import LandingPage from './pages/LandingPage';
const PublicReader = lazy(() => import('./pages/PublicReader'));
const SuperAdmin = lazy(() => import('./pages/SuperAdmin'));
const AcceptInvitation = lazy(() => import('./pages/AcceptInvitation'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>Cargando…</div>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/leer/:id" element={<PublicReader />} />
          <Route path="/login" element={<Login />} />
          <Route path="/aceptar-invitacion" element={<AcceptInvitation />} />
          <Route path="/restablecer-contrasena" element={<ResetPassword />} />
          <Route path="/team" element={<ProtectedRoute><><Navbar /><Team /></></ProtectedRoute>} />
          <Route path="/superadmin" element={<ProtectedRoute><><Navbar /><SuperAdmin /></></ProtectedRoute>} />

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

          {/* Lote C: Colecciones -> Ediciones. /publications queda como alias. */}
          <Route path="/publications" element={<Navigate to="/collections" replace />} />
          <Route
            path="/collections"
            element={
              <ProtectedRoute>
                <>
                  <Navbar />
                  <Collections />
                </>
              </ProtectedRoute>
            }
          />
          <Route
            path="/collections/:collectionId"
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
              Ver docs/arquitectura-editor-2026-09-12.md. El editor viejo (CanvasEditor)
              se eliminó el 2026-09-27; sigue disponible en el historial de git. */}
          <Route
            path="/publications/:id/edit/:pageId?"
            element={
              <ProtectedRoute>
                <CanvasEditorV2 />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;
