# Parçalar

Oyun, tek tek değerlendirilebilen ve tek tek iyileştirilebilen 21 parçaya
bölündü. Her parçanın **kendine ait dosyaları** var. Bir parça asla başka bir
parçanın dosyasına yazmaz.

## CSS kuralı
`ui/style.css` yalnızca P18'e aittir. Diğer her UI parçası kendi CSS'ini kendi
JS modülünden enjekte eder:
```js
import { css } from './_css.js';
css('p03-reveal', `.reveal{...}`);   // aynı anahtarla ikinci çağrı değiştirir
```

## Parça listesi

| # | Parça | Sahip olduğu dosyalar | Ne için puanlanır |
|---|---|---|---|
| P01 | **Karar & Taahhüt** | `sim/decision.js`, `ui/decision.js` | Kararın ağırlığı; bedelin önden ödenmesi; basılı-tut kapısı; seçeneklerin dürüstlüğü |
| P02 | **Bekleyiş** | `ui/wait.js`, `sim/tells.js` | Bekleme gerçek mi; işaretler huzursuz ediyor mu; kalp atışı ve saatin yavaşlaması |
| P03 | **Açığa Çıkış** | `ui/reveal.js` | Sonucun sahnelenmesi; nefes; kamera; sesin oturması |
| P04 | **Yankı & Hafıza** | `sim/memory.js`, `content/echoes.js` | Eski günahların yıllar sonra geri gelmesi |
| P05 | **Karakterler** | `sim/characters.js`, `content/traits.js` | Özellikler davranışı değiştiriyor mu; insanlar ayırt edilebilir mi |
| P06 | **Entrika** | `sim/schemes.js`, `content/schemes.js`, `ui/schemes.js` | Komplo kurmanın gerilimi; ortaklar; ifşa riski |
| P07 | **Saray & Divan** | `sim/council.js`, `ui/court.js` | Atamaların bedeli; divan üyelerinin kendi hesapları |
| P08 | **Veraset & Ölüm** | `sim/succession.js`, `ui/succession.js` | Ölüm anı; devralma; mirasın acısı |
| P09 | **Sadakat & Fraksiyon** | `sim/opinion.js`, `sim/factions.js`, `ui/realm.js` | Vassalların kendi iradesi; ayaklanma tehdidi |
| P10 | **Coğrafya** | `game/tools/genmap.mjs`, `src/content/map.json` | Haritanın okunabilirliği ve inandırıcılığı |
| P11 | **Harita Görselliği** | `render/mapmesh.js`, `render/scene.js` | Işık, sınırlar, su, parşömen geçişi, mevsim |
| P12 | **Harita Süsleri** | `render/props.js`, `render/labels.js` | Şehirler, ağaçlar, sancaklar, harita üstü yazılar |
| P13 | **Portreler** | `render/portrait.js` | Yüzler; yaşlanma; rütbe; ruh hali |
| P14 | **Kamera** | `render/camera.js` | Kamera dili; sinematik geçişler |
| P15 | **Savaş** | `sim/war.js`, `render/armies.js`, `ui/war.js` | Savaş ilanının ağırlığı; ordular; kuşatma |
| P16 | **Ekonomi & Yapılar** | `sim/economy.js`, `content/buildings.js`, `ui/holding.js` | Kaynak kıtlığı; inşa kararlarının bedeli |
| P17 | **Yapay Zekâ** | `sim/ai.js` | Diğer hükümdarların kendi iradesi ve entrikaları |
| P18 | **Arayüz Kabuğu** | `ui/shell.js`, `ui/style.css`, `ui/tooltip.js`, `ui/_css.js` | Bilgi mimarisi; tipografi; ipuçları |
| P19 | **Yazım** | `content/events.js`, `content/text.js` | Metnin somutluğu; ikinci tekil şahıs; cümlelerin ağırlığı |
| P20 | **Ses** | `audio/audio.js`, `audio/music.js` | Atmosfer; gerginliğin sesi |
| P21 | **İlk On Dakika** | `ui/intro.js`, `content/opening.js` | Açılış; ilk kararın etkisi; öğretmeden öğretmek |

## Ortak dosyalar (yalnız entegrasyon sırasında değişir)
`index.html`, `src/main.js`, `core/*`, `sim/realm.js`, `sim/world.js`,
`sim/tick.js`, `render/mapmodes.js`, `content/names.js`

Bir parça bu dosyalarda değişiklik istiyorsa `docs/REQUESTS.md`'ye satır ekler.
