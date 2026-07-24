# 🌾 Küçük Pazar — Cozy Çiftlik & Yerel Üretim Oyunu

Sakin (cozy) bir tycoon prototipi. Rekabet yok, zaman baskısı yok, kaybetme durumu yok —
sadece huzurlu bir ekonomi büyütme döngüsü: **yetiştir → hasat et → işle → pazarda sat → büyü.**

Tek dosya, bağımlılıksız. `index.html`'i tarayıcıda aç, hemen oynanır. İlerleme tarayıcıya
otomatik kaydedilir (localStorage).

![önizleme](preview.png)

## Oynanış

1. **🌱 Bahçe** — Boş toprağa tıkla, tohum ek. Tarlalar sulandıkça birkaç gün içinde büyür.
   Olgunlaşan (parlayan) ürüne tıklayıp hasat et. Su biterse büyüme _durur_ ama bir şey
   kaybetmezsin; sadece yavaşlar.
2. **🌙 Sonraki Gün** (veya `boşluk` tuşu) — Zaman ilerler, ürünler büyür, atölye üretimi ve
   ahır ürünleri teslim edilir, her gün farklı bir ürün "popüler" olur (+%40 satış).
3. **🧺 Pazar** — Ham ürünleri (tarla + hayvan) ve işlenmiş malları sat.
4. **🍯 Atölye** — Mutfak aldıktan sonra ham ürünleri çok daha değerli ürünlere işle
   (buğday→ekmek, domates→sos, yaban mersini→reçel, üzüm→şarap, süt→peynir, yumurta→kek...).
5. **🐄 Ahır** — Ahır alınca tavuk/inek/koyun besle; beslenen hayvanlar zamanla yumurta 🥚,
   süt 🥛, yün 🧶 verir. Yem olarak buğday (yoksa altın) harcanır — tarla ve ahır birbirine bağlı.
6. **🛖 Dükkan** — Kazancı çiftliğe yatır: yeni tarla, mutfak, otomatik sulama, şirin tezgah
   (+%15 fiyat), ahır, otomatik yemlik, şaraphane (premium ürünler) ve **bahçe süsleri**.

Toplam kazancın **Pazar itibarı** seviyeni yükseltir; her seviye yeni tohum, hayvan ve
olanaklar açar. **🏆 Başarımlar** (15+) ve **🌼 Şirinlik** (süslerle artan) ilerlemene eşlik eder.

## Cila katmanı

- **🔊 Ses:** Web Audio ile üretilen efektler (ekim, hasat, altın, satın alma, gün, seviye,
  başarım) — harici dosya yok, aç/kapat düğmesi kayıtlı.
- **✨ Animasyon:** ekim/hasat sıçraması, uçuşan +N / +altın yazıları, hazır tarla nabzı,
  fide sallanması, seviye ışıltısı.
- **🌷 Dekorasyon:** satın alınabilir bahçe süsleri, mevsime göre değişen gök rengi ve düşen
  parçacıklar (çiçek/kelebek/yaprak/kar).
- **🏆 Başarımlar:** kilitli/açık ızgara modalı, açılışta bildirim + ses.

Tümü `prefers-reduced-motion` açık olduğunda ağır animasyonları otomatik kısar.

## Tasarım felsefesi (cozy)

- **Baskı yok:** timer yok, enerji/açlık yok, oyun bitmez.
- **Yavaş ve tatmin edici döngü:** her gün küçük ilerleme, ara sıra komşu hediyesi.
- **Derinlik seçeneği:** ham satış kolay yol; işleme (atölye) ve ahır kârı katlar ama planlama ister.
- **Kaldığın yerden devam:** tarayıcı kapansa da ilerleme durur.

## Teknik

- Saf HTML/CSS/JS (vanilla), harici bağımlılık yok — çevrimdışı çalışır, CSP-güvenli.
- Durum `localStorage` (`kucuk_pazar_v1` anahtarı) üzerinden kaydedilir; şema geriye dönük uyumlu.
- İçerik veri-odaklı (`CROPS`, `APROD`, `ANIMALS`, `GOODS`, `UPGRADES`, `DECOR`, `ACHIEVEMENTS`,
  `LEVELS`) — yeni ürün/hayvan/tarif/başarım eklemek kolay.

## Sonraki adımlar (fikirler)

- Kasaba müşterileri / özel siparişler (küçük hikâye dokunuşu)
- Mevsime bağlı ürünler ve fiyat dalgalanması
- Arı kovanı → bal, ek hayvan/ürün çeşitleri
- Ekonomi denge ayarı ve zorluk eğrisi
- "Koleksiyon defteri" ve haftalık pazar etkinlikleri
