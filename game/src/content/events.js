// Events. Each one must (a) name a person, (b) cost something before you know,
// (c) make you wait, (d) leave a mark the world can bring up later.
// An event that does none of those is a popup, and popups have no weight.

import { S, ch, ti, pv, rng, alive } from '../core/state.js';
import { offer, STAKE } from '../sim/decision.js';
import { fullName, age, livingChildren, opinion, remember, kill, relation, isKin, skill } from '../sim/characters.js';
import { primaryTitle, styleOf, vassalsOf, directCountiesOf, grantTitle, incomeOf, realmLevy } from '../sim/realm.js';
import { YEAR } from '../core/date.js';

const P = () => ch(S.playerId);

function provIdxOf(provinceId) {
  const i = (S.mapMeta?.provinces || []).findIndex((p) => p.id === provinceId);
  return i < 0 ? null : i;
}
function anyProvinceOf(charId) {
  const t = directCountiesOf(charId)[0];
  return t ? provIdxOf(t.provinceId) : null;
}

// ---------------------------------------------------------------------------
export const EVENTS = [

// --- 1. The ambitious brother ------------------------------------------------
{
  id: 'brother_ambition',
  weightHint: 0.72,
  once: true,
  cooldown: 8 * YEAR,
  valid() {
    const p = P();
    const sib = Object.values(S.chars).find((c) => c.deathDay == null && c.isSibling === p.id && age(c) > 16);
    return sib ? { sib } : false;
  },
  fire({ sib }) {
    const p = P();
    const opn = opinion(sib.id, p.id);
    const detect = Math.min(0.9, 0.35 + skill(p, 'intrigue') * 0.03);
    offer({
      kind: 'event',
      title: 'Kardeşinin Sofrası',
      targetId: sib.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${fullName(sib)} bu ay üç kez senin vassallarını ağırladı. Davetlerden birine sen de çağrılmadın.`,
      body: `Kâhyan konuşuyor: "Efendim, kardeşiniz kimin ne kadar asker çıkardığını soruyor. Bir de kimin size darıldığını."\n\nO senin kanın. Kanın olması onu tehlikeli yapmıyor — tehlikeli yapan, senin yerine geçebilecek tek insan olması.`,
      options: [
        {
          key: 'watch', label: 'Bir şey yapma. İzle.',
          detail: 'Belki sadece can sıkıntısıdır. Belki de değildir.',
          waitDays: 240, odds: 0.55,
          tone: 'neutral',
          stakes: [{ kind: STAKE.REPUTATION, label: 'zaman' }],
          tells: [
            { at: 0.3, text: () => `${sib.name} bu hafta iki kez şehirden çıktı. Nereye gittiğini kimse söylemiyor.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.7, text: () => `Kardeşinin adamları ahırda seninkilerle kavga etti. Kimse sebebini anlatmıyor.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              remember(sib.id, S.playerId, 'Kardeşin ona güvendi.', +20, 20);
              return { beat: 'hiçbir şey olmadı', title: 'Sadece Can Sıkıntısıymış', text: `${fullName(sib)} bir kış boyunca av peşinde koştu, sonra sustu.\n\nBazen bir adam sadece yalnızdır.`, effects: [`<b>${sib.name}</b> senden yana +20`] };
            }
            const v = vassalsOf(S.playerId).slice(0, 2);
            for (const x of v) remember(x.id, S.playerId, 'Kardeşin ona daha iyi şartlar teklif etti.', -25, 25);
            S.flags.brotherPlotting = true;
            return { beat: 'geç kaldın', title: 'Üç Vassalın Yemin Etti — Sana Değil', text: `Kardeşin sessizce bir taraf kurdu. Yemin metnini gösterdiler: senin adın yok.\n\nİzlemek de bir karardı. Onu sen verdin.`, effects: v.map((x) => `<b>${x.name}</b> sadakati düştü`), knell: false };
          },
        },
        {
          key: 'gift', label: 'Ona bir kontluk ver.',
          detail: 'Doyur ki aç kalmasın. Ama doyan bir kurt daha güçlü olur.',
          cost: [{ kind: STAKE.GOLD, value: 60 }],
          stakes: [{ kind: STAKE.TITLE, who: 'bir kontluğun', irreversible: true }],
          waitDays: 400, odds: 0.62,
          onCommit() {
            const t = directCountiesOf(S.playerId)[1] || directCountiesOf(S.playerId)[0];
            if (t) { grantTitle(t.id, sib.id, 'appease'); S.flags.gaveBrotherLand = t.id; }
          },
          onResolve(d, ok) {
            if (ok) { remember(sib.id, S.playerId, 'Ona toprak verdin.', +45, 40);
              return { beat: 'yetti', title: 'Doydu', text: `${fullName(sib)} kendi kalesinde oturuyor. Adamların diyor ki senin adını hayırla anıyor.\n\nBir toprak eksildi. Bir düşman da eksildi. Hangisi daha pahalı, on yıl sonra anlarsın.`, effects: [`<b>${sib.name}</b> +45 sadakat`, 'Bir kontluk kalıcı olarak gitti'] }; }
            return { beat: 'yetmedi', title: 'Daha Fazlasını İstiyor', text: `Verdiğin toprak iştahını açtı. Şimdi düklük istiyor.\n\nAç bir adamı doyurursan aç olduğunu öğrenir.`, effects: [`Bir kontluk gitti — <b>karşılığı yok</b>`, `<b>${sib.name}</b> artık senin rakibin`] };
          },
        },
        {
          key: 'imprison', label: 'Zindana at.',
          detail: 'Kendi kardeşini. Herkesin gözü önünde.',
          confirm: 'Kendi kardeşini zincire mi vuracaksın?',
          stakes: [{ kind: STAKE.KIN, who: fullName(sib) }, { kind: STAKE.REPUTATION }],
          waitDays: 60, odds: Math.min(0.92, 0.45 + skill(P(), 'intrigue') * 0.045),
          tells: [{ at: 0.5, text: 'Zindancı, kardeşinin yemek yemediğini söylüyor.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            for (const v of vassalsOf(S.playerId)) remember(v.id, S.playerId, 'Kendi kardeşini zindana attı.', -20, 30);
            if (ok) { sib.imprisonedBy = S.playerId;
              return { beat: 'tuttun', title: 'Zincirler Tuttu', text: `${fullName(sib)} şimdi senin zindanında. Yemek yiyor, konuşmuyor.\n\nVassalların bunu gördü. Hepsi kendi kardeşini düşündü.`, effects: ['Tüm vassalların −20 sadakat', 'Kardeşin hapiste — ve seni bekliyor'] }; }
            S.flags.brotherFled = true;
            return { beat: 'kaçtı', title: 'Kaçtı', text: `Adamların kapıya vardığında yatak soğuktu.\n\nŞimdi bir yerlerde, sana kızgın, özgür ve haklı.`, effects: ['Kardeşin firarda', 'Tüm vassalların −20 sadakat'] };
          },
        },
      ],
    });
  },
},

// --- 2. The heir's fever ------------------------------------------------------
{
  id: 'heir_fever',
  weightHint: 0.86,
  cooldown: 12 * YEAR,
  valid() {
    const kids = livingChildren(P()).filter((k) => age(k) < 15);
    if (!kids.length) return false;
    return { kid: rng.pick(kids) };
  },
  chance: 0.35,
  fire({ kid }) {
    const p = P();
    offer({
      kind: 'event',
      title: 'Çocuğun Ateşi',
      targetId: kid.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${kid.name} üç gündür yataktan kalkamıyor. Dadısı odadan çıkmıyor.`,
      body: `Hekim geldi, baktı, uzun uzun sustu. Sonra iki şey söyledi.\n\nBirincisi: kan almak gerek. İkincisi: kan almak da öldürebilir.\n\nDışarıda kar yağıyor. İçeride çocuk terliyor.`,
      options: [
        {
          key: 'bleed', label: 'Hekimi dinle. Kan alsın.',
          detail: 'Hekim iyi bir hekim. Ama çocuk çok küçük.',
          cost: [{ kind: STAKE.GOLD, value: 25 }],
          stakes: [{ kind: STAKE.KIN, who: kid.name }],
          waitDays: 21, odds: 0.66,
          tells: [
            { at: 0.35, text: () => `${kid.name} sabaha karşı bir şeyler mırıldandı. Dadı ağlıyor ama neden bilmiyor.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.75, text: () => `Ateş düştü. Sonra tekrar çıktı.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) return { beat: 'yaşadı', title: `${kid.name} Gözlerini Açtı`, text: `Sabah odaya girdiğinde oturmuş, çorba istiyordu.\n\nHekime altınını verdin. Ona ne verdiğini bilmiyorsun.`, effects: [`<b>${kid.name}</b> iyileşti`] };
            kill(kid, 'illness');
            S.stats.kin_lost++;
            return { beat: 'yaşamadı', title: `${kid.name} Öldü`, knell: true, text: `Sabaha karşı oldu. Kimse uyanık değildi.\n\nHekim eşyalarını topladı ve bir şey söylemeden gitti. Ona kızamıyorsun bile.`, effects: [`<b>${kid.name}</b> öldü — ${age(kid)} yaşındaydı`, 'Veraset sıran değişti'] };
          },
        },
        {
          key: 'pray', label: 'Hekimi gönder. Dua et.',
          detail: 'Tanrı’ya bırakmak da bir karardır. En ağırı.',
          cost: [{ kind: STAKE.PIETY, value: 0 }],
          stakes: [{ kind: STAKE.KIN, who: kid.name }, { kind: STAKE.SOUL }],
          waitDays: 30, odds: 0.44,
          tells: [{ at: 0.5, text: 'Kilisede/mescitte üç gündür sen varsın. Kimse yanına gelmeye cesaret edemiyor.', goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { p2.piety += 120;
              return { beat: 'duyuldu', title: `${kid.name} Kalktı`, text: `Kimse nasıl olduğunu açıklayamıyor. Hekim zaten gitmişti.\n\nSen açıklamaya çalışmıyorsun.`, effects: [`<b>${kid.name}</b> iyileşti`, '+120 dindarlık'] }; }
            kill(kid, 'illness'); S.stats.kin_lost++;
            p2.stress += 25;
            return { beat: 'duyulmadı', title: `${kid.name} Öldü`, knell: true, text: `Hekimi sen gönderdin. Bunu hatırlayacaksın.\n\nHer sabah, uzun yıllar boyunca hatırlayacaksın.`, effects: [`<b>${kid.name}</b> öldü`, '+25 gerginlik', 'Hatıra: hekimi gönderdin'] };
          },
        },
      ],
    });
  },
},

// --- 3. The vassal who wants your land ---------------------------------------
{
  id: 'vassal_demand',
  weightHint: 0.55,
  cooldown: 5 * YEAR,
  valid() {
    const vs = vassalsOf(S.playerId).filter((v) => opinion(v.id, S.playerId) < 10 && directCountiesOf(v.id).length);
    return vs.length ? { v: rng.pick(vs) } : false;
  },
  chance: 0.45,
  fire({ v }) {
    const p = P();
    const mine = directCountiesOf(p.id);
    const t = mine[mine.length - 1];
    if (!t) return;
    offer({
      kind: 'event',
      title: 'Divanda Bir Talep',
      targetId: v.id,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `${fullName(v)} divanda ayağa kalktı ve ${t.name} kontluğunu istedi. Herkesin önünde.`,
      body: `"Babam o toprakta öldü," diyor. "Sizin bir kâhyanız yönetiyor. Benim orada kanım var."\n\nSalon sessiz. Diğer vassalların sana bakmıyor — birbirlerine bakıyorlar. Ne yaparsan onu öğrenecekler.`,
      options: [
        { key: 'give', label: 'Ver.', detail: 'Barış ucuz değil ama savaş daha pahalı.',
          stakes: [{ kind: STAKE.TITLE, who: `${t.name} kontluğu`, irreversible: true }],
          waitDays: 0,
          onResolve() {
            grantTitle(t.id, v.id, 'demand');
            remember(v.id, S.playerId, 'Talebini kabul etti.', +40, 30);
            for (const o of vassalsOf(S.playerId)) if (o.id !== v.id) remember(o.id, S.playerId, 'İsteyene veriyor.', -8, 15);
            return { success: true, beat: 'verdin', title: `${t.name} El Değiştirdi`, text: `${fullName(v)} elini öptü. Diğerleri izledi ve not aldı.\n\nBir sonraki talep daha büyük olacak.`, effects: [`<b>${t.name}</b> kalıcı olarak gitti`, `<b>${v.name}</b> +40`, 'Diğer vassallar −8'] };
          } },
        { key: 'refuse', label: 'Reddet.', detail: 'Herkesin önünde. Herkesin önünde reddetmek de bir şeydir.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 120, odds: 0.58,
          tells: [{ at: 0.5, text: () => `${v.name} bu ay saraya gelmedi. Vergisini de geciktirdi.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            remember(v.id, S.playerId, 'Talebini herkesin önünde reddetti.', -35, 30);
            if (ok) { P().prestige += 80;
              return { beat: 'yuttu', title: 'Sustu', text: `${fullName(v)} yerine oturdu ve bir daha açmadı.\n\nDiğerleri gördü. Kimse bir şey istemedi bu yıl.`, effects: ['+80 itibar', `<b>${v.name}</b> −35`] }; }
            v.faction = 'claimant';
            return { beat: 'yutmadı', title: 'Kaleye Çekildi', text: `${fullName(v)} kalesine kapandı ve komşularına haber saldı.\n\nBir tarafın doğuşunu izliyorsun.`, effects: [`<b>${v.name}</b> ayaklanmaya hazırlanıyor`, `<b>${v.name}</b> −35`] };
          } },
        { key: 'humiliate', label: 'Divanda küçük düşür.',
          detail: 'Korkutmak, sevilmemekten daha hızlı işler. Bir süre.',
          cost: [{ kind: STAKE.PRESTIGE, value: 40 }],
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 180, odds: 0.42,
          tells: [{ at: 0.4, text: 'Vassallarından ikisi divana gelmemeye başladı.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            remember(v.id, S.playerId, 'Onu herkesin önünde küçük düşürdü.', -60, 45);
            const p2 = P();
            if (ok) { p2.dreadBonus = (p2.dreadBonus || 0) + 6;
              return { beat: 'korktular', title: 'Salonda Kimse Konuşmadı', text: `${fullName(v)} kızardı, sonra sarardı, sonra oturdu.\n\nO günden sonra kimse gözüne bakmadı. Bu işine geliyor. Şimdilik.`, effects: ['+6 dehşet', `<b>${v.name}</b> −60 (kin tutuyor)`] }; }
            for (const o of vassalsOf(S.playerId)) remember(o.id, S.playerId, 'Bir vassalını herkesin önünde ezdi.', -18, 30);
            return { beat: 'ters tepti', title: 'Salon Ona Acıdı', text: `Küçük düşen adam bazen kahraman olur. Bunu hesaba katmamıştın.\n\nDivandan çıkarken üç kişi onun peşinden gitti.`, effects: ['Tüm vassallar −18', `<b>${v.name}</b> −60`] };
          } },
      ],
    });
  },
},

// --- 4. Famine -----------------------------------------------------------------
{
  id: 'famine',
  weightHint: 0.6,
  cooldown: 10 * YEAR,
  chance: 0.25,
  valid() {
    const mine = directCountiesOf(S.playerId);
    return mine.length ? { t: rng.pick(mine) } : false;
  },
  fire({ t }) {
    const p = P();
    const prov = pv(t.provinceId);
    const cost = Math.max(30, Math.round(incomeOf(p.id) * 12));
    offer({
      kind: 'event',
      title: `${prov.name}'da Kıtlık`,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `Yağmur gelmedi. Sonra da gelmedi. Şimdi ${prov.name} halkı tohumluk buğdayı yiyor.`,
      body: `Ambarlarında yetecek kadar var. Kendine yetecek kadar.\n\nKâhyan hesabı yaptı: hepsini dağıtırsan kışı çıkarırlar. Sen çıkaramazsın.`,
      options: [
        { key: 'open', label: 'Ambarları aç.', detail: 'Hepsini.',
          cost: [{ kind: STAKE.GOLD, value: cost }],
          stakes: [{ kind: STAKE.GOLD, value: cost }],
          waitDays: 150, odds: 0.74,
          disabled: p.gold < cost, disabledWhy: `${cost} altının yok`,
          tells: [{ at: 0.5, text: () => `${prov.name}'dan haber: ölüm azaldı ama bitmedi.`, goodTone: 'good', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            if (ok) { prov.development += 1; P().prestige += 60;
              return { beat: 'çıkardılar', title: 'Kışı Çıkardılar', text: `İlkbaharda ${prov.name}'a girdiğinde yol kenarına dizilmişlerdi.\n\nKimse alkışlamadı. Sadece baktılar. Bu daha iyiydi.`, effects: [`${prov.name} +1 kalkınma`, '+60 itibar'] }; }
            prov.development = Math.max(1, prov.development - 2);
            return { beat: 'yetmedi', title: 'Yetmedi', text: `Buğday geldi ama geç geldi. Yollar kapalıydı.\n\nAltının gitti. İnsanlar da gitti.`, effects: [`${prov.name} −2 kalkınma`, `${cost} altın gitti`] };
          } },
        { key: 'hold', label: 'Ambarları kapalı tut.', detail: 'Hazine bir devletin kanıdır. Halk yenilenir.',
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.SOUL }],
          waitDays: 150, odds: 0.30,
          tells: [{ at: 0.4, text: () => `${prov.name}'dan gelen kervan boş döndü. Kimse bir şey satmıyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            prov.development = Math.max(1, prov.development - 3);
            prov.unrest += 30;
            const p2 = P();
            p2.piety = Math.max(0, p2.piety - 60);
            if (ok) return { beat: 'sustular', title: 'Sustular', text: `Kış geçti. ${prov.name}'ın nüfusu üçte bir azaldı ve kimse ayaklanmadı.\n\nHazinen dolu. Bunu bir başarı saymak zorundasın.`, effects: [`${prov.name} −3 kalkınma`, '−60 dindarlık', 'Halk seni unutmayacak'] };
            return { beat: 'susmadılar', title: 'Ambarları Bastılar', text: `Kapıyı kırdıklarında muhafızların çekildi. Onlar da açtı.\n\nBuğday yine gitti. Bu sefer minnet olmadan.`, effects: [`${prov.name} −3 kalkınma, +30 huzursuzluk`, 'Buğday yine gitti', '−60 dindarlık'] };
          } },
      ],
    });
  },
},

// --- 5. An offer you should not take -------------------------------------------
{
  id: 'poison_offer',
  weightHint: 0.8,
  cooldown: 15 * YEAR,
  chance: 0.2,
  valid() {
    const p = P();
    if (!p.liegeId || !alive(p.liegeId)) return false;
    return { liege: ch(p.liegeId) };
  },
  fire({ liege }) {
    const p = P();
    const spy = ch(S.council?.spymaster);
    offer({
      kind: 'scheme',
      title: 'Bir Şişe',
      targetId: liege.id,
      scene: { provinceIdx: anyProvinceOf(liege.id) },
      framing: `${spy ? fullName(spy) : 'Casusun'} masaya küçük bir şişe bıraktı ve hiçbir şey söylemedi.`,
      body: `Efendin ${fullName(liege)} önümüzdeki ay senin kalende konaklayacak. Aşçısı senin aşçın olacak.\n\nBir daha böyle bir gece olmayacak. Bunu ikiniz de biliyorsunuz.`,
      options: [
        { key: 'no', label: 'Şişeyi ateşe at.', detail: 'Bazı kapılar açılmasın diye vardır.',
          waitDays: 0,
          onResolve() {
            P().piety += 50;
            return { success: true, beat: 'atmadın mı?', title: 'Ateş Aldı', text: `Cam çatladı, alev yeşile döndü, sonra söndü.\n\n${spy ? spy.name : 'Casusun'} bir daha bu konuyu açmadı. Ama sana bakışı değişti.`, effects: ['+50 dindarlık', 'Casusun seni tanıdı'] };
          } },
        { key: 'yes', label: 'Aşçıya ver.',
          detail: `Efendini öldürmek. Onun toprağını almak. Yakalanırsan kellen gider.`,
          confirm: `${fullName(liege)} yarın sabah ölsün mü?`,
          cost: [{ kind: STAKE.GOLD, value: 80 }],
          stakes: [{ kind: STAKE.LIFE, who: fullName(liege) }, { kind: STAKE.OATH }, { kind: STAKE.SOUL }, { kind: STAKE.SECRET }],
          waitDays: 45,
          odds: Math.min(0.80, 0.30 + skill(P(), 'intrigue') * 0.045),
          tells: [
            { at: 0.3, text: 'Aşçı bu sabah mutfağa gelmedi. Öğlen geldi. Kimseyle konuşmadı.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.65, text: () => `${liege.name} kalene girdi. Sana sarıldı. Sofraya oturuldu.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.9, text: 'Gece yarısı koridorda ayak sesleri. Sonra sessizlik.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              kill(liege, 'murder', p2.id);
              p2.secrets.push({ id: 'murder_liege', kind: 'murder', victimId: liege.id, day: S.day });
              S.stats.oaths_broken++;
              if (!p2.traits.includes('kinslayer') && isKin(p2.id, liege.id)) p2.traits.push('kinslayer');
              return { beat: 'öldü', title: `${fullName(liege)} Sabaha Çıkmadı`, knell: true,
                text: `Hizmetçi çığlığıyla uyandın. Koştun. Kalabalığın arasında doğru yüzü takınmayı başardın.\n\nKimse bir şey söylemedi. Bu, kimsenin bilmediği anlamına gelmiyor.`,
                effects: ['<b>Sır:</b> efendini sen öldürdün', 'Bu sır bir gün ortaya çıkabilir', 'Yeminini bozdun'] };
            }
            p2.prestige -= 150;
            p2.traits.push('oathbreaker');
            for (const v of vassalsOf(p2.id)) remember(v.id, p2.id, 'Efendisini zehirlemeye kalktı.', -40, 50);
            return { beat: 'yakalandın', title: 'Aşçı Konuştu', knell: true,
              text: `İşkenceye dayanmadı. Zaten kimse dayanmıyor.\n\n${fullName(liege)} seni divana çağırdı. Gitmek zorundasın.`,
              effects: ['<b>Sözünden Dönen</b> damgası', '−150 itibar', 'Efendin biliyor'] };
          } },
      ],
    });
  },
},
];

// --- driver ------------------------------------------------------------------
const lastFired = {};
export function tryFireEvents(day) {
  if (S.decisions.some((d) => d.state === 'open')) return;   // one at a time, always
  const pool = [];
  for (const e of EVENTS) {
    if (e.once && lastFired[e.id]) continue;
    if (lastFired[e.id] && day - lastFired[e.id] < (e.cooldown || YEAR * 3)) continue;
    const v = e.valid?.();
    if (!v) continue;
    pool.push({ e, v, w: (e.weightHint || 0.4) * 10 });
  }
  if (!pool.length) return;
  const pick = rng.weighted(pool);
  if (!rng.chance(pick.e.chance ?? 0.5)) return;
  lastFired[pick.e.id] = day;
  pick.e.fire(pick.v === true ? {} : pick.v);
}
export function resetEventHistory() { for (const k of Object.keys(lastFired)) delete lastFired[k]; }
