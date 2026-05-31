import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../services/AuthContext';
import { BookOpenIcon, HomeIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const handle_logout = () => { logout(); nav('/login'); };
  return (
    <div style={{display:'flex',height:'100vh',background:'#f8f9fa'}}>
      <aside style={{width:220,background:'#1a1a2e',color:'#fff',display:'flex',flexDirection:'column',padding:'24px 0'}}>
        <div style={{padding:'0 20px 24px',borderBottom:'1px solid rgba(255,255,255,.1)'}}>
          <div style={{fontSize:20,fontWeight:700,color:'#e2b96a'}}>📚 Flipbook</div>
          <div style={{fontSize:12,color:'rgba(255,255,255,.5)',marginTop:4}}>SaaS Platform</div>
        </div>
        <nav style={{flex:1,padding:'16px 0'}}>
          {[
            {to:'/dashboard',icon:<HomeIcon style={{width:18}}/>,label:'Dashboard'},
            {to:'/publications',icon:<BookOpenIcon style={{width:18}}/>,label:'Publicaciones'},
          ].map(({to,icon,label})=>(
            <NavLink key={to} to={to} style={({isActive})=>({
              display:'flex',alignItems:'center',gap:10,padding:'10px 20px',
              color: isActive?'#e2b96a':'rgba(255,255,255,.7)',
              background: isActive?'rgba(226,185,106,.1)':'transparent',
              textDecoration:'none',fontSize:14,transition:'all .15s'
            })}>
              {icon}{label}
            </NavLink>
          ))}
        </nav>
        <div style={{padding:'16px 20px',borderTop:'1px solid rgba(255,255,255,.1)'}}>
          <div style={{fontSize:13,color:'rgba(255,255,255,.7)',marginBottom:8}}>{user?.email}</div>
          <button onClick={handle_logout} style={{
            display:'flex',alignItems:'center',gap:8,background:'none',border:'1px solid rgba(255,255,255,.2)',
            color:'rgba(255,255,255,.7)',padding:'6px 12px',borderRadius:6,cursor:'pointer',fontSize:13,width:'100%'
          }}>
            <ArrowRightOnRectangleIcon style={{width:16}}/>Salir
          </button>
        </div>
      </aside>
      <main style={{flex:1,overflow:'auto',padding:24}}>
        <Outlet />
      </main>
    </div>
  );
}
