// ===========================================================================
// P19 — EVENTS
// ---------------------------------------------------------------------------
// Four rules. An event that breaks one of them is a popup, and popups have no
// weight:
//
//   (a) It names a person — name, age in words, and a face you would recognise
//       in a crowd. Not "a vassal".
//   (b) It takes something from you at the moment you choose, before anyone
//       knows how it ends.
//   (c) It makes you wait, and it whispers at you while you wait.
//   (d) Its onResolve leaves a permanent mark: land moves, someone dies, a
//       secret is written down, a man remembers you for thirty years.
//
// Prose rules live in content/text.js and are checkable there. Short sentences.
// Second person. Concrete nouns. No numbers in the prose — numbers go in
// `effects`. The heaviest line is the plainest one.
// ===========================================================================

import { S, ch, ti, pv, rng, alive } from '../core/state.js';
import { offer, STAKE } from '../sim/decision.js';
import {
  fullName, age, livingChildren, opinion, remember, kill, relation, isKin, skill,
  makeCharacter, healthOf, dread,
} from '../sim/characters.js';
import {
  primaryTitle, styleOf, vassalsOf, directCountiesOf, grantTitle, incomeOf, realmLevy, topLiege,
} from '../sim/realm.js';
import { YEAR, fmtDate, seasonOf } from '../core/date.js';
import {
  who, whoFace, faceLine, ticLine, kinWord, tied, spell, cap, him,
  dat, acc, gen, loc, abl, accL, genL, locL, weatherLine, hourLine, lens, byTrait, has, onlyIf, opts, uncap, manWord, sexed,
} from './text.js';

const P = () => ch(S.playerId);

// --- world pickers -----------------------------------------------------------
// valid() runs constantly, so it must not touch rng: a probe that burns the
// stream would make the same seed play differently depending on how many events
// happened to be checked. pickDay() varies with the calendar instead.
function pickDay(arr, salt = 0) {
  if (!arr || !arr.length) return null;
  return arr[Math.abs(Math.floor(S.day / 7) + salt) % arr.length];
}
function provIdxOf(provinceId) {
  const i = (S.mapMeta?.provinces || []).findIndex((p) => p.id === provinceId);
  return i < 0 ? null : i;
}
function anyProvinceOf(charId) {
  const t = directCountiesOf(charId)[0];
  return t ? provIdxOf(t.provinceId) : null;
}
const myCounties = () => directCountiesOf(S.playerId);
const councilman = (role) => { const c = ch(S.council?.[role]); return c && c.deathDay == null ? c : null; };
function courtiers() {
  return Object.values(S.chars).filter((c) => c.deathDay == null && c.courtOf === S.playerId && c.id !== S.playerId);
}
/** A ruler whose land touches yours and who is not one of your own men. */
function neighbourRuler(salt = 0) {
  const mine = myCounties();
  if (!mine.length) return null;
  for (let k = 0; k < mine.length; k++) {
    const t = mine[(Math.abs(Math.floor(S.day / 11) + salt + k)) % mine.length];
    const prov = pv(t.provinceId);
    for (const nid of prov?.neighbors || []) {
      const nt = ti(`t_${nid}`);
      const h = nt && ch(nt.holderId);
      if (h && h.deathDay == null && h.id !== S.playerId && topLiege(h.id) !== S.playerId) {
        return { ruler: h, prov: pv(nid), title: nt, mine: t, myProv: prov };
      }
    }
  }
  return null;
}
/** Make a stranger once and keep him: a name that comes back is worth more. */
function keeper(flag, mk) {
  const old = ch(S.flags[flag]);
  if (old && old.deathDay == null) return old;
  const c = mk();
  S.flags[flag] = c.id;
  return c;
}
/** Everyone under you hears about it. The room is always listening. */
function courtHears(text, delta, life = 25) {
  for (const v of subjects()) remember(v.id, S.playerId, text, delta, life);
}
/**
 * The men who answer to you. A count with no barons under him still has a
 * household: sworn men who hold no land but eat at his table, collect his tax
 * and expect to be heard. Events about loyalty must work for both, or half the
 * game never fires for a small ruler.
 */
function subjects() {
  const landed = vassalsOf(S.playerId).filter((v) => v.deathDay == null && age(v) > 16);
  if (landed.length) return landed;
  const council = new Set(Object.values(S.council || {}));
  return courtiers().filter((c) => age(c) > 16 && !council.has(c.id) && c.fatherId !== S.playerId && c.motherId !== S.playerId);
}
/** What such a man is called to his face. */
const rank = (v) => (directCountiesOf(v.id).length ? 'vassalın' : 'vergi toplayıcın');
const clericWord = () => (P()?.faith === 'sunni' ? 'İmamın' : 'Papazın');
const clericBare = () => (P()?.faith === 'sunni' ? 'İmam' : 'Papaz');
const houseWord = () => (P()?.faith === 'sunni' ? 'mescit' : 'kilise');
const intrigue = () => skill(P(), 'intrigue');
const clampOdds = (x) => Math.max(0.05, Math.min(0.95, x));

// ---------------------------------------------------------------------------
export const EVENTS = [

// --- 1. saray: the brother who counts your soldiers -------------------------
{
  id: 'brother_ambition', cat: 'saray', weightHint: 0.72, once: true, cooldown: 8 * YEAR,
  valid() {
    const p = P();
    const sib = Object.values(S.chars).find((c) => c.deathDay == null && c.isSibling === p?.id && age(c) > 16);
    return sib ? { sib } : false;
  },
  fire({ sib }) {
    const p = P();
    offer({
      kind: 'event', title: 'Kardeşinin Sofrası', targetId: sib.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${whoFace(sib)} bu ay üç kez senin vassallarını ağırladı, seni çağırmadan.`,
      body: `${weatherLine()} Kâhyan kapıda bekledi, sonra girdi.\n\n"Efendim, kardeşiniz kimin kaç asker çıkardığını soruyor. Bir de kimin size darıldığını."\n\nKapıda üç at bekliyor. Hiçbirinin eyeri senin damganı taşımıyor.\n\nOnu tehlikeli yapan kardeşin olması değil. Senin yerine geçebilecek tek insan olması.`,
      options: opts(
        {
          key: 'watch', label: 'Bir şey yapma. İzle.',
          detail: lens({ paranoid: 'Bekleyen adam bir şey öğrenir. Genellikle geç öğrenir.', patient: 'Acele eden hata yapar. Sen etmezsin.' }, 'Belki can sıkıntısıdır. Belki değildir.'),
          waitDays: 240, odds: 0.55, tone: 'neutral',
          stakes: [{ kind: STAKE.REPUTATION }],
          onCommit() { courtHears('Kardeşi masasını kurarken sustu.', -6, 12); },
          tells: [
            { at: 0.3, text: () => `${sib.name} bu hafta iki kez şehirden çıktı. Nereye gittiğini söyleyen yok.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.7, text: () => `${gen(sib.name)} adamları ahırda seninkilerle kavga etti.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              remember(sib.id, S.playerId, 'Ona güvendin.', +20, 20);
              return { beat: 'boşmuş', title: 'Sadece Can Sıkıntısı', text: `Bütün kışı av peşinde geçirdi. İlkbaharda sofrası boştu.\n\nBazen insan sadece yalnızdır.`, effects: [`<b>${sib.name}</b> senden yana +20`] };
            }
            const v = subjects().slice(0, 2);
            for (const x of v) remember(x.id, S.playerId, 'Kardeşi daha iyi şartlar teklif etti.', -25, 25);
            S.flags.brotherPlotting = true;
            sib.faction = 'claimant';
            return { beat: 'geç kaldın', title: 'Yemin Metninde Adın Yok', text: `Kardeşin sessizce bir taraf kurdu. Metni sana da gösterdiler.\n\nİzlemek de bir karardı. Onu sen verdin.`, effects: [`<b>${sib.name}</b> kendi tarafını kurdu`, ...v.map((x) => `<b>${x.name}</b> sadakati düştü`)] };
          },
        },
        {
          key: 'gift', label: 'Ona bir kontluk ver.',
          detail: byTrait(sib, { greedy: 'Aç bir adam. Doyunca susar mı, bilinmez.', ambitious: 'Verdiğin toprak iştahını kapatmaz. Ölçer.' }, 'Doyur ki aç kalmasın.'),
          cost: [{ kind: STAKE.GOLD, value: 60 }],
          stakes: [{ kind: STAKE.TITLE, who: 'bir kontluğun', irreversible: true }],
          waitDays: 400, odds: 0.62,
          onCommit() {
            const t = myCounties()[1] || myCounties()[0];
            if (t) { grantTitle(t.id, sib.id, 'appease'); S.flags.gaveBrotherLand = t.id; }
          },
          tells: [
            { at: 0.4, text: () => `${cap(gen(sib.name))} kalesinde duvar örüyorlar. Taşı nereden aldığı belli değil.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const t = ti(S.flags.gaveBrotherLand);
            if (ok) {
              remember(sib.id, S.playerId, 'Ona toprak verdi.', +45, 40);
              return { beat: 'yetti', title: 'Doydu', text: `Kendi kalesinde oturuyor. Adını hayırla anıyormuş.\n\nBir toprak eksildi. Bir düşman da eksildi. Hangisinin daha pahalı olduğunu on yıl sonra anlarsın.`, effects: [`<b>${sib.name}</b> +45 sadakat`, `<b>${t?.name || 'Bir kontluk'}</b> kalıcı olarak gitti`] };
            }
            sib.faction = 'claimant';
            return { beat: 'yetmedi', title: 'Şimdi Düklük İstiyor', text: `Verdiğin toprak bir ölçüydü. Ölçtü.\n\nAçlığını doyurdun. İştahını değil.`, effects: [`<b>${t?.name || 'Bir kontluk'}</b> gitti — <b>karşılığı yok</b>`, `<b>${sib.name}</b> artık rakibin`] };
          },
        },
        {
          key: 'imprison', label: 'Zindana at.',
          detail: 'Kendi kardeşini. Herkesin gözü önünde.',
          confirm: 'Kendi kardeşini zincire mi vuracaksın?',
          stakes: [{ kind: STAKE.KIN, who: fullName(sib) }, { kind: STAKE.REPUTATION }],
          waitDays: 60, odds: clampOdds(0.45 + intrigue() * 0.045),
          onCommit() { courtHears('Kendi kardeşini zincire vurdurdu.', -20, 30); },
          tells: [
            { at: 0.5, text: 'Zindancı, kardeşinin üç gündür yemek yemediğini söylüyor.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              sib.imprisonedBy = S.playerId;
              return { beat: 'tuttu', title: 'Zincirler Tuttu', text: `Şimdi senin zindanında. Yemek yiyor. Konuşmuyor.\n\nVassalların bunu gördü. Her biri kendi kardeşini düşündü.`, effects: ['Tüm vassalların −20 sadakat', 'Kardeşin hapiste — ve seni bekliyor'] };
            }
            S.flags.brotherFled = true;
            remember(sib.id, S.playerId, 'Onu zincire vurdurmaya kalktı.', -70, 60);
            return { beat: 'kaçtı', title: 'Yatak Soğuktu', text: `Adamların kapıyı kırdığında oda boştu. Pencere açıktı.\n\nŞimdi bir yerde, sana kızgın, özgür ve haklı.`, effects: ['Kardeşin firarda', 'Tüm vassalların −20 sadakat'] };
          },
        },
        onlyIf(has(P(), 'paranoid') || has(P(), 'deceitful'), {
          key: 'plant', label: 'Yanına adam koy.',
          detail: 'Sofrasına oturacak biri. Senin adamın olduğunu bilmeyecek kimse.',
          cost: [{ kind: STAKE.GOLD, value: 35 }],
          stakes: [{ kind: STAKE.SECRET }],
          waitDays: 300, odds: clampOdds(0.40 + intrigue() * 0.05),
          tells: [
            { at: 0.5, text: 'Adamın bu ay haber göndermedi. Geçen ay iki kez göndermişti.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.hooks.push({ onId: sib.id, kind: 'strong', secretId: 'brother_plot' });
              return { beat: 'öğrendin', title: 'Mektuplar Sende', text: `Adamın üç mektup getirdi. Üçünde de senin adın geçiyor, hiçbirinde iyi geçmiyor.\n\nKardeşin bunu bilmiyor. Bilmemesi senin elindeki tek şey.`, effects: [`<b>${sib.name}</b> üzerinde koz`, 'Kardeşin hâlâ güvende sanıyor'] };
            }
            remember(sib.id, S.playerId, 'Sofrasına casus soktu.', -55, 45);
            courtHears('Kendi kardeşini gözetletti.', -12, 20);
            return { beat: 'yakalandı', title: 'Adamını Tanıdılar', text: `Adamını kapıda tuttular. Konuşmadı. Konuşmasına gerek kalmadı.\n\nKardeşin artık ne yaptığını biliyor. Bir daha yanına kimse sokamazsın.`, effects: [`<b>${sib.name}</b> −55`, 'Sarayın dedikodusu senin aleyhine', 'Otuz beş altın gitti'] };
          },
        }),
      ),
    });
  },
},

// --- 2. hastalık: the child's fever -----------------------------------------
{
  id: 'heir_fever', cat: 'hastalik', weightHint: 0.86, cooldown: 12 * YEAR, chance: 0.35,
  valid() {
    const kids = livingChildren(P() || {}).filter((k) => age(k) < 15);
    return kids.length ? { kid: pickDay(kids) } : false;
  },
  fire({ kid }) {
    const p = P();
    const doc = keeper('physicianId', () => makeCharacter({ culture: 'greek', sex: 'm', skillMean: 9, traits: ['patient'] }));
    offer({
      kind: 'event', title: 'Çocuğun Ateşi', targetId: kid.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `Üç gündür ${kinWord(kid) || 'çocuğun'} ${kid.name} yataktan kalkamıyor, dadısı da odadan çıkmıyor.`,
      body: `Hekim ${fullName(doc)} sabaha karşı geldi. ${faceLine(doc)}\n\nBaktı. Uzun uzun sustu.\n\n"İki şey söyleyeceğim. Kan almak gerek. Kan almak da öldürebilir."\n\nDışarıda kar var. İçeride çocuk terliyor.`,
      options: opts(
        {
          key: 'bleed', label: 'Hekimi dinle.',
          detail: `${fullName(doc)} iyi bir hekim. Ama çocuk çok küçük.`,
          cost: [{ kind: STAKE.GOLD, value: 25 }],
          stakes: [{ kind: STAKE.KIN, who: kid.name }],
          waitDays: 21, odds: 0.66,
          tells: [
            { at: 0.35, text: () => `${kid.name} sabaha karşı bir şeyler mırıldandı. Dadı ağlıyor, sebebini bilmiyor.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.75, text: 'Ateş düştü. Sonra tekrar çıktı.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              remember(kid.id, S.playerId, 'Hasta yatağının başında bekledi.', +30, 60);
              return { beat: 'yaşadı', title: `${kid.name} Gözlerini Açtı`, text: `Sabah odaya girdiğinde oturmuş, çorba istiyordu.\n\nHekime altınını verdin. Ona ne verdiğini bilmiyorsun.`, effects: [`<b>${kid.name}</b> iyileşti`] };
            }
            kill(kid, 'illness');
            S.stats.kin_lost++;
            P().stress += 20;
            return { beat: 'yaşamadı', title: `${kid.name} Öldü`, knell: true, text: `Sabaha karşı oldu. Kimse uyanık değildi.\n\nHekim eşyalarını topladı, bir şey söylemeden gitti. Ona kızamıyorsun bile.`, effects: [`<b>${kid.name}</b> öldü`, 'Veraset sıran değişti', '+20 gerginlik'] };
          },
        },
        {
          key: 'crone', label: 'Köyden kadını çağır.',
          detail: 'Adı yok, ünü var. İki köy öteden geliyor ve para almıyor.',
          cost: [{ kind: STAKE.PIETY, value: 40 }],
          stakes: [{ kind: STAKE.KIN, who: kid.name }, { kind: STAKE.REPUTATION }],
          waitDays: 16, odds: 0.57,
          onCommit() { const c2 = councilman('chaplain'); if (c2) remember(c2.id, S.playerId, 'Çocuğa okuyucu kadın getirtti.', -35, 40); },
          tells: [
            { at: 0.4, text: 'Kadın odaya kimseyi almıyor. İçeriden bir koku geliyor, tanımadığın bir koku.', goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.8, text: () => `${kid.name} bu sabah su içti. İki gündür ilk kez.`, goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              kid.health += 1;
              S.flags.usedTheCrone = true;
              return { beat: 'kalktı', title: 'Ot Kokusu', text: `Üçüncü sabah çocuk yatakta oturuyordu. Kadın çoktan gitmişti, ücretini de almamıştı.\n\nOdadaki koku bir hafta çıkmadı. Kimse pencereyi açmayı teklif etmedi.`, effects: [`<b>${kid.name}</b> iyileşti`, '−40 dindarlık', 'İmamın bunu duydu'] };
            }
            kill(kid, 'illness'); S.stats.kin_lost++;
            p2.stress += 25;
            courtHears('Çocuğuna okuyucu kadın getirtti, çocuk öldü.', -20, 40);
            return { beat: 'tutmadı', title: `${kid.name} Öldü`, knell: true, text: `Kadın sabaha karşı kapıdan çıktı ve arkasına bakmadı. Peşinden kimse gitmedi.\n\nHekimi çağırmadın. Bunu sana kimse söylemeyecek, çünkü herkes biliyor.`, effects: [`<b>${kid.name}</b> öldü`, '−40 dindarlık', 'Sarayın konuşuyor'] };
          },
        },
        {
          key: 'pray', label: 'Hekimi gönder.',
          detail: lens({ zealous: 'Şifa hekimin elinde değil. Bunu biliyorsun.', cynical: 'Buna inanmıyorsun. Yine de yapacaksın.' }, 'Tanrıya bırakmak da bir karardır. En ağırı.'),
          stakes: [{ kind: STAKE.KIN, who: kid.name }, { kind: STAKE.SOUL }],
          waitDays: 30, odds: 0.44,
          onCommit() { const d2 = ch(S.flags.physicianId); if (d2) remember(d2.id, S.playerId, 'Kapıdan geri çevirdi.', -30, 30); },
          tells: [
            { at: 0.5, text: () => `Üç gündür ${locL(houseWord())} sen varsın. Kimse yanına gelmeye cesaret edemiyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.piety += 120;
              return { beat: 'duyuldu', title: `${kid.name} Kalktı`, text: `Kimse nasıl olduğunu açıklayamıyor. Hekim zaten gitmişti.\n\nSen açıklamaya çalışmıyorsun.`, effects: [`<b>${kid.name}</b> iyileşti`, '+120 dindarlık'] };
            }
            kill(kid, 'illness'); S.stats.kin_lost++;
            p2.stress += 25;
            return { beat: 'duyulmadı', title: `${kid.name} Öldü`, knell: true, text: `Hekimi sen gönderdin. Bunu hatırlayacaksın.\n\nHer sabah, uzun yıllar boyunca hatırlayacaksın.`, effects: [`<b>${kid.name}</b> öldü`, '+25 gerginlik', 'Hatıra: hekimi kapıdan çevirdin'] };
          },
        },
      ),
    });
  },
},

