# 🌾 Küçük Pazar — Cozy Çiftlik & Yerel Üretim Oyunu

Sakin (cozy) bir tycoon prototipi. Rekabet yok, zaman baskısı yok, kaybetme durumu yok —
sadece huzurlu bir ekonomi büyütme döngüsü: **yetiştir → hasat et → işle → pazarda sat → büyü.**

Tek dosya, bağımlılıksız. `index.html`'i tarayıcıda aç, hemen oynanır. İlerleme tarayıcıya
otomatik kaydedilir (localStorage).

![önizleme](preview.png)

## Oynanış

1. **Bahçe** — Boş toprağa tıkla, tohum ek. Tarlalar sulandıkça birkaç gün içinde büyür.
   Olgunlaşan (parlayan) ürüne tıklayıp hasat et. Su biterse büyüme _durur_ ama bir şey
   kaybetmezsin; sadece yavaşlar.
2. **🌙 Sonraki Gün** (veya `boşluk` tuşu) — Zaman ilerler, ürünler büyür, atölye üretimi teslim
   edilir, her gün farklı bir ürün "popüler" olur (+%40 satış).
3. **🧺 Pazar** — Ham ürünleri ve işlenmiş malları sat.
4. **🍯 Atölye** — Mutfak aldıktan sonra ham ürünleri çok daha değerli ürünlere işle
   (buğday→ekmek, domates→sos, yaban mersini→reçel, üzüm→şarap...).
5. **🛖 Dükkan** — Kazancı çiftliğe yatır: yeni tarla, mutfak, otomatik sulama, şirin tezgah
   (+%15 fiyat), şaraphane (premium ürünler).

Toplam kazancın **Pazar itibarı** seviyeni yükseltir; her seviye yeni tohum ve olanaklar açar.

## Tasarım felsefesi (cozy)

- **Baskı yok:** timer yok, enerji/açlık yok, oyun bitmez.
- **Yavaş ve tatmin edici döngü:** her gün küçük ilerleme, ara sıra komşu hediyesi.
- **Derinlik seçeneği:** ham satış kolay yol; işleme (atölye) kârı katlar ama planlama ister.
- **Kaldığın yerden devam:** tarayıcı kapansa da ilerleme durur.

## Teknik

- Saf HTML/CSS/JS (vanilla), harici bağımlılık yok — çevrimdışı çalışır.
- Durum `localStorage` (`kucuk_pazar_v1` anahtarı) üzerinden kaydedilir.
- İçerik veri-odaklı (`CROPS`, `GOODS`, `UPGRADES`, `LEVELS`) — yeni ürün/tarif eklemek kolay.

## Sonraki adımlar (v1 fikirleri)

- Hayvanlar (inek→süt→peynir), arı kovanı→bal
- Mevsime bağlı ürünler ve fiyat dalgalanması
- Kasaba müşterileri / özel siparişler (küçük hikâye dokunuşu)
- Ses ve minik animasyonlar, dekorasyon/estetik katman
- Başarımlar ve "koleksiyon" defteri
