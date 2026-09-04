// P02 — the signals that arrive while you wait. They must be honest enough to
// read and unreliable enough to misread.
//
// Authored events carry a few hand-written tells. This module sits on top of
// them and manufactures the rest out of facts the world already knows: who is
// watching for you and how good they are, what you staked, and what kind of
// person your target is. A Paranoid target smells it early. A weak spymaster
// brings you lies with a straight face.
//
// Everything is SEALED at commit time, with the sim's own rng, and stored as
// plain JSON on the decision. The wait is a letter already written; the tells
// are the rumours that overtake it on the road. No draw happens later, so the
// same seed on the same day still gives the same world.

import { S, rng, ch, alive } from '../core/state.js';
import { on, emit } from '../core/bus.js';
import { fullName, age, skill, remember } from './characters.js';


// ------------------------------------------------- Turkish suffixes on names
// A whisper with a broken suffix ("o'in kapısı") kills the whole mood in one
// frame, so every name that takes an ending goes through here. Proper nouns
// take an apostrophe; vowel harmony and final-consonant voicing decide the rest.
const VOW = 'aâeıiîoöuûü';
const VOICELESS = 'pçtkfshş';
function lastVowel(w) {
  const s = String(w || '').toLocaleLowerCase('tr');
  for (let i = s.length - 1; i >= 0; i--) if (VOW.includes(s[i])) return s[i];
  return 'a';
}
function h2(w) { return 'eiöüî'.includes(lastVowel(w)) ? 'e' : 'a'; }
function h4(w) {
  const v = lastVowel(w);
  if (v === 'e' || v === 'i' || v === 'î') return 'i';
  if (v === 'ö' || v === 'ü') return 'ü';
  if (v === 'o' || v === 'u' || v === 'û') return 'u';
  return 'ı';
}
function endsVowel(w) { const s = String(w || '').toLocaleLowerCase('tr'); return VOW.includes(s[s.length - 1]); }
function hardEnd(w) { const s = String(w || '').toLocaleLowerCase('tr'); return VOICELESS.includes(s[s.length - 1]); }

/** Ali'nin / Bitlis'in — possessive. */
export function gen(n) { return n ? `${n}'${endsVowel(n) ? 'n' : ''}${h4(n)}n` : ''; }
/** Ali'ye / Bitlis'e — to. */
export function dat(n) { return n ? `${n}'${endsVowel(n) ? 'y' : ''}${h2(n)}` : ''; }
/** Ali'yi / Bitlis'i — object. */
export function acc(n) { return n ? `${n}'${endsVowel(n) ? 'y' : ''}${h4(n)}` : ''; }
/** Ali'den / Bitlis'ten — from. */
export function abl(n) { return n ? `${n}'${!endsVowel(n) && hardEnd(n) ? 't' : 'd'}${h2(n)}n` : ''; }
/** Ali'de / Bitlis'te — at. */
export function loc(n) { return n ? `${n}'${!endsVowel(n) && hardEnd(n) ? 't' : 'd'}${h2(n)}` : ''; }

let wired = false;

export function initTells() {
  if (wired) return;
  wired = true;
  on('decision:committed', (d) => planTells(d));
  on('decision:tell', (p) => { if (p?.d) recordTell(p.d, { day: S.day, text: p.text, tone: p.tone, honest: p.honest, prog: p.prog }); });
  on('clock:day', (day) => pumpTells(day));
}

// ------------------------------------------------------------------ the ledger
/** Append one sign to a decision's ledger. Plain JSON — it rides along in saves. */
export function recordTell(d, entry) {
  if (!d) return;
  (d.tellLog ||= []).push({
    day: entry.day ?? S.day,
    text: String(entry.text ?? ''),
    tone: entry.tone || 'ambiguous',
    honest: entry.honest === undefined ? null : entry.honest,
    prog: entry.prog ?? null,
  });
  if (d.tellLog.length > 14) d.tellLog.shift();
}
/** Everything you have heard about this decision, oldest first. */
export function tellsOf(d) { return d?.tellLog || []; }
/** The tells an option carries by hand, authored in content/events.js. */
export function tellsFor(decision) {
  return decision?.options?.find?.((o) => o.key === decision.chosen)?.tells || [];
}

// ------------------------------------------------------------------ who watches
/** The pair of eyes you are relying on. Named, because a name can fail you. */
function watcherFor() {
  const spyId = S.council?.spymaster;
  if (spyId && alive(spyId)) return ch(spyId);
  const p = ch(S.playerId);
  if (!p) return null;
  const court = Object.values(S.chars).filter((c) => c.deathDay == null && c.courtOf === p.id && c.id !== p.id && age(c) >= 16);
  if (!court.length) return null;
  return court.reduce((a, b) => (skill(b, 'intrigue') > skill(a, 'intrigue') ? b : a));
}

