// Türetici: index.html'den "her şey açık" sandbox.html üretir.
// Çalıştır: node tools/make-sandbox.mjs  (cozy-farm-market/ klasöründen)
//
// İki şey değişir:
//   1) SAVE_KEY -> ayrı kayıt anahtarı (normal oyunun kaydına dokunmaz)
//   2) taze başlangıç durumu unlockedState() ile "her şey açık" hale gelir
// Böylece oyun mantığı tek kaynakta (index.html) kalır; bu dosya sadece açar.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let src = readFileSync(join(root, "index.html"), "utf8");

// 1) ayrı kayıt slotu
src = src.replace(
  'const SAVE_KEY = "kucuk_pazar_v1";',
  'const SAVE_KEY = "kucuk_pazar_sandbox_v1";'
);

// 2) tamamen açık başlangıç durumu
const unlockedFn = `  function unlockedState(){
    const s = defaultState();
    s.coins = 50000; s.totalEarned = 45000;      // maks seviye + bol altın
    for(const p of s.plots) p.unlocked = true;   // tüm tarlalar
    for(const k in UPGRADES) s.up[k] = true;     // tüm yükseltmeler
    for(const k in DECOR) s.decor[k] = true;     // tüm süsler
    s.animals = [
      {type:"chicken",fed:false,timer:0},{type:"chicken",fed:false,timer:0},
      {type:"cow",fed:false,timer:0},{type:"cow",fed:false,timer:0},
      {type:"sheep",fed:false,timer:0}
    ];
    s.crops = {carrot:10,potato:10,tomato:10,wheat:24,corn:8,strawberry:8,blueberry:8,grape:8,pumpkin:5,egg:8,milk:6,wool:4};
    s.goods = {jam:1,cheese:1,bread:2};
    for(const a of ACHIEVEMENTS){ try{ if(a.c(s)) s.achieved[a.id]=true; }catch(e){} }
    return s;
  }
  let S = normalize(load() || unlockedState());`;
src = src.replace("  let S = normalize(load() || defaultState());", unlockedFn);

// 3) alt başlık etiketi
src = src.replace("çiftlik · yerel üretim · sakin ekonomi", "her şey açık · keşif modu");

writeFileSync(join(root, "sandbox.html"), src);
console.log("sandbox.html yazıldı (" + src.length + " bayt)");
