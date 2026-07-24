(function(){
const cvs = document.getElementById('c');
const W = ()=>cvs.clientWidth||window.innerWidth, H = ()=>cvs.clientHeight||window.innerHeight;
const renderer = new THREE.WebGLRenderer({canvas:cvs, antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// gradient sky via canvas texture
(function(){
  const c=document.createElement('canvas'); c.width=8; c.height=256;
  const g=c.getContext('2d').createLinearGradient(0,0,0,256);
  g.addColorStop(0,'#8ec9ee'); g.addColorStop(.55,'#bfe0f2'); g.addColorStop(1,'#f4e7cf');
  const ctx=c.getContext('2d'); ctx.fillStyle=g; ctx.fillRect(0,0,8,256);
  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  scene.background=tex;
})();
scene.fog = new THREE.Fog(0xcfe2ec, 34, 74);

const camTarget = new THREE.Vector3(0,0.6,0);
let camAngle = 0.72, camDist = 22, camElev = 15;
const cam = new THREE.OrthographicCamera(-1,1,1,-1,0.1,200);
function fitCam(){
  const a=W()/H(), d=12;
  cam.left=-d*a; cam.right=d*a; cam.top=d; cam.bottom=-d; cam.updateProjectionMatrix();
  renderer.setSize(W(),H(),false);
}

// ---- lights ----
const sun = new THREE.DirectionalLight(0xffe6bc, 2.9);
sun.position.set(14,20,8); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
const sc=sun.shadow.camera; sc.left=-20; sc.right=20; sc.top=20; sc.bottom=-20; sc.near=1; sc.far=60;
sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.03; sun.shadow.radius=3;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.HemisphereLight(0xdcecff, 0x6f9a4e, 0.8));
const fill=new THREE.DirectionalLight(0xffe4c0,0.35); fill.position.set(-10,8,-6); scene.add(fill);

// glowing sun disc + halo (fake volumetric)
(function(){
  const s=new THREE.Mesh(new THREE.SphereGeometry(2.2,20,20), new THREE.MeshBasicMaterial({color:0xfff4d0}));
  s.position.copy(sun.position).multiplyScalar(1.3); scene.add(s);
  const spriteMat=new THREE.SpriteMaterial({color:0xffe9a8, transparent:true, opacity:.5, depthWrite:false, blending:THREE.AdditiveBlending});
  const halo=new THREE.Sprite(spriteMat); halo.scale.set(16,16,1); halo.position.copy(s.position); scene.add(halo);
})();

// ---- helpers ----
const MAT = (color,rough,metal)=>new THREE.MeshStandardMaterial({color:color,roughness:rough==null?0.9:rough,metalness:metal||0,flatShading:false});
function box(w,h,d,mat,cast){ const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); m.castShadow=cast!==false; m.receiveShadow=true; return m; }
function cyl(rt,rb,h,mat,seg){ const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg||16),mat); m.castShadow=true; m.receiveShadow=true; return m; }
function cone(r,h,mat,seg){ const m=new THREE.Mesh(new THREE.ConeGeometry(r,h,seg||16),mat); m.castShadow=true; m.receiveShadow=true; return m; }
function sph(r,mat){ const m=new THREE.Mesh(new THREE.SphereGeometry(r,18,16),mat); m.castShadow=true; m.receiveShadow=true; return m; }

// gentle terrain height
function ground_h(x,z){ return 0.35*Math.sin(x*0.28)*Math.cos(z*0.24) + 0.25*Math.sin(x*0.13+1.2) - 0.1; }

// ---- ground ----
(function(){
  const g=new THREE.PlaneGeometry(70,70,80,80); g.rotateX(-Math.PI/2);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){ const x=p.getX(i), z=p.getZ(i); p.setY(i, ground_h(x,z)); }
  g.computeVertexNormals();
  const ground=new THREE.Mesh(g, MAT(0x74b24a,1)); ground.receiveShadow=true; scene.add(ground);
  // darker soil patch (field)
  const soil=new THREE.Mesh(new THREE.CircleGeometry(6.5,32), MAT(0x8a5a34,1)); soil.rotation.x=-Math.PI/2;
  soil.position.set(-8, ground_h(-8,6)+0.06, 6); soil.receiveShadow=true; scene.add(soil);
})();

