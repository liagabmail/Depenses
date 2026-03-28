// ═══════════════════════════════════════════════════
// AUTHENTIFICATION
// ═══════════════════════════════════════════════════
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  document.getElementById('loadingPage').style.display = 'none';
  if (session) {
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('userInfo').textContent = session.user.email;
    let who = localStorage.getItem('depenses_user');
    if (!who) {
      who = await askUserIdentity();
      if (who) localStorage.setItem('depenses_user', who);
    }
    // Si déjà enregistré, on ne redemande pas, on connecte directement
    await loadSettings();
    await fetchData();
    applyTheme();
    setUser(who || 'Gabriel');
    setToday();
    updateYearPill();
    setView('mois');
    // Correction mobile : forcer le rendu si mobile
    if (window.innerWidth <= 640 && typeof rerenderAll === 'function') {
      setTimeout(() => { rerenderAll(); }, 100);
    }

    // Correction PWA/mobile : forcer le rendu quand l'app devient visible
    if (!window._depensesVisibilityListener) {
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible' && typeof rerenderAll === 'function') {
          setTimeout(() => { rerenderAll(); }, 100);
        }
      });
      window._depensesVisibilityListener = true;
    }
  } else {
    document.getElementById('loginPage').style.display = 'flex';
  }
}

// Demande à l'utilisateur de choisir son identité (Gabriel ou Mélissa)
async function askUserIdentity() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = 0;
    modal.style.left = 0;
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = 9999;
    modal.innerHTML = `
      <div style="background:#222;padding:32px 24px;border-radius:16px;box-shadow:0 4px 32px #0003;text-align:center;min-width:260px;">
        <div style="font-size:20px;font-weight:600;margin-bottom:18px;">Qui êtes-vous ?</div>
        <button id="chooseGabriel" style="margin:8px 16px 8px 0;padding:12px 28px;font-size:16px;border-radius:8px;border:none;background:#5B9CF6;color:#fff;cursor:pointer;">Gabriel</button>
        <button id="chooseMelissa" style="margin:8px 0 8px 0;padding:12px 28px;font-size:16px;border-radius:8px;border:none;background:#F472B6;color:#fff;cursor:pointer;">Mélissa</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('chooseGabriel').onclick = () => {
      document.body.removeChild(modal);
      resolve('Gabriel');
    };
    document.getElementById('chooseMelissa').onclick = () => {
      document.body.removeChild(modal);
      resolve('Mélissa');
    };
  });
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
  if (confirm('Se déconnecter ?')) {
    await sb.auth.signOut();
    localStorage.removeItem('depenses_user');
    location.reload();
  }
}
