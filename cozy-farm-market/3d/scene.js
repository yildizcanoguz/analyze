(function(){
const cvs=document.getElementById('c');
const W=()=>cvs.clientWidth||innerWidth, H=()=>cvs.clientHeight||innerHeight;
const renderer=new THREE.WebGLRenderer({canvas:cvs,antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.14;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
(function(){const c=document.createElement('canvas');c.width=8;c.height=256;const ctx=c.getContext('2d');const g=ctx.createLinearGradient(0,0,0,256);g.addColorStop(0,'#8ec9ee');g.addColorStop(.55,'#bfe0f2');g.addColorStop(1,'#f4e7cf');ctx.fillStyle=g;ctx.fillRect(0,0,8,256);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;scene.background=t;})();
scene.fog=new THREE.Fog(0xcfe2ec,36,80);

// ---- camera + manual orbit ----
const camTarget=new THREE.Vector3(0,0.6,1.5);
let yaw=0.72, camH=15, dist=22, dsize=12.5;
const cam=new THREE.OrthographicCamera(-1,1,1,-1,0.1,220);
function fitCam(){const a=W()/H();cam.left=-dsize*a;cam.right=dsize*a;cam.top=dsize;cam.bottom=-dsize;cam.updateProjectionMatrix();renderer.setSize(W(),H(),false);}
function updateCam(){cam.position.set(camTarget.x+Math.cos(yaw)*dist,camH,camTarget.z+Math.sin(yaw)*dist);cam.lookAt(camTarget);}

// ---- lights ----
const sun=new THREE.DirectionalLight(0xffe6bc,2.9);sun.position.set(14,20,8);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=-22;sc.right=22;sc.top=22;sc.bottom=-22;sc.near=1;sc.far=64;sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.03;sun.shadow.radius=3;scene.add(sun,sun.target);
scene.add(new THREE.HemisphereLight(0xdcecff,0x6f9a4e,0.8));
const fill=new THREE.DirectionalLight(0xffe4c0,0.32);fill.position.set(-10,8,-6);scene.add(fill);
(function(){const s=new THREE.Mesh(new THREE.SphereGeometry(2.2,20,20),new THREE.MeshBasicMaterial({color:0xfff4d0}));s.position.copy(sun.position).multiplyScalar(1.3);scene.add(s);const halo=new THREE.Sprite(new THREE.SpriteMaterial({color:0xffe9a8,transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending}));halo.scale.set(16,16,1);halo.position.copy(s.position);scene.add(halo);})();

// ---- helpers ----
const MAT=(c,r,m)=>new THREE.MeshStandardMaterial({color:c,roughness:r==null?.9:r,metalness:m||0});
function box(w,h,d,mat,cast){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.castShadow=cast!==false;m.receiveShadow=true;return m;}
function cyl(a,b,h,mat,s){const m=new THREE.Mesh(new THREE.CylinderGeometry(a,b,h,s||16),mat);m.castShadow=true;m.receiveShadow=true;return m;}
function cone(r,h,mat,s){const m=new THREE.Mesh(new THREE.ConeGeometry(r,h,s||16),mat);m.castShadow=true;m.receiveShadow=true;return m;}
function sph(r,mat){const m=new THREE.Mesh(new THREE.SphereGeometry(r,16,14),mat);m.castShadow=true;m.receiveShadow=true;return m;}
function at(m,x,y,z){m.position.set(x,y,z);return m;}

// ---- prosedürel el işi dokular (teknik-sanatçı; harici varlık yok) ----
function mkTex(sz,fn,rep,srgb){const c=document.createElement('canvas');c.width=c.height=sz;const x=c.getContext('2d');fn(x,sz);const t=new THREE.CanvasTexture(c);if(srgb!==false)t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep||1,rep||1);t.anisotropy=4;return t;}
function rr(a,b){return a+Math.random()*(b-a);}
// seamless organic grass — no directional gradient (kills banding); wrapped
// patches/blades/wildflowers so it tiles cleanly. 3x3 offset draws = perfect wrap.
const T_grass=mkTex(512,(x,s)=>{
  x.fillStyle='#71ad49';x.fillRect(0,0,s,s);
  const wrap=(fn)=>{for(let ax=-1;ax<=1;ax++)for(let ay=-1;ay<=1;ay++)fn(ax*s,ay*s);};
  for(let i=0;i<26;i++){const bx=Math.random()*s,by=Math.random()*s,br=rr(48,100),light=Math.random()<.5;
    wrap((ox,oy)=>{const g=x.createRadialGradient(bx+ox,by+oy,0,bx+ox,by+oy,br);const col=light?'rgba(154,202,112,':'rgba(80,138,58,';g.addColorStop(0,col+'.42)');g.addColorStop(1,col+'0)');x.fillStyle=g;x.fillRect(bx+ox-br,by+oy-br,br*2,br*2);});}
  for(let i=0;i<4200;i++){x.fillStyle=['#7fbb56','#66a340','#8ecb62','#5b9139'][i&3];x.globalAlpha=.32;x.fillRect(Math.random()*s,Math.random()*s,rr(1,2.2),rr(1,2.6));}
  x.globalAlpha=1;x.lineWidth=1;
  for(let i=0;i<460;i++){const px=Math.random()*s,py=Math.random()*s,h=rr(4,9),lean=rr(-2,2),cc=Math.random()<.5?'#95d270':'#4d8833';wrap((ox,oy)=>{x.strokeStyle=cc;x.beginPath();x.moveTo(px+ox,py+oy);x.lineTo(px+ox+lean,py+oy-h);x.stroke();});}
  for(let i=0;i<30;i++){const px=Math.random()*s,py=Math.random()*s,fc=['#ffd34d','#ff7fa3','#ffffff','#b98cff'][i&3],rad=rr(1.6,2.4);wrap((ox,oy)=>{x.fillStyle=fc;x.beginPath();x.arc(px+ox,py+oy,rad,0,7);x.fill();x.fillStyle='#fff6c0';x.beginPath();x.arc(px+ox,py+oy,rad*.4,0,7);x.fill();});}
},26);
const T_soil=mkTex(256,(x,s)=>{x.fillStyle='#7c4e2d';x.fillRect(0,0,s,s);for(let i=0;i<2600;i++){x.fillStyle=['#8a5a34','#673d20','#94663b','#5c3319'][i&3];x.globalAlpha=.55;x.fillRect(Math.random()*s,Math.random()*s,rr(1.5,3.5),rr(1.5,3.5));}x.globalAlpha=1;x.strokeStyle='#5a3419';x.lineWidth=3;for(let r=0;r<6;r++){const y=(r+.5)/6*s;x.beginPath();for(let px=0;px<=s;px+=8)x.lineTo(px,y+Math.sin(px*.05+r)*2);x.stroke();}},2);
const T_plaster=mkTex(256,(x,s)=>{x.fillStyle='#ffffff';x.fillRect(0,0,s,s);for(let i=0;i<2200;i++){x.fillStyle=Math.random()<.5?'#efe7d6':'#fffdf6';x.globalAlpha=.4;x.fillRect(Math.random()*s,Math.random()*s,rr(2,5),rr(2,5));}x.globalAlpha=1;},2);
const T_roof=mkTex(256,(x,s)=>{x.fillStyle='#c0663f';x.fillRect(0,0,s,s);const rows=7,cols=8,rh=s/rows,cw=s/cols;for(let r=0;r<rows;r++){for(let c=0;c<cols;c++){const off=(r%2)*cw/2,px=c*cw+off,py=r*rh;x.fillStyle=['#c86a41','#b85c37','#d1734a','#ad5330'][(r+c)&3];x.beginPath();x.moveTo(px,py+rh);x.lineTo(px,py+rh*.4);x.arc(px+cw/2,py+rh*.4,cw/2,Math.PI,0);x.lineTo(px+cw,py+rh);x.closePath();x.fill();}x.strokeStyle='rgba(90,40,25,.4)';x.lineWidth=2;x.beginPath();x.moveTo(0,r*rh+rh);x.lineTo(s,r*rh+rh);x.stroke();}},3);
const T_water=mkTex(256,(x,s)=>{x.fillStyle='#4f9fd4';x.fillRect(0,0,s,s);for(let r=0;r<10;r++){x.strokeStyle=r%2?'rgba(150,205,235,.6)':'rgba(210,235,250,.5)';x.lineWidth=rr(2,4);const y=r/10*s;x.beginPath();for(let px=0;px<=s;px+=6)x.lineTo(px,y+Math.sin(px*.04+r*1.7)*4);x.stroke();}},2);
const grassMat=new THREE.MeshStandardMaterial({map:T_grass,bumpMap:T_grass,bumpScale:.18,roughness:1});
// striped awning canvas (red/cream) for the market stall
const T_stripe=mkTex(128,(x,s)=>{const n=6,w=s/n;for(let i=0;i<n;i++){x.fillStyle=i%2?'#e8604f':'#fbf3e2';x.fillRect(i*w,0,w+1,s);}for(let i=0;i<600;i++){x.fillStyle='rgba(0,0,0,.05)';x.fillRect(Math.random()*s,Math.random()*s,2,2);}},1,true);
T_stripe.repeat.set(1,1);
const roofMat=new THREE.MeshStandardMaterial({map:T_roof,bumpMap:T_roof,bumpScale:.25,roughness:.8});
const roofMatD=new THREE.MeshStandardMaterial({map:T_roof,color:0xb85a48,bumpMap:T_roof,bumpScale:.25,roughness:.8});
const waterMat=new THREE.MeshStandardMaterial({map:T_water,roughness:.14,metalness:.32,transparent:true,opacity:.94});
function plasterMat(col){return new THREE.MeshStandardMaterial({map:T_plaster,color:col,bumpMap:T_plaster,bumpScale:.12,roughness:.9});}

function gh(x,z){return 0.28*Math.sin(x*0.26)*Math.cos(z*0.22)+0.2*Math.sin(x*0.12+1.2)-0.08;}

// ---- ground ----
(function(){const g=new THREE.PlaneGeometry(74,74,80,80);g.rotateX(-Math.PI/2);const p=g.attributes.position;for(let i=0;i<p.count;i++){p.setY(i,gh(p.getX(i),p.getZ(i)));}g.computeVertexNormals();const gr=new THREE.Mesh(g,grassMat);gr.receiveShadow=true;scene.add(gr);})();
(function(){const cols=[0xef6f8e,0xf6c045,0x8a86e0,0xffffff,0xff9e57];for(let i=0;i<130;i++){const x=(Math.random()-.5)*58,z=(Math.random()-.5)*58;if(Math.abs(x)<7&&z>-3&&z<9)continue;const f=new THREE.Mesh(new THREE.SphereGeometry(0.13,6,5),new THREE.MeshStandardMaterial({color:cols[i%5],roughness:.85,emissive:cols[i%5],emissiveIntensity:.14}));f.position.set(x,gh(x,z)+0.12,z);scene.add(f);}})();

// ---- backdrop village ----
const trees=[];
function tree(x,z,s){s=s||1;const g=new THREE.Group();
  const tr=cyl(0.26*s,0.42*s,2.2*s,MAT(0x8a5a34,1));tr.position.y=1.05*s;g.add(tr);
  const pal=[[0x5aa53c,0x4f9636],[0x6cb04a,0x559a38],[0x529b46,0x408a3a]][Math.floor(Math.random()*3)];
  const fo=new THREE.Group();
  fo.add(at(sph(1.6*s,MAT(pal[0],.95)),0,2.9*s,0));
  fo.add(at(sph(1.15*s,MAT(pal[1],.95)),1*s,2.4*s,.4*s));
  fo.add(at(sph(1.15*s,MAT(pal[1],.95)),-.9*s,2.5*s,-.3*s));
  fo.add(at(sph(1.0*s,MAT(pal[0],.95)),.2*s,3.55*s,-.2*s));
  if(Math.random()<.3){const bc=Math.random()<.5?0xffb3c9:0xfff2f6;for(let k=0;k<16;k++){const bd=sph(.15*s,new THREE.MeshStandardMaterial({color:bc,roughness:.8,emissive:bc,emissiveIntensity:.12}));const a=Math.random()*6.3,rd=(1.25+Math.random()*.55)*s;bd.position.set(Math.cos(a)*rd,(2.5+Math.random())*s,Math.sin(a)*rd);bd.castShadow=false;fo.add(bd);}}
  g.add(fo);g.position.set(x,gh(x,z),z);scene.add(g);trees.push({g:fo,ph:Math.random()*6.3,amp:.03+Math.random()*.03});}
// ---- extra props: market stall, fence, rocks, bushes ----
const woodMat=MAT(0x9c6a3c,.9), woodDk=MAT(0x7a5230,.9);
function rock(x,z,s){s=s||1;const m=new THREE.Mesh(new THREE.DodecahedronGeometry(0.5*s,0),MAT(0xa9a6a0,.95));m.castShadow=true;m.receiveShadow=true;m.position.set(x,gh(x,z)+0.12*s,z);m.rotation.set(Math.random(),Math.random(),Math.random());m.scale.y=0.7;scene.add(m);}
function bush(x,z,s){s=s||1;const g=new THREE.Group();const c=MAT([0x4f9636,0x589f3e,0x6cb04a][Math.floor(Math.random()*3)],.95);[[0,0,0,.62],[.5,-.05,.1,.46],[-.45,-.02,-.1,.48],[.05,.28,-.1,.44]].forEach(([a,b,d,r])=>g.add(at(sph(r*s,c),a*s,(.5+b)*s,d*s)));g.position.set(x,gh(x,z),z);scene.add(g);
  if(Math.random()<.6)for(let k=0;k<6;k++){const bc=['#ef6f8e','#f6c045','#ffffff'][k%3];const fl=new THREE.Mesh(new THREE.SphereGeometry(.09*s,6,5),new THREE.MeshStandardMaterial({color:bc,roughness:.85,emissive:bc,emissiveIntensity:.15}));const a=Math.random()*6.3;fl.position.set(Math.cos(a)*.55*s,(.7+Math.random()*.3)*s,Math.sin(a)*.55*s);fl.castShadow=false;g.add(fl);}}
function fence(x1,z1,x2,z2,n){const dx=(x2-x1)/n,dz=(z2-z1)/n;for(let i=0;i<=n;i++){const px=x1+dx*i,pz=z1+dz*i;const post=box(.16,1.0,.16,woodDk);post.position.set(px,gh(px,pz)+.5,pz);scene.add(post);if(i<n){const mx=px+dx/2,mz=pz+dz/2,len=Math.hypot(dx,dz);for(const yy of[.72,.4]){const rail=box(len,.12,.1,woodMat);rail.position.set(mx,gh(mx,mz)+yy,mz);rail.rotation.y=Math.atan2(dz,dx);scene.add(rail);}}}}
function crate(x,y,z,produce){const g=new THREE.Group();g.add(at(box(.8,.55,.8,woodMat),0,0,0));g.add(at(box(.84,.12,.84,woodDk),0,.24,0));g.add(at(box(.84,.12,.84,woodDk),0,-.18,0));const pc=produce||0xef8a34;for(let k=0;k<5;k++){const b=sph(.16,MAT(pc,.7));b.position.set(rr(-.22,.22),.34+rr(0,.1),rr(-.22,.22));g.add(b);}g.position.set(x,y,z);return g;}
function marketStall(x,z){const g=new THREE.Group();const y0=gh(x,z);
  g.add(at(box(3.2,.7,1.3,woodMat),0,y0+1.05,0));               // counter top
  g.add(at(box(3.2,1.0,.18,woodDk),0,y0+.5,.56));               // counter front
  for(const sx of[-1.45,1.45])for(const sz of[-.5,.5]){const p=cyl(.09,.09,2.4,woodDk);p.position.set(sx,y0+1.2,sz);g.add(p);} // posts
  const aw=box(3.9,.18,1.9,new THREE.MeshStandardMaterial({map:T_stripe,roughness:.85}));aw.position.set(0,y0+2.5,-.05);aw.rotation.x=-0.16;g.add(aw); // awning
  g.add(at(box(3.9,.16,.34,MAT(0xe8604f,.85)),0,y0+2.28,.92));  // awning front trim
  g.add(crate(-.85,y0+1.4,.05,0xef7a2f));                       // carrots
  g.add(crate(.05,y0+1.4,.1,0xe8503a));                         // tomatoes
  g.add(crate(.9,y0+1.4,0,0x8fbe4a));                           // greens
  g.position.set(x,0,z);g.rotation.y=-0.5;scene.add(g);}
function barn(x,z){const g=new THREE.Group();g.add(at(box(5,3.2,3.8,MAT(0xc24d3a,.8)),0,1.6,0));const rf=cone(3.3,2,roofMatD,4);rf.rotation.y=Math.PI/4;rf.position.y=4.2;rf.scale.set(1,1,.78);g.add(rf);g.add(at(box(1.3,1.8,.2,MAT(0xf2e6cd,.8)),0,.9,1.95));const si=cyl(1,1,4.2,MAT(0xdcd4c4,.7));si.position.set(-3.3,2.1,0);g.add(si);const cp=cone(1.05,.9,roofMatD);cp.position.set(-3.3,4.5,0);g.add(cp);g.position.set(x,gh(x,z),z);scene.add(g);}
function cottage(x,z,col){const g=new THREE.Group();g.add(at(box(3.8,2.5,3.2,plasterMat(col)),0,1.25,0));const rf=cone(2.75,1.7,roofMat,4);rf.rotation.y=Math.PI/4;rf.position.y=3.35;rf.scale.set(1,1,.85);g.add(rf);g.add(at(box(.5,1.1,.5,MAT(0x9a5240,.9)),1.1,3.7,.4));for(const sx of[-1,1]){const w=box(.65,.65,.1,MAT(0x8fd0e8,.4,.1));w.position.set(sx,1.4,1.62);g.add(w);}g.add(at(box(.85,1.4,.15,MAT(0x8a5a34,.85)),0,.7,1.62));g.position.set(x,gh(x,z),z);scene.add(g);}
let blades=null;
function windmill(x,z){const g=new THREE.Group();g.add(at(cyl(1,1.6,5,plasterMat(0xf1e9d8)),0,2.5,0));g.add(at(cone(1.4,1.3,roofMatD,16),0,5.65,0));const hub=new THREE.Group();hub.position.set(0,4.2,1.4);for(let i=0;i<4;i++){const bl=box(.45,3.2,.15,MAT(0xe8dcc2,.85));bl.position.y=1.8;const arm=new THREE.Group();arm.add(bl);arm.rotation.z=i*Math.PI/2;hub.add(arm);}g.add(hub);blades=hub;g.position.set(x,gh(x,z),z);scene.add(g);}
function pond(x,z){const p=new THREE.Mesh(new THREE.CircleGeometry(3.6,40),waterMat);p.rotation.x=-Math.PI/2;p.position.set(x,-.02,z);p.receiveShadow=true;scene.add(p);const r=new THREE.Mesh(new THREE.TorusGeometry(3.6,.32,10,44),MAT(0x9a7a52,1));r.rotation.x=-Math.PI/2;r.position.set(x,-.05,z);scene.add(r);}
function cow(x,z){const g=new THREE.Group();g.add(at(box(1.6,.95,.9,MAT(0xfaf6ee,.85)),0,1,0));g.add(at(box(.5,.38,.48,MAT(0x4a4038,.85)),.38,1.15,.45));g.add(at(box(.65,.55,.55,MAT(0xfaf6ee,.85)),-.95,1.15,0));g.add(at(box(.38,.32,.38,MAT(0xf3c9c2,.85)),-1.28,1,0));for(const[a,b]of[[.5,.28],[.5,-.28],[-.38,.28],[-.38,-.28]]){const l=cyl(.13,.13,.85,MAT(0xd7cdbc,.9));l.position.set(a,.42,b);g.add(l);}g.position.set(x,gh(x,z),z);g.rotation.y=Math.random()*3;scene.add(g);}
function sheep(x,z){const g=new THREE.Group();const bo=sph(.8,MAT(0xfbf7ee,.95));bo.position.y=1.05;bo.scale.set(1.2,.95,1);g.add(bo);g.add(at(sph(.4,MAT(0x5f5750,.85)),-.9,1.1,0));for(const[a,b]of[[.38,.28],[.38,-.28],[-.38,.28],[-.38,-.28]]){const l=cyl(.1,.1,.75,MAT(0x5f5750,.9));l.position.set(a,.38,b);g.add(l);}g.position.set(x,gh(x,z),z);g.rotation.y=Math.random()*3;scene.add(g);}
const clouds=[];
function cloud(x,y,z,s){const g=new THREE.Group();const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,emissive:0x99aabb,emissiveIntensity:.05});[[0,0,0,1.6],[1.4,-.2,0,1.1],[-1.3,-.1,.3,1.15],[.3,.4,.2,1]].forEach(([a,b,c,r])=>{const q=sph(r*s,m);q.position.set(a*s,b*s,c*s);q.castShadow=false;g.add(q);});g.position.set(x,y,z);scene.add(g);clouds.push({g,sp:.4+Math.random()*.5});}
const npcs=[];
function npc(pts,col,spd){const g=new THREE.Group();g.add(at(cyl(.32,.42,1,MAT(col,.85)),0,.9,0));g.add(at(sph(.34,MAT(0xf0c9a0,.8)),0,1.75,0));g.add(at(cyl(.12,.44,.28,MAT(0x8a5a34,.85)),0,2,0));scene.add(g);npcs.push({g,pts,t:Math.random(),spd:spd||.06});}

// layout: farm in center-front, village behind/edges
barn(11,-9);cottage(-9,-11,0xf0e2c4);cottage(-2,-13,0xe8d2b0);cottage(5,-12,0xf2dcc0);windmill(-13,-6);pond(13,6);
[[15,3],[16,-4],[-16,-10],[9,15],[-9,15],[17,11],[-17,2],[13,-14],[-15,-14],[2,17],[-4,17],[18,-1]].forEach(([x,z])=>tree(x,z,.75+Math.random()*.5));
cow(-13,10);cow(-15,11);sheep(-12,12);sheep(-14,13);
marketStall(7,6.2);
fence(-16.8,8.4,-10.4,8.4,4);fence(-10.4,8.4,-10.4,14.2,3);fence(-16.8,8.4,-16.8,14.2,3);fence(-16.8,14.2,-10.4,14.2,4);
[[9,7.5],[-5.5,5.5],[6.5,-6.5],[16,4.5],[-8,-9]].forEach(([x,z])=>rock(x,z,.8+Math.random()*.5));
[[-5,6.5],[8.5,9],[-9.5,3.5],[5.5,-7.5],[-6,10.5],[15,9],[11,11],[-17,5]].forEach(([x,z])=>bush(x,z,.85+Math.random()*.4));
cloud(-15,16,-8,1.6);cloud(11,18,7,1.3);cloud(0,15,15,1);cloud(17,17,-2,1.2);
npc([[-9,15],[-6,4],[-6,-6],[-9,-10]],0x5b7fd4,.05);
npc([[9,15],[6,4],[9,-8],[11,-6]],0x6fae52,.045);
npc([[-13,10],[-6,8],[6,8],[13,6]],0xc94f6a,.05);

// =================== FARM GAME ===================
const CROPS={
  carrot:{name:'Havuç',cost:5,grow:12,value:9,col:0xef8a34},
  wheat:{name:'Buğday',cost:6,grow:10,value:13,col:0xe8b74a},
  tomato:{name:'Domates',cost:12,grow:18,value:24,col:0xe8503a},
  pumpkin:{name:'Balkabağı',cost:40,grow:30,value:95,col:0xef8a34},
};
const soilMat=new THREE.MeshStandardMaterial({map:T_soil,bumpMap:T_soil,bumpScale:.3,roughness:1});const soilWetMat=new THREE.MeshStandardMaterial({map:T_soil,color:0x9a8a80,bumpMap:T_soil,bumpScale:.3,roughness:.85});
const plots=[];
const COLS=5, ROWS=4, GAP=1.9;
for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){
  const x=(c-(COLS-1)/2)*GAP, z=(r-(ROWS-1)/2)*GAP+2.5;
  const y=gh(x,z);
  const tile=box(1.55,0.35,1.55,soilMat); tile.position.set(x,y+0.15,z); tile.receiveShadow=true; scene.add(tile);
  const cropHolder=new THREE.Group(); cropHolder.position.set(x,y+0.3,z); scene.add(cropHolder);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.95,0.07,8,28),new THREE.MeshBasicMaterial({color:0xffe27a}));
  ring.rotation.x=-Math.PI/2; ring.position.set(x,y+0.34,z); ring.visible=false; scene.add(ring);
  const i=plots.length;
  tile.userData={plot:i};
  plots.push({i,x,z,y,tile,holder:cropHolder,ring,state:'empty',crop:null,planted:0,cropObj:null});
}
const plotMeshes=plots.map(p=>p.tile);

