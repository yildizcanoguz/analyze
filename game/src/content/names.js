export const NAMES = {
  turkish: {
    m:['Alp','Kutalmış','Süleyman','Melik','Artuk','Danişmend','Çaka','Tuğrul','Kılıç','Mesud','Sökmen','İlgazi','Yağıbasan','Saltuk','Mengücek','Bozan','Afşin','Sanduk','Türkmen','Buldacı','Emir','Atsız','Porsuk','Aksungur','Çavuldur','Bayındır','Kayı','Salur','Eymür','Döğer','Yıva','Kınık'],
    f:['Gevher','Terken','Zümrüt','Altun','Mahperi','Gürcü','Raziye','Devlet','Ayşe','Selçuk','Hüma','Gülbahar','Sitti','Melike','Şahnaz','Turhan'],
    dyn:['Selçukoğulları','Danişmendliler','Artukoğulları','Mengücekler','Saltuklular','Çakaoğulları','Sökmenliler','İnaloğulları'],
  },
  greek: {
    m:['Alexios','Nikephoros','Konstantinos','Romanos','Basileios','Manuel','Ioannes','Andronikos','Isaakios','Michael','Theodoros','Georgios','Leon','Bardas','Katakalon','Philaretos','Eustathios','Gregorios','Demetrios','Stephanos'],
    f:['Anna','Eudokia','Maria','Theodora','Zoe','Eirene','Helena','Xene','Euphrosyne','Kale','Sophia','Martha'],
    dyn:['Komnenos','Doukas','Botaneiates','Bryennios','Palaiologos','Melissenos','Diogenes','Kourkouas','Tarchaneiotes','Skleros','Phokas','Argyros'],
  },
  armenian: {
    m:['Gagik','Ashot','Smbat','Vasak','Grigor','Tigran','Vahram','Mleh','Ruben','Levon','Hetum','Oshin','Bagrat','Sargis'],
    f:['Mariam','Shushan','Katranide','Tamar','Rita','Zabel','Vardui','Sirarpi'],
    dyn:['Bagratuni','Artsruni','Rubenyan','Pahlavuni','Mamikonyan','Hetumyan','Siwni'],
  },
  kurdish: {
    m:['Merwan','Nasr','Said','Ahmed','Şerefhan','Bedir','Zengi','Şihab','Ebubekir','Hasan'],
    f:['Delal','Rewşen','Berivan','Zilan','Xanim','Nesrin'],
    dyn:['Merwanîler','Şeddadîler','Hesenwayhîler','Anazîler'],
  },
  bulgar: {
    m:['Petar','Samuil','Boril','Konstantin','Aleksandar','Ivan','Gavril','Delyan'],
    f:['Anastasia','Kosara','Elena','Desislava','Maria'],
    dyn:['Kometopuli','Asenevtsi','Shishmanovtsi','Terter'],
  },
};
export const CULTURES = Object.keys(NAMES);
export const CULTURE_LABEL = { turkish:'Türk', greek:'Rum', armenian:'Ermeni', kurdish:'Kürt', bulgar:'Bulgar' };
export const FAITH_LABEL = { sunni:'Sünni', orthodox:'Ortodoks', miaphysite:'Miafizit', catholic:'Katolik' };
