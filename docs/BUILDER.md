# Yapıcı brifingi

Sen tek bir parçadan sorumlusun. O parçayı **mükemmelleştireceksin**. Başka
parçalara dokunmayacaksın.

## Kurallar

1. **Yalnızca sana ait dosyalara yaz.** `docs/PIECES.md`'de listeli.
   Başka bir dosya gerekiyorsa `docs/REQUESTS.md`'ye bir satır ekle ve devam et.
2. **`docs/ARCHITECTURE.md`'deki değişmezleri bozma.** Özellikle:
   sim asla ui/render import etmez; `Math.random()` sim'de yasak; `S` düz JSON;
   aynı anda tek açık karar.
3. **Her turda oyunu kendin çalıştır ve ekran görüntülerine bak:**
   ```bash
   /home/user/analyze/inspect --out /tmp/<parça>/<tur>
   ```
   `report.json`'da `pageErrors` boş olana kadar başka hiçbir şey yapma.
   PNG'leri **Read ile aç ve gerçekten bak**. Kod okuyarak değerlendirme yapma.
4. **Türkçe yaz.** Oyuncuya görünen her metin Türkçe ve ikinci tekil şahıs.
   Kod yorumları İngilizce.
5. **Ölçüt sıralaması:** önce karar sonrası gerginlik, sonra isimli insanlar,
   sonra sistem derinliği, sonra yazım, en sonda görsellik. `docs/CRITIC.md`.

## Döngü — bunu en az 4 tur çalıştır

```
tur:
  1. Oyunu çalıştır, ekran görüntülerine bak, kendi parçanı SERT eleştir.
     "Bu parça bir oyuncuya ne hissettiriyor?" diye sor. Cevap "hiçbir şey"se
     doğru cevabı bulmuşsun demektir.
  2. En büyük tek kusuru seç. Küçük cilalar değil — en büyüğü.
  3. Düzelt.
  4. Tekrar çalıştır. pageErrors boş mu? Kusur gerçekten gitti mi?
  5. Gitmediyse aynı kusura geri dön. Gittiyse sonraki tura.
```

Dördüncü turdan sonra kendi parçanı bir kez daha `docs/CRITIC.md` ölçütleriyle
puanla ve dürüst ol. 6.5/10 altındaysa beşinci tur yap.

## Teslim

Bitirdiğinde şunu raporla, fazlasını değil:
- Hangi dosyaları değiştirdin
- Her tur ne düzelttin (tek satır)
- Son `inspect` çıktısındaki `pageErrors` sayısı (0 olmalı)
- Kendi parçana verdiğin gerginlik puanı ve neden
- Hâlâ zayıf olan tek şey

**Commit atma.** Entegrasyonu koordinatör yapacak.

## Hızlı bağlantı kontrolü
Tarayıcı açmadan, saniyeler içinde tüm modüllerin ayrıştığını ve birbirine
bağlandığını doğrula:
```bash
node /home/user/analyze/game/tools/syntax.mjs
```
`inspect` çalıştırmadan önce bunu çalıştır — bir import hatası için 90 saniyelik
tarayıcı turu beklemenin anlamı yok. Teslimden önce çıktı temiz olmalı.
