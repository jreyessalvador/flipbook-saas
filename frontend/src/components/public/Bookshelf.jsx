import React from 'react';
import BookshelfCover from './BookshelfCover';
import '../../styles/Bookshelf.css';

// Estanteria publica (kiosco): balda azul marino + dorado.
//  layout="row"  -> una balda con desplazamiento horizontal (landing; featuredFirst
//                   destaca la edicion mas reciente con la etiqueta «Último número»)
//  layout="grid" -> rejilla de baldas (pagina de coleccion)
const Bookshelf = ({ items, layout = 'row', featuredFirst = false, embed = false, label }) => (
  <ul className={`shelf shelf-${layout}`} aria-label={label}>
    {items.map((pub, i) => (
      <BookshelfCover key={pub.id} pub={pub} featured={featuredFirst && i === 0} embed={embed} priority={i < 2} />
    ))}
  </ul>
);

export default Bookshelf;