function makeCrop(type){
  const g=new THREE.Group(); const c=CROPS[type];
  const green=MAT(0x4f9e3a,.9), fruit=new THREE.Group();
  if(type==='carrot'){
    for(let k=0;k<6;k++){const bl=cone(0.09,0.9,green,5);const a=new THREE.Group();a.add(bl);bl.position.y=0.45;a.rotation.z=(k/6)*0.6-0.3;a.rotation.y=k*1.05;g.add(a);}
    const t=cone(0.28,0.7,MAT(c.col,.85),10);t.position.y=0.2;fruit.add(t);
  } else if(type==='wheat'){
    for(let k=0;k<7;k++){const st=box(0.12,1.1,0.12,MAT(0x8fbe4a,.9));st.position.set((k%3-1)*0.28,0.55,(Math.floor(k/3)-1)*0.28);g.add(st);st.userData.stalk=1;}
    const head=new THREE.Group();for(let k=0;k<7;k++){const h=box(0.2,0.4,0.2,MAT(c.col,.85));h.position.set((k%3-1)*0.28,1.2,(Math.floor(k/3)-1)*0.28);head.add(h);}fruit.add(head);
  } else if(type==='tomato'){
    g.add(at(sph(0.55,green),0,0.5,0));
    g.add(at(sph(0.4,MAT(0x5aa53c,.9)),0.35,0.7,0.2));
    [[0.4,0.5,0.2],[-0.35,0.4,-0.2],[0.1,0.75,-0.35]].forEach(([a,b,d])=>{const t=sph(0.24,MAT(c.col,.6));t.position.set(a,b,d);fruit.add(t);});
  } else { // pumpkin
    g.add(at(sph(0.45,green),0,0.4,0));
    const pk=sph(0.7,MAT(c.col,.75));pk.scale.set(1.25,0.85,1.25);pk.position.y=0.6;fruit.add(pk);
    const stem=cyl(0.1,0.13,0.35,MAT(0x6b8f3c,.9));stem.position.y=1.05;fruit.add(stem);
  }
  fruit.visible=false; g.add(fruit);
  g.scale.setScalar(0.25);
  return {group:g,fruit,update(p,ripe){g.scale.setScalar(0.28+0.72*Math.min(1,p));fruit.visible=ripe;}};
}

