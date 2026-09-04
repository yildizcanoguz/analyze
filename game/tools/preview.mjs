import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync(new URL('../src/content/map.json', import.meta.url)));
const G = { sea:'·', mountains:'▲', hills:'∧', forest:'♠', plains:'.', steppe:'"', drylands:':', desert:' ' };
const byIdx = m.provinces;
let s='';
for (let y=0;y<m.H;y+=3){
  for (let x=0;x<m.W;x+=2){
    const o=m.owner[y*m.W+x];
    s += o<0 ? (m.height[y*m.W+x]>-0.12?'~':'·') : (G[byIdx[o].terrain]||'?');
  }
  s+='\n';
}
console.log(s);
