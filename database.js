// database.js
// =====================================================
// 1) DQE (Sadece bu ekran)
// type: "section" (level: 1/2) | "row"
// =====================================================
export const dqe = [
  // ===== SERIE A =====
  { type: "section", level: 1, label: "SÉRIE A. INSTALLATIONS ET LOGISTIQUES DU CHANTIER" },
  { type: "row", art: "A1", description: "Installation et repliement du chantier", um: "Ft", dzd: 1041277260.86, euro: 4972851.80, dzdEqv: 1550000000.00 },

  { type: "section", level: 2, label: "CONTRÔLE DES TRAVAUX" },
  { type: "row", art: "A2.1", description: "Laboratoire de chantier", um: "Ft", dzd: 41644039.15, euro: 570439.50, dzdEqv: 100000000.00 },
  { type: "row", art: "A2.2", description: "Contrôle externe des travaux", um: "Ft", dzd: 33983960.76, euro: 400938.80, dzdEqv: 75000000.00 },

  { type: "section", level: 2, label: "ÉTUDES" },
  { type: "row", art: "A3.1", description: "Études d’exécution", um: "Ft", dzd: 212842500.00, euro: 2025000.00, dzdEqv: 420000000.00 },
  { type: "row", art: "A3.2", description: "Contrôle externe des études", um: "Ft", dzd: 45999996.83, euro: 449657.90, dzdEqv: 92000000.00 },
  { type: "row", art: "A3.3", description: "Dossier de récolement", um: "Ft", dzd: 33568500.00, euro: 450000.00, dzdEqv: 75000000.00 },
  { type: "row", art: "A3.4", description: "Étude des méthodes", um: "Ft", dzd: 7500069.87, euro: 73313.10, dzdEqv: 15000000.00 },
  { type: "row", art: "A3.5", description: "Reconnaissances géotechniques, géologiques et hydrogéologiques", um: "Ft", dzd: 40209555.68, euro: 388958.40, dzdEqv: 80000000.00 },

  { type: "section", level: 2, label: "SÉCURITÉ DU CHANTIER" },
  { type: "row", art: "A4.1", description: "Sécurité passive", um: "Ft", dzd: 200000000.00, euro: null, dzdEqv: 200000000.00 },
  { type: "row", art: "A4.2", description: "Sécurité active", um: "Ft", dzd: 400000000.00, euro: null, dzdEqv: 400000000.00 },
  { type: "row", art: "A5", description: "Panneau d’identification de l’opération de surface de 6,00 m2", um: "Unité", dzd: 1775000.00, euro: null, dzdEqv: 1775000.00 },

  // ===== SERIE B =====
  { type: "section", level: 1, label: "SÉRIE B. TRAVAUX PRÉPARATOIRES" },

  { type: "section", level: 2, label: "TRAVAUX PRÉPARATOIRES" },
  { type: "row", art: "B1.1", description: "Débroussaillage, évacuation de blocs rocheux et nettoyage emprise", um: "Ha", dzd: 619820.41, euro: 2543.30, dzdEqv: 880000.00 },
  { type: "row", art: "B1.2", description: "Abattage, arrachage et dessouchage des arbres singuliers et mise en stock", um: "U", dzd: 1600.00, euro: null, dzdEqv: 1600.00 },
  { type: "row", art: "B1.3", description: "Dépose soignée des structures métalliques ou en bois", um: "Tonne", dzd: 944.25, euro: 2.50, dzdEqv: 1200.00 },

  { type: "section", level: 2, label: "DÉMOLITION" },
  { type: "row", art: "B2.1", description: "Démolition ouvrages divers", um: "m3", dzd: 1335.05, euro: 6.50, dzdEqv: 2000.00 },
  { type: "row", art: "B2.2", description: "Démolition ouvrages en béton armé", um: "m3", dzd: 1620.22, euro: 8.60, dzdEqv: 2500.00 },
  { type: "row", art: "B2.3", description: "Démolition de chaussées, trottoirs et accotements revêtus", um: "m3", dzd: 207.70, euro: 1.00, dzdEqv: 310.00 },

  { type: "section", level: 2, label: "RABOTAGE DE CHAUSSÉES" },
  { type: "row", art: "B3.1", description: "Rabotage pour une épaisseur inférieure ou égale à 100 mm", um: "m2", dzd: 88.85, euro: 0.50, dzdEqv: 140.00 },
  { type: "row", art: "B3.2", description: "Rabotage pour une épaisseur entre 100 et 200 mm", um: "m2", dzd: 98.62, euro: 0.60, dzdEqv: 160.00 },
  { type: "row", art: "B4", description: "Scarification de chaussée et compactage", um: "m2", dzd: 28.16, euro: 0.80, dzdEqv: 110.00 },

  // ===== SERIE C =====
  { type: "section", level: 1, label: "SÉRIE C. TERRASSEMENT ET COUCHE DE FORME" },

  { type: "section", level: 2, label: "TERRE VÉGÉTALE" },
  { type: "row", art: "C1.1", description: "Décapage de terre végétale", um: "m3", dzd: 128.62, euro: 0.60, dzdEqv: 190.00 },
  { type: "row", art: "C1.2", description: "Reprise sur stock et mise en œuvre de terre végétale", um: "m3", dzd: 179.08, euro: 0.40, dzdEqv: 220.00 },

  { type: "section", level: 2, label: "PRÉPARATION DE FOND DE FORME EN DÉBLAIS" },
  { type: "row", art: "C2.2", description: "Purges", um: "m3", dzd: 2200.00, euro: null, dzdEqv: 2200.00 },

  { type: "section", level: 2, label: "DÉBLAIS MIS EN REMBLAI" },
  { type: "row", art: "C3.1", description: "Déblai meuble mis en remblai", um: "m3", dzd: 257.42, euro: 1.20, dzdEqv: 380.00 },
  { type: "row", art: "C3.2", description: "Déblai semi-dur mis en remblai", um: "m3", dzd: 386.32, euro: 1.60, dzdEqv: 550.00 },
  { type: "row", art: "C3.3", description: "Déblai rocheux dur mis en remblai", um: "m3", dzd: 1308.96, euro: 4.80, dzdEqv: 1800.00 },

  { type: "section", level: 2, label: "DÉBLAIS MIS EN DÉPÔT" },
  { type: "row", art: "C4.1", description: "Déblai meuble mis en dépôt", um: "m3", dzd: 148.16, euro: 0.80, dzdEqv: 230.00 },
  { type: "row", art: "C4.2", description: "Déblai semi-dur mis en dépôt", um: "m3", dzd: 307.70, euro: 1.00, dzdEqv: 410.00 },
  { type: "row", art: "C4.3", description: "Déblai rocheux dur mis en dépôt", um: "m3", dzd: 893.10, euro: 3.00, dzdEqv: 1200.00 },

  { type: "section", level: 2, label: "REMBLAIS" },
  { type: "row", art: "C5.1", description: "Remblai en provenance d'emprunt", um: "m3", dzd: 555.63, euro: 1.90, dzdEqv: 750.00 },

  { type: "section", level: 2, label: "ASSISE DRAINANTE" },
  { type: "row", art: "C6.1", description: "Assise drainante", um: "m3", dzd: 1166.55, euro: 1.50, dzdEqv: 1320.00 },

  { type: "section", level: 2, label: "GÉOTEXTILES ET GÉOGRILLES" },
  { type: "row", art: "C7.1", description: "Géotextile de renforcement", um: "m2", dzd: 290.80, euro: 4.00, dzdEqv: 700.00 },
  { type: "row", art: "C7.2", description: "Géotextile anti-contaminant", um: "m2", dzd: 258.27, euro: 5.10, dzdEqv: 780.00 },
  { type: "row", art: "C7.3", description: "Géogrille", um: "m2", dzd: 418.04, euro: 5.20, dzdEqv: 950.00 },

  { type: "section", level: 2, label: "MISE EN FORME DES TALUS" },
  { type: "row", art: "C8.1", description: "Arrondi de crête de talus en déblai", um: "ml", dzd: 317.01, euro: 1.30, dzdEqv: 450.00 },

  { type: "section", level: 2, label: "COUCHE DE FORME" },
  { type: "row", art: "C9.1", description: "Couche de forme, matériaux fournis par Entreprise", um: "m3", dzd: 1346.55, euro: 1.50, dzdEqv: 1500.00 },

  { type: "section", level: 2, label: "TRANSPORT DE MATÉRIAUX" },
  { type: "row", art: "C10.1", description: "Transport de matériaux sur une distance inférieure à 30 kilomètres", um: "M3 x KM", dzd: 12.50, euro: null, dzdEqv: 12.50 },
  { type: "row", art: "C10.2", description: "Transport de matériaux sur une distance supérieure à 30 kilomètres", um: "M3 x KM", dzd: 11.00, euro: null, dzdEqv: 11.00 },
];


