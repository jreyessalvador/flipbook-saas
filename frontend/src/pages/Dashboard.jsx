import React from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { pubAPI } from '../services/api';
import { BookOpenIcon, EyeIcon, DocumentTextIcon, PlusIcon } from '@heroicons/react/24/outline';

const Stat = ({label,value,icon,color}) => (
  <div style={{background:'#fff',borderRadius:12,padding:'20px 24px',border:'1px solid #e9ecef',display:'flex',alignItems:'center',gap:16}}>
    <div style={{background:color+'15',borderRadius:10,padding:12,color}}>{icon}</div>
    <div><div style={{fontSize:28,fontWeight:700,color:'#1a1a2e'}}>{value}</div><div style={{fontSize:13,color:'#6c757d',marginTop:2}}>{label}</div></div>
  </div>
);

export default function Dashboard() {
  const nav = useNavigate();
  const {data:all} = useQuery('pubs-all', () => pubAPI.list({per_page:100}));
  const {data:published} = useQuery('pubs-pub', () => pubAPI.list({status:'published',per_page:100}));
  const {data:recent} = useQuery('pubs-recent', () => pubAPI.list({per_page:5}));

  const totalViews = all?.items?.reduce((s,p)=>s+p.view_count,0) || 0;

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,color:'#1a1a2e',margin:0}}>Dashboard</h1>
          <p style={{color:'#6c757d',margin:'4px 0 0',fontSize:14}}>Resumen de tu plataforma flipbook</p>
        </div>
        <button onClick={()=>nav('/publications')} style={{
          background:'#e2b96a',color:'#1a1a2e',border:'none',borderRadius:8,
          padding:'10px 18px',fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:14
        }}>
          <PlusIcon style={{width:18}}/>Nueva publicación
        </button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:28}}>
        <Stat label="Total publicaciones" value={all?.total||0} icon={<BookOpenIcon style={{width:22}}/>} color="#4361ee"/>
        <Stat label="Publicadas" value={published?.total||0} icon={<DocumentTextIcon style={{width:22}}/>} color="#2ec4b6"/>
        <Stat label="Visualizaciones" value={totalViews.toLocaleString()} icon={<EyeIcon style={{width:22}}/>} color="#e2b96a"/>
      </div>

      <div style={{background:'#fff',borderRadius:12,border:'1px solid #e9ecef',padding:24}}>
        <h2 style={{fontSize:16,fontWeight:600,color:'#1a1a2e',margin:'0 0 16px'}}>Publicaciones recientes</h2>
        {!recent?.items?.length ? (
          <div style={{textAlign:'center',padding:'40px 0',color:'#6c757d'}}>
            <BookOpenIcon style={{width:40,marginBottom:12,opacity:.3}}/>
            <p>No hay publicaciones aún.</p>
            <button onClick={()=>nav('/publications')} style={{
              background:'#4361ee',color:'#fff',border:'none',borderRadius:8,
              padding:'8px 16px',cursor:'pointer',marginTop:8,fontSize:14
            }}>Crear primera publicación</button>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
            <thead><tr style={{borderBottom:'2px solid #e9ecef'}}>
              {['Título','Estado','Páginas','Visitas','Creado'].map(h=>(
                <th key={h} style={{padding:'8px 12px',textAlign:'left',color:'#6c757d',fontWeight:600}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {recent.items.map(p=>(
                <tr key={p.id} onClick={()=>nav(`/publications/${p.id}/edit`)}
                  style={{borderBottom:'1px solid #f1f3f5',cursor:'pointer',transition:'background .1s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f8f9fa'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{padding:'12px'}}><div style={{fontWeight:500,color:'#1a1a2e'}}>{p.title}</div></td>
                  <td style={{padding:'12px'}}>
                    <span style={{
                      padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:500,
                      background: p.status==='published'?'#d1fae5':p.status==='draft'?'#e9ecef':'#fef3c7',
                      color: p.status==='published'?'#065f46':p.status==='draft'?'#495057':'#92400e'
                    }}>{p.status}</span>
                  </td>
                  <td style={{padding:'12px',color:'#6c757d'}}>{p.page_count}</td>
                  <td style={{padding:'12px',color:'#6c757d'}}>{p.view_count}</td>
                  <td style={{padding:'12px',color:'#6c757d'}}>{new Date(p.created_at).toLocaleDateString('es-ES')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
