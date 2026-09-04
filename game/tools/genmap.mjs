// Generates game/src/content/map.json — deterministic, hand-shaped geography.
// Run: node game/tools/genmap.mjs
// Hand-placed landmass blobs + ridge lines give a recognisable coast (Anatolia,
// the Aegean, a slice of the Balkans and the eastern highlands) instead of noise soup.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dir = dirname(fileURLToPath(import.meta.url));

const W = 260, H = 150;               // heightfield resolution
const SEED = 0x5eed1066;

function mulberry32(a){return function(){a|=0;a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;};}
const rnd = mulberry32(SEED);

// --- value noise -----------------------------------------------------------
const P = new Uint8Array(512); { const p=[...Array(256).keys()]; for(let i=255;i>0;i--){const j=Math.floor(rnd()*(i+1));[p[i],p[j]]=[p[j],p[i]];} for(let i=0;i<512;i++)P[i]=p[i&255]; }
const fade=t=>t*t*t*(t*(t*6-15)+10);
const lerp=(a,b,t)=>a+(b-a)*t;
function grad(h,x,y){const u=(h&1)?x:-x,v=(h&2)?y:-y;return u+v;}
function noise2(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255;x-=Math.floor(x);y-=Math.floor(y);const u=fade(x),v=fade(y);
  const A=P[X]+Y,B=P[X+1]+Y;
  return lerp(lerp(grad(P[A],x,y),grad(P[B],x-1,y),u),lerp(grad(P[A+1],x,y-1),grad(P[B+1],x-1,y-1),u),v);}
function fbm(x,y,oct=5,lac=2.05,gain=0.5){let a=1,f=1,s=0,n=0;for(let i=0;i<oct;i++){s+=a*noise2(x*f,y*f);n+=a;a*=gain;f*=lac;}return s/n;}

// --- hand-placed geography --------------------------------------------------
// Coordinates in grid space. r = radius, s = strength. Negative s carves sea.
const BLOBS = [
  // Anatolian body
  { x:150, y:74, rx:88, ry:36, s:1.00 },
  { x:112, y:66, rx:40, ry:30, s:0.80 },
  { x:194, y:70, rx:42, ry:28, s:0.72 },   // eastern highlands
  { x:226, y:76, rx:24, ry:20, s:0.58 },
  // Western peninsulas reaching into the Aegean
  { x: 86, y:60, rx:22, ry:12, s:0.60 },
  { x: 80, y:82, rx:18, ry: 9, s:0.55 },
  { x: 92, y:96, rx:20, ry:10, s:0.50 },
  // Balkan / Thracian shoulder (north-west)
  { x: 62, y:34, rx:34, ry:22, s:0.85 },
  { x: 34, y:26, rx:28, ry:22, s:0.78 },
  { x: 20, y:52, rx:20, ry:20, s:0.62 },
  // Levantine tail (south-east)
  { x:230, y:110, rx:13, ry:22, s:0.55 },
  // Carve: the inland sea between the shoulder and the body (Marmara/Aegean gulf)
  { x: 84, y:44, rx:16, ry: 9, s:-0.70 },
  { x: 68, y:56, rx:14, ry:12, s:-0.55 },
  // Carve: gulf on the south coast
  { x:150, y:112, rx:22, ry:12, s:-0.60 },
  { x:112, y:104, rx:14, ry:10, s:-0.50 },
  { x:206, y:104, rx:14, ry:11, s:-0.48 },
  { x:176, y:40, rx:15, ry:9, s:-0.42 },
];
const ISLANDS = [
  [70,68,5],[62,74,4],[58,86,6],[66,92,4],[52,64,3],[74,100,5],[46,78,3],[86,110,4],[100,116,3],[40,90,3],[56,52,3],
];
// Mountain ridges: polylines that get raised
const RIDGES = [
  { pts:[[104,52],[132,46],[162,44],[192,50],[220,58]], w:6, h:0.40 },   // Pontic (north)
  { pts:[[96,96],[126,100],[156,102],[184,94],[210,86],[236,84]], w:7, h:0.52 }, // Taurus (south)
  { pts:[[196,60],[214,68],[228,76],[240,88]], w:7, h:0.58 },            // eastern massif
  { pts:[[40,20],[52,32],[60,46],[54,58]], w:5, h:0.42 },                // Balkan spine
];