// ---- water pond ----
(function(){
  const pond=new THREE.Mesh(new THREE.CircleGeometry(4,40), new THREE.MeshStandardMaterial({color:0x4f9fd4,roughness:0.12,metalness:0.35,transparent:true,opacity:0.92}));
  pond.rotation.x=-Math.PI/2; pond.position.set(10,-0.02,-8); pond.receiveShadow=true; scene.add(pond);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(4,0.35,10,44), MAT(0x9a7a52,1)); rim.rotation.x=-Math.PI/2; rim.position.set(10,-0.05,-8); rim.receiveShadow=true; scene.add(rim);
})();

// ---- tree ----
const trees=[];
function tree(x,z,s){ s=s||1;
  const g=new THREE.Group();
  const trunk=cyl(0.28*s,0.4*s,2.2*s,MAT(0x8a5a34,1)); trunk.position.y=1.1*s; g.add(trunk);
  const foli=new THREE.Group();
  const fmat=MAT(0x5aa53c,0.95);
  const a=sph(1.6*s,fmat); a.position.set(0,2.9*s,0); foli.add(a);
  const b=sph(1.15*s,MAT(0x4f9636,0.95)); b.position.set(1*s,2.4*s,0.4*s); foli.add(b);
  const d=sph(1.15*s,MAT(0x4f9636,0.95)); d.position.set(-0.9*s,2.5*s,-0.3*s); foli.add(d);
  g.add(foli);
  g.position.set(x, ground_h(x,z), z); scene.add(g);
  trees.push({g:foli, ph:Math.random()*6.28, amp:0.03+Math.random()*0.03});
}

// ---- fence ----
function fenceLine(x1,z1,x2,z2,n){ const mat=MAT(0xc9a06a,0.9);
  for(let i=0;i<=n;i++){ const t=i/n; const x=x1+(x2-x1)*t, z=z1+(z2-z1)*t;
    const post=box(0.18,1,0.18,mat); post.position.set(x, ground_h(x,z)+0.5, z); scene.add(post); }
  const dx=x2-x1, dz=z2-z1, len=Math.hypot(dx,dz);
  for(const yy of [0.4,0.75]){ const rail=box(len,0.12,0.1,mat); rail.position.set((x1+x2)/2, ground_h((x1+x2)/2,(z1+z2)/2)+yy, (z1+z2)/2); rail.rotation.y=Math.atan2(dz,dx); scene.add(rail); }
}

// ---- crop rows ----
function field(cx,cz){
  const rows=5, cols=7;
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const x=cx-3+c*1, z=cz-2+r*1;
    const grow=0.4+Math.random()*0.9;
    const stalk=box(0.5,grow,0.5, MAT(r%2? 0x8fce5a:0xe8b74a,0.9)); stalk.position.set(x, ground_h(x,z)+grow/2+0.05, z); scene.add(stalk);
  }
}

// ---- buildings ----
function barn(x,z){ const g=new THREE.Group();
  const body=box(5.5,3.4,4.2, MAT(0xc24d3a,0.8)); body.position.y=1.7; g.add(body);
  const roof=cone(3.6,2.2,MAT(0x8f3626,0.8),4); roof.rotation.y=Math.PI/4; roof.position.y=4.5; roof.scale.set(1,1,0.78); g.add(roof);
  const door=box(1.4,2,0.2,MAT(0xf2e6cd,0.8)); door.position.set(0,1,2.15); g.add(door);
  const silo=cyl(1.1,1.1,4.6,MAT(0xdcd4c4,0.7)); silo.position.set(-3.6,2.3,0); g.add(silo);
  const cap=cone(1.15,1,MAT(0xb6503a,0.8)); cap.position.set(-3.6,4.9,0); g.add(cap);
  g.position.set(x, ground_h(x,z), z); scene.add(g);
}
function cottage(x,z,col){ const g=new THREE.Group();
  const body=box(4,2.6,3.4, MAT(col||0xf2e2c4,0.85)); body.position.y=1.3; g.add(body);
  const roof=cone(2.9,1.8,MAT(0xc0663f,0.8),4); roof.rotation.y=Math.PI/4; roof.position.y=3.5; roof.scale.set(1,1,0.85); g.add(roof);
  const chim=box(0.5,1.2,0.5,MAT(0x9a5240,0.9)); chim.position.set(1.2,3.9,0.4); g.add(chim);
  for(const sx of [-1,1]){ const win=box(0.7,0.7,0.1,MAT(0x8fd0e8,0.4,0.1)); win.position.set(sx,1.5,1.72); g.add(win); }
  const door=box(0.9,1.5,0.15,MAT(0x8a5a34,0.85)); door.position.set(0,0.75,1.72); g.add(door);
  g.position.set(x, ground_h(x,z), z); scene.add(g);
  return g;
}
let windmillBlades=null;
function windmill(x,z){ const g=new THREE.Group();
  const tower=cyl(1.1,1.7,5.2,MAT(0xefe7d6,0.8)); tower.position.y=2.6; g.add(tower);
  const roof=cone(1.5,1.4,MAT(0xb6503a,0.8),16); roof.position.y=5.9; g.add(roof);
  const hub=new THREE.Group(); hub.position.set(0,4.4,1.5);
  const bmat=MAT(0x8a5a34,0.85);
  for(let i=0;i<4;i++){ const bl=box(0.5,3.4,0.16,MAT(0xe8dcc2,0.85)); bl.position.y=1.9; const arm=new THREE.Group(); arm.add(bl); arm.rotation.z=i*Math.PI/2; hub.add(arm); }
  const csm=cyl(0.25,0.25,0.5,bmat); csm.rotation.x=Math.PI/2; hub.add(csm);
  g.add(hub); windmillBlades=hub;
  g.position.set(x, ground_h(x,z), z); scene.add(g);
}

