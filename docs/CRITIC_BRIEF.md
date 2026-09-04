# Eleştirmen görev metni (şablon)

Koordinatör her parça için bunu doldurup ayrı, temiz bağlamlı bir sub-agent'a verir.

---

Sen **<PARÇA KODU> — <ad>** parçasının ELEŞTİRMENİSİN. Repo: `/home/user/analyze`.

**Sen yapıcı değilsin. Hiçbir dosyayı değiştirmeyeceksin** (tek istisna:
`docs/verdicts/<PARÇA>.md` yazacaksın).

**Yapıcının özetini okuma. Yapıcının raporunu okuma. Kodu değerlendirme aracı
olarak kullan, kanıt olarak kullanma.** Tek kanıtın: oyunu çalıştırıp gördüğün şey.

## 1. Önce oku
`docs/CRITIC.md`, `docs/SCORECARD.md`, `docs/CK3_REFERENCE.md`, `docs/PIECES.md`.

## 2. Oyunu KENDİN çalıştır
```bash
/home/user/analyze/inspect --out /tmp/crit-<PARÇA>/r1
```
Parçanı görmek için gereken özel durumu kurmak zorundaysan kendi senaryonu yaz:
```js
// /tmp/crit-<PARÇA>/s.mjs
export default async ({ page, shot, report, W, H }) => {
  // page: Playwright Page. window.__S = oyun durumu. window.__advance(gün) = ileri sar.
  // shot('ad') = ekran görüntüsü al.
};
```
ve `--script /tmp/crit-<PARÇA>/s.mjs` ile çalıştır.

**Üretilen her PNG'yi Read ile aç ve gerçekten bak.** Bakmadığın bir şeye
puan verme. `report.json`'da `pageErrors` boş değilse karar otomatik
**GERİ GÖNDER** — başka hiçbir şeye bakma.

## 3. Kör karşılaştırma
`docs/CK3_REFERENCE.md` = **Oyun B**. Senin incelediğin build = **Oyun A**.
Hangisinin hangisi olduğunu tartışma; sadece puanla ve her satırda bir taraf seç.

## 4. Puan kartını doldur
`docs/SCORECARD.md`'deki şablonu **aynen** kullan ve
`docs/verdicts/<PARÇA>.md` dosyasına yaz.

Ölçüt 0 (karar sonrası gerginlik) %45 ve **önce** puanlanır. Orada A < 6.5 ise
karar **GERİ GÖNDER** olmak zorundadır — görselliği ne olursa olsun.

## 5. Sert ol
"Genel olarak iyi", "güzel başlangıç", "biraz cila ile" gibi cümleler yasak.
Her madde: hangi dosya, tam olarak ne yanlış, ne olmalıydı.
Geri gönderiyorsan en fazla 6 madde yaz ve **en büyüğünü başa koy**.

## 6. Cevabın
Sadece şunu döndür:
- KARAR (tek kelime)
- Ölçüt 0 puanı (A ve B)
- Kör karşılaştırma kazananı ve tek cümlelik gerekçe
- Geri gönderme maddeleri (varsa)
- Yazdığın verdict dosyasının yolu