/**
 * How far the signs can be trusted. Skill raises it; a watchful target and the
 * dark of a scheme lower it. It is capped well short of certainty on purpose —
 * a wait you can solve is not a wait.
 */
export function computeTrust(d) {
  const w = watcherFor();
  const p = ch(S.playerId);
  const eyes = w || p;
  let v = 0.30 + (eyes ? skill(eyes, 'intrigue') : 4) * 0.028;
  if (w && (w.traits || []).includes('schemer')) v += 0.06;
  if (w && (w.traits || []).includes('deceitful')) v -= 0.05;
  if (w && (w.traits || []).includes('honest')) v += 0.04;
  const t = d.targetId ? ch(d.targetId) : null;
  if (t) {
    if ((t.traits || []).includes('paranoid')) v -= 0.09;
    if ((t.traits || []).includes('trusting')) v += 0.07;
    if ((t.traits || []).includes('deceitful')) v -= 0.06;
    if ((t.traits || []).includes('shy')) v -= 0.03;
    if ((t.traits || []).includes('gregarious')) v += 0.05;
  }
  if (d.kind === 'scheme') v -= 0.06;
  return { v: Math.max(0.22, Math.min(0.82, v)), watcherId: w ? w.id : null };
}

export function trustLabel(v) {
  if (v < 0.36) return 'zayıf';
  if (v < 0.50) return 'kırık dökük';
  if (v < 0.63) return 'orta';
  if (v < 0.74) return 'iyi';
  return 'güçlü';
}
/** For the ribbon: who is watching and how much their word is worth. */
export function reliabilityOf(d) {
  if (!d) return null;
  const v = d.tellTrust ?? computeTrust(d).v;
  const w = d.tellWatcherId ? ch(d.tellWatcherId) : null;
  return { v, label: trustLabel(v), name: w ? fullName(w) : null, role: w ? 'gözün' : null };
}

// ------------------------------------------------------------------- the bank
const S_OF = (d) => new Set((d.stakes || []).map((s) => s.kind));

const LINES = {
  life: {
    bad: [
      { f: (x) => `Hekim ikinci kez çağrıldı. Bu sefer koşarak geldi.` },
      { t: 1, f: (x) => `${gen(x.T)} kapısının önünde iki muhafız duruyor. Onları sen koymadın.` },
      { t: 1, f: (x) => `${x.T} bu sabah kalkamadı. Öğleden sonra kalktı, kimseyle konuşmadı.` },
      { f: (x) => `Şafakta bir tabut geçti sokaktan. Kimin olduğunu sormadın.` },
    ],
    good: [
      { t: 1, f: (x) => `${x.T} dün akşam sofraya oturdu. İki lokma yedi, ama oturdu.` },
      { f: (x) => `Ateşin düştüğünü söylüyorlar. Kimse "geçti" demiyor.` },
    ],
    ambiguous: [
      { t: 1, f: (x) => `${gen(x.T)} odasından bütün gece ses gelmedi.` },
      { f: (x) => `Dadı koridorda ağlıyordu. Sorduğunda "yorgunluk" dedi.` },
    ],
  },
  title: {
    bad: [{ f: (x) => `Kâtip tapuyu üç kez temize çekti. Üçünde de eli titredi.` },
          { p: 1, f: (x) => `${gen(x.P)} yolundaki sınır taşlarından biri gece yerinden oynamış. Kimse görmemiş.` }],
    good: [{ t: 1, f: (x) => `${gen(x.T)} adamları sınır taşlarına dokunmamış. Demek ki kabul ediyorlar.` },
           { f: (x) => `Kâhyan defteri kapattı ve "tamamdır" dedi. Başka bir şey demedi.` }],
    ambiguous: [{ f: (x) => `Tapunun mührü kurudu. Kimse yüksek sesle okumak istemedi.` }],
  },
  oath: {
    bad: [{ f: (x) => `Yemin ettiğin gün orada olan üç kişiden ikisi artık gözüne bakmıyor.` },
          { f: (x) => `Kadı seni sordu. Ne istediğini söylemedi.` }],
    good: [{ f: (x) => `Bu ay kimse eski yemini anmadı. Anmamak da bir çeşit af.` }],
    ambiguous: [{ f: (x) => `Divanda birisi "söz" kelimesini kullandı ve sustu.` }],
  },
  secret: {
    bad: [{ f: (x) => `Aşçı çırağı iki gün ortalıkta yoktu. Döndüğünde yeni bir yeleği vardı.` },
          { f: (x) => `Bir uşak sana uzun uzun baktı, sonra fazla derin bir selam verdi.` }],
    good: [{ f: (x) => `${x.W || 'Adamın'} soruşturmuş: kimse bir şey bilmiyor. Kimse.` }],
    ambiguous: [{ f: (x) => `Mutfakta bir tabak kırıldı ve konuşma kesildi. Sen girince yeniden başladı.` }],
  },
  soul: {
    bad: [{ f: (x) => `Bu haftaki vaaz günahtan uzun sürdü. Sana bakmadı; bakmaması daha kötüydü.` },
          { f: (x) => `Gece uyanıp ne yaptığını hatırladın. Sabaha kadar bir daha uyuyamadın.` }],
    good: [{ f: (x) => `Dua ederken içine bir hafiflik oturdu. Bunu kimseye söylemedin.` }],
    ambiguous: [{ f: (x) => `Rüyanda bir kapı vardı. Açılmadı.` }],
  },
  gold: {
    bad: [{ p: 1, f: (x) => `${dat(x.P)} giden kervan yarı yoldan döndü. Yolları kar kapamış — ya da kapatmışlar.` },
          { f: (x) => `Tefeci senden haber sordu. Alacağı yok. Yine de sordu.` }],
    good: [{ f: (x) => `Kâhyan kesenin dibini gösterdi ve gülümsedi. İlk defa.` }],
    ambiguous: [{ f: (x) => `Hesap iki kez tutmadı, üçüncüde tuttu. Kâhyan bunu anlatmadı.` }],
  },
  reputation: {
    bad: [{ f: (x) => `Divanda iki sandalye boş kaldı. Sebebini söyleyen olmadı.` },
          { f: (x) => `Pazarda adın geçiyormuş. Nasıl geçtiğini söyleyen çıkmadı.` }],
    good: [{ f: (x) => `Bu ay kimse senden bir şey istemedi. Bunu iyiye yorabilirsin.` }],
    ambiguous: [{ f: (x) => `Bir ozan yeni bir şarkı söylüyormuş. Sözlerini kimse tekrar etmedi.` }],
  },
  none: {
    bad: [{ f: (x) => `Beklediğin haberci gelmedi. Yerine yağmur geldi.` },
          { p: 1, f: (x) => `${abl(x.P)} gelen adam çamur içindeydi ve konuşmadan geçip gitti.` }],
    good: [{ f: (x) => `İlk haberci güler yüzlüydü. Bir şey söylemedi, ama güler yüzlüydü.` }],
    ambiguous: [{ f: (x) => `Gece bir at dörtnala geçti. Sabah kimse öyle bir at görmediğini söyledi.` },
                { f: (x) => `Sessizlik uzadı. Sessizlik bir şey anlatmaz, ama insanı yer.` }],
  },
};