// ---- stone path ----
function path(pts){ const mat=MAT(0xbdb3a2,0.95);
  for(let i=0;i<pts.length-1;i++){ const [x1,z1]=pts[i],[x2,z2]=pts[i+1]; const n=Math.round(Math.hypot(x2-x1,z2-z1)/0.9);
    for(let k=0;k<=n;k++){ const t=k/n, x=x1+(x2-x1)*t, z=z1+(z2-z1)*t;
      const st=cyl(0.45,0.5,0.16,mat,7); st.position.set(x+ (Math.random()-.5)*0.15, ground_h(x,z)+0.02, z+(Math.random()-.5)*0.15); st.rotation.y=Math.random()*3; st.castShadow=false; scene.add(st); } }
}

// ---- villager / NPC ----
const npcs=[];
function npc(pathPts, col, spd){ const g=new THREE.Group();
  const body=cyl(0.32,0.42,1.0,MAT(col,0.85)); body.position.y=0.9; g.add(body);
  const head=sph(0.34,MAT(0xf0c9a0,0.8)); head.position.y=1.75; g.add(head);
  const hat=cyl(0.12,0.44,0.28,MAT(0x8a5a34,0.85)); hat.position.y=2.0; g.add(hat);
  for(const sx of [-0.28,0.28]){ const leg=cyl(0.13,0.13,0.7,MAT(0x4a4038,0.9)); leg.position.set(sx,0.35,0); g.add(leg); leg.userData.leg=sx; }
  scene.add(g);
  npcs.push({g:g, pts:pathPts, t:Math.random(), spd:spd||0.08, col:col});
}

// ---- animals ----
function cow(x,z){ const g=new THREE.Group();
  const body=box(1.7,1.0,0.95,MAT(0xfaf6ee,0.85)); body.position.y=1.05; g.add(body);
  body.material=MAT(0xfaf6ee,0.85);
  const p1=box(0.55,0.4,0.5,MAT(0x4a4038,0.85)); p1.position.set(0.4,1.2,0.48); g.add(p1);
  const head=box(0.7,0.6,0.6,MAT(0xfaf6ee,0.85)); head.position.set(-1.0,1.2,0); g.add(head);
  const muz=box(0.4,0.35,0.4,MAT(0xf3c9c2,0.85)); muz.position.set(-1.35,1.05,0); g.add(muz);
  for(const [sx,sz] of [[0.55,0.3],[0.55,-0.3],[-0.4,0.3],[-0.4,-0.3]]){ const leg=cyl(0.14,0.14,0.9,MAT(0xd7cdbc,0.9)); leg.position.set(sx,0.45,sz); g.add(leg); }
  g.position.set(x, ground_h(x,z), z); g.rotation.y=Math.random()*3; scene.add(g);
}
function sheep(x,z){ const g=new THREE.Group();
  const w=MAT(0xfbf7ee,0.95);
  const body=sph(0.85,w); body.position.y=1.1; body.scale.set(1.2,0.95,1); g.add(body);
  const head=sph(0.42,MAT(0x5f5750,0.85)); head.position.set(-0.95,1.15,0); g.add(head);
  for(const [sx,sz] of [[0.4,0.3],[0.4,-0.3],[-0.4,0.3],[-0.4,-0.3]]){ const leg=cyl(0.11,0.11,0.8,MAT(0x5f5750,0.9)); leg.position.set(sx,0.4,sz); g.add(leg); }
  g.position.set(x, ground_h(x,z), z); g.rotation.y=Math.random()*3; scene.add(g);
}

