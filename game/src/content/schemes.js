// ===========================================================================
// P06 — ENTRIKA: the scheme catalogue.
// ---------------------------------------------------------------------------
// A scheme is not an action with a cooldown. It is a promise you make to
// yourself in a dark room, that then takes a year to keep, that other people
// have to help you keep, and that any one of them can end with a sentence.
//
// Every type below must differ in FOUR axes, or it is not a separate scheme:
//   skill    — which of your five numbers actually carries it
//   days     — how long you have to live with it
//   heat     — how fast the secret leaks per day
//   roles    — who you have to ask, and therefore who can betray you
//
// All player-facing text is Turkish, second person. Code comments are English.
// ===========================================================================

import { S, ch, ti, pv, rng } from '../core/state.js';
import { fullName, age, skill, opinion, remember, kill, isKin, relation } from '../sim/characters.js';
import { vassalsOf, directCountiesOf, primaryTitle, titleName, topLiege, TIER } from '../sim/realm.js';
import { YEAR } from '../core/date.js';

const P = () => ch(S.playerId);
const nameOf = (id) => fullName(ch(id));

/** Push a durable, dated line into the world's ledger. P04 can pull these back. */
function mark(sc, text, weight, extra = {}) {
  S.memories.push({
    id: `m_${sc.id}_${S.day}`, day: S.day, kind: 'scheme', schemeId: sc.id,
    title: extra.title || text, text, weight,
    targetId: sc.targetId, ownerId: sc.ownerId,
    success: !!extra.success, irreversible: extra.irreversible !== false, recalls: 0,
  });
}

/** Everyone who serves you learns something today. */
function courtRemembers(ownerId, text, delta, life = 40) {
  for (const v of vassalsOf(ownerId)) remember(v.id, ownerId, text, delta, life);
  for (const c of Object.values(S.chars)) {
    if (c.deathDay == null && c.courtOf === ownerId) remember(c.id, ownerId, text, delta, life);
  }
}

function giveHook(ownerId, targetId, kind, label) {
  const o = ch(ownerId);
  if (!o) return;
  (o.hooks ||= []).push({ onId: targetId, kind, label, day: S.day });
}
function giveSecret(ownerId, kind, label, aboutId) {
  const o = ch(ownerId);
  if (!o) return;
  (o.secrets ||= []).push({ id: `s_${kind}_${S.day}`, kind, label, aboutId, day: S.day });
}

