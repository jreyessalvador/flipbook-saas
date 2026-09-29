// Lote ED-1: prueba unitaria del portapapeles. Uso (desde frontend/):
//   ver RECETA-DESARROLLO.md §18 -- se genera store.mjs/helpers.mjs con stub de elementAPI.
import { createPageEditorStore } from './store.mjs';
import { cloneForClipboard, prepareClipboardForPaste } from './helpers.mjs';
import assert from 'node:assert';
const s = createPageEditorStore();
await s.getState().loadPage('p1');
const st=s.getState();
const clip = st.elements.map(cloneForClipboard);
assert(!('id' in clip[0]));
// same pub, offset 16, clamp to page 630x891
let prep = prepareClipboardForPaste(clip,{offset:16,samePublication:true,pageW:630,pageH:891});
assert.equal(prep[0].x, 510); // 600+16 clamped to 630-120
assert.equal(prep[0].props.target_page_id,'p9');
assert.equal(prep[1].props.locked,false);
assert.equal(clip[1].props.locked,true); // original untouched
const ids = s.getState().pasteElements(prep);
const e=s.getState();
assert.equal(e.elements.length,4); assert.deepEqual(e.selectedElementIds,ids);
assert(ids.every(i=>i.startsWith('tmp-'))); assert.equal(e.isDirty,true);
const pasted=e.elements.filter(x=>ids.includes(x.id));
assert.deepEqual(pasted.map(p=>p.z_index),[4,5]); // order preserved: image(1)->4, hotspot(3)->5
assert.equal(pasted[1].kind,'hotspot');
// other publication clears target
prep = prepareClipboardForPaste(clip,{offset:0,samePublication:false,pageW:630,pageH:891});
assert.equal(prep[0].props.target_page_id,'');
// mutation isolation
s.getState().updateElement(ids[1],{x:1}); assert.equal(clip[0].x,600);
console.log('ED-1 unit OK');
