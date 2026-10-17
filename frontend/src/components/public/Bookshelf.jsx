import React, { useLayoutEffect, useRef } from 'react';
import BookshelfCover from './BookshelfCover';
import '../../styles/Bookshelf.css';

// Estanteria publica (kiosco): libreria de madera noble sobre fondo azul marino.
//  layout="row"  -> una balda con desplazamiento horizontal (landing). Las ediciones van en el
//                   orden que fija la empresa (izquierda -> derecha); la ultima (la mas a la
//                   derecha) es el «Último número» y la balda se abre mostrandola.
//  layout="grid" -> rejilla de baldas (pagina de coleccion)
//  flagId        -> id de la edicion que lleva la etiqueta «Último número»
const Bookshelf = ({ items, layout = 'row', flagId = null, embed = false, label }) => {
  const ref = useRef(null);
  // En movil la balda se desplaza: se abre en el extremo derecho, donde esta la edicion mas reciente.
  useLayoutEffect(() => {
    const el = ref.current;
    if (layout === 'row' && el && el.scrollWidth > el.clientWidth) el.scrollLeft = el.scrollWidth;
  }, [layout, items]);
  const list = (
    <ul ref={ref} className={`shelf shelf-${layout}`} aria-label={label}>
      {items.map((pub, i) => (
        <BookshelfCover key={pub.id} pub={pub} featured={flagId != null && pub.id === flagId} embed={embed} priority={i < 2} />
      ))}
    </ul>
  );
  // En la balda de una sola fila la tabla de madera ocupa todo el ancho (los libros se deslizan sobre ella)
  return layout === 'row' ? <div className="shelf-board">{list}</div> : list;
};

export default Bookshelf;
