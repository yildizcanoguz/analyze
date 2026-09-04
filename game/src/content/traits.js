// Traits are the game's moral vocabulary. Each one must change what the AI does,
// what events fire, and how other people feel about you — a trait that only
// prints a number is decoration, and decoration has no tension in it.

export const TRAITS = {
  // --- personality (opposed pairs) ---
  brave:      { g:'personality', opp:'craven',   name:'Cesur',        icon:'⚔', desc:'Korkuyu tanımaz.',            mod:{ prowess:+3, dread:+2 }, ai:{ aggression:+0.25, risk:+0.30 }, opinionFrom:{ brave:+15, craven:-10 } },
  craven:     { g:'personality', opp:'brave',    name:'Korkak',       icon:'🐁', desc:'Kaçmayı hep düşünür.',        mod:{ prowess:-4, dread:-2 }, ai:{ aggression:-0.30, risk:-0.35 }, opinionFrom:{ brave:-15 } },
  ambitious:  { g:'personality', opp:'content',  name:'Hırslı',       icon:'👑', desc:'Elindekiyle asla yetinmez.',  mod:{ prestigeM:+0.15 },     ai:{ scheme:+0.35, claim:+0.30, loyalty:-0.20 }, opinionFrom:{ ambitious:-10, content:+5 } },
  content:    { g:'personality', opp:'ambitious',name:'Kanaatkâr',    icon:'🕊', desc:'Yerini bilir.',              mod:{ stressR:+0.20 },       ai:{ scheme:-0.30, loyalty:+0.25 }, opinionFrom:{ ambitious:+5 } },
  wrathful:   { g:'personality', opp:'calm',     name:'Öfkeli',       icon:'🔥', desc:'Hakareti unutmaz.',           mod:{ dread:+3 },            ai:{ aggression:+0.30, forgive:-0.40 }, opinionFrom:{ calm:-8, wrathful:+5 } },
  calm:       { g:'personality', opp:'wrathful', name:'Sakin',        icon:'🌊', desc:'Kanı soğuktur.',              mod:{ stressR:+0.30, diplomacy:+1 }, ai:{ aggression:-0.20, forgive:+0.30 }, opinionFrom:{ wrathful:-5 } },
  paranoid:   { g:'personality', opp:'trusting', name:'Vesveseli',    icon:'👁', desc:'Herkesin bir hesabı vardır.', mod:{ intrigue:+2, stressR:-0.25 }, ai:{ scheme:+0.20, trust:-0.50 }, opinionFrom:{ trusting:-10 } },
  trusting:   { g:'personality', opp:'paranoid', name:'Güvenen',      icon:'🤝', desc:'İnsanların iyiliğine inanır.',mod:{ diplomacy:+1 },        ai:{ trust:+0.45, scheme:-0.20 }, opinionFrom:{ trusting:+10 } },
  deceitful:  { g:'personality', opp:'honest',   name:'Riyakâr',      icon:'🎭', desc:'Yalan onun için bir araçtır.',mod:{ intrigue:+3 },         ai:{ scheme:+0.30, oathBreak:+0.35 }, opinionFrom:{ honest:-20, deceitful:+5 } },
  honest:     { g:'personality', opp:'deceitful',name:'Dürüst',       icon:'📜', desc:'Sözü senettir.',              mod:{ diplomacy:+2, intrigue:-2 }, ai:{ oathBreak:-0.60, scheme:-0.35 }, opinionFrom:{ honest:+20, deceitful:-15 } },
  vengeful:   { g:'personality', opp:'forgiving',name:'Kinci',        icon:'🗡', desc:'Defteri kapanmaz.',           mod:{ dread:+2, intrigue:+1 }, ai:{ forgive:-0.55, scheme:+0.25 }, opinionFrom:{ forgiving:-10 } },
  forgiving:  { g:'personality', opp:'vengeful', name:'Bağışlayan',   icon:'🕯', desc:'Kin tutmaz.',                 mod:{ diplomacy:+2 },        ai:{ forgive:+0.55 }, opinionFrom:{ forgiving:+10, vengeful:-8 } },
  greedy:     { g:'personality', opp:'generous', name:'Açgözlü',      icon:'💰', desc:'Kesesi hep açtır.',           mod:{ stewardship:+1, taxM:+0.10 }, ai:{ gold:+0.40 }, opinionFrom:{ generous:-12, greedy:-5 } },
  generous:   { g:'personality', opp:'greedy',   name:'Cömert',       icon:'🎁', desc:'Verirken düşünmez.',          mod:{ taxM:-0.08 },          ai:{ gold:-0.30, gift:+0.40 }, opinionFrom:{ generous:+12, greedy:-5 } },
  zealous:    { g:'personality', opp:'cynical',  name:'Mutaassıp',    icon:'☪', desc:'İman her şeyden önce gelir.', mod:{ pietyM:+0.20 },        ai:{ holyWar:+0.45, tolerance:-0.50 }, opinionFrom:{ zealous:+12, cynical:-20 } },
  cynical:    { g:'personality', opp:'zealous',  name:'Şüpheci',      icon:'🌒', desc:'Kutsala inanmaz.',            mod:{ learning:+1, pietyM:-0.25 }, ai:{ tolerance:+0.40, holyWar:-0.50 }, opinionFrom:{ zealous:-20 } },
  just:       { g:'personality', opp:'arbitrary',name:'Adil',         icon:'⚖', desc:'Kanunu kendine de uygular.',  mod:{ vassalOp:+5 },         ai:{ oathBreak:-0.35 }, opinionFrom:{ just:+15, arbitrary:-10 } },
  arbitrary:  { g:'personality', opp:'just',     name:'Keyfî',        icon:'🎲', desc:'Kanun onun ağzından çıkar.',  mod:{ dread:+4, vassalOp:-6 }, ai:{ oathBreak:+0.25 }, opinionFrom:{ just:-15 } },
  patient:    { g:'personality', opp:'impatient',name:'Sabırlı',      icon:'⏳', desc:'Bekler. Hep bekler.',         mod:{ learning:+2, stressR:+0.15 }, ai:{ risk:-0.20, scheme:+0.10 }, opinionFrom:{} },
  impatient:  { g:'personality', opp:'patient',  name:'Sabırsız',     icon:'⚡', desc:'Şimdi olsun ister.',          mod:{ martial:+1 },          ai:{ risk:+0.30 }, opinionFrom:{} },
  lustful:    { g:'personality', opp:'chaste',   name:'Şehvetli',     icon:'🌹', desc:'Nefsine yenilir.',            mod:{ fertility:+0.20 },     ai:{ seduce:+0.50 }, opinionFrom:{ chaste:-10 } },
  chaste:     { g:'personality', opp:'lustful',  name:'İffetli',      icon:'⛪', desc:'Nefsini bağlamıştır.',        mod:{ pietyM:+0.10 },        ai:{ seduce:-0.60 }, opinionFrom:{ chaste:+8, lustful:-8 } },
  gregarious: { g:'personality', opp:'shy',      name:'Girgin',       icon:'🍷', desc:'Meclisin ortasındadır.',      mod:{ diplomacy:+3 },        ai:{ ally:+0.30 }, opinionFrom:{ gregarious:+8 } },
  shy:        { g:'personality', opp:'gregarious',name:'Çekingen',    icon:'🌫', desc:'Kalabalıktan kaçar.',         mod:{ diplomacy:-2, learning:+2 }, ai:{ ally:-0.25 }, opinionFrom:{} },
  humble:     { g:'personality', opp:'arrogant', name:'Alçakgönüllü', icon:'🙇', desc:'Övülmekten hoşlanmaz.',       mod:{ vassalOp:+3 },         ai:{}, opinionFrom:{ arrogant:-10, humble:+8 } },
  arrogant:   { g:'personality', opp:'humble',   name:'Kibirli',      icon:'🦚', desc:'Kendini üstün görür.',        mod:{ prestigeM:+0.10, vassalOp:-4 }, ai:{ claim:+0.20 }, opinionFrom:{ humble:-10 } },

  // --- congenital / health ---
  genius:     { g:'congenital', name:'Dâhi',     icon:'✨', tier:3, desc:'Aklı asrını aşar.',   mod:{ diplomacy:+5, martial:+3, stewardship:+5, intrigue:+5, learning:+5 }, opinionFrom:{}, ai:{} },
  intelligent:{ g:'congenital', name:'Zeki',     icon:'📖', tier:2, desc:'Çabuk kavrar.',       mod:{ diplomacy:+3, stewardship:+3, intrigue:+3, learning:+3 }, opinionFrom:{}, ai:{} },
  slow:       { g:'congenital', name:'Ağır',     icon:'🪨', tier:1, desc:'Anlaması vakit alır.',mod:{ diplomacy:-3, stewardship:-3, intrigue:-3, learning:-3 }, opinionFrom:{}, ai:{} },
  strong:     { g:'congenital', name:'Güçlü',    icon:'💪', tier:2, desc:'Kolları demirdendir.',mod:{ prowess:+6, health:+0.5, martial:+2 }, opinionFrom:{}, ai:{} },
  frail:      { g:'congenital', name:'Cılız',    icon:'🩹', tier:1, desc:'Bedeni ihanet eder.', mod:{ prowess:-5, health:-1.0 }, opinionFrom:{}, ai:{} },
  beautiful:  { g:'congenital', name:'Güzel',    icon:'🌟', tier:2, desc:'Bakılınca unutulmaz.',mod:{ diplomacy:+2, fertility:+0.15, attract:+0.3 }, opinionFrom:{}, ai:{} },
  scarred:    { g:'health', name:'Yaralı',       icon:'🩸', desc:'Yüzünde bir hikâye taşır.',   mod:{ dread:+2, attract:-0.2 }, opinionFrom:{}, ai:{} },
  wounded:    { g:'health', name:'Ağır Yaralı',  icon:'🤕', desc:'Yarası kapanmıyor.',          mod:{ prowess:-4, health:-1.5 }, opinionFrom:{}, ai:{} },
  ill:        { g:'health', name:'Hasta',        icon:'🤒', desc:'Ateşi düşmüyor.',             mod:{ health:-2.0 }, opinionFrom:{}, ai:{} },
  pox:        { g:'health', name:'Çiçek',        icon:'☠', desc:'Odaya girenler nefeslerini tutuyor.', mod:{ health:-4.0, attract:-0.4 }, opinionFrom:{}, ai:{} },
  pregnant:   { g:'health', name:'Hamile',       icon:'🤰', desc:'Bir varis yolda.',            mod:{}, opinionFrom:{}, ai:{} },

  // --- earned / reputation ---
  kinslayer:  { g:'reputation', name:'Kan Dökücü', icon:'🩸', desc:'Kendi kanını akıttı. Kimse unutmaz.', mod:{ dread:+8, vassalOp:-25, pietyM:-0.30 }, opinionFrom:{ '*':-30 }, ai:{} },
  oathbreaker:{ g:'reputation', name:'Sözünden Dönen', icon:'⛓', desc:'Yemini bozdu.',        mod:{ vassalOp:-20, dread:+3 }, opinionFrom:{ '*':-20, honest:-15 }, ai:{} },
  excommunicated:{ g:'reputation', name:'Aforoz', icon:'✝', desc:'Kilise kapısını yüzüne kapadı.', mod:{ vassalOp:-30, pietyM:-1 }, opinionFrom:{ zealous:-40 }, ai:{} },
  victorious: { g:'reputation', name:'Muzaffer',  icon:'🏆', desc:'Adı savaş meydanlarında anılır.', mod:{ prestigeM:+0.20, dread:+4, martial:+2 }, opinionFrom:{ '*':+8 }, ai:{} },
  humbled:    { g:'reputation', name:'Ezik',      icon:'💔', desc:'Yenildi ve herkes gördü.',  mod:{ prestigeM:-0.15, dread:-4 }, opinionFrom:{ '*':-6 }, ai:{} },
  poet:       { g:'lifestyle', name:'Şair',       icon:'🖋', desc:'Sözü keskin, kalemi keskin.', mod:{ diplomacy:+2, learning:+1 }, opinionFrom:{ '*':+5 }, ai:{} },
  schemer:    { g:'lifestyle', name:'Entrikacı',  icon:'🕸', desc:'Gölgede rahat eder.',       mod:{ intrigue:+4 }, opinionFrom:{ paranoid:-10 }, ai:{ scheme:+0.30 } },
  strategist: { g:'lifestyle', name:'Stratejist', icon:'🗺', desc:'Haritayı zihninde tutar.',  mod:{ martial:+4 }, opinionFrom:{}, ai:{} },
};

export const PERSONALITY = Object.keys(TRAITS).filter((k) => TRAITS[k].g === 'personality');
export const CONGENITAL = Object.keys(TRAITS).filter((k) => TRAITS[k].g === 'congenital');

export function traitMod(c, key) {
  let v = 0;
  for (const t of c.traits || []) v += TRAITS[t]?.mod?.[key] || 0;
  return v;
}
export function traitAi(c, key) {
  let v = 0;
  for (const t of c.traits || []) v += TRAITS[t]?.ai?.[key] || 0;
  return v;
}
export function traitName(t) { return TRAITS[t]?.name || t; }
