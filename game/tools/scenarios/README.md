# Senaryolar

`inspect --script` ile çalışan, tekrar edilebilir kontroller.

```bash
./inspect --out /tmp/x --script game/tools/scenarios/hold-gate.mjs
```

## hold-gate.mjs
Basılı-tut kapısının gerçekten taahhüt ettiğini doğrular ve **ilerleme çubuğunu
yolun yarısında ölçer**. Beklenen: `fill at halfway ≈ %50` ve `GATE TEST: PASS`.

Neden var: kapı bir kez, ilerlemeyi ilk animasyon karesinden saydığı için
bozulmuştu. Yazılım rasterleştirmede ilk kare yarım saniyeden geç gelebiliyor,
dolayısıyla oyuncu butonun söylediği kadar basılı tutup bırakıyor ve "elini
çektin" cezası yiyordu. Ölçüm o zaman %18 diyordu. Bu senaryo o hatanın geri
gelmesini engeller — sadece "kapı açıldı mı" diye bakmak yetmez, **hız** ölçülmeli.