// --- 3. vassal: a demand made in front of everyone ---------------------------
{
  id: 'vassal_demand', cat: 'vassal', weightHint: 0.55, cooldown: 5 * YEAR, chance: 0.45,
  valid() {
    const vs = subjects().filter((v) => opinion(v.id, S.playerId) < 25);
    if (!vs.length || !myCounties().length) return false;
    return { v: pickDay(vs) };
  },
  fire({ v }) {
    const mine = myCounties();
    const t = mine[mine.length - 1];
    if (!t) return;
    // Asking for the only county a man holds is a different question from asking
    // for one of five. The option stays visible; it just cannot be taken.
    const onlyOne = mine.length < 2;
    offer({
      kind: 'event', title: 'Divanda Bir Talep', targetId: v.id,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `Divanın ortasında ${uncap(whoFace(v))} ayağa kalktı, ${acc(t.name)} istedi.`,
      body: `${onlyOne ? 'İstediği toprak senin oturduğun toprak. Kalen orada, ambarın orada.\n\n' : ''}"Babam o toprakta öldü," diyor. "Sizin bir kâhyanız yönetiyor. Benim orada kanım var."\n\nSesini yükseltmedi. ${ticLine(v)}\n\nSalon sessiz. Diğer vassalların sana bakmıyor; birbirlerine bakıyorlar. Ne yaparsan onu öğrenecekler.`,
      options: opts(
        {
          key: 'give', label: 'Ver.',
          detail: onlyOne ? `${t.name} senin tek toprağın. Verirsen bir daha divan toplayamazsın.` : 'Kâğıdı bugün mühürlersen akşama kadar biter.',
          stakes: [{ kind: STAKE.TITLE, who: `${t.name} kontluğu`, irreversible: true }],
          disabled: onlyOne, disabledWhy: 'elindeki tek kontluk',
          waitDays: 0,
          onResolve() {
            grantTitle(t.id, v.id, 'demand');
            remember(v.id, S.playerId, 'Talebini kabul etti.', +40, 30);
            for (const o of vassalsOf(S.playerId)) if (o.id !== v.id) remember(o.id, S.playerId, 'İsteyene veriyor.', -8, 15);
            return { success: true, beat: 'verdin', title: `${t.name} El Değiştirdi`, text: `Elini öptü. Diğerleri izledi ve not aldı.\n\nSıradaki talep daha büyük olacak.`, effects: [`<b>${t.name}</b> kalıcı olarak gitti`, `<b>${v.name}</b> +40`, 'Diğer vassallar −8'] };
          },
        },
        {
          key: 'refuse', label: 'Reddet.', detail: 'Salonda otuz kişi var. Otuzu da anlatacak.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 120, odds: 0.58,
          onCommit() { remember(v.id, S.playerId, 'Talebini herkesin önünde reddetti.', -35, 30); },
          tells: [
            { at: 0.5, text: () => `${v.name} bu ay saraya gelmedi. Vergisini de geciktirdi.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) { P().prestige += 80; return { beat: 'yuttu', title: 'Sustu', text: `Yerine oturdu ve ağzını bir daha açmadı.\n\nDiğerleri gördü. O yıl kimse bir şey istemedi.`, effects: ['+80 itibar', `<b>${v.name}</b> −35`] }; }
            v.faction = 'claimant';
            return { beat: 'yutmadı', title: 'Kaleye Çekildi', text: `Kalesine kapandı ve komşularına haber saldı.\n\nBir tarafın doğuşunu izliyorsun.`, effects: [`<b>${v.name}</b> ayaklanmaya hazırlanıyor`, `<b>${v.name}</b> −35`] };
          },
        },
        {
          key: 'humiliate', label: 'Divanda küçük düşür.',
          detail: 'Babası da bu salonda küçük düşürülmüştü. Kırk yıl önce.',
          cost: [{ kind: STAKE.PRESTIGE, value: 40 }],
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 180, odds: 0.42,
          onCommit() { remember(v.id, S.playerId, 'Onu herkesin önünde küçük düşürdü.', -60, 45); },
          tells: [
            { at: 0.4, text: 'Vassallarından ikisi divana gelmez oldu.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.dreadBonus = (p2.dreadBonus || 0) + 6;
              return { beat: 'korktular', title: 'Salonda Kimse Konuşmadı', text: `Kızardı, sonra sarardı, sonra oturdu.\n\nO günden sonra kimse gözüne bakmadı. İşine geliyor. Şimdilik.`, effects: ['+6 dehşet', `<b>${v.name}</b> −60 (kin tutuyor)`] };
            }
            courtHears('Bir vassalını herkesin önünde ezdi.', -18, 30);
            return { beat: 'ters tepti', title: 'Salon Ona Acıdı', text: `Küçük düşen adam bazen kahraman olur. Bunu hesaba katmamıştın.\n\nDivandan çıkarken üç kişi onun peşinden gitti.`, effects: ['Tüm vassallar −18', `<b>${v.name}</b> −60`] };
          },
        },
      ),
    });
  },
},

// --- 4. kıtlık: the granary --------------------------------------------------
{
  id: 'famine', cat: 'doga', weightHint: 0.6, cooldown: 10 * YEAR, chance: 0.25,
  valid() { const mine = myCounties(); return mine.length ? { t: pickDay(mine, 3) } : false; },
  fire({ t }) {
    const p = P();
    const prov = pv(t.provinceId);
    const cost = Math.max(30, Math.round(incomeOf(p.id) * 12));
    const reeve = councilman('steward');
    offer({
      kind: 'event', title: `${loc(prov.name)} Kıtlık`,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `İki mevsimdir yağmur yok; ${prov.name} halkı tohumluk buğdayı yiyor.`,
      body: `${reeve ? `Kâhyan ${fullName(reeve)} hesabı iki kez yaptı.` : 'Kâhyan hesabı iki kez yaptı.'} İkisinde de aynı çıktı.\n\n"Hepsini dağıtırsanız kışı çıkarırlar. Siz çıkaramazsınız."\n\nAmbarın kapısı kilitli. Anahtar sende.`,
      options: opts(
        {
          key: 'open', label: 'Ambarları aç.', detail: 'Hepsini.',
          cost: [{ kind: STAKE.GOLD, value: cost }],
          stakes: [{ kind: STAKE.GOLD, value: cost }],
          waitDays: 150, odds: 0.74,
          disabled: p.gold < cost, disabledWhy: `${cost} altının yok`,
          tells: [
            { at: 0.5, text: () => `${abl(prov.name)} haber: ölüm azaldı, bitmedi.`, goodTone: 'good', badTone: 'ambiguous' },
          ],
          onResolve(d, ok) {
            if (ok) {
              prov.development += 1; P().prestige += 60;
              S.flags.fedThem = (S.flags.fedThem || 0) + 1;
              return { beat: 'çıkardılar', title: 'Kışı Çıkardılar', text: `İlkbaharda ${dat(prov.name)} girdiğinde yol kenarına dizilmişlerdi.\n\nKimse alkışlamadı. Sadece baktılar. Bu daha iyiydi.`, effects: [`${prov.name} +1 kalkınma`, '+60 itibar'] };
            }
            prov.development = Math.max(1, prov.development - 2);
            return { beat: 'yetmedi', title: 'Geç Geldi', text: `Arabalar Mart sonunda geldi. Kar çoktan erimişti, karın altındakiler de görünmüştü.\n\nBuğdayı sağ kalanlara dağıttılar. Yetti.`, effects: [`${prov.name} −2 kalkınma`, `${cost} altın gitti`] };
          },
        },
        {
          key: 'hold', label: 'Kapalı tut.', detail: lens({ greedy: 'Kâhyan böyle diyor. Sen de haklı olduğunu biliyorsun.', generous: 'Kâhyan böyle diyor. Ambarın anahtarı hâlâ sende.' }, 'Kâhyan böyle diyor. Kendi ambarı dolu.'),
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.SOUL }],
          waitDays: 150, odds: 0.30,
          onCommit() { P().piety = Math.max(0, P().piety - 60); prov.unrest += 15; },
          tells: [
            { at: 0.4, text: () => `${abl(prov.name)} gelen kervan boş döndü. Kimse bir şey satmıyor.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            prov.development = Math.max(1, prov.development - 3);
            prov.unrest += 25;
            S.flags.letThemStarve = (S.flags.letThemStarve || 0) + 1;
            if (ok) return { beat: 'sustular', title: 'Sustular', text: `Kış geçti. ${gen(prov.name)} nüfusu üçte bir azaldı ve kimse ayaklanmadı.\n\nHazinen dolu. Bunu bir başarı saymak zorundasın.`, effects: [`${prov.name} −3 kalkınma`, '−60 dindarlık', 'Halk unutmayacak'] };
            return { beat: 'susmadılar', title: 'Ambarı Bastılar', text: `Kapıyı kırdıklarında muhafızların çekildi. Onlar da açtı.\n\nBuğday yine gitti. Bu sefer minnet olmadan.`, effects: [`${prov.name} −3 kalkınma, +25 huzursuzluk`, 'Buğday yine gitti', '−60 dindarlık'] };
          },
        },
        onlyIf(!!councilman('steward'), {
          key: 'buy', label: 'Rumlardan buğday al.',
          detail: 'Fiyatı onlar söyler. Sen kabul edersin.',
          cost: [{ kind: STAKE.GOLD, value: Math.round(cost * 0.6) }, { kind: STAKE.PRESTIGE, value: 30 }],
          stakes: [{ kind: STAKE.GOLD, value: Math.round(cost * 0.6) }, { kind: STAKE.REPUTATION }],
          waitDays: 90, odds: clampOdds(0.34 + skill(P(), 'stewardship') * 0.028),
          disabled: p.gold < Math.round(cost * 0.6), disabledWhy: 'kesende o kadar yok',
          tells: [{ at: 0.6, text: 'Liman kapandı. Gemi bekliyor, kimse boşaltmıyor.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { prov.unrest = Math.max(0, prov.unrest - 20); return { beat: 'geldi', title: 'Gemi Girdi', text: `Çuvalları rıhtımda saydılar. Eksik çıktı, kimse sesini çıkarmadı.\n\nHalk yedi. Vassalların, Rumlardan dilendiğini konuşuyor.`, effects: [`${prov.name} huzursuzluk düştü`, '−30 itibar'] }; }
            prov.development = Math.max(1, prov.development - 2);
            courtHears('Rumlardan buğday dilendi, o da gelmedi.', -14, 20);
            return { beat: 'gelmedi', title: 'Gemi Gelmedi', text: `Parayı peşin verdin. Gemi Kıbrıs açıklarında satılmış.\n\nAmbarlar da boş, kesen de.`, effects: [`${prov.name} −2 kalkınma`, 'Altının gitti', 'Vassalların −14'] };
          },
        }),
      ),
    });
  },
},

// --- 5. ihanet: a small bottle ----------------------------------------------
{
  id: 'poison_offer', cat: 'ihanet', weightHint: 0.8, cooldown: 15 * YEAR, chance: 0.2,
  valid() { const p = P(); return p?.liegeId && alive(p.liegeId) ? { liege: ch(p.liegeId) } : false; },
  fire({ liege }) {
    const spy = councilman('spymaster');
    offer({
      kind: 'scheme', title: 'Bir Şişe', targetId: liege.id,
      scene: { provinceIdx: anyProvinceOf(liege.id) },
      framing: `${spy ? whoFace(spy) : 'Casusun'} masaya küçük bir şişe bıraktı, hiçbir şey söylemedi.`,
      body: `Efendin ${fullName(liege)} önümüzdeki ay senin kalende konaklayacak. Aşçısı senin aşçın olacak.\n\n${spy ? `${spy.name} cevap beklemiyor. ${ticLine(spy)}` : 'Casusun cevap beklemiyor.'}\n\nBöyle bir gece bir daha olmayacak. O da biliyor bunu, sen de.`,
      options: opts(
        {
          key: 'no', label: 'Şişeyi ateşe at.', detail: 'Cam ince. Kapağı mumla mühürlemişler.',
          waitDays: 0,
          onResolve() {
            P().piety += 50;
            if (spy) remember(spy.id, S.playerId, 'Şişeyi ateşe attı.', -15, 25);
            return { success: true, beat: 'attın', title: 'Cam Çatladı', text: `Alev bir an yeşile döndü, sonra söndü. Odada keskin bir koku kaldı.\n\n${spy ? spy.name : 'Casusun'} bu konuyu bir daha açmadı. Sana bakışı değişti.`, effects: ['+50 dindarlık', 'Casusun seni tanıdı'] };
          },
        },
        {
          key: 'yes', label: 'Aşçıya ver.',
          detail: lens({ honest: 'Bugüne kadar sözünü hiç bozmadın. Bugüne kadar.', deceitful: 'Bunu daha önce de düşündün. Fark, elinde şişe olması.' }, 'Efendini öldürmek. Toprağını almak. Yakalanırsan kellen gider.'),
          confirm: `${fullName(liege)} yarın sabah ölsün mü?`,
          cost: [{ kind: STAKE.GOLD, value: 80 }],
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(liege)) }, { kind: STAKE.OATH }, { kind: STAKE.SOUL }, { kind: STAKE.SECRET }],
          waitDays: 45, odds: clampOdds(0.30 + intrigue() * 0.045),
          tells: [
            { at: 0.3, text: 'Aşçı bu sabah mutfağa gelmedi. Öğlen geldi, kimseyle konuşmadı.', goodTone: 'ambiguous', badTone: 'bad' },
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
              return { beat: 'öldü', title: `${fullName(liege)} Sabaha Çıkmadı`, knell: true, text: `Hizmetçinin çığlığıyla uyandın. Koştun. Kalabalığın arasında doğru yüzü takınmayı becerdin.\n\nKimse bir şey söylemedi. Bu, kimsenin bilmediği anlamına gelmiyor.`, effects: ['<b>Sır:</b> efendini sen öldürdün', 'Bu sır bir gün açığa çıkabilir', 'Yeminini bozdun'] };
            }
            p2.prestige -= 150;
            if (!p2.traits.includes('oathbreaker')) p2.traits.push('oathbreaker');
            courtHears('Efendisini zehirlemeye kalktı.', -40, 50);
            return { beat: 'yakalandın', title: 'Aşçı Konuştu', knell: true, text: `İşkenceye dayanmadı. Zaten kimse dayanmıyor.\n\n${fullName(liege)} seni divana çağırdı. Gitmek zorundasın.`, effects: ['<b>Sözünden Dönen</b> damgası', '−150 itibar', 'Efendin biliyor'] };
          },
        },
      ),
    });
  },
},

// --- 6. saray: the courtier who talks ---------------------------------------
{
  id: 'rival_rumor', cat: 'saray', weightHint: 0.5, cooldown: 6 * YEAR, chance: 0.4,
  valid() {
    const r = ch(S.flags.rivalId);
    return r && r.deathDay == null && opinion(r.id, S.playerId) < 0 ? { r } : false;
  },
  fire({ r }) {
    const p = P();
    const rumour = byTrait(p, {
      craven: 'savaştan kaçtığını',
      frail: 'gece nefes alamadığını',
      cynical: 'namaza durmadığını',
      lustful: () => sexed(P(), 'aşçının kızıyla görüldüğünü', 'seyisle görüldüğünü'),
    }, 'babandan kalan tacın senin olmadığını');
    offer({
      kind: 'event', title: 'Bir Dil', targetId: r.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${whoFace(r)} bütün kış senin ${rumour} anlattı.`,
      body: `${hourLine()} Kâhyan sana kimlerin güldüğünü tek tek saydı. Listede iki divan üyen var.\n\nYalan olması işe yaramıyor. Anlatılıyor olması yetiyor.`,
      options: opts(
        {
          key: 'buy', label: 'Kesesini doldur.', detail: 'Susan bir dil, kesilmiş dilden ucuzdur.',
          cost: [{ kind: STAKE.GOLD, value: 55 }],
          stakes: [{ kind: STAKE.GOLD, value: 55 }, { kind: STAKE.SECRET }],
          waitDays: 200, odds: 0.6,
          tells: [{ at: 0.5, text: () => `${r.name} yeni bir kürk almış. Nereden aldığını soran yok.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { remember(r.id, S.playerId, 'Kesesini doldurdu.', +30, 15); return { beat: 'satın aldın', title: 'Kış Sessiz Geçti', text: `Artık senin masanda oturuyor ve gülmüyor.\n\nSatın aldığın şey sadakat değil. Sessizlik. Kirası her yıl ödenir.`, effects: [`<b>${r.name}</b> +30 — şimdilik`, 'Elli beş altın gitti'] }; }
            r.hooks.push({ onId: S.playerId, kind: 'weak', secretId: 'paid_silence' });
            return { beat: 'pahalandı', title: 'Fiyat Arttı', text: `Parayı aldı, sonra bir daha istedi. Sonra bir daha.\n\nSusturmak için ödediğini biliyor. Asıl koz artık bu.`, effects: [`<b>${r.name}</b> elinde koz var`, 'Elli beş altın gitti'] };
          },
        },
        {
          key: 'tongue', label: 'Dilini kestir.',
          detail: 'Cerrahın var. Bu işi daha önce de yaptı.',
          confirm: 'Kendi sarayında, kendi adamının dilini mi?',
          cost: [{ kind: STAKE.PRESTIGE, value: 25 }],
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(r)) }, { kind: STAKE.REPUTATION }],
          waitDays: 40, odds: 0.7,
          onCommit() { courtHears('Sarayında bir adamın dilini kestirdi.', -18, 35); },
          tells: [{ at: 0.6, text: 'Zindanda bağırış yok. Bu iyiye mi işaret, bilmiyorsun.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            p2.dreadBonus = (p2.dreadBonus || 0) + 8;
            if (ok) { r.traits.push('wounded'); remember(r.id, S.playerId, 'Dilini kestirdi.', -90, 60);
              return { beat: 'kestin', title: 'Salon Sessiz', text: `Hâlâ sarayında. Yemeğe geliyor, oturuyor, bakıyor.\n\nArtık kimse yüksek sesle konuşmuyor. Sen de.`, effects: ['+8 dehşet', `<b>${r.name}</b> sakat ve seni bekliyor`, 'Vassalların −18'] }; }
            kill(r, 'wounds', S.playerId);
            if (!p2.traits.includes('arbitrary')) p2.traits.push('arbitrary');
            return { beat: 'öldü', title: 'Kan Durmadı', knell: true, text: `Cerrah bileğini bağladı, ağzını bağlayamadı. Sabaha kadar sürdü.\n\nBir dedikoduyu susturmak için bir can aldın. Bunu hesaplamamıştın.`, effects: [`<b>${r.name}</b> öldü`, '<b>Keyfî</b> damgası', 'Vassalların −18'] };
          },
        },
        {
          key: 'laugh', label: 'Sen de gül.', detail: 'Şakayı sen anlatırsan senin olur.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 150, odds: 0.45,
          onCommit() { P().prestige -= 20; },
          tells: [{ at: 0.5, text: 'Şaka bu ay iki köy öteye ulaştı.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { remember(r.id, S.playerId, 'Şakasına güldü.', +25, 20); return { beat: 'söndü', title: 'Kimse Anlatmıyor', text: `Gülünen şaka üçüncü kez anlatılınca ölür. Sen dördüncüyü söyledin.\n\n${fullName(r)} bir daha denemedi. Bu bir dostluk değil. Ateşkes.`, effects: [`<b>${r.name}</b> +25`, '−20 itibar'] }; }
            courtHears('Kendi hakkındaki şakaya gülüyor.', -12, 25);
            return { beat: 'büyüdü', title: 'Sınırın Ötesinde de Anlatılıyor', text: `Şaka artık senin adınla anılıyor. Komşu kontun sofrasında da anlatılmış.\n\nGülen adam korkulmaz. Korkulmayan adama vergi ödenmez.`, effects: ['−20 itibar', 'Vassalların −12'] };
          },
        },
      ),
    });
  },
},