// ---------------------------------------------------------------------------
// The catalogue.
// ---------------------------------------------------------------------------
export const SCHEME_TYPES = [

// --- 1. MURDER -------------------------------------------------------------
{
  id: 'murder',
  name: 'Suikast',
  kicker: 'bir insanın son sabahı',
  icon: '☠',
  skill: 'intrigue',
  days: 430,
  gold: 90,
  heat: 0.155,
  base: 0.16,
  danger: 1.0,                      // how frightening it is to be asked
  lethal: true,
  blurb: 'Bir yıl sürer. Kimseye söyleyemezsin. Ve tuttuğun her adam bir tanık olur.',
  targetHint: 'Ölmesini istediğin kim?',
  can: (t) => t.id !== S.playerId,
  roles: [
    { id:'cook',   name:'Aşçı',      skill:'intrigue', succ:0.20, heat:0.9, hint:'Tabağa en yakın el. En büyük fayda, en büyük tanık.' },
    { id:'leech',  name:'Zehirci',   skill:'learning', succ:0.16, heat:0.5, hint:'Karışımı o hazırlar. Adını sormazsın.' },
    { id:'guard',  name:'Muhafız',   skill:'martial',  succ:0.12, heat:0.6, hint:'Kapıyı o kapatır, koridoru o boşaltır.' },
  ],
  signs: [
    { at:0.16, tone:'ambiguous', text:(sc,t)=>`Zehirci geldi. Yüzünü görmedin — kapının ardından konuştu, parayı saydı, gitti.` },
    { at:0.34, tone:'lean',      good:(sc,t)=>`${t.name} bu ay iki gece kalede kaldı. Alışkanlıkları düzene giriyor.`,
                                 bad:(sc,t)=>`${t.name} yemeğini iki kez değiştirdi. Tesadüf olabilir. Olmayabilir.` },
    { at:0.56, tone:'ambiguous', text:(sc,t)=>`Aşçının karısı köyden şehre taşındı. Parayı nereden buldu, kimse sormuyor.` },
    { at:0.74, tone:'lean',      good:(sc,t)=>`${t.name}'in tadımcısı geçen hafta işi bıraktı. Yerine kimse alınmadı.`,
                                 bad:(sc,t)=>`${t.name}'in yanında yeni bir adam var. Yemekten önce her tabağa parmağını batırıyor.` },
    { at:0.90, tone:'ambiguous', text:(sc,t)=>`Her şey hazır. Artık sadece uygun bir gece lazım — ve o gece gelecek.` },
  ],
  strike: {
    verb: 'Bu gece olsun.',
    detail: 'Bir daha bu kadar yakın olmayacaksın.',
    confirm: (t) => `${fullName(t)} sabaha çıkmasın mı?`,
    waitDays: 24,
    stakes: (sc, t) => [
      isKin(sc.ownerId, sc.targetId) ? { kind:'kin', who: fullName(t) } : { kind:'life', who: fullName(t) },
      { kind:'secret' }, { kind:'soul' },
    ],
    tells: [
      { at:0.35, text:'Aşçı bu sabah mutfağa geç geldi. Kimseyle konuşmadı.', goodTone:'ambiguous', badTone:'bad' },
      { at:0.75, text:'Gece yarısı koridorda ayak sesleri. Sonra uzun bir sessizlik.', goodTone:'ambiguous', badTone:'bad' },
    ],
  },
  onSuccess(sc, t, o) {
    kill(t, 'murder', o.id);
    giveSecret(o.id, 'murder', `${fullName(t)}'i sen öldürttün.`, t.id);
    if (isKin(o.id, t.id)) {
      if (!o.traits.includes('kinslayer')) o.traits.push('kinslayer');
      S.stats.kin_lost++;
    }
    o.dreadBonus = (o.dreadBonus || 0) + 5;
    // every partner now owns a piece of you
    for (const pt of sc.partners) giveHook(pt.id, o.id, 'strong', `${fullName(t)}'in ölümünü biliyor.`);
    mark(sc, `${fullName(t)}'i öldürttün.`, 0.9, { success: true });
    return {
      beat: 'sabah oldu',
      title: `${fullName(t)} Uyanmadı`,
      knell: true,
      text: `Haberi öğlene doğru getirdiler. Yüzünü hazırlamak için tam iki nefeslik vaktin vardı; yetti.\n\n` +
            `Kimse bir şey söylemedi. Kimsenin bir şey söylememesi, kimsenin bilmediği anlamına gelmiyor.` +
            (sc.partners.length ? `\n\nBu odada ${sc.partners.length} kişi daha var ve hepsi seninle göz göze gelmiyor.` : `\n\nBunu tek başına yaptın. Bir tek sen biliyorsun. Bu, taşıyabileceğin en ağır şey.`),
      effects: [
        `<b>${fullName(t)}</b> öldü — ${age(t)} yaşındaydı`,
        isKin(o.id, t.id) ? '<b>Kan Dökücü</b> damgası — kalıcı' : '+5 dehşet',
        ...sc.partners.map((pt) => `<b>${nameOf(pt.id)}</b> artık senin üzerinde bir koz taşıyor`),
      ],
    };
  },
  onFail(sc, t, o) {
    remember(t.id, o.id, 'Onu öldürtmeye kalktın.', -85, 999);
    courtRemembers(o.id, 'Bir adam zehirletmeye kalktı ve beceremedi.', -22, 45);
    o.prestige -= 120;
    giveHook(t.id, o.id, 'strong', 'Suikast girişimini biliyor.');
    mark(sc, `${fullName(t)}'i öldürtmeye kalktın ve yakalandın.`, 0.85, { success: false });
    return {
      beat: 'konuştu',
      title: 'Aşçı Konuştu',
      knell: true,
      text: `Üç gün dayandı. Üçüncü gün senin adını söyledi — zaten herkes o adı bekliyordu.\n\n` +
            `${fullName(t)} şimdi biliyor. Ve bilen bir adam, bilmeyen bir adamdan bambaşka bir hayvandır.`,
      effects: ['−120 itibar', `<b>${fullName(t)}</b> artık senin düşmanın — kalıcı`, `<b>${fullName(t)}</b> senin üzerinde koz sahibi`],
    };
  },
},

// --- 2. SEDUCTION ----------------------------------------------------------
{
  id: 'seduce',
  name: 'Baştan Çıkarma',
  kicker: 'kapalı bir kapı, aralık bir perde',
  icon: '🌹',
  skill: 'diplomacy',
  days: 250,
  gold: 40,
  heat: 0.115,
  base: 0.24,
  danger: 0.45,
  blurb: 'Kısa sürer, ucuzdur, ve yakalanırsan gülünç olursun. Gülünç olmak bazen ölmekten pahalıdır.',
  targetHint: 'Kimin gözünü arıyorsun?',
  can: (t) => t.id !== S.playerId && age(t) >= 16,
  roles: [
    { id:'maid',  name:'Nedime',  skill:'diplomacy', succ:0.18, heat:0.6, hint:'Odaya giren tek kişi. Ne söylediğini o seçer.' },
    { id:'poet',  name:'Şair',    skill:'learning',  succ:0.15, heat:0.4, hint:'Senin ağzından yazar. Sözler senin değil ama imza senin.' },
    { id:'rider', name:'Ulak',    skill:'intrigue',  succ:0.11, heat:0.5, hint:'Mektubu taşır. Bir gün taşımaz.' },
  ],
  signs: [
    { at:0.22, tone:'ambiguous', text:(sc,t)=>`İlk mektup gitti. Cevap gelmedi. Cevap gelmemesi de bir cevaptır — hangisi, bilmiyorsun.` },
    { at:0.48, tone:'lean',      good:(sc,t)=>`${t.name} bahçede seni bekletmiş. Bekletmek, ilgilenmenin bir biçimidir.`,
                                 bad:(sc,t)=>`${t.name} mektuplarını nedimesine okutuyormuş. Okuttuğu her satır bir tanık.` },
    { at:0.72, tone:'lean',      good:(sc,t)=>`${t.name} bu akşam senin oturduğun tarafa oturdu. Kimse fark etmedi. Sen ettin.`,
                                 bad:(sc,t)=>`${t.name}'in kocası/karısı ulağının adını sordu. Sadece adını.` },
    { at:0.90, tone:'ambiguous', text:(sc,t)=>`Bir kapı aralık bırakılacak. Hangi gece olduğunu sana söylemeyecekler; gideceksin ve göreceksin.` },
  ],
  strike: {
    verb: 'Git.',
    detail: 'Bu gece ya bir sırrın olur ya bir düşmanın.',
    confirm: (t) => `${t.name}'in kapısını çalacaksın.`,
    waitDays: 12,
    stakes: (sc, t) => [{ kind:'secret' }, { kind:'reputation' }],
    tells: [{ at:0.5, text:'Koridorda kimse yok. Kimsenin olmaması da düzenlenmiş olabilir.', goodTone:'ambiguous', badTone:'ambiguous' }],
  },
  onSuccess(sc, t, o) {
    remember(t.id, o.id, 'Aranızda bir gece geçti.', +55, 60);
    giveHook(o.id, t.id, 'strong', `${fullName(t)} ile aranızdaki geceyi biliyorsun.`);
    giveSecret(o.id, 'affair', `${fullName(t)} ile bir gece.`, t.id);
    o.lovers = [...(o.lovers || []), t.id];
    mark(sc, `${fullName(t)} ile aranızda bir gece geçti.`, 0.55, { success: true });
    return {
      beat: 'kapı açıktı',
      title: `${t.name}`,
      text: `Kapı gerçekten aralıktı. İçeride tek bir mum yanıyordu ve o mumu birinin özellikle yakması gerekiyordu.\n\n` +
            `Sabaha karşı çıkarken koridor boştu. Boş koridorlar en tehlikeli olanlardır: kimse görmedi demek, kimsenin görmediğini kanıtlayamazsın demek.`,
      effects: [`<b>${fullName(t)}</b> +55 sana bakış`, `Artık <b>${t.name}</b> üzerinde bir kozun var`, 'Bu sır bir gün pazarlık masasına çıkabilir'],
    };
  },
  onFail(sc, t, o) {
    remember(t.id, o.id, 'Onu baştan çıkarmaya çalıştın.', -55, 40);
    courtRemembers(o.id, 'Reddedildiği herkesin diline düştü.', -12, 25);
    o.prestige -= 60;
    if (o.spouseId && ch(o.spouseId)) remember(o.spouseId, o.id, 'Bir başkasının kapısını çaldın.', -70, 999);
    mark(sc, `${fullName(t)}'e uzandın ve eli boş döndün.`, 0.5, { success: false });
    return {
      beat: 'kapı kapalıydı',
      title: 'Kapı Açılmadı',
      text: `Kapıyı çaldın. İçeriden bir ses geldi ama kapı açılmadı — ve o ses yalnız değildi.\n\n` +
            `Ertesi sabah kimse yüzüne bakıp gülmedi. Arkanı döndüğünde güldüler.`,
      effects: ['−60 itibar', `<b>${fullName(t)}</b> −55`, o.spouseId ? `<b>${nameOf(o.spouseId)}</b> öğrendi ve unutmayacak` : 'Sarayın diline düştün'],
    };
  },
},

// --- 3. FABRICATE A CLAIM ---------------------------------------------------
{
  id: 'fabricate',
  name: 'Hak Uydurma',
  kicker: 'mürekkep, mühür ve iki yalancı şahit',
  icon: '📜',
  skill: 'learning',
  days: 360,
  gold: 150,
  heat: 0.055,
  base: 0.30,
  danger: 0.35,
  needsTitle: true,
  blurb: 'Kimse ölmez. Kimse ağlamaz. Sadece bir kâğıt yazılır — ve o kâğıt yüzünden bin kişi ölür.',
  targetHint: 'Hangi toprağı istiyorsun?',
  can: (t) => t.id !== S.playerId && directCountiesOf(t.id).length > 0,
  roles: [
    { id:'scribe', name:'Kâtip',  skill:'learning',   succ:0.20, heat:0.4, hint:'Eski el yazısını taklit eder. Parmakları mürekkepli.' },
    { id:'qadi',   name:'Kadı',   skill:'learning',   succ:0.17, heat:0.7, hint:'Mührü o basar. Mühür basan adam, bastığını unutmaz.' },
    { id:'witn',   name:'Şahit',  skill:'diplomacy',  succ:0.12, heat:0.5, hint:'"Dedeni tanırdım" diyecek. Tanımıyordu.' },
  ],
  signs: [
    { at:0.20, tone:'ambiguous', text:(sc,t)=>`Kâtip üç gecedir mum yakıyor. Kâğıdı eskitmek için çay ve güneş gerekiyormuş.` },
    { at:0.45, tone:'lean',      good:(sc,t)=>`Kadı mührü gördü ve hiçbir şey sormadı. Sormamak, en pahalı hizmettir.`,
                                 bad:(sc,t)=>`Kadı mühre uzun uzun baktı. Sonra da bir kez daha baktı.` },
    { at:0.70, tone:'ambiguous', text:(sc,t)=>`Şahitlerden biri parasını peşin istedi. Peşin isteyen adam, ikinci kez gelmeyi düşünmüyor demektir.` },
    { at:0.88, tone:'lean',      good:(sc,t)=>`Belge hazır. Mürekkep kırk yıllık görünüyor; sen bile inanacak gibi oldun.`,
                                 bad:(sc,t)=>`${t.name}'in kâtibi arşivde eski tapuları istemiş. Hangi sebeple, söylememiş.` },
  ],
  strike: {
    verb: 'Belgeyi divana sun.',
    detail: 'Bir kez sunduktan sonra geri alamazsın. Kâğıt artık senden bağımsız.',
    confirm: () => 'Sahte bir belgeyi kendi mührünle divana koyacaksın.',
    waitDays: 30,
    stakes: () => [{ kind:'oath' }, { kind:'reputation' }, { kind:'secret' }],
    tells: [{ at:0.6, text:'Divan kâtibi belgeyi ikinci kez istedi. Sebep söylemedi.', goodTone:'ambiguous', badTone:'bad' }],
  },
  onSuccess(sc, t, o) {
    const title = ti(sc.titleId) || directCountiesOf(t.id)[0];
    if (title) title.claims.push({ charId: o.id, kind: 'fabricated', day: S.day });
    giveSecret(o.id, 'forgery', `${title ? title.name : 'Bir toprak'} üzerindeki hakkın sahte.`, t.id);
    o.prestige += 40;
    mark(sc, `${title ? title.name : 'Bir kontluk'} üzerinde sahte bir hak uydurdun.`, 0.6, { success: true });
    return {
      beat: 'kâğıt tuttu',
      title: `${title ? title.name : 'Bir Toprak'} Artık Senin Hakkın`,
      text: `Divan belgeyi okudu, birbirine baktı, kabul etti. Kimse itiraz etmedi çünkü itiraz etmek okumayı gerektirirdi.\n\n` +
            `Artık ${fullName(t)}'in toprağı üzerinde yasal bir hakkın var. Yasal olan ile doğru olan arasındaki mesafeyi bir tek sen biliyorsun. Ve kâtip.`,
      effects: [`<b>${title ? title.name : 'Bir kontluk'}</b> üzerinde hak — savaş sebebi`, '+40 itibar', '<b>Sır:</b> belge sahte'],
    };
  },
  onFail(sc, t, o) {
    o.prestige -= 140;
    o.piety = Math.max(0, o.piety - 90);
    if (!o.traits.includes('oathbreaker')) o.traits.push('oathbreaker');
    remember(t.id, o.id, 'Toprağı için sahte belge yazdırdı.', -60, 999);
    courtRemembers(o.id, 'Divanda sahte bir belgeyle yakalandı.', -25, 50);
    mark(sc, 'Sahte belgeyle divanda yakalandın.', 0.7, { success: false });
    return {
      beat: 'mürekkep taze',
      title: 'Mürekkep Kurumamıştı',
      text: `Kadı belgeyi ışığa tuttu ve salonun sesi kesildi. Kırk yıllık bir kâğıdın kokusunu herkes bilir; bu kâğıt taze ekmek gibi kokuyordu.\n\n` +
            `Kâtibini aradılar. Kâtip iki gün önce şehirden çıkmıştı. Akıllı adammış.`,
      effects: ['−140 itibar', '−90 dindarlık', '<b>Sözünden Dönen</b> damgası', 'Vassalların gördü'],
    };
  },
},

// --- 4. ABDUCTION -----------------------------------------------------------
{
  id: 'abduct',
  name: 'Kaçırma',
  kicker: 'bir at, bir çuval, bir gece',
  icon: '⛓',
  skill: 'martial',
  days: 165,
  gold: 75,
  heat: 0.30,
  base: 0.26,
  danger: 0.8,
  blurb: 'En hızlısı ve en gürültülüsü. Dört ay sürer ama dört ay boyunca herkes bir şeyler duyar.',
  targetHint: 'Kimi zindanına istiyorsun?',
  can: (t) => t.id !== S.playerId,
  roles: [
    { id:'rider',  name:'Atlı',      skill:'martial',  succ:0.18, heat:0.8, hint:'Yolu o keser. Yakalanırsa yüzü var, adı var.' },
    { id:'inside', name:'İçerdeki',  skill:'intrigue', succ:0.20, heat:0.7, hint:'Kapıyı içeriden açar. Kapıyı açan, kapıyı kapatır da.' },
    { id:'smith',  name:'Demirci',   skill:'stewardship', succ:0.09, heat:0.3, hint:'Zinciri o döver. Kime dövdüğünü sormaz.' },
  ],
  signs: [
    { at:0.25, tone:'ambiguous', text:(sc,t)=>`Atlılar seçildi. Üçü de senin adını bilmiyor — öyle söylediler.` },
    { at:0.50, tone:'lean',      good:(sc,t)=>`${t.name} her cuma aynı yoldan geçiyor. Alışkanlık, bir insanın en zayıf yeridir.`,
                                 bad:(sc,t)=>`${t.name} bu ay yanına iki muhafız daha aldı. Sebebini söylemedi.` },
    { at:0.76, tone:'ambiguous', text:(sc,t)=>`Zincir hazır. Demirci fazla soru sordu; adamların ona bir şey söylemedi ama uzun uzun baktılar.` },
    { at:0.92, tone:'lean',      good:(sc,t)=>`Yol keşfedildi. Ay bu hafta zayıf doğuyor.`,
                                 bad:(sc,t)=>`Köylüler yolun kenarında bekleyen atlıları görmüş. Görmüş olmaları yeter.` },
  ],
  strike: {
    verb: 'Yolu kes.',
    detail: 'Kaçırılan adam ya zindanında olur ya da adını haykırarak kaçar.',
    confirm: (t) => `${fullName(t)}'i çuvala mı koyacaksın?`,
    waitDays: 10,
    stakes: (sc, t) => [{ kind:'oath' }, { kind:'secret' }, { kind:'reputation' }],
    tells: [{ at:0.6, text:'Atlılardan biri geri döndü. Yalnız döndü.', goodTone:'ambiguous', badTone:'bad' }],
  },
  onSuccess(sc, t, o) {
    t.imprisonedBy = o.id;
    t.imprisonedDay = S.day;
    o.dreadBonus = (o.dreadBonus || 0) + 7;
    remember(t.id, o.id, 'Seni yolda kaçırdı ve zindanına attı.', -90, 999);
    courtRemembers(o.id, 'Bir adamı yoldan kaçırttı.', -14, 30);
    giveHook(o.id, t.id, 'strong', 'Zindanında tuttuğun adam.');
    mark(sc, `${fullName(t)}'i kaçırttın.`, 0.75, { success: true });
    return {
      beat: 'çuval doldu',
      title: `${fullName(t)} Zindanında`,
      text: `Şafaktan önce getirdiler. Ayakkabıları yoktu ve kimse nedenini söylemedi.\n\n` +
            `Şimdi onunla ne yapacağını bilmen gerekiyor: fidye, takas, ya da hiç. Üçü de bir gün geri gelecek.`,
      effects: [`<b>${fullName(t)}</b> zindanında`, '+7 dehşet', `<b>${fullName(t)}</b> −90 — kalıcı`, 'Sarayın huzursuz'],
    };
  },
  onFail(sc, t, o) {
    o.prestige -= 90;
    remember(t.id, o.id, 'Onu yolda kaçırmaya kalktı.', -80, 999);
    courtRemembers(o.id, 'Yol kesip adam kaçırmaya kalktı ve beceremedi.', -20, 40);
    mark(sc, `${fullName(t)}'i kaçırma girişimin bozuldu.`, 0.7, { success: false });
    return {
      beat: 'yol boş çıktı',
      title: 'Yolda Kimse Yoktu',
      text: `${fullName(t)} o gün başka yoldan geçti. Senin atlıların bir saat bekledi, sonra bir saat daha.\n\n` +
            `Üçüncü saatte yakalandılar. İkisi kaçtı. Biri kaçmadı ve konuştu.`,
      effects: ['−90 itibar', `<b>${fullName(t)}</b> biliyor — kalıcı düşmanlık`, 'Adamlarından biri onun elinde'],
    };
  },
},

// --- 5. PREPARING A REVOLT --------------------------------------------------
{
  id: 'revolt',
  name: 'İsyan Hazırlığı',
  kicker: 'yemin üstüne yemin',
  icon: '⚔',
  skill: 'diplomacy',
  days: 620,
  gold: 120,
  heat: 0.075,
  base: 0.20,
  danger: 0.9,
  blurb: 'İki yıl sürer. Tek başına anlamsızdır: kaç kılıç toplarsan o kadar vardır. Ve her kılıcın bir ağzı var.',
  targetHint: 'Kime karşı ayaklanacaksın?',
  can: (t) => {
    const p = P();
    return !!p && (t.id === p.liegeId || t.id === topLiege(p.id)) && t.id !== p.id;
  },
  roles: [
    { id:'sworn1', name:'Yeminli Bey', skill:'martial',   succ:0.16, heat:0.5, hint:'Askerini getirir. Getirdiğini geri de götürebilir.' },
    { id:'sworn2', name:'İkinci Yemin', skill:'martial',  succ:0.16, heat:0.5, hint:'İkincisi her zaman birincisine bakar.' },
    { id:'purse',  name:'Kese',        skill:'stewardship', succ:0.13, heat:0.4, hint:'Parayı o bulur. Parayı bulan, şartını da söyler.' },
  ],
  signs: [
    { at:0.18, tone:'ambiguous', text:(sc,t)=>`İlk yemin edildi. Kimse kâğıda bir şey yazmadı; yazılan şey delil olur.` },
    { at:0.40, tone:'lean',      good:(sc,t)=>`Sınırdaki iki bey aynı hafta ava çıktı. Aynı ormanda.`,
                                 bad:(sc,t)=>`${t.name} bu ay üç vassalını ayrı ayrı çağırdı. Ne konuştuklarını kimse anlatmıyor.` },
    { at:0.62, tone:'ambiguous', text:(sc,t)=>`Kese doldu ama sayan adam iki kez saydı. İki kez sayan adam, aklından geçiriyor demektir.` },
    { at:0.84, tone:'lean',      good:(sc,t)=>`Ambarlarda fazla mızrak var. Kimse nereden geldiğini sormuyor.`,
                                 bad:(sc,t)=>`${t.name}'in serdarı senin kalendeki adam sayısını sormuş. Vergi için, dediler.` },
  ],
  strike: {
    verb: 'Yeminleri bozdur.',
    detail: 'Bayrağı açtığın an geri dönüş yok. Kimin geleceğini ancak o sabah öğrenirsin.',
    confirm: (t) => `${fullName(t)}'e karşı bayrak açacaksın.`,
    waitDays: 40,
    stakes: (sc, t) => [{ kind:'oath' }, { kind:'title' }, { kind:'life', who:'kendi hayatın' }],
    tells: [
      { at:0.4, text:'Yeminlilerden biri bu sabah kalesinden çıkmadı.', goodTone:'ambiguous', badTone:'bad' },
      { at:0.8, text:'Sınır köylerinde davul sesi. Kimin davulu, belli değil.', goodTone:'good', badTone:'bad' },
    ],
  },
  onSuccess(sc, t, o) {
    // The pledge lives in flags, not in S.factions: that array belongs to another
    // system and this piece does not get to define its shape.
    S.flags.revoltPledge = {
      leaderId: o.id, againstId: t.id, day: S.day,
      swords: [o.id, ...sc.partners.map((p) => p.id)],
    };
    o.faction = 'claimant';
    o.prestige += 90;
    for (const pt of sc.partners) { const m = ch(pt.id); if (m) m.faction = 'claimant'; }
    remember(t.id, o.id, 'Sana karşı bir taraf kurdu.', -70, 999);
    mark(sc, `${fullName(t)}'e karşı bir taraf kurdun.`, 0.85, { success: true });
    return {
      beat: 'bayrak açıldı',
      title: 'Yeminliler Geldi',
      text: `Sabah kalenin önünde ${sc.partners.length + 1} sancak vardı. Saymak için iki kez baktın; ikisinde de aynı sayıyı gördün ve rahatladın.\n\n` +
            `Şimdi ${fullName(t)} de aynı sayıyı öğrenecek. Ondan sonrası kılıçların işi.`,
      effects: [`<b>${sc.partners.length + 1}</b> sancak yanında`, '+90 itibar', `<b>${fullName(t)}</b> ile aran kalıcı olarak bozuldu`],
    };
  },
  onFail(sc, t, o) {
    o.prestige -= 160;
    if (!o.traits.includes('oathbreaker')) o.traits.push('oathbreaker');
    remember(t.id, o.id, 'Sana karşı ayaklanmaya kalktı.', -95, 999);
    for (const pt of sc.partners) { const m = ch(pt.id); if (m) remember(m.id, o.id, 'Bizi yeminimizle yakalattı.', -60, 60); }
    mark(sc, `${fullName(t)}'e karşı isyan hazırlığın ortaya çıktı.`, 0.9, { success: false });
    return {
      beat: 'kimse gelmedi',
      title: 'Sabah Kimse Gelmedi',
      text: `Bayrağı açtın. Kalenin önü boştu. İki saat bekledin — bekleyecek başka bir şeyin yoktu.\n\n` +
            `Yeminlilerin bir gece önce ${fullName(t)}'in çadırındaydı. Yemin ucuzdur; asıl pahalı olan, kimin yeminine güvendiğindir.`,
      effects: ['−160 itibar', '<b>Sözünden Dönen</b> damgası', `<b>${fullName(t)}</b> her şeyi biliyor`, 'Ortakların seni suçluyor'],
    };
  },
},

// --- 6. LEARN A SECRET ------------------------------------------------------
{
  id: 'secret',
  name: 'Sır Öğrenme',
  kicker: 'birinin en karanlık odası',
  icon: '👁',
  skill: 'intrigue',
  days: 210,
  gold: 45,
  heat: 0.05,
  base: 0.34,
  danger: 0.3,
  blurb: 'En sessizi. Kimse ölmez, kimse toprak kaybetmez — ama öğrendiğin şeyi bir daha bilmemeyi seçemezsin.',
  targetHint: 'Kimin defterini okumak istiyorsun?',
  can: (t) => t.id !== S.playerId,
  roles: [
    { id:'serv',  name:'Hizmetkâr', skill:'intrigue', succ:0.17, heat:0.5, hint:'Odayı o siler. Yerdeki her şeyi görür.' },
    { id:'conf',  name:'Sırdaş',    skill:'learning', succ:0.19, heat:0.6, hint:'Ona anlatılanları sana anlatır. Bir gün sırası sana gelir.' },
  ],
  signs: [
    { at:0.28, tone:'ambiguous', text:(sc,t)=>`Hizmetkâr ilk haberi getirdi: ${t.name} geceleri geç yatıyor ve tek başına yatmıyor. Bu kadarı bir şey değil.` },
    { at:0.55, tone:'lean',      good:(sc,t)=>`${t.name}'in odasından bir sandık çıkmış. İçinde ne olduğunu taşıyan adam bile bilmiyormuş.`,
                                 bad:(sc,t)=>`Hizmetkârın iki gün ortadan kayboldu. Sonra döndü ve daha az konuşuyor.` },
    { at:0.82, tone:'ambiguous', text:(sc,t)=>`Bir isim duyuldu. Tek başına anlamsız bir isim — ama bir yere oturursa her şey değişir.` },
  ],
  strike: {
    verb: 'Sandığı aç.',
    detail: 'Bildiğin şeyi bilmemiş olamazsın.',
    confirm: () => 'Öğrendikten sonra geri koyamazsın.',
    waitDays: 8,
    stakes: () => [{ kind:'secret' }],
    tells: [{ at:0.5, text:'Hizmetkâr bu sabah gelmedi. Öğlen geldi ve elleri titriyordu.', goodTone:'ambiguous', badTone:'bad' }],
  },
  onSuccess(sc, t, o) {
    const pool = [
      { k:'bastard',  s:(n)=>`${n}'in en büyük oğlu kendi oğlu değil.` },
      { k:'affair',   s:(n)=>`${n} kendi kardeşinin eşiyle görüşüyor.` },
      { k:'murder',   s:(n)=>`${n} babasının ölümünü kendisi ayarlamış.` },
      { k:'heresy',   s:(n)=>`${n} yılda bir kez, tek başına, yasak bir ayine katılıyor.` },
      { k:'debt',     s:(n)=>`${n} tüm topraklarını iki tefeciye ipotek etmiş.` },
      { k:'oath',     s:(n)=>`${n} efendisine karşı çoktan yemin etmiş — başka birine.` },
    ];
    const pick = rng.pick(pool);
    const text = pick.s(fullName(t));
    giveHook(o.id, t.id, 'strong', text);
    (o.knownSecrets ||= []).push({ aboutId: t.id, kind: pick.k, label: text, day: S.day });
    mark(sc, `${fullName(t)} hakkında bir sır öğrendin: ${text}`, 0.6, { success: true });
    return {
      beat: 'okudun',
      title: 'Şimdi Biliyorsun',
      text: `${text}\n\n` +
            `Sandığı yerine koydurdun, mumu söndürdün, kimseye söylemedin. Ama artık ${t.name}'in yüzüne her baktığında bunu göreceksin — ve o, senin gördüğünü görmeyecek.\n\n` +
            `İşte bu, elindeki en sessiz silahtır.`,
      effects: [`<b>Koz:</b> ${text}`, `<b>${fullName(t)}</b> bilmiyor — henüz`],
    };
  },
  onFail(sc, t, o) {
    remember(t.id, o.id, 'Odasını karıştırttı.', -45, 50);
    o.prestige -= 30;
    mark(sc, `${fullName(t)}'in defterini karıştırdın ve yakalandın.`, 0.45, { success: false });
    return {
      beat: 'sandık boştu',
      title: 'Sandık Boşaltılmıştı',
      text: `Hizmetkârın sandığı açtığında içinde sadece kumaş vardı. Birisi ondan önce davranmıştı.\n\n` +
            `${fullName(t)} ertesi gün seni selamladı ve fazla uzun gülümsedi.`,
      effects: ['−30 itibar', `<b>${fullName(t)}</b> −45 — kimin karıştırdığını biliyor`],
    };
  },
},

// --- 7. DEFAMATION ----------------------------------------------------------
{
  id: 'defame',
  name: 'Karalama',
  kicker: 'ucuz bir söz, pahalı bir leke',
  icon: '🗣',
  skill: 'diplomacy',
  days: 190,
  gold: 30,
  heat: 0.10,
  base: 0.36,
  danger: 0.25,
  blurb: 'En ucuzu. Kimse ölmez ama bir adamın adı ölür — ve adı ölen adam bunu sana ödetir.',
  targetHint: 'Kimin adını lekeleyeceksin?',
  can: (t) => t.id !== S.playerId,
  roles: [
    { id:'gossip', name:'Dedikoducu', skill:'diplomacy', succ:0.16, heat:0.6, hint:'Bir haftada üç şehre yayar. Kaynağı da yayar.' },
    { id:'merch',  name:'Tüccar',     skill:'stewardship', succ:0.12, heat:0.4, hint:'Kervanla gider, sözle döner.' },
  ],
  signs: [
    { at:0.30, tone:'ambiguous', text:(sc,t)=>`Söz pazara düştü. Pazarda söylenen bir şey iki hafta içinde divana varır.` },
    { at:0.60, tone:'lean',      good:(sc,t)=>`${t.name}'in vassallarından biri hikâyeyi kendi ağzıyla anlatmış. Kaynağını unutmuş.`,
                                 bad:(sc,t)=>`${t.name} pazarda konuşan adamı bulmuş. Adam hâlâ konuşuyor mu, bilinmiyor.` },
    { at:0.86, tone:'ambiguous', text:(sc,t)=>`Hikâye artık senden bağımsız yürüyor. İyi haber bu. Kötü haber de bu.` },
  ],
  strike: {
    verb: 'Sözü divana taşı.',
    detail: 'Bir kez söylendi mi geri alınmaz.',
    confirm: (t) => `${fullName(t)}'in adını herkesin önünde lekeleyeceksin.`,
    waitDays: 14,
    stakes: () => [{ kind:'reputation' }, { kind:'secret' }],
    tells: [{ at:0.55, text:'Divanda iki bey birbirine bakıp sustu.', goodTone:'good', badTone:'ambiguous' }],
  },
  onSuccess(sc, t, o) {
    for (const v of vassalsOf(t.id)) remember(v.id, t.id, 'Hakkındaki hikâyeyi herkes duydu.', -35, 30);
    t.prestige -= 90;
    if (!t.traits.includes('humbled')) t.traits.push('humbled');
    mark(sc, `${fullName(t)}'in adını lekeledin.`, 0.45, { success: true });
    return {
      beat: 'söz tuttu',
      title: `${t.name} Artık O Adam`,
      text: `Hikâye kendi ayaklarıyla yürüdü. Divanda kimse yüksek sesle söylemedi ama herkes aynı anda aynı şeyi düşündü.\n\n` +
            `${fullName(t)} salona girdiğinde iki bey ayağa kalkmadı. Bunu o da fark etti.`,
      effects: [`<b>${fullName(t)}</b> −90 itibar`, `Vassalları ondan soğudu`, '<b>Ezik</b> damgası ona geçti'],
    };
  },
  onFail(sc, t, o) {
    o.prestige -= 70;
    remember(t.id, o.id, 'Adını lekelemeye çalıştı.', -50, 60);
    courtRemembers(o.id, 'Dedikoduyla adam yıkmaya çalıştı.', -16, 30);
    mark(sc, `${fullName(t)}'e attığın iftira sana döndü.`, 0.45, { success: false });
    return {
      beat: 'kaynak bulundu',
      title: 'Sözün Sahibi Bulundu',
      text: `Dedikoducu tutuklandığında ilk gün susmuş, ikinci gün ağlamış, üçüncü gün senin adını söylemiş.\n\n` +
            `Divanda kimse sana bir şey demedi. Sadece hikâyeyi anlatırken sana bakıyorlar.`,
      effects: ['−70 itibar', `<b>${fullName(t)}</b> −50`, 'Sarayın seni küçük gördü'],
    };
  },
},
];

