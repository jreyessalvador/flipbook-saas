import React, { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { pubAPI } from '../services/api';
import { ArrowLeftIcon, CloudArrowUpIcon, EyeIcon, GlobeAltIcon, PencilIcon } from '@heroicons/react/24/outline';

export default function PublicationEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState('pages');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});

  const { data: pub, isLoading } = useQuery(['pub', id], () => pubAPI.get(id));

  const updateMut = useMutation(
    (data) => pubAPI.update(id, data),
    { onSuccess: () => { qc.invalidateQueries(['pub', id]); toast.success('Guardado'); setEditing(false); } }
  );

  const publishMut = useMutation(
    () => pubAPI.publish(id),
    { onSuccess: (p) => { qc.invalidateQueries(['pub', id]); toast.success('Publicada'); } }
  );

  const { data: analytics } = useQuery(['analytics', id], () => pubAPI.analytics(id), { enabled: tab === 'analytics' });

  const onDrop = useCallback(async (files) => {
    const file = files[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Solo se aceptan archivos PDF'); return; }
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await pubAPI.uploadPDF(id, file, setUploadProgress);
      qc.invalidateQueries(['pub', id]);
      toast.success(`PDF procesado: ${result.page_count} páginas`);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error al procesar PDF');
    } finally {
      setUploading(false);
    }
  }, [id, qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, maxFiles: 1 });

  if (isLoading) return <div style={{textAlign:'center',padding:'80px 0',color:'#6c757d'}}>Cargando...</div>;
  if (!pub) return <div>Publicación no encontrada</div>;

  const sc = pub.status === 'published' ? {bg:'#d1fae5',color:'#065f46'} : {bg:'#e9ecef',color:'#495057'};
  const TABS = [
    {id:'pages',label:'Páginas'},
    {id:'settings',label:'Configuración'},
    {id:'analytics',label:'Analytics'},
  ];

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <button onClick={()=>nav('/publications')} style={{background:'none',border:'none',cursor:'pointer',color:'#6c757d',display:'flex',alignItems:'center',gap:4,fontSize:14,padding:0}}>
          <ArrowLeftIcon style={{width:16}}/>Volver
        </button>
        <span style={{color:'#dee2e6'}}>/</span>
        {editing ? (
          <input value={editData.title ?? pub.title} onChange={e=>setEditData({...editData,title:e.target.value})}
            onBlur={()=>updateMut.mutate({title:editData.title})}
            style={{fontSize:20,fontWeight:700,color:'#1a1a2e',border:'1px solid #4361ee',borderRadius:6,padding:'4px 8px',outline:'none'}}
            autoFocus/>
        ) : (
          <h1 onClick={()=>{setEditing(true);setEditData({title:pub.title})}}
            style={{fontSize:20,fontWeight:700,color:'#1a1a2e',margin:0,cursor:'text',display:'flex',alignItems:'center',gap:6}}>
            {pub.title}<PencilIcon style={{width:14,color:'#adb5bd'}}/>
          </h1>
        )}
        <span style={{padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:500,...sc}}>{pub.status}</span>
        <div style={{marginLeft:'auto',display:'flex',gap:8}}>
          {pub.status === 'published' && (
            <button onClick={()=>window.open(`/view/${pub.slug}`,'_blank')} style={{
              padding:'8px 14px',background:'#f8f9fa',border:'1px solid #dee2e6',borderRadius:8,
              cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontSize:14
            }}><EyeIcon style={{width:16}}/>Ver flipbook</button>
          )}
          {pub.status !== 'published' && pub.page_count > 0 && (
            <button onClick={()=>publishMut.mutate()} disabled={publishMut.isLoading} style={{
              padding:'8px 14px',background:'#2ec4b6',color:'#fff',border:'none',borderRadius:8,
              cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontSize:14,fontWeight:600
            }}><GlobeAltIcon style={{width:16}}/>{publishMut.isLoading?'Publicando...':'Publicar'}</button>
          )}
        </div>
      </div>

      <div style={{display:'flex',gap:4,marginBottom:20,borderBottom:'2px solid #e9ecef'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'10px 16px',background:'none',border:'none',cursor:'pointer',fontSize:14,fontWeight:500,
            color:tab===t.id?'#4361ee':'#6c757d',
            borderBottom:tab===t.id?'2px solid #4361ee':'2px solid transparent',
            marginBottom:-2,transition:'all .15s'
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'pages' && (
        <div>
          <div {...getRootProps()} style={{
            border:`2px dashed ${isDragActive?'#4361ee':'#dee2e6'}`,borderRadius:12,padding:'40px 24px',
            textAlign:'center',cursor:'pointer',marginBottom:24,
            background:isDragActive?'#f0f4ff':'#fafafa',transition:'all .15s'
          }}>
            <input {...getInputProps()}/>
            <CloudArrowUpIcon style={{width:40,color:isDragActive?'#4361ee':'#adb5bd',marginBottom:12}}/>
            {uploading ? (
              <div>
                <p style={{fontWeight:500,color:'#4361ee',marginBottom:8}}>Procesando PDF... {uploadProgress}%</p>
                <div style={{background:'#e9ecef',borderRadius:4,height:6,overflow:'hidden',width:'100%',maxWidth:300,margin:'0 auto'}}>
                  <div style={{background:'#4361ee',height:'100%',width:`${uploadProgress}%`,transition:'width .3s'}}/>
                </div>
              </div>
            ) : (
              <>
                <p style={{fontWeight:500,color:'#1a1a2e',marginBottom:4}}>Arrastra tu PDF aquí o haz clic para seleccionar</p>
                <p style={{fontSize:13,color:'#6c757d'}}>PDF hasta 50MB · Las páginas se convierten automáticamente</p>
              </>
            )}
          </div>

          {pub.page_count > 0 ? (
            <div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <p style={{color:'#6c757d',margin:0,fontSize:14}}>{pub.page_count} páginas</p>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:10}}>
                {pub.pages?.map(p=>(
                  <div key={p.id} style={{background:'#f8f9fa',borderRadius:8,overflow:'hidden',border:'1px solid #e9ecef'}}>
                    {p.thumbnail_url ? (
                      <img src={p.thumbnail_url} alt={`Pág ${p.page_number}`} style={{width:'100%',aspectRatio:'0.7',objectFit:'cover'}}/>
                    ) : (
                      <div style={{aspectRatio:'0.7',background:'#e9ecef',display:'flex',alignItems:'center',justifyContent:'center',color:'#6c757d',fontSize:11}}>
                        Pág {p.page_number}
                      </div>
                    )}
                    <div style={{padding:'6px 8px',fontSize:11,color:'#6c757d',textAlign:'center'}}>Pág {p.page_number}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{textAlign:'center',padding:'40px 0',color:'#adb5bd'}}>
              <p>Sube un PDF para generar las páginas del flipbook</p>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div style={{maxWidth:480}}>
          {[
            {label:'Título',key:'title',type:'text'},
            {label:'Descripción',key:'description',type:'textarea'},
            {label:'Color de fondo',key:'background_color',type:'color'},
            {label:'Duración de giro (ms)',key:'flip_duration',type:'number'},
          ].map(({label,key,type})=>(
            <div key={key} style={{marginBottom:18}}>
              <label style={{display:'block',fontSize:13,fontWeight:600,color:'#495057',marginBottom:6}}>{label}</label>
              {type==='textarea'?(
                <textarea defaultValue={pub[key]||''}
                  onBlur={e=>updateMut.mutate({[key]:e.target.value})}
                  style={{width:'100%',padding:'9px 12px',border:'1px solid #dee2e6',borderRadius:8,fontSize:14,resize:'vertical',minHeight:80,outline:'none',boxSizing:'border-box'}}/>
              ):(
                <input type={type} defaultValue={pub[key]||''}
                  onBlur={e=>updateMut.mutate({[key]:type==='number'?parseInt(e.target.value):e.target.value})}
                  style={{width:'100%',padding:'9px 12px',border:'1px solid #dee2e6',borderRadius:8,fontSize:14,outline:'none',boxSizing:'border-box'}}/>
              )}
            </div>
          ))}
          <div style={{marginBottom:18}}>
            <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
              <input type="checkbox" defaultChecked={pub.show_controls}
                onChange={e=>updateMut.mutate({show_controls:e.target.checked})} style={{width:16,height:16}}/>
              <span style={{fontSize:14,color:'#495057'}}>Mostrar controles de navegación</span>
            </label>
          </div>
          <div style={{marginBottom:18}}>
            <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
              <input type="checkbox" defaultChecked={pub.allow_download}
                onChange={e=>updateMut.mutate({allow_download:e.target.checked})} style={{width:16,height:16}}/>
              <span style={{fontSize:14,color:'#495057'}}>Permitir descarga</span>
            </label>
          </div>
          {pub.status==='published' && (
            <div style={{background:'#f0f4ff',borderRadius:8,padding:14,border:'1px solid #c7d2fe'}}>
              <p style={{fontSize:13,color:'#4361ee',margin:'0 0 6px',fontWeight:600}}>URL pública</p>
              <code style={{fontSize:13,color:'#3730a3',wordBreak:'break-all'}}>{window.location.origin}/view/{pub.slug}</code>
            </div>
          )}
        </div>
      )}

      {tab === 'analytics' && (
        <div>
          {!analytics ? <div style={{color:'#6c757d'}}>Cargando analytics...</div> : (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
                {[
                  {label:'Visitas totales',value:analytics.total_views},
                  {label:'Visitas únicas',value:analytics.unique_views},
                  {label:'Páginas leídas (prom)',value:analytics.avg_pages_read.toFixed(1)},
                  {label:'Tiempo (prom, seg)',value:analytics.avg_time_spent.toFixed(0)},
                ].map(s=>(
                  <div key={s.label} style={{background:'#fff',borderRadius:12,padding:'16px 20px',border:'1px solid #e9ecef',textAlign:'center'}}>
                    <div style={{fontSize:28,fontWeight:700,color:'#1a1a2e'}}>{s.value}</div>
                    <div style={{fontSize:12,color:'#6c757d',marginTop:4}}>{s.label}</div>
                  </div>
                ))}
              </div>
              {analytics.views_by_day.length > 0 && (
                <div style={{background:'#fff',borderRadius:12,padding:'20px 24px',border:'1px solid #e9ecef'}}>
                  <h3 style={{margin:'0 0 16px',fontSize:15,color:'#1a1a2e'}}>Visitas últimos 30 días</h3>
                  <div style={{display:'flex',alignItems:'flex-end',gap:4,height:80}}>
                    {analytics.views_by_day.map(d=>{
                      const max = Math.max(...analytics.views_by_day.map(x=>x.views));
                      return (
                        <div key={d.date} title={`${d.date}: ${d.views}`}
                          style={{flex:1,background:'#4361ee',borderRadius:2,height:`${(d.views/max)*100}%`,minHeight:4,opacity:.8}}/>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
