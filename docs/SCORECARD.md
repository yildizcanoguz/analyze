# Puan kartı — eleştirmen bunu doldurur

Her eleştirmen kendi parçası için bunu doldurur ve `docs/verdicts/<parça>.md`
olarak yazar. Boş bırakılan satır = o parça geçemedi.

```
## <PARÇA KODU> — <ad>
İncelenen build: <inspect çıktı dizini>   pageErrors: <sayı>
Baktığım ekran görüntüleri: <dosya adları>

### Ölçüt 0 — KARAR SONRASI GERGİNLİK  (ağırlık %45)
| alt-ölçüt | Oyun A (bizim) | Oyun B (referans) | kim kazandı |
|---|---|---|---|
| Ağırlık                | /10 | /10 | A / B |
| Bedel önden mi         | /10 | /10 | A / B |
| Geri dönülemezlik      | /10 | /10 | A / B |
| Bekleyiş               | /10 | /10 | A / B |
| İşaretler              | /10 | /10 | A / B |
| Sonucun oturması       | /10 | /10 | A / B |
| Yankı                  | /10 | /10 | A / B |
**Ölçüt 0 toplamı: A = /10   B = /10**

Somut gerekçe (en az 3 cümle, ekran görüntüsüne atıfla):
<...>

### Ölçüt 1 — İsimli insanlar (%15):  A /10  B /10  → kazanan:
### Ölçüt 2 — Sistem derinliği (%15): A /10  B /10  → kazanan:
### Ölçüt 3 — Yazım (%10):            A /10  B /10  → kazanan:
### Ölçüt 4 — Görsellik (%10):        A /10  B /10  → kazanan:
### Ölçüt 5 — Cila (%5):              A /10  B /10  → kazanan:

**AĞIRLIKLI TOPLAM:  A = /10   B = /10**
**KÖR KARŞILAŞTIRMA SONUCU: Oyun A / Oyun B daha iyi — çünkü <tek cümle>**

### KARAR: GEÇTİ | GEÇTİ (ŞARTLI) | GERİ GÖNDER

### Geri gönderme maddeleri (en fazla 6)
1. dosya: `...`  kusur: `...`  olması gereken: `...`
```

## Kurallar
- Ekran görüntüsüne bakmadan puan verme.
- "İkisi de iyi" yasak. Her satırda bir taraf seç.
- Ölçüt 0'da A < 6.5 ise karar **GERİ GÖNDER** olmak zorunda; başka seçenek yok.
- Övgü yazma. Kusur yaz.