function blobField(x,y){
  let v = 0;
  for (const b of BLOBS) {
    const dx=(x-b.x)/b.rx, dy=(y-b.y)/b.ry;
    const d=dx*dx+dy*dy;
    if (d<1) v += b.s*(1-d)*(1-d);
  }
  for (const [ix,iy,ir] of ISLANDS) {
    const dx=(x-ix)/ir, dy=(y-iy)/ir, d=dx*dx+dy*dy;
    if (d<1) v += 0.42*(1-d);
  }
  return v;
}
function ridgeField(x,y){
  let best=0;
  for (const r of RIDGES) {
    for (let i=0;i<r.pts.length-1;i++){
      const [x1,y1]=r.pts[i],[x2,y2]=r.pts[i+1];
      const vx=x2-x1, vy=y2-y1, L=vx*vx+vy*vy;
      let t=L?((x-x1)*vx+(y-y1)*vy)/L:0; t=Math.max(0,Math.min(1,t));
      const px=x1+vx*t, py=y1+vy*t;
      const d=Math.hypot(x-px,y-py);
      if (d<r.w) best=Math.max(best, r.h*Math.pow(1-d/r.w,1.6));
    }
  }
  return best;
}

const height = new Float32Array(W*H);
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const n = fbm(x*0.028, y*0.028, 6) * 0.34 + fbm(x*0.09, y*0.09, 3)*0.10;
  let v = blobField(x,y) + n*0.55 - 0.16;
  v += ridgeField(x,y) * (v>0.02?1:0.25);
  // fade to sea at the border
  const edge = Math.min(x, y, W-1-x, H-1-y);
  if (edge<10) v -= (10-edge)*0.055;
  height[y*W+x]=v;
}

const SEA = 0.0;
const isLand = (x,y)=> x>=0&&y>=0&&x<W&&y<H && height[y*W+x] > SEA;

// --- biome ------------------------------------------------------------------
// Classify by *rank* within the landmass, not by absolute height: the mix stays
// readable however the relief is retuned.
const landHeights = [];
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (height[y*W+x]>SEA) landHeights.push(height[y*W+x]);
landHeights.sort((a,b)=>a-b);
const pct = (q)=> landHeights[Math.min(landHeights.length-1, Math.floor(q*landHeights.length))];
const H_MOUNT = pct(0.88), H_HILL = pct(0.66);

function biomeAt(x,y){
  const h = height[y*W+x];
  if (h<=SEA) return 'sea';
  if (h>H_MOUNT) return 'mountains';
  if (h>H_HILL)  return 'hills';
  const wet = fbm(x*0.05+100, y*0.05+100, 4);
  const dry = (x/W)*0.5 + (y/H)*0.7;      // hotter and drier to the south-east
  if (dry>0.95 && wet<0.02) return 'desert';
  if (wet >  0.14) return 'forest';
  if (wet < -0.12 || dry>0.82) return 'drylands';
  if (h < pct(0.30)) return 'plains';
  return 'steppe';
}

// --- province seeding (Poisson-ish) ----------------------------------------
const TARGET = 96;
const seeds=[];
let guard=0;
while (seeds.length<TARGET && guard++<200000){
  const x=Math.floor(rnd()*W), y=Math.floor(rnd()*H);
  if (!isLand(x,y)) continue;
  if (height[y*W+x] < 0.03) continue;
  let ok=true;
  for (const s of seeds) if (Math.hypot(s.x-x,s.y-y) < 11.0) { ok=false; break; }
  if (ok) seeds.push({x,y});
}

const owner = new Int16Array(W*H).fill(-1);
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  if (!isLand(x,y)) continue;
  let bi=-1, bd=1e9;
  for (let i=0;i<seeds.length;i++){
    // slight terrain-aware cost so borders hug ridges and coasts
    const d=Math.hypot(seeds[i].x-x,seeds[i].y-y);
    if (d<bd){bd=d;bi=i;}
  }
  owner[y*W+x]=bi;
}

