// ===========================================================================
// P04 — YANKILAR
// ---------------------------------------------------------------------------
// Events that fire *because of* something you did years ago.
//
// Rules every echo in this file obeys:
//   1. It grows out of ONE specific row in the world's ledger — a named person,
//      a dated day, a place on the map. Never "a vassal", never "some years ago".
//   2. Its first paragraph says the date and the name out loud, so the player
//      cannot pretend they do not remember.
//   3. It offers a way out, and the way out costs something now.
//   4. Answering it writes a new row in the ledger, so the debt can compound.
//
// This file imports nothing. The machinery in sim/memory.js hands every echo an
// `api` object; that keeps content free of sim wiring and the dependency graph
// pointing one way.
// ===========================================================================

// ---------------------------------------------------------------------------
// Turkish case suffixes with vowel harmony. Proper nouns take an apostrophe, so
// "Bitlis" + accusative = "Bitlis'i", + locative = "Bitlis'te". Getting this
// wrong is the fastest way to make a sentence read like a translation.
// ---------------------------------------------------------------------------
const VOWELS = 'aeıioöuü';
const BACK = 'aıou';
const HARD = 'fstkçşhp';
const POSSESSIVE = /(ları|leri)$/;              // "Çakaoğulları'na", not "'ya"

const lower = (s) => String(s ?? '').toLocaleLowerCase('tr');
function lastVowel(s) {
  const t = lower(s);
  for (let i = t.length - 1; i >= 0; i--) if (VOWELS.includes(t[i])) return t[i];
  return 'a';
}
const endsVowel = (s) => VOWELS.includes(lower(s).slice(-1));
const endsHard = (s) => HARD.includes(lower(s).slice(-1));
const two = (v) => (BACK.includes(v) ? 'a' : 'e');
const four = (v) => ({ a: 'ı', ı: 'ı', o: 'u', u: 'u', e: 'i', i: 'i', ö: 'ü', ü: 'ü' }[v] || 'ı');
const buf = (s, letter) => (POSSESSIVE.test(lower(s)) ? 'n' : endsVowel(s) ? letter : '');

/** Case forms for proper nouns. TR.acc('Bitlis') -> "Bitlis'i" */
export const TR = {
  acc: (s) => `${s}'${buf(s, 'y')}${four(lastVowel(s))}`,
  dat: (s) => `${s}'${buf(s, 'y')}${two(lastVowel(s))}`,
  gen: (s) => `${s}'${buf(s, 'n')}${four(lastVowel(s))}n`,
  loc: (s) => `${s}'${POSSESSIVE.test(lower(s)) ? 'n' : ''}${endsHard(s) ? 't' : 'd'}${two(lastVowel(s))}`,
  abl: (s) => `${s}'${POSSESSIVE.test(lower(s)) ? 'n' : ''}${endsHard(s) ? 't' : 'd'}${two(lastVowel(s))}n`,
  /** the standalone clitic: "Aksungur da öldü", not "Aksungur de öldü" */
  da: (s) => (BACK.includes(lastVowel(s)) ? 'da' : 'de'),
};

// --- the quiet channel: what the world murmurs on an anniversary ------------
// Rare on purpose, and every line NAMES the thing. A bare date is noise, and
// noise is what turns a memory system into wallpaper.
// ctx = {yrs, when, exact, title, who, whoAcc, whoGen, place, placeLoc,
//        placeAbl, doer}
export const ANNIVERSARY_LINES = [
  {
    needs: ['grief'], wants: ['who'],
    line: (c) => `${c.yrs} yıl önce bugün ${c.whoAcc} gömdün. Bu sabah kimse adını anmadı. Sen andın.`,
  },
  {
    needs: ['blood'], wants: ['who'],
    line: (c) => `${c.whoGen} öldüğü gün. ${c.yrs} yıl oldu. Sofrada onun oturduğu yere hâlâ kimse oturmuyor.`,
  },
  {
    needs: ['blood'], wants: ['who'],
    line: (c) => `Bugün ${c.who} öleli tam ${c.yrs} yıl. Adamlarından hiçbiri bunu bilmiyor. Sen biliyorsun; bu yetiyor.`,
  },
  {
    needs: ['denied_relief'], wants: ['place'],
    line: (c) => `${c.placeAbl} gelen kervan bu yıl da eksik geldi. ${c.when} orada olanları hâlâ sayıyorlar — ${c.yrs} yıldır.`,
  },
  {
    needs: ['gave_relief'], wants: ['place'],
    line: (c) => `${c.placeLoc} bir çocuğa senin adını vermişler. O kıştan ${c.yrs} yıl sonra, hâlâ.`,
  },
  {
    needs: ['land_given'], wants: ['who'],
    line: (c) => `${c.whoGen} eline geçen toprak bugün ${c.yrs} yaşında. Sen o kadar genç değilsin.`,
  },
  {
    needs: ['humiliation'], wants: ['who'],
    line: (c) => `${c.who} divana bugün de gelmedi. ${c.yrs} yıldır aynı sandalye boş ve herkes kimin sandalyesi olduğunu biliyor.`,
  },
  {
    needs: ['dungeon'], wants: ['who'],
    line: (c) => `${c.who} bugün aşağıda ${c.yrs} yılı doldurdu. Zindancı bunu sana söylemeye gerek görmedi.`,
  },
  {
    needs: ['oath'],
    line: (c) => `${c.yrs} yıl önce bugün verdiğin sözü bozdun. Kimse hatırlatmadı. Hatırlatmamaları daha kötü.`,
  },
  {
    needs: ['scandal'],
    line: (c) => `"${c.title}" — ${c.yrs} yıl oldu. Sarayda hâlâ, sen odadan çıkınca konuşuluyor.`,
  },
  {
    needs: ['seized'], wants: ['who'],
    line: (c) => `${c.whoGen} elinden aldığın toprak bugün ${c.yrs} yıldır senin. Orada hâlâ eski sancağı saklayan evler var.`,
  },
  {
    needs: ['twice'], wants: ['who'],
    line: (c) => `O odanın kapısı ${c.yrs} yıldır kapalı. Anahtar hâlâ sende ve hâlâ cebinde taşıyorsun.`,
  },
  {
    needs: ['hostage'], wants: ['who'],
    line: (c) => `${c.who} bugün senin sofranda ${c.yrs} yılı doldurdu. Hâlâ misafir diyorsun. Kimse inanmıyor.`,
  },
  {
    needs: ['confession'],
    line: (c) => `${c.yrs} yıl önce bugün divanda doğruyu söyledin. Hâlâ ödüyorsun, ama hâlâ uyuyabiliyorsun.`,
  },
  // last resort: still names the deed, never only a date
  { line: (c) => `${c.yrs} yıl önce bugün: ${c.title}. O günü bir daha yaşamayacaksın; onunla yaşayacaksın.` },
  { line: (c) => `Takvim ${c.exact} sayfasında açık kaldı: "${c.title}". Kapatmadın.` },
  { line: (c) => `Bugün ${c.exact} gününün ${c.yrs}. yılı. "${c.title}." Kâtibin bunu deftere yazarken sana bakmamıştı.` },
  { line: (c) => `${c.yrs} yıl. "${c.title}." O gün ne giydiğini hatırlıyorsun. Kaç kişi öldüğünü hatırlamıyorsun.` },
];

/** What a still-vengeful person does with an anniversary. */
export const GRUDGE_LINES = [
  (name, yrs, what) => `${name} bugün ${yrs} yıl öncesini yeniden anlattı. Anlatırken kimse sözünü kesmedi.`,
  (name, yrs, what) => `${name} ${yrs}. yılında bile aynı cümleyi kuruyor: "${what}"`,
  (name, yrs, what) => `${name} bu sabah oğluna ${yrs} yıl önce olanları anlattı. O defter kapanmıyor.`,
];

// --- what it sounds like when a secret leaks one more inch ------------------
export const SECRET_WHISPERS = [
  (who, what, yrs) => `${who} bugün sana uzun uzun baktı. ${yrs} yıldır kimsenin bakmadığı gibi.`,
  (who, what, yrs) => `${who}, ${yrs} yıl önceki o geceyi soran birine rastlamış. Sana söylemedi; başkasına söyledi.`,
  (who, what, yrs) => `Bir kâtip eski defterleri karıştırıyor. ${who} ona yardım ediyor. ${yrs} yıl önceki sayfada durdular.`,
  (who, what, yrs) => `${who} artık senin yanında yüksek sesle konuşuyor. Bir şey biliyor ve bildiğini bilmeni istiyor.`,
];

export const SECRET_LABEL = {
  murder: 'işlediğin bir cinayet',
  kinslay: 'kendi kanından birini öldürdüğün',
  poison: 'bir kadehe kattığın şey',
  oath: 'bozduğun bir yemin',
  bastard: 'kimin çocuğu olduğu',
  lie: 'deftere yazdırdığın yalan',
  theft: 'kesenden çıkmayan altın',
};

