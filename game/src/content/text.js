// ===========================================================================
// P19 — THE WRITING
// ---------------------------------------------------------------------------
// This file is the style guide in executable form. Three jobs:
//
//   1. Turkish morphology. A name is not a token you can glue a suffix onto.
//      "Sökmen'e" but "Artuk'a"; "Konya'da" but "Bitlis'te". Getting this wrong
//      once tells the player a machine wrote the sentence, and after that no
//      amount of atmosphere brings them back.
//   2. Concrete detail on demand. Every person must arrive with a face, an age
//      in words, and a tic — because you cannot mourn an abstraction.
//   3. The rules, checkable. lintProse/lintLabel/lintBeat encode what this game
//      refuses to print: abstractions, long sentences, numbers in prose,
//      melodrama, the formal "siz". An event that fails them gets rewritten.
//
// Style, in one paragraph: second person singular. Short sentences; split the
// long one. Say what is in the room, not what it means. Never give the player a
// number in prose — numbers live in `effects`. The heaviest moment gets the
// plainest sentence.
// ===========================================================================

import { S, ch } from '../core/state.js';
import { seasonOf } from '../core/date.js';
import { fullName, age, relation } from '../sim/characters.js';

// ---------------------------------------------------------------------------
// 1. MORPHOLOGY
// ---------------------------------------------------------------------------
const VOWELS = 'aeıioöuü';
const BACK = 'aıou';
const ROUND = 'ouöü';
const HARD = 'fstkçşhp';           // voiceless: forces d -> t

const TR_LOWER = { 'I': 'ı', 'İ': 'i' };
function low(s) { return String(s).replace(/[Iİ]/g, (m) => TR_LOWER[m]).toLowerCase(); }

/** Last vowel of a word, or 'e' if it somehow has none. */
function lastVowel(w) {
  const s = low(w);
  for (let i = s.length - 1; i >= 0; i--) if (VOWELS.includes(s[i])) return s[i];
  return 'e';
}
function lastLetter(w) { const s = low(w).replace(/[^a-zçğıöşü]/g, ''); return s[s.length - 1] || 'a'; }
function endsInVowel(w) { return VOWELS.includes(lastLetter(w)); }
function isHard(w) { return HARD.includes(lastLetter(w)); }

/** Two-way harmony: -a / -e */
function A(w) { return BACK.includes(lastVowel(w)) ? 'a' : 'e'; }
/** Four-way harmony: -ı / -i / -u / -ü */
function I(w) {
  const v = lastVowel(w);
  const back = BACK.includes(v), round = ROUND.includes(v);
  return back ? (round ? 'u' : 'ı') : (round ? 'ü' : 'i');
}

// A name that already carries the third-person possessive takes the pronominal
// -n- before any case suffix: Selçukoğulları'NA, not Selçukoğulları'ya. Half the
// dynasties in this game are shaped that way, so the wrong buffer would be on
// screen every other sentence.
function possessive(w) {
  const t = low(w);
  return /oğulları$/.test(t) || (t.length >= 10 && /(ları|leri)$/.test(t));
}

// Proper nouns take an apostrophe before the case suffix, which is also what
// saves us from having to model consonant softening (Mesud'u, not Mesudu).
export function dat(n) { return possessive(n) ? `${n}'n${A(n)}` : `${n}'${endsInVowel(n) ? 'y' : ''}${A(n)}`; }
export function acc(n) { return possessive(n) ? `${n}'n${I(n)}` : `${n}'${endsInVowel(n) ? 'y' : ''}${I(n)}`; }
export function gen(n) { return `${n}'${endsInVowel(n) ? 'n' : ''}${I(n)}n`; }       // -in (of)
export function loc(n) { return possessive(n) ? `${n}'nd${A(n)}` : `${n}'${isHard(n) ? 't' : 'd'}${A(n)}`; }
export function abl(n) { return possessive(n) ? `${n}'nd${A(n)}n` : `${n}'${isHard(n) ? 't' : 'd'}${A(n)}n`; }
export function ins(n) { return `${n}'${endsInVowel(n) ? 'y' : ''}l${A(n)}`; }        // -le (with)