// What the target's own nature leaks, whatever you staked.
const TRAIT_LEAKS = {
  paranoid:  (x) => `${x.T} yemeğini artık kendi adamına tattırıyor.`,
  craven:    (x) => `${x.T} ailesini kayınlarına yollamış. Kendisi kalmış.`,
  brave:     (x) => `${x.T} kapısını kilitlemiyor. Ya bilmiyor, ya umursamıyor.`,
  wrathful:  (x) => `${x.T} dün gece bir seyisi kırbaçlattı. Sebep söylemedi.`,
  vengeful:  (x) => `${x.T} eski bir defter açtırmış. İçinde senin adın da varmış.`,
  deceitful: (x) => `${x.T} herkese ayrı bir şey söylüyor. Hangisinin doğru olduğunu kimse bilmiyor.`,
  honest:    (x) => `${x.T} olan biteni olduğu gibi anlatmış. Bu bile aleyhine işleyebilir.`,
  zealous:   (x) => `${x.T} üç gündür ibadetten çıkmıyor.`,
  ambitious: (x) => `${x.T} yeni bir mühür kazdırmış. Henüz kullanmamış.`,
  frail:     (x) => `${x.T} merdiveni tek başına çıkamamış.`,
  ill:       (x) => `${gen(x.T)} öksürüğü duvarın öbür tarafından duyuluyor.`,
  arrogant:  (x) => `${x.T} senin haberciyi ayakta bekletmiş.`,
  patient:   (x) => `${x.T} hiçbir şey yapmıyor. Bekleyen bir adam, bekleyen bir adamı tanır.`,
};

function bankFor(d) {
  const k = S_OF(d);
  if (k.has('kin') || k.has('life')) return LINES.life;
  if (k.has('secret')) return LINES.secret;
  if (k.has('soul')) return LINES.soul;
  if (k.has('oath')) return LINES.oath;
  if (k.has('title')) return LINES.title;
  if (k.has('gold')) return LINES.gold;
  if (k.has('reputation')) return LINES.reputation;
  return LINES.none;
}

// ------------------------------------------------------------------- planning
const SLOTS = [0.14, 0.28, 0.42, 0.56, 0.70, 0.84, 0.93];

