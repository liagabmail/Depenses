// ═══════════════════════════════════════════════════
// UTILITAIRES
// ═══════════════════════════════════════════════════
function hexToRgb(h) { const r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16); return`${r},${g},${b}`; }
function rgba(hex, a) { return `rgba(${hexToRgb(hex)},${a})`; }
function gC() { return settings.colorG || '#5B9CF6'; }
function mC() { return settings.colorM || '#F472B6'; }
function gD() { return rgba(gC(), .18); }
function mD() { return rgba(mC(), .18); }
function userC(u) { return u === 'Gabriel' ? gC() : mC(); }
function userD(u) { return u === 'Gabriel' ? gD() : mD(); }
function fmt(n) { return '$' + Number(n).toLocaleString('fr-CA', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtDate(ds) { if(!ds) return ''; const [y,m,d] = ds.split('-'); return `${d}/${m}/${y}`; }

function setSyncIndicator(msg, saving = false) {
  const el = document.getElementById('syncIndicator');
  if (el) { el.textContent = msg; el.className = 'sync-indicator' + (saving ? ' saving' : ''); }
}

function setToday() {
  const d = new Date();
  const v = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const el = document.getElementById('addDate'); if(el) el.value = v;
}
function setEditToday() {
  const d = new Date();
  document.getElementById('eDate').value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════
// THÈME & COULEURS
// ═══════════════════════════════════════════════════
function applyTheme() {
  document.body.className = isDark ? '' : 'light';
  const t = document.getElementById('darkToggle');
  if (t) t.className = 'toggle' + (isDark ? ' on' : '');
}

function applyColorUI() {
  document.getElementById('titleAccent').style.color = mC();
  ['dotG1','dotG2','dotG3'].forEach(id => { const e = document.getElementById(id); if(e) e.style.background = gC(); });
  ['dotM1','dotM2','dotM3'].forEach(id => { const e = document.getElementById(id); if(e) e.style.background = mC(); });
  const thG = document.getElementById('thG'); if(thG) thG.style.color = gC();
  const thM = document.getElementById('thM'); if(thM) thM.style.color = mC();
}

// ═══════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════
function setUser(u) {
  document.getElementById('addUser').value = u;
  applyColorUI();
}

function setView(v) {
  currentView = v;
  ['mois','annee','comparer'].forEach(x => {
    document.getElementById('vue-'+x).style.display = x === v ? 'block' : 'none';
  });
  document.querySelectorAll('.vtab').forEach((b,i) =>
    b.classList.toggle('active', ['mois','annee','comparer'][i] === v)
  );
  ['mois','annee','comparer'].forEach(x => {
    const b = document.getElementById('bnav-'+x);
    if (b) b.classList.toggle('active', x === v);
  });
  const bp = document.getElementById('bnav-params');
  if (bp) bp.classList.remove('active');
  if (v === 'mois') renderMois();
  else if (v === 'annee') renderAnnee();
  else renderComparer();
}

function changeMonth(d) {
  currentMonthIdx = (currentMonthIdx + d + 12) % 12;
  if (d > 0 && currentMonthIdx === 0) currentYear++;
  if (d < 0 && currentMonthIdx === 11) currentYear--;
  txnFilter = 'Tous';
  renderMois();
}
function changeCmpYear(d) { cmpYear += d; renderComparer(); }

// ═══════════════════════════════════════════════════
// YEAR PICKER
// ═══════════════════════════════════════════════════
function updateYearPill() {
  document.getElementById('yearPillVal').textContent = globalYear;
  document.getElementById('ypVal').textContent = globalYear;
}
function toggleYearPicker() {
  yearPickerOpen = !yearPickerOpen;
  document.getElementById('yearPickerPopup').classList.toggle('open', yearPickerOpen);
}
function shiftYear(d) {
  globalYear += d; currentYear = globalYear;
  updateYearPill();
  rerenderAll();
}
document.addEventListener('click', e => {
  if (yearPickerOpen && !e.target.closest('#yearPill') && !e.target.closest('#yearPickerPopup')) {
    yearPickerOpen = false;
    document.getElementById('yearPickerPopup').classList.remove('open');
  }
});

// ═══════════════════════════════════════════════════
// DATA HELPERS
// ═══════════════════════════════════════════════════
function monthRows(y, m) {
  return allData.filter(d => {
    const dt = new Date(d.Date + 'T12:00:00');
    return dt.getFullYear() === y && dt.getMonth() === m;
  });
}

function totals(y, m) {
  const rows = monthRows(y, m);
  const g  = rows.filter(r => r.user_id === 'Gabriel').reduce((s,r) => s + r.Montant, 0);
  const mv = rows.filter(r => r.user_id === 'Mélissa').reduce((s,r) => s + r.Montant, 0);
  return { g: +g.toFixed(2), m: +mv.toFixed(2) };
}

function catTotals(pairs) {
  const rows = pairs.flatMap(([y,m]) => monthRows(y, m));
  const r = {};
  settings.cats.forEach(c => { r[c] = { g: 0, m: 0 }; });
  rows.forEach(row => {
    const cat = row.Catégorie || '';
    if (!r[cat]) r[cat] = { g: 0, m: 0 };
    if (row.user_id === 'Gabriel') r[cat].g = +(r[cat].g + row.Montant).toFixed(2);
    else r[cat].m = +(r[cat].m + row.Montant).toFixed(2);
  });
  return r;
}

// ═══════════════════════════════════════════════════
// RENDER METRICS
// ═══════════════════════════════════════════════════
function renderMetrics(pairs, elId, label) {
  const tG   = +pairs.reduce((s,[y,m]) => s + totals(y,m).g, 0).toFixed(2);
  const tM   = +pairs.reduce((s,[y,m]) => s + totals(y,m).m, 0).toFixed(2);
  const diff = +(tG - tM).toFixed(2);
  document.getElementById(elId).innerHTML = `
    <div class="metric">
      <div class="metric-label"><span class="av" style="width:16px;height:16px;font-size:8px;background:${gD()};color:${gC()};border:1px solid ${gC()}">G</span>Gabriel</div>
      <div class="metric-value" style="color:${gC()}">${fmt(tG)}</div>
      <div class="metric-sub">${label}</div>
    </div>
    <div class="metric">
      <div class="metric-label"><span class="av" style="width:16px;height:16px;font-size:8px;background:${mD()};color:${mC()};border:1px solid ${mC()}">M</span>Mélissa</div>
      <div class="metric-value" style="color:${mC()}">${fmt(tM)}</div>
      <div class="metric-sub">${label}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Total commun</div>
      <div class="metric-value">${fmt(tG+tM)}</div>
      <div class="metric-sub">ensemble</div>
    </div>
    <div class="metric">
      <div class="metric-label">Écart</div>
      <div class="metric-value" style="font-size:14px;margin-top:4px;">
        ${diff===0
          ? `<span class="diff-badge" style="background:rgba(128,128,128,.15);color:var(--t2)">Égalité</span>`
          : `<span class="diff-badge" style="background:${rgba(diff>0?gC():mC(),.15)};color:${diff>0?gC():mC()}">${diff>0?'Gabriel':'Mélissa'} +${fmt(Math.abs(diff))}</span>`}
      </div>
      <div class="metric-sub">dépense plus</div>
    </div>`;
}

// ═══════════════════════════════════════════════════
// RENDER CAT BARS
// ═══════════════════════════════════════════════════
function renderCatBars(pairs, elId) {
  const ct = catTotals(pairs);
  const active = settings.cats.filter(c => ct[c] && (ct[c].g > 0 || ct[c].m > 0));
  const el = document.getElementById(elId);
  if (!active.length) { el.innerHTML = '<div class="empty">Aucune dépense</div>'; return; }
  const maxV = Math.max(...active.map(c => Math.max(ct[c].g||0, ct[c].m||0)), 1);
  el.innerHTML = active.map(c => `
    <div class="cat-row">
      <div class="cat-lbl" title="${c}" style="display:flex;align-items:center;gap:5px;">
        <span style="width:7px;height:7px;border-radius:50%;background:${getCatColor(c)};flex-shrink:0;display:inline-block;"></span>
        ${c.replace(' / Sorties','')}
      </div>
      <div style="flex:1;">
        <div class="bar-track" style="margin-bottom:3px;"><div style="height:100%;border-radius:4px;transition:width .4s;width:${((ct[c].g||0)/maxV*100).toFixed(1)}%;background:${gC()}"></div></div>
        <div class="bar-track"><div style="height:100%;border-radius:4px;transition:width .4s;width:${((ct[c].m||0)/maxV*100).toFixed(1)}%;background:${mC()}"></div></div>
      </div>
      <div class="cat-amts"><span style="color:${gC()}">${fmt(ct[c].g||0)}</span><span style="color:var(--t3)">/</span><span style="color:${mC()}">${fmt(ct[c].m||0)}</span></div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════
// VUE MOIS — filtres, tri, liste transactions
// ═══════════════════════════════════════════════════
function populateCatSelect(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = settings.cats.map(c => `<option>${c}</option>`).join('');
  const defaultCat = settings.cats.includes('Autre') ? 'Autre' : settings.cats[settings.cats.length-1];
  el.value = (cur && settings.cats.includes(cur)) ? cur : defaultCat;
  if (id === 'addCat') {
    const mel = document.getElementById('mAddCat');
    if (mel) {
      const mc = mel.value;
      mel.innerHTML = el.innerHTML;
      mel.value = (mc && settings.cats.includes(mc)) ? mc : defaultCat;
    }
  }
}

function renderFilters() {
  const filters = ['Tous','Gabriel','Mélissa'].map(f =>
    `<button class="fbtn ${txnFilter===f?'active':''}" onclick="setFilter('${f}')">${f}</button>`
  ).join('');
  const dateArrow = txnSort.startsWith('date') ? (txnSort==='date-desc'?' ↓':' ↑') : '';
  const amtArrow  = txnSort.startsWith('amt')  ? (txnSort==='amt-desc' ?' ↓':' ↑') : '';
  const sorts = `
    <button class="fbtn ${txnSort.startsWith('date')?'active':''}" onclick="toggleSort('date')">Date${dateArrow}</button>
    <button class="fbtn ${txnSort.startsWith('amt')?'active':''}"  onclick="toggleSort('amt')">Montant${amtArrow}</button>`;
  let html = '';
  if (window.innerWidth <= 640) {
    html = `<div style="display:flex;gap:8px;">${filters}</div><div style="display:flex;gap:8px;margin-top:8px;">${sorts}</div>`;
  } else {
    html = filters + '<span style="width:1px;background:var(--border2);margin:0 4px;align-self:stretch;display:inline-block;"></span>' + sorts;
  }
  document.getElementById('filterRow').innerHTML = html;
}

function setFilter(f) { txnFilter = f; renderFilters(); renderTxnList(); }
function setSort(s)   { txnSort = s;   renderFilters(); renderTxnList(); }
function toggleSort(key) {
  txnSort = txnSort === key+'-desc' ? key+'-asc' : key+'-desc';
  renderFilters(); renderTxnList();
}

function renderTxnList() {
  let rows = monthRows(currentYear, currentMonthIdx).slice().sort((a,b) => {
    if (txnSort === 'date-desc') return (b.Date||'').localeCompare(a.Date||'');
    if (txnSort === 'date-asc')  return (a.Date||'').localeCompare(b.Date||'');
    if (txnSort === 'amt-desc')  return b.Montant - a.Montant;
    if (txnSort === 'amt-asc')   return a.Montant - b.Montant;
    return 0;
  });
  if (txnFilter !== 'Tous') rows = rows.filter(r => r.user_id === txnFilter);
  const el = document.getElementById('txnList');
  if (!rows.length) { el.innerHTML = '<div class="empty">Aucune transaction</div>'; return; }
  el.innerHTML = rows.map(r => {
    const uc = userC(r.user_id);
    const catColor = getCatColor(r.Catégorie); const catBg = catColor+'22';
    return `<div class="txn-row" onclick="openEdit('${r.id}')">
      ${r.Catégorie ? `<span class="txn-cat" style="background:${catBg};color:${catColor};">${r.Catégorie.replace(' / Sorties','')}</span>` : ''}
      <span class="txn-desc">${r.Note ? r.Note : (r.Note === '' ? '' : (r.Catégorie || '—'))}</span>
      ${r.Date ? `<span class="txn-date">${fmtDate(r.Date)}</span>` : ''}
      <span class="txn-amt" style="color:${uc}">${fmt(r.Montant)}</span>
    </div>`;
  }).join('');
}

// ─ Charts ─
let lineInst = null;
function renderLineChart() {
  const dG = Array.from({length:12}, (_,i) => totals(currentYear, i).g);
  const dM = Array.from({length:12}, (_,i) => totals(currentYear, i).m);
  if (lineInst) { lineInst.destroy(); lineInst = null; }
  const gc = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
  const tc = isDark ? '#454c68' : '#9aa0b8';
  lineInst = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: { labels: MONTHS.map(m => m.slice(0,3)), datasets: [
      {label:'Gabriel', data:dG, borderColor:gC(), backgroundColor:rgba(gC(),.12), tension:.38, fill:true, pointRadius:3, pointBackgroundColor:gC()},
      {label:'Mélissa', data:dM, borderColor:mC(), backgroundColor:rgba(mC(),.12), tension:.38, fill:true, pointRadius:3, pointBackgroundColor:mC()}
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales: { x:{grid:{color:gc},ticks:{color:tc,font:{size:10,family:"'DM Sans',sans-serif"}}},
                y:{grid:{color:gc},ticks:{color:tc,font:{size:10,family:"'DM Sans',sans-serif"},callback:v=>'$'+v}} } }
  });
}

function renderMois() {
  const lbl = MONTHS[currentMonthIdx] + ' ' + currentYear;
  document.getElementById('monthLabel').textContent = lbl;
  document.getElementById('catMonthLabel').textContent = lbl;
  document.getElementById('txnMonthLabel').textContent = lbl;
  document.getElementById('lineYearLabel').textContent = currentYear;
  renderMetrics([[currentYear, currentMonthIdx]], 'metricsRow', lbl);
  renderCatBars([[currentYear, currentMonthIdx]], 'catBars');
  populateCatSelect('addCat');
  renderFilters();
  renderTxnList();
  renderLineChart();
  applyColorUI();
}

// ═══════════════════════════════════════════════════
// VUE ANNÉE
// ═══════════════════════════════════════════════════
let annBarInst = null;
function renderAnnee() {
  const yr = globalYear;
  document.getElementById('annYearLabel').textContent = yr;
  const pairs = Array.from({length:12}, (_,i) => [yr, i]);
  renderMetrics(pairs, 'annMetrics', 'Année ' + yr);
  renderCatBars(pairs, 'annCatBars');

  const dG = pairs.map(([y,m]) => totals(y,m).g);
  const dM = pairs.map(([y,m]) => totals(y,m).m);
  if (annBarInst) { annBarInst.destroy(); annBarInst = null; }
  const gc = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
  const tc = isDark ? '#454c68' : '#9aa0b8';
  annBarInst = new Chart(document.getElementById('annBarChart'), {
    type: 'bar',
    data: { labels: MONTHS.map(m=>m.slice(0,3)), datasets: [
      {label:'Gabriel', data:dG, backgroundColor:rgba(gC(),.7), borderRadius:4},
      {label:'Mélissa', data:dM, backgroundColor:rgba(mC(),.7), borderRadius:4}
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales: { x:{grid:{display:false},ticks:{color:tc,font:{size:10}}},
                y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:v=>'$'+v}} } }
  });

  const nowM = now.getMonth(), nowY = now.getFullYear();
  // Toujours tableau classique, mais scaling CSS
  let html = '';
  pairs.forEach(([y,m]) => {
    const {g, m:mv} = totals(y,m);
    const d = +(g-mv).toFixed(2);
    const isCur = m === nowM && y === nowY;
    html += `<tr class="clickable${isCur?' cur-month':''}" onclick="goToMonth(${m},${y})">
      <td>${MONTHS[m]}</td>
      <td style="color:${gC()}">${fmt(g)}</td>
      <td style="color:${mC()}">${fmt(mv)}</td>
      <td>${fmt(g+mv)}</td>
      <td>${d===0?'—':`<span class="diff-badge" style="background:${rgba(d>0?gC():mC(),.15)};color:${d>0?gC():mC()};font-size:11px;">${d>0?'G':'M'} +${fmt(Math.abs(d))}</span>`}</td>
    </tr>`;
  });
  const tG = +dG.reduce((a,b)=>a+b,0).toFixed(2);
  const tM = +dM.reduce((a,b)=>a+b,0).toFixed(2);
  html += `<tr class="ann-total"><td>Total ${yr}</td><td style="color:${gC()}">${fmt(tG)}</td><td style="color:${mC()}">${fmt(tM)}</td><td>${fmt(tG+tM)}</td><td></td></tr>`;
  document.querySelector('.ann-table-wrapper').innerHTML = `<table class='ann-table'><thead><tr><th>Mois</th><th id='thG'>Gabriel</th><th id='thM'>Mélissa</th><th>Total</th><th>Écart</th></tr></thead><tbody id='annTableBody'>${html}</tbody></table>`;
  applyColorUI();
}

function goToMonth(m, y) { currentMonthIdx = m; currentYear = y; setView('mois'); }

// ═══════════════════════════════════════════════════
// VUE COMPARER
// ═══════════════════════════════════════════════════
let cmpInst = null;
function renderComparer() {
  document.getElementById('cmpYearLabel').textContent = cmpYear;
  document.getElementById('cmpChips').innerHTML = MONTHS.map((mn, i) => {
    const isSel = cmpSelected.some(s => s.y === cmpYear && s.m === i);
    const bg     = isSel ? rgba(gC(),.18) : 'transparent';
    const border = isSel ? gC() : 'var(--border2)';
    const color  = isSel ? gC() : 'var(--t2)';
    return `<button class="month-chip" style="background:${bg};border-color:${border};color:${color}" onclick="toggleCmp(${i})">${mn.slice(0,3)} <span style="font-size:10px;opacity:.65">${cmpYear}</span></button>`;
  }).join('');

  const pairs = cmpSelected.length ? cmpSelected.map(s=>[s.y,s.m]) : [[cmpYear, currentMonthIdx]];
  const label = pairs.length === 1 ? MONTHS[pairs[0][1]]+' '+pairs[0][0] : pairs.length+' mois';
  renderMetrics(pairs, 'cmpMetrics', label);
  renderCatBars(pairs, 'cmpCatBars');

  const dG = pairs.map(([y,m]) => totals(y,m).g);
  const dM = pairs.map(([y,m]) => totals(y,m).m);
  if (cmpInst) { cmpInst.destroy(); cmpInst = null; }
  const gc = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)';
  const tc = isDark ? '#454c68' : '#9aa0b8';
  cmpInst = new Chart(document.getElementById('cmpChart'), {
    type: 'bar',
    data: { labels: pairs.map(([y,m]) => MONTHS[m].slice(0,3)+' '+y), datasets: [
      {label:'Gabriel', data:dG, backgroundColor:rgba(gC(),.7), borderRadius:5},
      {label:'Mélissa', data:dM, backgroundColor:rgba(mC(),.7), borderRadius:5}
    ]},
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
      scales: { x:{grid:{display:false},ticks:{color:tc,font:{size:11},autoSkip:false,maxRotation:35}},
                y:{grid:{color:gc},ticks:{color:tc,font:{size:10},callback:v=>'$'+v}} } }
  });
  applyColorUI();
}

function toggleCmp(i) {
  const idx = cmpSelected.findIndex(s => s.y === cmpYear && s.m === i);
  if (idx === -1) cmpSelected.push({y:cmpYear, m:i});
  else if (cmpSelected.length > 1) cmpSelected.splice(idx, 1);
  cmpSelected.sort((a,b) => a.y !== b.y ? a.y-b.y : a.m-b.m);
  renderComparer();
}

// ═══════════════════════════════════════════════════
// MODAL ÉDITION
// ═══════════════════════════════════════════════════
function openEdit(id) {
  const row = allData.find(r => r.id === id);
  if (!row) return;
  editRow = row;
  populateCatSelect('eCat');
  document.getElementById('eUser').value = row.user_id;
  document.getElementById('eDesc').value = row.Note || '';
  document.getElementById('eAmt').value  = row.Montant;
  document.getElementById('eDate').value = row.Date || '';
  document.getElementById('eCat').value  = row.Catégorie || '';
  document.getElementById('editModal').style.display = 'flex';
}
function closeEdit() { document.getElementById('editModal').style.display = 'none'; editRow = null; }
function closeOverlay(id, e) { if (e.target.id === id) document.getElementById(id).style.display = 'none'; }

// ═══════════════════════════════════════════════════
// MODAL AJOUT MOBILE
// ═══════════════════════════════════════════════════
function openAddModal() {
  populateCatSelect('mAddCat');
  const u = document.getElementById('addUser');
  document.getElementById('mAddUser').value = u ? u.value : 'Gabriel';
  setMobileToday();
  document.getElementById('addModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('mAddAmt').focus(), 100);
}
function closeAddModal() { document.getElementById('addModalOverlay').classList.remove('open'); }
function setMobileToday() {
  const d = new Date();
  document.getElementById('mAddDate').value = d.toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════
// RERENDER ALL
// ═══════════════════════════════════════════════════
function rerenderAll() {
  if (currentView === 'mois') renderMois();
  else if (currentView === 'annee') renderAnnee();
  else renderComparer();
}
