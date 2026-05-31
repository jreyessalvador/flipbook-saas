import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { pubAPI } from '../services/api';
import { ChevronLeftIcon, ChevronRightIcon, MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon } from '@heroicons/react/24/outline';

export default function FlipbookViewer() {
  const { slug } = useParams();
  const bookRef = useRef(null);
  const pageFlipRef = useRef(null);
  const [pub, setPub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    pubAPI.publicView(slug).then(data => {
      setPub(data);
      setLoading(false);
    }).catch(() => {
      setError('Publicación no encontrada o no disponible.');
      setLoading(false);
    });
  }, [slug]);

  useEffect(() => {
    if (!pub || !bookRef.current) return;
    import('page-flip').then(({ PageFlip }) => {
      if (pageFlipRef.current) {
        pageFlipRef.current.destroy();
        pageFlipRef.current = null;
      }
      if (!bookRef.current) return;

      const w = Math.min(window.innerWidth * 0.42, 500);
      const h = w * 1.41;

      const pf = new PageFlip(bookRef.current, {
        width: w,
        height: h,
        size: 'stretch',
        minWidth: 200,
        maxWidth: 600,
        minHeight: 280,
        maxHeight: 860,
        drawShadow: true,
        flippingTime: pub.flip_duration || 800,
        usePortrait: true,
        startPage: 0,
        autoSize: true,
        showCover: true,
        mobileScrollSupport: false,
        clickEventForward: false,
        useMouseEvents: true,
      });

      const container = document.getElementById('pf-pages');
      if (!container) return;
      container.innerHTML = '';
      pub.pages.forEach(p => {
        const div = document.createElement('div');
        div.className = 'page';
        div.style.cssText = 'background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;';
        const img = document.createElement('img');
        img.src = p.image_url;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        img.alt = `Página ${p.page_number}`;
        div.appendChild(img);
        container.appendChild(div);
      });

      pf.loadFromHTML(container.querySelectorAll('.page'));
      pf.on('flip', (e) => setCurrentPage(e.data));
      pf.on('changeState', () => {});
      pageFlipRef.current = pf;
    });
    return () => {
      if (pageFlipRef.current) {
        try { pageFlipRef.current.destroy(); } catch(e) {}
        pageFlipRef.current = null;
      }
    };
  }, [pub]);

  const goPrev = () => pageFlipRef.current?.flipPrev();
  const goNext = () => pageFlipRef.current?.flipNext();

  if (loading) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a2e',color:'#fff'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>📚</div>
        <p>Cargando flipbook...</p>
      </div>
    </div>
  );

  if (error || !pub) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#1a1a2e',color:'#fff'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:12}}>📕</div>
        <p>{error || 'No disponible'}</p>
        <a href="/" style={{color:'#e2b96a',marginTop:8,display:'inline-block'}}>Volver al inicio</a>
      </div>
    </div>
  );

  return (
    <div style={{
      minHeight:'100vh',
      background:`${pub.background_color || '#1a1a2e'}`,
      display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
      padding:'20px 0',fontFamily:'sans-serif'
    }}>
      <div style={{textAlign:'center',marginBottom:20}}>
        <h1 style={{color:'#fff',fontSize:22,fontWeight:700,margin:0,textShadow:'0 2px 8px rgba(0,0,0,.4)'}}>{pub.title}</h1>
        {pub.description && <p style={{color:'rgba(255,255,255,.7)',fontSize:14,margin:'4px 0 0'}}>{pub.description}</p>}
      </div>

      <div style={{transform:`scale(${zoom})`,transition:'transform .2s',transformOrigin:'center center'}}>
        <div ref={bookRef} style={{boxShadow:'0 30px 80px rgba(0,0,0,.5)',borderRadius:2}}>
          <div id="pf-pages" style={{display:'none'}}/>
        </div>
      </div>

      {pub.show_controls && (
        <div style={{
          display:'flex',alignItems:'center',gap:12,marginTop:28,
          background:'rgba(255,255,255,.1)',backdropFilter:'blur(10px)',
          borderRadius:50,padding:'10px 20px',border:'1px solid rgba(255,255,255,.2)'
        }}>
          <button onClick={goPrev} style={{
            background:'none',border:'none',color:'#fff',cursor:'pointer',
            display:'flex',alignItems:'center',padding:4,borderRadius:'50%',
            transition:'background .15s'
          }} onMouseEnter={e=>e.target.style.background='rgba(255,255,255,.2)'}
            onMouseLeave={e=>e.target.style.background='none'}>
            <ChevronLeftIcon style={{width:24}}/>
          </button>

          <span style={{color:'rgba(255,255,255,.8)',fontSize:13,minWidth:80,textAlign:'center'}}>
            {currentPage + 1} / {pub.page_count}
          </span>

          <button onClick={goNext} style={{
            background:'none',border:'none',color:'#fff',cursor:'pointer',
            display:'flex',alignItems:'center',padding:4,borderRadius:'50%',
            transition:'background .15s'
          }} onMouseEnter={e=>e.target.style.background='rgba(255,255,255,.2)'}
            onMouseLeave={e=>e.target.style.background='none'}>
            <ChevronRightIcon style={{width:24}}/>
          </button>

          <div style={{width:'1px',height:20,background:'rgba(255,255,255,.2)'}}/>

          <button onClick={()=>setZoom(z=>Math.min(z+0.1,2))} style={{
            background:'none',border:'none',color:'#fff',cursor:'pointer',display:'flex',alignItems:'center',padding:4
          }}><MagnifyingGlassPlusIcon style={{width:20}}/></button>

          <button onClick={()=>setZoom(z=>Math.max(z-0.1,0.5))} style={{
            background:'none',border:'none',color:'#fff',cursor:'pointer',display:'flex',alignItems:'center',padding:4
          }}><MagnifyingGlassMinusIcon style={{width:20}}/></button>

          {pub.allow_download && (
            <a href={`/api/publications/${pub.id}/download`} style={{color:'rgba(255,255,255,.8)',fontSize:12,textDecoration:'none',padding:'4px 8px',border:'1px solid rgba(255,255,255,.3)',borderRadius:6}}>
              ↓ PDF
            </a>
          )}
        </div>
      )}

      <div style={{marginTop:16,color:'rgba(255,255,255,.3)',fontSize:11}}>
        Powered by Flipbook SaaS · Cetrix Solutions
      </div>
    </div>
  );
}
