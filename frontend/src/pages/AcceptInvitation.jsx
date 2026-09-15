import React, { useState } from 'react';
import api from '../services/api';
export default function AcceptInvitation() {
  const [password,setPassword]=useState(''); const [message,setMessage]=useState('');
  const submit=async e=>{e.preventDefault(); const token=new URLSearchParams(window.location.search).get('token'); if(!token)return setMessage('Enlace de invitación inválido'); try{await api.post('/api/superadmin/invitations/accept',{token,password});setMessage('Cuenta activada. Ya puedes iniciar sesión.')}catch(e){setMessage(e.response?.data?.detail||'No se pudo aceptar la invitación');}};
  return <main className="page-container"><h2>Activar cuenta CETRIX</h2><form onSubmit={submit}><input type="password" minLength="12" required placeholder="Crea una contraseña segura" value={password} onChange={e=>setPassword(e.target.value)}/><button>Activar cuenta</button></form><p>{message}</p></main>;
}