// ===========================================================================
// THE ECHOES
// ===========================================================================
export const ECHOES = [

// --- 1. The son of the man you killed --------------------------------------
{
  id: 'son_of_the_slain',
  weightHint: 0.95,
  chance: 0.75,
  cooldown: 10 * 365,
  find(api) {
    const { S, ch, age, yearsSince, deeds, isKin } = api;
    // The ledger outlives the man who wrote it: a murder your father committed
    // is still your debt, because the dead man's son does not care who is on
    // the chair now.
    const byLedger = deeds('blood').filter((m) => m.victimId && yearsSince(m.day) >= 7);
    const seen = new Set(byLedger.map((m) => m.victimId));
    const byHand = Object.values(S.chars).filter((c) =>
      c.deathDay != null && c.killerId === S.playerId && !seen.has(c.id) && yearsSince(c.deathDay) >= 7)
      .map((c) => ({ victimId: c.id, day: c.deathDay, _synthetic: true }));
    for (const m of [...byLedger, ...byHand]) {
      const v = ch(m.victimId);
      if (!v || v.deathDay == null) continue;
      const heirs = (v.childrenIds || []).map(ch).filter((k) =>
        k && k.deathDay == null && age(k) >= 16 && k.id !== S.playerId && !isKin(S.playerId, k.id));
      if (!heirs.length) continue;
      const son = heirs.sort((a, b) => a.birthDay - b.birthDay)[0];
      return { memory: m._synthetic ? null : m, victim: v, son, day: m.day };
    }
    return null;
  },
  fire(ctx, api) {
    const { victim, son, day } = ctx;
    const { S, offer, STAKE, fullName, age, ageAt, exactPhrase, wholeYearsSince, whenPhrase,
      player, remember, imprint, kill, skill, sceneOf, vassalsOf, realmLevy } = api;
    const p = player();
    const yrs = wholeYearsSince(day);
    const thenAge = Math.max(0, ageAt(son.birthDay, day));
    const price = Math.round(60 + yrs * 14 + realmLevy(p.id) * 0.02);
    const men = 400 + yrs * 90;

    offer({
      kind: 'war',
      title: 'Babasının Yüzü',
      targetId: son.id,
      scene: sceneOf(son.id) || sceneOf(p.id),
      framing: `${exactPhrase(day)} sabahı ${fullName(victim)} senin yüzünden nefes almayı bıraktı. O gün oğlu ${son.name} ${thenAge} yaşındaydı. Bugün ${age(son)} ve sınırının üç fersah ötesinde ${men} adamla oturuyor.`,
      body: `Casusun tek bir cümle getirdi: "Adınızı sormuyor efendim. Sadece nerede olduğunuzu soruyor."\n\n${yrs} yıl. Sen bu kadar zamanın bir şeyi çürüteceğini sanmıştın. Bazı şeyler çürümez; sertleşir.\n\nÇadırının önünde babasının sancağı var. O sancağı sen indirmiştin.`,
      options: [
        {
          key: 'blood_price', label: 'Kan bedeli gönder.',
          detail: `${price} altın ve babasının kılıcı. Para bazen yeter. Bazen sadece adresini doğrular.`,
          cost: [{ kind: STAKE.GOLD, value: price }],
          stakes: [{ kind: STAKE.GOLD, value: price }, { kind: STAKE.REPUTATION }],
          waitDays: 210, odds: 0.55, tone: 'neutral',
          tells: [
            { at: 0.35, text: () => `Elçin geri döndü. Kese boş, at yorgun. "Aldı," diyor. Başka bir şey demiyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.75, text: () => `${TR.gen(son.name)} ordusu yerinden kalktı. Hangi yöne gittiğini yarın öğreneceksin.`, goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              remember(son.id, S.playerId, 'Babasının kanını ödedin.', +30, 45);
              imprint({ kind: 'peace', title: 'Kan bedeli ödendi', text: `${fullName(son)} babasının bedelini senden aldı.`, weight: 0.35, targetId: son.id, tags: ['blood_price', 'settled'] });
              return { beat: 'aldı', title: 'Kılıcı Geri Aldı', text: `${fullName(son)} keseyi açmadı bile. Kılıcı aldı, kınından çıkardı, baktı ve geri koydu.\n\nAdamları dağıldı. Kendisi kalede kaldı.\n\nBu barış değil. Bu, ertelenmiş bir şey.`, effects: [`${price} altın gitti`, `<b>${son.name}</b> +30 — şimdilik`] };
            }
            remember(son.id, S.playerId, 'Babasının kanını parayla kapatmaya çalıştı.', -50, 60);
            imprint({ kind: 'war', title: `${fullName(son)} sınırı geçti`, text: `Kan bedelini aldı ve yine de geldi.`, weight: 0.6, targetId: son.id, tags: ['grudge', 'war', 'blood_debt'] });
            return { beat: 'yetmedi', title: 'Parayı Aldı, Yine de Geldi', text: `Keseyi köyün meydanında açtı ve altını halka dağıttı.\n\n"Babamın fiyatı buymuş," demiş. "Ucuzmuş."\n\nSınırdaki üç köyün dumanı buradan görünüyor.`, effects: [`${price} altın gitti — <b>karşılıksız</b>`, `<b>${son.name}</b> −50`, 'Sınırda üç köy yandı'] };
          },
        },
        {
          key: 'meet', label: 'Onu yalnız karşıla.',
          detail: 'Silahsız. Ortada. Babasının öldüğü yaştasın sen de.',
          confirm: `${fullName(son)} ile silahsız buluşacaksın.`,
          stakes: [{ kind: STAKE.LIFE, who: 'senin' }, { kind: STAKE.REPUTATION }],
          waitDays: 45, odds: Math.min(0.78, 0.34 + skill(p, 'diplomacy') * 0.035),
          tone: 'grave',
          tells: [{ at: 0.6, text: 'Buluşma yerini o seçti. Babasının gömüldüğü tepe.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              me.prestige += 90;
              remember(son.id, S.playerId, 'Karşısına silahsız çıktı.', +45, 50);
              imprint({ kind: 'oath', title: 'Tepede bir söz', text: `${fullName(son)} ile babasının mezarı başında konuştunuz.`, weight: 0.45, targetId: son.id, tags: ['settled', 'oath', 'witnessed'] });
              return { beat: 'konuştunuz', title: 'Tepede İki Adam', text: `Sana babasının nasıl öldüğünü sordu. Yalan söylemedin. Bu, gününü kurtaran tek şey oldu.\n\nUzun sustu. Sonra: "Sen de bir oğul bıraktın mı?"\n\nCevap vermeden ayrıldı. Ordusu ertesi sabah dağıldı.`, effects: ['+90 itibar', `<b>${son.name}</b> +45`, 'Sana bir soru sordu, hâlâ cevaplamadın'] };
            }
            me.health -= 1.5;
            if (!me.traits.includes('scarred')) me.traits.push('scarred');
            imprint({ kind: 'wound', title: 'Tepedeki pusu', text: `${fullName(son)} seni babasının mezarı başında bıçakladı.`, weight: 0.65, irreversible: true, targetId: son.id, tags: ['blood_debt', 'grudge', 'wound'] });
            return { beat: 'bıçak', title: 'Mezar Başında', knell: true, text: `Kucaklaşmak için kollarını açtı. Bıçağı sol elindeydi.\n\nAdamların onu yakalayamadı. Sen ayakta kaldın ama yüzünde bir çizgi var artık; her ayna sana onun babasını hatırlatacak.`, effects: ['<b>Yaralı</b> — sağlığın kalıcı olarak düştü', 'Yüzünde bir iz', `<b>${son.name}</b> kaçtı`] };
          },
        },
        {
          key: 'bury_too', label: 'Onu da göm.',
          detail: 'Bir kere yaptın. İkincisi hep daha kolaydır ve hep daha pahalıdır.',
          confirm: `${fullName(son)} de mi?`,
          cost: [{ kind: STAKE.GOLD, value: 70 }],
          stakes: [{ kind: STAKE.LIFE, who: fullName(son) }, { kind: STAKE.SECRET }, { kind: STAKE.SOUL }],
          waitDays: 100, odds: Math.min(0.80, 0.30 + skill(p, 'intrigue') * 0.045),
          tone: 'dark',
          tells: [
            { at: 0.4, text: 'Adamın haber yolladı: oğlan yemeğini kendisi pişiriyor. Babasından öğrenmiş.', goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: 'Sınırdaki sancak üç gündür inmedi. Ne kalktı ne indi.', goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              kill(son, 'murder', me.id);
              me.secrets.push({ id: `sec_${son.id}`, kind: 'murder', victimId: son.id, day: S.day });
              return { beat: 'iki mezar', title: 'Baba ve Oğul', knell: true, text: `Aynı toprağa gömdüler. Yan yana.\n\nCenazede kimse ağlamadı çünkü geriye ağlayacak kimse kalmamıştı. Bunu sen yaptın; iki kuşağı bir aileden sildin.\n\nİkinci sır ilkinden ağır. İkisi bir arada taşınmıyor.`, effects: [`<b>${son.name}</b> öldü`, '<b>İkinci sır</b> — daha da ağır', 'O hanenin adı bitti'] };
            }
            me.prestige -= 180;
            if (!me.traits.includes('oathbreaker')) me.traits.push('oathbreaker');
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Bir yetimi öldürtmeye kalktı.', -35, 45);
            imprint({ kind: 'scandal', title: 'İkinci suikast ele geçti', text: `Adamın yakalandı ve konuştu.`, weight: 0.7, irreversible: true, targetId: son.id, tags: ['scandal', 'blood_debt', 'public'] });
            return { beat: 'ele geçti', title: 'Adamın Konuştu', knell: true, text: `Onu ${TR.gen(son.name)} çadırının önünde yakaladılar. Üç gün dayandı, dördüncü gün senin adını verdi.\n\nŞimdi herkes biliyor: babayı da sen öldürmüştün.`, effects: ['<b>Sözünden Dönen</b> damgası', '−180 itibar', 'Tüm vassalların −35', 'Artık sır değil'] };
          },
        },
      ],
    });
  },
},

// --- 2. The town whose granaries you kept shut ------------------------------
{
  id: 'shut_granary',
  weightHint: 0.85,
  chance: 0.7,
  cooldown: 12 * 365,
  find(api) {
    const { pv, deeds, yearsSince, S } = api;
    for (const m of deeds('denied_relief')) {
      if (yearsSince(m.day) < 5) continue;
      const prov = m.provinceId ? pv(m.provinceId) : null;
      if (!prov) continue;
      return { memory: m, prov };
    }
    return null;
  },
  fire(ctx, api) {
    const { memory: m, prov } = ctx;
    const { S, offer, STAKE, player, whenPhrase, exactPhrase, wholeYearsSince, provinceIdxOf,
      imprint, remember, vassalsOf, incomeOf, makeCharacter, fullName, age, realmLevy } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    // Ten years late, mercy is not cheaper; it is dearer, and everyone knows it.
    const relief = Math.max(90, Math.round(incomeOf(p.id) * 16 + yrs * 12));
    // The revolt has a face and a name. It always has to have a name.
    const leader = makeCharacter({ culture: prov.culture, faith: prov.faith, sex: 'm', skillMean: 7, traits: ['vengeful', 'brave'] });
    leader.courtOf = null; leader.birthDay = S.day - (18 + yrs) * 365;

    prov.unrest = Math.min(100, (prov.unrest || 0) + 45);

    offer({
      kind: 'war',
      title: `${prov.name} Ayağa Kalktı`,
      targetId: leader.id,
      scene: { provinceIdx: provinceIdxOf(prov.id) },
      framing: `${whenPhrase(m.day)} ${TR.gen(prov.name)} ambarlarını kapalı tuttun. O kış nüfusun üçte biri gitti. Bugün aynı ambarın önünde ${prov.name} halkı var ve kapıyı bu sefer sormadan kırdılar.`,
      body: `Başlarındaki adam ${fullName(leader)}. ${age(leader)} yaşında. O kış ${Math.max(1, age(leader) - yrs)} yaşındaydı ve annesini gömdü.\n\nKâhyan konuşuyor: "Efendim, ${exactPhrase(m.day)} tarihli emri hâlâ saklıyorlar. Mührünüz üstünde."\n\nBir kâğıt on yıl sonra da mühürlüdür.`,
      options: [
        {
          key: 'crush', label: 'Bastır.',
          detail: 'Aç bir kalabalık iyi dövüşmez. Ama uzun hatırlar.',
          confirm: `${prov.name} halkının üstüne asker mi süreceksin?`,
          cost: [{ kind: STAKE.GOLD, value: 40 }],
          stakes: [{ kind: STAKE.LIFE, who: `${prov.name} halkının` }, { kind: STAKE.SOUL }],
          waitDays: 120, odds: 0.78,
          tells: [{ at: 0.5, text: () => `Serdarın haber yolladı: "Karşımızdakiler asker değil efendim. Ne yapayım?"`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            prov.unrest = ok ? 60 : 95;
            prov.development = Math.max(1, prov.development - 2);
            me.piety = Math.max(0, me.piety - 80);
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, `${TR.acc(prov.name)} iki kez cezalandırdı.`, -22, 40);
            imprint({
              kind: 'blood', title: `${prov.name} bastırıldı`,
              text: `${TR.loc(prov.name)} isyanı kılıçla kapattın. İkinci kez.`,
              weight: 0.7, irreversible: true, provinceId: prov.id, targetId: leader.id,
              tags: ['denied_relief', 'blood', 'grudge', 'repression'],
            });
            if (ok) {
              api.kill(leader, 'execution', me.id);
              return { beat: 'bastırdın', title: 'Meydanda Bir Darağacı', text: `${fullName(leader)} kalabalığın ortasında asıldı. Kimse bağırmadı. Bu, bağırmadıkları için daha kötüydü.\n\nAmbar yine kapalı. Kapı yeni. Mühür aynı.`, effects: [`<b>${leader.name}</b> idam edildi`, `${prov.name} −2 kalkınma`, '−80 dindarlık', 'Tüm vassalların −22'] };
            }
            return { beat: 'bastıramadın', title: 'Askerin Ateş Etmedi', text: `Adamlarının yarısı o kasabadan. Kalabalığın içinde kardeşlerini gördüler.\n\nSerdarın geri döndü ve gözünün içine bakmadı.`, effects: [`${prov.name} elinde değil`, `<b>${leader.name}</b> hayatta ve şimdi bir bayrağı var`, '−80 dindarlık'] };
          },
        },
        {
          key: 'open_now', label: 'Ambarları şimdi aç.',
          detail: `${relief} altın — o kış istenenin üç katı. ${yrs} yıl geç bir cömertlik, cömertlik sayılır mı?`,
          cost: [{ kind: STAKE.GOLD, value: relief }],
          stakes: [{ kind: STAKE.GOLD, value: relief }, { kind: STAKE.REPUTATION }],
          disabled: p.gold < relief, disabledWhy: `${relief} altının yok`,
          waitDays: 150, odds: 0.48,
          tells: [{ at: 0.5, text: () => `${TR.abl(prov.name)} haber: buğdayı aldılar. Teşekkür eden olmadı.`, goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            prov.unrest = ok ? 15 : 70;
            imprint({
              kind: 'relief', title: `${TR.dat(prov.name)} geç gelen buğday`,
              text: `${TR.gen(prov.name)} ambarlarını, on yıl geç, açtın.`,
              weight: 0.45, provinceId: prov.id, tags: ['late_relief', ok ? 'settled' : 'grudge'],
            });
            if (ok) {
              prov.development += 1;
              return { beat: 'yetti', title: 'Geç, Ama Geldi', text: `Kalabalık dağıldı. ${fullName(leader)} en son gitti ve giderken ambara değil, sana baktı.\n\nBir yaşlı kadın kâhyana şunu söylemiş: "O kış da bu buğday vardı."`, effects: [`${relief} altın gitti`, `${prov.name} sakinleşti`, 'Ama sözü kayda geçti'] };
            }
            return { beat: 'geçti', title: 'Artık İstemiyorlar', text: `Buğdayı aldılar ve dağılmadılar.\n\n"Bu bizim zaten," dedi biri. "On yıl önce de bizimdi."\n\nAltının gitti. Kalabalık duruyor.`, effects: [`${relief} altın gitti — <b>karşılıksız</b>`, `${prov.name} hâlâ ayakta`] };
          },
        },
        {
          key: 'go_there', label: 'Oraya kendin git.',
          detail: 'Muhafızsız. O ambarın önünde durup konuş. Ya dinlerler ya taşlarlar.',
          confirm: `${TR.gen(prov.name)} ortasına muhafızsız çıkacaksın.`,
          cost: [{ kind: STAKE.PRESTIGE, value: 30 }],
          stakes: [{ kind: STAKE.LIFE, who: 'senin' }, { kind: STAKE.REPUTATION }],
          waitDays: 60, odds: Math.min(0.72, 0.28 + api.skill(p, 'diplomacy') * 0.038),
          tone: 'grave',
          tells: [{ at: 0.55, text: () => `Yola çıktın. ${TR.dat(prov.name)} bir günlük mesafede bir çocuk atının önüne taş attı.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              me.prestige += 140; prov.unrest = 10;
              remember(leader.id, me.id, 'Ambarın önünde karşımıza dikildi.', +25, 30);
              imprint({ kind: 'reckoning', title: `${prov.name} ambarının önünde`, text: `${TR.gen(prov.name)} ortasında, açtırdığın kapının önünde durdun.`, weight: 0.55, provinceId: prov.id, targetId: leader.id, tags: ['faced_it', 'settled', 'witnessed'] });
              return { beat: 'durdun', title: 'Kapının Önünde', text: `Kalabalık açıldı, sen ambara kadar yürüdün ve arkanı dönüp durdun.\n\n"O emri ben verdim," dedin. Başka bir şey demedin.\n\n${fullName(leader)} elindeki taşı yere bıraktı. Herkes gördü.`, effects: ['+140 itibar', `${prov.name} yatıştı`, 'Bunu anlatacaklar'] };
            }
            me.health -= 1; me.stress += 30;
            if (!me.traits.includes('humbled')) me.traits.push('humbled');
            imprint({ kind: 'shame', title: `${TR.loc(prov.name)} taşlandın`, text: `${prov.name} halkı seni kendi ambarının önünde taşladı.`, weight: 0.6, irreversible: true, provinceId: prov.id, tags: ['humiliation', 'public', 'grudge'] });
            return { beat: 'taşladılar', title: 'İlk Taş Bir Çocuktan Geldi', knell: true, text: `Ağzını açmana fırsat vermediler.\n\nMuhafızların seni sürükleyerek çıkardı. Bir hükümdarın kendi toprağından sürüklenerek çıkması, bu ülkede daha önce olmamıştı.\n\nOlmuş oldu.`, effects: ['<b>Ezik</b> damgası', '+30 gerginlik', `${prov.name} elinde değil`] };
          },
        },
      ],
    });
  },
},

// --- 3. The second child's fever -------------------------------------------
{
  id: 'second_fever',
  weightHint: 1.0,
  chance: 0.8,
  cooldown: 9 * 365,
  find(api) {
    const { S, ch, deeds, yearsSince, player, livingChildren, age } = api;
    const p = player();
    if (!p) return null;
    // A choice you made counts sooner than a fever nobody could have stopped.
    const grief = deeds('child_lost').filter((m) => m.victimId && ch(m.victimId) &&
      yearsSince(m.day) >= (m.tags.includes('decision') ? 2 : 4));
    if (!grief.length) return null;
    const kids = livingChildren(p).filter((k) => age(k) < 15 && k.id !== grief[grief.length - 1].victimId);
    if (!kids.length) return null;
    const m = grief[grief.length - 1];
    return { memory: m, dead: ch(m.victimId), kid: kids[0], lost: deeds('child_lost').length };
  },
  fire(ctx, api) {
    const { memory: m, dead, kid, lost = 1 } = ctx;
    const { S, offer, STAKE, player, fullName, exactPhrase, wholeYearsSince, ageAt,
      sceneOf, imprint, kill, remember } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const sentAway = m.tags.includes('physician_dismissed') || m.tags.includes('chose:pray');
    const bled = m.tags.includes('chose:bleed');
    const deadAge = Math.max(0, ageAt(dead.birthDay, m.day));

    const lastTime = sentAway
      ? `Geçen sefer hekimi sen gönderdin. Kapıdan çıkarken sana bakmıştı; o bakışı ${yrs} yıldır taşıyorsun.`
      : bled
        ? `Geçen sefer kan aldırdın. Leğeni hâlâ bu evde bir yerlerde.`
        : lost >= 3
          ? `Geçen sefer hiçbir şey yapamadın. Ondan önceki sefer de. Bu evde artık ne yaptığın değil, kaç kez yapamadığın sayılıyor.`
          : `Geçen sefer ne yaptıysan yetmedi. Ne yaptığını bugün bile tam hatırlamıyorsun; bu da bir ceza.`;

    offer({
      kind: 'event',
      title: 'Aynı Oda',
      targetId: kid.id,
      scene: sceneOf(p.id),
      framing: lost >= 2
        ? `${kid.name} üç gündür ateşli. Aynı oda. Bu odada senin ${lost} çocuğun yattı ve ${lost === 2 ? 'ikisi' : 'hiçbiri'} ayağa kalkmadı. Hizmetkârlar buraya artık adıyla değil, "o oda" diyor.`
        : `${kid.name} üç gündür ateşli. Aynı oda. Aynı pencere. Aynı dadı — ve dadı bu sefer sana bakmıyor.`,
      body: `${dead.name} bu odada öldü. ${exactPhrase(m.day)}. ${deadAge < 1 ? 'Daha kundaktaydı' : `${deadAge} yaşındaydı`}. Aradan ${yrs} yıl geçti ve yatağın yeri değişmedi.\n\n${lastTime}\n\nHekim kapıda bekliyor. İçeri girmek için senin bir kelimeni bekliyor. Bu sefer hangi kelime?`,
      options: [
        {
          key: 'physician', label: 'Hekimi içeri al.',
          detail: sentAway ? 'Geçen sefer göndermiştin. Bu sefer alacaksın. Aynı hekim.' : 'Aynı yol. Aynı bıçak. Aynı ihtimal.',
          cost: [{ kind: STAKE.GOLD, value: 45 }],
          stakes: [{ kind: STAKE.KIN, who: kid.name }],
          waitDays: 24, odds: sentAway ? 0.68 : 0.60,
          tells: [
            { at: 0.4, text: () => `${kid.name} gece boyunca ${TR.gen(dead.name)} adını sayıkladı. O ismi bu evde kim söyledi ki?`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: () => `Hekim odadan çıktı, elini yıkadı, geri girdi. Hiçbir şey söylemedi.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            if (ok) {
              imprint({ kind: 'mercy', title: `${kid.name} kurtuldu`, text: `${TR.acc(dead.name)} kaybettiğin odada ${kid.name} yaşadı.`, weight: 0.5, victimId: kid.id, tags: ['grief', 'spared', 'second_chance'] });
              return { beat: 'yaşadı', title: `${kid.name} Sabaha Çıktı`, text: `Ateş dördüncü gecenin sonunda kırıldı.\n\nHekim eşyalarını toplarken durdu: "Öbür sefer de elimden geleni yapmıştım efendim."\n\nBu cümleyi ${yrs} yıl beklemişsin.`, effects: [`<b>${kid.name}</b> iyileşti`, `${TR.gen(dead.name)} odası artık sadece bir oda`] };
            }
            kill(kid, 'illness'); S.stats.kin_lost++;
            player().stress += 35;
            imprint({ kind: 'grief', title: `${kid.name} ${TR.da(kid.name)} öldü`, text: `${TR.gen(dead.name)} öldüğü odada ${kid.name} ${TR.da(kid.name)} öldü. Aradan ${yrs} yıl.`, weight: 0.9, irreversible: true, victimId: kid.id, tags: ['grief', 'child_lost', 'kin', 'twice'] });
            return { beat: 'ikinci', title: `Aynı Odada, İkinci Kez`, knell: true, text: `Sabaha karşı oldu. İlkindeki gibi.\n\nDadı odayı temizlemedi; kapıyı kapatıp anahtarı sana verdi.\n\nBu evde artık kapalı bir oda var ve içinde iki çocuk var.`, effects: [`<b>${kid.name}</b> öldü`, '+35 gerginlik', 'O oda bir daha açılmayacak'] };
          },
        },
        {
          key: 'pray_again', label: sentAway ? 'Yine dua et.' : 'Hekimi gönder, dua et.',
          detail: sentAway ? 'Aynı duayı aynı Tanrı’ya. Bir de böyle deneyeceksin.' : 'Bir kez de öbür türlü.',
          stakes: [{ kind: STAKE.KIN, who: kid.name }, { kind: STAKE.SOUL }],
          waitDays: 30, odds: sentAway ? 0.38 : 0.46,
          tells: [{ at: 0.5, text: () => `Üç gecedir aynı yerde diz çöküyorsun. Kimse yanına yaklaşmıyor; ${yrs} yıl önce de yaklaşmamışlardı.`, goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              me.piety += 150;
              imprint({ kind: 'mercy', title: `${kid.name} kaldı`, text: `İkinci sefer duan tutuldu.`, weight: 0.5, victimId: kid.id, tags: ['grief', 'spared', 'faith'] });
              return { beat: 'tutuldu', title: `${kid.name} Gözlerini Açtı`, text: `Sabah odaya girdiğinde oturmuş, pencereden dışarı bakıyordu.\n\nNeden bu sefer diye sormadın. Sorarsan cevabı öğrenirsin diye korkuyorsun.`, effects: [`<b>${kid.name}</b> iyileşti`, '+150 dindarlık'] };
            }
            kill(kid, 'illness'); S.stats.kin_lost++;
            me.stress += 45;
            imprint({ kind: 'grief', title: `${kid.name} ${TR.da(kid.name)} öldü`, text: `İki çocuk, aynı oda, aynı karar.`, weight: 0.95, irreversible: true, victimId: kid.id, tags: ['grief', 'child_lost', 'kin', 'twice', 'physician_dismissed'] });
            return { beat: 'ikinci', title: 'İkinci Kez Aynı Kararı Verdin', knell: true, text: `Hekim avluda bekliyordu. Çağırmadın. ${yrs} yıl önce de çağırmamıştın.\n\nBir insan aynı hatayı iki kez yaparsa ona hata denmez. Karakter denir.\n\nBunu sen de biliyorsun. Asıl acı burada.`, effects: [`<b>${kid.name}</b> öldü`, '+45 gerginlik', 'İki kez aynı kararı verdin'] };
          },
        },
      ],
    });
  },
},

// --- 4. The daughter who will not have your son ----------------------------
{
  id: 'refused_daughter',
  weightHint: 0.7,
  chance: 0.65,
  cooldown: 10 * 365,
  find(api) {
    const { S, ch, deeds, yearsSince, player, livingChildren, age, childrenOf } = api;
    const p = player();
    if (!p) return null;
    for (const m of deeds('humiliation')) {
      if (yearsSince(m.day) < 4 || !m.targetId) continue;
      const v = ch(m.targetId);
      if (!v || v.deathDay != null) continue;
      const daughters = childrenOf(v).filter((k) => k.deathDay == null && k.sex === 'f' && age(k) >= 14 && age(k) <= 34);
      const sons = livingChildren(p).filter((k) => k.sex === 'm' && age(k) >= 14 && age(k) <= 45 && !k.spouseId);
      if (daughters.length && sons.length) return { memory: m, vassal: v, girl: daughters[0], son: sons[0] };
    }
    return null;
  },
  fire(ctx, api) {
    const { memory: m, vassal, girl, son } = ctx;
    const { S, offer, STAKE, player, fullName, age, whenPhrase, exactPhrase, wholeYearsSince,
      sceneOf, imprint, remember, vassalsOf, directCountiesOf, grantTitle, titleName, ti } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const dowryTitle = directCountiesOf(p.id).slice(-1)[0] || null;

    offer({
      kind: 'event',
      title: 'Reddedilen Nikâh',
      targetId: vassal.id,
      scene: sceneOf(vassal.id) || sceneOf(p.id),
      framing: `${fullName(vassal)} kızını senin oğluna vermeyi reddetti. Mektup dört satır: "${whenPhrase(m.day)} divanınızda ayakta bırakıldım. Kızım o adamın oğluna varmaz."`,
      body: `${exactPhrase(m.day)}. O gün salonda kırk kişi vardı ve sen kazandın. ${yrs} yıl sürdü kazandığın şeyin faturasının gelmesi.\n\n${son.name} ${age(son)} yaşında ve mektubu senden önce o okudu. Sana bir şey söylemedi. Söylememesi konuşmasından beter.\n\n${girl.name} ${age(girl)} yaşında. Onu hiç görmedin.`,
      options: [
        {
          key: 'press', label: 'Zorla. O senin vassalın.',
          detail: 'Bir kız bir yemin değildir. Ama bir baba bir ordudur.',
          cost: [{ kind: STAKE.PRESTIGE, value: 40 }],
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 180, odds: 0.44,
          tells: [{ at: 0.5, text: () => `${vassal.name} bu ay üç komşusunu ağırladı. Üçü de sana borçlu değil.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            remember(vassal.id, S.playerId, 'Kızını zorla istedi.', -45, 45);
            remember(girl.id, S.playerId, 'Beni pazarlık masasına koydu.', -55, 60);
            if (ok) {
              girl.spouseId = son.id; son.spouseId = girl.id;
              imprint({ kind: 'marriage', title: `${son.name} ile ${girl.name}`, text: `Nikâh zorla kıyıldı; gelin ağlamadı, gülmedi de.`, weight: 0.5, targetId: girl.id, tags: ['marriage', 'forced', 'grudge_seed'] });
              return { beat: 'kıyıldı', title: 'Nikâh Kıyıldı', text: `Gelin salona girerken kimseye bakmadı. ${TR.gen(son.name)} yanına oturdu ve elini vermedi.\n\nBu evlilikten bir çocuk olacak. O çocuk annesinin anlattıklarıyla büyüyecek.`, effects: [`<b>${girl.name}</b> gelinin oldu`, `<b>${vassal.name}</b> −45`, 'Gelinin sana bakışı: düşman'] };
            }
            vassal.faction = 'claimant';
            for (const o of vassalsOf(S.playerId)) remember(o.id, S.playerId, 'Vassalının kızını zorla istedi.', -20, 30);
            imprint({ kind: 'feud', title: `${fullName(vassal)} ile husumet`, text: `Kızını zorla istedin, vermedi.`, weight: 0.55, targetId: vassal.id, tags: ['grudge', 'feud', 'public'] });
            return { beat: 'vermedi', title: 'Kızı Manastıra Verdi', knell: false, text: `Sana vermemek için kızını kiliseye kapattı. "Tanrı'ya varsın, ona varmaz," demiş.\n\nBunu duymayan kalmadı. Vassalların kendi kızlarını saydılar.`, effects: [`<b>${vassal.name}</b> ayaklanmaya hazırlanıyor`, 'Tüm vassalların −20', '−40 itibar boşa gitti'] };
          },
        },
        {
          key: 'withdraw', label: 'Geri çek. Sessizce.',
          detail: 'Oğlun bunu ömrü boyunca bilecek. Senin yüzünden.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            remember(son.id, S.playerId, 'Divanda yaptığın şeyin bedelini ben ödedim.', -40, 50);
            player().prestige -= 60;
            imprint({ kind: 'shame', title: `${son.name} geri çevrildi`, text: `Oğlunun nikâhı, senin ${yrs} yıl önceki öfken yüzünden bozuldu.`, weight: 0.5, targetId: son.id, tags: ['humiliation', 'kin', 'grudge_seed', 'inherited'] });
            return { success: true, beat: 'çektin', title: 'Mektuba Cevap Yazılmadı', text: `Elçiyi geri gönderdin, mektuba cevap yazmadın.\n\n${son.name} o akşam sofraya gelmedi. Ertesi akşam geldi ve bir şey sormadı.\n\nBir gün soracak. O gün de cevabın olmayacak.`, effects: [`<b>${son.name}</b> −40 — kendi oğlun`, '−60 itibar', 'Oğlun senin borcunu ödedi'] };
          },
        },
        {
          key: 'dowry', label: dowryTitle ? `${TR.acc(dowryTitle.name)} drahoma yap.` : 'Ağır bir drahoma teklif et.',
          detail: dowryTitle ? 'Toprak, gururdan ucuzdur. Ama toprak geri gelmez.' : 'Altın konuşur; toprak bağırır.',
          cost: dowryTitle ? [] : [{ kind: STAKE.GOLD, value: 120 }],
          stakes: dowryTitle ? [{ kind: STAKE.TITLE, who: titleName(dowryTitle), irreversible: true }] : [{ kind: STAKE.GOLD, value: 120 }],
          disabled: !dowryTitle && p.gold < 120, disabledWhy: '120 altının yok',
          waitDays: 90, odds: 0.72,
          tells: [
            { at: 0.4, text: () => `${vassal.name} teklifi aldı ve elçini üç gün kapıda bekletti. Sonra içeri aldı.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: () => `${girl.name} bu hafta iki kez kiliseye/mescide gitmiş. Yalnız.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onCommit() {
            if (dowryTitle) grantTitle(dowryTitle.id, vassal.id, 'dowry');
          },
          onResolve(d, ok) {
            if (ok) {
              girl.spouseId = son.id; son.spouseId = girl.id;
              remember(vassal.id, S.playerId, 'Kızı için toprak verdi.', +40, 40);
              return { beat: 'satın aldın', title: 'Nikâh Var', text: `${fullName(vassal)} kabul etti ve kabul ederken gülümsedi.\n\n"${whenPhrase(m.day)} bana bir şey borçluydunuz," dedi. "Ödendi."\n\nBorcunu o belirledi. Sen sadece ödedin.`, effects: [dowryTitle ? `<b>${titleName(dowryTitle)}</b> kalıcı olarak gitti` : '120 altın gitti', `<b>${girl.name}</b> gelinin oldu`, `<b>${vassal.name}</b> +40`] };
            }
            imprint({ kind: 'feud', title: `${fullName(vassal)} drahomayı da reddetti`, text: `Toprağı aldı, kızı vermedi.`, weight: 0.6, targetId: vassal.id, tags: ['grudge', 'feud', 'robbed'] });
            return { beat: 'yine hayır', title: 'Toprağı Aldı, Kızı Vermedi', text: `"Toprak borcunuzdu," diye yazmış. "Kızım borcum değil."\n\nElinde ne varsa aldı. Elinde kalan tek şey, ${yrs} yıl önce herkesin önünde kazandığın o an.`, effects: [dowryTitle ? `<b>${titleName(dowryTitle)}</b> gitti — karşılıksız` : '120 altın gitti — karşılıksız', 'Nikâh yok'] };
          },
        },
      ],
    });
  },
},

// --- 5. The letter: a secret matured into a price ---------------------------
{
  id: 'the_letter',
  weightHint: 0.9,
  chance: 0.8,
  cooldown: 8 * 365,
  find(api) {
    const { S, ch, secretsOf, secretAge, secretPressure, livingChars, opinion, skill, rng } = api;
    const secs = secretsOf(S.playerId).filter((s) => !s.buried && secretAge(s) >= 4);
    if (!secs.length) return null;
    const s = secs.reduce((a, b) => (secretPressure(b) > secretPressure(a) ? b : a));
    if (secretPressure(s) < 0.35 && !s.knownBy.length) return null;
    let who = s.knownBy.map(ch).find((c) => c && c.deathDay == null);
    if (!who) {
      const cand = livingChars().filter((c) => c.id !== S.playerId && (c.courtOf === S.playerId || c.liegeId === S.playerId));
      if (!cand.length) return null;
      who = cand.reduce((a, b) => (opinion(b.id, S.playerId) + skill(b, 'intrigue') * -2 < opinion(a.id, S.playerId) + skill(a, 'intrigue') * -2 ? b : a));
    }
    return { memory: null, secret: s, black: who };
  },
  fire(ctx, api) {
    const { secret: s, black } = ctx;
    const { S, offer, STAKE, player, fullName, ch, exactPhrase, wholeYearsSince, secretPrice, secretLabel,
      sceneOf, imprint, remember, vassalsOf, kill, skill, makeCharacter, TR } = api;
    const p = player();
    const yrs = wholeYearsSince(s.day);
    const price = secretPrice(s);
    const paid = s.paidTimes || 0;
    const prevPrice = s.lastPrice || Math.round(price / 1.6);
    s.lastPrice = price;
    const victim = s.victimId ? ch(s.victimId) : null;
    if (!s.knownBy.includes(black.id)) { s.knownBy.push(black.id); (black.hooks ||= []).push({ onId: p.id, kind: 'strong', secretId: s.id }); }

    offer({
      kind: 'scheme',
      title: 'Bir Mektup',
      targetId: black.id,
      scene: sceneOf(p.id),
      framing: paid === 0
        ? `Mektupta tek bir satır var: "${exactPhrase(s.day)}." Altında imza yok, mühür var — ${TR.gen(fullName(black))} mührü.`
        : `Aynı mühür. Aynı tarih: "${exactPhrase(s.day)}." Bu ${paid + 1}. mektup ve bu sefer zarf daha kalın.`,
      body: `${victim ? `O gün ${fullName(victim)} öldü ve nasıl öldüğünü iki kişi biliyordu. Şimdi üç.`
        : s.kind === 'lie' ? `O gün vakayinameye bir sayfa yazdırdın ve o sayfa doğru değildi. Kâtipler nüsha tutar.`
        : `O gün yaptığın şeyi kimsenin bilmemesi gerekiyordu.`}\n\nAradan ${yrs} yıl geçti. Bu ${yrs} yıl boyunca ${secretLabel(s)} senin sırtında sessizce ağırlaştı — sır bekledikçe ucuzlamaz, pahalanır.\n\n${paid ? `Geçen sefer ${prevPrice} altın istemişti. Bu sefer ${price}. Fiyatı sen belirlemiyorsun; takvim belirliyor.` : `İstediği ${price} altın. Bu yılki fiyat.`}`,
      options: [
        {
          key: 'pay', label: `Öde. ${price} altın.`,
          detail: 'Bir kez ödeyen, ömür boyu öder. Ve fiyat her yıl artar.',
          cost: [{ kind: STAKE.GOLD, value: price }],
          stakes: [{ kind: STAKE.GOLD, value: price }, { kind: STAKE.SECRET }],
          disabled: p.gold < price, disabledWhy: `${price} altının yok`,
          waitDays: 60, odds: 0.80,
          tells: [{ at: 0.6, text: () => `${black.name} bu hafta yeni bir at aldı. Senin ahırından daha iyi.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            s.paidTimes = (s.paidTimes || 0) + 1;
            imprint({ kind: 'blackmail', title: 'Sustuğu için ödedin', text: `${TR.dat(fullName(black))} ${price} altın verdin; ${exactPhrase(s.day)} için.`, weight: 0.45, targetId: black.id, tags: ['blackmail', 'paid_gold', 'secret'] });
            if (ok) return { beat: 'sustu', title: 'Şimdilik Sustu', text: `Altını aldı ve mektubu geri gönderdi. Yakmadı — geri gönderdi.\n\nBu, elinde bir kopyası olduğu anlamına geliyor. İkiniz de biliyorsunuz.\n\nGelecek yıl fiyat ${secretPrice(s)} altın olacak.`, effects: [`${price} altın gitti`, '<b>Sır duruyor</b> — ve büyüyor', `Gelecek fiyat: ~${secretPrice(s)}`] };
            s.exposure = Math.min(1, s.exposure + 0.35);
            return { beat: 'yetmedi', title: 'Bir Kişi Daha Biliyor', text: `Altını aldı ve aynı hafta bir başkasına anlattı. Muhtemelen sarhoşken. Muhtemelen kasıtlı.\n\nSır artık iki kişide. İki kişideki sır, sır değildir; sadece henüz haber olmamıştır.`, effects: [`${price} altın gitti`, 'Sırrı bir kişi daha biliyor'] };
          },
        },
        {
          key: 'silence', label: 'Sustur.',
          detail: 'Bir sırrı gömmenin bilinen tek yolu. Ve her seferinde yeni bir sır doğurur.',
          confirm: `${fullName(black)} de mi?`,
          cost: [{ kind: STAKE.GOLD, value: 50 }],
          stakes: [{ kind: STAKE.LIFE, who: fullName(black) }, { kind: STAKE.SECRET }, { kind: STAKE.SOUL }],
          waitDays: 70, odds: Math.min(0.82, 0.32 + skill(p, 'intrigue') * 0.045),
          tone: 'dark',
          tells: [{ at: 0.5, text: () => `${black.name} bu akşam da sofrada. Sana bakıp gülümsedi. Bilmiyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' }],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              kill(black, 'murder', me.id);
              me.secrets.push({ id: `sec_${black.id}`, kind: 'murder', victimId: black.id, day: S.day });
              imprint({ kind: 'blood', title: `${fullName(black)} sustu`, text: `Sırrını bilen adamı öldürttün. Şimdi iki sır var.`, weight: 0.75, irreversible: true, victimId: black.id, tags: ['blood', 'secret', 'silenced'] });
              return { beat: 'sustu', title: 'Artık Kimse Sormuyor', knell: true, text: `${fullName(black)} nehirde bulundu. Kimse çok araştırmadı; araştırmayı isteyecek kimse yoktu.\n\nBir sırrı öldürmek için bir insan öldürdün. Şimdi iki sırrın var ve ikincisi tazedir — tazeler daha çabuk kokar.`, effects: [`<b>${black.name}</b> öldü`, '<b>Yeni sır</b> — ve o da yaşlanacak', 'Eski sır gömüldü'] };
            }
            me.prestige -= 140;
            s.exposure = 1;
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Sırrını bilen adamı öldürtmeye kalktı.', -35, 45);
            imprint({ kind: 'scandal', title: 'Sır açığa çıktı', text: `${exactPhrase(s.day)} artık herkesin bildiği bir gün.`, weight: 0.8, irreversible: true, tags: ['scandal', 'public', 'secret_out'] });
            return { beat: 'açığa çıktı', title: 'Mektup Çoğaltılmış', knell: true, text: `Adamın kapıya vardığında ${black.name} çoktan gitmişti. Masada mektubun beş kopyası duruyordu; birinin üstünde senin adın yazılıydı.\n\nErtesi hafta beş kapıdan beş mektup çıktı.`, effects: ['−140 itibar', '<b>Sır artık sır değil</b>', 'Tüm vassalların −35'] };
          },
        },
        {
          key: 'confess', label: 'Kendin söyle. Bugün.',
          detail: 'Bir kez yanar, bir daha ödemezsin. Yanmak da bir tür özgürlüktür.',
          confirm: 'Herkesin önünde itiraf edeceksin.',
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.SOUL }, { kind: STAKE.OATH }],
          waitDays: 20, odds: 0.5,
          onResolve(d, ok) {
            const me = player();
            s.buried = true; s.confessed = true;
            me.prestige -= 200; me.piety += 120;
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Suçunu kendi ağzıyla söyledi.', ok ? -10 : -45, 40);
            imprint({ kind: 'confession', title: 'İtiraf', text: `${exactPhrase(s.day)} gününü divanda kendi ağzınla anlattın.`, weight: 0.75, irreversible: true, tags: ['confession', 'public', 'secret_out', 'faced_it'] });
            if (ok) return { beat: 'söyledin', title: 'Divanda Ayakta Söyledin', text: `Kimse ses çıkarmadı. Kadı gözlerini kapadı. ${black.name} mektubunu cebinden çıkarıp masaya bıraktı ve çıktı.\n\nO mektubun artık bir değeri yok. Senin de itibarın öyle.\n\nAma bu sabah uyandığında ilk defa bir şey hesaplamadın.`, effects: ['−200 itibar', '+120 dindarlık', '<b>Sır bitti</b> — bir daha kimse şantaj yapamaz', 'Vassalların −10'] };
            return { beat: 'ağırdı', title: 'Salon Boşaldı', text: `Anlatırken sesin titremedi. Salon yavaş yavaş boşaldı.\n\nİki vassalın o gece atlarını hazırlattı. Bir daha gelmediler.\n\nSır bitti. Bazı şeyler de bitti.`, effects: ['−200 itibar', '<b>Sır bitti</b>', 'Vassalların −45', 'İki vassalın gitti'] };
          },
        },
      ],
    });
  },
},

// --- 6. The land you gave to keep the peace --------------------------------
{
  id: 'land_you_gave',
  weightHint: 0.75,
  chance: 0.7,
  cooldown: 12 * 365,
  find(api) {
    const { ch, ti, deeds, yearsSince, S } = api;
    for (const m of deeds('land_given')) {
      if (yearsSince(m.day) < 8) continue;
      const t = m.titleId ? ti(m.titleId) : null;
      if (!t || !t.holderId) continue;
      const holder = ch(t.holderId);
      if (!holder || holder.deathDay != null || holder.id === S.playerId) continue;
      const original = m.targetId ? ch(m.targetId) : null;
      return { memory: m, title: t, holder, original, inherited: original ? original.id !== holder.id : false };
    }
    return null;
  },
  fire(ctx, api) {
    const { memory: m, title: t, holder, original, inherited } = ctx;
    const { S, offer, STAKE, player, fullName, age, exactPhrase, wholeYearsSince, titleName,
      sceneOf, provinceIdxOf, imprint, remember, grantTitle, vassalsOf, levyOf, kill } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const men = Math.round(levyOf(holder.id) * 0.8) || 300;

    offer({
      kind: 'event',
      title: 'Verdiğin Toprak',
      targetId: holder.id,
      scene: t.provinceId ? { provinceIdx: provinceIdxOf(t.provinceId) } : sceneOf(p.id),
      framing: `${exactPhrase(m.day)} günü ${TR.acc(t.name)} kendi elinle ${original ? TR.dat(fullName(original)) : 'ona'} verdin. ${yrs} yıl oldu. Bu yıl oradan ne vergi geldi ne asker.`,
      body: inherited
        ? `Toprağı verdiğin adam öldü. Yerine oğlu ${fullName(holder)} geçti ve o seni hiç görmedi. Onun için sen bir imza değilsin, bir isimsin — babasına toprağı "vermek zorunda kalan" adamın ismi.\n\n"Babam bunu hak etmişti," diyor. "Ben de hak ediyorum, fazlasını da."`
        : `${fullName(holder)} ${age(holder)} yaşında ve artık ${men} adam çıkarıyor. Senin verdiğin topraktan.\n\nO gün "barış ucuzdur" diye düşünmüştün. Barışın taksitleri varmış.`,
      options: [
        {
          key: 'take_back', label: 'Geri al.',
          detail: 'Verilen toprak geri alınır — ama kanla, ve herkes bakarken.',
          confirm: `${titleName(t)} için kılıç mı çekeceksin?`,
          cost: [{ kind: STAKE.GOLD, value: 90 }],
          stakes: [{ kind: STAKE.TITLE, who: titleName(t) }, { kind: STAKE.LIFE, who: fullName(holder) }, { kind: STAKE.OATH }],
          waitDays: 260, odds: 0.52,
          tells: [
            { at: 0.35, text: () => `${holder.name} kalesine kapandı. Kuşatma uzun sürecek.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.8, text: () => `Kuşatmada hastalık çıktı. Senin adamlarında.`, goodTone: 'ambiguous', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const me = player();
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Verdiği toprağı zorla geri aldı.', -30, 45);
            if (ok) {
              grantTitle(t.id, me.id, 'seize');
              imprint({ kind: 'land', title: `${titleName(t)} geri alındı`, text: `${yrs} yıl önce verdiğin toprağı zorla geri aldın.`, weight: 0.65, irreversible: true, titleId: t.id, targetId: holder.id, tags: ['seized', 'oath', 'grudge_seed'] });
              return { beat: 'aldın', title: 'Kapı Üçüncü Ayda Açıldı', text: `${fullName(holder)} teslim oldu ve teslim olurken şunu söyledi: "Bunu babama da yapardın."\n\nToprak senin. Vassallarının hepsi bunu gördü ve hepsi kendi tapularına baktı.`, effects: [`<b>${titleName(t)}</b> geri alındı`, 'Tüm vassalların −30', '90 altın gitti'] };
            }
            imprint({ kind: 'defeat', title: `${titleName(t)} kuşatması başarısız`, text: `Verdiğin toprağı geri alamadın.`, weight: 0.6, titleId: t.id, targetId: holder.id, tags: ['defeat', 'public', 'grudge'] });
            return { beat: 'alamadın', title: 'Kuşatmayı Kaldırdın', knell: false, text: `Kar erken geldi. Adamların açtı. Kuşatmayı kaldırdın ve geri döndün.\n\n${fullName(holder)} surdan bakıyordu. El salladı.`, effects: ['90 altın gitti — karşılıksız', `<b>${titleName(t)}</b> onda kaldı`, 'Tüm vassalların −30'] };
          },
        },
        {
          key: 'hostage', label: 'Oğlunu saraya iste.',
          detail: 'Misafir diyeceksin. Herkes rehin olduğunu bilecek. O çocuk da bilecek.',
          stakes: [{ kind: STAKE.REPUTATION }, { kind: STAKE.OATH }],
          waitDays: 120, odds: 0.66,
          tells: [
            { at: 0.45, text: () => `${holder.name} mektubu okumuş ve cevap yazmamış. Elçin hâlâ orada.`, goodTone: 'ambiguous', badTone: 'bad' },
            { at: 0.85, text: () => `Kuzey yolunda küçük bir kafile görülmüş. İçinde bir çocuk varmış.`, goodTone: 'good', badTone: 'ambiguous' },
          ],
          onResolve(d, ok) {
            const kid = (holder.childrenIds || []).map((id) => api.ch(id)).find((k) => k && k.deathDay == null);
            if (ok && kid) {
              kid.courtOf = S.playerId; kid.liegeId = S.playerId; kid.hostage = true;
              remember(holder.id, S.playerId, 'Oğlumu rehin aldı.', -50, 50);
              remember(kid.id, S.playerId, 'Beni babamdan aldı.', -60, 70);
              imprint({ kind: 'hostage', title: `${kid.name} sarayında`, text: `${TR.gen(fullName(holder))} oğlunu rehin olarak sarayına aldın.`, weight: 0.6, targetId: kid.id, tags: ['hostage', 'grudge_seed', 'kin_of_enemy'] });
              return { beat: 'geldi', title: 'Çocuk Geldi', text: `${kid.name} avluya girdiğinde arkasına bakmadı. ${api.age(kid)} yaşında ve bir şeyin bittiğini biliyor.\n\nVergiler ertesi ay geldi. Tam ve zamanında.\n\nO çocuk senin sofranda büyüyecek. Bu, iyi bir fikir gibi görünüyor. Şimdilik.`, effects: [`<b>${kid.name}</b> sarayında — rehin`, 'Vergiler yeniden akıyor', `<b>${holder.name}</b> −50`] };
            }
            remember(holder.id, S.playerId, 'Oğlumu istedi.', -35, 40);
            return { beat: 'vermedi', title: 'Çocuğu Vermedi', text: `"Oğlum benim yanımda büyür," diye yazmış. Tek satır.\n\nSonraki satırı yazmasına gerek kalmamış.`, effects: [`<b>${holder.name}</b> −35`, 'Vergi hâlâ gelmiyor'] };
          },
        },
        {
          key: 'let_go', label: 'Bırak gitsin.',
          detail: 'O toprak on yıl önce elinden çıktı. Bugün sadece kabul ediyorsun.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            const me = player();
            me.prestige -= 70;
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Vergi vermeyeni cezalandırmadı.', -14, 20);
            imprint({ kind: 'concession', title: `${titleName(t)} fiilen gitti`, text: `${TR.gen(t.name)} senden koptuğunu kabul ettin.`, weight: 0.45, titleId: t.id, tags: ['let_go', 'weakness'] });
            return { success: true, beat: 'bıraktın', title: 'Defterden Sildin', text: `Kâhyana ${TR.acc(t.name)} vergi defterinden silmesini söyledin. Kalemi bir an havada durdu, sonra çizdi.\n\nBir toprak iki kez kaybedilir: bir kere verildiğinde, bir kere de defterden silindiğinde.`, effects: ['−70 itibar', `<b>${titleName(t)}</b> fiilen gitti`, 'Vassalların −14'] };
          },
        },
      ],
    });
  },
},

// --- 7. The chronicler asks how to write it down ---------------------------
{
  id: 'the_chronicler',
  weightHint: 0.45,
  chance: 0.5,
  cooldown: 12 * 365,
  find(api) {
    const { S, ch, recall, yearsSince, livingChars } = api;
    // Only pages a man would rather not have written. Nobody agonises over the
    // year the harvest was good.
    const DARK = ['blood', 'grief', 'denied_relief', 'humiliation', 'oath', 'scandal',
      'land_given', 'dungeon', 'betrayal', 'secret', 'stake:soul', 'seized', 'twice', 'repression'];
    const CHOSEN = ['decision', 'blood', 'scandal', 'twice', 'repression', 'seized', 'silenced'];
    const heavy = recall((m) =>
      yearsSince(m.day) >= 3 && !m.tags.includes('recorded') && !m.tags.includes('erased') &&
      (m.title || m.headline) && m.tags.some((t) => DARK.includes(t)) &&
      m.tags.some((t) => CHOSEN.includes(t)) &&        // a page you wrote, not one that happened to you
      (m.irreversible || m.success === false || (m.weight || 0) >= 0.55));
    if (!heavy.length) return null;
    const m = heavy.reduce((a, b) => (api.memoryPull(b) > api.memoryPull(a) ? b : a));
    const scribeId = S.council?.chaplain;
    let scribe = scribeId ? ch(scribeId) : null;
    if (!scribe || scribe.deathDay != null) {
      scribe = livingChars().find((c) => c.courtOf === S.playerId && c.id !== S.playerId);
    }
    if (!scribe) return null;
    return { memory: m, scribe };
  },
  fire(ctx, api) {
    const { memory: m, scribe } = ctx;
    const { S, offer, STAKE, player, fullName, exactPhrase, wholeYearsSince, sceneOf,
      imprint, remember, livingChildren, ch } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const headline = m.headline || m.title || 'o gün';
    const detail = (m.text || '').split('\n')[0];
    const heir = livingChildren(p)[0];

    offer({
      kind: 'event',
      title: 'Vakayiname',
      targetId: scribe.id,
      scene: sceneOf(p.id),
      framing: `Kâtip ${fullName(scribe)} defteri açtı ve ${exactPhrase(m.day)} sayfasında durdu. "Efendim," diyor, "burayı nasıl yazayım?"`,
      body: `Sayfada başlık var, altı boş: "${headline}".\n\n${detail}\n\n${yrs} yıl önceydi. Bu defter senden sonra da okunacak. ${heir ? `${heir.name} okuyacak.` : 'Torunun okuyacak.'} Onların bileceği tek şey burada yazan olacak.\n\nMürekkep hazır. Kâtip bekliyor.`,
      options: [
        {
          key: 'truth', label: 'Olduğu gibi yaz.',
          detail: 'Bugün pahalı. Yarın da pahalı. Ama sadece bir kez ödenir.',
          cost: [{ kind: STAKE.PRESTIGE, value: 50 }],
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            const me = player();
            me.piety += 70;
            m.tags.push('recorded', 'public');
            imprint({ kind: 'record', title: 'Deftere doğrusu yazıldı', text: `${exactPhrase(m.day)} sayfası olduğu gibi yazıldı.`, weight: 0.4, tags: ['recorded', 'honest', 'public'] });
            return { success: true, beat: 'yazdırdın', title: 'Kâtip Yazdı', text: `Yazarken bir kez durdu, sana baktı, sen başını salladın. Devam etti.\n\nSayfayı kuruttu, kapattı ve şunu söyledi: "Efendim, bunu yazan ilk hükümdar siz oldunuz."\n\nBu bir iltifat değildi. Bir tespitti.`, effects: ['−50 itibar', '+70 dindarlık', '<b>Kayda geçti</b> — artık gizlenemez'] };
          },
        },
        {
          key: 'lie', label: 'Başka türlü yaz.',
          detail: 'Tarih, yazana kalır. Ta ki biri eski nüshayı bulana kadar.',
          stakes: [{ kind: STAKE.SECRET }, { kind: STAKE.SOUL }],
          waitDays: 0,
          onResolve() {
            const me = player();
            me.prestige += 90;
            me.secrets.push({ id: `sec_lie_${m.id}`, kind: 'lie', victimId: m.victimId || null, day: S.day, about: m.id });
            m.tags.push('falsified');
            imprint({ kind: 'record', title: 'Deftere yalan yazıldı', text: `${exactPhrase(m.day)} sayfasını olduğundan başka türlü yazdırdın.`, weight: 0.5, tags: ['falsified', 'secret'] });
            return { success: true, beat: 'yazdırdın', title: 'Sayfa Güzel Oldu', text: `Kâtip yazdı ve yazarken hiç durmadı. Bu işi daha önce de yapmış.\n\nGüzel bir sayfa oldu. Kahramanca bile.\n\nAma kâtibin kaç nüsha tuttuğunu bilmiyorsun. Kâtipler nüsha tutar. Meslek icabı.`, effects: ['+90 itibar', '<b>Yeni sır:</b> deftere yalan yazdırdın', 'Kâtip biliyor'] };
          },
        },
        {
          key: 'burn', label: 'Sayfayı yırt.',
          detail: 'Boşluk da bir cevaptır. Okuyanlar boşluğu kendi doldurur.',
          cost: [{ kind: STAKE.PIETY, value: 40 }],
          stakes: [{ kind: STAKE.SECRET }],
          waitDays: 0,
          onResolve() {
            const me = player();
            (scribe.hooks ||= []).push({ onId: me.id, kind: 'weak', secretId: null });
            remember(scribe.id, me.id, 'Kendi tarihinden bir sayfa yırttırdı.', -30, 50);
            m.tags.push('erased');
            imprint({ kind: 'record', title: 'Bir sayfa yırtıldı', text: `${exactPhrase(m.day)} sayfası defterden koparıldı.`, weight: 0.45, tags: ['erased', 'secret'] });
            return { success: true, beat: 'yırttın', title: 'O Yıl Eksik', text: `Kâtip sayfayı kopardı ve sana uzattı. Almadın; ateşe kendisi attı.\n\nDefteri kapatırken şunu söyledi: "Bir eksik sayfa, dolu bir sayfadan daha çok konuşur efendim."\n\nHaklı. Ve artık senin bir şeyi sakladığını biliyor.`, effects: ['−40 dindarlık', 'O gün defterde yok', `<b>${scribe.name}</b> elinde bir koz tutuyor`] };
          },
        },
      ],
    });
  },
},

// --- 8. Your heir learned it from you --------------------------------------
{
  id: 'the_mirror',
  weightHint: 0.9,
  chance: 0.7,
  cooldown: 14 * 365,
  find(api) {
    const { S, deeds, yearsSince, player, livingChildren, age, ageAt } = api;
    const p = player();
    if (!p) return null;
    const src = [...deeds('blood'), ...deeds('oath')].filter((m) => yearsSince(m.day) >= 6 && (m.title || m.headline));
    if (!src.length) return null;
    const kids = livingChildren(p).filter((k) => age(k) >= 14);
    if (!kids.length) return null;
    const m = src[0];
    const heir = kids[0];
    if (ageAt(heir.birthDay, m.day) < 0) return null;   // he must have been alive to watch
    const rivals = livingChildren(p).filter((k) => k.id !== heir.id && age(k) >= 6);
    return { memory: m, heir, victim: rivals[0] || null };
  },
  fire(ctx, api) {
    const { memory: m, heir, victim } = ctx;
    const { S, offer, STAKE, player, fullName, age, ageAt, whenPhrase, exactPhrase, wholeYearsSince,
      sceneOf, imprint, remember, kill, vassalsOf } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const thenAge = Math.max(0, ageAt(heir.birthDay, m.day));
    const target = victim ? fullName(victim) : 'amcasının';
    const bloody = m.tags.includes('blood');
    const poisoned = m.tags.includes('poison') || m.tags.includes('physician');

    offer({
      kind: 'scheme',
      title: 'Aynadaki Çocuk',
      targetId: heir.id,
      scene: sceneOf(p.id),
      framing: poisoned
        ? `Casusun sabaha karşı geldi: ${fullName(heir)} dün gece aşçıyla konuşuyormuş. Uzun uzun. ${victim ? `${target} yemeği hakkında.` : 'Kimin ne yediği hakkında.'}`
        : bloody
          ? `Casusun sabaha karşı geldi: ${fullName(heir)} dün gece iki adamla konuşmuş, kesesini açmış. İkisi de bıçak taşıyor ve ikisi de ${victim ? target : 'bir isim'} sordu.`
          : `Casusun sabaha karşı geldi: ${fullName(heir)} senin mührünle iki mektup yollamış. İkisinde de senin adına söz vermiş — tutmayacağı sözler.`,
      body: `"${m.headline || m.title}" — ${exactPhrase(m.day)}. ${whenPhrase(m.day)} sen de aynısını yaptın. O gün ${heir.name} ${thenAge} yaşındaydı ve bu evdeydi. Koridorlar dar; çocuklar duyar.\n\nŞimdi ${age(heir)} yaşında ve senin ${yrs} yıl önce durduğun yerde duruyor.\n\nÇocuklar öğretileni değil, görüleni öğrenir. Bunu ona sen öğretmedin. Ona bunu sen gösterdin.`,
      options: [
        {
          key: 'stop', label: 'Durdur. Zorla.',
          detail: 'Kendi oğlunu. Kendi yaptığın şey için.',
          confirm: `${TR.acc(fullName(heir))} zincire mi vuracaksın?`,
          stakes: [{ kind: STAKE.KIN, who: fullName(heir) }, { kind: STAKE.REPUTATION }],
          waitDays: 45, odds: 0.7,
          tells: [{ at: 0.6, text: () => `${heir.name} üç gündür konuşmuyor. Sana değil, kimseye.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            remember(heir.id, S.playerId, 'Kendi yaptığı şey için beni cezalandırdı.', -55, 60);
            imprint({ kind: 'kin', title: `${fullName(heir)} durduruldu`, text: `Oğlunu, senin ${yrs} yıl önce yaptığın şeyi yaparken durdurdun.`, weight: 0.65, targetId: heir.id, tags: ['kin', 'grudge_seed', 'inherited', 'irony'] });
            if (ok) return { beat: 'durdurdun', title: 'Odasında Kilit Var', text: `Kapıyı kapatırken sana tek bir şey sordu: "Sen kaç yaşındaydın?"\n\nCevap vermedin. Cevabı ikiniz de biliyorsunuz.\n\nÇocuk kurtuldu. Oğlun kaybedildi.`, effects: [`<b>${heir.name}</b> −55 — senin varisin`, victim ? `<b>${victim.name}</b> yaşıyor` : 'Bir can kurtuldu'] };
            return { beat: 'geç kaldın', title: 'Kilidi Kendisi Açtı', text: `Oğlunu odasına kapattın. Sabah oda boştu; pencerenin altında bir ip vardı.\n\nSen de bir zamanlar böyle bir ip kullanmıştın.`, effects: [`<b>${heir.name}</b> firarda`, 'Planı devam ediyor'] };
          },
        },
        {
          key: 'look_away', label: 'Görmemiş ol.',
          detail: 'Bir kez göz yumarsan, hanenin bundan sonraki yüz yılını yazmış olursun.',
          stakes: victim ? [{ kind: STAKE.KIN, who: fullName(victim) }, { kind: STAKE.SOUL }] : [{ kind: STAKE.SOUL }],
          waitDays: 90, odds: 0.62,
          tells: [{ at: 0.5, text: 'Sofrada oğlunun eli titremedi. Seninki titredi.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            me.stress += 30; me.piety = Math.max(0, me.piety - 90);
            if (ok && victim) {
              kill(victim, 'murder', heir.id);
              heir.secrets = heir.secrets || [];
              heir.secrets.push({ id: `sec_${victim.id}`, kind: 'murder', victimId: victim.id, day: S.day });
              imprint({ kind: 'blood', title: `${fullName(victim)} öldü — oğlunun eliyle`, text: `Oğlun senin öğrettiğin şeyi yaptı ve sen izledin.`, weight: 0.9, irreversible: true, victimId: victim.id, targetId: heir.id, tags: ['blood', 'kin', 'inherited', 'grief'] });
              return { beat: 'oldu', title: 'Sofrada Bir Kişi Eksik', knell: true, text: `${fullName(victim)} sabaha çıkmadı.\n\nCenazede ${heir.name} senin yanında durdu ve yüzünü senin gibi tuttu. Aynı ifade. Aynı omuz.\n\nBir hanedan kurdun. İşte böyle görünüyor.`, effects: [victim ? `<b>${victim.name}</b> öldü` : '', '−90 dindarlık', `<b>${heir.name}</b> artık senin gibi`, '+30 gerginlik'] };
            }
            imprint({ kind: 'shame', title: 'Oğlun yakalandı', text: `Oğlunun planı ortaya çıktı; sen bile bile susmuştun.`, weight: 0.7, targetId: heir.id, tags: ['scandal', 'kin', 'inherited', 'public'] });
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Oğlunun cinayetine göz yumdu.', -30, 40);
            return { beat: 'yakalandı', title: 'Herkes Öğrendi', knell: true, text: `Aşçı konuştu. Aşçılar hep konuşur.\n\nŞimdi herkes iki şey biliyor: oğlunun ne yaptığını ve senin bildiğini.\n\nİkincisi daha ağır.`, effects: ['Tüm vassalların −30', '−90 dindarlık', `<b>${heir.name}</b> lekelendi`] };
          },
        },
        {
          key: 'teach', label: 'Otur ve doğrusunu öğret.',
          detail: 'Onu durdurmuyorsun. Yakalanmamayı öğretiyorsun. Fark bu.',
          confirm: 'Ona nasıl yapılacağını mı öğreteceksin?',
          cost: [{ kind: STAKE.PIETY, value: 60 }],
          stakes: [{ kind: STAKE.SOUL }, { kind: STAKE.KIN, who: fullName(heir) }],
          waitDays: 30, odds: 0.8,
          onResolve(d, ok) {
            const me = player();
            heir.base.intrigue = (heir.base.intrigue || 0) + 4;
            if (!heir.traits.includes('deceitful')) heir.traits.push('deceitful');
            remember(heir.id, S.playerId, 'Bana kendi elleriyle öğretti.', +45, 60);
            imprint({ kind: 'kin', title: `${TR.dat(fullName(heir))} öğrettin`, text: `Oğluna, senin ${yrs} yıl önce yaptığın şeyin nasıl yapılacağını öğrettin.`, weight: 0.7, irreversible: true, targetId: heir.id, tags: ['inherited', 'kin', 'teaching', 'soul'] });
            return { success: true, beat: 'öğrettin', title: 'İki Sandalye, Bir Mum', text: `Gece yarısına kadar konuştunuz. Sorular sordu; iyi sorulardı.\n\nGiderken kapıda döndü: "Baba — sen de birinden mi öğrendin?"\n\nBu evde şimdi iki kişi aynı şeyi biliyor. Bir sır iki kişiye çıktığında ne olduğunu da biliyorsun.`, effects: [`<b>${heir.name}</b> +4 entrika, <b>Riyakâr</b>`, `<b>${heir.name}</b> +45 sadakat`, '−60 dindarlık', 'Zincir devam ediyor'] };
          },
        },
      ],
    });
  },
},

// --- 9. The town you saved sends men you did not ask for -------------------
{
  id: 'grateful_town',
  weightHint: 0.55,
  chance: 0.6,
  cooldown: 12 * 365,
  find(api) {
    const { pv, deeds, yearsSince } = api;
    for (const m of deeds('gave_relief')) {
      if (yearsSince(m.day) < 6) continue;
      const prov = m.provinceId ? pv(m.provinceId) : null;
      if (!prov) continue;
      return { memory: m, prov };
    }
    return null;
  },
  fire(ctx, api) {
    const { memory: m, prov } = ctx;
    const { S, offer, STAKE, player, fullName, age, whenPhrase, exactPhrase, wholeYearsSince,
      provinceIdxOf, imprint, remember, makeCharacter, kill } = api;
    const p = player();
    const yrs = wholeYearsSince(m.day);
    const men = 120 + yrs * 25;
    const leader = makeCharacter({ culture: prov.culture, faith: prov.faith, sex: 'm', skillMean: 6, traits: ['brave', 'honest'] });
    const bornAfter = yrs >= 19;                       // old enough to have been born that spring
    leader.birthDay = S.day - (bornAfter ? yrs : yrs + 20) * 365;
    leader.courtOf = S.playerId; leader.liegeId = S.playerId;

    offer({
      kind: 'event',
      title: `${TR.abl(prov.name)} Gelenler`,
      targetId: leader.id,
      scene: { provinceIdx: provinceIdxOf(prov.id) },
      framing: `${whenPhrase(m.day)} ${prov.name} için ambarlarını açmıştın. Bu sabah avluda ${men} adam var ve hiçbirini sen çağırmadın.`,
      body: bornAfter
        ? `Başlarındaki genç ${fullName(leader)}. ${age(leader)} yaşında — yani o kıştan sonraki ilkbaharda doğmuş.\n\n"Babam senin buğdayınla kışı çıkardı," diyor. "Ben o yüzden varım."\n\nSilahları kendilerinin. Ücret istemiyorlar. ${exactPhrase(m.day)} tarihini biliyorlar; sen bilmiyordun.`
        : `Başlarındaki adam ${fullName(leader)}. ${age(leader)} yaşında — o kış ${age(leader) - yrs} yaşındaydı ve senin buğdayını taşıyan arabanın arkasından koşmuştu.\n\n"Karnımı sen doyurdun," diyor. "Şimdi sıra bende."\n\nSilahları kendilerinin. Ücret istemiyorlar. ${exactPhrase(m.day)} tarihini biliyorlar; sen bilmiyordun.`,
      options: [
        {
          key: 'take', label: 'Al. Onlar senin.',
          detail: 'Bedava asker yoktur. Bunların bedeli sonra ödenir.',
          stakes: [{ kind: STAKE.REPUTATION }],
          waitDays: 0,
          onResolve() {
            const me = player();
            me.retinue = (me.retinue || 0) + men;
            prov.unrest = Math.max(0, (prov.unrest || 0) - 10);
            remember(leader.id, me.id, 'Bizi orduna aldı.', +40, 40);
            imprint({ kind: 'levy', title: `${prov.name} gönüllüleri`, text: `${TR.abl(prov.name)} gelen ${men} gönüllüyü maiyetine kattın.`, weight: 0.4, provinceId: prov.id, targetId: leader.id, tags: ['gave_relief', 'debt_owed', 'levy'] });
            return { success: true, beat: 'aldın', title: `${men} Adam`, text: `Serdarın onları saydı ve kaşını kaldırdı: "Bunlar dövüşmeyi biliyor mu efendim?"\n\n${leader.name} cevap verdi: "Açlığı biliyoruz."\n\nBir gün bu adamları bir yere göndereceksin. O gün ${prov.name} yine sayacak.`, effects: [`Maiyetin +${men} gönüllü`, `${prov.name} sakinleşti`, 'Bir borç daha — ama bu sefer sana'] };
          },
        },
        {
          key: 'pay_home', label: 'Ücretlerini ver, evlerine gönder.',
          detail: 'Minneti paraya çevirirsen minnet biter. Ama adamlar yaşar.',
          cost: [{ kind: STAKE.GOLD, value: 60 }],
          stakes: [{ kind: STAKE.GOLD, value: 60 }],
          disabled: p.gold < 60, disabledWhy: '60 altının yok',
          waitDays: 0,
          onResolve() {
            const me = player();
            me.prestige += 70;
            prov.development += 1;
            remember(leader.id, me.id, 'Bizi geri gönderdi — cebimiz dolu.', +25, 30);
            imprint({ kind: 'mercy', title: `${prov.name} gönüllüleri geri döndü`, text: `${TR.abl(prov.name)} gelen gönüllüleri ücretlerini verip evlerine yolladın.`, weight: 0.4, provinceId: prov.id, tags: ['gave_relief', 'settled'] });
            return { success: true, beat: 'gönderdin', title: 'Avlu Boşaldı', text: `${leader.name} keseyi almadı; adamlarına dağıttı, kendisi almadı.\n\n"Bir şey isterseniz haber salın," dedi. "Biz sayarız."\n\n${prov.name} artık iki şey sayıyor: o kışı ve bu sabahı.`, effects: ['60 altın gitti', '+70 itibar', `${prov.name} +1 kalkınma`] };
          },
        },
        {
          key: 'border', label: 'Sınıra sür.',
          detail: 'Bedava geldiler. Bedava ölebilirler de.',
          confirm: `${TR.gen(prov.name)} gönüllülerini sınıra mı süreceksin?`,
          stakes: [{ kind: STAKE.LIFE, who: `${men} gönüllünün` }, { kind: STAKE.REPUTATION }],
          waitDays: 150, odds: 0.5,
          tells: [{ at: 0.6, text: () => `Sınırdan haber: ${leader.name} önde gidiyormuş. Hep önde.`, goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            if (ok) {
              me.prestige += 110;
              imprint({ kind: 'war', title: 'Sınırda gönüllüler', text: `${prov.name} gönüllüleri sınırı tuttu.`, weight: 0.45, provinceId: prov.id, tags: ['levy', 'settled'] });
              return { beat: 'tuttular', title: 'Sınır Tutuldu', text: `Üç ay boyunca kimse geçemedi. ${leader.name} geri döndü, bir kolu eksik.\n\n"Borcumuz bitti mi efendim?" diye sordu. Cevap vermedin.`, effects: ['+110 itibar', 'Sınır güvende', `<b>${leader.name}</b> sakat döndü`] };
            }
            kill(leader, 'battle');
            prov.unrest = Math.min(100, (prov.unrest || 0) + 40);
            imprint({ kind: 'blood', title: `${prov.name} gönüllüleri kırıldı`, text: `${TR.abl(prov.name)} gelen gönüllüleri sınırda harcadın.`, weight: 0.65, irreversible: true, provinceId: prov.id, tags: ['betrayal', 'grudge', 'denied_relief'] });
            return { beat: 'kırıldılar', title: 'Kimse Dönmedi', knell: true, text: `${TR.dat(prov.name)} bu sefer haber gitti, buğday değil.\n\nO kasabada seni iki şeyle hatırlıyorlar artık: bir kış açtığın ambarla, ve bir baharda geri göndermediğin ${men} oğullarıyla.\n\nİkincisi birincisini sildi.`, effects: [`<b>${leader.name}</b> öldü`, `${prov.name} +40 huzursuzluk`, 'Minnet bitti'] };
          },
        },
      ],
    });
  },
},

// --- 10. The brother you put in the dark -----------------------------------
{
  id: 'brother_in_the_dark',
  weightHint: 0.85,
  chance: 0.7,
  cooldown: 15 * 365,
  find(api) {
    const { S, ch, deeds, yearsSince, recall } = api;
    const src = recall((m) => (m.tags.includes('dungeon') || m.tags.includes('chose:imprison')) && yearsSince(m.day) >= 5);
    for (const m of src) {
      const who = m.targetId ? ch(m.targetId) : null;
      if (who && who.deathDay == null && who.imprisonedBy === S.playerId) return { memory: m, prisoner: who };
    }
    // someone another system put in your cells still counts — but only once we
    // have a real date for it. An echo that invents a date is a lie.
    const held = Object.values(S.chars).find((c) => c.deathDay == null &&
      c.imprisonedBy === S.playerId && c.imprisonedDay != null && yearsSince(c.imprisonedDay) >= 5);
    if (held) return { memory: null, prisoner: held };
    return null;
  },
  fire(ctx, api) {
    const { memory: m, prisoner } = ctx;
    const { S, offer, STAKE, player, fullName, age, ageAt, exactPhrase, wholeYearsSince,
      sceneOf, imprint, remember, kill, vassalsOf, relation } = api;
    const p = player();
    const day0 = m ? m.day : prisoner.imprisonedDay;
    const yrs = wholeYearsSince(day0);
    const thenAge = Math.max(0, ageAt(prisoner.birthDay, day0));
    const rel = relation(p.id, prisoner.id);

    offer({
      kind: 'event',
      title: 'Zindanda Bir Ses',
      targetId: prisoner.id,
      scene: sceneOf(p.id),
      framing: `Zindancı yukarı çıktı ve şapkasını elinde tutuyor: "${fullName(prisoner)} artık ayağa kalkamıyor efendim. ${yrs} yıldır aşağıda."`,
      body: `${exactPhrase(day0)} günü onu oraya sen attırdın. O gün ${thenAge} yaşındaydı. Bugün ${age(prisoner)}.\n\n${rel === 'kardeş' ? 'Kardeşin.' : rel === 'evlat' ? 'Oğlun.' : rel === 'hanedan' ? 'Senin kanından.' : rel === 'vassal' ? 'Bir zamanlar sana yemin etmişti.' : 'Adını çoktan unuttuğunu sanıyordun.'} Bu ${yrs} yıl boyunca aynı çatı altında yaşadınız; sen üstte, o altta.\n\nZindancı ekliyor: "Bir şey istiyor efendim. Sizi."`,
      options: [
        {
          key: 'go_down', label: 'Aşağı in. Yalnız.',
          detail: 'Işığı sen götüreceksin. Söyleyeceklerini de sen dinleyeceksin.',
          stakes: [{ kind: STAKE.KIN, who: fullName(prisoner) }],
          waitDays: 7, odds: 0.6,
          tone: 'grave',
          onResolve(d, ok) {
            const me = player();
            me.stress += 20;
            imprint({ kind: 'kin', title: `${fullName(prisoner)} ile zindanda`, text: `${yrs} yıl sonra aşağı indin ve konuştunuz.`, weight: 0.6, targetId: prisoner.id, tags: ['kin', 'faced_it', 'dungeon'] });
            if (ok) {
              remember(prisoner.id, me.id, 'En sonunda aşağı indi.', +35, 40);
              return { beat: 'konuştunuz', title: 'Mumun Işığında', text: `Seni tanımadı. Sonra sesinden tanıdı.\n\n"${yrs} yıl," dedi. "Ben burada saydım. Sen saydın mı?"\n\nSaymıştın. Her yılını. Bunu ona söylemedin.`, effects: ['+20 gerginlik', `<b>${prisoner.name}</b> +35`, 'Bir cümleyi ömrün boyunca taşıyacaksın'] };
            }
            remember(prisoner.id, me.id, 'Aşağı indi ve hiçbir şey söylemedi.', -25, 40);
            return { beat: 'konuşmadı', title: 'Sırtını Döndü', text: `Mumu duvara koydun. Duvara döndü ve senle konuşmadı.\n\nYukarı çıkarken merdiven ${yrs} yıl önce olduğundan uzun geldi.`, effects: ['+20 gerginlik', `<b>${prisoner.name}</b> −25`] };
          },
        },
        {
          key: 'release', label: 'Salıver.',
          detail: `${yrs} yıl aşağıda kalan bir adam, yukarı çıktığında aynı adam değildir.`,
          confirm: `${fullName(prisoner)} serbest kalacak.`,
          stakes: [{ kind: STAKE.KIN, who: fullName(prisoner) }, { kind: STAKE.REPUTATION }],
          waitDays: 240, odds: 0.45,
          tells: [
            { at: 0.3, text: () => `${prisoner.name} güneşe çıkalı bir hafta oldu. Kimseyle konuşmuyor.`, goodTone: 'ambiguous', badTone: 'ambiguous' },
            { at: 0.75, text: () => `${prisoner.name} eski adamlarından ikisini bulmuş.`, goodTone: 'good', badTone: 'bad' },
          ],
          onResolve(d, ok) {
            const me = player();
            prisoner.imprisonedBy = null;
            me.piety += 80;
            if (ok) {
              remember(prisoner.id, me.id, 'Beni saldı.', +50, 50);
              imprint({ kind: 'mercy', title: `${fullName(prisoner)} salıverildi`, text: `${yrs} yıl sonra zindandan çıkardın.`, weight: 0.5, targetId: prisoner.id, tags: ['mercy', 'kin', 'settled'] });
              return { beat: 'affettin', title: 'Kapı Açıldı', text: `Avluya çıktığında gözlerini eliyle kapattı ve uzun süre öyle durdu.\n\nAkşam sofrasında en uçta oturdu. Kimse ne diyeceğini bilemedi. En çok da sen.`, effects: ['+80 dindarlık', `<b>${prisoner.name}</b> serbest, +50`] };
            }
            prisoner.faction = 'claimant';
            imprint({ kind: 'threat', title: `${fullName(prisoner)} kaçtı`, text: `Salıverdiğin adam düşmanına gitti.`, weight: 0.6, targetId: prisoner.id, tags: ['grudge', 'threat', 'kin'] });
            return { beat: 'gitti', title: 'Bir Ay Sonra Gitti', knell: false, text: `Bir ay sofrana oturdu, sonra bir gece atını aldı ve kuzeye gitti.\n\nKuzeyde seni sevmeyen biri var. Şimdi elinde senin kanından bir iddia sahibi var.`, effects: ['+80 dindarlık', `<b>${prisoner.name}</b> düşmanında`, 'Tahtın üstünde bir iddia daha'] };
          },
        },
        {
          key: 'leave', label: 'Bırak orada ölsün.',
          detail: 'Bugün kapıyı açmazsan yarın açmana gerek kalmayacak.',
          confirm: `${fullName(prisoner)} aşağıda ölecek.`,
          stakes: [{ kind: STAKE.KIN, who: fullName(prisoner) }, { kind: STAKE.SOUL }],
          waitDays: 100, odds: 0.85,
          tells: [{ at: 0.5, text: 'Zindancı bu hafta yemeği geri getirdi. Dokunulmamış.', goodTone: 'ambiguous', badTone: 'bad' }],
          onResolve(d, ok) {
            const me = player();
            kill(prisoner, 'starvation', me.id);
            S.stats.kin_lost++;
            me.piety = Math.max(0, me.piety - 120);
            if (!me.traits.includes('kinslayer') && api.isKin(me.id, prisoner.id)) me.traits.push('kinslayer');
            for (const v of vassalsOf(me.id)) remember(v.id, me.id, 'Kendi kanını zindanda öldürdü.', -40, 60);
            me.secrets.push({ id: `sec_${prisoner.id}`, kind: 'kinslay', victimId: prisoner.id, day: S.day });
            imprint({ kind: 'blood', title: `${fullName(prisoner)} zindanda öldü`, text: `${yrs} yıl tuttuğun adamı aşağıda ölüme bıraktın.`, weight: 0.95, irreversible: true, victimId: prisoner.id, tags: ['blood', 'kin', 'dungeon', 'grief'] });
            return { beat: 'öldü', title: 'Aşağıdan Ses Gelmiyor', knell: true, text: `Üç gün ses gelmedi. Dördüncü gün zindancı çıkıp bir şey söylemeden başını salladı.\n\nGömdüler. Sen gitmedin.\n\n${yrs} yıl boyunca senin evinde yaşayan bir adam, senin evinde öldü ve sen aşağı inmedin.`, effects: [`<b>${prisoner.name}</b> öldü`, '<b>Kan Dökücü</b> damgası', '−120 dindarlık', 'Tüm vassalların −40', '<b>Yeni sır</b>'] };
          },
        },
      ],
    });
  },
},

];
