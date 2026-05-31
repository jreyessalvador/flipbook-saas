import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { pubAPI } from '../services/api';
import { PlusIcon, PencilIcon, TrashIcon, EyeIcon, BookOpenIcon } from '@heroicons/react/24/outline';

const STATUS_COLORS = {
  draft: {bg:'#e9ecef',color:'#495057',label:'Borrador'},
  published: {bg:'#d1fae5',color:'#065f46',label:'Publicada'},
  archived: {bg:'#fef3c7',color:'#92400e',label:'Archivada'},
};

export default function Publications() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const {data, isLoading} = useQuery(
    ['publications', search, filterStatus],
    () => pubAPI.list({q:search||undefined, status:filterStatus||undefined, per_page:24}),
    {keepPreviousData:true}
  );

  const createMut = useMutation(
    () => pubAPI.create({title:newTitle}),
    {onSuccess: p => {
      qc.invalidateQueries('publications');
      toast.success('Publicación creada');
      setShowCreate(false); setNewTitle('');
      nav(`/publications/${p.id}/edit`);
    }, onError: () => toast.error('Error al crear')}
  );

  const deleteMut = useMutation(
    (id) => pubAPI.delete(id),
    {onSuccess: () => { qc.invalidateQueries('publications'); toast.success('Eliminada'); },
     onError: () => toast.error('Error al eliminar')}
  );

  const handleDelete = (e, id) => {
    e.stopPropagation();
    if (confirm('¿Eliminar esta publicación?')) deleteMut.mutate(id);
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,color:'#1a1a2e',margin:0}}>Publicaciones</h1>
          <p style={{color:'#6c757d',margin:'4px 0 0',fontSize:14}}>{data?.total||0} publicaciones</p>
        </div>
        <button onClick={()=>setShowCreate(true)} style={{
          background:'#e2b96a',color:'#1a1a2e',border:'none',borderRadius:8,
          padding:'10px 18px',fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',gap:8,fontSize:14
        }}><PlusIcon style={{width:18}}/>Nueva publicación</button>
      </div>

      <div style={{display:'flex',gap:12,marginBottom:20}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar publicaciones..."
          style={{flex:1,padding:'9px 14px',border:'1px solid #dee2e6',borderRadius:8,fontSize:14,outline:'none'}}/>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
          style={{padding:'9px 14px',border:'1px solid #dee2e6',borderRadius:8,fontSize:14,outline:'none',background:'#fff'}}>
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="published">Publicada</option>
          <option value="archived">Archivada</option>
        </select>
      </div>

      {showCreate && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000}}>
          <div style={{background:'#fff',borderRadius:12,padding:28,width:400,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
            <h3 style={{margin:'0 0 16px',color:'#1a1a2e'}}>Nueva publicación</h3>
            <input value={newTitle} onChange={e=>setNewTitle(e.target.value)}
              placeholder="Título de la publicación"
              style={{width:'100%',padding:'10px 14px',border:'1px solid #dee2e6',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}
              onKeyDown={e=>e.key==='Enter'&&newTitle.trim()&&createMut.mutate()}
              autoFocus/>
            <div style={{display:'flex',gap:8,marginTop:16,justifyContent:'flex-end'}}>
              <button onClick={()=>{setShowCreate(false);setNewTitle('');}}
                style={{padding:'8px 16px',border:'1px solid #dee2e6',borderRadius:8,cursor:'pointer',background:'#fff',fontSize:14}}>Cancelar</button>
              <button onClick={()=>newTitle.trim()&&createMut.mutate()}
                disabled={!newTitle.trim()||createMut.isLoading}
                style={{padding:'8px 16px',background:'#4361ee',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:600,fontSize:14}}>
                {createMut.isLoading?'Creando...':'Crear'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{textAlign:'center',padding:'60px 0',color:'#6c757d'}}>Cargando...</div>
      ) : !data?.items?.length ? (
        <div style={{textAlign:'center',padding:'60px 0',color:'#6c757d',background:'#fff',borderRadius:12,border:'1px solid #e9ecef'}}>
          <BookOpenIcon style={{width:48,marginBottom:12,opacity:.3}}/>
          <p style={{fontSize:16}}>No hay publicaciones aún</p>
          <button onClick={()=>setShowCreate(true)} style={{background:'#4361ee',color:'#fff',border:'none',borderRadius:8,padding:'10px 20px',cursor:'pointer',marginTop:8}}>
            Crear primera publicación
          </button>
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:16}}>
          {data.items.map(p => {
            const sc = STATUS_COLORS[p.status] || STATUS_COLORS.draft;
            return (
              <div key={p.id} onClick={()=>nav(`/publications/${p.id}/edit`)}
                style={{background:'#fff',borderRadius:12,border:'1px solid #e9ecef',overflow:'hidden',cursor:'pointer',transition:'transform .15s,box-shadow .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,.1)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
                <div style={{height:140,background:'linear-gradient(135deg,#1a1a2e,#16213e)',display:'flex',alignItems:'center',justifyContent:'center',position:'relative'}}>
                  {p.cover_url ? (
                    <img src={p.cover_url} alt={p.title} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  ) : (
                    <BookOpenIcon style={{width:48,color:'rgba(255,255,255,.3)'}}/>
                  )}
                  <div style={{position:'absolute',top:10,right:10}}>
                    <span style={{padding:'3px 8px',borderRadius:20,fontSize:11,fontWeight:600,background:sc.bg,color:sc.color}}>{sc.label}</span>
                  </div>
                </div>
                <div style={{padding:'14px 16px'}}>
                  <div style={{fontWeight:600,color:'#1a1a2e',fontSize:14,marginBottom:4,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.title}</div>
                  <div style={{fontSize:12,color:'#6c757d',marginBottom:12}}>{p.page_count} páginas · {p.view_count} visitas</div>
                  <div style={{display:'flex',gap:6}}>
                    <button onClick={e=>{e.stopPropagation();nav(`/publications/${p.id}/edit`)}}
                      style={{flex:1,padding:'6px',background:'#f8f9fa',border:'1px solid #e9ecef',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4,fontSize:12}}>
                      <PencilIcon style={{width:14}}/>Editar
                    </button>
                    {p.status==='published' && (
                      <button onClick={e=>{e.stopPropagation();window.open(`/view/${p.slug}`)}}
                        style={{flex:1,padding:'6px',background:'#d1fae5',border:'1px solid #a7f3d0',borderRadius:6,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:4,fontSize:12,color:'#065f46'}}>
                        <EyeIcon style={{width:14}}/>Ver
                      </button>
                    )}
                    <button onClick={e=>handleDelete(e,p.id)}
                      style={{padding:'6px 8px',background:'#fff0f0',border:'1px solid #fecaca',borderRadius:6,cursor:'pointer',color:'#dc2626'}}>
                      <TrashIcon style={{width:14}}/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