// Common nouns, unlike proper nouns, soften their final stop before a vowel:
// mescit -> mescidi, kitap -> kitabı, toprak -> toprağı. Single-syllable words
// do not (at -> atı), so count the vowels before touching the stem.
const SOFTEN = { p: 'b', 'ç': 'c', t: 'd', k: 'ğ' };
// A short closed list of nouns that drop their second vowel before a suffix:
// oğul -> oğlu, burun -> burnu, şehir -> şehri. There is no rule for these, only
// a list, and a game that writes "oğulu" once has lost the reader.
const DROP = {
  'oğul': 'oğl', 'burun': 'burn', 'ağız': 'ağz', 'karın': 'karn', 'boyun': 'boyn',
  'göğüs': 'göğs', 'akıl': 'akl', 'şehir': 'şehr', 'isim': 'ism', 'resim': 'resm',
  'nehir': 'nehr', 'fikir': 'fikr', 'omuz': 'omz', 'beyin': 'beyn',
};
function stem(w) { return DROP[low(w)] || null; }
function soften(w) {
  const t = low(w);
  const syll = (t.match(/[aeıioöuü]/g) || []).length;
  const last = t[t.length - 1];
  if (syll < 2 || !SOFTEN[last]) return w;
  return w.slice(0, -1) + SOFTEN[last];
}

/** Common-noun (no apostrophe) variants, for words like "kardeş", "mescit". */
const base = (w) => stem(w) || (endsInVowel(w) ? w : soften(w));
export function datL(w) { return `${base(w)}${endsInVowel(w) ? 'y' : ''}${A(w)}`; }
export function accL(w) { return `${base(w)}${endsInVowel(w) ? 'y' : ''}${I(w)}`; }
export function genL(w) { return `${base(w)}${endsInVowel(w) ? 'n' : ''}${I(w)}n`; }
export function locL(w) { return `${w}${isHard(w) ? 't' : 'd'}${A(w)}`; }
export function plural(w) { return `${w}l${A(w)}r`; }

/** Lower-case the first letter, for a phrase that lands mid-sentence. */
export function uncap(s) {
  const t = String(s ?? '');
  if (!t) return t;
  const f = t[0] === 'İ' ? 'i' : t[0] === 'I' ? 'ı' : t[0].toLowerCase();
  return f + t.slice(1);
}

/** Turkish-correct capitalisation of the first letter. */
export function cap(s) {
  const t = String(s ?? '');
  if (!t) return t;
  const f = t[0] === 'i' ? 'İ' : t[0] === 'ı' ? 'I' : t[0].toUpperCase();
  return f + t.slice(1);
}