/** Seal this decision's signs the moment the price is paid. */
export function planTells(d) {
  if (!d || d.state !== 'pending' || d.autoTells) return;
  const span = Math.max(1, d.resolveDay - d.committedDay);
  const { v, watcherId } = computeTrust(d);
  d.tellTrust = +v.toFixed(3);
  d.tellWatcherId = watcherId;

  const t = d.targetId ? ch(d.targetId) : null;
  const w = watcherId ? ch(watcherId) : null;
  const ctx = { T: t ? (t.name || fullName(t)) : null, TF: t ? fullName(t) : null, W: w ? w.name : null, P: placeOf(d) };

  // Never crowd the hand-written ones.
  const authored = (tellsFor(d) || []).map((x, i) => x.at ?? (i + 1) / ((tellsFor(d) || []).length + 1));
  const free = SLOTS.filter((s) => !authored.some((a) => Math.abs(a - s) < 0.09));

  let n = 2;
  if (d.weight > 0.5) n++;
  if (span > 180) n++;
  if (span < 30) n = Math.min(n, 2);
  n = Math.max(0, Math.min(n, 5 - authored.length, free.length));

  const chosen = rng.shuffle(free).slice(0, n).sort((a, b) => a - b);
  const bank = bankFor(d);
  const out = [];

  // A watchful target notices before anyone reports anything. This is the one
  // sign that does not lie — it just does not tell you which way it will fall.
  if (t && (t.traits || []).includes('paranoid') && span >= 20) {
    out.push({
      at: 0.16, day: d.committedDay + Math.max(1, Math.round(span * 0.16)),
      text: TRAIT_LEAKS.paranoid(ctx), tone: 'ambiguous', honest: true, kind: 'suspicion', fired: false,
    });
  }

  for (const [i, at] of chosen.entries()) {
    const honest = rng.chance(v);
    let tone;
    if (honest) tone = d.willSucceed ? 'good' : 'bad';
    else if (rng.chance(0.28)) tone = 'ambiguous';
    else tone = d.willSucceed ? 'bad' : 'good';

    // Roughly a third of the signs are the target's own nature showing through.
    let text = null;
    if (t && rng.chance(0.34)) {
      const leaks = (t.traits || []).filter((k) => TRAIT_LEAKS[k] && k !== 'paranoid');
      if (leaks.length) { text = TRAIT_LEAKS[rng.pick(leaks)](ctx); tone = 'ambiguous'; }
    }
    if (!text) {
      const pool = usable(bank[tone] || bank.ambiguous, ctx);
      text = (pool.length ? rng.pick(pool) : rng.pick(usable(LINES.none.ambiguous, ctx))).f(ctx);
    }
    if (i === 0 && ctx.W && rng.chance(0.6)) text = `${abl(ctx.W)} haber: ${lower(text)}`;

    out.push({ at, day: d.committedDay + Math.max(1, Math.round(span * at)), text, tone, honest, kind: 'auto', fired: false });
  }

  d.autoTells = out.sort((a, b) => a.day - b.day);
}

function lower(s) { return s.charAt(0).toLocaleLowerCase('tr') + s.slice(1); }
/** Only offer a line if the world can fill in the names it asks for. */
function usable(pool, ctx) { return (pool || []).filter((l) => (!l.t || ctx.T) && (!l.p || ctx.P)); }
/** A place to hang a rumour on: where the decision is happening, else your seat. */
function placeOf(d) {
  const idx = d.scene?.provinceIdx;
  const metas = S.mapMeta?.provinces || [];
  const id = idx != null && metas[idx] ? metas[idx].id : null;
  if (id && S.provinces[id]) return S.provinces[id].name;
  const mine = Object.values(S.titles).find((x) => x.holderId === S.playerId && x.provinceId);
  return mine && S.provinces[mine.provinceId] ? S.provinces[mine.provinceId].name : null;
}

// --------------------------------------------------------------------- firing
/**
 * Fire everything that has come due. Idempotent and rng-free, so it is safe to
 * call from the day tick, from a UI poll, or from both.
 */
export function pumpTells(day = S.day) {
  for (const d of S.decisions) {
    if (d.state !== 'pending' || !d.autoTells) continue;
    for (const t of d.autoTells) {
      if (t.fired || day < t.day) continue;
      t.fired = true;
      const span = Math.max(1, d.resolveDay - d.committedDay);
      emit('decision:tell', { d, text: t.text, tone: t.tone, prog: (day - d.committedDay) / span, honest: t.honest, source: 'auto' });
      S.chronicle.push({ day, kind: 'tell', text: t.text, tone: t.tone, decisionId: d.id });
      // A target who smells it starts holding it against you, before anything
      // has even happened.
      if (t.kind === 'suspicion' && d.targetId && alive(d.targetId) && !d._suspicionLogged) {
        d._suspicionLogged = true;
        remember(d.targetId, S.playerId, 'Bir şeylerin döndüğünü sezdi.', -8, 12);
      }
    }
  }
}
