# Hanedan — mimari ve sahiplik

Yapı kurulumu **yok**. Saf ES modülleri, vendor'lanmış three.js r169.
Çalıştır: `node game/tools/serve.mjs 8123` → `http://localhost:8123/`
İncele:  `node game/tools/inspect.mjs --out <dizin>`

## Katmanlar ve yön

```
content/   ← veri ve yazı (traits, events, names, map.json)
core/      ← rng, date, bus, state, clock          (hiçbir şeye bağımlı değil)
sim/       ← dünyanın kuralları                    (core + content'e bağımlı)
render/    ← three.js sahnesi                      (core + sim'i OKUR)
ui/        ← DOM                                   (sim API'lerini ÇAĞIRIR)
audio/     ← WebAudio                              (bus'ı dinler)
```

**Tek yönlü kural:** `sim/` asla `ui/` veya `render/` import etmez. İletişim
`core/bus.js` üzerinden olay yayınıyla olur. Bu kuralı bozan her PR reddedilir —
çünkü fan-out'un tamamı bu sınırın üstünde duruyor.

## Değişmezler (invariants)

1. **Rastgelelik yalnızca `core/state.js`'teki `rng` üzerinden.** `Math.random()`
   sim kodunda yasak. Aynı tohum + aynı gün = aynı dünya.
2. **Sonuç, taahhüt anında mühürlenir.** `decision.commit()` `sealedRoll`'u o an
   atar. Bekleme bir kumar makinesi değil, yola çıkmış bir mektuptur.
3. **Aynı anda tek bir açık karar.** Yığın yok; ağırlık yığında kaybolur.
4. **`S` düz JSON.** Fonksiyon, Map, Set, DOM referansı koyma — kayıt/yükleme
   tek noktadan çalışsın.
5. **Her metin Türkçe ve ikinci tekil şahıs.** Oyuncuya "sen" denir.

## Olay sözleşmesi (`core/bus.js`)

| olay | yük | yayınlayan |
|---|---|---|
| `clock:day` / `clock:pause` / `clock:resume` / `clock:speed` | gün / sebep | core/clock |
| `decision:offered` | decision | sim/decision |
| `decision:committed` | decision | sim/decision |
| `decision:tell` | `{d, text, tone, prog}` | sim/decision |
| `decision:closing` | decision | sim/decision |
| `decision:resolved` | decision | sim/decision |
| `char:born` / `char:died` | `{id, cause, killerId}` | sim/characters |
| `title:granted` / `title:extinct` | `{titleId, charId, prev}` | sim/realm |
| `player:died` / `player:changed` | `{deadId, heirId}` / id | sim/succession |
| `sim:month` / `sim:year` / `sim:unrest` | gün / yıl / `{charId}` | sim/tick |
| `world:ready` | — | sim/world |
| `render:resize` | `{w,h}` | render/scene |

Yeni olay eklerken bu tabloyu güncelle.

## Dosya sahipliği

Her parçanın **yalnız** kendi dosyalarına yazma hakkı var. Başkasının dosyasında
bir şey gerekiyorsa: olay yayınla, ya da `docs/REQUESTS.md`'ye bir satır yaz.
Sahipsiz dosyalar (`index.html`, `main.js`, `core/*`) yalnızca entegrasyon
sırasında değiştirilir.
