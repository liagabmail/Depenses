// ═══════════════════════════════════════════════════
// STATE GLOBAL
// ═══════════════════════════════════════════════════
let allData = [];
let settings = {
  cats: [...DEF_CATS],
  dark: true,
  colorG: '#5B9CF6',
  colorM: '#F472B6',
  catColors: {}
};
let currentView = 'mois';
let globalYear = now.getFullYear();
let currentYear = now.getFullYear();
let currentMonthIdx = now.getMonth();
let cmpYear = now.getFullYear();
let cmpSelected = [
  { y: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), m: now.getMonth() === 0 ? 11 : now.getMonth() - 1 },
  { y: now.getFullYear(), m: now.getMonth() }
];
let cmpSlot = 0;
let txnFilter = 'Tous';
let txnSort = 'date-desc';
let isDark = true;
let yearPickerOpen = false;
let editRow = null;