// ---- economy / save ----
let coins=50;
const SAVE='kucuk_pazar_3d_v1';
function save(){try{localStorage.setItem(SAVE,JSON.stringify({coins,plots:plots.map(p=>({crop:p.crop,planted:p.planted,state:p.state}))}));}catch(e){}}
function load(){try{const o=JSON.parse(localStorage.getItem(SAVE));if(!o)return;coins=o.coins??50;if(Array.isArray(o.plots))o.plots.forEach((s,i)=>{if(s&&s.crop&&plots[i]){plots[i].crop=s.crop;plots[i].planted=s.planted;plots[i].state=s.state==='empty'?'empty':'growing';plots[i].cropObj=makeCrop(s.crop);plots[i].holder.add(plots[i].cropObj.group);}});}catch(e){}}

let selected='carrot';
function plant(i){const p=plots[i];if(!p||p.state!=='empty')return false;const c=CROPS[selected];if(coins<c.cost){sfx('err');flash();return false;}coins-=c.cost;p.crop=selected;p.planted=Date.now();p.state='growing';p.cropObj=makeCrop(selected);p.holder.add(p.cropObj.group);p.tile.material=soilWetMat;sfx('plant');updateHUD();save();return true;}
function harvest(i){const p=plots[i];if(!p||p.state!=='ripe')return false;const c=CROPS[p.crop];coins+=c.value;flyCoins(p,c.value);sfx('coin');if(p.cropObj){p.holder.remove(p.cropObj.group);}p.cropObj=null;p.crop=null;p.state='empty';p.ring.visible=false;p.tile.material=soilMat;updateHUD();save();return true;}
function onPlot(i){const p=plots[i];if(!p)return;if(p.state==='empty')plant(i);else if(p.state==='ripe')harvest(i);}