// =====================================================
// 2) Makina + İşçilik (Sadece bu ekran)
// =====================================================
export const costSheets = [
  {
    id: "kazi_2700",
    title: "Kazı - Makina & İşçilik",
    unitPanel: {
      daily_excavation_m3: 2700,
      trip_km_loaded_empty: 10,
      bucket_volume_m3: 9,
      trip_count: 15
    },
    makina: [
      { cinsi: "Ekskavatör (CAT 349 - CAT 336)", um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 3556.00 },
      { cinsi: "Loder (CAT 980)",                 um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 2780.00 },
      { cinsi: "Dozer (CAT D8T)",                 um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 6120.00 },
      { cinsi: "Greyder (CAT 14M)",               um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 5000.00 },
      { cinsi: "Silindir (Bomag)",                um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 2780.00 },
      { cinsi: "Kamyon",                          um: "sa", miktar: 9.00, adet: 10.00, birimFiyatDzd: 1890.00 },
      { cinsi: "Arazöz",                          um: "sa", miktar: 9.00, adet: 1.00, birimFiyatDzd: 2230.00 },
    ],
    iscilik: [
      { grup: "Türk",  pozisyon: "Mühendis",            um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 2831.59, maasDzd: 662592 },
      { grup: "Yerel", pozisyon: "Mühendis",            um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 1141.03, maasDzd: 267000 },
      { grup: "Türk",  pozisyon: "Formen",              um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 1992.66, maasDzd: 466283 },
      { grup: "Yerel", pozisyon: "Formen",              um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 961.54,  maasDzd: 225000 },
      { grup: "Yerel", pozisyon: "Operatör Ekskavatör", um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 705.13,  maasDzd: 165000 },
      { grup: "Yerel", pozisyon: "Operatör Loder",      um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 478.63,  maasDzd: 112000 },
      { grup: "Yerel", pozisyon: "Operatör dozer",      um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 752.14,  maasDzd: 176000 },
      { grup: "Yerel", pozisyon: "Operatör Greyder",    um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 525.64,  maasDzd: 123000 },
      { grup: "yerel", pozisyon: "Operatör Silindir",   um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 320.51,  maasDzd: 75000 },
      { grup: "Türk",  pozisyon: "Operatör Shotcrete",  um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 1582.36, maasDzd: 370272 },
      { grup: "Yerel", pozisyon: "Şoför",               um: "sa", saat: 9.00, adet: 1.00, birimSaatDzd: 478.63,  maasDzd: 112000 },
      { grup: "Yerel", pozisyon: "Düz işçi",            um: "sa", saat: 9.00, adet: 2.00, birimSaatDzd: 307.69,  maasDzd: 72000 },
    ]
  }
];
