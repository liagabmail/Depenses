// ═══════════════════════════════════════════════════
// PARAMÈTRES (Supabase table "settings", ligne id=1 partagée)
// ═══════════════════════════════════════════════════
async function loadSettings() {
  const { data } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
  if (data) {
    settings = {
      cats: Array.isArray(data.cats) ? data.cats : [...DEF_CATS],
      dark: data.dark !== false,
      colorG: data.colorg || '#5B9CF6',
      colorM: data.colorm || '#F472B6',
      // catColors: data.catcolors || {} // plus utilisé
    };
  }
  isDark = settings.dark;
}

async function saveSettings() {
  setSyncIndicator('Enregistrement…', true);
  await sb.from('settings').upsert({
    id: 1,
    cats: settings.cats,
    dark: settings.dark,
    colorg: settings.colorG,
    colorm: settings.colorM,
    // catcolors: settings.catColors || {} // plus utilisé
  });
  setSyncIndicator('Synchronisé ✓');
}

function openSettings() {
  document.getElementById('darkToggle').className = 'toggle' + (isDark ? ' on' : '');
  renderCatChips();
  document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function saveUserColor(who, color) {
  if (who === 'G') settings.colorG = color;
  else settings.colorM = color;
  applyColorUI();
  rerenderAll();
  saveSettings();
}

async function toggleDark() {
  isDark = !isDark;
  settings.dark = isDark;
  applyTheme();
  rerenderAll();
  await saveSettings();
}

function saveCatColor(cat, color) {
  if (!settings.catColors) settings.catColors = {};
  settings.catColors[cat] = color;
  renderCatChips();
  rerenderAll();
  saveSettings();
}

function renderCatChips() {
  document.getElementById('catChipList').innerHTML = settings.cats.map((cat) => {
    const col = getCatColor(cat);
    return `<div class="cat-chip" style="border-color:${col}33;background:${col}22;">
      <span style="width:14px;height:14px;border-radius:50%;background:${col};display:inline-block;margin-right:8px;"></span>
      <span style="flex:1;">${cat}</span>
    </div>`;
  }).join('');
}

async function addCategory() {
  // Désactivé
}

async function deleteCat(i) {
  // Désactivé
}
