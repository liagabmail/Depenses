// ═══════════════════════════════════════════════════
// DONNÉES — Supabase table "Dépenses"
// ═══════════════════════════════════════════════════
async function fetchData() {
  const { data } = await sb.from('Dépenses').select('*').order('Date', { ascending: false });
  allData = data || [];
}

async function addTxn() {
  const user = document.getElementById('addUser').value;
  const desc = document.getElementById('addDesc').value.trim();
  const amt  = parseFloat(document.getElementById('addAmt').value);
  const cat  = document.getElementById('addCat').value;
  const date = document.getElementById('addDate').value;
  if (!amt || amt <= 0) { alert('Montant invalide.'); return; }
  setSyncIndicator('Enregistrement…', true);
  await sb.from('Dépenses').insert([{
    user_id: user,
    Montant: +amt.toFixed(2),
    Catégorie: cat || '',
    Date: date,
    Note: desc
  }]);
  document.getElementById('addAmt').value = '';
  document.getElementById('addDesc').value = '';
  document.getElementById('addDate').value = '';
  document.getElementById('addCat').value = settings.cats.includes('Autre') ? 'Autre' : settings.cats[0];
  setToday();
  await fetchData();
  setSyncIndicator('Synchronisé ✓');
  renderMois();
}

async function quickDelete(id) {
  if (!confirm('Supprimer cette transaction ?')) return;
  setSyncIndicator('Enregistrement…', true);
  await sb.from('Dépenses').delete().eq('id', id);
  await fetchData();
  setSyncIndicator('Synchronisé ✓');
  rerenderAll();
}

async function saveEdit() {
  if (!editRow) return;
  const amt = parseFloat(document.getElementById('eAmt').value);
  if (isNaN(amt) || amt <= 0) { alert('Montant invalide.'); return; }
  setSyncIndicator('Enregistrement…', true);
  await sb.from('Dépenses').update({
    user_id: document.getElementById('eUser').value,
    Note: document.getElementById('eDesc').value.trim(),
    Montant: +amt.toFixed(2),
    Date: document.getElementById('eDate').value,
    Catégorie: document.getElementById('eCat').value || ''
  }).eq('id', editRow.id);
  closeEdit();
  await fetchData();
  setSyncIndicator('Synchronisé ✓');
  rerenderAll();
}

async function deleteEditTxn() {
  if (!editRow) return;
  if (!confirm('Supprimer définitivement ?')) return;
  setSyncIndicator('Enregistrement…', true);
  await sb.from('Dépenses').delete().eq('id', editRow.id);
  closeEdit();
  await fetchData();
  setSyncIndicator('Synchronisé ✓');
  rerenderAll();
}

// ── MOBILE ADD ──
async function addMobileTxn() {
  const amt  = parseFloat(document.getElementById('mAddAmt').value);
  const date = document.getElementById('mAddDate').value;
  const user = document.getElementById('mAddUser').value;
  const cat  = document.getElementById('mAddCat').value;
  const desc = document.getElementById('mAddDesc').value.trim();
  let keepOpen = false;
  if (typeof arguments[0] === 'boolean') keepOpen = arguments[0];
  if (!date) { alert('Veuillez entrer une date.'); return; }
  if (!amt || amt <= 0) { alert('Montant invalide.'); return; }
  setSyncIndicator('Enregistrement…', true);
  await sb.from('Dépenses').insert([{
    user_id: user,
    Montant: +amt.toFixed(2),
    Catégorie: cat || '',
    Date: date,
    Note: desc
  }]);
  document.getElementById('mAddAmt').value = '';
  document.getElementById('mAddDesc').value = '';
  document.getElementById('mAddCat').value = settings.cats.includes('Autre') ? 'Autre' : settings.cats[0];
  setMobileToday();
  await fetchData();
  setSyncIndicator('Synchronisé ✓');
  rerenderAll();
  if (!keepOpen) closeAddModal();
}