const ONES = ['', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
/** Numbers as words. Prose never prints digits; digits are for `effects`. */
export function spell(n) {
  n = Math.round(n);
  if (n < 0 || n > 99) return String(n);
  if (n === 0) return 'sıfır';
  return [TENS[(n / 10) | 0], ONES[n % 10]].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// 2. PEOPLE — a face, an age, a tic
// ---------------------------------------------------------------------------
// Everything here is derived from faceSeed, so the same man has the same broken
// nose in every event, in every session, forever. Consistency is what turns a
// description into a person.

const TAGS = [
  'çukur gözlü', 'ince dudaklı', 'kırık burunlu', 'geniş alınlı', 'çopur yüzlü',
  'çıkık elmacıklı', 'ağır göz kapaklı', 'kalın kaşlı', 'kısık gözlü', 'yanık tenli',
  'köşeli çeneli', 'uzun boyunlu', 'seyrek kaşlı', 'dar omuzlu', 'kalın parmaklı',
  'düşük dudaklı',
];
const MARKS = [
  'Sol kaşı ikiye bölünmüş.',
  'Bir gözü ötekinden küçük.',
  'Boynunda eski bir yanık izi var.',
  'Ön dişlerinden biri yok.',
  'Elleri titriyor. Yaşından değil.',
  'Sesi kısık. Bağırmayı beceremiyor.',
  'Yürürken sol ayağını sürüyor.',
  'Parmakları mürekkep lekeli.',
  'Sağ kulağının yarısı yok.',
  'Kaşının üstünde at nalı biçiminde bir iz var.',
  'Bileğinde kurumuş bir kesik duruyor.',
  'Kışın öksürüyor. Yazın da öksürüyor.',
];
const TICS = [
  'Konuşurken kemer tokasını çeviriyor.',
  'Sana bakmadan konuşuyor.',
  'Her cümlenin sonunda susup bekliyor.',
  'Ellerini arkasında tutuyor.',
  'Cümlenin ortasında kapıya bakıyor.',
  'Fazla yüksek sesle gülüyor.',
  'Adını söylerken sesi düşüyor.',
  'Yüzüğünü çıkarıp takıyor.',
];

function seedOf(c) { return Math.abs((c?.faceSeed ?? 0) | 0); }
function pickFor(c, arr, salt = 0) { return arr[(seedOf(c) + salt * 7919) % arr.length]; }

/** "çukur gözlü" — stable adjective phrase for this exact person. */
export function faceTag(c) {
  if (!c) return '';
  if ((c.traits || []).includes('scarred')) return 'yanağı yarık';
  if ((c.traits || []).includes('pox')) return 'çiçek bozuğu';
  const a = age(c);
  if (a >= 62) return c.sex === 'f' ? 'ak saçlı' : 'ak sakallı';
  return pickFor(c, TAGS);
}
/** A whole sentence you can drop into a body paragraph. */
export function faceLine(c) { return c ? pickFor(c, MARKS, 1) : ''; }
/** What their body does while they talk. */
export function ticLine(c) { return c ? pickFor(c, TICS, 2) : ''; }

/** "kırk bir yaşındaki Sökmen Danişmendliler" */
export function who(c) { return c ? `${spell(age(c))} yaşındaki ${fullName(c)}` : 'biri'; }
/** "Çukur gözlü, kırk bir yaşındaki Sökmen Danişmendliler" */
export function whoFace(c) { return c ? `${cap(faceTag(c))}, ${spell(age(c))} yaşındaki ${fullName(c)}` : 'Biri'; }
/** Short form for repeat mentions inside the same scene. */
export function him(c) { return c ? c.name : 'o'; }

/** Grammatical sex matters: calling a woman "adam" ends the illusion instantly. */
export function manWord(c) { return c?.sex === 'f' ? 'kadın' : 'adam'; }
export function sexed(c, male, female) { return c?.sex === 'f' ? female : male; }

/** What this person is *to you*: "kardeşin", "kızın", "vassalın". */
export function kinWord(c) {
  if (!c || !S.playerId) return null;
  switch (relation(S.playerId, c.id)) {
    case 'evlat': return c.sex === 'f' ? 'kızın' : 'oğlun';
    case 'ebeveyn': return c.sex === 'f' ? 'annen' : 'baban';
    case 'kardeş': return c.sex === 'f' ? 'kız kardeşin' : 'kardeşin';
    case 'eş': return c.sex === 'f' ? 'karın' : 'kocan';
    case 'hanedan': return 'hanedanından biri';
    case 'vassal': return 'vassalın';
    case 'efendi': return 'efendin';
    default: return null;
  }
}
/** "kardeşin Sökmen" when the tie exists, otherwise just the man. */
export function tied(c) {
  const k = kinWord(c);
  return k ? `${k} ${c.name}` : who(c);
}

// ---------------------------------------------------------------------------
// 3. THE ROOM — weather, hour, sound
// ---------------------------------------------------------------------------
// Deterministic from the day, so the same scene on the same date always smells
// the same. A scene without weather is a menu.

const WEATHER = {
  winter: ['Avlunun taşları buz tutmuş.', 'Kar, ahırın damına yığıldı.', 'Nefesin görünüyor.', 'Testideki su gece çatlattı testiyi.'],
  spring: ['Çamur diz boyu. Atlar zor yürüyor.', 'Dam altındaki kırlangıçlar döndü.', 'Sabah ayazı öğlene kadar sürüyor.', 'Kapı önünde yeni ot bitmiş.'],
  summer: ['Taşlar öğlene kadar el yakıyor.', 'Sinekler kilerden çıkmıyor.', 'Kuyunun suyu iki karış çekildi.', 'Toz her şeye siniyor.'],
  autumn: ['Yağmur üç gündür dinmedi.', 'Ambar kapıları kilitli.', 'Sis öğlene kadar kalkmıyor.', 'Yolda arpa arabaları var.'],
};
export function weatherLine(day = S.day) {
  const a = WEATHER[seasonOf(day)] || WEATHER.autumn;
  return a[Math.abs(Math.floor(day / 9)) % a.length];
}
const HOURS = [
  'Sabah namazı okunmadı daha.', 'Öğle sıcağı. Salon boş.', 'Akşam. Mumları yeni yaktılar.',
  'Gece yarısını geçti. Kimse uyumuyor.',
];
export function hourLine(day = S.day) { return HOURS[Math.abs(Math.floor(day / 5)) % HOURS.length]; }

// ---------------------------------------------------------------------------
// 4. CHARACTER-DEPENDENT PROSE
// ---------------------------------------------------------------------------
export function has(c, t) { return !!c && (c.traits || []).includes(t); }
/** First matching trait wins, so author the map in priority order. */
export function byTrait(c, map, fallback = '') {
  for (const k of Object.keys(map)) if (has(c, k)) { const v = map[k]; return typeof v === 'function' ? v(c) : v; }
  return typeof fallback === 'function' ? fallback(c) : fallback;
}
/** Same, but about the player — the sentence the game says only to you. */
export function lens(map, fallback = '') { return byTrait(ch(S.playerId), map, fallback); }
/** An option that only exists for a certain kind of ruler. */
export function onlyIf(cond, opt) { return cond ? opt : null; }
/** Assemble an options array with the nulls dropped. */
export function opts(...list) { return list.flat().filter(Boolean); }

// ---------------------------------------------------------------------------
// 5. THE RULES, CHECKABLE
// ---------------------------------------------------------------------------
// Run over every string this game prints. If a rule is worth stating in a style
// guide it is worth failing a build over.

/** Game-speak. Says what a thing means instead of what it is. */
const ABSTRACT = [
  'memnun değil', 'memnuniyet', 'motivasyon', 'moral', 'olumsuz', 'olumlu',
  'etkile', 'sağlıyor', 'sağlar', 'artırır', 'azaltır', 'seviyesi', 'oranı',
  'puanı', 'değeri', 'açısından', 'bakımından', 'oldukça', 'son derece',
  'bir şekilde', 'durumu', 'süreci', 'ilişkileri', 'gerçekleştir',
];
/** Melodrama. The heaviest moment gets the plainest sentence. */
const PURPLE = ['sonsuza', 'gözyaşları', 'paramparça', 'çaresizce', 'derinden', 'yürek burkan', 'kaderin cilvesi'];
/** The formal "siz". This game says "sen". Speech inside quotes is exempt. */
const FORMAL = /\b\w+(sınız|siniz|sunuz|sünüz|sanız|seniz)\b/;

const stripQuotes = (s) => String(s).replace(/[""«»"][^""«»"]*[""«»"]/g, ' ');
const sentences = (s) => String(s).split(/[.!?…]+/).map((x) => x.trim()).filter(Boolean);

export const STYLE = { maxWords: 16, maxLabelWords: 5, maxBeatWords: 3 };

/** @returns {string[]} one complaint per broken rule; empty means it passes. */
export function lintProse(s, where = '') {
  const out = [];
  const raw = String(s ?? '');
  if (!raw.trim()) return out;
  const bare = stripQuotes(raw);
  const tag = where ? `${where}: ` : '';
  for (const w of ABSTRACT) if (low(bare).includes(w)) out.push(`${tag}soyut ifade "${w}"`);
  for (const w of PURPLE) if (low(bare).includes(w)) out.push(`${tag}melodram "${w}"`);
  if (FORMAL.test(low(bare))) out.push(`${tag}resmî "siz" kipi`);
  if (raw.includes('!')) out.push(`${tag}ünlem işareti`);
  const digits = bare.replace(/\b1[01]\d\d\b/g, '');          // years are allowed
  if (/\d/.test(digits)) out.push(`${tag}metinde rakam — sayı effects'e ait`);
  for (const sent of sentences(bare)) {
    const n = sent.split(/\s+/).length;
    if (n > STYLE.maxWords) out.push(`${tag}uzun cümle (${n} kelime): "${sent.slice(0, 48)}…"`);
  }
  // Case endings are checked on the raw string: a broken suffix inside a line of
  // dialogue is just as loud as one in narration.
  out.push(...lintSuffix(raw, where));
  return out;
}

/**
 * Every apostrophe-suffix this stem can legally take. Used to catch the one
 * failure that destroys a scene faster than anything else: a name with the
 * wrong ending. "Sökmen'a" or "o'in" tells the reader a machine is talking.
 */
function suffixSet(w) {
  const out = new Set();
  for (const f of [dat, acc, gen, loc, abl, ins]) {
    const t = f(w);
    const i = t.lastIndexOf("'");
    if (i >= 0) out.add(low(t.slice(i + 1)));
  }
  return out;
}
const SUFFIX_RE = /([A-Za-zÇĞİÖŞÜçğıöşü]+)'([a-zçğıöşü]{1,6})(?![A-Za-zÇĞİÖŞÜçğıöşü])/g;

/** @returns {string[]} one complaint per broken case ending. */
export function lintSuffix(s, where = '') {
  const out = [];
  const raw = String(s ?? '');
  for (const m of raw.matchAll(SUFFIX_RE)) {
    const stem = m[1], suf = low(m[2]);
    const set = suffixSet(stem);
    let ok = false;
    for (const v of set) if (suf === v || suf.startsWith(v)) { ok = true; break; }
    if (!ok) out.push(`${where ? where + ': ' : ''}bozuk çekim "${stem}'${m[2]}" — beklenen: ${[...set].join(', ')}`);
  }
  return out;
}

/**
 * Two options in one event must never show the same chance. If they do, the
 * number stops being information and becomes decoration.
 */
export function lintOdds(options, where = '') {
  const seen = new Map();
  const out = [];
  for (const o of options || []) {
    if (o.odds == null || o.disabled) continue;
    const pct = Math.round(o.odds * 100);
    if (seen.has(pct)) out.push(`${where ? where + ': ' : ''}aynı ihtimal %${pct} — "${seen.get(pct)}" ve "${o.label}"`);
    seen.set(pct, o.label);
  }
  return out;
}

/** Option labels: imperative, short, full stop. "Ambarları aç." */
export function lintLabel(s, where = '') {
  const out = [];
  const t = String(s ?? '').trim();
  if (!t) return ['boş etiket'];
  const tag = where ? `${where}: ` : '';
  if (t.split(/\s+/).length > STYLE.maxLabelWords) out.push(`${tag}etiket uzun: "${t}"`);
  if (!/[.?]$/.test(t)) out.push(`${tag}etiket noktayla bitmeli: "${t}"`);
  if (t[0] !== cap(t[0])) out.push(`${tag}etiket büyük harfle başlamalı: "${t}"`);
  return out;
}

/** Beats: one to three words, lower case. "geç kaldın" */
export function lintBeat(s, where = '') {
  const out = [];
  const t = String(s ?? '').trim();
  const tag = where ? `${where}: ` : '';
  if (!t) return [`${tag}boş beat`];
  if (t.split(/\s+/).length > STYLE.maxBeatWords) out.push(`${tag}beat uzun: "${t}"`);
  if (t !== low(t)) out.push(`${tag}beat küçük harf olmalı: "${t}"`);
  if (/[.!?]/.test(t)) out.push(`${tag}beat noktalama almaz: "${t}"`);
  return out;
}

/** Framings set a scene in exactly one sentence. */
export function lintFraming(s, where = '') {
  const out = lintProse(s, where);
  if (sentences(stripQuotes(s)).length > 1) out.push(`${where}: framing tek cümle olmalı`);
  return out;
}
