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
      catColors: data.catcolors || {}
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
    catcolors: settings.catColors || {}
  });
  setSyncIndicator('Synchronisé ✓');
}

function openSettings() {
  document.getElementById('colorG').value = settings.colorG || '#5B9CF6';
  document.getElementById('colorM').value = settings.colorM || '#F472B6';
  document.getElementById('darkToggle').className = 'toggle' + (isDark ? ' on' : '');
  renderCatChips();
  document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettings() { document.getElementById('settingsModal').style.display = 'none'; }

function saveUserColor(who, color) {
  if (who === 'G') settings.colorG = color; else settings.colorM = color;
  applyColorUI(); rerenderAll(); saveSettings();
}

async function toggleDark() {
  isDark = !isDark;
  settings.dark = isDark;
  applyTheme();
  rerenderAll();
  await saveSettings();
}

function getCatColor(cat) {
  return settings.catColors && settings.catColors[cat] ? settings.catColors[cat] : '#8b90a8';
}

function saveCatColor(cat, color) {
  if (!settings.catColors) settings.catColors = {};
  settings.catColors[cat] = color;
  renderCatChips();
  rerenderAll();
  saveSettings();
}

function renderCatChips() {
  document.getElementById('catChipList').innerHTML = settings.cats.map((cat, i) => {
    const col = getCatColor(cat);
    return `<div class="cat-chip" style="border-color:${col}33;">
      <input type="color" value="${col}" title="Couleur" style="width:16px;height:16px;border:none;border-radius:3px;cursor:pointer;padding:0;background:none;flex-shrink:0;" onchange="saveCatColor('${cat.replace(/'/g, "\\'")}',this.value)" onclick="event.stopPropagation()"/>
      <span style="flex:1;">${cat}</span>
      <span class="cat-chip-del" onclick="deleteCat(${i})">✕</span>
    </div>`;
  }).join('');
}

async function addCategory() {
  const inp = document.getElementById('newCatInput');
  const val = inp.value.trim();
  if (!val || settings.cats.includes(val)) return;
  settings.cats.push(val);
  inp.value = '';
  renderCatChips();
  populateCatSelect('addCat');
  await saveSettings();
}

async function deleteCat(i) {
  if (settings.cats.length <= 1) return;
  settings.cats.splice(i, 1);
  renderCatChips();
  populateCatSelect('addCat');
  rerenderAll();
  await saveSettings();
}
