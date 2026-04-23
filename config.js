// Change DATA_URL to a GitHub raw URL for production, e.g.:
// 'https://raw.githubusercontent.com/youruser/utbk-data/main/soal_utbk_baru.json'
const CONFIG = {
  DATA_URL: './soal_utbk_baru.json',
  SOAL_PER_MISI: 21,
  SOAL_PER_TEMA_DEFAULT: 3,
  THRESHOLD_SELESAI: 85,   // % accuracy → remove theme from rotation
  THRESHOLD_TAMBAH: 60,    // % accuracy → add extra questions to weak theme
  MAKS_SOAL_TEMA_LEMAH: 6,
  TOTAL_MISI: 10,

  TEMAS: ['PU', 'PPU', 'PBM', 'PK', 'LBI', 'LBIng', 'PM'],

  TEMA_NAMES: {
    PU:    'Penalaran Umum',
    PPU:   'Pengetahuan & Pemahaman Umum',
    PBM:   'Kemampuan Membaca & Menulis',
    PK:    'Pengetahuan Kuantitatif',
    LBI:   'Literasi Bahasa Indonesia',
    LBIng: 'Literasi Bahasa Inggris',
    PM:    'Penalaran Matematika'
  },

  TEMA_EMOJI: {
    PU: '🧠', PPU: '📚', PBM: '📖', PK: '📐',
    LBI: '🇮🇩', LBIng: '🇬🇧', PM: '🔢'
  },

  MISI_STARS: ['⭐','⭐','⭐⭐','⭐⭐','⭐⭐⭐','⭐⭐⭐','⭐⭐⭐⭐','⭐⭐⭐⭐','⭐⭐⭐⭐⭐','⭐⭐⭐⭐⭐'],

  MISI_LABEL: [
    'Konsep Dasar',
    'Variasi Dasar',
    'Dua Langkah',
    'Dua Konsep',
    'Konteks Nyata',
    'Distractor Kuat',
    'Analisis Panjang',
    'Multi-Konsep',
    'HOTS',
    'Simulasi UTBK'
  ]
};