// --- 7. saray: what the spymaster knows -------------------------------------
{
  id: 'spymaster_secret', cat: 'saray', weightHint: 0.55, cooldown: 7 * YEAR, chance: 0.35,
  valid() {
    const spy = councilman('spymaster');
    const vs = subjects().filter((v) => age(v) > 20);
    const n = neighbourRuler(7);
    const pool = vs.length ? vs : (n ? [n.ruler] : []);
    return spy && pool.length ? { spy, v: pickDay(pool, 5) } : false;
  },
  fire({ spy, v }) {
    const sin = pickDay(['karısı ölmeden önce vasiyeti değiştirmiş', 'kilise gümüşünü eritip satmış', 'ağabeyinin ölümünde parmağı varmış', 'iki yıldır efendine değil komşuna vergi ödüyormuş'], 2);
    offer({
      kind: 'scheme', title: 'Casusun Fiyatı', targetId: spy.id,
      scene: { provinceIdx: anyProvinceOf(v.id) },
      framing: `Kapıyı arkasından kapatan ${uncap(whoFace(spy))} önce fiyatını söyledi.`,
      body: `"${fullName(v)} hakkında bir şey biliyorum. ${cap(sin)}."\n\nSustu. ${ticLine(spy)}\n\nSöylemeden önce parasını istiyor. Doğru olup olmadığını ancak ödedikten sonra öğrenirsin.`,
      options: opts(
        {
          key: 'pay', label: 'Öde ve dinle.', detail: 'Kesende kırk beş altın var. Bugün var, yarın belli değil.',
          cost: [{ kind: STAKE.GOLD, value: 45 }],
          stakes: [{ kind: STAKE.GOLD, value: 45 }, { kind: STAKE.SECRET }],
          waitDays: 60, odds: clampOdds(0.35 + skill(spy, 'intrigue') * 0.04),
          tells: [{ at: 0.5, text: () => `${spy.name} bu hafta iki gece dışarıda kaldı.`, goodTone: 'good', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.hooks.push({ onId: v.id, kind: 'strong', secretId: 'vassal_sin' });
              p2.knownSecrets.push({ onId: v.id, text: cap(sin), day: S.day });
              return { beat: 'doğruymuş', title: 'Kâğıt Elinde', text: `Casusun mührü kırık bir mektup getirdi. İmza net.\n\n${fullName(v)} hâlâ gülümseyerek selam veriyor. Bu, en tatlı kısmı.`, effects: [`<b>${v.name}</b> üzerinde güçlü koz`, 'Kırk beş altın gitti'] };
            }
            remember(spy.id, S.playerId, 'Yalanını yüzüne vurdu.', -25, 20);
            return { beat: 'uydurmuş', title: 'Kâğıt Sahte', text: `Mühür yeni. Mum hâlâ yumuşak.\n\nCasusun sana bakmıyor. Parayı geri istemek de bir şeyi düzeltmez.`, effects: ['Kırk beş altın gitti', `<b>${spy.name}</b> −25`] };
          },
        },
        {
          key: 'squeeze', label: 'Bedava söylet.',
          detail: 'Onun da bir sırrı var. Sende olduğunu bilmiyor.',
          cost: [{ kind: STAKE.PRESTIGE, value: 20 }],
          stakes: [{ kind: STAKE.SECRET }, { kind: STAKE.OATH }],
          waitDays: 45, odds: clampOdds(0.28 + intrigue() * 0.045),
          tells: [{ at: 0.6, text: () => `${spy.name} bu hafta iki kez odana bakıp geri döndü.`, goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.hooks.push({ onId: v.id, kind: 'weak', secretId: 'vassal_sin' });
              remember(spy.id, S.playerId, 'Beni kendi sırrımla sıkıştırdı.', -45, 45);
              return { beat: 'söyledi', title: 'Bedava Anlattı', text: `Anlattı. Kısa anlattı, gözünün içine bakmadan anlattı, sonra izin istemeden çıktı.\n\nBildiğin şey elinde. Casusun da artık senin ne yapabileceğini biliyor.`, effects: [`<b>${v.name}</b> üzerinde koz`, `<b>${spy.name}</b> −45`] };
            }
            S.flags.spyTurned = spy.id;
            remember(spy.id, S.playerId, 'Beni sıkıştırmaya kalktı.', -60, 50);
            return { beat: 'diklendi', title: 'İki Sır, İki Taraf', text: `Güldü ve senin sırrını söyledi. Aynı cümlede, aynı sesle.\n\nArtık ikiniz de birbirinizi tutuyorsunuz. Bu bir anlaşma değil; bir düğüm.`, effects: [`<b>${spy.name}</b> elinde koz var`, '−20 itibar'] };
          },
        },
        {
          key: 'refuse', label: 'Kapıyı göster.', detail: 'Kendi adamından bilgi satın alan bir efendinin adamı kalmaz.',
          waitDays: 90, odds: clampOdds(0.38 + skill(P(), 'diplomacy') * 0.022),
          stakes: [{ kind: STAKE.REPUTATION }],
          onCommit() { remember(spy.id, S.playerId, 'Bilgisini satın almadı.', -20, 20); },
          tells: [{ at: 0.6, text: () => `${spy.name} bu ay iki mektup yazdı. İkisi de senin mührünle gitmedi.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().prestige += 40; return { beat: 'anladı', title: 'Bir Daha Denemedi', text: `Casusun ertesi gün her şeyi bedava anlattı. Kısa anlattı, sonra kapıyı çekti.\n\nBir daha fiyat söylemedi. Bir daha da kapıyı arkasından kapatmadı.`, effects: ['+40 itibar', `<b>${spy.name}</b> hizada`] }; }
            remember(v.id, spy.id, 'Casus ona kendi efendisini sattı.', +40, 30);
            S.flags.spyTurned = spy.id;
            return { beat: 'sattı', title: 'Başkasına Sattı', text: `Bildiği şeyi ${dat(fullName(v))} götürdü. O ödedi.\n\nŞimdi iki adam bir şey biliyor. İkisi de sen değilsin.`, effects: [`<b>${spy.name}</b> artık ${v.name} ile`, 'Sarayında bir delik var'] };
          },
        },
      ),
    });
  },
},

// --- 8. ihanet: the man who eats first --------------------------------------
{
  id: 'taster_dies', cat: 'ihanet', weightHint: 0.78, cooldown: 12 * YEAR, chance: 0.22,
  valid() { return P() ? true : false; },
  fire() {
    const p = P();
    const taster = keeper('tasterId', () => makeCharacter({ culture: p.culture, sex: 'm', skillMean: 3, birthDay: S.day - 34 * YEAR }));
    const cook = keeper('cookId', () => makeCharacter({ culture: p.culture, sex: 'm', skillMean: 4, birthDay: S.day - 46 * YEAR }));
    offer({
      kind: 'event', title: 'İlk Lokma', targetId: taster.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `Yemeğini ilk tadan adam, ${who(taster)}, sofranın yanında yere yığıldı.`,
      body: `${faceLine(taster)} Yirmi yıldır senin için önce o yiyordu.\n\nTabak hâlâ önünde duruyor. Ellemedin.\n\nMutfakta yedi kişi çalışıyor. Aşçıbaşı ${fullName(cook)} elini önlüğüne siliyor ve kapıya bakıyor.`,
      options: opts(
        {
          key: 'rack', label: 'Mutfağı sorgula.', detail: 'Yedisini de. Biri konuşur. Belki yanlış olan konuşur.',
          cost: [{ kind: STAKE.PRESTIGE, value: 30 }],
          stakes: [{ kind: STAKE.LIFE, who: 'yedi hizmetkârın' }, { kind: STAKE.REPUTATION }],
          waitDays: 50, odds: clampOdds(0.3 + intrigue() * 0.05),
          onCommit() { courtHears('Mutfağını işkenceye verdi.', -14, 25); },
          tells: [
            { at: 0.4, text: 'İkisi ilk gece konuştu. İkisi de birbirini suçladı.', goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.8, text: 'Aşçıbaşı hiç konuşmadı. Hâlâ konuşmuyor.', goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            kill(taster, 'murder');
            if (ok) {
              kill(cook, 'execution', S.playerId);
              P().dreadBonus = (P().dreadBonus || 0) + 5;
              return { beat: 'buldun', title: 'Aşçıbaşı Astırıldı', text: `Kime çalıştığını söylemedi. Kimin verdiğini de.\n\nBir isim eksik kaldı. O ismi ömrün boyunca arayacaksın.`, effects: [`<b>${cook.name}</b> idam edildi`, '+5 dehşet', 'Sipariş veren hâlâ dışarıda'] };
            }
            for (const c of [cook]) kill(c, 'execution', S.playerId);
            P().stress += 20;
            return { beat: 'bulamadın', title: 'Yedi Kişi, Hiçbir İsim', text: `Üçü öldü, dördü sakat kaldı, kimse bir şey söylemedi.\n\nBu akşam yemeğini kim pişirecek? Bunu düşünmemiştin.`, effects: ['Mutfağın boş', '+20 gerginlik', `<b>${taster.name}</b> öldü`] };
          },
        },
        {
          key: 'eat', label: 'Tabağı bitir.',
          detail: lens({ brave: 'Salon dolu. Herkes bakıyor. Bunun için doğdun.', craven: 'Ellerin titriyor. Masanın altında tut.' }, 'Salon dolu. Herkes bakıyor. Zehir bir tabakta iki kez olmaz — genellikle.'),
          confirm: 'Aynı tabaktan yemek mi?',
          stakes: [{ kind: STAKE.LIFE, who: 'kendi' }, { kind: STAKE.REPUTATION }],
          waitDays: 7, odds: 0.72,
          onCommit() { courtHears('Adamı ölürken aynı tabaktan yedi.', +22, 40); },
          tells: [{ at: 0.6, text: 'Gece midende bir ağırlık var. Belki korkudandır.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            kill(taster, 'murder');
            if (ok) {
              p2.dreadBonus = (p2.dreadBonus || 0) + 10;
              p2.prestige += 120;
              if (!p2.traits.includes('brave') && !p2.traits.includes('craven')) p2.traits.push('brave');
              return { beat: 'yaşadın', title: 'Tabağı Bitirdin', text: `Salon seni izledi. Sen tabağı bitirdin, peçeteni katladın, kalktın.\n\nO gece kimse uyuyamadı. Sen de.`, effects: ['+120 itibar', '+10 dehşet', `<b>${taster.name}</b> öldü`] };
            }
            p2.traits.push('ill');
            p2.health -= 2;
            return { beat: 'kaldıramadın', title: 'Gece Yarısı', knell: true, text: `Şafağa kadar kustun. Sağ kolun üç gün tutmadı.\n\nYaşıyorsun. Eskisi kadar değil.`, effects: ['<b>Hasta</b> damgası — kalıcı', 'Sağlığın düştü', `<b>${taster.name}</b> öldü`] };
          },
        },
        {
          key: 'quiet', label: 'Sessizce değiştir.', detail: 'Yedi kişi gider, yedi kişi gelir. Kimse sormaz.',
          cost: [{ kind: STAKE.GOLD, value: 40 }],
          stakes: [{ kind: STAKE.GOLD, value: 40 }, { kind: STAKE.SECRET }],
          waitDays: 120, odds: 0.55,
          tells: [{ at: 0.5, text: 'Yeni aşçı iyi pişiriyor. Fazla iyi pişiriyor.', goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            kill(taster, 'murder');
            if (ok) return { beat: 'kapandı', title: 'Kimse Sormadı', text: `Yeni yüzler geldi. Eski yüzler bir daha görünmedi.\n\nKimin gönderdiğini öğrenemedin. Yemeğini de bir daha tadına bakmadan yemedin.`, effects: ['Mutfak değişti', `<b>${taster.name}</b> öldü`, 'Kırk altın gitti'] };
            S.flags.poisonerInside = true;
            return { beat: 'içerideler', title: 'Yeni Aşçı da Onların', text: `İkinci ay, çorbanda aynı acı tat vardı. Bu sefer kimse tatmamıştı.\n\nTabağı ittin. Aç kalktın. Bir daha da doymadın.`, effects: ['Sarayında hâlâ bir el var', `<b>${taster.name}</b> öldü`, 'Kırk altın gitti'] };
          },
        },
      ),
    });
  },
},

// --- 9. evlilik: the girl and the border ------------------------------------
{
  id: 'daughter_match', cat: 'evlilik', weightHint: 0.62, cooldown: 6 * YEAR, chance: 0.4,
  valid() {
    const p = P();
    const pool = [
      ...livingChildren(p || {}),
      ...Object.values(S.chars).filter((c) => c.deathDay == null && c.isSibling === p?.id),
    ].filter((k) => k.sex === 'f' && age(k) >= 14 && !k.spouseId);
    const n = neighbourRuler(1);
    return pool.length && n ? { girl: pickDay(pool, 4), n } : false;
  },
  fire({ girl, n }) {
    const suitor = n.ruler;
    const tie = livingChildren(P() || {}).some((k) => k.id === girl.id) ? 'kızın' : 'kız kardeşin';
    offer({
      kind: 'event', title: 'Sınırdan Bir Elçi', targetId: girl.id,
      scene: { provinceIdx: provIdxOf(n.prov.id) },
      framing: `${whoFace(suitor)} ${tie} ${girl.name} için elçi yolladı.`,
      body: `Elçi kapıda üç gün bekledi. Sonunda içeri aldın.\n\n"${cap(gen(n.prov.name))} sahibi onu ister. Sınır köyleri çeyiz olur."\n\n${girl.name} ${spell(age(girl))} yaşında. Bahçede, ne konuşulduğunu bilmeden oturuyor.`,
      options: opts(
        {
          key: 'send', label: 'Kızını gönder.',
          detail: 'Yol on gün sürer. Kışın on beş.',
          confirm: `${girl.name} bu evden gitsin mi?`,
          stakes: [{ kind: STAKE.KIN, who: girl.name }, { kind: STAKE.REPUTATION }],
          waitDays: 210, odds: 0.68,
          onCommit() {
            girl.spouseId = suitor.id; suitor.spouseId = girl.id;
            girl.courtOf = suitor.id; girl.liegeId = suitor.id;
            remember(suitor.id, S.playerId, 'Kızını verdi.', +45, 40);
          },
          tells: [
            { at: 0.4, text: () => `${gen(girl.name)} ilk mektubu geldi. Üç satır ve bir selam.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.85, text: () => `${abl(n.prov.name)} iki aydır haber yok.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              S.flags.marriedOut = girl.id;
              P().prestige += 70;
              return { beat: 'gitti', title: 'Sınırda Barış', text: `${cap(gen(suitor.name))} adamları artık senin köylerini geçmiyor. Sözünü tuttu.\n\n${girl.name} yılda bir mektup yazıyor. Yazısı düzeldi.`, effects: [`<b>${suitor.name}</b> ile bağ kuruldu`, '+70 itibar', `<b>${girl.name}</b> artık ${loc(n.prov.name)}`] };
            }
            remember(girl.id, S.playerId, 'Onu tanımadığı bir adama verdi.', -60, 60);
            return { beat: 'susuyor', title: 'Mektup Gelmiyor', text: `Elçin kapıdan döndü. İçeri alınmadı.\n\nKızın orada. Nasıl olduğunu bilen tek insan, onu oraya gönderen adam değil.`, effects: [`<b>${girl.name}</b> sana küs`, 'Sınırda hiçbir şey değişmedi'] };
          },
        },
        {
          key: 'refuse', label: 'Elçiyi geri yolla.', detail: 'Kızını tutarsın. Sınırı tutamayabilirsin.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 240, odds: 0.44,
          onCommit() { remember(suitor.id, S.playerId, 'Elçisini kapıdan çevirdi.', -30, 30); },
          tells: [{ at: 0.5, text: () => `${gen(n.prov.name)} sınırında bu ay iki köy boşaltıldı.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { remember(girl.id, S.playerId, 'Onu vermedi.', +50, 50); return { beat: 'geçti', title: 'Bir Şey Olmadı', text: `Elçi bir daha gelmedi. Sınırda da bir şey olmadı.\n\n${girl.name} bunu hiç öğrenmeyecek. Öğrenmesine gerek yok.`, effects: [`<b>${girl.name}</b> +50`, `<b>${suitor.name}</b> −30`] }; }
            const t = n.mine; const prov = pv(t.provinceId);
            prov.unrest += 25;
            return { beat: 'yaktılar', title: 'Sınır Köyü Yandı', text: `${cap(gen(suitor.name))} atlıları geceleyin geldi. Kimseyi öldürmediler; ambarları yaktılar.\n\nMesajı aldın. Cevap veremiyorsun.`, effects: [`${prov.name} +25 huzursuzluk`, `<b>${suitor.name}</b> düşmanın`] };
          },
        },
        onlyIf(has(P(), 'greedy') || has(P(), 'ambitious'), {
          key: 'haggle', label: 'Fiyatı yükselt.', detail: 'Bir kız bir kaledir. Kale bedava verilmez.',
          cost: [{ kind: STAKE.PRESTIGE, value: 20 }],
          stakes: [{ kind: STAKE.KIN, who: girl.name }, { kind: STAKE.GOLD, value: 0 }],
          waitDays: 120, odds: clampOdds(0.32 + skill(P(), 'diplomacy') * 0.028),
          tells: [{ at: 0.6, text: 'Elçi üçüncü kez geldi. Bu sefer atından inmedi.', goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) {
              P().gold += 140;
              girl.spouseId = suitor.id; suitor.spouseId = girl.id; girl.courtOf = suitor.id; girl.liegeId = suitor.id;
              remember(girl.id, S.playerId, 'Onu pazarlıkla sattı.', -40, 60);
              return { beat: 'ödedi', title: 'Ödediler', text: `Altını saydılar, kızı aldılar. Aynı gün.\n\n${girl.name} arabaya binerken sana bakmadı.`, effects: ['+140 altın', `<b>${girl.name}</b> gitti — sana küs`, `<b>${suitor.name}</b> ile bağ`] };
            }
            remember(suitor.id, S.playerId, 'Kızını pazarlığa çıkardı.', -45, 40);
            return { beat: 'çekildi', title: 'Elçi Dönmedi', text: `Pazarlığı fazla uzattın. Adam başka bir kapıya gitti.\n\nKızın evde. Sınır da yerinde durmuyor.`, effects: [`<b>${suitor.name}</b> −45`, '−20 itibar', `<b>${girl.name}</b> evde kaldı`] };
          },
        }),
      ),
    });
  },
},

// --- 10. veraset: the son who will not do -----------------------------------
{
  id: 'heir_flaw', cat: 'veraset', weightHint: 0.7, cooldown: 9 * YEAR, chance: 0.3,
  valid() {
    const SOFT = ['craven', 'slow', 'frail', 'shy', 'content'];
    const kids = livingChildren(P() || {}).filter((k) => k.sex === 'm' && age(k) >= 10
      && (k.traits.some((t) => SOFT.includes(t)) || (k.prowess || 0) < 5));
    if (!kids.length) return false;
    const m = councilman('marshal');
    return m ? { heir: pickDay(kids, 6), m } : false;
  },
  fire({ heir, m }) {
    const flaw = heir.traits.includes('craven') ? 'attan iner inmez kusuyor'
      : heir.traits.includes('slow') ? 'aynı emri üç kez soruyor'
      : heir.traits.includes('shy') ? 'emri yüksek sesle veremiyor'
      : heir.traits.includes('frail') ? 'yüz adım koşunca duruyor'
      : 'kılıcı iki elle tutuyor';
    offer({
      kind: 'event', title: 'Talim Meydanı', targetId: heir.id,
      scene: { provinceIdx: anyProvinceOf(S.playerId) },
      framing: `${cap(kinWord(heir) || 'oğlun')} ${heir.name} talimde yine ${flaw}.`,
      body: `Marşalın ${fullName(m)} bunu sana söylemek için üç ay bekledi.\n\n"Adamlar arkasından gülüyor. Bir gün önünden gülecekler."\n\n${faceLine(heir)} ${spell(age(heir))} yaşında ve senden sonra bu toprağı o alacak.`,
      options: opts(
        {
          key: 'war', label: 'Sınıra yolla.',
          detail: 'Ya adam olur ya ölür. Üçüncü bir ihtimal yok.',
          confirm: `${heir.name} sınırda ölebilir. Yine de mi?`,
          cost: [{ kind: STAKE.GOLD, value: 40 }],
          stakes: [{ kind: STAKE.KIN, who: heir.name }, { kind: STAKE.LIFE, who: gen(heir.name) }],
          waitDays: 300, odds: 0.55,
          tells: [
            { at: 0.35, text: () => `${abl(heir.name)} mektup: soğuk, kısa, şikâyetsiz.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.8, text: 'Sınırdan gelen kervanda onun atı var. Kendisi yok.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              heir.traits = heir.traits.filter((t) => t !== 'craven');
              if (!heir.traits.includes('brave')) heir.traits.push('brave');
              heir.traits.push('scarred');
              remember(heir.id, S.playerId, 'Onu sınıra yolladı.', -15, 40);
              return { beat: 'döndü', title: 'Yüzünde Bir İz Var', text: `İki kış sonra döndü. Daha az konuşuyor, daha az soruyor.\n\nSana teşekkür etmedi. Etmesini de beklemiyordun.`, effects: [`<b>${heir.name}</b> artık <b>Cesur</b>`, `<b>${heir.name}</b> yüzünde iz taşıyor`, `<b>${heir.name}</b> sana −15`] };
            }
            kill(heir, 'battle');
            S.stats.kin_lost++;
            P().stress += 30;
            return { beat: 'dönmedi', title: `${heir.name} Dönmedi`, knell: true, text: `Bir sınır kavgası. İsim bile verilmemiş.\n\nOnu oraya sen yolladın. Marşalın sana bakmıyor artık.`, effects: [`<b>${heir.name}</b> öldü`, 'Veraset sıran değişti', '+30 gerginlik'] };
          },
        },
        {
          key: 'disinherit', label: 'Verasetten çıkar.',
          detail: 'Kâğıt üstünde bir cümle. Evin içinde bir duvar.',
          confirm: 'Kendi oğlunu mirastan çıkarmak mı?',
          cost: [{ kind: STAKE.PRESTIGE, value: 60 }],
          stakes: [{ kind: STAKE.KIN, who: heir.name }, { kind: STAKE.REPUTATION }],
          waitDays: 150, odds: clampOdds(0.34 + skill(P(), 'diplomacy') * 0.028),
          onCommit() { heir.disinherited = true; remember(heir.id, S.playerId, 'Onu mirastan çıkardı.', -80, 60); },
          tells: [{ at: 0.6, text: () => `${heir.name} üç haftadır sofraya oturmuyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { courtHears('Zayıf oğlunu mirastan çıkardı.', +10, 20); return { beat: 'kabullendi', title: 'Kâğıt İmzalandı', text: `Şahitler imzaladı. ${heir.name} odasından çıkmadı.\n\nVassalların rahatladı. Sen rahatlamadın.`, effects: [`<b>${heir.name}</b> verasetten çıkarıldı`, 'Vassalların +10', '−60 itibar'] }; }
            heir.faction = 'claimant';
            return { beat: 'kabullenmedi', title: 'Amcasına Gitti', text: `Gece atını aldı ve gitti. Nereye gittiğini üç gün sonra öğrendin.\n\nArtık senin oğlun değil. Senin davacın.`, effects: [`<b>${heir.name}</b> hak iddia ediyor`, '−60 itibar'] };
          },
        },
        {
          key: 'keep', label: 'Yanında tut.', detail: 'Zayıf oğlunu senden sonra kim koruyacak, onu düşün.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 400, odds: 0.42,
          onCommit() { courtHears('Zayıf oğlunu koruyor.', -10, 25); },
          tells: [{ at: 0.5, text: () => `Divanda ${gen(heir.name)} adı geçtiğinde kimse bir şey söylemiyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { remember(heir.id, S.playerId, 'Yanında tuttu.', +55, 60); return { beat: 'öğrendi', title: 'Yavaş Öğreniyor', text: `Hâlâ üç kez soruyor. Ama artık doğru soruyu soruyor.\n\nGeçen ay bir kavgayı sen karışmadan bitirdi. Bunu sana kimse söylemedi; kendin duydun.`, effects: [`<b>${heir.name}</b> +55`, 'Vassalların −10'] }; }
            S.flags.weakHeir = heir.id;
            courtHears('Zayıf bir oğula toprak bırakacak.', -18, 40);
            return { beat: 'değişmedi', title: 'Vassalların Sayıyor', text: `Kaç yılın kaldığını herkes hesaplıyor. Sen de.\n\nOğlun hâlâ attan inince kusuyor.`, effects: ['Tüm vassalların −18', 'Ölümünde taht kavgası olacak'] };
          },
        },
      ),
    });
  },
},

// --- 11. aile: the bed by the window ----------------------------------------
{
  id: 'spouse_dying', cat: 'aile', weightHint: 0.82, cooldown: 20 * YEAR, chance: 0.25,
  valid() {
    const p = P();
    const sp = p?.spouseId ? ch(p.spouseId) : null;
    const sick = ['ill', 'pox', 'wounded', 'frail'].some((t) => sp?.traits?.includes(t));
    return sp && sp.deathDay == null && (age(sp) > 40 || healthOf(sp) < 4.6 || sick) ? { sp } : false;
  },
  fire({ sp }) {
    const doc = keeper('physicianId', () => makeCharacter({ culture: 'greek', sex: 'm', skillMean: 9, traits: ['patient'] }));
    offer({
      kind: 'event', title: 'Pencere Kenarındaki Yatak', targetId: sp.id,
      scene: { provinceIdx: anyProvinceOf(S.playerId) },
      framing: `${cap(kinWord(sp) || 'eşin')} ${sp.name} on gündür yataktan kalkmadı.`,
      body: `${weatherLine()} Odayı ısıtıyorlar, ısınmıyor.\n\nHekim ${fullName(doc)} bir şey söylemiyor. Söylememesi bir şey söylüyor.\n\n${faceLine(sp)} ${sp.name} bu sabah senin adını sordu. Odadaydın.`,
      options: opts(
        {
          key: 'stay', label: 'Başında otur.',
          detail: 'Divan toplanmaz, vergi toplanmaz, sınır beklenmez. Sen orada olursun.',
          stakes: [{ kind: STAKE.KIN, who: sp.name }, { kind: STAKE.REPUTATION }],
          waitDays: 60, odds: clampOdds(0.26 + healthOf(sp) * 0.035),
          onCommit() { courtHears('Divanı bir mevsim topluyamadı.', -15, 20); P().gold = Math.max(0, P().gold - 25); },
          tells: [
            { at: 0.4, text: () => `${sp.name} bugün oturdu. Bir kâse çorba içti.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.8, text: 'Gece nefesi değişti. Hekim kapıda bekliyor.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { sp.health += 1; remember(sp.id, S.playerId, 'Bir mevsim başında oturdu.', +70, 80);
              return { beat: 'kalktı', title: 'Bahçeye Çıktı', text: `Nisanda koluna girip bahçeye çıktı. Üç adımda bir duruyor.\n\nO mevsim divan toplanmadı, vergi eksik geldi, sınır bekçisiz kaldı. Sen oradaydın.`, effects: [`<b>${sp.name}</b> iyileşti`, `<b>${sp.name}</b> +70`, 'Vassalların −15'] }; }
            kill(sp, 'illness'); S.stats.kin_lost++;
            p2.stress += 25;
            S.flags.satAtBedside = true;
            return { beat: 'oradaydın', title: `${sp.name} Öldü`, knell: true, text: `Sabaha karşı oldu. Elini tutuyordun.\n\nBunun bir şeyi değiştirmediğini biliyorsun. Yine de orada olmak istedin.`, effects: [`<b>${sp.name}</b> öldü`, 'Orada olduğunu saray gördü', '+25 gerginlik'] };
          },
        },
        {
          key: 'greek', label: 'Rum hekimini getirt.',
          detail: 'Konstantinopolis’ten. Yol uzun. Fiyatı da uzun.',
          cost: [{ kind: STAKE.GOLD, value: 90 }],
          stakes: [{ kind: STAKE.GOLD, value: 90 }, { kind: STAKE.KIN, who: sp.name }],
          waitDays: 45, odds: clampOdds(0.30 + skill(doc, 'learning') * 0.02),
          disabled: (P()?.gold || 0) < 90, disabledWhy: 'doksan altının yok',
          tells: [
            { at: 0.5, text: 'Hekim yolda. Kar geçidi kapatmış.', goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) { sp.health += 2; remember(sp.id, S.playerId, 'Onun için hekim getirtti.', +40, 60);
              return { beat: 'yetişti', title: 'Zamanında Geldi', text: `Adam odaya girdi, kapıyı kapattı, iki gün çıkmadı.\n\nÜçüncü gün ${sp.name} yatakta oturuyordu. Hekim parasını aldı ve gitti.`, effects: [`<b>${sp.name}</b> iyileşti`, 'Doksan altın gitti'] }; }
            kill(sp, 'illness'); S.stats.kin_lost++;
            return { beat: 'geç kaldı', title: 'Kapıda Karşıladın', text: `Hekim avluya girdiğinde çanlar çoktan çalmıştı.\n\nAtından indi, sana baktı, bir şey söylemedi. Parasını yine de verdin.`, effects: [`<b>${sp.name}</b> öldü`, 'Doksan altın gitti'] };
          },
        },
        {
          key: 'work', label: 'İşine bak.',
          detail: 'Defterler masada duruyor. Üç aydır açılmadı.',
          stakes: [{ kind: STAKE.KIN, who: sp.name }, { kind: STAKE.SOUL }],
          waitDays: 60, odds: 0.31,
          onCommit() { P().gold += 40; },
          tells: [{ at: 0.6, text: () => `Kâhya iki kez odaya çağırttı. İki kez gitmedin.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            p2.piety = Math.max(0, p2.piety - 40);
            if (ok) { remember(sp.id, S.playerId, 'Hasta yatağında yanında olmadı.', -55, 70);
              return { beat: 'sensiz', title: 'Kendi Kalktı', text: `Sensiz iyileşti. Bunu ikiniz de biliyorsunuz ve konuşmuyorsunuz.\n\nSofrada karşılıklı oturuyorsunuz. Kadeh kaldırılmıyor.`, effects: [`<b>${sp.name}</b> iyileşti`, `<b>${sp.name}</b> −55`, '+40 altın', '−40 dindarlık'] }; }
            kill(sp, 'illness'); S.stats.kin_lost++;
            S.flags.wasNotThere = true;
            return { beat: 'yoktun', title: 'Haberi Divanda Aldın', knell: true, text: `Kâhya kapıda durdu ve bekledi. Cümleyi bitirmesine gerek kalmadı.\n\nO odada son kim vardı, hiç sormadın. Sormak istemiyorsun.`, effects: [`<b>${sp.name}</b> öldü`, '−40 dindarlık', 'Saray orada olmadığını gördü'] };
          },
        },
      ),
    });
  },
},

// --- 12. hastalık: what is coming up the road -------------------------------
{
  id: 'plague_gate', cat: 'hastalik', weightHint: 0.72, cooldown: 14 * YEAR, chance: 0.22,
  valid() { const mine = myCounties(); return mine.length ? { t: pickDay(mine, 8) } : false; },
  fire({ t }) {
    const prov = pv(t.provinceId);
    const cap2 = councilman('chaplain');
    offer({
      kind: 'event', title: `${gen(prov.name)} Kapısı`,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `Doğu yolunda iki yüz kişi var; geldikleri köyde kimse kalmadı.`,
      body: `${weatherLine()} Kapıdaki muhafız emir bekliyor.\n\n${cap2 ? `${clericWord()} ${fullName(cap2)} yanında duruyor.` : `${clericWord()} yanında duruyor.`} "Kapıyı kapatan adamın duası kabul olmaz," diyor.\n\nİçlerinde çocuklar var. Bazıları yürümüyor, taşınıyor.`,
      options: opts(
        {
          key: 'open', label: 'Kapıyı aç.', detail: 'Hepsini içeri. Sonra ne olacağını kimse bilmiyor.',
          cost: [{ kind: STAKE.GOLD, value: 35 }],
          stakes: [{ kind: STAKE.LIFE, who: `${gen(prov.name)} halkının` }, { kind: STAKE.SOUL }],
          waitDays: 120, odds: 0.42,
          onCommit() { P().piety += 60; },
          tells: [
            { at: 0.3, text: 'Yeni gelenler çarşıda çalışmaya başladı.', goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.7, text: 'Üç sokakta aynı hafta ölüm var. Tesadüf olabilir.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) { prov.development += 2; P().prestige += 50;
              return { beat: 'temizlermiş', title: 'Hastalık Gelmedi', text: `Kaçtıkları şey onlarla gelmemiş. Bahara kadar iki yüz kişi çalıştı.\n\nÇarşı kalabalık. Kapıyı sen açmıştın.`, effects: [`${prov.name} +2 kalkınma`, '+60 dindarlık', '+50 itibar'] }; }
            prov.development = Math.max(1, prov.development - 4);
            prov.unrest += 30;
            S.flags.plagueIn = prov.id;
            return { beat: 'geldi', title: 'Çarşı Boşaldı', knell: true, text: `Önce iki sokak. Sonra mahalle. Sonra saymayı bıraktılar.\n\nKapıyı sen açmıştın. Bunu herkes biliyor, kimse söylemiyor.`, effects: [`${prov.name} −4 kalkınma`, `${prov.name} +30 huzursuzluk`, 'Salgın içeride'] };
          },
        },
        {
          key: 'shut', label: 'Kapıyı kapat.', detail: lens({ zealous: 'Kapıyı kapatanın duası kabul olmaz. İmamın öyle diyor.', cynical: 'İki yüz kişi. Şehirde on bin kişi var.' }, 'Duvarın dışında kalırlar. Duvarın dışı da senin toprağın.'),
          stakes: [{ kind: STAKE.SOUL }, { kind: STAKE.REPUTATION }],
          waitDays: 90, odds: 0.62,
          onCommit() { P().piety = Math.max(0, P().piety - 70); if (cap2) remember(cap2.id, S.playerId, 'Kapıyı yüzlerine kapattı.', -45, 50); },
          tells: [{ at: 0.5, text: 'Surların dibinde ateş yakmışlar. Sabaha kadar yanıyor.', goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            if (ok) { S.flags.shutTheGate = true;
              return { beat: 'kurtuldun', title: 'Şehir Temiz Kaldı', text: `İki hafta sonra surların dibi boşaldı. Nereye gittiklerini kimse söylemiyor.\n\nŞehir sağ. Sabah duasında ${clericWord()} yüzüne bakamıyorsun.`, effects: [`${prov.name} sağlam`, '−70 dindarlık', `${clericWord()} seni affetmedi`] }; }
            prov.unrest += 40; prov.development = Math.max(1, prov.development - 2);
            S.flags.shutTheGate = true;
            return { beat: 'girdiler', title: 'Duvarı Aştılar', text: `Üçüncü gece kuzey kapısını içeriden açan oldu. Kim açtığı bulunamadı.\n\nHem hastalık girdi hem de kapıyı kapattığın hatırlandı.`, effects: [`${prov.name} −2 kalkınma, +40 huzursuzluk`, '−70 dindarlık'] };
          },
        },
        {
          key: 'camp', label: 'Dışarıda kamp kur.', detail: 'Ekmek ver, içeri alma. Kapı kapalı kalır.',
          cost: [{ kind: STAKE.GOLD, value: 70 }],
          stakes: [{ kind: STAKE.GOLD, value: 70 }, { kind: STAKE.LIFE, who: 'yol halkının' }],
          waitDays: 120, odds: 0.55,
          disabled: (P()?.gold || 0) < 70, disabledWhy: 'yetmiş altının yok',
          tells: [{ at: 0.5, text: 'Kampta kavga çıkmış. Muhafızlar arasına girmemiş.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            p2.piety += 25;
            if (ok) { prov.development += 1; return { beat: 'tuttu', title: 'Duvarın Dibinde Bir Köy', text: `Bahara kadar orada kaldılar. Sonra çoğu gitti, birazı kaldı ve tarla açtı.\n\nNe kahraman oldun ne katil. Bunu kimse anlatmaz.`, effects: [`${prov.name} +1 kalkınma`, '+25 dindarlık', 'Yetmiş altın gitti'] }; }
            prov.unrest += 20;
            return { beat: 'dağıldı', title: 'Kamp Dağıldı', text: `Ekmek yetmedi. Yetmeyince kalabalık kapıya yürüdü, muhafızlar mızrak indirdi.\n\nParan da gitti, adın da. İkisini de kurtarmaya çalışmıştın.`, effects: [`${prov.name} +20 huzursuzluk`, 'Yetmiş altın gitti', '+25 dindarlık'] };
          },
        },
      ),
    });
  },
},

// --- 13. din: the price of a roof -------------------------------------------
{
  id: 'tithe_demand', cat: 'din', weightHint: 0.48, cooldown: 6 * YEAR, chance: 0.35,
  valid() { const c = councilman('chaplain'); const mine = myCounties(); return c && mine.length ? { c, t: pickDay(mine, 2) } : false; },
  fire({ c, t }) {
    const prov = pv(t.provinceId);
    const cost = Math.max(50, Math.round(incomeOf(S.playerId) * 8));
    offer({
      kind: 'event', title: 'Bir Kubbe İçin', targetId: c.id,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `${whoFace(c)} ${gen(prov.name)} damı çöken ${genL(houseWord())} planını masana serdi.`,
      body: `"Kırk yıldır bu taş bekliyor. Sizin adınız yazılacak."\n\nCevabını bekliyor. ${ticLine(c)}\n\nKesende bu kadar var. Marşalın da bu kışın atlarını istiyor.`,
      options: opts(
        {
          key: 'build', label: 'Yaptır.', detail: 'Taş kalır. Altın kalmaz.',
          cost: [{ kind: STAKE.GOLD, value: cost }],
          stakes: [{ kind: STAKE.GOLD, value: cost }],
          waitDays: 420, odds: 0.72,
          disabled: (P()?.gold || 0) < cost, disabledWhy: `${cost} altının yok`,
          tells: [
            { at: 0.4, text: 'Taş ocağından gelen yük iki kez eksik geldi.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.85, text: 'Kubbenin kalıbı söküldü. Ayakta duruyor.', goodTone: 'good', badTone: 'ambiguous' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.piety += 150; prov.development += 2;
              remember(c.id, S.playerId, 'Mescidi yaptırdı.', +60, 60);
              return { beat: 'durdu', title: 'Kubbe Ayakta', text: `İlk cumada içeri sığmadılar. Dışarıda da saf tuttular.\n\nAdın kapının üstünde. Taşa kazınmış, senden uzun yaşayacak.`, effects: [`${prov.name} +2 kalkınma`, '+150 dindarlık', `<b>${c.name}</b> +60`] };
            }
            prov.unrest += 15;
            return { beat: 'çöktü', title: 'Kubbe İndi', text: `Kalıbı söktükleri gün indi. Üç işçi altında kaldı.\n\nAltının gitti, taş gitti, adın da o taşın altında kaldı.`, effects: [`${cost} altın gitti`, `${prov.name} +15 huzursuzluk`, '−itibar'] };
          },
        },
        {
          key: 'later', label: 'Gelecek yıla bırak.', detail: `${clericWord()} bunu dördüncü kez soruyor.`,
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 365, odds: 0.44,
          onCommit() { remember(c.id, S.playerId, 'Mescidi yine erteledi.', -25, 30); },
          tells: [{ at: 0.6, text: () => `${c.name} bu cuma hutbede senin adını anmadı.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) return { beat: 'unutuldu', title: 'Kimse Sormadı', text: `Yıl geçti. Kimse ${accL(houseWord())} sormadı, kimse damı örtmedi.\n\nKışın yağmur içeri doldu. Cemaat ıslak kilimde durdu ve seni beklemedi.`, effects: ['Altının duruyor', `<b>${c.name}</b> −25`] };
            P().piety = Math.max(0, P().piety - 80);
            courtHears('Mescidin damını dört yıldır örtmüyor.', -12, 30);
            return { beat: 'konuşuluyor', title: 'Hutbede Adın Geçmiyor', text: `Cuma günü camide senin için dua edilmedi. Bunu duyman iki hafta sürdü.\n\nBir kubbe için çok ucuz bir düşmanlık satın aldın.`, effects: ['−80 dindarlık', 'Vassalların −12'] };
          },
        },
        onlyIf(has(P(), 'cynical') || has(P(), 'greedy'), {
          key: 'seize', label: 'Vakfın gelirine el koy.',
          detail: 'Taş zaten duruyor. Sandık daha faydalı.',
          stakes: [{ kind: STAKE.SOUL }, { kind: STAKE.OATH }],
          waitDays: 240, odds: clampOdds(0.30 + intrigue() * 0.025),
          onCommit() { P().gold += 120; P().piety = Math.max(0, P().piety - 100); },
          tells: [{ at: 0.5, text: () => `${clericBare()} bu ay iki mektup yazdı. İkisi de şehir dışına gitti.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { remember(c.id, S.playerId, 'Vakfın gelirine el koydu.', -70, 50);
              return { beat: 'sustular', title: 'Sandık Doldu', text: `Kimse şikâyet etmedi. ${clericBare()} da etmedi; sadece bir daha gözüne bakmadı.\n\nYüz yirmi altın. Bir kubbeden daha ağır durdu kesende.`, effects: ['+120 altın', '−100 dindarlık', `<b>${c.name}</b> −70`] }; }
            if (!p2.traits.includes('excommunicated')) p2.traits.push('excommunicated');
            courtHears('Vakıf malına el uzattı.', -30, 60);
            return { beat: 'aforoz', title: 'Kapı Yüzüne Kapandı', knell: true, text: `Fetva bir ay sonra geldi. Kısa bir kâğıt, üç satır.\n\nVassalların artık sana yemin etmiş sayılmıyor. Onlar da okudu.`, effects: ['<b>Aforoz</b> damgası', 'Vassalların ayaklanabilir', '+120 altın'] };
          },
        }),
      ),
    });
  },
},

// --- 14. din: the man who preaches in the square ----------------------------
{
  id: 'heretic_preacher', cat: 'din', weightHint: 0.6, cooldown: 8 * YEAR, chance: 0.28,
  valid() { const mine = myCounties(); return mine.length ? { t: pickDay(mine, 9) } : false; },
  fire({ t }) {
    const prov = pv(t.provinceId);
    const preacher = keeper('preacherId', () => makeCharacter({ culture: prov.culture, sex: 'm', skillMean: 7, traits: ['zealous', 'brave'], birthDay: S.day - 39 * YEAR }));
    offer({
      kind: 'event', title: 'Çarşıdaki Ses', targetId: preacher.id,
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `${whoFace(preacher)} altı haftadır ${gen(prov.name)} çarşısında konuşuyor, kalabalık her hafta büyüyor.`,
      body: `Ne dediğini sana üç ayrı adam üç ayrı türlü anlattı.\n\nHepsinin ortak noktası şu: vergiyi Tanrı istemiyormuş.\n\nKalabalık bugün sekiz yüz kişiydi. Geçen hafta beş yüzdü.`,
      options: opts(
        {
          key: 'burn', label: 'Yaktır.',
          detail: 'Çarşının ortasında. Görülsün diye.',
          confirm: 'Bir adamı halkın önünde yakmak mı?',
          cost: [{ kind: STAKE.PIETY, value: 20 }],
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(preacher)) }, { kind: STAKE.SOUL }],
          waitDays: 100, odds: clampOdds(0.32 + dread(P()) * 0.022),
          onCommit() { kill(preacher, 'execution', S.playerId); prov.unrest += 25; },
          tells: [
            { at: 0.4, text: 'Küllerin olduğu yere her sabah biri çiçek bırakıyor.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: 'Çarşıda kimse konuşmuyor. Alışverişte de.', goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            p2.dreadBonus = (p2.dreadBonus || 0) + 7;
            if (ok) { prov.unrest = Math.max(0, prov.unrest - 15);
              return { beat: 'sustu', title: 'Çarşı Sessiz', text: `Konuşan kalmadı. Dinleyen de kalmadı.\n\nVergi yine toplandı. Toplayan adamlar tek başına gitmiyor artık.`, effects: [`${prov.name} sakinleşti`, '+7 dehşet'] }; }
            prov.unrest += 35;
            S.flags.martyr = prov.id;
            return { beat: 'şehit oldu', title: 'Mezarına Gidiyorlar', knell: true, text: `Kül yığınının olduğu yere taş dizdiler. Sonra bir duvar. Sonra bir kapı.\n\nÖldürdüğün adam artık daha kalabalık konuşuyor.`, effects: [`${prov.name} +35 huzursuzluk`, 'Bir şehit yarattın', '+7 dehşet'] };
          },
        },
        {
          key: 'listen', label: 'Onu divana çağır.', detail: 'Divanda konuşur. Divan da onu duyar.',
          cost: [{ kind: STAKE.PRESTIGE, value: 25 }],
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.SOUL }],
          waitDays: 180, odds: clampOdds(0.26 + skill(P(), 'diplomacy') * 0.032),
          tells: [{ at: 0.5, text: () => `${preacher.name} sarayda kalıyor. Çarşıya inmiyor, çarşı ona geliyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              prov.unrest = Math.max(0, prov.unrest - 25); p2.piety += 60;
              remember(preacher.id, S.playerId, 'Onu dinledi.', +60, 50);
              preacher.courtOf = S.playerId; preacher.liegeId = S.playerId;
              return { beat: 'anlaştınız', title: 'Sarayda Kaldı', text: `Üç gece konuştunuz. Dördüncü sabah çarşıya indi ve vergiyi ödemeyi söyledi.\n\nOnu satın almadın. İkna ettin. Bu daha ucuza gelmedi.`, effects: [`${prov.name} sakinleşti`, '+60 dindarlık', `<b>${preacher.name}</b> sarayında`] };
            }
            prov.unrest += 30;
            courtHears('Vergi düşmanı bir vaizi divanında ağırladı.', -20, 35);
            return { beat: 'kullandı', title: 'Divanı Kürsü Yaptı', text: `Divanda konuştu. Herkesin önünde konuştu. Sen de dinledin.\n\nErtesi gün çarşıdaki kalabalık iki katına çıktı. Senin salonundan çıkmıştı.`, effects: [`${prov.name} +30 huzursuzluk`, 'Vassalların −20', '−25 itibar'] };
          },
        },
        {
          key: 'exile', label: 'Sınır dışına çıkar.', detail: 'Sorunu komşuna hediye et. Komşun bunu unutmaz.',
          cost: [{ kind: STAKE.GOLD, value: 25 }],
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 200, odds: 0.64,
          onCommit() { preacher.courtOf = null; },
          tells: [{ at: 0.6, text: 'Sınırın öte yakasında aynı sözler duyuluyormuş.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { prov.unrest = Math.max(0, prov.unrest - 10); return { beat: 'gitti', title: 'Bir Daha Dönmedi', text: `Çarşı iki hafta konuştu, sonra unuttu. Çarşı her şeyi unutur.\n\nBirinin başının belası oldu. Senin değil.`, effects: [`${prov.name} biraz sakinleşti`, 'Yirmi beş altın gitti'] }; }
            prov.unrest += 20;
            S.flags.preacherReturned = true;
            return { beat: 'döndü', title: 'Geri Geldi', text: `Bir kış sonra döndü. Yanında kırk kişi vardı ve hepsi silahlıydı.\n\nOnu sen göndermiştin. Onu geri getiren de sensin.`, effects: [`${prov.name} +20 huzursuzluk`, 'Silahlı bir cemaat var'] };
          },
        },
      ),
    });
  },
},

// --- 15. din: a year on the road --------------------------------------------
{
  id: 'pilgrimage', cat: 'din', weightHint: 0.65, cooldown: 25 * YEAR, chance: 0.18,
  valid() { const p = P(); return p && age(p) > 28 && p.piety > 60 ? true : false; },
  fire() {
    const p = P();
    const heir = livingChildren(p)[0] || null;
    const sib = Object.values(S.chars).find((c) => c.deathDay == null && c.isSibling === p.id);
    const keep = heir || sib || councilman('steward');
    offer({
      kind: 'event', title: 'Yol', targetId: keep?.id || null,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `Kervan cuma sabahı kalkıyor; bir sonrakini bekleyecek kadar vaktin olmayabilir.`,
      body: `Gitmek bir yıl sürer. O bir yıl boyunca senin sandalyende ${keep ? fullName(keep) : 'bir başkası'} oturur.\n\n${keep ? faceLine(keep) : ''} Şimdiden kapıda bekliyor.\n\nBabanın gidemediğini biliyorsun. Neden gidemediğini de.`,
      options: opts(
        {
          key: 'go', label: 'Yola çık.',
          detail: lens({ zealous: 'Bunu kırk yıldır bekliyorsun.', cynical: 'İnanmıyorsun. Gidenlerin döndüğünde ne kazandığını biliyorsun.' }, 'Bir yıl. Geri döndüğünde her şey yerinde olmayabilir.'),
          cost: [{ kind: STAKE.GOLD, value: 100 }],
          stakes: [{ kind: STAKE.GOLD, value: 100 }, { kind: STAKE.TITLE, who: 'bir yıllık gaybubet', irreversible: true }],
          waitDays: 365, odds: 0.58,
          disabled: (P()?.gold || 0) < 100, disabledWhy: 'yüz altının yok',
          onCommit() { if (keep) { S.flags.regentId = keep.id; remember(keep.id, S.playerId, 'Toprağı ona emanet etti.', +35, 40); } },
          tells: [
            { at: 0.25, text: 'Şam yolunda kervandan iki deve düştü. Yükleri paylaşıldı.', goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.6, text: () => `Evden mektup: vergi toplanmış, ${keep ? keep.name : 'vekilin'} sağ.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.9, text: 'Dönüş yolunda üç haftadır evden haber yok.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.piety += 300; p2.prestige += 120;
              if (!p2.traits.includes('patient')) p2.traits.push('patient');
              return { beat: 'döndün', title: 'Kapıda Karşıladılar', text: `Bir yıl sonra avluya girdiğinde herkes yerindeydi. Bir tek sen değildin.\n\nDaha az konuşuyorsun. Adamların bunu fark etti ve bir şey söylemedi.`, effects: ['+300 dindarlık', '+120 itibar', '<b>Sabırlı</b> damgası'] };
            }
            if (keep) { for (const t of directCountiesOf(S.playerId).slice(0, 1)) grantTitle(t.id, keep.id, 'regent_kept'); remember(keep.id, S.playerId, 'Yokluğunda toprağına oturdu.', -50, 60); }
            return { beat: 'oturmuş', title: 'Yerine Oturmuş', text: `Kapıda seni bekleyen yoktu. Divanda senin sandalyende biri oturuyordu.\n\nAyağa kalktı. Yavaş kalktı.`, effects: [`<b>${keep ? keep.name : 'Vekilin'}</b> bir kontluğa oturdu`, '+dindarlık', 'Yüz altın gitti'] };
          },
        },
        {
          key: 'stay', label: 'Bu yıl olmaz.', detail: 'Her yıl aynı cümle. Bir gün cümle biter.',
          stakes: [{ kind: STAKE.SOUL }],
          waitDays: 0,
          onResolve() {
            const p2 = P();
            p2.piety = Math.max(0, p2.piety - 40);
            S.flags.neverWent = (S.flags.neverWent || 0) + 1;
            return { success: true, beat: 'kaldın', title: 'Kervan Sensiz Kalktı', text: `Cuma sabahı sesleri duydun. Pencereye gitmedin.\n\nBaban da gitmemişti. Bunu ona hiç sormadın.`, effects: ['−40 dindarlık', 'Bir yıl daha ertelendi'] };
          },
        },
      ),
    });
  },
},

// --- 16. sınır: what came over the ridge ------------------------------------
{
  id: 'border_raid', cat: 'sinir', weightHint: 0.6, cooldown: 4 * YEAR, chance: 0.4,
  valid() { const n = neighbourRuler(2); return n ? { n } : false; },
  fire({ n }) {
    const prov = pv(n.mine.provinceId);
    const raider = n.ruler;
    offer({
      kind: 'event', title: 'Yanan Değirmen', targetId: raider.id,
      scene: { provinceIdx: provIdxOf(n.mine.provinceId) },
      framing: `${gen(raider.name)} atlıları dün gece ${gen(prov.name)} değirmenini yaktı, iki köylüyü de öldürdü.`,
      body: `Sabah ayazı var, kül hâlâ sıcak. Değirmenci ${spell(19)} yaşındaki oğlunu taşıyor.\n\nMarşalın hesabı yaptı: peşlerinden gidersen yetişirsin. Yetişirsen sınırı geçmen gerekir.\n\nSınırı geçersen bu bir baskın olmaktan çıkar.`,
      options: opts(
        {
          key: 'chase', label: 'Peşlerine düş.',
          detail: 'Sınırı geçmek savaş demek. Geçmemek de bir şey demek.',
          cost: [{ kind: STAKE.GOLD, value: 45 }],
          stakes: [{ kind: STAKE.LIFE, who: 'kendi adamlarının' }, { kind: STAKE.OATH }],
          waitDays: 40, odds: clampOdds(0.16 + skill(P(), 'martial') * 0.052),
          tells: [
            { at: 0.5, text: 'İz kuzeye dönmüş. Kuzey senin toprağın değil.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.prestige += 100; p2.dreadBonus = (p2.dreadBonus || 0) + 5;
              remember(raider.id, S.playerId, 'Sınırı geçip adamlarını kesti.', -50, 40);
              return { beat: 'yetiştin', title: 'Dere Kenarında', text: `Şafakta yakaladın. Kaçmaya çalışmadılar; yorgundular.\n\nOn bir kişiydiler. Değirmenciye onların atlarını verdin.`, effects: ['+100 itibar', '+5 dehşet', `<b>${raider.name}</b> düşmanın`] };
            }
            p2.prestige -= 60;
            prov.unrest += 15;
            return { beat: 'kaçtılar', title: 'İz Soğudu', text: `Üç gün at koşturdun. Dördüncü gün yağmur izleri sildi.\n\nAdamların yorgun döndü. Değirmen hâlâ yanmış duruyor.`, effects: ['−60 itibar', `${prov.name} +15 huzursuzluk`, 'Kırk beş altın gitti'] };
          },
        },
        {
          key: 'blood', label: 'Kan bedeli iste.',
          detail: 'Bir mektup, bir elçi, bir rakam. Cevabı bir mevsim sürer.',
          cost: [{ kind: STAKE.PRESTIGE, value: 15 }],
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 150, odds: clampOdds(0.30 + skill(P(), 'diplomacy') * 0.036),
          tells: [{ at: 0.6, text: 'Elçin sınırda bekletiliyor. On gündür.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().gold += 80; remember(raider.id, S.playerId, 'Kan bedelini ödetti.', -20, 25);
              return { beat: 'ödedi', title: 'Kese Geldi', text: `Kese gecenin bir yarısı kapıya bırakıldı. İçinde bir de mektup vardı, boştu.\n\nDeğirmenci payını aldı. Oğlunu geri almadı.`, effects: ['+80 altın', `<b>${raider.name}</b> −20`] }; }
            courtHears('Yanan değirmenin hesabını soramadı.', -16, 30);
            return { beat: 'güldüler', title: 'Elçin Eli Boş Döndü', text: `Elçini üç hafta kapıda beklettiler, sonra atsız yolladılar.\n\nSınır boyundaki köylerin bu kışı nasıl geçireceğini konuşuyorlar. Sensiz konuşuyorlar.`, effects: ['Vassalların −16', '−15 itibar'] };
          },
        },
        onlyIf(has(P(), 'vengeful') || has(P(), 'wrathful'), {
          key: 'burn', label: 'Onların köyünü yak.',
          detail: 'Aynı gece. Aynı saatte. Aynı sayıda hane.',
          cost: [{ kind: STAKE.GOLD, value: 30 }],
          stakes: [{ kind: STAKE.LIFE, who: 'sınırın öte yakasındaki köylülerin' }, { kind: STAKE.SOUL }],
          waitDays: 60, odds: 0.58,
          onCommit() { P().piety = Math.max(0, P().piety - 45); },
          tells: [{ at: 0.6, text: 'Bu hafta sınırın iki yakasında da kimse tarlaya çıkmadı.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            p2.dreadBonus = (p2.dreadBonus || 0) + 6;
            remember(raider.id, S.playerId, 'Köyümü yaktı.', -70, 60);
            if (ok) return { beat: 'ödeştiniz', title: 'İki Kül Yığını', text: `Adamların şafaktan önce döndü. Kimse kimseyi öldürmedi; iki taraf da bunu konuşmadı.\n\nDeğirmenci hesabın kapandığını duydu. Oğlunu geri istemedi.`, effects: ['+6 dehşet', `<b>${raider.name}</b> −70`, '−45 dindarlık'] };
            prov.unrest += 30;
            return { beat: 'büyüdü', title: 'Sınır Boyunca Ateş', knell: true, text: `Onlar iki köy yaktı, sen üç. Sonra saymayı bıraktınız.\n\nİki tarafın da tarlası kara. Kışın ne yiyeceklerini kimse sormuyor.`, effects: [`${prov.name} +30 huzursuzluk`, `<b>${raider.name}</b> düşmanın`, '−45 dindarlık'] };
          },
        }),
        {
          key: 'swallow', label: 'Yut.', detail: 'Değirmenci senin adamındı. Oğlu da öyleydi.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 220, odds: 0.36,
          onCommit() { P().prestige -= 40; courtHears('Yanan değirmeni yuttu.', -14, 30); },
          tells: [{ at: 0.5, text: 'Bu ay sınırda iki sürü daha kayboldu.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) return { beat: 'geçti', title: 'Bir Daha Gelmediler', text: `Kışı sessiz geçirdiler. Değirmen baharda yeniden kuruldu, senin paranla.\n\nKimse teşekkür etmedi. Kimse de sormadı.`, effects: ['−40 itibar', 'Sınır sakin'] };
            prov.unrest += 25; prov.development = Math.max(1, prov.development - 1);
            return { beat: 'devam', title: 'Her Ay Geliyorlar', text: `Yutulan ilk baskın son baskın olmaz. Bunu sınır boyundaki herkes biliyor.\n\nKöylüler kuzeye taşınmaya başladı.`, effects: [`${prov.name} −1 kalkınma, +25 huzursuzluk`, '−40 itibar'] };
          },
        },
      ),
    });
  },
},

// --- 17. savaş öncesi: the marshal's map ------------------------------------
{
  id: 'marshal_war', cat: 'sinir', weightHint: 0.68, cooldown: 7 * YEAR, chance: 0.3,
  valid() {
    const m = councilman('marshal');
    const n = neighbourRuler(4);
    return m && n && realmLevy(S.playerId) > 200 ? { m, n } : false;
  },
  fire({ m, n }) {
    const target = n.ruler;
    offer({
      kind: 'event', title: 'Masadaki Harita', targetId: target.id,
      scene: { provinceIdx: provIdxOf(n.prov.id) },
      framing: `Marşalın ${uncap(whoFace(m))} masaya bir harita serdi, parmağını ${dat(n.prov.name)} bastı.`,
      body: `"Adamları dağınık. Kayınbiraderi de onu sevmiyor. Bu kış olmazsa hiç olmaz."\n\nHer cümleden sonra susuyor. ${ticLine(m)}\n\n${cap(who(target))}. Onu bir kez görmüştün, bir düğünde. Sana su vermişti.`,
      options: opts(
        {
          key: 'muster', label: 'Askeri topla.',
          detail: 'Toplandıktan sonra geri gönderilmez. Yem ister, para ister, savaş ister.',
          confirm: 'Bu kış bir savaş açacaksın.',
          cost: [{ kind: STAKE.GOLD, value: 120 }, { kind: STAKE.PRESTIGE, value: 20 }],
          stakes: [{ kind: STAKE.LIFE, who: 'adamlarının' }, { kind: STAKE.TITLE, who: n.prov.name, irreversible: true }],
          waitDays: 270, odds: clampOdds(0.32 + skill(P(), 'martial') * 0.035 + skill(m, 'martial') * 0.02),
          disabled: (P()?.gold || 0) < 120, disabledWhy: 'yüz yirmi altının yok',
          onCommit() { S.flags.mustered = S.day; courtHears('Bizi kışın savaşa sürdü.', -10, 15); },
          tells: [
            { at: 0.3, text: 'İki vassalın adamlarını geç yolladı. Sebep yazmamışlar.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.6, text: () => `${gen(target.name)} kalesine yiyecek giriyor. Kuşatma bekliyorlar.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.9, text: 'Kar erken düştü. Yollar çamur.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              grantTitle(n.title.id, S.playerId, 'conquest');
              p2.prestige += 200;
              if (!p2.traits.includes('victorious')) p2.traits.push('victorious');
              remember(target.id, S.playerId, 'Toprağını aldı.', -80, 80);
              return { beat: 'aldın', title: `${n.prov.name} Senin`, text: `Kapıyı içeriden açtılar. Kuşatma altı hafta sürmüştü.\n\n${fullName(target)} elini uzatmadı. Sen de uzatmadın.`, effects: [`<b>${n.prov.name}</b> alındı`, '+200 itibar', '<b>Muzaffer</b> damgası'] };
            }
            p2.prestige -= 120;
            if (!p2.traits.includes('humbled')) p2.traits.push('humbled');
            courtHears('Bizi bir kış boyunca çamurda bekletti.', -25, 40);
            return { beat: 'dönemedin', title: 'Çamurda Kaldı', knell: true, text: `Kuşatma tutmadı. Yem bitti, sonra sabır bitti.\n\nGeri dönerken kaç adamın eksildiğini marşalın söylemedi. Sen de sormadın.`, effects: ['−120 itibar', '<b>Ezik</b> damgası', 'Vassalların −25'] };
          },
        },
        {
          key: 'parade', label: 'Sınırda göster, geçme.',
          detail: 'Toplarsın, yürürsün, durursun. Blöf tutarsa savaşsız kazanırsın.',
          cost: [{ kind: STAKE.GOLD, value: 60 }],
          stakes: [{ kind: STAKE.GOLD, value: 60 }, { kind: STAKE.REPUTATION }],
          waitDays: 150, odds: clampOdds(0.30 + skill(P(), 'diplomacy') * 0.02 + skill(P(), 'martial') * 0.02),
          disabled: (P()?.gold || 0) < 60, disabledWhy: 'altmış altının yok',
          onCommit() { S.flags.paraded = S.day; },
          tells: [
            { at: 0.4, text: () => `${gen(target.name)} adamları da sınıra çıktı. Aynı sayıda göründüler.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.85, text: 'Adamların üç haftadır çadırda. Yem bitiyor.', goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.prestige += 90; p2.gold += 70;
              remember(target.id, S.playerId, 'Sınırda ordusunu gösterdi.', -30, 35);
              return { beat: 'geri çekildi', title: 'Sınır Taşları Kalktı', text: `Üçüncü hafta karşı taraf çadırlarını topladı. İki sınır köyünü boşalttılar, kimse tek ok atmadı.\n\nAdamların bir kere bile kılıç çekmedi. Bunu evde anlatmayacaklar.`, effects: ['+90 itibar', '+70 altın', `<b>${target.name}</b> −30`] };
            }
            p2.prestige -= 70;
            courtHears('Bizi çadırda bekletti, sonra eve yolladı.', -20, 30);
            return { beat: 'blöf görüldü', title: 'Çadırlar Söküldü', text: `Karşı taraf yerinden kımıldamadı. Yem bitti, sonra adamlar sormaya başladı.\n\nGeri döndün. Sınır taşları yerinde. Marşalın haritayı kendi eliyle katladı.`, effects: ['−70 itibar', 'Vassalların −20', 'Altmış altın gitti'] };
          },
        },
        {
          key: 'wait', label: 'Haritayı kaldır.', detail: 'Marşalın haklı olabilir. Haklı olmak yetmez.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 400, odds: clampOdds(0.42 + skill(P(), 'stewardship') * 0.022),
          onCommit() { remember(m.id, S.playerId, 'Haritayı katlayıp kaldırdı.', -25, 30); },
          tells: [{ at: 0.6, text: () => `${gen(target.name)} sınırında yeni bir kule yükseliyor.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().gold += 60; return { beat: 'iyi ettin', title: 'O Kış Kimse Ölmedi', text: `Komşunun kayınbiraderi baharda ayaklandı ve kendi kalesinde öldü. Kuşatmayı sen yapmadın.\n\nO kış senin köylerinde kimse yas tutmadı. Marşalın bunu saymıyor.`, effects: ['+60 altın', 'Adamların yerinde'] }; }
            remember(m.id, S.playerId, 'Fırsatı kaçırdı.', -35, 40);
            return { beat: 'kapandı', title: 'Kule Bitti', text: `Marşalın haritayı bir daha açmadı. Konu açıldığında da susuyor.\n\nO kapı kapandı. Hangi kapıydı, ikinizden başka bilen yok.`, effects: [`<b>${m.name}</b> −35`, 'Fırsat geçti'] };
          },
        },
      ),
    });
  },
},

// --- 18. savaş öncesi: men who fight for coin -------------------------------
{
  id: 'mercenary_offer', cat: 'sinir', weightHint: 0.52, cooldown: 6 * YEAR, chance: 0.3,
  valid() { const p = P(); return p && p.gold > 60 ? true : false; },
  fire() {
    const p = P();
    const capt = keeper('captainId', () => makeCharacter({ culture: 'greek', sex: 'm', skillMean: 8, traits: ['greedy', 'brave'], birthDay: S.day - 44 * YEAR }));
    const price = Math.max(60, Math.round(incomeOf(p.id) * 10));
    offer({
      kind: 'event', title: 'Kapıdaki Bölük', targetId: capt.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `Kapının önünde dört yüz atlı duruyor; başlarındaki adam ${uncap(whoFace(capt))}.`,
      body: `Adamları avluya sığmadı. Dışarıda, tarlada bekliyorlar.\n\n"Kışı burada geçiririz. Kimin kapısını çalacağınızı siz söylersiniz."\n\nAtları iyi bakılmış, adamları değil. Peşin ister. Kışın ortasında da gidebilir.`,
      options: opts(
        {
          key: 'hire', label: 'Peşini öde.', detail: 'Dört yüz atlı. Sadakat satın alınmaz, kiralanır.',
          cost: [{ kind: STAKE.GOLD, value: price }],
          stakes: [{ kind: STAKE.GOLD, value: price }, { kind: STAKE.REPUTATION }],
          waitDays: 200, odds: clampOdds(0.38 + skill(P(), 'martial') * 0.028),
          disabled: p.gold < price, disabledWhy: `${price} altının yok`,
          onCommit() { S.flags.mercenaries = capt.id; },
          tells: [
            { at: 0.4, text: 'Bölük iki köyde konakladı. Köylüler şikâyetçi.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: () => `${capt.name} bu hafta kimseyle konuşmadı. Atları nallattı.`, goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { p2.prestige += 90; p2.bonus = { ...(p2.bonus || {}), martial: (p2.bonus?.martial || 0) + 2 };
              remember(capt.id, S.playerId, 'Parasını tam ödedi.', +40, 30);
              return { beat: 'kaldılar', title: 'Kışı Çıkardılar', text: `Bir kış boyunca sınırda durdular ve kimse geçmedi.\n\nBaharda giderken bir tek ahırın samanını aldılar. Hesabı sordular, ödediler.`, effects: ['+90 itibar', '+2 askerlik', `${price} altın gitti`] }; }
            for (const t of myCounties().slice(0, 1)) { const pr = pv(t.provinceId); pr.unrest += 30; pr.development = Math.max(1, pr.development - 2); }
            remember(capt.id, S.playerId, 'Kışın ortasında bıraktı.', -10, 20);
            return { beat: 'bıraktılar', title: 'Kışın Ortasında Gittiler', text: `Daha iyi bir teklif gelmiş. Sana söyleme nezaketini gösterdiler.\n\nGiderken iki köyü boşalttılar. Paranı geri istemeyi düşünmedin bile.`, effects: [`${price} altın gitti`, 'Bir kontluğunda huzursuzluk', 'Sınır açık'] };
          },
        },
        {
          key: 'half', label: 'Yarısını tut.',
          detail: 'İki yüz atlı, yarı fiyat. Kalan iki yüzü kimin tuttuğunu sonra öğrenirsin.',
          cost: [{ kind: STAKE.GOLD, value: Math.round(price * 0.55) }],
          stakes: [{ kind: STAKE.GOLD, value: Math.round(price * 0.55) }, { kind: STAKE.REPUTATION }],
          waitDays: 200, odds: 0.47,
          disabled: p.gold < Math.round(price * 0.55), disabledWhy: 'kesende o kadar yok',
          tells: [
            { at: 0.45, text: 'Bölüğün öbür yarısı sınırın karşısında konakladı. Aynı sancak, öbür taraf.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.prestige += 40;
              remember(capt.id, S.playerId, 'Yarısını tuttu, sözünde durdu.', +20, 25);
              return { beat: 'yetti', title: 'İki Yüz Atlı Yetti', text: `Geçit dar. İki yüz atlı da yeter, dört yüz de. Bunu ikisi de biliyordu.\n\nÖbür yarısı hiç gelmedi. Nerede kışladıklarını kimse söylemedi.`, effects: ['+40 itibar', `${Math.round(price * 0.55)} altın gitti`] };
            }
            const t2 = myCounties()[0]; const pr2 = t2 ? pv(t2.provinceId) : null;
            if (pr2) pr2.unrest += 20;
            return { beat: 'karşılaştılar', title: 'Aynı Sancak, İki Yaka', text: `Geçitte iki yüz atlın, iki yüz atlıyla karşılaştı. Aynı bölüğün adamlarıydı.\n\nKimse kılıç çekmedi. İkisi de çekildi, sen ödedin.`, effects: [pr2 ? `${pr2.name} +20 huzursuzluk` : 'Sınırda huzursuzluk', `${Math.round(price * 0.55)} altın gitti`] };
          },
        },
        {
          key: 'send', label: 'Geri yolla.', detail: 'Dört yüz aç atlı. Kapının önünde ya da komşunun.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 180, odds: 0.63,
          onCommit() { remember(capt.id, S.playerId, 'Kapıdan çevirdi.', -25, 25); },
          tells: [{ at: 0.6, text: 'Bölük sınırın öte yakasında konaklamış.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) return { beat: 'çevirdiler', title: 'Batıya Gittiler', text: `Üç gün tarlada beklediler, sonra atlarını çevirdiler.\n\nKesende paran duruyor. Bu kış kimsenin kapısı çalınmadı.`, effects: ['Altının duruyor'] };
            const t = myCounties()[0]; const pr = t ? pv(t.provinceId) : null;
            if (pr) { pr.unrest += 25; pr.development = Math.max(1, pr.development - 1); }
            return { beat: 'döndüler', title: 'Komşun Tuttu', text: `Komşun onları tuttu. İlk gittikleri yer senin sınır köylerin oldu.\n\nAynı adamlar. Aynı yüzler. Bu sefer öbür taraftan.`, effects: [pr ? `${pr.name} yağmalandı` : 'Sınır köylerin yağmalandı', 'Komşunun dört yüz atlısı var'] };
          },
        },
      ),
    });
  },
},

// --- 19. doğa: the river took the mill --------------------------------------
{
  id: 'flood', cat: 'doga', weightHint: 0.45, cooldown: 8 * YEAR, chance: 0.3,
  valid() { const mine = myCounties(); return mine.length ? { t: pickDay(mine, 11) } : false; },
  fire({ t }) {
    const prov = pv(t.provinceId);
    const reeve = councilman('steward');
    const cost = Math.max(40, Math.round(incomeOf(S.playerId) * 6));
    offer({
      kind: 'event', title: 'Su Çekildiğinde',
      scene: { provinceIdx: provIdxOf(t.provinceId) },
      framing: `${gen(prov.name)} deresi üç gün taştı; çekildiğinde köprü de değirmen de yoktu.`,
      body: `Su çekildi, çamur kaldı. Kırk hane damsız.\n\n${reeve ? `Kâhyan ${fullName(reeve)} iki rakam söyledi.` : 'Kâhyan iki rakam söyledi.'} Biri köprü için, biri insanlar için. İkisi birden olmuyor.\n\nKöprü gitmezse vergi gelmez. İnsanlar gitmezse köprü kime yarar.`,
      options: opts(
        {
          key: 'bridge', label: 'Köprüyü yap.', detail: 'Taş köprü. Yüz yıl durur. Bu kış kimseyi ısıtmaz.',
          cost: [{ kind: STAKE.GOLD, value: cost }],
          stakes: [{ kind: STAKE.GOLD, value: cost }, { kind: STAKE.REPUTATION }],
          waitDays: 240, odds: clampOdds(0.56 + skill(P(), 'stewardship') * 0.022),
          disabled: (P()?.gold || 0) < cost, disabledWhy: `${cost} altının yok`,
          tells: [{ at: 0.5, text: 'Köprü ayakları döküldü. Kırk hane hâlâ çadırda.', goodTone: 'good', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            if (ok) { prov.development += 2; prov.unrest += 10;
              return { beat: 'durdu', title: 'Köprü Ayakta', text: `İlk arabayı sen geçirdin. Kalabalık kenarda durdu ve baktı.\n\nÇadırdakiler de baktı. Onlar da orada duruyor.`, effects: [`${prov.name} +2 kalkınma`, `${prov.name} +10 huzursuzluk`, `${cost} altın gitti`] }; }
            prov.development = Math.max(1, prov.development - 2); prov.unrest += 20;
            return { beat: 'yıkıldı', title: 'İkinci Sel', text: `Sonbaharda dere yine taştı ve yeni köprüyü de aldı.\n\nUsta kaçmış. Altın da onunla gitmiş olmalı.`, effects: [`${prov.name} −2 kalkınma`, `${cost} altın gitti`] };
          },
        },
        {
          key: 'people', label: 'Haneleri barındır.', detail: 'Kırk hane. Kışı çıkarırlar, vergiyi baharda öderler.',
          cost: [{ kind: STAKE.GOLD, value: Math.round(cost * 0.6) }],
          stakes: [{ kind: STAKE.GOLD, value: Math.round(cost * 0.6) }],
          waitDays: 180, odds: 0.76,
          disabled: (P()?.gold || 0) < Math.round(cost * 0.6), disabledWhy: 'kesende o kadar yok',
          tells: [{ at: 0.5, text: 'Kilerdeki un ocak ayında bitti. Bir ay erken.', goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { prov.unrest = Math.max(0, prov.unrest - 25); P().prestige += 40;
              return { beat: 'çıkardılar', title: 'Kırk Hane Sağ', text: `Baharda kendi evlerini kendileri yaptı. Köprüyü de yaptılar, tahtadan.\n\nTahta köprü on yıl durur. On yılın var mı, bilmiyorsun.`, effects: [`${prov.name} huzursuzluk düştü`, '+40 itibar'] }; }
            prov.development = Math.max(1, prov.development - 3);
            return { beat: 'gittiler', title: 'Köy Boşaldı', text: `Şubatta un bitti. Mart gelmeden kırk hane kuzeye yürüdü.\n\nArkalarında köprüsüz bir dere ve boş bir vadi kaldı.`, effects: [`${prov.name} −3 kalkınma`, 'Altının gitti'] };
          },
        },
        {
          key: 'none', label: 'İkisini de yapma.', detail: 'Kâhyan rakamları masada bıraktı ve çıktı.',
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.SOUL }],
          waitDays: 200, odds: 0.33,
          onCommit() { P().gold += 20; P().piety = Math.max(0, P().piety - 30); },
          tells: [{ at: 0.5, text: 'Kâhyan bu ay rakamları getirmedi. Getirmesine gerek kalmadı.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            prov.development = Math.max(1, prov.development - 2);
            if (ok) return { beat: 'kendileri', title: 'Kendileri Yaptı', text: `Kimseden bir şey beklemediler. Tahtadan bir geçit kurdular ve kullandılar.\n\nVergiyi de eksik ödediler. Sesini çıkarmadın.`, effects: [`${prov.name} −2 kalkınma`, '−30 dindarlık'] };
            prov.unrest += 35;
            return { beat: 'gitmediler', title: 'Kapına Geldiler', text: `Kırk hane bahara kadar bekledi, sonra yürüdü. Kalenin kapısına kadar geldiler.\n\nKimse taş atmadı. Sadece durdular ve baktılar. Sabaha kadar durdular.`, effects: [`${prov.name} −2 kalkınma, +35 huzursuzluk`, '−30 dindarlık'] };
          },
        },
      ),
    });
  },
},

// --- 20. doğa: the hunt ------------------------------------------------------
{
  id: 'hunt_accident', cat: 'doga', weightHint: 0.66, cooldown: 9 * YEAR, chance: 0.28,
  valid() {
    const pool = courtiers().filter((c) => c.sex === 'm' && age(c) > 18);
    return pool.length ? { friend: pickDay(pool, 13) } : false;
  },
  fire({ friend }) {
    const p = P();
    offer({
      kind: 'event', title: 'Domuz', targetId: friend.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `Domuz ${acc(friend.name)} attan aldı; ikisi de şimdi çalılığın içinde.`,
      body: `${whoFace(friend)}. Bağırmıyor. Bağırmaması kötü.\n\nAdamların halka kurdu, kimse ilk girmek istemiyor. Çalılık bir kez kıpırdadı, sonra durdu.\n\nSenin mızrağın elinde. Herkes sana bakıyor.`,
      options: opts(
        {
          key: 'in', label: 'Sen gir.',
          detail: lens({ brave: 'Mızrak elinde. Ayakların çoktan karar verdi.', craven: 'Mızrak elinde. Ayakların gitmiyor.' }, 'Domuz üç yüz kilo. Sen de bir tanesin.'),
          confirm: 'Çalılığa kendin mi gireceksin?',
          stakes: [{ kind: STAKE.LIFE, who: 'kendi' }, { kind: STAKE.LIFE, who: gen(fullName(friend)) }],
          waitDays: 14, odds: clampOdds(0.3 + (p.prowess || 0) * 0.035),
          onCommit() { courtHears('Adamı için çalılığa kendi girdi.', +25, 45); },
          tells: [{ at: 0.6, text: 'Yara azdı. Cerrah bacağa bakıyor, yüzünü göstermiyor.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.prestige += 130; if (!p2.traits.includes('scarred')) p2.traits.push('scarred');
              remember(friend.id, S.playerId, 'Onun için çalılığa girdi.', +90, 90);
              return { beat: 'çıkardın', title: 'İkiniz de Çıktınız', text: `Domuzu mızrakla yere çaktın, sonra dizinin üstüne çöktün ve kalkamadın.\n\n${friend.name} yürüyor. Sen aksıyorsun. Kalanları adamların anlatıyor.`, effects: ['+130 itibar', '<b>Yaralı</b> — yüzünde iz', `<b>${friend.name}</b> +90`] };
            }
            kill(friend, 'wounds');
            p2.traits.push('wounded'); p2.health -= 1.5; p2.stress += 20;
            return { beat: 'geç kaldın', title: 'Çalılıktan İki Kişi Çıktı', knell: true, text: `Biri sendin. Öteki taşındı.\n\nBacağın kışın ağrıyor. Ağrıdıkça hatırlıyorsun.`, effects: [`<b>${friend.name}</b> öldü`, '<b>Ağır Yaralı</b> — kalıcı', '+20 gerginlik'] };
          },
        },
        {
          key: 'archers', label: 'Okçuları çağır.',
          detail: 'Uzaktan. Ok domuzu bulur. Ya da bulmaz.',
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(friend)) }],
          waitDays: 10, odds: clampOdds(0.34 + skill(P(), 'martial') * 0.026),
          onCommit() { courtHears('Çalılığa okçuları yolladı.', -8, 20); },
          tells: [{ at: 0.5, text: 'Çalılıktan ses kesildi. İyi mi kötü mü, bilinmiyor.', goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { remember(friend.id, S.playerId, 'Okçuları yolladı, kendi girmedi.', +15, 30);
              return { beat: 'kurtuldu', title: 'Dört Ok', text: `Domuz dört okla düştü. ${friend.name} altından çıkarıldı, sağdı.\n\nSana teşekkür etti. Gözünün içine bakarak etmedi.`, effects: [`<b>${friend.name}</b> yaşadı`, `<b>${friend.name}</b> +15`] }; }
            kill(friend, 'wounds');
            courtHears('Adamını okçulara bıraktı.', -20, 40);
            return { beat: 'vurdular', title: 'İki Ok Yanlış Gitti', knell: true, text: `Çalılığı açtıklarında domuz ölüydü. ${friend.name} de.\n\nHangi okun kimden çıktığını kimse söylemedi. Sormadın.`, effects: [`<b>${friend.name}</b> öldü`, 'Vassalların −20'] };
          },
        },
        onlyIf(has(P(), 'craven') || has(P(), 'cynical'), {
          key: 'leave', label: 'Atları çevir.', detail: 'Bir adam. Sen bir hanedansın.',
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(friend)) }, { kind: STAKE.SOUL }],
          waitDays: 3, odds: 0.15,
          onCommit() { courtHears('Adamını çalılıkta bıraktı.', -35, 60); P().piety = Math.max(0, P().piety - 50); },
          onResolve(d, ok) {
            if (ok) { return { beat: 'sağ çıktı', title: 'Akşam Kaleye Geldi', text: `Yürüyerek geldi. Bacağını sürüyerek geldi. Kapıda durdu ve içeri girmedi.\n\nO gece atını aldı ve gitti. Nereye gittiğini soran olmadı.`, effects: [`<b>${friend.name}</b> sarayını terk etti`, 'Vassalların −35', '−50 dindarlık'] }; }
            kill(friend, 'wounds');
            return { beat: 'bıraktın', title: 'Ertesi Gün Buldular', knell: true, text: `Köpekler buldu. Az kalmıştı.\n\nAdamların o gün ne yaptığını gördü. Bunu kimse sana söylemeyecek.`, effects: [`<b>${friend.name}</b> öldü`, 'Vassalların −35', '−50 dindarlık'] };
          },
        }),
      ),
    });
  },
},

// --- 21. misafir: the man at the gate with no land --------------------------
{
  id: 'exiled_guest', cat: 'misafir', weightHint: 0.58, cooldown: 8 * YEAR, chance: 0.28,
  valid() { const n = neighbourRuler(6); return n ? { n } : false; },
  fire({ n }) {
    const hunter = n.ruler;
    const guest = keeper('exileId', () => makeCharacter({ culture: hunter.culture, sex: 'm', skillMean: 7, traits: ['ambitious'], birthDay: S.day - 31 * YEAR }));
    offer({
      kind: 'event', title: 'Kapıdaki Yabancı', targetId: guest.id,
      scene: { provinceIdx: anyProvinceOf(S.playerId) },
      framing: `${whoFace(guest)} gece yarısı kapına geldi, peşinde ${gen(hunter.name)} adamlarıyla.`,
      body: `Atı yolda ölmüş. Son iki fersahı yaya gelmiş; çizmesinin tabanı yok.\n\n"Bir gece. Sadece bir gece isterim."\n\nBir gece diyen adam üç yıl kalır. O da biliyor bunu, sen de. ${hourLine()}`,
      options: opts(
        {
          key: 'shelter', label: 'İçeri al.', detail: 'Ayağı kanıyor. Avluya kadar iz bırakmış.',
          cost: [{ kind: STAKE.PRESTIGE, value: 10 }],
          stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
          waitDays: 300, odds: 0.55,
          onCommit() { guest.courtOf = S.playerId; guest.liegeId = S.playerId; remember(hunter.id, S.playerId, 'Kaçağımı sakladı.', -45, 45); },
          tells: [
            { at: 0.4, text: () => `${gen(hunter.name)} elçisi ikinci kez geldi. Bu sefer yazılı geldi.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: () => `${guest.name} sarayında adam topluyor. Kendi adamlarını.`, goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              remember(guest.id, S.playerId, 'Kapısını açtı.', +80, 80);
              P().hooks.push({ onId: guest.id, kind: 'weak', secretId: 'sheltered' });
              return { beat: 'borçlu', title: 'Kaldı ve Kaldı', text: `Üç yıl kaldı. Sonra kendi toprağını geri aldı ve seni unutmadı.\n\nHer sonbahar bir at yolluyor. Atlar iyi.`, effects: [`<b>${guest.name}</b> sana borçlu`, `<b>${hunter.name}</b> −45`] };
            }
            const t = myCounties()[0];
            if (t) pv(t.provinceId).unrest += 20;
            return { beat: 'pahalıya', title: 'Sınırda Bedeli Ödendi', text: `${cap(gen(hunter.name))} atlıları üç köyünü yaktı. Sebebini yazılı bildirdiler.\n\n${guest.name} bir sabah gitmişti. Teşekkür notu bırakmamış.`, effects: ['Bir kontluğunda huzursuzluk', `<b>${hunter.name}</b> düşmanın`, 'Misafirin gitti'] };
          },
        },
        {
          key: 'hand', label: 'Teslim et.',
          detail: 'Kapına gelen adamı geri vermek. Bunu anlatan olur.',
          confirm: 'Kapına sığınan adamı teslim mi edeceksin?',
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(guest)) }, { kind: STAKE.SOUL }],
          waitDays: 60, odds: 0.7,
          onCommit() { courtHears('Kapısına sığınanı teslim etti.', -30, 60); P().gold += 90; },
          tells: [{ at: 0.6, text: 'Teslim ettiğin adamdan haber yok. Hiç kimseden haber yok.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            p2.piety = Math.max(0, p2.piety - 60);
            kill(guest, 'execution', hunter.id);
            if (ok) { remember(hunter.id, S.playerId, 'Kaçağı teslim etti.', +55, 40);
              return { beat: 'aldılar', title: 'Doksan Altın', text: `${cap(gen(hunter.name))} adamları onu zincirledi ve keseyi bıraktı.\n\nKapıdan çıkarken sana bakmadı. Bakmasını beklemiştin.`, effects: ['+90 altın', `<b>${hunter.name}</b> +55`, 'Vassalların −30', '−60 dindarlık'] }; }
            courtHears('Misafirini sattı ve ucuza sattı.', -25, 60);
            return { beat: 'ucuza', title: 'Kese Eksikti', knell: true, text: `Adamı aldılar, keseyi tarttılar, gittiler. Söz verilenin yarısıydı.\n\nBir adamı sattın ve pazarlığı da kaybettin.`, effects: ['+45 altın', 'Vassalların −55 toplam', '−60 dindarlık'] };
          },
        },
        {
          key: 'turn', label: 'Kapıyı kapat.', detail: 'İçeri almazsan teslim de etmemiş olursun. Yarım bir temizlik.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 240, odds: 0.46,
          onCommit() { P().piety = Math.max(0, P().piety - 25); },
          tells: [{ at: 0.6, text: 'Kapıda bekleyen adamın izleri kuzeye gidiyormuş.', goodTone: 'good', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            if (ok) return { beat: 'kayboldu', title: 'İz Kayboldu', text: `Nereye gittiğini kimse öğrenmedi. Peşindekiler de öğrenmedi.\n\nBir hafta sonra kapının önündeki kar eridi. Altında bir eyer vardı. Kimse almadı.`, effects: ['−25 dindarlık', 'Kimse bir şey borçlu değil'] };
            remember(guest.id, S.playerId, 'Kapısını yüzüne kapattı.', -70, 70);
            S.flags.turnedAwayGuest = guest.id;
            return { beat: 'yaşadı', title: 'Üç Yıl Sonra', text: `Toprağını geri aldı. Şimdi sınırının öte yakasında oturuyor.\n\nSenin adını hatırlıyor. Kapının hangi kapı olduğunu da.`, effects: [`<b>${guest.name}</b> artık komşun ve düşmanın`, '−25 dindarlık'] };
          },
        },
      ),
    });
  },
},

// --- 22. misafir: the stranger with a book ----------------------------------
{
  id: 'foreign_scholar', cat: 'misafir', weightHint: 0.42, cooldown: 7 * YEAR, chance: 0.3,
  valid() { const p = P(); return p ? true : false; },
  fire() {
    const p = P();
    const scholar = keeper('scholarId', () => makeCharacter({ culture: 'armenian', sex: 'm', skillMean: 10, traits: ['patient', 'cynical'], birthDay: S.day - 52 * YEAR }));
    const cap3 = councilman('chaplain');
    offer({
      kind: 'event', title: 'Sandıktaki Kitaplar', targetId: scholar.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${whoFace(scholar)} iki sandık kitapla geldi, kışı burada geçirmek istiyor.`,
      body: `Sandıkların birini açtı. İçinde yıldız çizimleri, bir de insan gövdesi vardı, derisi yüzülmüş.\n\n${cap3 ? `${clericWord()} ${fullName(cap3)} sandığa bakmıyor bile.` : `${clericWord()} sandığa bakmıyor bile.`}\n\n${ticLine(scholar)} Karşılığında oğluna ders vermeyi öneriyor.`,
      options: opts(
        {
          key: 'keep', label: 'Kalsın.', detail: 'Bir kış. Kitaplar da kalır.',
          cost: [{ kind: STAKE.GOLD, value: 30 }, { kind: STAKE.PIETY, value: 30 }],
          stakes: [{ kind: STAKE.GOLD, value: 30 }, { kind: STAKE.SOUL }],
          waitDays: 300, odds: 0.62,
          onCommit() { scholar.courtOf = S.playerId; scholar.liegeId = S.playerId; if (cap3) remember(cap3.id, S.playerId, 'Kâfir kitaplarını sarayına aldı.', -30, 40); },
          tells: [
            { at: 0.5, text: 'Kule odasında gece geç saatlere kadar ışık var.', goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.85, text: () => `${clericWord()} bu ay üç kez dışarıda vaaz verdi.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            const kid = livingChildren(p2)[0];
            if (ok) {
              p2.bonus = { ...(p2.bonus || {}), learning: (p2.bonus?.learning || 0) + 3 };
              if (kid && !kid.traits.includes('intelligent')) kid.traits.push('intelligent');
              return { beat: 'öğrettin', title: 'Kule Odası', text: `Baharda gitti. İki sandığın birini bıraktı.\n\n${kid ? `${kid.name} artık senin okuyamadığın şeyleri okuyor.` : 'Kitapları kimse okumuyor. Yine de duruyorlar.'}`, effects: ['+3 ilim', kid ? `<b>${kid.name}</b> <b>Zeki</b>` : 'Kitaplık kaldı', '−30 dindarlık'] };
            }
            p2.piety = Math.max(0, p2.piety - 60);
            courtHears('Sarayında kâfir kitapları var.', -18, 40);
            return { beat: 'duyuldu', title: 'Cuma Vaazı', text: `${clericWord()} senin adını vermeden konuştu. Herkes kimi kastettiğini anladı.\n\nAdam gece yarısı gitti. Sandıklarını da götürdü.`, effects: ['−60 dindarlık', 'Vassalların −18', 'Otuz altın gitti'] };
          },
        },
        {
          key: 'seize', label: 'Sandıkları al, adamı yolla.',
          detail: 'Kitaplar kalır, sahibi kalmaz. Kimse okuyamaz ama kimse de sormaz.',
          stakes: [{ kind: STAKE.OATH }, { kind: STAKE.REPUTATION }],
          waitDays: 260, odds: 0.4,
          onCommit() { P().prestige -= 30; courtHears('Misafirinin sandığına el koydu.', -22, 40); },
          tells: [{ at: 0.5, text: 'Kule odasında kimse yok, kitaplar açık duruyor. Kimse dokunmuyor.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              p2.bonus = { ...(p2.bonus || {}), learning: (p2.bonus?.learning || 0) + 1 };
              return { beat: 'kaldılar', title: 'Kimse Açmadı', text: `Sandıklar üç yıl kule odasında durdu. Sonra kâhyan birini açtı ve haritaları çıkardı.\n\nHaritalar işine yaradı. Ötekini hâlâ kimse açmadı.`, effects: ['+1 ilim', 'Vassalların −22', '−30 itibar'] };
            }
            const sc = ch(S.flags.scholarId);
            if (sc) remember(sc.id, S.playerId, 'Sandıklarımı aldı.', -80, 60);
            S.flags.stoleTheBooks = true;
            return { beat: 'anlatmış', title: 'Antakya\'da Anlatılıyor', text: `Adam Antakya\'ya vardı ve orada anlattı. Kitapları alan Türk beyi diye anlattı.\n\nO yıl kapına bir tek tüccar geldi. Ertesi yıl o da gelmedi.`, effects: ['Yabancı tüccarlar uzak duruyor', 'Vassalların −22', '−30 itibar'] };
          },
        },
        {
          key: 'send', label: 'Yolla gitsin.', detail: `${clericWord()} kapıda bekliyor. Cevabını duymak istiyor.`,
          waitDays: 200, odds: 0.68,
          stakes: [{ kind: STAKE.REPUTATION }],
          onCommit() { if (cap3) remember(cap3.id, S.playerId, 'Yabancıyı kapıdan çevirdi.', +25, 30); },
          tells: [{ at: 0.6, text: 'Adam komşu kalede kalıyormuş. İyi karşılanmış.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { p2.piety += 40; return { beat: 'temiz', title: 'Kimse Konuşmadı', text: `Kule odasını ambar yaptılar. Kışın ortasında oraya arpa taşındı.\n\nSandıkların hangi kapıdan çıktığını görmedin. Bir daha da o kapıyı düşünmedin.`, effects: ['+40 dindarlık'] }; }
            return { beat: 'komşuda', title: 'Komşun Aldı', text: `Aynı sandıklar iki vadi ötede açıldı. Komşunun oğlu artık Rumca yazışıyor.\n\nSeninkinin mührünü hâlâ kâhyan basıyor.`, effects: ['+40 dindarlık', 'Komşunun oğlu okumuş'] };
          },
        },
      ),
    });
  },
},

// --- 23. vassal: two men and one mill ---------------------------------------
{
  id: 'vassal_feud', cat: 'vassal', weightHint: 0.5, cooldown: 5 * YEAR, chance: 0.35,
  valid() {
    const vs = subjects().filter((v) => age(v) > 18);
    if (vs.length < 2) return false;
    const a = pickDay(vs, 14), b = vs.find((x) => x.id !== a.id);
    return a && b ? { a, b } : false;
  },
  fire({ a, b }) {
    offer({
      kind: 'event', title: 'İki Dava, Bir Değirmen', targetId: a.id,
      scene: { provinceIdx: anyProvinceOf(a.id) },
      framing: `Aynı değirmen için divanına iki kişi geldi: ${a.name} ile ${b.name}.`,
      body: `${whoFace(a)}: kâğıdı eski, mührü okunmuyor.\n\n${whoFace(b)}: kâğıdında senin babanın imzası var.\n\n${ticLine(a)} Öteki susuyor ve bekliyor.\n\nSalonda otuz kişi var. Hepsi kimin kazandığına değil, neden kazandığına bakacak.`,
      options: opts(
        {
          key: 'older', label: 'Eski kâğıda hükmet.', detail: 'Kanun eskidir. Eski olan bazen haklıdır.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 120, odds: clampOdds(0.34 + skill(P(), 'stewardship') * 0.028),
          onCommit() { remember(a.id, S.playerId, 'Lehine hükmetti.', +45, 30); remember(b.id, S.playerId, 'Babasının mührünü hiçe saydı.', -50, 40); },
          tells: [{ at: 0.5, text: () => `${b.name} bu ay divana gelmedi.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) { p2.prestige += 50; courtHears('Kanuna göre hükmediyor.', +12, 30);
              return { beat: 'kabullendi', title: 'İkisi de Sustu', text: `${b.name} kâğıdını katladı, cebine koydu ve oturdu.\n\nO kış üç dava daha divanına geldi. Üçü de kâğıtla geldi, kılıçla değil.`, effects: ['+50 itibar', 'Vassalların +12', `<b>${b.name}</b> −50`] }; }
            b.faction = 'discontent';
            return { beat: 'kabullenmedi', title: 'Değirmeni Yaktı', text: `${b.name} kararı dinledi, teşekkür etti, sonra o gece değirmeni yaktı.\n\nKimse kanıtlayamadı. Kimse şaşırmadı da.`, effects: [`<b>${b.name}</b> hoşnutsuz`, 'Değirmen kül'] };
          },
        },
        {
          key: 'seal', label: 'Babanın mührüne uy.', detail: 'Babanın imzasını çiğnersen kendi imzanı da çiğnetirsin.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 120, odds: clampOdds(0.42 + skill(P(), 'diplomacy') * 0.022),
          onCommit() { remember(b.id, S.playerId, 'Lehine hükmetti.', +45, 30); remember(a.id, S.playerId, 'Eski hakkını tanımadı.', -50, 40); },
          tells: [{ at: 0.5, text: () => `${a.name} bu ay vergisini eksik yolladı.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().prestige += 50; courtHears('Babasının mührüne saygı gösteriyor.', +12, 30);
              return { beat: 'boyun eğdi', title: 'Mühür Tuttu', text: `${a.name} kâğıdını masada bıraktı ve almadan çıktı.\n\nMührün ağırlığı arttı. Bunu senden sonra da hatırlayacaklar.`, effects: ['+50 itibar', 'Vassalların +12', `<b>${a.name}</b> −50`] }; }
            a.faction = 'discontent';
            return { beat: 'çekildi', title: 'Adamlarını Çekti', text: `${a.name} değirmeni bıraktı, sonra sınırdaki adamlarını da çekti.\n\nO geçit şimdi bekçisiz. Kim geçerse geçer.`, effects: [`<b>${a.name}</b> hoşnutsuz`, 'Bir geçit bekçisiz'] };
          },
        },
        {
          key: 'take', label: 'Değirmeni sen al.', detail: 'İkisi de kaybeder. Kaybedenler birleşir.',
          cost: [{ kind: STAKE.PRESTIGE, value: 30 }],
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 200, odds: 0.33,
          onCommit() { P().gold += 50; remember(a.id, S.playerId, 'Değirmeni kendine aldı.', -55, 45); remember(b.id, S.playerId, 'Değirmeni kendine aldı.', -55, 45); },
          tells: [{ at: 0.5, text: 'İkisi bu ay aynı gün ava çıkmış. Aynı ormanda.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().dreadBonus = (P().dreadBonus || 0) + 4;
              return { beat: 'sustular', title: 'Değirmen Senin', text: `İkisi de bir daha o kâğıtları açmadı. Bir daha da birbirlerine bakmadılar.\n\nDeğirmen dönüyor. Un sana geliyor.`, effects: ['+50 altın', '+4 dehşet', 'İki vassalın −55'] }; }
            a.faction = 'discontent'; b.faction = 'discontent';
            courtHears('Anlaşmazlığı kendi kesesine çevirdi.', -22, 40);
            return { beat: 'birleştiler', title: 'Aynı Masada Oturuyorlar', text: `Kâğıtlarını unuttular. Sana kızmayı unutmadılar.\n\nİkisi geçen hafta aynı sofrada yemek yedi. Bunu sana söyleyen üç kişi oldu.`, effects: ['İki vassalın birleşti', 'Vassalların −22', '+50 altın'] };
          },
        },
      ),
    });
  },
},

// --- 24. vassal: the tax that did not come ----------------------------------
{
  id: 'tax_default', cat: 'vassal', weightHint: 0.56, cooldown: 5 * YEAR, chance: 0.35,
  valid() {
    const vs = subjects().filter((v) => opinion(v.id, S.playerId) < 20);
    return vs.length ? { v: pickDay(vs, 15) } : false;
  },
  fire({ v }) {
    const son = livingChildren(v).find((k) => age(k) < 16) || livingChildren(v)[0];
    offer({
      kind: 'event', title: 'Gelmeyen Vergi', targetId: v.id,
      scene: { provinceIdx: anyProvinceOf(v.id) },
      framing: `${cap(rank(v))} ${who(v)} bu yıl vergiyi yollamadı, mazeret de yollamadı.`,
      body: `Üçüncü ay. Kâhyan defteri her ay önüne koyuyor, her ay aynı satır boş.\n\nDiğer vassalların bu satırı biliyor. Onların da defteri var.\n\n${v.name} kalesinde. ${faceLine(v)}`,
      options: opts(
        {
          key: 'marshal', label: 'Marşalı yolla.', detail: 'Kırk atlı. Ya vergi gelir ya kavga.',
          cost: [{ kind: STAKE.GOLD, value: 30 }],
          stakes: [{ kind: STAKE.LIFE, who: 'adamlarının' }, { kind: STAKE.REPUTATION }],
          waitDays: 90, odds: clampOdds(0.4 + skill(P(), 'martial') * 0.03),
          tells: [{ at: 0.6, text: () => `${gen(v.name)} kalesinin kapısı kapalıymış. Marşalın dışarıda bekliyor.`, goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().gold += 70; remember(v.id, S.playerId, 'Kapısına atlı yolladı.', -40, 35); courtHears('Vergisini almayı biliyor.', +14, 25);
              return { beat: 'ödedi', title: 'Kapı Açıldı', text: `Dördüncü gün kapıyı açtı ve keseyi kendi eliyle verdi.\n\nDiğer vassalların defterindeki boş satır o hafta doldu.`, effects: ['+70 altın', 'Vassalların +14', `<b>${v.name}</b> −40`] }; }
            v.faction = 'discontent';
            P().prestige -= 70;
            return { beat: 'dönmedi', title: 'Marşalın Eli Boş Döndü', text: `Kapıyı açmadılar. Kuşatacak adamın yoktu, marşalın da bunu biliyordu.\n\nGeri döndü. Yolda üç köyde konakladılar; hesabı sen ödedin.`, effects: ['−70 itibar', `<b>${v.name}</b> ayaklanmaya yakın`, 'Otuz altın gitti'] };
          },
        },
        onlyIf(!!son, {
          key: 'hostage', label: 'Oğlunu iste.',
          detail: son ? `${who(son)}. Sarayında büyür. Sarayında kalır.` : 'Bir rehin. Sarayında büyür.',
          confirm: 'Bir çocuğu rehin almak mı?',
          stakes: [{ kind: STAKE.KIN, who: son ? son.name : 'bir çocuk' }, { kind: STAKE.OATH }],
          waitDays: 150, odds: 0.6,
          onCommit() { if (son) { son.courtOf = S.playerId; son.hostageOf = S.playerId; } remember(v.id, S.playerId, 'Oğlunu rehin aldı.', -65, 60); },
          tells: [{ at: 0.5, text: () => (son ? `${son.name} avluda yalnız oynuyor. Kimse yanına gitmiyor.` : 'Rehin sessiz.'), goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            if (ok) { P().gold += 90;
              return { beat: 'geldi', title: 'Vergi Ertesi Hafta Geldi', text: `Kese eksiksizdi. Yanında bir de mektup vardı; oğlunun sağlığını soruyordu.\n\nÇocuk avluda. Senin oğlunla oynamıyor. Kimse ona oyna demiyor.`, effects: ['+90 altın', son ? `<b>${son.name}</b> sarayında rehin` : 'Rehin sarayında', `<b>${v.name}</b> −65`] }; }
            if (son) kill(son, 'illness');
            v.faction = 'claimant';
            courtHears('Rehin aldığı çocuk onun sarayında öldü.', -35, 60);
            return { beat: 'öldü', title: 'Çocuk Kışı Çıkaramadı', knell: true, text: `Ateşlendi. Üç gün sürdü. Senin hekimin baktı.\n\n${cap(gen(v.name))} cevabı tek satırdı: geliyorum.`, effects: [son ? `<b>${son.name}</b> öldü` : 'Rehin öldü', `<b>${v.name}</b> savaşa hazırlanıyor`, 'Vassalların −35'] };
          },
        }),
        {
          key: 'forgive', label: 'Bu yıla say.', detail: 'Bir yıl bağışlanabilir. İki yıl bir hak olur.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 365, odds: 0.45,
          onCommit() { remember(v.id, S.playerId, 'Vergisini bağışladı.', +35, 25); },
          tells: [{ at: 0.5, text: 'Bu ay bir vassalın daha vergisi eksik geldi.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            if (ok) { P().gold += 40; return { beat: 'iki katı', title: 'Ertesi Yıl İki Katı', text: `Geçen yılın borcunu da yolladı. Yanında bir at, bir de özür.\n\nBazen bir adamı yalnız bırakmak yeter.`, effects: ['+40 altın', `<b>${v.name}</b> +35`] }; }
            courtHears('Ödemeyeni affediyor.', -20, 35);
            return { beat: 'yayıldı', title: 'Defterde Üç Boş Satır', text: `Ertesi yıl üç vassalın vergisi gelmedi. Hiçbiri mazeret yollamadı.\n\nBir kez bağışlanan şey bir daha istenmiyor.`, effects: ['Vassalların −20', 'Gelirin düştü'] };
          },
        },
      ),
    });
  },
},

// --- 25. ihanet: a letter that was not meant for you ------------------------
{
  id: 'letter_intercepted', cat: 'ihanet', weightHint: 0.66, cooldown: 6 * YEAR, chance: 0.3,
  valid() {
    const roles = ['chancellor', 'marshal', 'steward', 'chaplain'];
    const men = roles.map(councilman).filter(Boolean);
    const spy = councilman('spymaster');
    return spy && men.length ? { traitor: pickDay(men, 16), spy } : false;
  },
  fire({ traitor, spy }) {
    const p = P();
    const to = ch(p.liegeId) || ch(S.flags.rivalId);
    offer({
      kind: 'scheme', title: 'Mühürsüz Mektup', targetId: traitor.id,
      scene: { provinceIdx: anyProvinceOf(p.id) },
      framing: `${gen(spy.name)} adamları ${dat(traitor.name)} ait bir mektubu yolda durdurdu.`,
      body: `Mektup ${to ? dat(fullName(to)) : 'sınırın öte yakasına'} gidiyordu. Mührü yok. El yazısı belli.\n\nİçinde senin kaç adam çıkarabileceğin yazıyor. Doğru yazılmış.\n\n${whoFace(traitor)} bu sabah da divandaydı. Sana günaydın dedi.`,
      options: opts(
        {
          key: 'confront', label: 'Yüzüne vur.', detail: 'Divanda, herkesin önünde. Ne diyeceğini bilmiyorsun.',
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 60, odds: clampOdds(0.34 + skill(P(), 'diplomacy') * 0.028),
          onCommit() { remember(traitor.id, S.playerId, 'Mektubu yüzüne vurdu.', -55, 45); },
          tells: [{ at: 0.6, text: () => `${traitor.name} odasından çıkmıyor. Yemek kapıya bırakılıyor.`, goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              traitor.courtOf = null; traitor.liegeId = null;
              if (S.council) for (const k of Object.keys(S.council)) if (S.council[k] === traitor.id) S.council[k] = null;
              p2.prestige += 60;
              return { beat: 'kovdun', title: 'Divandan Çıkarıldı', text: `İnkâr etmedi. Sadece ayağa kalktı, mührünü masaya bıraktı ve çıktı.\n\nO makam boş. Boş makam bir sonraki mektubu yazacak adamın makamı.`, effects: [`<b>${traitor.name}</b> divandan atıldı`, '+60 itibar'] };
            }
            courtHears('Kanıtsız suçlama yaptı.', -25, 40);
            return { beat: 'inkâr', title: 'El Yazısı Kanıt Değil', text: `Kâğıdı aldı, okudu, güldü ve masaya geri koydu. "Benim yazım böyle yazılmaz."\n\nSalon ona inandı. Sana inanmadı.`, effects: ['Vassalların −25', `<b>${traitor.name}</b> hâlâ divanda`] };
          },
        },
        {
          key: 'feed', label: 'Yanlış bilgi ver.',
          detail: 'Konuşsun. Ne söylediğini sen yazacaksın.',
          cost: [{ kind: STAKE.GOLD, value: 40 }],
          stakes: [{ kind: STAKE.SECRET }, { kind: STAKE.OATH }],
          waitDays: 300, odds: clampOdds(0.24 + intrigue() * 0.05),
          onCommit() { S.flags.doubleAgent = traitor.id; },
          tells: [
            { at: 0.35, text: () => `${traitor.name} bu ay iki mektup daha yazdı. İkisini de okudun.`, goodTone: 'good', badTone: 'ambiguous' },
            { at: 0.8, text: 'Mektuplar birden durdu. Sebebini bilmiyorsun.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              if (to) remember(to.id, S.playerId, 'Yanlış bilgiyle kandırıldı.', -20, 25);
              p2.hooks.push({ onId: traitor.id, kind: 'strong', secretId: 'traitor_letters' });
              p2.prestige += 80;
              return { beat: 'yuttular', title: 'Yanlış Sayı', text: `Karşı taraf senin iki katın asker olduğuna inandı ve sınırdan çekildi.\n\n${traitor.name} hâlâ mektup yazıyor. Yazdıklarını sen söylüyorsun.`, effects: [`<b>${traitor.name}</b> senin elinde`, '+80 itibar', 'Komşun yanıldı'] };
            }
            if (to) remember(to.id, S.playerId, 'Onu oyuna getirmeye kalktı.', -50, 45);
            courtHears('Kendi divanında oyun kuruyor.', -18, 35);
            return { beat: 'anladılar', title: 'Oyunu Gördüler', text: `${traitor.name} bir sabah gitmişti. Yanında iki at ve senin gerçek sayıların vardı.\n\nKırk altın da onunla gitti.`, effects: [`<b>${traitor.name}</b> kaçtı`, 'Gerçek sayıların karşıda', 'Kırk altın gitti'] };
          },
        },
        {
          key: 'quiet', label: 'Sessizce boğdur.',
          detail: lens({ honest: 'Bunu yaparsan bir daha kimsenin gözüne bakamazsın.', deceitful: 'Merdiven diktir. Merdivenler böyle şeyler için vardır.' }, 'Bir gece. Bir isim eksilir. Kimse mektup sormaz.'),
          confirm: 'Kendi divan üyeni mi?',
          cost: [{ kind: STAKE.GOLD, value: 60 }],
          stakes: [{ kind: STAKE.LIFE, who: gen(fullName(traitor)) }, { kind: STAKE.SECRET }, { kind: STAKE.SOUL }],
          waitDays: 45, odds: clampOdds(0.46 + intrigue() * 0.032),
          tells: [{ at: 0.6, text: () => `${traitor.name} bu hafta iki kez yemeğine bakıp yemedi.`, goodTone: 'good', badTone: 'bad' }],
          onResolve(d, ok) {
            const p2 = P();
            if (ok) {
              kill(traitor, 'murder', p2.id);
              p2.secrets.push({ id: 'murder_council', kind: 'murder', victimId: traitor.id, day: S.day });
              return { beat: 'öldü', title: 'Merdivende Buldular', knell: true, text: `Boynu kırılmıştı. Merdiven diktir, herkes bilir.\n\nCenazesinde konuştun. İyi konuştun. Bu seni rahatsız etti.`, effects: [`<b>${traitor.name}</b> öldü`, '<b>Sır:</b> onu sen öldürttün', 'Altmış altın gitti'] };
            }
            if (!p2.traits.includes('arbitrary')) p2.traits.push('arbitrary');
            courtHears('Kendi divan üyesini boğdurmaya kalktı.', -45, 60);
            return { beat: 'yakalandı', title: 'Adamın Konuştu', knell: true, text: `Tuttular. Üç gün dayandı, dördüncü gün senin adını verdi.\n\nDivan dağıldı. Kimse mührünü masada bırakmadı; hepsi yanında götürdü.`, effects: ['<b>Keyfî</b> damgası', 'Vassalların −45', 'Divanın sana güvenmiyor'] };
          },
        },
      ),
    });
  },
},
];

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------
// History lives in S so it survives a save. Two guards beyond the per-event
// cooldown: never the same category twice in a row, and never a second event
// while one is still on the table. Weight is diluted by frequency.

const hist = () => (S.flags._events ||= { last: {}, lastCat: null });

export function tryFireEvents(day) {
  if (S.decisions.some((d) => d.state === 'open')) return;   // one at a time, always
  const h = hist();
  const pool = [];
  for (const e of EVENTS) {
    if (e.once && h.last[e.id] != null) continue;
    if (h.last[e.id] != null && day - h.last[e.id] < (e.cooldown || YEAR * 3)) continue;
    let v = null;
    try { v = e.valid?.(); } catch { v = null; }
    if (!v) continue;
    const sameCat = e.cat && e.cat === h.lastCat ? 0.25 : 1;
    pool.push({ e, v, w: (e.weightHint || 0.4) * 10 * sameCat });
  }
  if (!pool.length) return;
  const pick = rng.weighted(pool);
  if (!rng.chance(pick.e.chance ?? 0.5)) return;
  h.last[pick.e.id] = day;
  h.lastCat = pick.e.cat || null;
  try { pick.e.fire(pick.v === true ? {} : pick.v); } catch (err) { console.error('event failed:', pick.e.id, err); }
}

export function resetEventHistory() { S.flags._events = { last: {}, lastCat: null }; }
/** Categories, for tuning and for the critic's coverage check. */
export const EVENT_CATS = [...new Set(EVENTS.map((e) => e.cat).filter(Boolean))];
