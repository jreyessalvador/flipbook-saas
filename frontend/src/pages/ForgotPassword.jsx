import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

// L9 (29-sep-2026): solicitud de restablecimiento por correo. La respuesta
// es siempre la misma exista o no la cuenta (no revela emails registrados).
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/password-reset/request', { email });
      setSent(true);
    } catch (err) {
      setError(err?.response?.data?.detail || 'No se pudo procesar la solicitud. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-container">
      <section className="login-card">
        <h2>Recuperar contraseña</h2>
        {sent ? (
          <>
            <p>Si <strong>{email}</strong> corresponde a una cuenta activa, en unos minutos recibirás un correo con un enlace para elegir una nueva contraseña (válido 2 horas).</p>
            <p style={{ color: '#666', fontSize: '0.9rem' }}>Revisa también la carpeta de spam.</p>
          </>
        ) : (
          <form onSubmit={submit}>
            <p style={{ color: '#666', marginBottom: '1rem' }}>Escribe el correo con el que accedes y te enviaremos un enlace para restablecerla.</p>
            {error && <div className="error-message">{error}</div>}
            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@empresa.com" />
            </div>
            <button className="btn-primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
          </form>
        )}
        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.9rem' }}><Link to="/?acceso=1">Volver a iniciar sesión</Link></p>
      </section>
    </main>
  );
}