export const SCHEME_BY_ID = Object.fromEntries(SCHEME_TYPES.map((t) => [t.id, t]));
export function schemeType(id) { return SCHEME_BY_ID[id] || null; }

// ---------------------------------------------------------------------------
// Reusable lines for the engine: refusals, wobbles, exposure. Kept here so all
// the writing lives in one file and the sim stays arithmetic.
// ---------------------------------------------------------------------------

export const INVITE_YES = [
  (c, sc, t) => `${fullName(c)} uzun uzun sustu, sonra "ne zaman?" diye sordu. Sorması kabul etmesiydi.`,
  (c, sc, t) => `${fullName(c)} elini masaya koydu. "${t.name} için mi?" dedi. Cevabını beklemedi.`,
  (c, sc, t) => `${fullName(c)} güldü. Güldüğü şey teklifin değildi; senin bu kadar geç sormandı.`,
];
export const INVITE_NO = [
  (c, sc, t) => `${fullName(c)} teklifini dinledi, sonra pencereye baktı. "Ben duymadım," dedi. Duymuştu.`,
  (c, sc, t) => `${fullName(c)} başını iki kez salladı. İkincisi kendi kendineydi.`,
  (c, sc, t) => `${fullName(c)} ayağa kalktı ve kapıya yürüdü. Kapıda durdu, dönmedi, çıktı.`,
];
export const INVITE_NO_ANGRY = [
  (c, sc, t) => `${fullName(c)} teklifini duyunca yüzü değişti. Çıkarken kapıyı kapatmadı — kapatmamak bir şey söylemektir.`,
  (c, sc, t) => `${fullName(c)} "Bunu bana bir daha sorma," dedi. Sonra "kimseye de sorma," dedi.`,
];

