// ═══════════════════════════════════════════════════
// AUTHENTIFICATION
// ═══════════════════════════════════════════════════
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  document.getElementById('loadingPage').style.display = 'none';
  if (session) {
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userInfo').textContent = session.user.email;
    const email = session.user.email.toLowerCase();
    const who = email.includes('gabriel') ? 'Gabriel' : 'Mélissa';
    await loadSettings();
    await fetchData();
    applyTheme();
    setUser(who);
    setToday();
    updateYearPill();
    setView('mois');
  } else {
    document.getElementById('loginPage').style.display = 'flex';
  }
}

async function doLogin() {
  document.getElementById('loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('loginEmail').value.trim(),
    password: document.getElementById('loginPass').value
  });
  if (error) document.getElementById('loginErr').textContent = 'Erreur : ' + error.message;
  else { document.getElementById('loginPage').style.display = 'none'; init(); }
}

async function doLogout() {
  if (confirm('Se déconnecter ?')) { await sb.auth.signOut(); location.reload(); }
}