// ---- sound ----
let muted=false, actx=null;
function ac(){if(muted)return null;if(!actx){try{actx=new(window.AudioContext||window.webkitAudioContext)();}catch(e){return null;}}if(actx.state==='suspended')actx.resume();return actx;}
function tone(f,s,d,ty,v){const c=ac();if(!c)return;const t=c.currentTime+s;const o=c.createOscillator(),g=c.createGain();o.type=ty||'sine';o.frequency.value=f;g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(v||.12,t+.01);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(c.destination);o.start(t);o.stop(t+d+.02);}
function sfx(k){if(k==='plant'){tone(196,0,.16,'sine',.12);tone(294,.03,.14,'sine',.07);}else if(k==='coin'){tone(988,0,.08,'triangle',.11);tone(1319,.06,.1,'triangle',.08);}else if(k==='err'){tone(160,0,.12,'sawtooth',.06);}}

// ---- HUD / fx ----
const $=id=>document.getElementById(id);
function updateHUD(){$('coins').textContent=coins;buildSeedbar();}
function buildSeedbar(){const el=$('seedbar');el.innerHTML='';for(const k in CROPS){const c=CROPS[k];const b=document.createElement('button');b.className='seed'+(k===selected?' on':'')+(coins<c.cost?' poor':'');b.innerHTML='<span class="sn">'+c.name+'</span><span class="sc">'+c.cost+' 🪙</span>';b.onclick=()=>{selected=k;buildSeedbar();};el.appendChild(b);}}
function proj(x,y,z){const v=new THREE.Vector3(x,y,z).project(cam);return{x:(v.x*.5+.5)*W(),y:(-v.y*.5+.5)*H()};}
function flyCoins(p,val){const s=proj(p.x,p.y+1.4,p.z);const el=document.createElement('div');el.className='floatc';el.textContent='+'+val+' 🪙';el.style.left=s.x+'px';el.style.top=s.y+'px';$('fx').appendChild(el);setTimeout(()=>el.remove(),1100);}
function flash(){const el=$('coinsWrap');el.classList.remove('shake');void el.offsetWidth;el.classList.add('shake');}