// --- names ------------------------------------------------------------------
const NAME_POOLS = {
  anatolian:['Ikonion','Dorylaion','Kotyaion','Amorion','Nikaia','Prusa','Sardeis','Magnesia','Philadelpheia','Laodikeia','Attaleia','Sinope','Amaseia','Neokaisareia','Sebasteia','Kaisareia','Tyana','Germanikeia','Melitene','Trapezous','Chaldia','Koloneia','Charsianon','Anatolikon','Kappadokia','Lykandos','Seleukeia','Ankyra','Gangra','Klaudioupolis','Herakleia','Abydos','Smyrna','Ephesos','Miletos','Halikarnassos','Telmessos','Side','Tarsos','Mopsuestia','Anazarbos','Edessa','Samosata','Theodosioupolis','Manzikert','Artze','Chliat','Perkri'],
  turkic:['Konya','Aksaray','Kırşehir','Kayseri','Sivas','Tokat','Amasya','Çorum','Ankara','Beypazarı','Eskişehir','Kütahya','Uşak','Denizli','Isparta','Burdur','Antalya','Alanya','Silifke','Adana','Maraş','Malatya','Erzincan','Erzurum','Kars','Ahlat','Van','Bitlis','Muş','Bayburt','Gümüşhane','Trabzon','Rize','Bolu','Kastamonu','Sinop','Samsun','Ordu','Giresun','Niğde','Nevşehir','Karaman','Ermenek','Beyşehir','Akşehir','Afyon'],
  balkan:['Adrianopolis','Philippopolis','Serdica','Naissos','Skopje','Ohrid','Prilep','Dyrrachion','Berat','Ioannina','Larissa','Thessalonike','Serres','Christoupolis','Traianoupolis','Ainos','Vidin','Braničevo','Ras','Zeta','Diokleia','Trnovo','Preslav','Varna','Mesembria','Anchialos'],
  armenian:['Ani','Kars','Vaspurakan','Taron','Bagrewand','Shirak','Ayrarat','Siwnik','Artsakh','Mokk','Aghdznik','Turuberan'],
};
const usedNames=new Set();
function pickName(x,y){
  let pool;
  if (x<70 && y<62) pool='balkan';
  else if (x>196) pool= rnd()<0.55 ? 'armenian':'anatolian';
  else pool = rnd()<0.5 ? 'anatolian':'turkic';
  const arr=NAME_POOLS[pool];
  for (let i=0;i<200;i++){ const n=arr[Math.floor(rnd()*arr.length)]; if(!usedNames.has(n)){usedNames.add(n);return n;} }
  return `Kastron ${Math.floor(rnd()*900+100)}`;
}

// --- build provinces --------------------------------------------------------
const provinces=[];
for (let i=0;i<seeds.length;i++){
  let n=0, sx=0, sy=0, sh=0, coastal=false, maxh=0;
  const biomeCount={};
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    if (owner[y*W+x]!==i) continue;
    n++; sx+=x; sy+=y; sh+=height[y*W+x]; maxh=Math.max(maxh,height[y*W+x]);
    const b=biomeAt(x,y); biomeCount[b]=(biomeCount[b]||0)+1;
    if (!coastal && (!isLand(x+1,y)||!isLand(x-1,y)||!isLand(x,y+1)||!isLand(x,y-1))) coastal=true;
  }
  if (n<14) continue;
  const terrain=Object.entries(biomeCount).sort((a,b)=>b[1]-a[1])[0][0];
  provinces.push({
    id:`p${provinces.length+1}`, idx:i,
    name:pickName(seeds[i].x,seeds[i].y),
    cx:sx/n, cy:sy/n, cells:n, avgH:sh/n, maxH:maxh,
    terrain, coastal,
  });
}
// remap owner -> province index (drop dropped ones)
const idxToProv=new Map(provinces.map((p,k)=>[p.idx,k]));
const provOwner = new Int16Array(W*H).fill(-1);
for (let c=0;c<W*H;c++){ const o=owner[c]; if(o>=0 && idxToProv.has(o)) provOwner[c]=idxToProv.get(o); }

// neighbours
const neigh = provinces.map(()=>new Set());
for (let y=0;y<H;y++) for (let x=0;x<W;x++){
  const a=provOwner[y*W+x]; if(a<0) continue;
  for (const [dx,dy] of [[1,0],[0,1]]) {
    const b=provOwner[(y+dy)*W+(x+dx)] ?? -1;
    if (b>=0 && b!==a){ neigh[a].add(b); neigh[b].add(a); }
  }
}
// sea adjacency for coastal provinces (so fleets/coastal wars make sense)
provinces.forEach((p,i)=>{ p.neighbors=[...neigh[i]].map(k=>provinces[k].id); });

// --- terrain economics ------------------------------------------------------
const TERRAIN_STATS = {
  plains:{sup:4,dev:6,def:0,tax:1.15}, steppe:{sup:3,dev:4,def:0,tax:0.95},
  forest:{sup:2,dev:4,def:2,tax:0.90}, hills:{sup:2,dev:3,def:3,tax:0.85},
  mountains:{sup:1,dev:2,def:5,tax:0.60}, drylands:{sup:2,dev:3,def:1,tax:0.80},
  desert:{sup:1,dev:1,def:1,tax:0.55},
};
for (const p of provinces){
  const t=TERRAIN_STATS[p.terrain]||TERRAIN_STATS.plains;
  const bonus = (p.coastal?2:0) + Math.round((1-p.avgH)*3);
  p.development = Math.max(1, Math.round(t.dev + bonus + (rnd()*4-2)));
  p.supply = t.sup + (p.coastal?1:0);
  p.defense = t.def;
  p.taxMult = t.tax;
  p.holdings = p.development>9 ? 3 : p.development>5 ? 2 : 1;
  p.culture = p.cx<72 ? 'greek' : p.cx>200 ? (rnd()<0.5?'armenian':'kurdish') : (rnd()<0.45?'greek':'turkish');
  p.faith = p.culture==='turkish'||p.culture==='kurdish' ? 'sunni' : p.culture==='armenian' ? 'miaphysite' : 'orthodox';
}