// clouds
const clouds=[];
function cloud(x,y,z,s){ const g=new THREE.Group(); const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,emissive:0x99aabb,emissiveIntensity:0.05});
  [[0,0,0,1.6],[1.4,-.2,0,1.1],[-1.3,-.1,.3,1.15],[.3,.4,.2,1.0]].forEach(([dx,dy,dz,r])=>{ const b=sph(r*s,m); b.position.set(dx*s,dy*s,dz*s); b.castShadow=false; g.add(b); });
  g.position.set(x,y,z); scene.add(g); clouds.push({g:g,sp:0.4+Math.random()*0.5});
}

// ===== populate =====
barn(9,9); cottage(-3,-9,0xf0e2c4); cottage(3,-11,0xe8d2b0); cottage(-11,-3,0xf2dcc0); windmill(-12,10);
field(-8,6);
[[13,4],[15,-2],[-15,-9],[6,14],[-6,13],[16,10],[-16,3],[12,-13],[-14,-14],[0,16]].forEach(([x,z],i)=>tree(x,z,0.8+Math.random()*0.5));
fenceLine(-4.5,2,-11.5,10,8); fenceLine(-11.5,10,-4.5,10,7);
path([[0,18],[0,6],[-3,-6],[3,-9]]); path([[0,6],[8,7],[9,4]]);
cow(-7,11); cow(-9,12); sheep(-6,13); sheep(-8,13.5);
cloud(-14,16,-8,1.6); cloud(10,18,6,1.3); cloud(0,15,14,1.0); cloud(16,17,-2,1.2);
npc([[0,16],[0,6],[-3,-4],[-3,-8]], 0xc94f6a, 0.06);
npc([[8,7],[0,6],[0,14]], 0x5b7fd4, 0.05);
npc([[-3,-8],[3,-9],[9,4],[9,8]], 0x6fae52, 0.045);


// wildflowers
(function(){ const cols=[0xef6f8e,0xf6c045,0x8a86e0,0xffffff,0xff9e57];
  for(let i=0;i<140;i++){ const x=(Math.random()-.5)*54, z=(Math.random()-.5)*54;
    if(Math.hypot(x+8,z-6)<7.2) continue; if(Math.hypot(x-10,z+8)<5) continue;
    const f=new THREE.Mesh(new THREE.SphereGeometry(0.13,6,5), new THREE.MeshStandardMaterial({color:cols[i%cols.length],roughness:.85,emissive:cols[i%cols.length],emissiveIntensity:.14}));
    f.position.set(x, ground_h(x,z)+0.12, z); f.castShadow=false; scene.add(f);
  }
})();

// ===== animate =====
let last=performance.now();
function loop(now){
  const dt=Math.min((now-last)/1000,0.05); last=now; const t=now/1000;
  camAngle += dt*0.06;
  cam.position.set(Math.cos(camAngle)*camDist, camElev, Math.sin(camAngle)*camDist);
  cam.lookAt(camTarget); cam.up.set(0,1,0);
  if(windmillBlades) windmillBlades.rotation.z += dt*0.6;
  for(const tr of trees){ tr.g.rotation.z = Math.sin(t*1.2+tr.ph)*tr.amp; tr.g.rotation.x = Math.cos(t*0.9+tr.ph)*tr.amp*0.6; }
  for(const c of clouds){ c.g.position.x += dt*c.sp; if(c.g.position.x>26) c.g.position.x=-26; }
  for(const n of npcs){ n.t += dt*n.spd/segLen(n.pts); if(n.t>=1) n.t-=1;
    const p=alongPath(n.pts,n.t), p2=alongPath(n.pts,(n.t+0.01)%1);
    n.g.position.set(p.x, ground_h(p.x,p.z), p.z);
    n.g.rotation.y=Math.atan2(p2.x-p.x, p2.z-p.z);
    n.g.position.y += Math.abs(Math.sin(t*8))*0.06; // walk bob
  }
  renderer.render(scene,cam);
  requestAnimationFrame(loop);
}
function segLen(pts){ let L=0; for(let i=0;i<pts.length-1;i++) L+=Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]); return L; }
function alongPath(pts,t){ const total=segLen(pts); let d=t*total;
  for(let i=0;i<pts.length-1;i++){ const seg=Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]); if(d<=seg){ const f=d/seg; return {x:pts[i][0]+(pts[i+1][0]-pts[i][0])*f, z:pts[i][1]+(pts[i+1][1]-pts[i][1])*f}; } d-=seg; }
  return {x:pts[pts.length-1][0], z:pts[pts.length-1][1]};
}
fitCam(); window.addEventListener('resize',fitCam);
requestAnimationFrame(loop);
window.__ready=true;
})();