// ---- input: orbit + click ----
let down=false,moved=false,sx=0,sy=0,ox=0,oy=0;
cvs.addEventListener('pointerdown',e=>{down=true;moved=false;sx=e.clientX;sy=e.clientY;ox=e.clientX;oy=e.clientY;ac();});
cvs.addEventListener('pointermove',e=>{if(!down)return;const dx=e.clientX-ox,dy=e.clientY-oy;ox=e.clientX;oy=e.clientY;if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>6)moved=true;yaw-=dx*0.006;camH=Math.max(8,Math.min(30,camH-dy*0.05));});
window.addEventListener('pointerup',e=>{if(down&&!moved)tryClick(e.clientX,e.clientY);down=false;});
cvs.addEventListener('wheel',e=>{e.preventDefault();dsize=Math.max(7,Math.min(20,dsize*(1+e.deltaY*0.0011)));fitCam();},{passive:false});
const ray=new THREE.Raycaster(), ndc=new THREE.Vector2();
function tryClick(px,py){const r=cvs.getBoundingClientRect();ndc.x=((px-r.left)/r.width)*2-1;ndc.y=-((py-r.top)/r.height)*2+1;ray.setFromCamera(ndc,cam);const hit=ray.intersectObjects(plotMeshes,false)[0];if(hit&&hit.object.userData.plot!=null)onPlot(hit.object.userData.plot);}