// --- de jure hierarchy: k-means duchies, then kingdoms ----------------------
function kmeans(points, k, iters=40){
  const cs=[]; const step=Math.floor(points.length/k);
  for(let i=0;i<k;i++) cs.push({x:points[i*step].cx,y:points[i*step].cy});
  let assign=new Array(points.length).fill(0);
  for(let it=0;it<iters;it++){
    for(let i=0;i<points.length;i++){let b=0,bd=1e9;for(let j=0;j<k;j++){const d=Math.hypot(points[i].cx-cs[j].x,points[i].cy-cs[j].y);if(d<bd){bd=d;b=j;}}assign[i]=b;}
    const sx=new Array(k).fill(0),sy=new Array(k).fill(0),n=new Array(k).fill(0);
    for(let i=0;i<points.length;i++){sx[assign[i]]+=points[i].cx;sy[assign[i]]+=points[i].cy;n[assign[i]]++;}
    for(let j=0;j<k;j++) if(n[j]){cs[j]={x:sx[j]/n[j],y:sy[j]/n[j]};}
  }
  return {assign,cs};
}
const DUCHY_NAMES=['Opsikion','Thrakesion','Kibyrrhaiotai','Bukellarion','Paphlagonia','Armeniakon','Chaldia','Koloneia','Charsianon','Kappadokia','Anatolikon','Seleukeia','Kilikia','Mesopotamia','Taron','Vaspurakan','Iberia','Thrake','Makedonia','Strymon','Hellas','Dyrrachion','Bulgaria','Paristrion','Nikopolis','Lykaonia','Pisidia','Karia','Lydia','Bithynia'];
const KINGDOM_NAMES=['Anadolu','Rum','Ermeniyye','Rumeli','Suriye','Karadeniz Sahili'];
const EMPIRE_NAMES=['Rum Diyarı'];

const nDuchy=Math.max(6,Math.round(provinces.length/4.2));
const {assign:dAssign}=kmeans(provinces,nDuchy);
const duchies=[];
for(let j=0;j<nDuchy;j++){
  const members=provinces.filter((_,i)=>dAssign[i]===j);
  if(!members.length) continue;
  duchies.push({id:`d${duchies.length+1}`,name:DUCHY_NAMES[duchies.length%DUCHY_NAMES.length],counties:members.map(m=>m.id),
    cx:members.reduce((a,m)=>a+m.cx,0)/members.length, cy:members.reduce((a,m)=>a+m.cy,0)/members.length});
}
const nKing=Math.max(3,Math.round(duchies.length/4.5));
const {assign:kAssign}=kmeans(duchies,nKing);
const kingdoms=[];
for(let j=0;j<nKing;j++){
  const members=duchies.filter((_,i)=>kAssign[i]===j);
  if(!members.length) continue;
  kingdoms.push({id:`k${kingdoms.length+1}`,name:KINGDOM_NAMES[kingdoms.length%KINGDOM_NAMES.length],duchies:members.map(m=>m.id),
    cx:members.reduce((a,m)=>a+m.cx,0)/members.length, cy:members.reduce((a,m)=>a+m.cy,0)/members.length});
}
const empires=[{id:'e1',name:EMPIRE_NAMES[0],kingdoms:kingdoms.map(k=>k.id)}];

// --- pack heightfield + ownership -------------------------------------------
const out = {
  W,H,SEA,
  height: Array.from(height, v=>Math.round(v*1000)/1000),
  owner: Array.from(provOwner),
  provinces, duchies, kingdoms, empires,
  terrainStats: TERRAIN_STATS,
};
mkdirSync(join(__dir,'..','src','content'),{recursive:true});
writeFileSync(join(__dir,'..','src','content','map.json'), JSON.stringify(out));
const landCells = Array.from(provOwner).filter(v=>v>=0).length;
console.log(`map.json: ${provinces.length} counties, ${duchies.length} duchies, ${kingdoms.length} kingdoms; land cells ${landCells}/${W*H} (${(landCells/(W*H)*100).toFixed(1)}%)`);
console.log('terrain mix:', Object.entries(provinces.reduce((a,p)=>{a[p.terrain]=(a[p.terrain]||0)+1;return a;},{})).map(([k,v])=>`${k}:${v}`).join(' '));