export const EXPOSE_SIGN = [
  (sc, t) => `${t.name} bu hafta iki muhafız daha aldı. Sebep sorulmadı.`,
  (sc, t) => `${t.name}'in adamı senin kâhyanla konuşurken görülmüş.`,
  (sc, t) => `Sarayında bir hizmetkâr kayboldu. Kimse aramadı.`,
  (sc, t) => `${t.name} bugün seni selamlarken bir an fazla bekledi.`,
];

export const LEAK_LINE = [
  () => 'Bir hizmetkâr fazla konuştu. Kime konuştuğunu bilmiyorsun.',
  () => 'Pazar yerinde bir isim geçmiş. Senin ismin değil ama sana yakın bir isim.',
  () => 'Kâhyan sana bakıp bir şey söylemek istedi, sonra vazgeçti.',
  () => 'Bir mektup yanlış ele geçti. İçinde ne yazdığını hatırlamıyorsun — hatırlamak istemiyorsun.',
];

/** Titles for the moment a co-conspirator loses their nerve. */
export const WOBBLE = {
  title: (c) => `${fullName(c)} Çekilmek İstiyor`,
  framing: (c, sc, t) => `${fullName(c)} gece yarısı kapını çaldı. Yüzü kâğıt gibiydi.`,
  body: (c, sc, t, tp) =>
    `"Ben bu işten çıkıyorum," diyor. "Kimseye bir şey söylemem, yemin ederim."\n\n` +
    `Yemin ettiğini söyleyen adam, yemin etmesi gerektiğini düşünüyor demektir. Elinde ${tp.name.toLocaleLowerCase('tr')} planının tamamı var: kim, ne zaman, ne kadar altın.\n\n` +
    `Dışarıda kar yağıyor. Bu adam bu kapıdan ya senin adamın olarak çıkacak ya da bir tanık olarak.`,
};

/** Titles for the moment a refused invitation turns dangerous. */
export const SNITCH = {
  title: (c) => `${fullName(c)} Konuşacak`,
  framing: (c, sc, t) => `Reddettiği gece ${fullName(c)} kaleden çıktı. Dün ${t.name}'in adamıyla aynı handa görüldü.`,
  body: (c, sc, t, tp) =>
    `Casusun anlatıyor: "İki saat oturdular efendim. Konuşan hep sizinki oldu."\n\n` +
    `Henüz bir şey olmadı. Ama bir şey olması için artık sadece zamanın geçmesi yeterli.`,
};