// ---- loop ----
let last=performance.now();
function loop(now){const dt=Math.min((now-last)/1000,.05);last=now;const t=now/1000;
  if(blades)blades.rotation.z+=dt*0.6; T_water.offset.x+=dt*0.02; T_water.offset.y+=dt*0.01;
  for(const tr of trees){tr.g.rotation.z=Math.sin(t*1.2+tr.ph)*tr.amp;}
  for(const c of clouds){c.g.position.x+=dt*c.sp;if(c.g.position.x>28)c.g.position.x=-28;}
  for(const n of npcs){n.t+=dt*n.spd/segLen(n.pts);if(n.t>=1)n.t-=1;const a=path(n.pts,n.t),b=path(n.pts,(n.t+.01)%1);n.g.position.set(a.x,gh(a.x,a.z)+Math.abs(Math.sin(t*8))*.06,a.z);n.g.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}
  const nowMs=Date.now();
  for(const p of plots){ if(p.state==='empty'||!p.cropObj)continue; const c=CROPS[p.crop]; const prog=(nowMs-p.planted)/(c.grow*1000); const ripe=prog>=1; p.cropObj.update(prog,ripe);
    if(ripe){ if(p.state!=='ripe'){p.state='ripe';p.ring.visible=true;} p.cropObj.group.position.y=Math.abs(Math.sin(t*3))*0.12; p.ring.scale.setScalar(1+Math.sin(t*3)*0.06); p.ring.material.opacity=1; }
  }
  updateCam(); renderer.render(scene,cam); requestAnimationFrame(loop);
}
function segLen(pts){let L=0;for(let i=0;i<pts.length-1;i++)L+=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);return L;}
function path(pts,tt){const T=segLen(pts);let d=tt*T;for(let i=0;i<pts.length-1;i++){const s=Math.hypot(pts[i+1][0]-pts[i][0],pts[i+1][1]-pts[i][1]);if(d<=s){const f=d/s;return{x:pts[i][0]+(pts[i+1][0]-pts[i][0])*f,z:pts[i][1]+(pts[i+1][1]-pts[i][1])*f};}d-=s;}return{x:pts[pts.length-1][0],z:pts[pts.length-1][1]};}

$('mute').onclick=()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';if(!muted)sfx('coin');};
load(); buildSeedbar(); updateHUD(); fitCam(); addEventListener('resize',fitCam); updateCam(); requestAnimationFrame(loop);
window.__game={plots,plant,harvest,state:()=>({coins,plots:plots.map(p=>p.state)}),setSel:k=>{selected=k;buildSeedbar();}};
window.__proj=(x,y,z)=>proj(x,y,z);
window.__ready=true;
})();
