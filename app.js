/* ===================== ENREGISTREMENT DU SERVICE WORKER (nécessaire pour l'installation sur Android) ===================== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker non enregistré :', err));
  });
}

/* ===================== CONFIGURATION SUPABASE ===================== */
const SUPABASE_URL = 'https://lfjkowexlgacbydaygwu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QvOdWQ4Fd5oRLJYNNBZKsg_DPoWy82G';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ===================== AUTHENTIFICATION SUPABASE (vrais comptes) ===================== */
/* ===================== À FAIRE UNE FOIS : vos deux comptes ===================== */
/* 1. Dans Supabase : Authentication > Users > "Invite user", et invitez Gabriel et Mélissa
      avec LEURS VRAIS courriels (chacun reçoit un lien pour choisir son mot de passe).
   2. Remplacez les deux courriels ci-dessous par ces mêmes vrais courriels.
   3. Chaque personne se connecte avec SON compte, sur SON appareil (ne partagez pas un
      seul compte à deux) : c'est ce qui rend l'onglet Personnel réellement privé. */
const EMAIL_PERSONNES = {
  'liagabmail@gmail.com': 'p1',
  'melissa.bienvenu2@gmail.com': 'p2'
};

let currentUser = null;
let currentSession = null;
const nomsPersonnes = { p1: "Gabriel", p2: "Mélissa", compte: "Compte conjoint" };
const couleursPersonnes = { p1: "#1a73e8", p2: "#e91e63", compte: "#34a853" };

/* Détecte si on arrive depuis un lien d'invitation ou de réinitialisation de mot de passe
   (Supabase ajoute ces informations dans le fragment #... de l'URL au retour du courriel). */
const paramsLien = new URLSearchParams(window.location.hash.replace(/^#/, ''));
let enChoixMotDePasse = ['invite','recovery'].includes(paramsLien.get('type'));

function personneDepuisEmail(email){
  if(!email) return null;
  return EMAIL_PERSONNES[email.trim().toLowerCase()] || null;
}

async function initAuth(){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  await gererSession(session);

  /* On ne recharge tout que si l'utilisateur change vraiment (connexion, déconnexion) ou
     pour un lien de réinitialisation. Avant, chaque rafraîchissement de jeton (toutes les
     heures) et chaque retour sur l'onglet relançait un chargement complet, et le chargement
     initial se faisait deux fois (getSession + INITIAL_SESSION).
     Le setTimeout suit la recommandation de Supabase : ne pas appeler le client directement
     dans ce callback, qui s'exécute pendant que la bibliothèque tient un verrou interne. */
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if(event === 'INITIAL_SESSION') return;
    setTimeout(() => {
      if(event === 'PASSWORD_RECOVERY'){
        enChoixMotDePasse = true;
        gererSession(session);
        return;
      }
      const memeUtilisateur = session && currentSession && session.user.id === currentSession.user.id;
      if(memeUtilisateur){ currentSession = session; return; }
      gererSession(session);
    }, 0);
  });
}

/* Message à afficher sur l'écran de connexion au prochain affichage (afficherVueLogin
   efface les erreurs, ce message-ci survit à cet effacement). */
let messageConnexionEnAttente = '';

async function gererSession(session){
  currentSession = session;
  if(!session){
    currentUser = null;
    document.getElementById('setpw-modal').style.display = 'none';
    document.getElementById('auth-modal').style.display = 'flex';
    afficherVueLogin();
    return;
  }

  /* Compte fraîchement invité : on demande d'abord de choisir un mot de passe
     avant de donner accès aux dépenses. */
  if(enChoixMotDePasse){
    document.getElementById('auth-modal').style.display = 'none';
    document.getElementById('setpw-modal').style.display = 'flex';
    return;
  }

  document.getElementById('auth-modal').style.display = 'none';
  document.getElementById('setpw-modal').style.display = 'none';
  const personneTrouvee = personneDepuisEmail(session.user.email);
  if(!personneTrouvee){
    /* Un compte qui n'est ni Gabriel ni Mélissa n'a rien à faire ici : on le déconnecte au
       lieu de le traiter comme Gabriel (ce qui lui aurait donné accès à ses données). */
    console.warn(`Courriel non reconnu dans EMAIL_PERSONNES : "${session.user.email}". Accès refusé.`);
    messageConnexionEnAttente = "Ce compte n'a pas accès à l'application. Connectez-vous avec le courriel de Gabriel ou de Mélissa.";
    currentUser = null;
    await supabaseClient.auth.signOut();
    await gererSession(null);
    return;
  }
  currentUser = personneTrouvee;
  const emailEl = document.getElementById('account-email');
  const nomEl = document.getElementById('account-nom');
  if(emailEl) emailEl.textContent = session.user.email;
  if(nomEl) nomEl.textContent = nomsPersonnes[currentUser];
  mettreAJourInterfaceUtilisateur();
  rafraichirOptionsFormulaires();
  /* Récurrences d'abord : chargerExceptionsSupabase s'appuie sur le mode (Supabase ou local)
     déterminé par ce chargement. */
  await chargerRecurrencesSupabase();
  await Promise.all([ chargerDepensesSupabase(), chargerBudgetsSupabase(), chargerExceptionsSupabase() ]);
  /* Le moteur du compte n'enregistre un nouveau plan qu'une fois toutes les données en main. */
  donneesCompteChargees = depensesChargeesOk;
  recalculerDepenses();
  setTimeout(ouvrirDepotDepuisURL, 0);
  rafraichirActif();
  chargerPreferencesNotification();
  enregistrerPersonneUtilisateur();
}

document.getElementById('setpw-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const motDePasse = document.getElementById('setpw-password').value;
  const confirmation = document.getElementById('setpw-password-confirm').value;
  const erreurEl = document.getElementById('setpw-error');
  const bouton = document.getElementById('setpw-submit');
  erreurEl.textContent = '';

  if(motDePasse.length < 6){
    erreurEl.textContent = "Le mot de passe doit contenir au moins 6 caractères.";
    return;
  }
  if(motDePasse !== confirmation){
    erreurEl.textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Enregistrement...';
  const { error } = await supabaseClient.auth.updateUser({ password: motDePasse });
  bouton.disabled = false;
  bouton.textContent = 'Confirmer et continuer';

  if(error){
    erreurEl.textContent = "Une erreur est survenue. Réessayez ou redemandez un lien d'invitation.";
    console.error(error);
    return;
  }

  enChoixMotDePasse = false;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  await gererSession(currentSession);
});

document.getElementById('login-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const bouton = document.getElementById('login-submit');
  const erreurEl = document.getElementById('login-error');
  erreurEl.textContent = '';
  bouton.disabled = true;
  bouton.textContent = 'Connexion...';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  bouton.disabled = false;
  bouton.textContent = 'Se connecter';
  if(error){
    erreurEl.textContent = "Courriel ou mot de passe incorrect.";
    console.error(error);
  }
});

/* Bascule entre la vue "connexion" et la vue "mot de passe oublié" dans le même modal */
function afficherVueLogin(){
  document.getElementById('login-view').style.display = '';
  document.getElementById('forgot-password-view').style.display = 'none';
  document.getElementById('login-error').textContent = '';
  document.getElementById('forgot-error').textContent = '';
  document.getElementById('forgot-success').textContent = '';
  document.getElementById('forgot-password-form').reset();
  if(messageConnexionEnAttente){
    document.getElementById('login-error').textContent = messageConnexionEnAttente;
    messageConnexionEnAttente = '';
  }
}
document.getElementById('show-forgot-password').addEventListener('click', ()=>{
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('forgot-password-view').style.display = '';
  const emailDejaEntre = document.getElementById('login-email').value.trim();
  if(emailDejaEntre) document.getElementById('forgot-email').value = emailDejaEntre;
  document.getElementById('forgot-error').textContent = '';
  document.getElementById('forgot-success').textContent = '';
});
document.getElementById('show-login').addEventListener('click', afficherVueLogin);

/* Envoie un courriel avec un lien de réinitialisation. Le lien ramène sur cette même page
   avec #type=recovery dans l'URL, ce qui déclenche automatiquement le modal "Choisissez
   votre mot de passe" (voir enChoixMotDePasse / gererSession) une fois cliqué. */
document.getElementById('forgot-password-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  const bouton = document.getElementById('forgot-submit');
  const erreurEl = document.getElementById('forgot-error');
  const succesEl = document.getElementById('forgot-success');
  erreurEl.textContent = '';
  succesEl.textContent = '';
  bouton.disabled = true;
  bouton.textContent = 'Envoi...';
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  bouton.disabled = false;
  bouton.textContent = 'Envoyer le lien';
  if(error){
    erreurEl.textContent = "Une erreur est survenue. Vérifiez le courriel et réessayez.";
    console.error(error);
    return;
  }
  succesEl.textContent = "Courriel envoyé ! Vérifiez votre boîte de réception (et vos indésirables).";
});

document.getElementById('logout-btn').addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
});

document.getElementById('show-change-password').addEventListener('click', ()=>{
  document.getElementById('change-password-form').style.display = '';
  document.getElementById('show-change-password').style.display = 'none';
});
function fermerChangementMotDePasse(){
  document.getElementById('change-password-form').style.display = 'none';
  document.getElementById('show-change-password').style.display = '';
  document.getElementById('change-password-form').reset();
  document.getElementById('change-password-error').textContent = '';
  document.getElementById('change-password-success').textContent = '';
}
document.getElementById('cancel-change-password').addEventListener('click', fermerChangementMotDePasse);

document.getElementById('change-password-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const nouveau = document.getElementById('change-password-new').value;
  const confirmation = document.getElementById('change-password-confirm').value;
  const erreurEl = document.getElementById('change-password-error');
  const succesEl = document.getElementById('change-password-success');
  const bouton = document.getElementById('change-password-submit');
  erreurEl.textContent = '';
  succesEl.textContent = '';

  if(nouveau.length < 6){
    erreurEl.textContent = "Le mot de passe doit contenir au moins 6 caractères.";
    return;
  }
  if(nouveau !== confirmation){
    erreurEl.textContent = "Les deux mots de passe ne correspondent pas.";
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Enregistrement...';
  const { error } = await supabaseClient.auth.updateUser({ password: nouveau });
  bouton.disabled = false;
  bouton.textContent = 'Confirmer';

  if(error){
    erreurEl.textContent = "Une erreur est survenue. Réessayez.";
    console.error(error);
    return;
  }
  succesEl.textContent = "Mot de passe mis à jour ✓";
  document.getElementById('change-password-form').reset();
  setTimeout(fermerChangementMotDePasse, 1800);
});

function mettreAJourInterfaceUtilisateur() {
  const nom = nomsPersonnes[currentUser];
  document.getElementById('current-user-name').textContent = nom;
  const dot = document.getElementById('current-user-dot');
  dot.className = `dot ${currentUser}`;
}

/* ===================== DONNÉES ET ÉTAT ===================== */
let COULEURS_CATEGORIES = {
  "Épicerie":"#1a73e8","Restaurant":"#ea4335","Transport":"#fbbc04",
  "Maison":"#34a853","Loisirs":"#a142f4","Santé":"#00acc1",
  "Vêtements":"#f06292","Abonnements":"#ff7043","Épargne":"#009688","Autre":"#9aa0a6"
};
const NOMS_MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

function uid(){ return Math.random().toString(36).slice(2,10); }

/* Échappe le texte saisi par l'utilisateur (notes, noms de récurrences) avant de l'insérer
   dans un template HTML. Sans ça, une note contenant par exemple "<b>" était interprétée
   comme du balisage : le texte disparaissait à l'écran. */
const ENTITES_HTML = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function echapperHTML(valeur){
  return String(valeur ?? '').replace(/[&<>"']/g, c => ENTITES_HTML[c]);
}

let categories = Object.keys(COULEURS_CATEGORIES);

/* ===================== LECTURE PAGINÉE =====================
   L'API de Supabase ne renvoie jamais plus de lignes que le réglage « Max rows » (1000 par
   défaut) par requête. Sans pagination, les lignes au-delà disparaissaient sans message. On
   lit donc par pages, triées par id pour qu'aucune ligne ne soit sautée ni lue deux fois, et
   on s'arrête sur une page vide : ça fonctionne peu importe la valeur de « Max rows ». */
const TAILLE_PAGE = 1000;
async function chargerToutesLesLignes(table){
  const toutes = [];
  let debut = 0;
  for(;;){
    const { data, error } = await supabaseClient.from(table).select('*')
      .order('id', { ascending: true })
      .range(debut, debut + TAILLE_PAGE - 1);
    if(error) return { data: null, error };
    if(!data || !data.length) break;
    toutes.push(...data);
    debut += data.length;
  }
  return { data: toutes, error: null };
}

/* ===================== ÉCRITURES VÉRIFIÉES =====================
   Une mise à jour ou une suppression bloquée par les règles RLS ne renvoie PAS d'erreur :
   elle touche simplement zéro ligne. On demande donc les lignes touchées et on considère
   « zéro ligne » comme un échec. `requete` est un update/delete déjà filtré. */
async function ecritureVerifiee(requete, nbAttendu){
  const { data, error } = await requete.select('id');
  if(error) return { ok:false, error };
  const attendu = nbAttendu == null ? 1 : nbAttendu;
  if(!data || data.length < attendu){
    return { ok:false, error: new Error(`Écriture refusée : ${data ? data.length : 0} ligne(s) modifiée(s) sur ${attendu} (règles RLS ?)`) };
  }
  return { ok:true, error:null };
}

/* Prévient l'utilisateur qu'une écriture n'a pas abouti. Avant, ces échecs n'allaient que
   dans la console : l'écran montrait la modification, puis tout « revenait » au
   rechargement. */
function signalerEchecEnregistrement(quoi, err){
  console.error(`Échec : ${quoi}`, err);
  afficherAlerte(`${quoi} n'a pas pu être enregistré dans Supabase. Rien n'a été modifié. Vérifiez votre connexion, puis réessayez.`);
}

/* Empêche un double tap de lancer deux fois la même action (et de créer des doublons) :
   le bouton reste désactivé jusqu'à la fin de l'enregistrement. */
function actionVerrouillee(bouton, action){
  return async (...args) => {
    if(bouton.disabled) return;
    bouton.disabled = true;
    try{ await action(...args); }
    finally{ bouton.disabled = false; }
  };
}

/* ===================== MODÈLE DE DONNÉES DES DÉPENSES =====================
   Deux niveaux, façon calendrier (Google Agenda / Outlook) :

   - `depensesReelles` : les vraies lignes de la table Supabase "Depenses". Ce sont
     uniquement les dépenses ponctuelles saisies à la main. Les échéances d'une récurrence
     ne sont JAMAIS stockées ici.

   - `recurrences` + `exceptions` : la règle de répétition, et les écarts à cette règle
     (une occurrence supprimée, ou une occurrence modifiée individuellement).

   - `depenses` : tableau DÉRIVÉ, recalculé par recalculerDepenses(). Il contient les
     dépenses réelles PLUS les occurrences des récurrences, calculées à la volée pour la
     période affichée. C'est ce tableau que lit tout le reste de l'application (calendrier,
     listes, statistiques, export...), donc rien d'autre n'a besoin de connaître ce
     mécanisme.

   Pourquoi : auparavant, chaque échéance future était insérée comme une vraie ligne en
   base, ce qui obligeait à supprimer/régénérer/dédoublonner des milliers de lignes à chaque
   modification — source de doublons, d'occurrences oubliées et de désynchronisations.
   En calculant les occurrences à l'affichage, modifier une série ne touche plus que la
   règle : les doublons deviennent structurellement impossibles, et "toute la série"
   s'applique vraiment à toutes les occurrences (passées comprises). */
let depensesReelles = [];
let depenses = [];
let exceptions = [];
let etatTri = { conjoint:{key:"Date", dir:"desc"}, personnel:{key:"Date", dir:"desc"}, transactions:{key:"Date", dir:"desc"} };

const formaterMonnaie = (n) => n.toLocaleString('fr-CA', {style:'currency', currency:'CAD'});
const aujourdhui = new Date();
let moisActif = {year:aujourdhui.getFullYear(), month:aujourdhui.getMonth()};
let anneeActive = aujourdhui.getFullYear();
let modeComparaison = 'mois';
let modeCompareScope = 'tout';

/* Résumé/Budget : possibilité d'inclure la part personnelle des dépenses conjointes dans le
   total et la répartition par catégorie de la vue Personnel, pour voir le vrai portrait de ce
   qu'on dépense au quotidien. Anciennement un bouton "Perso seulement / + Conjoint" ; ce choix
   découle maintenant directement des cases Personnel/Conjoint du menu ☰ (voir
   afficherResumePage/afficherBudgetPage) — actif seulement quand les DEUX sont cochées. */
let inclureConjointDansPersonnel = false;

/* Part de la personne connectée dans une dépense conjointe affichée dans Personnel :
   50/50 pour une dépense conjointe normale, mais le vrai % pour une dépense "compte"
   (puisque celle-là n'est pas forcément partagée moitié-moitié). */
function partPersonnelle(e){
  const p1Pct = (e.pourcentageP1 != null ? e.pourcentageP1 : 50) / 100;
  return currentUser==='p1' ? p1Pct : (1 - p1Pct);
}
function totalConjointPourInclusion(filtrePeriode){
  if(!inclureConjointDansPersonnel) return 0;
  return depenses.filter(e=>e.type==='conjointe' && !e.estRevenu && filtrePeriode(e)).reduce((s,e)=>s+e.amount*partPersonnelle(e),0);
}
function parCategorieConjointPourInclusion(filtrePeriode){
  if(!inclureConjointDansPersonnel) return {};
  const parCat = {};
  depenses.filter(e=>e.type==='conjointe' && !e.estRevenu && filtrePeriode(e)).forEach(e=>{
    parCat[e.category] = (parCat[e.category]||0) + e.amount*partPersonnelle(e);
  });
  return parCat;
}
let depenseEnEdition = null;
/* Vrai quand le formulaire d'ajout conjoint a été ouvert via le choix "Conjoint" du menu +
   (par opposition à "Compte conjoint") : "Compte conjoint" n'a alors plus de raison
   d'apparaître dans "Qui", ce choix ayant déjà été fait séparément. */
let ajoutConjointSansCompte = false;
let activeMainTab = 'transactions';
/* Chaque onglet principal (Transactions/Résumé/Compte/Budget) est maintenant une page à lui
   seul, sans sous-onglets Conjoint/Personnel imbriqués : cette table associe simplement
   chaque onglet à lui-même (Transactions gardant son entrée 'mois' historique), pour que le
   sélecteur de période commun (voir afficherNavigationPeriode) traite les quatre pages de
   façon identique, sans code séparé. */
let activeSubtab = { transactions:'mois', resume:'resume', compte:'compte', budget:'budget' };
/* Les 4 onglets qui partagent le sélecteur de période commun (tous sauf Comparer). */
function estOngletAvecPeriode(tab){ return tab==='transactions' || tab==='resume' || tab==='compte' || tab==='budget'; }
let charts = {};
function detruireGraphique(cle){ if(charts[cle]){ charts[cle].destroy(); delete charts[cle]; } }

function appliquerTheme(){
  document.body.classList.toggle('dark', localStorage.getItem('depenses_theme') === 'dark');
  const darkMode = document.getElementById('dark-mode');
  if(darkMode) darkMode.checked = document.body.classList.contains('dark');
}

document.getElementById('f-date-conjoint').value = formaterDateISO(debutJour(new Date()));
document.getElementById('f-date-personnel').value = formaterDateISO(debutJour(new Date()));

/* Le formulaire repart toujours des valeurs de base : on remet à zéro À L'OUVERTURE comme à
   la fermeture, pour qu'une saisie abandonnée ne réapparaisse jamais à la fois suivante. */
['conjoint','personnel'].forEach(scope=>{
  document.getElementById(`close-add-${scope}`).addEventListener('click', ()=>{
    reinitialiserFormulaireAjoutDepense(scope);
  });
});

/* Bouton (+) de Transactions : ouvre un choix Personnel / Conjoint / Compte conjoint (façon
   Google Agenda) plutôt que d'ouvrir directement un formulaire — la vue étant fusionnée, il
   faut d'abord savoir quel type de dépense créer. */
document.getElementById('add-transactions-btn').addEventListener('click', ()=>{
  document.getElementById('add-transactions-choix').classList.toggle('open');
});
document.querySelectorAll('#add-transactions-choix button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.getElementById('add-transactions-choix').classList.remove('open');
    const choix = btn.dataset.choix;
    const scope = choix === 'personnel' ? 'personnel' : 'conjoint';
    ajoutConjointSansCompte = choix === 'conjoint';
    reinitialiserFormulaireAjoutDepense(scope);
    if(choix === 'compte'){
      /* Le choix "Compte conjoint" déjà fait dans le menu +, inutile de le redemander via
         le champ Qui : on le préremplit et on masque le champ plutôt que de le laisser
         modifiable. */
      document.getElementById('f-who-conjoint').value = 'Compte conjoint';
      document.getElementById('f-who-conjoint').dispatchEvent(new Event('change'));
      document.getElementById('f-who-field-conjoint').style.display = 'none';
    } else if(choix === 'conjoint'){
      /* Ce choix a déjà tranché entre Conjoint et Compte conjoint : "Compte conjoint" n'a
         plus sa place dans "Qui" (voir rafraichirOptionsFormulaires). */
      document.getElementById('f-who-field-conjoint').style.display = '';
    }
    document.getElementById(`form-modal-${scope}`).style.display = 'flex';
  });
});

/* Chargement initial depuis Supabase (avec les noms exacts des colonnes) */
let depensesChargeesOk = false;
async function chargerDepensesSupabase() {
  const { data, error } = await chargerToutesLesLignes('Depenses');
  if (error) {
    console.error("Erreur de chargement Supabase :", error);
    depensesChargeesOk = false;
    return;
  }
  depensesChargeesOk = true;
  depensesReelles = (data || []).map(e => ({
    id: e.id,
    who: clePersonne(e.Qui),
    amount: Number(e.Montant || 0),
    date: e.Date,
    category: e.Categorie || 'Autre',
    note: e.Note || '',
    type: e.Type === 'personnelle' ? 'personnelle' : 'conjointe',
    recurrenceId: e.RecurrenceId || null,
    estCompte: e.EstCompte === true,
    estRevenu: e.EstRevenu === true,
    pourcentageP1: e.PourcentageP1 != null ? Number(e.PourcentageP1) : 50,
    /* Date d'ajout (début de la répartition sur les paies), en date locale. */
    ajout: e.created_at ? formaterDateISO(new Date(e.created_at)) : null
  }));
  /* Migration ponctuelle des anciennes valeurs 'p1'/'p2' de la colonne Qui vers les vrais
     prénoms. On ne l'exécute que si les données qu'on vient de charger en contiennent
     encore : sinon ces deux UPDATE partaient à chaque chargement de page pour ne jamais
     rien modifier. */
  const aMigrer = (data || []).some(e => e.Qui === 'p1' || e.Qui === 'p2');
  if(aMigrer){
    await Promise.all([
      supabaseClient.from('Depenses').update({Qui:nomsPersonnes.p1}).eq('Qui','p1'),
      supabaseClient.from('Depenses').update({Qui:nomsPersonnes.p2}).eq('Qui','p2')
    ]);
  }
  /* Pas de rendu ici : gererSession() attend que les quatre chargements soient terminés,
     puis déclenche un seul recalcul et un seul rafraîchissement (voir initAuth). */
}

/* Exceptions à une règle de récurrence (table "RecurrenceExceptions") : une par occurrence
   qui s'écarte de la série — soit supprimée individuellement, soit modifiée individuellement
   ("cette dépense seulement"). */
let exceptionsSupabaseDisponible = true;
async function chargerExceptionsSupabase(){
  /* En mode local (table Recurrences absente), les exceptions ne peuvent pas être conservées
     en base non plus : on ne tente même pas. */
  if(!recurrencesSupabaseDisponible){ exceptionsSupabaseDisponible = false; exceptions = []; return; }
  try{
    const { data, error } = await chargerToutesLesLignes('RecurrenceExceptions');
    if(error) throw error;
    exceptions = (data || []).map(x => ({
      id: x.id,
      recurrenceId: x.RecurrenceId,
      dateOrigine: x.DateOrigine,
      supprimee: x.Supprimee === true,
      nouvelleDate: x.NouvelleDate || null,
      montant: x.Montant != null ? Number(x.Montant) : null,
      categorie: x.Categorie || null,
      note: x.Note != null ? x.Note : null,
      who: x.Qui ? clePersonne(x.Qui) : null,
      estCompte: x.EstCompte,
      estRevenu: x.EstRevenu,
      pourcentageP1: x.PourcentageP1 != null ? Number(x.PourcentageP1) : null,
      type: x.Type === 'personnelle' ? 'personnelle' : 'conjointe'
    }));
    exceptionsSupabaseDisponible = true;
  } catch(err){
    exceptionsSupabaseDisponible = false;
    console.warn("Table 'RecurrenceExceptions' introuvable dans Supabase : les modifications d'occurrences individuelles ne seront pas conservées.", err);
    exceptions = [];
  }
}

/* ===================== BUDGETS PERSONNELS (par personne, par mois, par catégorie) ===================== */
/* Stockés dans la table Supabase "Budgets" (Personne, Categorie, Periode, Montant). La catégorie
   spéciale "TOTAL" représente le budget global du mois (toutes catégories confondues), distinct
   de la somme des catégories, pour permettre d'afficher un écart. Si la table n'existe pas encore
   chez l'utilisateur, on retombe sur le stockage local de l'appareil. */
let budgets = { p1:{}, p2:{}, conjoint:{} };
let budgetsSupabaseDisponible = true;

function periodeActive(){
  return `${moisActif.year}-${String(moisActif.month+1).padStart(2,'0')}`;
}

async function chargerBudgetsSupabase(){
  try{
    const { data, error } = await chargerToutesLesLignes('Budgets');
    if(error) throw error;
    budgets = { p1:{}, p2:{}, conjoint:{} };
    (data || []).forEach(b=>{
      const cle = b.Personne === 'Conjoint' ? 'conjoint' : clePersonne(b.Personne);
      const periode = b.Periode || periodeActive();
      if(!budgets[cle][periode]) budgets[cle][periode] = {};
      const catKey = b.Categorie === 'TOTAL' ? '__total__' : b.Categorie;
      budgets[cle][periode][catKey] = Number(b.Montant || 0);
    });
  } catch(err){
    budgetsSupabaseDisponible = false;
    console.warn("Table 'Budgets' introuvable ou incomplète dans Supabase, utilisation du stockage local.", err);
    try{ budgets = JSON.parse(localStorage.getItem('depenses_budgets') || '{}'); }catch(e){ budgets = {}; }
    budgets.p1 = budgets.p1 || {};
    budgets.p2 = budgets.p2 || {};
    budgets.conjoint = budgets.conjoint || {};
  }
  /* Rendu déclenché une seule fois par gererSession(), après tous les chargements. */
}

/* Config propre à chaque section : quelles dépenses compter, sous quelle clé stocker le
   budget, et quel nom envoyer à Supabase pour la colonne Personne. Les dépenses comptées
   suivent la période actuellement sélectionnée (Jour/Semaine/Paie/Mois/Année) ; seul le
   budget-cible lui-même (les montants qu'on ajuste) reste toujours mensuel. */
function configSection(scope){
  const { debut, fin } = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
  const debutStr = formaterDateISO(debut), finStr = formaterDateISO(fin);
  const dansPeriode = e => e.date >= debutStr && e.date <= finStr;
  if(scope === 'conjoint'){
    return {
      filtre: e => e.type === 'conjointe' && dansPeriode(e),
      budgetKey: 'conjoint',
      personneSupabase: 'Conjoint',
      valueClass: ''
    };
  }
  return {
    filtre: e => e.type === 'personnelle' && e.who === currentUser && dansPeriode(e),
    budgetKey: currentUser,
    personneSupabase: nomPersonneSupabase(currentUser),
    valueClass: currentUser
  };
}

/* Ramène un budget mensuel à la période actuellement sélectionnée : identique au mois
   pour "Mois", x12 pour "Année", au prorata du nombre de jours sinon (Jour/Semaine/Paie). */
function budgetProratePourPeriode(budgetMensuel, vue, debut, fin){
  if(vue === 'mois') return budgetMensuel;
  if(vue === 'annee') return budgetMensuel * 12;
  const joursPeriode = Math.round((fin - debut) / 86400000) + 1;
  /* On ramène au prorata du mois DU BUDGET qu'on est en train de comparer (periodeActive(),
     donc moisActif — maintenant toujours synchronisé sur la période affichée), et non du
     mois où commence la période : une période de paie à cheval sur deux mois doit rester
     cohérente avec le budget mensuel auquel on la compare. */
  const joursDuMois = new Date(moisActif.year, moisActif.month+1, 0).getDate();
  return budgetMensuel * (joursPeriode / joursDuMois);
}

async function sauvegarderBudget(scope){
  const cfg = configSection(scope);
  const periode = periodeActive();
  const statut = document.getElementById(`budget-save-status-${scope}`);
  const valeurs = {};
  categories.forEach(cat=>{
    const input = document.getElementById(`budget-input-${scope}-${cat}`);
    if(input){ valeurs[cat] = Math.max(0, parseFloat(input.value) || 0); }
  });

  if(!budgets[cfg.budgetKey]) budgets[cfg.budgetKey] = {};
  budgets[cfg.budgetKey][periode] = valeurs;

  /* On retente toujours Supabase, même si une tentative précédente (dans cette session)
     avait échoué : la cause était peut-être temporaire et possiblement réglée depuis. */
  try{
    const lignes = categories.map(cat=>({
      id: `${cfg.budgetKey}-${periode}-${cat}`,
      Personne: cfg.personneSupabase,
      Categorie: cat,
      Periode: periode,
      Montant: valeurs[cat] || 0,
      user_id: scope === 'personnel' ? (currentSession?.user?.id || null) : null
    }));
    const { error } = await supabaseClient.from('Budgets').upsert(lignes, { onConflict:'id' });
    if(error){
      /* La colonne user_id n'existe peut-être pas encore sur Budgets : on réessaie sans elle
         (voir les instructions pour l'ajouter et garder les budgets personnels privés). */
      console.warn("Upsert avec user_id impossible sur Budgets, nouvel essai sans cette colonne.", error);
      const sansUserId = lignes.map(({user_id, ...reste}) => reste);
      const retry = await supabaseClient.from('Budgets').upsert(sansUserId, { onConflict:'id' });
      if(retry.error) throw retry.error;
    }
    budgetsSupabaseDisponible = true;
    if(statut) statut.textContent = "Budget sauvegardé ✓";
  } catch(err){
    console.error(`Échec de la sauvegarde du budget (${scope}) dans Supabase :`, err);
    budgetsSupabaseDisponible = false;
    localStorage.setItem('depenses_budgets', JSON.stringify(budgets));
    if(statut) statut.textContent = "Sauvegardé sur cet appareil seulement (voir la console pour l'erreur exacte).";
  }
  afficherSectionBudget(scope);
}

/* Le budget total d'une période est toujours la somme des catégories : il n'y a plus de
   montant total saisi séparément (ça ne faisait pas de sens d'avoir les deux). */
function budgetTotalCalcule(budgetKey, periode){
  const budgetActuel = (budgets[budgetKey] && budgets[budgetKey][periode]) || {};
  return categories.reduce((s,c)=>s+(budgetActuel[c]||0),0);
}

/* ===================== CALENDRIER DE PAIE (aux 2 semaines) ===================== */
/* Fixe et commun à Gabriel et Mélissa : le 17 septembre 2026 tombe sur une paie, et les
   paies se répètent aux 2 semaines à partir de cette date (passé et futur). */
const paieAncrage = '2026-09-17';

/* ===================== DÉPENSES RÉCURRENTES (abonnements, paiements réguliers) ===================== */
/* Stockées dans la table Supabase "Recurrences" (Nom, Montant, Categorie, Unite, Intervalle,
   JoursSemaine, TypeMensuel, DateDebut, FinType, FinNombre, FinDate, Qui, Type, Actif).
   Si la table n'existe pas encore chez l'utilisateur (ou si les colonnes Unite/Intervalle/
   JoursSemaine/TypeMensuel n'ont pas encore été ajoutées), on retombe sur le stockage local
   de l'appareil, comme pour les budgets — voir les instructions pour ajouter ces colonnes.
   Les occurrences ne sont jamais écrites en base : elles sont calculées à l'affichage
   (voir recalculerDepenses et occurrencesEffectives).

   Modèle de répétition (façon Google Agenda) :
     - unite: 'jour' | 'semaine' | 'mois' | 'annee'
     - intervalle: nombre d'unités entre deux échéances (ex: 2 = un mois sur deux)
     - joursSemaine: tableau de jours (0=dimanche ... 6=samedi), utilisé seulement si unite==='semaine'
     - typeMensuel: 'jour_mois' (même numéro de jour chaque mois, plafonné en fin de mois
       court) ou 'dernier_jour' (toujours le tout dernier jour du mois, peu importe sa
       longueur) — utilisé seulement si unite==='mois'. C'est ce deuxième mode qui règle le
       cas des dépenses facturées le dernier jour du mois (28/29/30/31 selon le mois). */
let recurrences = [];
let recurrencesSupabaseDisponible = true;
let recurrenceEnEdition = null;

/* Convertit l'ancien champ unique "Frequence" ('semaine'/'2semaines'/'mois'/'annee'),
   utilisé avant l'introduction du modèle façon Google Agenda, vers le nouveau modèle
   unite/intervalle. Permet aux récurrences créées avant cette mise à jour de continuer à
   fonctionner sans migration manuelle. */
function migrerAncienneFrequence(frequenceAncienne, dateDebut){
  const jourSemaineDebut = dateDebut ? new Date(dateDebut+"T00:00:00").getDay() : 1;
  if(frequenceAncienne === 'semaine') return { unite:'semaine', intervalle:1, joursSemaine:[jourSemaineDebut], typeMensuel:null };
  if(frequenceAncienne === '2semaines') return { unite:'semaine', intervalle:2, joursSemaine:[jourSemaineDebut], typeMensuel:null };
  if(frequenceAncienne === 'annee') return { unite:'annee', intervalle:1, joursSemaine:null, typeMensuel:null };
  return { unite:'mois', intervalle:1, joursSemaine:null, typeMensuel:'jour_mois' };
}

async function chargerRecurrencesSupabase(){
  try{
    const { data, error } = await chargerToutesLesLignes('Recurrences');
    if(error) throw error;
    recurrences = (data || []).map(r => {
      const aLeNouveauModele = r.Unite != null;
      const modele = aLeNouveauModele
        ? {
            unite: ['jour','semaine','mois','annee','dates'].includes(r.Unite) ? r.Unite : 'mois',
            intervalle: r.Intervalle != null ? Math.max(1, parseInt(r.Intervalle,10)) : 1,
            joursSemaine: r.JoursSemaine ? String(r.JoursSemaine).split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n)) : null,
            typeMensuel: r.TypeMensuel === 'dernier_jour' ? 'dernier_jour' : 'jour_mois'
          }
        : migrerAncienneFrequence(r.Frequence, r.DateDebut);
      return {
        id: r.id,
        nom: r.Nom || '',
        montant: Number(r.Montant || 0),
        categorie: r.Categorie || 'Autre',
        unite: modele.unite,
        intervalle: modele.intervalle,
        joursSemaine: modele.joursSemaine,
        typeMensuel: modele.typeMensuel,
        dateDebut: r.DateDebut || null,
        finType: ['jamais','nombre','date'].includes(r.FinType) ? r.FinType : 'jamais',
        finNombre: r.FinNombre != null ? Number(r.FinNombre) : null,
        finDate: r.FinDate || null,
        who: r.Qui ? clePersonne(r.Qui) : null,
        type: r.Type === 'personnelle' ? 'personnelle' : 'conjointe',
        estCompte: r.EstCompte === true,
        estRevenu: r.EstRevenu === true,
        /* Identifie la "famille" de récurrences issues d'une même série d'origine (voir
           diviserRecurrenceAPartirDe) : quand une récurrence n'a pas encore de RacineId
           (donnée créée avant l'ajout de ce champ, ou récurrence jamais scindée), elle est
           sa propre racine. */
        racineId: r.RacineId || r.id,
        pourcentageP1: r.PourcentageP1 != null ? Number(r.PourcentageP1) : 50,
        actif: r.Actif !== false,
        ajout: r.created_at ? formaterDateISO(new Date(r.created_at)) : null,
        /* Dates d'occurrences individuelles explicitement supprimées ("cette dépense
           seulement") : à ne jamais régénérer, même si leur date n'a plus de dépense liée. */
        datesExclues: r.DatesExclues ? String(r.DatesExclues).split(',').map(s=>s.trim()).filter(Boolean) : []
      };
    });
    recurrencesSupabaseDisponible = true;
  } catch(err){
    recurrencesSupabaseDisponible = false;
    console.warn("Table 'Recurrences' introuvable ou incomplète dans Supabase, utilisation du stockage local.", err);
    try{ recurrences = JSON.parse(localStorage.getItem('depenses_recurrences') || '[]'); }catch(e){ recurrences = []; }
  }
  /* Rendu déclenché une seule fois par gererSession(), après tous les chargements. */
}

function sauvegarderRecurrencesLocal(){
  localStorage.setItem('depenses_recurrences', JSON.stringify(recurrences));
}

/* Nombre d'échéances par année pour une récurrence donnée — sert au calcul du total
   mensuel/annuel affiché dans les stats (pas à la génération réelle des dates). */
function occurrencesParAnnee(rec){
  const intervalle = Math.max(1, rec.intervalle || 1);
  if(rec.unite === 'jour') return 365 / intervalle;
  if(rec.unite === 'semaine'){
    const nbJours = (rec.joursSemaine && rec.joursSemaine.length) ? rec.joursSemaine.length : 1;
    return (52 / intervalle) * nbJours;
  }
  if(rec.unite === 'annee') return 1 / intervalle;
  if(rec.unite === 'dates') return nombreDatesDansUnAn(rec);
  return 12 / intervalle; /* mois */
}
function multiplicateurMensuel(rec){ return occurrencesParAnnee(rec) / 12; }

const NOMS_JOURS_COURTS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const NOMS_JOURS_LETTRE = ['D','L','M','M','J','V','S'];
/* NOMS_MOIS est déjà déclaré plus haut dans le fichier (utilisé aussi par l'affichage du
   calendrier), on le réutilise ici tel quel. */

/* Construit un libellé humain (façon Google Agenda) à partir d'une config de répétition. */
function libelleRecurrence(rec){
  const intervalle = Math.max(1, rec.intervalle || 1);
  if(rec.unite === 'dates') return libelleDatesMultiples(rec);
  if(rec.unite === 'jour'){
    return intervalle === 1 ? 'Tous les jours' : `Tous les ${intervalle} jours`;
  }
  if(rec.unite === 'semaine'){
    const jours = (rec.joursSemaine && rec.joursSemaine.length ? [...rec.joursSemaine] : []).sort();
    if(jours.length === 5 && jours.join(',') === '1,2,3,4,5' && intervalle === 1){
      return 'Tous les jours de semaine (lundi au vendredi)';
    }
    const joursLabel = jours.length ? jours.map(j=>NOMS_JOURS_COURTS[j]).join(', ') : '';
    return intervalle === 1
      ? `Toutes les semaines${joursLabel?` le ${joursLabel}`:''}`
      : `Toutes les ${intervalle} semaines${joursLabel?` le ${joursLabel}`:''}`;
  }
  if(rec.unite === 'annee'){
    let suffixe = '';
    if(rec.dateDebut){
      const d = new Date(rec.dateDebut+"T00:00:00");
      suffixe = ` le ${d.getDate()} ${NOMS_MOIS[d.getMonth()]}`;
    }
    return intervalle === 1 ? `Annuellement${suffixe}` : `Tous les ${intervalle} ans${suffixe}`;
  }
  /* mois */
  if(rec.typeMensuel === 'dernier_jour'){
    return intervalle === 1 ? 'Tous les mois le dernier jour' : `Tous les ${intervalle} mois le dernier jour`;
  }
  const jourMois = rec.dateDebut ? new Date(rec.dateDebut+"T00:00:00").getDate() : null;
  const suffixeJour = jourMois ? ` le ${jourMois}` : '';
  return intervalle === 1 ? `Tous les mois${suffixeJour}` : `Tous les ${intervalle} mois${suffixeJour}`;
}

/* Ramène une config de répétition à une forme CANONIQUE unique. Plusieurs réglages
   différents décrivaient exactement la même récurrence, ce qui produisait des entrées en
   double dans le sélecteur et des libellés incohérents pour un comportement identique :

     · « tous les 7 jours »              ≡ « toutes les semaines le <jour de la date> »
     · « toutes les semaines » sans jour ≡ « toutes les semaines le <jour de la date> »
     · « toutes les semaines », 7 jours  ≡ « tous les jours »

   En normalisant à l'enregistrement, un réglage personnalisé qui retombe sur un préréglage
   existant se confond avec lui au lieu de s'ajouter à côté. */
function normaliserConfigRepetition(cfg, dateISO){
  if(!cfg || cfg === 'jamais') return cfg;
  const normalisee = {...cfg};
  normalisee.intervalle = Math.max(1, normalisee.intervalle || 1);
  const jourDeLaDate = dateISO ? new Date(dateISO+"T00:00:00").getDay() : new Date().getDay();

  /* Un intervalle en jours multiple de 7 est une récurrence hebdomadaire. */
  if(normalisee.unite === 'jour' && normalisee.intervalle % 7 === 0){
    normalisee.unite = 'semaine';
    normalisee.intervalle = normalisee.intervalle / 7;
    normalisee.joursSemaine = [jourDeLaDate];
  }

  if(normalisee.unite === 'semaine'){
    let jours = Array.isArray(normalisee.joursSemaine) ? [...new Set(normalisee.joursSemaine)].sort((a,b)=>a-b) : [];
    /* Aucun jour coché : la règle implicite était « le jour de la date de début ». On la
       rend explicite, pour qu'il n'y ait qu'une seule écriture possible. */
    if(!jours.length) jours = [jourDeLaDate];
    /* Les 7 jours cochés chaque semaine, c'est tous les jours. */
    if(jours.length === 7 && normalisee.intervalle === 1){
      return { unite:'jour', intervalle:1 };
    }
    normalisee.joursSemaine = jours;
  } else if(normalisee.unite === 'dates'){
    const liste = datesMultiplesTriees(normalisee.joursSemaine, dateISO);
    if(!liste.length && dateISO) liste.push(codeDateMultiple(dateISO));
    normalisee.joursSemaine = liste;
    normalisee.intervalle = 1;
  } else {
    delete normalisee.joursSemaine;
  }

  if(normalisee.unite === 'mois'){
    normalisee.typeMensuel = normalisee.typeMensuel === 'dernier_jour' ? 'dernier_jour' : 'jour_mois';
  } else {
    delete normalisee.typeMensuel;
  }

  return normalisee;
}

/* Renvoie le dernier jour du mois contenant `premierDuMoisOuDate` (peu importe le jour du
   mois passé en entrée, seuls l'année et le mois comptent). */
function dernierJourDuMois(anneeOuDate, moisEventuel){
  if(anneeOuDate instanceof Date) return new Date(anneeOuDate.getFullYear(), anneeOuDate.getMonth()+1, 0);
  return new Date(anneeOuDate, moisEventuel+1, 0);
}

/* Par défaut (connexion, ajout, activation), on génère 12 mois à l'avance pour les
   récurrences "jamais" — largement suffisant à l'affichage immédiat. La génération s'étend
   ensuite automatiquement au fur et à mesure que l'utilisateur navigue plus loin dans le
   temps (mois ou année suivants, voir rafraichirSousOnglet), jusqu'à un plafond de 25 ans
   à partir d'aujourd'hui (largement suffisant pour un prêt hypothécaire, par exemple).
   Les récurrences avec un nombre de paiements ou une date de fin s'arrêtent d'elles-mêmes
   avant cela si c'est plus tôt. */
function horizonParDefaut(){
  const d = new Date();
  d.setMonth(d.getMonth()+12);
  return d;
}
const PLAFOND_ANNEES = 25;
function horizonMaximal(){
  const d = new Date();
  d.setFullYear(d.getFullYear()+PLAFOND_ANNEES);
  return d;
}

/* Calcule toutes les dates d'échéance d'une récurrence, du départ jusqu'à la date limite
   donnée (elle-même plafonnée à 25 ans dans le futur), en respectant sa condition de fin
   (jamais / nombre de paiements / date de fin). Couvre les échéances passées et futures.
   Gère les 4 unités (jour/semaine/mois/année), l'intervalle personnalisé, plusieurs jours
   de la semaine à la fois, et le cas "dernier jour du mois" (recalculé fraîchement chaque
   mois, plutôt que de simplement plafonner un numéro de jour fixe qui resterait ensuite
   coincé sur un mois court). */
function genererOccurrences(rec, limiteDate){
  const dates = [];
  if(!rec.dateDebut) return dates;
  const debut = new Date(rec.dateDebut+"T00:00:00");
  const plafond = horizonMaximal();
  const limiteDemandee = limiteDate && limiteDate < plafond ? limiteDate : plafond;
  const finDateObj = rec.finType==='date' && rec.finDate ? new Date(rec.finDate+"T00:00:00") : null;
  const limite = finDateObj && finDateObj < limiteDemandee ? finDateObj : limiteDemandee;
  const maxOccurrences = rec.finType==='nombre' && rec.finNombre != null ? rec.finNombre : Infinity;
  const intervalle = Math.max(1, rec.intervalle || 1);
  const unite = rec.unite || 'mois';

  if(unite === 'semaine'){
    const jours = (rec.joursSemaine && rec.joursSemaine.length) ? rec.joursSemaine : [debut.getDay()];
    const semaineDebut = new Date(debut); semaineDebut.setDate(semaineDebut.getDate() - semaineDebut.getDay());
    let curseur = new Date(debut);
    let compte = 0;
    while(curseur <= limite && compte < maxOccurrences){
      if(jours.includes(curseur.getDay())){
        const semaineCourante = new Date(curseur); semaineCourante.setDate(semaineCourante.getDate() - semaineCourante.getDay());
        const diffSemaines = Math.round((semaineCourante - semaineDebut) / (7*86400000));
        if(diffSemaines % intervalle === 0){
          dates.push(new Date(curseur));
          compte++;
        }
      }
      curseur.setDate(curseur.getDate()+1);
    }
    return dates;
  }

  if(unite === 'dates') return occurrencesDatesMultiples(rec, debut, limite, maxOccurrences);

  if(unite === 'mois'){
    let moisCourant = new Date(debut.getFullYear(), debut.getMonth(), 1);
    let compte = 0;
    while(compte < maxOccurrences){
      const occ = rec.typeMensuel === 'dernier_jour'
        ? dernierJourDuMois(moisCourant)
        : new Date(moisCourant.getFullYear(), moisCourant.getMonth(), Math.min(debut.getDate(), dernierJourDuMois(moisCourant).getDate()));
      if(occ > limite) break;
      if(occ >= debut){ dates.push(occ); compte++; }
      moisCourant.setMonth(moisCourant.getMonth()+intervalle);
    }
    return dates;
  }

  if(unite === 'annee'){
    let anneeCourante = debut.getFullYear();
    let compte = 0;
    while(compte < maxOccurrences){
      const dernierJourMoisVise = dernierJourDuMois(anneeCourante, debut.getMonth());
      const occ = new Date(anneeCourante, debut.getMonth(), Math.min(debut.getDate(), dernierJourMoisVise.getDate()));
      if(occ > limite) break;
      if(occ >= debut){ dates.push(occ); compte++; }
      anneeCourante += intervalle;
    }
    return dates;
  }

  /* unite === 'jour' */
  let courant = new Date(debut);
  let compte = 0;
  while(courant <= limite && compte < maxOccurrences){
    dates.push(new Date(courant));
    compte++;
    courant.setDate(courant.getDate()+intervalle);
  }
  return dates;
}
function formaterDateISO(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function debutJour(date){ const d = new Date(date); d.setHours(0,0,0,0); return d; }
function dateLocaleDepuisISO(dateStr){ return new Date(dateStr+"T00:00:00"); }
function ajouterJours(date, n){ const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function joursEntreDates(a, b){
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}
/* Indice entier (peut être négatif) de la période de 2 semaines de `date` par rapport à
   l'ancrage : indexPaie(ancrage)===0, indexPaie(ancrage+14j)===1, indexPaie(ancrage-14j)===-1. */
function indexPaiePourDate(ancrage, date){ return Math.floor(joursEntreDates(ancrage, date) / 14); }
function paieDate(ancrage, n){ return ajouterJours(ancrage, n*14); }

/* Vrai si `date` tombe sur une paie : la grille des paies est ancrée et régulière (aux 2
   semaines), donc il suffit de compter les jours depuis l'ancrage. Le double modulo gère les
   dates ANTÉRIEURES à l'ancrage, où le reste serait négatif. */
function estJourDePaie(date){
  if(!paieAncrage) return false;
  const ancrage = debutJour(dateLocaleDepuisISO(paieAncrage));
  return ((joursEntreDates(ancrage, debutJour(date)) % 14) + 14) % 14 === 0;
}

const NB_PAIES_ECHEANCIER = 8; /* ~3-4 mois, aux 2 semaines */

/* Jours entiers, sans heure ni fuseau : un numéro par date, pour compter sans surprise
   (changements d'heure compris). Les montants du registre sont en CENTS entiers pour que
   les additions et les reports ne dérivent jamais d'un sou. */
function numeroJour(iso){
  const [a, m, j] = String(iso).slice(0,10).split('-').map(Number);
  return Math.round(Date.UTC(a, m-1, j) / 86400000);
}
function isoDuNumero(n){
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
}
/* Première paie à la date n ou après. */
function premierePaieNum(ancre, n){
  const r = (((n - ancre) % 14) + 14) % 14;
  return r === 0 ? n : n + (14 - r);
}
/* Dernière paie à la date n ou avant. */
function dernierePaieNum(ancre, n){
  const r = (((n - ancre) % 14) + 14) % 14;
  return n - r;
}
function nombrePaiesEntre(ancre, a, b){
  if(b < a) return 0;
  const p = premierePaieNum(ancre, a);
  return p > b ? 0 : Math.floor((b - p) / 14) + 1;
}
const enCents = m => Math.round(Number(m || 0) * 100);
const enDollars = c => c / 100;
/* Termine une phrase par un point, sans doubler celui d'une abréviation (« 1 oct. »). */
function finPhrase(texte){ return /\.$/.test(texte) ? texte : texte + '.'; }
function dateCourteNum(n){
  return dateLocaleDepuisISO(isoDuNumero(n)).toLocaleDateString('fr-CA', { day:'numeric', month:'short' });
}
/* Découpe `cents` en n morceaux entiers qui diffèrent d'au plus 1 cent. Les cents restants
   vont aux premières paies : l'argent est légèrement en avance, jamais en retard. */
function morceauxEgaux(cents, n){
  const base = Math.floor(cents / n);
  const reste = cents - base * n;
  return Array.from({ length:n }, (_, i) => base + (i < reste ? 1 : 0));
}
function partagerCents(cents, pourcentageP1){
  const pct = pourcentageP1 != null ? pourcentageP1 : 50;
  const p1 = Math.round(cents * pct / 100);
  return { p1, p2: cents - p1, pct };
}

/* ===================== MOTEUR DU COMPTE CONJOINT : SUIVI JOUR PAR JOUR =====================
   Les dépôts prévus sont des revenus récurrents (ou uniques) avec l'option « Dépôt pour payer
   le compte », au montant et à la fréquence que VOUS choisissez. Le moteur ne les change
   jamais : il suit le solde jour par jour et vérifie que ça tient.

   1. Réalité. Les transactions du compte datées d'aujourd'hui ou avant donnent le SOLDE du
      compte, et l'ÉQUILIBRE de chacun : ce qu'il a déposé moins sa part des dépenses (et
      plus sa part des autres revenus). 0 = à jour, négatif = doit rattraper, positif =
      avance. L'argent déjà dans le compte au point de départ est un coussin commun : il
      n'appartient à personne, d'où des équilibres à 0 au départ (reference).
   2. Prévision. Les dépenses et revenus à venir, plus les dépôts prévus datés d'aujourd'hui
      ou après. Un dépôt prévu dont la date est passée et qui n'est pas confirmé n'est PAS
      compté : il est « à confirmer ».
   3. Vérification, chaque jour de la prochaine année (fin de journée) :
      - le compte (total) ne descend jamais sous le minimum : c'est la seule contrainte du
        compte, le coussin servant aux deux.
   4. Par personne, on regarde seulement l'équilibre : ce qu'il lui reste à déposer pour payer
      sa part (sa part des dépenses à venir, moins ses dépôts prévus, moins son avance).
   Montants en cents entiers, dates en numéros de jour (voir numeroJour). */

const MOTEUR_HORIZON_JOURS = 366;
const MOTEUR_PERSONNES = ['p1', 'p2'];

function arrondiDollarSup(cents){ return cents <= 0 ? 0 : Math.ceil(Math.ceil(cents) / 100) * 100; }
function deposantDe(m){
  if(!m.estRevenu) return null;
  if(m.pct === 100) return 'p1';
  if(m.pct === 0) return 'p2';
  return null;
}

/* entree = { mouvements, prevus, aujourdhui, coussin, horizon, reference }
   reference  : point de remise à zéro des équilibres, { jour, p1, p2 } (facultatif)
   mouvements : transactions réelles du compte et prévisions ordinaires (dépenses et revenus
                récurrents), dépôts confirmés compris : [{ id, jour, cents, estRevenu, pct, libelle }]
   prevus     : dépôts prévus non confirmés : [{ id, X, jour, cents, libelle }] */
function calculerMoteurCompte(entree){
  const auj = entree.aujourdhui;
  const fin = auj + (entree.horizon || MOTEUR_HORIZON_JOURS);
  const coussin = Math.max(0, entree.coussin || 0);
  const ref = entree.reference || null;
  const ouverture = { p1: ref ? (ref.p1 || 0) : 0, p2: ref ? (ref.p2 || 0) : 0 };
  /* Un dépôt ne bouge l'équilibre de personne que s'il est attribué à quelqu'un en propre
     (pct 100 ou 0, ex. « Dépôt de Gabriel »). Un dépôt partagé (ex. 50/50) entre simplement
     dans le solde commun : il n'appartient à personne en particulier, donc n'avance ni ne
     retarde qui que ce soit. Les dépenses, elles, comptent toujours (chacun doit sa part). */
  const compteDansEquilibre = m => (!ref || m.jour > ref.jour) && (!m.estRevenu || m.deposant != null);

  /* Mouvements du compte, avec la part de chacun. */
  const mvts = (entree.mouvements || []).map(m => {
    const s = partagerCents(m.cents, m.pct);
    const signe = m.estRevenu ? 1 : -1;
    return { ...m, type: 'reel', deposant: deposantDe(m), d: { p1: signe * s.p1, p2: signe * s.p2 } };
  });
  const prevus = (entree.prevus || []).map(q => {
    const d = { p1: 0, p2: 0 }; d[q.X] = q.cents;
    return { ...q, type: 'prevu', estRevenu: true, deposant: q.X, d };
  });
  const aConfirmer = prevus.filter(q => q.jour < auj).sort((a, b) => a.jour - b.jour);
  const dusAujourdhui = prevus.filter(q => q.jour === auj);

  /* 1) Réalité : solde et équilibres à la fin d'aujourd'hui (transactions réelles seulement). */
  const tri = (a, b) => a.jour - b.jour || (b.estRevenu - a.estRevenu);
  const passes = mvts.filter(m => m.jour <= auj).sort(tri);
  let solde = 0;
  const equilibres = { ...ouverture };
  passes.forEach(m => {
    solde += m.d.p1 + m.d.p2;
    if(compteDansEquilibre(m)){ equilibres.p1 += m.d.p1; equilibres.p2 += m.d.p2; }
  });

  /* 2) Journal jour par jour : historique réel, puis prévision (aujourd'hui compris). */
  const grouper = (liste, soldeDepart, equilibreDepart) => {
    let total = soldeDepart;
    const acc = { ...equilibreDepart };
    const jours = [];
    liste.forEach(m => {
      total += m.d.p1 + m.d.p2;
      if(compteDansEquilibre(m)){ acc.p1 += m.d.p1; acc.p2 += m.d.p2; }
      let j = jours[jours.length - 1];
      if(!j || j.jour !== m.jour){ j = { jour: m.jour, mouvements: [] }; jours.push(j); }
      j.mouvements.push({ id: m.id, libelle: m.libelle, cents: m.estRevenu ? m.cents : -m.cents,
        deposant: m.deposant, type: m.type, X: m.X || null });
      j.solde = total;
      j.equilibres = { ...acc };
    });
    return jours;
  };
  const historique = grouper(passes, 0, ouverture);

  const aVenir = [
    ...mvts.filter(m => m.jour > auj && m.jour <= fin),
    ...prevus.filter(q => q.jour >= auj && q.jour <= fin)
  ].sort(tri);
  const projection = grouper(aVenir, solde, equilibres);
  /* Aujourd'hui figure toujours en tête de la projection, avec ses mouvements réels (déjà
     dans le solde) suivis des dépôts prévus aujourd'hui. */
  const derniereJournee = historique[historique.length - 1];
  const reelsDuJour = derniereJournee && derniereJournee.jour === auj ? derniereJournee.mouvements : [];
  if(projection.length && projection[0].jour === auj){
    projection[0].mouvements = [...reelsDuJour, ...projection[0].mouvements];
  } else {
    projection.unshift({ jour: auj, mouvements: [...reelsDuJour], solde, equilibres: { ...equilibres } });
  }

  /* 3) Vérifications. */
  let minimum = projection[0];
  projection.forEach(j => { if(j.solde < minimum.solde) minimum = j; });
  const premierSous = projection.find(j => j.solde < coussin) || null;
  /* Ce qu'il faudrait déposer de plus (par n'importe qui) pour que le compte tienne. */
  let manqueCompte = 0;
  projection.forEach(j => { manqueCompte = Math.max(manqueCompte, coussin - j.solde); });
  const sousMinimum = premierSous
    ? { jour: premierSous.jour, solde: premierSous.solde, manque: arrondiDollarSup(manqueCompte) }
    : null;

  /* Par personne : où en est son équilibre, et ce qu'il lui reste à déposer d'ici la fin de
     la prévision pour payer sa part (sans jamais toucher à l'équilibre de l'autre). */
  const personnes = {};
  const derniereJ = projection[projection.length - 1];
  MOTEUR_PERSONNES.forEach(X => {
    const depotsX = prevus.filter(q => q.X === X && q.jour >= auj && q.jour <= fin).sort((a, b) => a.jour - b.jour);
    const finalX = derniereJ ? derniereJ.equilibres[X] : equilibres[X];
    let plusBas = projection[0];
    projection.forEach(j => { if(j.equilibres[X] < plusBas.equilibres[X]) plusBas = j; });
    const info = {
      equilibre: equilibres[X],
      equilibreFin: finalX,
      ok: finalX >= 0,
      manque: Math.max(0, -finalX),
      plusBas: { jour: plusBas.jour, equilibre: plusBas.equilibres[X] },
      prochainDepot: depotsX[0] || null,
      correction: null
    };
    if(!info.ok){
      const q = depotsX[0];
      info.correction = q
        ? { type: 'ajout', depot: q, cents: arrondiDollarSup(info.manque) }
        : { type: 'nouveau', jour: auj, cents: arrondiDollarSup(info.manque) };
    }
    personnes[X] = info;
  });

  return {
    aujourdhui: auj, fin, coussin, solde, equilibres, reference: ref,
    historique, projection, minimum, sousMinimum, personnes,
    aConfirmer, dusAujourdhui,
    prochains: prevus.filter(q => q.jour >= auj).sort((a, b) => a.jour - b.jour)
  };
}

/* ===================== COMPTE CONJOINT : RÉGLAGES =====================
   Le minimum du compte (et la portion de chacun, 50 % par défaut) est gardé dans la table
   Budgets, sous la période spéciale « moteur-compte » (Personne = Conjoint), en cents.
   Aucune nouvelle table ni colonne. Si Budgets est inaccessible, on le garde sur l'appareil. */
const PERIODE_MOTEUR = 'moteur-compte';
const CLE_LOCALE_MOTEUR = 'depenses_moteur_compte';
let donneesCompteChargees = false;
let dernierResultatMoteur = null;
let fileSauvegardeMoteur = Promise.resolve();

function lireEtatMoteur(){
  const carte = budgets.conjoint && budgets.conjoint[PERIODE_MOTEUR];
  if(carte && Object.keys(carte).length) return carte;
  try{ return JSON.parse(localStorage.getItem(CLE_LOCALE_MOTEUR) || 'null') || {}; }
  catch(e){ return {}; }
}
function reglagesDepuisEtat(c){
  return {
    coussin: c.COUSSIN_CENTS != null ? Math.max(0, c.COUSSIN_CENTS) : 0,
    /* Remise à zéro des équilibres : à partir de ce jour, l'argent déjà au compte est un
       coussin commun, et chacun repart de l'ouverture enregistrée (0 par défaut). */
    reference: c.REFERENCE_JOUR != null
      ? { jour: c.REFERENCE_JOUR, p1: c.OUVERTURE_P1 || 0, p2: c.OUVERTURE_P2 || 0 }
      : null
  };
}
function sauvegarderEtatMoteur(valeurs){
  const ancien = lireEtatMoteur();
  const modifies = Object.keys(valeurs).filter(cle => ancien[cle] !== valeurs[cle]);
  if(!modifies.length) return fileSauvegardeMoteur;
  if(!budgets.conjoint) budgets.conjoint = {};
  budgets.conjoint[PERIODE_MOTEUR] = { ...ancien, ...valeurs };
  const lignes = modifies.map(cle => ({
    id: `moteur-${cle}`, Personne: 'Conjoint', Categorie: cle, Periode: PERIODE_MOTEUR, Montant: valeurs[cle]
  }));
  fileSauvegardeMoteur = fileSauvegardeMoteur.then(async () => {
    try{
      if(!budgetsSupabaseDisponible) throw new Error('Budgets indisponible');
      const { error } = await supabaseClient.from('Budgets').upsert(lignes, { onConflict: 'id' });
      if(error) throw error;
    } catch(err){
      console.warn("Minimum du compte gardé sur cet appareil seulement.", err);
      localStorage.setItem(CLE_LOCALE_MOTEUR, JSON.stringify(budgets.conjoint[PERIODE_MOTEUR]));
    }
  });
  return fileSauvegardeMoteur;
}
async function enregistrerReglagesCompte(coussinDollars){
  await sauvegarderEtatMoteur({ COUSSIN_CENTS: Math.max(0, Math.round((coussinDollars || 0) * 100)) });
  rafraichirActif();
}

/* ===================== COMPTE CONJOINT : DONNÉES POUR LE MOTEUR ===================== */
function estDepotPersonne(e){ return !!e.estRevenu && (e.pourcentageP1 === 100 || e.pourcentageP1 === 0); }

/* Transactions réelles du compte et prévisions ordinaires (séries qui ne sont pas des
   dépôts prévus). */
function collecterMouvementsCompte(limite){
  const liste = [];
  const ajouter = (e, id) => liste.push({
    id, jour: numeroJour(e.date), cents: enCents(e.amount), estRevenu: !!e.estRevenu,
    pct: e.pourcentageP1 != null ? e.pourcentageP1 : 50,
    libelle: estDepotPersonne(e) ? `Dépôt de ${nomsPersonnes[e.pourcentageP1 === 100 ? 'p1' : 'p2']}` : (e.note || e.category)
  });
  depensesReelles.filter(e => e.type === 'conjointe' && e.estCompte && !e.recurrenceId).forEach(e => ajouter(e, e.id));
  recurrences.filter(r => r.actif && r.type === 'conjointe' && !estSerieDepot(r)).forEach(rec => {
    occurrencesEffectives(rec, limite).forEach(o => { if(o.estCompte) ajouter(o, o.id); });
  });
  return liste;
}

function executerMoteurCompte(jusquA){
  const reglages = reglagesDepuisEtat(lireEtatMoteur());
  const auj = numeroJour(formaterDateISO(new Date()));
  /* Au moins un an ; plus loin si la période affichée le demande (au plus 5 ans). */
  const horizon = Math.min(MOTEUR_HORIZON_JOURS * 5, Math.max(MOTEUR_HORIZON_JOURS, (jusquA || 0) - auj));
  const limite = dateLocaleDepuisISO(isoDuNumero(auj + horizon));
  const mouvements = collecterMouvementsCompte(limite);
  const occ = occurrencesDepotsPrevus(limite);
  const prevus = occ.map(o => ({ id: o.id, X: o.depotPersonne, jour: numeroJour(o.date), cents: enCents(o.amount), libelle: o.note }));
  const r = calculerMoteurCompte({ mouvements, prevus, aujourdhui: auj, horizon, coussin: reglages.coussin, reference: reglages.reference });
  r.reglages = reglages;
  r.occurrences = new Map(occ.map(o => [o.id, o]));
  r.aDesMouvements = mouvements.length > 0 || occ.length > 0 || recurrences.some(estSerieDepot);
  dernierResultatMoteur = r;
  return r;
}

/* Ce que lit la fonction planifiée des notifications (table depots_echeancier) : une ligne
   par date où un dépôt prévu n'est pas encore confirmé, avec le total de chacun ce jour-là.
   On garde les 3 derniers jours (pour le rappel du lendemain) et les 60 prochains. */
function echeancierPourNotifications(r){
  if(!r || !donneesCompteChargees) return null;
  const debut = r.aujourdhui - 3, fin = r.aujourdhui + 60;
  const parDate = new Map();
  [...r.aConfirmer, ...r.prochains].forEach(q => {
    if(q.jour < debut || q.jour > fin) return;
    const iso = isoDuNumero(q.jour);
    const l = parDate.get(iso) || { iso, p1: 0, p2: 0 };
    l[q.X] += q.cents / 100;
    parDate.set(iso, l);
  });
  return [...parDate.values()].sort((a, b) => a.iso.localeCompare(b.iso));
}

/* Ouverture depuis une notification : « ?depot=p1&date=AAAA-MM-JJ » (ou message du service
   worker quand l'app est déjà ouverte) → la fenêtre de ce dépôt. */
function ouvrirDepotDepuisParametres(params){
  const X = params.get('depot');
  const iso = params.get('date');
  if(!MOTEUR_PERSONNES.includes(X) || !/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const bouton = document.querySelector('.tab-btn[data-tab="compte"]');
  if(bouton && activeMainTab !== 'compte') bouton.click();
  const occ = occurrencesDepotsPrevus(dateLocaleDepuisISO(isoDuNumero(numeroJour(iso) + 400)))
    .find(o => o.depotPersonne === X && o.date === iso);
  if(occ){ ouvrirDepotPlanifie(occ.id); return true; }
  afficherAlerte(`Le dépôt de ${nomsPersonnes[X]} du ${dateLongueNum(numeroJour(iso))} est déjà confirmé ou n'est plus prévu.`);
  return true;
}
function ouvrirDepotDepuisURL(){
  const params = new URLSearchParams(location.search);
  if(!params.has('depot')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  ouvrirDepotDepuisParametres(params);
}
function recevoirMessageServiceWorker(e){
  if(!e.data || e.data.type !== 'ouvrir-url' || !donneesCompteChargees) return;
  try{ ouvrirDepotDepuisParametres(new URL(e.data.url).searchParams); } catch(err){ /* adresse invalide : rien à ouvrir */ }
}
if('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', recevoirMessageServiceWorker);

/* ===================== COMPTE CONJOINT : AFFICHAGE (onglet Résumé) ===================== */
const argent = c => formaterMonnaie(enDollars(c || 0));
const argentSigne = c => (c > 0 ? '+' : c < 0 ? '−' : '') + formaterMonnaie(Math.abs(enDollars(c || 0)));
const dateCourte = n => dateLocaleDepuisISO(isoDuNumero(n)).toLocaleDateString('fr-CA', { day:'numeric', month:'short' });
const dateLongueNum = n => dateLocaleDepuisISO(isoDuNumero(n)).toLocaleDateString('fr-CA', { day:'numeric', month:'long', year:'numeric' });
const jourSemaine = n => dateLocaleDepuisISO(isoDuNumero(n)).toLocaleDateString('fr-CA', { weekday:'short', day:'numeric', month:'short' });
const autrePersonne = X => X === 'p1' ? 'p2' : 'p1';

let depotsEtendus = false;
let journalOuvert = null;       /* null = selon la vue (fermé en vue Année) */
let graphiqueSuivi = null;

/* Période choisie dans le sélecteur commun (Jour / Semaine / Paie / Mois / Année). */
function periodeCompte(){
  const { debut, fin } = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
  return { vue: etatCalendrierPeriode.vue, debut: numeroJour(formaterDateISO(debut)), fin: numeroJour(formaterDateISO(fin)) };
}
/* Solde et équilibres à la fin d'un jour, passé (réel) ou futur (prévu). */
function soldeAuJour(r, n){
  const liste = n < r.aujourdhui ? r.historique : r.projection;
  let dernier = null;
  for(const j of liste){ if(j.jour <= n) dernier = j; else break; }
  if(dernier) return { solde: dernier.solde, equilibres: dernier.equilibres };
  return { solde: 0, equilibres: { p1: 0, p2: 0 } };
}
function allerALaDate(n){
  etatCalendrierPeriode.dateRef = dateLocaleDepuisISO(isoDuNumero(n));
  synchroniserMoisActif();
  rafraichirSousOnglet('conjoint', 'compte');
  afficherNavigationPeriode();
}

function afficherBlocSoldeCompte(r, per){
  const zone = document.getElementById('solde-compte-bloc');
  if(!zone) return;
  if(!r){ zone.innerHTML = ''; return; }
  const contientAuj = per.debut <= r.aujourdhui && r.aujourdhui <= per.fin;
  const reference = contientAuj ? r.aujourdhui : per.fin;
  const etat = contientAuj ? { solde: r.solde, equilibres: r.equilibres } : soldeAuJour(r, reference);
  const titre = contientAuj ? 'Solde du compte'
    : per.fin < r.aujourdhui ? `Solde au ${dateLongueNum(per.fin)}`
    : `Solde prévu au ${dateLongueNum(per.fin)}`;
  const depart = per.vue !== 'jour' && per.debut <= r.aujourdhui + 366 ? soldeAuJour(r, per.debut - 1) : null;
  /* L'équilibre de chacun : ce qu'il a déposé moins sa part des dépenses. 0 = à jour. */
  const equilibre = X => {
    const v = etat.equilibres[X];
    const etiquette = v === 0 ? 'à jour' : v > 0 ? 'avance' : 'à rattraper';
    return `<div class="cs-part">
      <span class="cs-nom"><span class="dot ${X}"></span>${echapperHTML(nomsPersonnes[X])}</span>
      <strong class="${v < 0 ? 'solde-negatif' : v > 0 ? 'cs-plus' : ''}">${v > 0 ? '+' : ''}${argent(v)}</strong>
      <small class="cs-etiquette">${etiquette}</small>
    </div>`;
  };
  zone.innerHTML = `
    <div class="cs-solde">
      <div class="cs-label">${titre}</div>
      <div class="cs-montant ${etat.solde < 0 ? 'solde-negatif' : ''}">${argent(etat.solde)}</div>
      ${depart ? `<div class="cs-texte cs-depart">Au début de la période (${dateCourte(per.debut)}) : ${argent(depart.solde)}</div>` : ''}
      <div class="cs-label cs-label-equilibre">Équilibre de chacun${contientAuj ? '' : ` au ${dateCourte(per.fin)}`}</div>
      <div class="cs-parts">${equilibre('p1')}${equilibre('p2')}</div>
      <div class="cs-texte">Ce que la personne a déposé, moins sa part des dépenses. L'argent au compte au-delà de ça est le coussin commun.</div>
    </div>
    <div class="cs-minimum">
      <label for="cs-min">Minimum du compte</label>
      <div class="cs-min-champ">
        <input type="number" id="cs-min" min="0" step="1" inputmode="decimal" value="${enDollars(r.reglages.coussin)}">
        <span>$</span>
        <button class="btn-add" id="cs-min-ok" style="display:none;">OK</button>
      </div>
    </div>`;
  const champ = document.getElementById('cs-min');
  const ok = document.getElementById('cs-min-ok');
  const initial = champ.value;
  champ.addEventListener('input', () => { ok.style.display = champ.value !== initial ? '' : 'none'; });
  ok.addEventListener('click', actionVerrouillee(ok, async () => {
    const c = parseFloat(champ.value);
    if(isNaN(c) || c < 0){ afficherAlerte('Le minimum doit être un montant positif.'); return; }
    await enregistrerReglagesCompte(c);
  }));
  champ.addEventListener('keydown', e => { if(e.key === 'Enter' && ok.style.display !== 'none'){ e.preventDefault(); ok.click(); } });
}

/* Proposition (purement informative) : à combien de dépôts espacés de JOURS_PROPOSITION jours
   correspond le manque d'une personne, pour aider à décider combien créer soi-même la prochaine
   fois. Ne crée jamais rien — c'est juste un calcul affiché en texte. */
const JOURS_PROPOSITION = 14; /* aux deux semaines */
function propositionDepot(manqueCents, joursRestants){
  const nbPeriodes = Math.max(1, Math.ceil(Math.max(1, joursRestants) / JOURS_PROPOSITION));
  if(nbPeriodes <= 1) return '';
  const parPeriode = arrondiDollarSup(manqueCents / nbPeriodes);
  return ` Soit environ ${argent(parPeriode)} aux 2 semaines (${nbPeriodes} dépôts d'ici là).`;
}

/* Ce qu'il reste à déposer à une personne pour payer sa part d'ici la fin de la période. */
function ligneEquilibrePersonne(r, X, per){
  const nom = echapperHTML(nomsPersonnes[X]);
  const jours = r.projection.filter(j => j.jour <= per.fin);
  const fin = jours.length ? jours[jours.length - 1] : null;
  const valeur = fin ? fin.equilibres[X] : r.equilibres[X];
  const quand = per.fin >= r.fin ? "d'ici un an" : `d'ici le ${dateCourte(per.fin)}`;
  if(valeur < 0){
    const suggestion = propositionDepot(-valeur, per.fin - r.aujourdhui);
    return `<div class="cs-correction"><span><strong>${nom}</strong> : il lui manque ${argent(-valeur)} ${quand} pour payer sa part.${suggestion}</span></div>`;
  }
  if(valeur > 0){
    return `<div class="cs-correction"><span><strong>${nom}</strong> : ${quand}, ses dépôts dépasseront sa part de ${argent(valeur)}.</span></div>`;
  }
  return `<div class="cs-correction"><span><strong>${nom}</strong> : sa part est payée ${quand}.</span></div>`;
}

function afficherAlerteSoldeCompte(r, per){
  const zone = document.getElementById('solde-compte-alerte');
  if(!zone) return;
  if(!r){ zone.innerHTML = ''; return; }
  const blocs = [];

  /* À confirmer : toujours affiché, peu importe la période (c'est à faire maintenant). */
  const dus = [...r.aConfirmer, ...r.dusAujourdhui];
  if(dus.length){
    blocs.push(`<div class="cs-bloc cs-attente"><div class="cs-titre">À confirmer</div>${dus.map(q =>
      `<button class="cs-bouton" data-ouvrir-depot="${q.id}">${echapperHTML(nomsPersonnes[q.X])} · ${argent(q.cents)} · ${q.jour === r.aujourdhui ? "aujourd'hui" : dateCourte(q.jour)}</button>`).join('')}
      ${r.aConfirmer.length ? `<div class="cs-texte">Un dépôt non confirmé ne compte pas dans le solde ni dans la vérification.</div>` : ''}</div>`);
  }

  /* Vérification sur la partie à venir de la période. */
  const debutVerif = Math.max(per.debut, r.aujourdhui);
  const jours = r.projection.filter(j => j.jour >= debutVerif && j.jour <= per.fin);
  if(per.fin < r.aujourdhui){
    const passes = r.historique.filter(j => j.jour >= per.debut && j.jour <= per.fin);
    const bas = passes.reduce((m, j) => (!m || j.solde < m.solde) ? j : m, null);
    blocs.push(`<div class="cs-bloc"><div class="cs-titre">Période passée</div>
      <div class="cs-texte">${bas ? `Plus bas : ${argent(bas.solde)} le ${dateLongueNum(bas.jour)}.` : 'Aucun mouvement pendant cette période.'}</div></div>`);
  } else if(jours.length){
    const sm = jours.find(j => j.solde < r.coussin);
    const lignes = MOTEUR_PERSONNES.map(X => ligneEquilibrePersonne(r, X, per)).join('');
    const enRetard = MOTEUR_PERSONNES.some(X => {
      const dernier = r.projection.filter(j => j.jour <= per.fin).slice(-1)[0];
      return dernier && dernier.equilibres[X] < 0;
    });
    if(sm){
      const titre = sm.jour === r.aujourdhui
        ? `⚠ Le compte est sous le minimum de ${argent(r.coussin)}`
        : `⚠ Le ${dateLongueNum(sm.jour)}, le compte descendrait à ${argent(sm.solde)}`;
      blocs.push(`<div class="cs-bloc cs-manque"><div class="cs-titre">${titre}</div>
        ${sm.jour === r.aujourdhui ? '' : `<div class="cs-texte">C'est sous le minimum de ${argent(r.coussin)}.</div>`}${lignes}</div>`);
    } else {
      const bas = jours.reduce((m, j) => j.solde < m.solde ? j : m, jours[0]);
      blocs.push(`<div class="cs-bloc ${enRetard ? 'cs-avert' : 'cs-ok'}">
        <div class="cs-titre">${enRetard ? '✓' : '✓'} Le compte reste au-dessus de ${argent(r.coussin)}${per.vue === 'jour' ? '' : ' pendant cette période'}</div>
        <div class="cs-texte">Plus bas : ${argent(bas.solde)} le ${dateLongueNum(bas.jour)}.</div>${lignes}</div>`);
    }
  } else {
    blocs.push(`<div class="cs-bloc"><div class="cs-texte">Cette période dépasse la prévision (un an).</div></div>`);
  }

  /* Problème ailleurs dans l'année : un lien pour y aller. */
  const problemes = [r.sousMinimum && r.sousMinimum.jour]
    .filter(n => n != null && (n < per.debut || n > per.fin));
  if(problemes.length){
    const n = Math.min(...problemes);
    blocs.push(`<button class="cs-lien-probleme" data-aller="${n}">${n === r.aujourdhui
      ? "⚠ Le compte a un problème aujourd'hui — voir"
      : `⚠ Problème prévu le ${dateLongueNum(n)} — voir`}</button>`);
  }

  zone.innerHTML = blocs.join('');
  zone.querySelectorAll('[data-ouvrir-depot]').forEach(b => b.addEventListener('click', () => ouvrirDepotPlanifie(b.dataset.ouvrirDepot)));
  zone.querySelectorAll('[data-aller]').forEach(b => b.addEventListener('click', () => allerALaDate(Number(b.dataset.aller))));
}

/* Dépôts de la période : confirmés, à confirmer et prévus. */
function afficherDepotsPeriode(r, per){
  const confirmes = [];
  r.historique.filter(j => j.jour >= per.debut && j.jour <= per.fin).forEach(j => j.mouvements.forEach(m => {
    if(m.type === 'reel' && m.deposant) confirmes.push({ id: m.id, X: m.deposant, jour: j.jour, cents: m.cents, statut: 'fait' });
  }));
  const prevus = [...r.aConfirmer, ...r.prochains].filter(q => q.jour >= per.debut && q.jour <= per.fin)
    .map(q => ({ id: q.id, X: q.X, jour: q.jour, cents: q.cents, statut: q.jour < r.aujourdhui ? 'a_confirmer' : q.jour === r.aujourdhui ? 'aujourdhui' : 'prevu' }));
  const tous = [...confirmes, ...prevus].sort((a, b) => a.jour - b.jour || a.X.localeCompare(b.X));
  const liste = depotsEtendus ? tous : tous.slice(0, 12);
  const sous = { fait: '✓ confirmé', a_confirmer: 'à confirmer', aujourdhui: 'à confirmer', prevu: 'prévu' };
  const lignes = liste.map(q => `
    <button class="cs-ligne-depot" ${q.statut === 'fait' ? `data-depot-confirme="${q.id}"` : `data-ouvrir-depot="${q.id}"`}>
      <span class="cs-date">${jourSemaine(q.jour)}</span>
      <span class="cs-qui"><span class="dot ${q.X}"></span>${echapperHTML(nomsPersonnes[q.X])}</span>
      <span class="cs-somme">${argent(q.cents)}<small class="cs-statut ${q.statut}">${sous[q.statut]}</small></span>
    </button>`).join('');
  return `
    <div class="cs-titre cs-titre-section">Dépôts</div>
    ${liste.length ? `<div class="cs-liste">${lignes}</div>`
      : `<div class="cs-texte">Aucun dépôt pendant cette période.${r.prochains.length ? '' : " Pour en prévoir, ajoutez un revenu du compte avec l'option « Dépôt pour payer le compte »."}</div>`}
    ${tous.length > 12 ? `<button class="solde-bloc-lien cs-lien" id="depots-bascule">${depotsEtendus ? 'Voir moins' : `Voir les ${tous.length} dépôts`}</button>` : ''}`;
}

/* Suivi jour par jour de la période : graphique + journal. */
function journeesPeriode(r, per){
  const passes = r.historique.filter(j => j.jour >= per.debut && j.jour <= per.fin && j.jour < r.aujourdhui);
  const futurs = r.projection.filter(j => j.jour >= per.debut && j.jour <= per.fin);
  return [...passes, ...futurs];
}
function afficherSuivi(r, per){
  const jours = journeesPeriode(r, per);
  const ouvert = journalOuvert == null ? per.vue !== 'annee' : journalOuvert;
  const ligneJour = j => {
    const prevision = j.jour >= r.aujourdhui;
    const sous = prevision && j.solde < r.coussin;
    const mvts = j.mouvements.map(m => `<div class="cs-mvt ${m.type === 'prevu' ? 'prevu' : ''}">
        <span>${echapperHTML(m.type === 'prevu' ? `Dépôt prévu de ${nomsPersonnes[m.X]}` : (m.libelle || ''))}</span>
        <span class="${m.cents > 0 ? 'cs-plus' : ''}">${argentSigne(m.cents)}</span></div>`).join('');
    return `<div class="cs-jour ${j.jour === r.aujourdhui ? 'aujourdhui' : ''}">
      <div class="cs-jour-haut">
        <span class="cs-jour-date">${j.jour === r.aujourdhui ? "Aujourd'hui" : jourSemaine(j.jour)}</span>
        <span class="cs-jour-solde ${sous ? 'solde-negatif' : ''}">${sous ? '⚠ ' : ''}${argent(j.solde)}</span>
      </div>
      <div class="cs-jour-parts">Équilibre : ${echapperHTML(nomsPersonnes.p1)} ${argent(j.equilibres.p1)} · ${echapperHTML(nomsPersonnes.p2)} ${argent(j.equilibres.p2)}</div>
      ${mvts || '<div class="cs-mvt"><span>Aucun mouvement</span><span></span></div>'}
    </div>`;
  };
  const graphique = per.vue !== 'jour' ? `<div class="cs-graphique"><canvas id="suivi-graphique" height="170"></canvas></div>` : '';
  return `
    <div class="cs-titre cs-titre-section">Solde jour par jour</div>
    ${graphique}
    <button class="solde-bloc-lien cs-lien" id="journal-bascule">${ouvert ? 'Masquer le détail des jours' : `Voir le détail des jours (${jours.length})`}</button>
    ${ouvert ? `<div class="cs-journal">${jours.length ? jours.map(ligneJour).join('') : '<div class="cs-texte">Aucun mouvement pendant cette période.</div>'}</div>` : ''}`;
}
function dessinerGraphiqueSuivi(r, per){
  const canvas = document.getElementById('suivi-graphique');
  if(!canvas || typeof Chart === 'undefined') return;
  if(graphiqueSuivi && graphiqueSuivi.destroy) graphiqueSuivi.destroy();
  const jours = [], passe = [], prevu = [];
  const parJour = new Map();
  r.historique.forEach(j => parJour.set(j.jour, j.solde));
  r.projection.forEach(j => parJour.set(j.jour, j.solde));
  let courant = soldeAuJour(r, per.debut - 1).solde;
  const fin = Math.min(per.fin, r.fin);
  for(let n = per.debut; n <= fin; n++){
    if(parJour.has(n)) courant = parJour.get(n);
    jours.push(n);
    passe.push(n <= r.aujourdhui ? enDollars(courant) : null);
    prevu.push(n >= r.aujourdhui ? enDollars(courant) : null);
  }
  const indexAuj = jours.indexOf(r.aujourdhui);
  const sombre = document.body.classList.contains('dark');
  const couleurTexte = sombre ? '#bdc1c6' : '#5f6368';
  graphiqueSuivi = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: jours.map(n => dateCourte(n)),
      datasets: [
        { label: 'Solde', data: passe, borderColor: '#1a73e8', borderWidth: 2, pointRadius: 0, stepped: true, fill: false },
        { label: 'Prévu', data: prevu, borderColor: '#8ab4f8', backgroundColor: 'rgba(138,180,248,.12)',
          borderWidth: 2, pointRadius: 0, stepped: true, fill: 'origin' },
        { label: 'Minimum', data: jours.map(() => enDollars(r.coussin)), borderColor: '#ea4335', borderWidth: 1,
          borderDash: [2, 3], pointRadius: 0, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item, i, items) => !(item.datasetIndex === 1 && items.some(x => x.datasetIndex === 0)),
          callbacks: {
            title: items => {
              const n = jours[items[0].dataIndex];
              return `${n === r.aujourdhui ? "Aujourd'hui" : dateLongueNum(n)}${n > r.aujourdhui ? ' (prévu)' : ''}`;
            },
            label: item => item.datasetIndex === 2 ? `Minimum : ${formaterMonnaie(item.parsed.y)}` : `Solde : ${formaterMonnaie(item.parsed.y)}`
          }
        }
      },
      scales: {
        x: { ticks: { color: couleurTexte, maxTicksLimit: 6, maxRotation: 0 }, grid: { display: false } },
        y: { ticks: { color: couleurTexte, maxTicksLimit: 5, callback: v => formaterMonnaie(v).replace(/,00\s?\$/, ' $') },
             grid: { color: sombre ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)' } }
      }
    },
    plugins: [{
      id: 'ligneAujourdhui',
      afterDraw(chart){
        if(indexAuj < 0) return;
        const x = chart.scales.x.getPixelForValue(indexAuj);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save(); c.strokeStyle = couleurTexte; c.setLineDash([3, 3]); c.beginPath();
        c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
      }
    }]
  });
}

function afficherEcheancierCompteConjoint(){
  const carte = document.getElementById('recurrent-compte-echeancier-card-conjoint');
  const conteneur = document.getElementById('recurrent-compte-echeancier-conjoint');
  if(!carte || !conteneur) return;
  const per = periodeCompte();
  const r = executerMoteurCompte(per.fin);
  if(!r || !r.aDesMouvements){
    afficherBlocSoldeCompte(null); afficherAlerteSoldeCompte(null);
    conteneur.innerHTML = `<div class="cs-texte">Aucune transaction du compte conjoint pour l'instant.</div>`;
    return;
  }
  afficherBlocSoldeCompte(r, per);
  afficherAlerteSoldeCompte(r, per);
  conteneur.innerHTML = afficherDepotsPeriode(r, per) + afficherSuivi(r, per);
  conteneur.querySelectorAll('[data-ouvrir-depot]').forEach(b => b.addEventListener('click', () => ouvrirDepotPlanifie(b.dataset.ouvrirDepot)));
  conteneur.querySelectorAll('[data-depot-confirme]').forEach(b => b.addEventListener('click', () => ouvrirDetailOccurrence(b.dataset.depotConfirme)));
  const lier = (id, f) => { const el = document.getElementById(id); if(el) el.addEventListener('click', f); };
  lier('depots-bascule', () => { depotsEtendus = !depotsEtendus; afficherEcheancierCompteConjoint(); });
  lier('journal-bascule', () => {
    journalOuvert = !(journalOuvert == null ? per.vue !== 'annee' : journalOuvert);
    afficherEcheancierCompteConjoint();
  });
  try{ dessinerGraphiqueSuivi(r, per); } catch(e){ console.warn('Graphique du solde indisponible.', e); }
}

function fermerDepotModal(){ const m = document.getElementById('depot-modal'); if(m) m.style.display = 'none'; }

/* ===================== DÉPÔTS PRÉVUS AU COMPTE CONJOINT =====================
   Un dépôt prévu est un revenu du compte (récurrent ou unique) avec l'option « Dépôt pour
   payer le compte ». On en crée autant qu'on veut, à la fréquence voulue, et on les modifie
   comme les autres dépenses. Reconnu par sa catégorie (CATEGORIE_DEPOT) et sa part
   (100 % = Gabriel, 0 % = Mélissa) : aucune colonne à ajouter.

   - C'est une prévision : le moteur s'en sert pour vérifier le compte, jamais pour le solde.
   - À sa date, on le confirme (montant et date réels) : un vrai dépôt est créé dans Depenses
     et l'occurrence prévue est retirée par une exception « supprimée » dont la note garde le
     lien (« confirme:<id du dépôt> »), pour pouvoir annuler la confirmation.
   - Le passé ne se modifie pas : une occurrence passée non confirmée se confirme, se
     reporte (à aujourd'hui ou plus tard) ou se supprime. « Toute la série » ne change que les
     dépôts à venir. */
const CATEGORIE_DEPOT = 'Dépôt compte';
const PREFIXE_CONFIRMATION = 'confirme:';
let depotsAConfirmer = [];

function aujourdhuiISO(){ return formaterDateISO(new Date()); }
function lendemainISO(iso){ return formaterDateISO(ajouterJours(dateLocaleDepuisISO(iso), 1)); }
function personneSerieDepot(rec){
  return rec && rec.pourcentageP1 === 100 ? 'p1' : rec && rec.pourcentageP1 === 0 ? 'p2' : null;
}
function estSerieDepot(rec){
  return !!rec && rec.type === 'conjointe' && !!rec.estCompte && !!rec.estRevenu
    && rec.categorie === CATEGORIE_DEPOT && personneSerieDepot(rec) != null;
}
function serieTerminee(rec){
  if(rec.finType !== 'date' && rec.finType !== 'nombre') return false;
  const limite = rec.finType === 'date' && rec.finDate ? dateLocaleDepuisISO(rec.finDate) : horizonMaximal();
  const occ = genererOccurrences(rec, limite);
  return !occ.length || formaterDateISO(occ[occ.length - 1]) < aujourdhuiISO();
}
function dateLongueISO(iso){
  return dateLocaleDepuisISO(iso).toLocaleDateString('fr-CA', { day:'numeric', month:'long', year:'numeric' });
}
const STATUT_DEPOT_TEXTE = { prevu: 'Dépôt prévu', aujourdhui: 'À confirmer', a_confirmer: 'Non confirmé' };

/* Anciennes versions : un dépôt confirmé était relié par sa note « paie du AAAA-MM-JJ ». */
function lienAncienDepot(X, dateOrigine){
  return depensesReelles.some(e => e.type === 'conjointe' && e.estCompte && estDepotPersonne(e)
    && (e.pourcentageP1 === 100 ? 'p1' : 'p2') === X && (e.note || '').includes(`paie du ${dateOrigine}`));
}

/* Occurrences prévues (non confirmées) de toutes les séries de dépôt. */
function occurrencesDepotsPrevus(limiteDate){
  const auj = aujourdhuiISO();
  const res = [];
  recurrences.filter(r => r.actif && estSerieDepot(r)).forEach(rec => {
    const X = personneSerieDepot(rec);
    occurrencesEffectives(rec, limiteDate).forEach(o => {
      if(!(o.amount > 0) || lienAncienDepot(X, o.dateOrigine)) return;
      res.push({ ...o,
        note: o.note || rec.nom || `Dépôt de ${nomsPersonnes[X]}`,
        depotPlanifie: true, depotPersonne: X,
        depotStatut: o.date > auj ? 'prevu' : o.date === auj ? 'aujourdhui' : 'a_confirmer'
      });
    });
  });
  return res.sort((a, b) => a.date.localeCompare(b.date));
}
/* Pour les listes et le calendrier : les dates passées non confirmées sont à part
   (affichées, jamais comptées dans les totaux). */
function occurrencesDepots(limiteDate){
  const toutes = occurrencesDepotsPrevus(limiteDate);
  const auj = aujourdhuiISO();
  return { futures: toutes.filter(o => o.date >= auj), aConfirmer: toutes.filter(o => o.date < auj) };
}
function trouverDepotPlanifie(id){
  return depenses.concat(depotsAConfirmer).find(e => e.depotPlanifie && e.id === id) || null;
}
function occurrencesDeLaFamille(rec){
  const ids = new Set(familleDeRecurrence(rec).map(r => r.id));
  return depenses.concat(depotsAConfirmer).filter(e => e.depotPlanifie && ids.has(e.recurrenceId))
    .sort((a, b) => a.dateOrigine.localeCompare(b.dateOrigine));
}
function premiereOccurrenceAVenir(rec){
  const auj = aujourdhuiISO();
  return occurrencesDeLaFamille(rec).find(e => e.dateOrigine >= auj) || null;
}

/* ----- Confirmer / annuler une confirmation ----- */
async function confirmerDepot(occ, montant, dateIso){
  const aujIso = aujourdhuiISO();
  if(!(montant > 0) || !dateIso){ afficherAlerte("Merci d'entrer un montant et une date valides."); return false; }
  if(dateIso > aujIso){ afficherAlerte('La date du transfert ne peut pas être dans le futur.'); return false; }
  const rec = recurrences.find(r => r.id === occ.recurrenceId);
  if(!rec) return false;
  const X = occ.depotPersonne;
  const note = `Dépôt de ${nomsPersonnes[X]}`;
  const ligne = {
    id: uid(), Qui: nomPersonneSupabase('compte'), Montant: Math.round(montant * 100) / 100, Date: dateIso,
    Categorie: 'Revenu', Note: note, Type: 'conjointe', EstCompte: true, EstRevenu: true,
    PourcentageP1: X === 'p1' ? 100 : 0, user_id: null
  };
  const { error } = await supabaseClient.from('Depenses').insert([ligne]);
  if(error){ signalerEchecEnregistrement('Le dépôt', error); return false; }
  /* L'occurrence prévue est retirée ; si ça échoue, on annule le dépôt pour ne rien compter deux fois. */
  const exc = await enregistrerException(rec, occ.dateOrigine, { supprimee: true, note: PREFIXE_CONFIRMATION + ligne.id });
  if(!exc){
    await supabaseClient.from('Depenses').delete().eq('id', ligne.id);
    return false;
  }
  depensesReelles.push({
    id: ligne.id, who: 'compte', amount: ligne.Montant, date: dateIso, category: 'Revenu', note,
    type: 'conjointe', recurrenceId: null, estCompte: true, estRevenu: true,
    pourcentageP1: ligne.PourcentageP1, ajout: aujIso
  });
  recalculerDepenses();
  rafraichirActif();
  notifierActivitePartenaire('ajout', `${note} confirmé — ${formaterMonnaie(ligne.Montant)}`);
  return true;
}
/* Appelé quand un dépôt réel est supprimé : l'occurrence prévue qu'il remplaçait revient. */
async function libererDepotConfirme(depenseId){
  const exc = exceptions.find(x => x.supprimee && x.note === PREFIXE_CONFIRMATION + depenseId);
  if(!exc) return;
  if(exceptionsSupabaseDisponible){
    const { error } = await supabaseClient.from('RecurrenceExceptions').delete().eq('id', exc.id);
    if(error){ console.warn("Le dépôt prévu n'a pas pu être rétabli.", error); return; }
  }
  exceptions = exceptions.filter(x => x.id !== exc.id);
}

/* ----- Créer ----- */
function valeursSerieDepot(X, champs){
  return { type: 'conjointe', categorie: CATEGORIE_DEPOT, who: 'compte', estCompte: true, estRevenu: true,
    pourcentageP1: X === 'p1' ? 100 : 0, ...champs };
}
async function creerDepotUnique(X, dateIso, cents){
  return creerRecurrenceDepuisValeurs(valeursSerieDepot(X, {
    nom: `Dépôt de ${nomsPersonnes[X]}`, montant: enDollars(cents),
    unite: 'mois', intervalle: 1, joursSemaine: null, typeMensuel: 'jour_mois',
    dateDebut: dateIso, finType: 'nombre', finNombre: 1, finDate: null
  }));
}

/* Correction proposée par la vérification. */
async function appliquerCorrection(X){
  const r = dernierResultatMoteur;
  const c = r && r.personnes[X] && r.personnes[X].correction;
  if(!c) return;
  if(c.type === 'ajout'){
    const occ = trouverDepotPlanifie(c.depot.id);
    if(!occ) return;
    await modifierDepot(occ, 'seule', occ.amount + enDollars(c.cents), occ.date);
  } else {
    const iso = isoDuNumero(Math.max(c.jour, r.aujourdhui));
    if(!(await creerDepotUnique(X, iso, c.cents))) return;
    recalculerDepenses();
    afficherRecurrencesScope('conjoint');
    rafraichirActif();
    notifierActivitePartenaire('ajout', `Dépôt prévu de ${nomsPersonnes[X]} : ${formaterMonnaie(enDollars(c.cents))} le ${dateLongueISO(iso)}`);
  }
}

/* ----- Modifier ----- */
/* Remplace les dépôts À VENIR d'une série par une nouvelle règle ; le passé ne bouge pas.
   `v` = { nom, montant, X, cfg, dateDebut (voulue), finType, finNombre, finDate } */
async function remplacerAvenirSerieDepot(rec, v){
  const famille = familleDeRecurrence(rec);
  const idsFamille = new Set(famille.map(r => r.id));
  const auj = aujourdhuiISO();
  /* Un dépôt déjà confirmé aujourd'hui reste dans l'ancienne règle. */
  const coupe = exceptions.some(x => idsFamille.has(x.recurrenceId) && x.supprimee && x.dateOrigine === auj) ? lendemainISO(auj) : auj;
  let debut = v.dateDebut;
  if(debut < coupe){
    const suivante = genererOccurrences({ ...v.cfg, dateDebut: v.dateDebut, finType: 'jamais' }, horizonMaximal())
      .map(formaterDateISO).find(d => d >= coupe);
    if(!suivante){ afficherAlerte('Aucun dépôt à venir avec cette fréquence.'); return false; }
    debut = suivante;
  }
  const nouvelId = await creerRecurrenceDepuisValeurs(valeursSerieDepot(v.X, {
    nom: v.nom, montant: v.montant,
    unite: v.cfg.unite, intervalle: v.cfg.intervalle, joursSemaine: v.cfg.joursSemaine, typeMensuel: v.cfg.typeMensuel,
    dateDebut: debut, finType: v.finType || 'jamais', finNombre: v.finNombre || null, finDate: v.finDate || null,
    racineId: rec.racineId || rec.id
  }));
  if(!nouvelId) return false;
  for(const seg of famille){
    if(!(await transfererSuppressions(seg.id, nouvelId, coupe))) break;
    if(seg.dateDebut >= coupe){
      if(!(await supprimerRecurrence(seg.id, true))) break;
    } else if(!serieTermineeAvant(seg, coupe)){
      if(!(await tronquerRecurrenceAvant(seg.id, coupe))) break;
      await supprimerExceptions(seg.id, { depuis: coupe });
    }
  }
  recalculerDepenses();
  afficherRecurrencesScope('conjoint');
  rafraichirActif();
  notifierActivitePartenaire('modification', `Dépôts prévus de ${nomsPersonnes[v.X]} : ${formaterMonnaie(v.montant)} à partir du ${dateLongueISO(debut)}`);
  return true;
}
function serieTermineeAvant(rec, iso){
  if(rec.finType === 'date' && rec.finDate) return rec.finDate < iso;
  if(rec.finType === 'nombre'){
    const occ = genererOccurrences(rec, horizonMaximal());
    return !occ.length || formaterDateISO(occ[occ.length - 1]) < iso;
  }
  return false;
}
function cfgDe(rec){
  return { unite: rec.unite, intervalle: rec.intervalle, joursSemaine: rec.joursSemaine, typeMensuel: rec.typeMensuel };
}

/* portee : 'seule' | 'suivantes' | 'serie' (= tous les dépôts à venir) */
async function modifierDepot(occ, portee, montant, dateIso, nom){
  const rec = recurrences.find(r => r.id === occ.recurrenceId);
  if(!rec) return false;
  if(!(montant > 0)){ afficherAlerte("Merci d'entrer un montant valide."); return false; }
  const auj = aujourdhuiISO();
  montant = Math.round(montant * 100) / 100;
  const X = occ.depotPersonne;
  if(portee === 'seule'){
    if(!dateIso || dateIso < auj){ afficherAlerte("La date doit être aujourd'hui ou plus tard."); return false; }
    const ok = await enregistrerException(rec, occ.dateOrigine, {
      supprimee: false, nouvelleDate: dateIso !== occ.dateOrigine ? dateIso : null, montant,
      categorie: CATEGORIE_DEPOT, note: nom || occ.note, who: 'compte', estCompte: true, estRevenu: true,
      pourcentageP1: rec.pourcentageP1
    });
    recalculerDepenses();
    rafraichirActif();
    if(ok) notifierActivitePartenaire('modification', `Dépôt prévu de ${nomsPersonnes[X]} : ${formaterMonnaie(montant)} le ${dateLongueISO(dateIso)}`);
    return !!ok;
  }
  if(portee === 'suivantes'){
    if(occ.dateOrigine < auj){ afficherAlerte('Les dépôts passés ne se modifient pas.'); return false; }
    await diviserRecurrenceAPartirDe(occ, { note: nom || rec.nom, amount: montant, category: CATEGORIE_DEPOT,
      who: 'compte', estCompte: true, estRevenu: true, pourcentageP1: rec.pourcentageP1 });
    afficherRecurrencesScope('conjoint');
    notifierActivitePartenaire('modification', `Dépôts prévus de ${nomsPersonnes[X]} : ${formaterMonnaie(montant)} à partir du ${dateLongueISO(occ.dateOrigine)}`);
    return true;
  }
  const famille = familleDeRecurrence(rec);
  const queue = famille.reduce((a, b) => b.dateDebut > a.dateDebut ? b : a);
  const tete = famille.reduce((a, b) => b.dateDebut < a.dateDebut ? b : a);
  return remplacerAvenirSerieDepot(rec, {
    nom: nom || rec.nom, montant, X, cfg: cfgDe(queue), dateDebut: tete.dateDebut,
    finType: queue.finType, finNombre: queue.finNombre, finDate: queue.finDate
  });
}

/* ----- Supprimer ----- */
async function supprimerDepot(occ, portee){
  const rec = recurrences.find(r => r.id === occ.recurrenceId);
  if(!rec) return;
  if(portee === 'seule'){ await supprimerOccurrenceSeule(occ); return; }
  const depart = portee === 'serie' ? premiereOccurrenceAVenir(rec) : occ;
  if(!depart){ afficherAlerte('Aucun dépôt à venir dans cette série.'); return; }
  await supprimerDepuisOccurrence(depart);
  afficherRecurrencesScope('conjoint');
}

/* ----- Fenêtre d'un dépôt prévu ----- */
function ouvrirDepotPlanifie(id){
  const occ = trouverDepotPlanifie(id);
  if(!occ){ afficherAlerte('Ce dépôt prévu est introuvable : il a peut-être déjà été confirmé.'); return; }
  occurrenceCourante = occ;
  rendreVueDepotPlanifie();
  document.getElementById('occurrence-modal').style.display = 'flex';
}

function rendreVueDepotPlanifie(){
  const d = occurrenceCourante;
  if(!d) return;
  const X = d.depotPersonne;
  const aujIso = aujourdhuiISO();
  const du = d.date <= aujIso;
  const passe = d.date < aujIso;
  const sousTitre = d.date === aujIso ? "Aujourd'hui" : passe ? `${dateLongueISO(d.date)} · pas encore confirmé` : dateLongueISO(d.date);
  document.getElementById('occurrence-modal-content').innerHTML = `
    <div class="modal-header">
      <h3>Dépôt de ${echapperHTML(nomsPersonnes[X])} · ${formaterMonnaie(d.amount)}<span class="modal-sous-titre">${echapperHTML(sousTitre)}</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      ${du ? `
      <div class="depot-section-titre">As-tu transféré ${formaterMonnaie(d.amount)} ?</div>
      <div class="depot-formulaire">
        <div class="field"><label for="occ-depot-montant">Montant ($)</label>
          <input type="number" id="occ-depot-montant" data-num="montant" min="0" step="0.01" inputmode="decimal" value="${d.amount}"></div>
        <div class="field"><label for="occ-depot-date">Date</label>
          <input type="date" id="occ-depot-date" max="${aujIso}" value="${d.date}"></div>
        <button class="btn-add" id="occ-depot-confirmer">Oui, confirmer</button>
      </div>
      <div class="depot-section-titre">Pas encore fait ?</div>
      <div class="depot-formulaire">
        <div class="field"><label for="occ-report-montant">Montant ($)</label>
          <input type="number" id="occ-report-montant" data-num="montant" min="0" step="0.01" inputmode="decimal" value="${d.amount}"></div>
        <div class="field"><label for="occ-report-date">Nouvelle date</label>
          <input type="date" id="occ-report-date" min="${aujIso}" value="${lendemainISO(aujIso)}"></div>
        <button class="btn-secondary" id="occ-report-enregistrer">Reporter</button>
      </div>` : `
      <div style="color:var(--text-secondary);font-size:14px;">Prévision. Vous pourrez le confirmer à partir du ${echapperHTML(dateLongueISO(d.date))}.</div>`}
    </div>
    <div class="modal-footer">
      <button class="btn-secondary btn-danger" id="occ-depot-supprimer">Supprimer</button>
      ${passe ? `<button class="btn-secondary" id="occ-depot-fermer">Fermer</button>` : `<button class="btn-secondary" id="occ-depot-modifier">Modifier</button>`}
    </div>`;
  const lier = (id, f) => { const el = document.getElementById(id); if(el) el.addEventListener('click', f); };
  lier('occ-fermer', fermerOccurrenceModal);
  lier('occ-depot-fermer', fermerOccurrenceModal);
  lier('occ-depot-modifier', () => rendreChoixPorteeDepot('modifier'));
  lier('occ-depot-supprimer', () => passe
    ? (confirm('Supprimer ce dépôt prévu ?') && (fermerOccurrenceModal(), supprimerDepot(d, 'seule')))
    : rendreChoixPorteeDepot('supprimer'));
  const confirmer = document.getElementById('occ-depot-confirmer');
  if(confirmer) confirmer.addEventListener('click', actionVerrouillee(confirmer, async () => {
    const montant = parseFloat(document.getElementById('occ-depot-montant').value);
    const date = document.getElementById('occ-depot-date').value;
    if(await confirmerDepot(d, montant, date)) fermerOccurrenceModal();
  }));
  const reporter = document.getElementById('occ-report-enregistrer');
  if(reporter) reporter.addEventListener('click', actionVerrouillee(reporter, async () => {
    const montant = parseFloat(document.getElementById('occ-report-montant').value);
    const date = document.getElementById('occ-report-date').value;
    if(await modifierDepot(d, 'seule', montant, date)) fermerOccurrenceModal();
  }));
}

function rendreChoixPorteeDepot(action){
  const d = occurrenceCourante;
  const rec = recurrences.find(r => r.id === d.recurrenceId);
  const unique = rec && rec.finType === 'nombre' && rec.finNombre === 1 && familleDeRecurrence(rec).length === 1;
  if(unique){
    if(action === 'modifier'){ rendreFormulaireDepot('seule'); return; }
    if(confirm('Supprimer ce dépôt prévu ?')){ fermerOccurrenceModal(); supprimerDepot(d, 'seule'); }
    return;
  }
  const verbe = action === 'modifier' ? 'Modifier' : 'Supprimer';
  const jour = dateLocaleDepuisISO(d.date).toLocaleDateString('fr-CA', { day:'numeric', month:'long' });
  document.getElementById('occurrence-modal-content').innerHTML = `
    <div class="modal-header">
      <h3>${verbe} un dépôt prévu<span class="modal-sous-titre">${echapperHTML(d.note || '')}</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      <div class="portee-choix">
        <button class="portee-option" data-portee="seule">
          <span class="portee-titre">Ce dépôt seulement</span>
          <span class="portee-desc">Celui du ${jour}</span>
        </button>
        <button class="portee-option" data-portee="suivantes">
          <span class="portee-titre">Ce dépôt et les suivants</span>
          <span class="portee-desc">Les précédents restent inchangés</span>
        </button>
        <button class="portee-option" data-portee="serie">
          <span class="portee-titre">Toute la série</span>
          <span class="portee-desc">Tous les dépôts à venir ; le passé ne change pas</span>
        </button>
      </div>
    </div>
    <div class="modal-footer"><button class="btn-secondary" id="portee-annuler">Retour</button></div>`;
  document.getElementById('occ-fermer').addEventListener('click', fermerOccurrenceModal);
  document.getElementById('portee-annuler').addEventListener('click', rendreVueDepotPlanifie);
  document.querySelectorAll('#occurrence-modal-content [data-portee]').forEach(b => b.addEventListener('click', actionVerrouillee(b, async () => {
    const portee = b.dataset.portee;
    if(action === 'modifier'){ rendreFormulaireDepot(portee); return; }
    const texte = { seule: 'Supprimer ce dépôt prévu ?', suivantes: 'Supprimer ce dépôt et tous les suivants ?',
      serie: 'Supprimer tous les dépôts à venir de cette série ? Les dépôts confirmés restent.' }[portee];
    if(!confirm(texte)) return;
    fermerOccurrenceModal();
    await supprimerDepot(d, portee);
  })));
}

function rendreFormulaireDepot(portee){
  const d = occurrenceCourante;
  const titre = { seule: 'Ce dépôt seulement', suivantes: 'Ce dépôt et les suivants', serie: 'Toute la série' }[portee];
  document.getElementById('occurrence-modal-content').innerHTML = `
    <div class="modal-header">
      <h3>Modifier le dépôt prévu<span class="modal-sous-titre">${titre}</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      <div class="modal-grid">
        <div class="field"><label for="dep-mod-montant">Montant ($)</label>
          <input type="number" id="dep-mod-montant" data-num="montant" min="0" step="0.01" inputmode="decimal" value="${d.amount}"></div>
        ${portee === 'seule' ? `<div class="field"><label for="dep-mod-date">Date</label>
          <input type="date" id="dep-mod-date" min="${aujourdhuiISO()}" value="${d.date}"></div>` : ''}
      </div>
      ${portee === 'seule' ? '' : `<button class="solde-bloc-lien" id="dep-mod-frequence" style="margin-top:10px;">Changer la fréquence ou la date de début</button>`}
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="dep-mod-annuler">Retour</button>
      <button class="btn-add" id="dep-mod-enregistrer">Enregistrer</button>
    </div>`;
  document.getElementById('occ-fermer').addEventListener('click', fermerOccurrenceModal);
  document.getElementById('dep-mod-annuler').addEventListener('click', () => rendreChoixPorteeDepot('modifier'));
  const freq = document.getElementById('dep-mod-frequence');
  if(freq) freq.addEventListener('click', () => { fermerOccurrenceModal(); ouvrirEditionRecurrence(d.recurrenceId); });
  const bouton = document.getElementById('dep-mod-enregistrer');
  bouton.addEventListener('click', actionVerrouillee(bouton, async () => {
    const montant = parseFloat(document.getElementById('dep-mod-montant').value);
    const champDate = document.getElementById('dep-mod-date');
    if(await modifierDepot(d, portee, montant, champDate ? champDate.value : null)) fermerOccurrenceModal();
  }));
}

/* ----- Dépôt confirmé : lecture seule, on peut annuler la confirmation ----- */
function estDepotConfirme(d){
  return !!d && !d.virtuelle && d.type === 'conjointe' && !!d.estCompte && !!d.estRevenu
    && (d.pourcentageP1 === 100 || d.pourcentageP1 === 0);
}
function rendreVueDepotConfirme(){
  const d = occurrenceCourante;
  const X = d.pourcentageP1 === 100 ? 'p1' : 'p2';
  document.getElementById('occurrence-modal-content').innerHTML = `
    <div class="modal-header">
      <h3>Dépôt confirmé · ${formaterMonnaie(d.amount)}<span class="modal-sous-titre">${echapperHTML(nomsPersonnes[X])} · ${echapperHTML(dateLongueISO(d.date))}</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="color:var(--text-secondary);font-size:14px;">Un dépôt confirmé ne se modifie pas. En cas d'erreur, annulez la confirmation : le dépôt redevient prévu.</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary btn-danger" id="occ-annuler-confirmation">Annuler la confirmation</button>
      <button class="btn-secondary" id="occ-fermer-bas">Fermer</button>
    </div>`;
  document.getElementById('occ-fermer').addEventListener('click', fermerOccurrenceModal);
  document.getElementById('occ-fermer-bas').addEventListener('click', fermerOccurrenceModal);
  const bouton = document.getElementById('occ-annuler-confirmation');
  bouton.addEventListener('click', actionVerrouillee(bouton, async () => {
    if(!confirm('Annuler la confirmation de ce dépôt ?')) return;
    fermerOccurrenceModal();
    await supprimerDepense(d.id);
    notifierActivitePartenaire('suppression', `Confirmation annulée : dépôt de ${nomsPersonnes[X]} du ${dateLongueISO(d.date)}`);
  }));
}

/* ----- Formulaire d'ajout : option « Dépôt pour payer le compte » ----- */
function depotAjoutActif(){
  const bascule = document.getElementById('f-est-depot-conjoint');
  return !!bascule && bascule.checked
    && document.getElementById('f-who-conjoint').value === 'Compte conjoint'
    && document.getElementById('f-est-revenu-conjoint').checked;
}
function appliquerAffichageDepotAjout(){
  const champ = document.getElementById('f-est-depot-field-conjoint');
  if(!champ) return;
  const bascule = document.getElementById('f-est-depot-conjoint');
  const possible = document.getElementById('f-who-conjoint').value === 'Compte conjoint'
    && document.getElementById('f-est-revenu-conjoint').checked;
  champ.style.display = possible ? '' : 'none';
  if(!possible) bascule.checked = false;
  const actif = depotAjoutActif();
  const selectQui = document.getElementById('f-depot-qui-conjoint');
  if(!selectQui.options.length){
    selectQui.innerHTML = MOTEUR_PERSONNES.map(X => `<option value="${X}">${echapperHTML(nomsPersonnes[X])}</option>`).join('');
  }
  if(actif && !selectQui.dataset.choisi) selectQui.value = currentUser === 'p2' ? 'p2' : 'p1';
  document.getElementById('f-depot-qui-field-conjoint').style.display = actif ? '' : 'none';
  document.getElementById('f-depot-info-conjoint').style.display = actif ? '' : 'none';
  activerChamp('f-compte-repartition-field-conjoint', !actif);
  if(actif){
    document.getElementById('f-depot-info-texte-conjoint').textContent =
      "Prévision : sert à vérifier le compte. Chaque dépôt se confirme à sa date.";
  }
}
function brancherOptionDepotAjout(){
  if(!document.getElementById('f-est-depot-conjoint')) return;
  ['f-who-conjoint', 'f-est-revenu-conjoint', 'f-est-depot-conjoint'].forEach(id =>
    document.getElementById(id).addEventListener('change', appliquerAffichageDepotAjout));
  document.getElementById('f-depot-qui-conjoint').addEventListener('change', e => { e.target.dataset.choisi = '1'; });
}
/* Valeurs imposées par l'option dans ajouterDepense. */
function valeursDepotAjout(){
  const X = document.getElementById('f-depot-qui-conjoint').value;
  return { X, pourcentageP1: X === 'p1' ? 100 : 0, categorie: CATEGORIE_DEPOT, nom: `Dépôt de ${nomsPersonnes[X]}` };
}

/* ----- Fenêtre d'édition d'une série (liste des paiements récurrents) ----- */
function depotEditionActif(){
  return document.getElementById('edit-rec-est-depot').checked
    && document.getElementById('edit-rec-qui').value === 'Compte conjoint'
    && document.getElementById('edit-rec-est-revenu').checked;
}
function appliquerAffichageDepotEdition(){
  const rec = recurrenceEnEdition;
  const possible = !!rec && rec.type === 'conjointe'
    && document.getElementById('edit-rec-qui').value === 'Compte conjoint'
    && document.getElementById('edit-rec-est-revenu').checked;
  activerChamp('edit-rec-est-depot-field', possible);
  if(!possible) document.getElementById('edit-rec-est-depot').checked = false;
  const actif = depotEditionActif();
  const info = document.getElementById('edit-rec-depot-info');
  info.style.display = actif ? '' : 'none';
  if(actif){
    info.textContent = `Part de ${nomsPersonnes.p1} : 100 % = dépôt de ${nomsPersonnes.p1}, 0 % = dépôt de ${nomsPersonnes.p2}.`
      + (estSerieDepot(rec) && rec.dateDebut < aujourdhuiISO() ? ' Les changements s\'appliquent aux dépôts à venir seulement.' : '');
  }
}
function brancherOptionDepotEdition(){
  if(!document.getElementById('edit-rec-est-depot')) return;
  ['edit-rec-qui', 'edit-rec-est-revenu', 'edit-rec-est-depot'].forEach(id =>
    document.getElementById(id).addEventListener('change', appliquerAffichageDepotEdition));
}
/* Enregistrement d'une série de dépôt depuis la fenêtre d'édition : les dépôts à venir
   seulement. Renvoie true si c'est pris en charge ici. */
async function enregistrerSerieDepotEdition(rec, v){
  const X = v.pourcentageP1 === 100 ? 'p1' : v.pourcentageP1 === 0 ? 'p2' : null;
  if(!X){
    afficherAlerte(`Pour un dépôt, la part de ${nomsPersonnes.p1} doit être 100 % (dépôt de ${nomsPersonnes.p1}) ou 0 % (dépôt de ${nomsPersonnes.p2}).`);
    return false;
  }
  return remplacerAvenirSerieDepot(rec, { nom: v.nom, montant: v.montant, X, cfg: v.cfg, dateDebut: v.dateDebut,
    finType: v.finType, finNombre: v.finNombre, finDate: v.finDate });
}

brancherOptionDepotAjout();
brancherOptionDepotEdition();

async function supprimerSerieDepotEdition(rec){
  const occ = occurrencesDeLaFamille(rec)[0];
  if(!occ){ afficherAlerte('Aucun dépôt prévu dans cette série.'); return; }
  await supprimerDepuisOccurrence(occ);
  afficherRecurrencesScope('conjoint');
}

/* ===================== RÉCURRENCE « DATES PRÉCISES » =====================
   Une dépense ou un revenu prévu à quelques dates choisies (ex. 8 août 2026, 5 septembre
   2026, 7 décembre 2026, 22 janvier 2027), puis plus rien. Les dates sont gardées sous forme
   AAAAMMJJ (20260808…) dans la colonne JoursSemaine, avec Unite = 'dates' : aucune colonne
   à ajouter. (Une première version gardait MMJJ, répété chaque année : ces codes sont lus
   comme la prochaine date correspondante, une seule fois.) */
function codeDateMultiple(iso){ return parseInt(String(iso).replace(/-/g, ''), 10); }
function isoDeCodeDate(code){
  const s = String(code);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function codeDateValide(n){
  if(!(n >= 19000101 && n <= 29991231)) return false;
  const iso = isoDeCodeDate(n);
  const d = dateLocaleDepuisISO(iso);
  return formaterDateISO(d) === iso;
}
/* Codes complets et triés ; `debutIso` sert à convertir les anciens codes MMJJ. */
function datesMultiplesTriees(liste, debutIso){
  const codes = (liste || []).map(Number).map(n => {
    if(n >= 101 && n <= 1231 && debutIso){
      const annee = Number(debutIso.slice(0, 4));
      let c = annee * 10000 + n;
      if(c < codeDateMultiple(debutIso)) c += 10000;
      return c;
    }
    return n;
  }).filter(codeDateValide);
  return [...new Set(codes)].sort((a, b) => a - b);
}
function libelleDateMultiple(code, court){
  return dateLocaleDepuisISO(isoDeCodeDate(code)).toLocaleDateString('fr-CA',
    { day: 'numeric', month: court ? 'short' : 'long', year: 'numeric' });
}
function libelleDatesMultiples(rec){
  const codes = datesMultiplesTriees(rec.joursSemaine, rec.dateDebut);
  const noms = codes.slice(0, 4).map(c => libelleDateMultiple(c, true));
  if(codes.length > 4) return `Le ${noms.join(', ')} et ${codes.length - 4} autre${codes.length > 5 ? 's' : ''} date${codes.length > 5 ? 's' : ''}`;
  return noms.length > 1 ? `Le ${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}` : `Le ${noms[0] || '—'}`;
}
function occurrencesDatesMultiples(rec, debut, limite, maxOccurrences){
  const dates = [];
  const codes = datesMultiplesTriees(rec.joursSemaine, rec.dateDebut);
  if(!codes.length) codes.push(codeDateMultiple(formaterDateISO(debut)));
  for(const code of codes){
    if(dates.length >= maxOccurrences) break;
    const d = dateLocaleDepuisISO(isoDeCodeDate(code));
    if(d < debut) continue;
    if(d > limite) break;
    dates.push(d);
  }
  return dates;
}
function nombreDatesDansUnAn(rec){
  const auj = formaterDateISO(new Date());
  const dans1an = formaterDateISO(ajouterJours(new Date(), 365));
  return datesMultiplesTriees(rec.joursSemaine, rec.dateDebut).map(isoDeCodeDate).filter(d => d >= auj && d <= dans1an).length;
}

/* ----- Contrôles du formulaire ----- */
function champFinDe(ids){
  const el = ids.finType && document.getElementById(ids.finType);
  return el ? el.closest('.field') : null;
}
function libelleDateDe(ids){
  const el = document.getElementById(ids.date);
  return el && el.closest('.field') ? el.closest('.field').querySelector('label') : null;
}
function lireDatesMultiples(ids){
  const el = ids.dates && document.getElementById(ids.dates);
  return el ? datesMultiplesTriees((el.dataset.codes || '').split(',').filter(Boolean)) : [];
}
function ecrireDatesMultiples(ids, codes){
  const el = ids.dates && document.getElementById(ids.dates);
  if(!el) return;
  const liste = datesMultiplesTriees(codes, document.getElementById(ids.date).value || null);
  el.dataset.codes = liste.join(',');
  el.innerHTML = liste.length
    ? liste.map(c => `<span class="date-puce">${libelleDateMultiple(c)}<button type="button" data-retirer="${c}" aria-label="Retirer le ${libelleDateMultiple(c)}">×</button></span>`).join('')
    : `<span class="dates-vide">Aucune date : ajoutez-en une ci-dessous.</span>`;
  /* La date de début de la série est toujours la première date choisie. */
  if(liste.length && document.getElementById(ids.unite).value === 'dates'){
    document.getElementById(ids.date).value = isoDeCodeDate(liste[0]);
  }
}
function appliquerAffichageDatesMultiples(ids){
  if(!ids.datesField) return;
  const champ = document.getElementById(ids.datesField);
  if(!champ) return;
  const estDates = document.getElementById(ids.unite).value === 'dates';
  const etaitDates = champ.dataset.actif === '1';
  champ.dataset.actif = estDates ? '1' : '0';
  champ.style.display = estDates ? '' : 'none';
  /* « Se répète tous les [1] dates précises » ne veut rien dire : on cache le nombre. */
  const intervalle = document.getElementById(ids.intervalle);
  intervalle.style.display = estDates ? 'none' : '';
  if(estDates) intervalle.value = 1;
  const libelle = intervalle.closest('.field') && intervalle.closest('.field').querySelector('label');
  if(libelle) libelle.textContent = estDates ? 'Se répète' : 'Se répète tous les';
  /* Des dates choisies ont leur propre fin : pas de « Se termine ». */
  const fin = champFinDe(ids);
  if(fin){
    if(estDates){
      const select = document.getElementById(ids.finType);
      if(select.value !== 'jamais'){ select.value = 'jamais'; select.dispatchEvent(new Event('change')); }
      fin.style.display = 'none';
    } else if(etaitDates){
      fin.style.display = '';
    }
  }
  const libDate = libelleDateDe(ids);
  if(libDate && estDates) libDate.textContent = 'Première date';
  else if(libDate && etaitDates) libDate.textContent = 'À partir de';
  if(estDates && !lireDatesMultiples(ids).length){
    const iso = document.getElementById(ids.date).value;
    ecrireDatesMultiples(ids, iso ? [codeDateMultiple(iso)] : []);
  }
}
function brancherDatesMultiples(ids){
  if(!ids.dates || !document.getElementById(ids.dates)) return;
  const conteneur = document.getElementById(ids.dates);
  const signaler = () => conteneur.dispatchEvent(new Event('change'));
  conteneur.addEventListener('click', e => {
    const b = e.target.closest('[data-retirer]');
    if(!b) return;
    e.preventDefault();
    const reste = lireDatesMultiples(ids).filter(c => c !== Number(b.dataset.retirer));
    if(!reste.length){ afficherAlerte('Il faut garder au moins une date.'); return; }
    ecrireDatesMultiples(ids, reste);
    signaler();
  });
  const champ = document.getElementById(`${ids.dates}-ajout`);
  const ajouter = () => {
    if(!champ.value) return;
    ecrireDatesMultiples(ids, [...lireDatesMultiples(ids), codeDateMultiple(champ.value)]);
    champ.value = '';
    signaler();
  };
  document.getElementById(`${ids.dates}-bouton`).addEventListener('click', ajouter);
  champ.addEventListener('change', ajouter);
  /* Changer la « Première date » l'ajoute à la liste. */
  document.getElementById(ids.date).addEventListener('change', () => {
    if(document.getElementById(ids.unite).value !== 'dates') return;
    const iso = document.getElementById(ids.date).value;
    if(!iso) return;
    ecrireDatesMultiples(ids, [...lireDatesMultiples(ids), codeDateMultiple(iso)]);
  });
}

/* ===================== CALCUL DES OCCURRENCES À L'AFFICHAGE =====================
   Reconstruit le tableau dérivé `depenses` = dépenses réelles + occurrences des récurrences.
   Aucune écriture en base : les occurrences n'existent qu'en mémoire, le temps de l'affichage.
   C'est ce qui rend les doublons impossibles et permet à "toute la série" de s'appliquer
   à toutes les occurrences, passées comprises. */

/* Jusqu'où on calcule les occurrences. S'étend automatiquement quand l'utilisateur navigue
   plus loin dans le temps (voir etendreHorizon), sans jamais dépasser le plafond de 25 ans. */
let horizonAffichage = horizonParDefaut();

function etendreHorizon(date){
  if(!date) return false;
  const plafond = horizonMaximal();
  const cible = date > plafond ? plafond : date;
  if(cible > horizonAffichage){ horizonAffichage = cible; return true; }
  return false;
}

/* Construit l'occurrence affichable d'une récurrence à une date donnée, en appliquant
   l'exception éventuelle (modification individuelle) par-dessus les valeurs de la série.
   L'identifiant est virtuel et reconstructible : il permet de retrouver la récurrence et la
   date d'origine quand on clique dessus, sans qu'aucune ligne n'existe en base. */
function construireOccurrence(rec, dateOrigine, exception){
  const ex = exception || {};
  return {
    id: `virt:${rec.id}:${dateOrigine}`,
    virtuelle: true,
    recurrenceId: rec.id,
    dateOrigine,
    date: ex.nouvelleDate || dateOrigine,
    who: ex.who != null ? ex.who : rec.who,
    amount: ex.montant != null ? ex.montant : rec.montant,
    category: ex.categorie != null ? ex.categorie : rec.categorie,
    note: ex.note != null ? ex.note : rec.nom,
    type: rec.type,
    estCompte: ex.estCompte != null ? ex.estCompte : !!rec.estCompte,
    estRevenu: ex.estRevenu != null ? ex.estRevenu : !!rec.estRevenu,
    pourcentageP1: ex.pourcentageP1 != null ? ex.pourcentageP1 : (rec.pourcentageP1 != null ? rec.pourcentageP1 : 50)
  };
}

function exceptionsDeRecurrence(recurrenceId){
  const parDate = new Map();
  exceptions.filter(x => x.recurrenceId === recurrenceId).forEach(x => parDate.set(x.dateOrigine, x));
  return parDate;
}

/* Occurrences d'une récurrence jusqu'à `limiteDate`, exceptions appliquées : les
   suppressions individuelles sont retirées, les modifications individuelles appliquées.
   Point de passage unique pour l'affichage ET pour l'échéancier des dépôts, qui ne
   tenait pas compte des exceptions. */
function occurrencesEffectives(rec, limiteDate){
  const parDate = exceptionsDeRecurrence(rec.id);
  /* DatesExclues est l'ancien mécanisme de suppression individuelle (avant la table
     RecurrenceExceptions) : on continue de le respecter pour ne pas faire réapparaître
     des occurrences supprimées avec une version précédente de l'application. */
  const exclusionsHeritees = new Set(rec.datesExclues || []);
  const res = [];
  genererOccurrences(rec, limiteDate).forEach(dateObj => {
    const dateOrigine = formaterDateISO(dateObj);
    if(exclusionsHeritees.has(dateOrigine)) return;
    const ex = parDate.get(dateOrigine);
    if(ex && ex.supprimee) return; /* occurrence supprimée individuellement : jamais recréée */
    res.push(construireOccurrence(rec, dateOrigine, ex));
  });
  return res;
}

function recalculerDepenses(){
  const liste = depensesReelles.slice();
  recurrences.filter(r => r.actif && !estSerieDepot(r)).forEach(rec => {
    liste.push(...occurrencesEffectives(rec, horizonAffichage));
  });
  /* Dépôts récurrents : rien pour une paie déjà confirmée ; les dates passées non
     confirmées sont à part (affichées, jamais comptées). */
  const depots = occurrencesDepots(horizonAffichage);
  liste.push(...depots.futures);
  depotsAConfirmer = depots.aConfirmer;
  depenses = liste;
}

/* Garantit que les occurrences sont calculées au moins jusqu'à la date consultée. Appelée
   AVANT chaque rendu (voir rafraichirSousOnglet) : elle ne déclenche volontairement aucun
   rafraîchissement elle-même, sinon elle rentrerait en boucle avec le rendu qui l'appelle. */
function assurerHorizon(limiteDate){
  if(etendreHorizon(limiteDate)){ recalculerDepenses(); return true; }
  return false;
}


/* Grise un champ (au lieu de le masquer) quand il ne s'applique pas au contexte : la
   disposition reste alors strictement identique d'une fenêtre à l'autre, ce qui évite que
   les champs se déplacent selon le type de dépense. */
function activerChamp(fieldId, actif, controlId){
  const field = document.getElementById(fieldId);
  if(!field) return;
  field.classList.toggle('est-desactive', !actif);
  const controle = controlId ? document.getElementById(controlId)
    : field.querySelector('input, select, button, textarea');
  if(controle) controle.disabled = !actif;
}

function appliquerAffichageFinRecurrence(selectId, nombreFieldId, dateFieldId){
  const select = document.getElementById(selectId);
  const val = select.value;
  /* On MASQUE le champ qui ne s'applique pas, partout de la même façon. La fenêtre
     d'édition se contentait de le griser, si bien qu'en choisissant « À une date précise »
     le champ « Nombre » restait affiché à côté, vide et sans objet. */
  document.getElementById(nombreFieldId).style.display = val==='nombre' ? '' : 'none';
  document.getElementById(dateFieldId).style.display = val==='date' ? '' : 'none';
  /* « Après un nombre de paiements » est trop long pour une demi-largeur : on lui donne
     trois quarts de la rangée et le quart restant au nombre, qui n'a besoin que de deux ou
     trois chiffres. Avec « À une date précise », les deux champs reprennent leur moitié. */
  const champType = select.closest('.field');
  const champNombre = document.getElementById(nombreFieldId);
  if(champType) champType.classList.toggle('fin-type-large', val==='nombre');
  if(champNombre) champNombre.classList.toggle('fin-nombre-etroit', val==='nombre');
}
document.getElementById('edit-rec-fin-type').addEventListener('change', ()=>
  appliquerAffichageFinRecurrence('edit-rec-fin-type','edit-rec-fin-nombre-field','edit-rec-fin-date-field'));

/* La fenêtre d'édition d'une récurrence utilise les MÊMES contrôles que les formulaires
   d'ajout (module partagé plus bas). Pas de bascule ici : une récurrence se répète par
   définition, les réglages sont donc toujours visibles. Le branchement se fait avec le
   module, plus bas dans le fichier (les contrôles y sont définis). */

async function basculerActifRecurrence(id){
  const rec = recurrences.find(r=>r.id===id); if(!rec) return;
  const scope = rec.type==='personnelle' ? 'personnel' : 'conjoint';
  const nouvelEtat = !rec.actif;
  if(recurrencesSupabaseDisponible){
    const res = await ecritureVerifiee(supabaseClient.from('Recurrences').update({Actif:nouvelEtat}).eq('id', id));
    if(!res.ok){
      signalerEchecEnregistrement("Le changement actif/inactif", res.error);
      afficherRecurrencesScope(scope); /* remet la bascule dans son état réel */
      return;
    }
  }
  rec.actif = nouvelEtat;
  sauvegarderRecurrencesLocal();
  /* Une récurrence en pause n'apparaît simplement plus dans le calcul des occurrences :
     il n'y a aucune ligne à supprimer en base. */
  recalculerDepenses();
  rafraichirActif();
  afficherRecurrencesScope(rec.type==='personnelle' ? 'personnel' : 'conjoint');
}

/* Supprime les exceptions d'une récurrence (toutes, ou seulement à partir d'une date, ou
   seulement les modifications en gardant les suppressions). */
async function supprimerExceptions(recurrenceId, options){
  const opts = options || {};
  let cibles = exceptions.filter(x => x.recurrenceId === recurrenceId);
  if(opts.depuis) cibles = cibles.filter(x => x.dateOrigine >= opts.depuis);
  if(opts.garderSuppressions) cibles = cibles.filter(x => !x.supprimee);
  if(!cibles.length) return true;
  const ids = cibles.map(x => x.id);
  if(exceptionsSupabaseDisponible){
    const res = await ecritureVerifiee(supabaseClient.from('RecurrenceExceptions').delete().in('id', ids), ids.length);
    if(!res.ok){ signalerEchecEnregistrement("La suppression des occurrences modifiées", res.error); return false; }
  }
  const aSupprimer = new Set(ids);
  exceptions = exceptions.filter(x => !aSupprimer.has(x.id));
  return true;
}

/* Réaffecte les exceptions d'une récurrence à une autre (utilisé quand une série est
   fractionnée ou fusionnée) : seules les SUPPRESSIONS individuelles sont transférées, car
   une occurrence supprimée doit le rester quoi qu'il arrive ensuite à la série. Les
   modifications individuelles, elles, sont volontairement écrasées par la nouvelle règle
   (c'est le comportement d'un calendrier : "toute la série" / "et les suivantes" ont la
   priorité sur une retouche ponctuelle). */
async function transfererSuppressions(deRecurrenceId, versRecurrenceId, depuis){
  let cibles = exceptions.filter(x => x.recurrenceId === deRecurrenceId && x.supprimee);
  if(depuis) cibles = cibles.filter(x => x.dateOrigine >= depuis);
  if(!cibles.length) return true;
  if(exceptionsSupabaseDisponible){
    const res = await ecritureVerifiee(supabaseClient.from('RecurrenceExceptions')
      .update({ RecurrenceId: versRecurrenceId }).in('id', cibles.map(x => x.id)), cibles.length);
    if(!res.ok){ signalerEchecEnregistrement("Le transfert des occurrences supprimées", res.error); return false; }
  }
  cibles.forEach(x => { x.recurrenceId = versRecurrenceId; });
  return true;
}

async function supprimerRecurrence(id, sansConfirmation){
  if(!sansConfirmation && !confirm("Supprimer ce paiement récurrent ? Toutes ses occurrences (passées et futures) disparaîtront.")) return;
  const rec = recurrences.find(r=>r.id===id);

  if(!(await supprimerExceptions(id))) return false;

  if(recurrencesSupabaseDisponible){
    /* Par sécurité, on supprime aussi d'éventuelles lignes matérialisées en base par une
       ancienne version de l'application (avant le passage au calcul à la volée). Il peut
       légitimement n'y en avoir aucune : pas de vérification du nombre de lignes ici. */
    const nettoyage = await supabaseClient.from('Depenses').delete().eq('RecurrenceId', id);
    if(nettoyage.error) console.warn("Nettoyage des anciennes dépenses matérialisées impossible.", nettoyage.error);
    else depensesReelles = depensesReelles.filter(e => e.recurrenceId !== id);

    const res = await ecritureVerifiee(supabaseClient.from('Recurrences').delete().eq('id', id));
    if(!res.ok){
      signalerEchecEnregistrement("La suppression du paiement récurrent", res.error);
      recalculerDepenses();
      rafraichirActif();
      return false;
    }
  }
  recurrences = recurrences.filter(r=>r.id!==id);
  sauvegarderRecurrencesLocal();
  recalculerDepenses();
  if(rec) afficherRecurrencesScope(rec.type==='personnelle' ? 'personnel' : 'conjoint');
  rafraichirActif();
  return true;
}

/* ===================== PORTÉE D'ÉDITION/SUPPRESSION D'UNE OCCURRENCE (façon Outlook) =====================
   Trois portées possibles quand on touche à une occurrence d'une récurrence :
   - "Cette dépense seulement" : on enregistre une EXCEPTION (suppression ou modification)
     pour cette date précise. Une suppression est définitive : elle survit à toute
     modification ultérieure de la série. Une modification, elle, est écrasée si on modifie
     ensuite "les suivantes" ou "toute la série" (comportement d'un calendrier).
   - "Cette dépense et les suivantes" : on met fin à l'ancienne récurrence la veille, et on
     crée une nouvelle récurrence à partir d'ici avec les nouvelles valeurs. Les deux
     restent membres de la même "famille" (racineId).
   - "Toute la série" : on fusionne toute la famille en une seule règle portant les nouvelles
     valeurs. Toutes les occurrences changent, passées comprises. */

/* "Toute la série" (suppression) : supprime TOUS les segments de la famille, pas seulement
   celui sur lequel on a cliqué. Sans ça, une série ayant été fractionnée par des "cette
   dépense et les suivantes" laissait derrière elle les morceaux créés par ces
   fractionnements, qui continuaient d'afficher des occurrences. */
async function supprimerSerieComplete(recurrenceId, sansConfirmation){
  const rec = recurrences.find(r=>r.id===recurrenceId);
  if(!rec) return;
  if(!sansConfirmation && !confirm("Supprimer ce paiement récurrent ? Toutes ses occurrences (passées et futures) disparaîtront.")) return;
  for(const segment of familleDeRecurrence(rec)){
    if(!(await supprimerRecurrence(segment.id, true))) break;
  }
  recalculerDepenses();
  rafraichirActif();
}

function veilleISO(dateStr){ return formaterDateISO(ajouterJours(dateLocaleDepuisISO(dateStr), -1)); }
function lendemainISO(dateStr){ return formaterDateISO(ajouterJours(dateLocaleDepuisISO(dateStr), 1)); }

/* Tous les segments issus d'une même série d'origine (fractionnements successifs). */
function familleDeRecurrence(rec){
  const racine = rec.racineId || rec.id;
  return recurrences.filter(r => (r.racineId || r.id) === racine);
}

/* Fait se terminer une récurrence la veille de `dateStr` (pour "fractionner" une série en
   deux au moment d'un "cette dépense et les suivantes"). */
async function tronquerRecurrenceAvant(id, dateStr){
  const rec = recurrences.find(r=>r.id===id); if(!rec) return false;
  const finDate = veilleISO(dateStr);
  if(recurrencesSupabaseDisponible){
    const res = await ecritureVerifiee(supabaseClient.from('Recurrences').update({ FinType:'date', FinDate: finDate, FinNombre:null }).eq('id', id));
    if(!res.ok){ signalerEchecEnregistrement("La fin de l'ancienne série", res.error); return false; }
  }
  rec.finType = 'date'; rec.finDate = finDate; rec.finNombre = null;
  sauvegarderRecurrencesLocal();
  return true;
}

/* Enregistre (ou met à jour) une exception pour une occurrence donnée : soit sa suppression
   individuelle, soit ses valeurs modifiées individuellement. */
async function enregistrerException(rec, dateOrigine, champs){
  const existante = exceptions.find(x => x.recurrenceId === rec.id && x.dateOrigine === dateOrigine);
  const ligne = {
    RecurrenceId: rec.id,
    DateOrigine: dateOrigine,
    Supprimee: !!champs.supprimee,
    NouvelleDate: champs.nouvelleDate || null,
    Montant: champs.montant != null ? champs.montant : null,
    Categorie: champs.categorie != null ? champs.categorie : null,
    Note: champs.note != null ? champs.note : null,
    Qui: champs.who != null ? nomPersonneSupabase(champs.who) : null,
    EstCompte: champs.estCompte != null ? champs.estCompte : null,
    EstRevenu: champs.estRevenu != null ? champs.estRevenu : null,
    PourcentageP1: champs.pourcentageP1 != null ? champs.pourcentageP1 : null,
    Type: rec.type,
    user_id: rec.type === 'personnelle' ? (currentSession?.user?.id || null) : null
  };

  if(existante){
    if(exceptionsSupabaseDisponible){
      const res = await ecritureVerifiee(supabaseClient.from('RecurrenceExceptions').update(ligne).eq('id', existante.id));
      if(!res.ok){ signalerEchecEnregistrement("La modification de cette occurrence", res.error); return null; }
    }
    Object.assign(existante, {
      supprimee: !!champs.supprimee,
      nouvelleDate: champs.nouvelleDate || null,
      montant: champs.montant != null ? champs.montant : null,
      categorie: champs.categorie != null ? champs.categorie : null,
      note: champs.note != null ? champs.note : null,
      who: champs.who != null ? champs.who : null,
      estCompte: champs.estCompte != null ? champs.estCompte : null,
      estRevenu: champs.estRevenu != null ? champs.estRevenu : null,
      pourcentageP1: champs.pourcentageP1 != null ? champs.pourcentageP1 : null
    });
    return existante;
  }

  const id = uid();
  if(exceptionsSupabaseDisponible){
    const { error } = await supabaseClient.from('RecurrenceExceptions').insert([{ id, ...ligne }]);
    if(error){ signalerEchecEnregistrement("La modification de cette occurrence", error); return null; }
  } else {
    console.warn("Table RecurrenceExceptions indisponible : cette retouche ne sera pas conservée après rechargement.");
  }
  const locale = {
    id, recurrenceId: rec.id, dateOrigine,
    supprimee: !!champs.supprimee,
    nouvelleDate: champs.nouvelleDate || null,
    montant: champs.montant != null ? champs.montant : null,
    categorie: champs.categorie != null ? champs.categorie : null,
    note: champs.note != null ? champs.note : null,
    who: champs.who != null ? champs.who : null,
    estCompte: champs.estCompte != null ? champs.estCompte : null,
    estRevenu: champs.estRevenu != null ? champs.estRevenu : null,
    pourcentageP1: champs.pourcentageP1 != null ? champs.pourcentageP1 : null,
    type: rec.type
  };
  exceptions.push(locale);
  return locale;
}

/* Crée une nouvelle récurrence à partir de valeurs déjà calculées (pas d'un formulaire) :
   utilisé pour fractionner une série lors d'un "cette dépense et les suivantes". */
/* Valeur de secours pour l'ancienne colonne "Frequence" (texte), envoyée en plus du nouveau
   modèle Unite/Intervalle/etc. Cette colonne est censée être optionnelle (voir migration
   "rendre_frequence_optionnelle"), mais on l'alimente quand même par prudence : si jamais
   elle redevenait obligatoire (nouvelle base, restauration, etc.), l'enregistrement d'une
   récurrence ne doit jamais échouer silencieusement à cause d'elle. */
function frequenceHeritee(unite, intervalle){
  if(unite === 'semaine') return intervalle === 2 ? '2semaines' : 'semaine';
  if(unite === 'annee') return 'annee';
  return 'mois';
}

async function creerRecurrenceDepuisValeurs(champs){
  const id = uid();
  /* Si aucune racine n'est fournie (création "normale", pas un fractionnement), la nouvelle
     récurrence est sa propre racine — elle démarre une nouvelle "famille". */
  const racineId = champs.racineId || id;
  const nouvelleRecurrenceDB = {
    id, Nom: champs.nom, Montant: champs.montant, Categorie: champs.categorie,
    Frequence: frequenceHeritee(champs.unite, champs.intervalle),
    Unite: champs.unite, Intervalle: champs.intervalle,
    JoursSemaine: champs.joursSemaine && champs.joursSemaine.length ? champs.joursSemaine.join(',') : null,
    TypeMensuel: champs.typeMensuel || null,
    RacineId: racineId,
    DateDebut: champs.dateDebut, FinType: champs.finType, FinNombre: champs.finNombre, FinDate: champs.finDate,
    Qui: nomPersonneSupabase(champs.who), Type: champs.type, Actif: true,
    EstCompte: champs.estCompte, EstRevenu: champs.estRevenu, PourcentageP1: champs.pourcentageP1,
    user_id: champs.type === 'personnelle' ? (currentSession?.user?.id || null) : null
  };
  /* Renvoie null si l'enregistrement échoue : l'appelant doit alors s'arrêter (avant, la
     série n'existait qu'à l'écran, et la conversion d'une dépense supprimait quand même
     l'originale). En mode local (table absente au chargement), on garde l'ancien
     comportement : la série vit dans le stockage de l'appareil. */
  if(recurrencesSupabaseDisponible){
    const { error } = await supabaseClient.from('Recurrences').insert([nouvelleRecurrenceDB]);
    if(error){
      /* Les colonnes Unite/Intervalle/JoursSemaine/TypeMensuel/RacineId (ou EstCompte/
         EstRevenu/PourcentageP1 pour une base plus ancienne) n'existent peut-être pas
         encore : on réessaie sans elles pour que la récurrence soit tout de même créée
         (voir les instructions pour ajouter ces colonnes à Supabase). */
      console.warn("Insertion complète de la récurrence impossible, nouvel essai sans les colonnes récentes.", error);
      const { EstCompte, EstRevenu, PourcentageP1, Unite, Intervalle, JoursSemaine, TypeMensuel, RacineId, ...sansColonnesRecentes } = nouvelleRecurrenceDB;
      const retry = await supabaseClient.from('Recurrences').insert([sansColonnesRecentes]);
      if(retry.error){ signalerEchecEnregistrement("Le paiement récurrent", retry.error); return null; }
    }
  }
  recurrences.push({
    id, nom:champs.nom, montant:champs.montant, categorie:champs.categorie,
    unite:champs.unite, intervalle:champs.intervalle, joursSemaine:champs.joursSemaine || null, typeMensuel:champs.typeMensuel || null,
    racineId,
    dateDebut:champs.dateDebut, finType:champs.finType, finNombre:champs.finNombre, finDate:champs.finDate,
    who:champs.who, type:champs.type, estCompte:champs.estCompte, estRevenu:champs.estRevenu,
    pourcentageP1: champs.pourcentageP1 != null ? champs.pourcentageP1 : 50, actif:true, datesExclues: [],
    /* Même valeur que created_at en base : la répartition sur les paies part d'aujourd'hui,
       sans attendre un rechargement. */
    ajout: formaterDateISO(new Date())
  });
  sauvegarderRecurrencesLocal();
  return id;
}

/* "Cette dépense seulement" (suppression) : enregistre une exception "supprimée" pour cette
   date. Définitif : l'occurrence ne réapparaîtra jamais, même après un "toute la série" ou
   un "cette dépense et les suivantes". */
async function supprimerOccurrenceSeule(depense){
  if(!depense.virtuelle){ await supprimerDepense(depense.id); return; }
  const rec = recurrences.find(r => r.id === depense.recurrenceId);
  if(!rec) return;
  if(!(await enregistrerException(rec, depense.dateOrigine, { supprimee: true }))) return;
  recalculerDepenses();
  rafraichirActif();
}

/* "Cette dépense seulement" (modification) : enregistre une exception portant les nouvelles
   valeurs. Cette retouche est volontairement écrasée si on modifie ensuite "les suivantes"
   ou "toute la série" — comme dans un calendrier. */
/* Champs d'exception correspondant aux valeurs saisies dans le formulaire d'une occurrence. */
function champsExceptionDepuisFormulaire(depense, nv){
  return {
    supprimee: false,
    nouvelleDate: nv.date && nv.date !== depense.dateOrigine ? nv.date : null,
    montant: nv.amount,
    categorie: nv.category,
    note: nv.note != null ? nv.note : '',
    who: nv.who,
    estCompte: !!nv.estCompte,
    estRevenu: !!nv.estRevenu,
    pourcentageP1: nv.pourcentageP1
  };
}

async function modifierOccurrenceSeule(depense, nv){
  const rec = recurrences.find(r => r.id === depense.recurrenceId);
  if(!rec) return false;
  const ok = await enregistrerException(rec, depense.dateOrigine, champsExceptionDepuisFormulaire(depense, nv));
  recalculerDepenses();
  rafraichirActif();
  return !!ok;
}

/* "Cette dépense et les suivantes" (suppression) : la série s'arrête la veille, et tout
   segment de la même famille qui démarrerait après disparaît aussi. */
async function supprimerDepuisOccurrence(depense){
  const rec = recurrences.find(r=>r.id===depense.recurrenceId);
  if(!rec) return;
  const charniere = depense.dateOrigine;

  for(const segment of familleDeRecurrence(rec).filter(r => r.id !== rec.id && r.dateDebut >= charniere)){
    if(!(await supprimerRecurrence(segment.id, true))){ recalculerDepenses(); rafraichirActif(); return; }
  }
  if(rec.dateDebut === charniere){
    await supprimerRecurrence(rec.id, true); /* il ne reste rien avant : la règle n'a plus lieu d'être */
  } else {
    /* On tronque d'abord : si ça échoue, les retouches des occurrences suivantes sont intactes. */
    if(await tronquerRecurrenceAvant(rec.id, charniere)){
      await supprimerExceptions(rec.id, { depuis: charniere });
    }
  }
  recalculerDepenses();
  rafraichirActif();
}

/* "Cette dépense et les suivantes" (modification) : l'ancienne règle s'arrête la veille, et
   une nouvelle règle démarre ici avec les nouvelles valeurs. Les segments déjà créés par un
   fractionnement antérieur et qui démarrent après cette date sont remplacés (ils font partie
   des "suivantes"). Les suppressions individuelles postérieures sont conservées. */
async function diviserRecurrenceAPartirDe(depense, nv){
  const dateCharniere = depense.dateOrigine;
  const recOriginale = recurrences.find(r=>r.id===depense.recurrenceId);
  if(!recOriginale) return;
  const terminer = () => { recalculerDepenses(); rafraichirActif(); };

  const racine = recOriginale.racineId || recOriginale.id;
  const segmentsRemplaces = familleDeRecurrence(recOriginale)
    .filter(r => r.id !== recOriginale.id && r.dateDebut >= dateCharniere);

  /* La vraie fin de la série est portée par le segment le plus tardif de la famille : si on
     refractionne une occurrence ANTÉRIEURE à un fractionnement déjà fait, il ne faut pas
     hériter de la fin tronquée du segment cliqué (qui n'est qu'un artefact du découpage
     précédent), sinon la nouvelle règle naîtrait déjà terminée. */
  const queue = [recOriginale, ...segmentsRemplaces]
    .reduce((a,b) => b.dateDebut > a.dateDebut ? b : a);

  /* Jour du mois plafonné : une série du 31 tombe le 28 en février. Démarrer la nouvelle
     série à cette date lui ferait prendre le 28 comme jour de référence pour toujours. Dans
     ce cas, la nouvelle série démarre à la première occurrence qui tombe sur le vrai jour, et
     les occurrences plafonnées d'ici là restent dans l'ancienne série, retouchées une à une
     avec les nouvelles valeurs. */
  const jourVoulu = recOriginale.dateDebut ? dateLocaleDepuisISO(recOriginale.dateDebut).getDate() : null;
  let jourPlafonne = (recOriginale.unite === 'mois' || recOriginale.unite === 'annee')
    && recOriginale.typeMensuel !== 'dernier_jour'
    && jourVoulu != null
    && dateLocaleDepuisISO(dateCharniere).getDate() !== jourVoulu;
  let debutNouvelle = dateCharniere;
  if(jourPlafonne){
    const suivante = genererOccurrences({ ...recOriginale, finType:'jamais' }, horizonMaximal())
      .find(d => formaterDateISO(d) > dateCharniere && d.getDate() === jourVoulu);
    if(suivante) debutNouvelle = formaterDateISO(suivante);
    else jourPlafonne = false; /* aucune occurrence future sur le vrai jour : ancien comportement */
  }

  let finType = queue.finType, finNombre = queue.finNombre, finDate = queue.finDate;
  if(finType === 'nombre' && finNombre != null){
    if(queue.id === recOriginale.id){
      const dejaEcoulees = genererOccurrences(recOriginale, horizonMaximal())
        .filter(d => formaterDateISO(d) < debutNouvelle).length;
      finNombre = jourPlafonne ? finNombre - dejaEcoulees : Math.max(1, finNombre - dejaEcoulees);
    } else {
      /* On convertit en date de fin équivalente : recompter des occurrences à travers
         plusieurs segments aux motifs possiblement différents n'aurait pas de sens. */
      const dateFin = finDateEquivalente(queue);
      if(dateFin){ finType = 'date'; finDate = dateFin; finNombre = null; }
      else { finType = 'jamais'; finDate = null; finNombre = null; }
    }
  }
  const creerNouvelle = !(finType === 'date' && finDate && finDate < debutNouvelle)
    && !(finType === 'nombre' && finNombre != null && finNombre <= 0);

  /* 1) La nouvelle règle est créée EN PREMIER : si ça échoue, rien d'autre n'a bougé. */
  let nouvelId = null;
  if(creerNouvelle){
    nouvelId = await creerRecurrenceDepuisValeurs({
      type: recOriginale.type, nom: nv.note != null ? nv.note : recOriginale.nom, montant: nv.amount, categorie: nv.category,
      unite: recOriginale.unite, intervalle: recOriginale.intervalle,
      joursSemaine: recOriginale.joursSemaine, typeMensuel: recOriginale.typeMensuel,
      dateDebut: debutNouvelle, finType, finNombre, finDate,
      who: nv.who, estCompte: nv.estCompte, estRevenu: nv.estRevenu, pourcentageP1: nv.pourcentageP1,
      racineId: racine
    });
    if(!nouvelId){ terminer(); return; }
  }

  /* 2) Les suppressions individuelles survivent au fractionnement : celles qui tombent dans
     la nouvelle règle y sont rattachées ; celles d'avant (cas plafonné) restent sur
     l'ancienne. Les modifications individuelles, elles, sont écrasées. */
  const segmentsATransferer = [recOriginale, ...segmentsRemplaces];
  for(const segment of segmentsATransferer){
    if(nouvelId && !(await transfererSuppressions(segment.id, nouvelId, debutNouvelle))){ terminer(); return; }
    if(jourPlafonne && segment.id !== recOriginale.id
       && !(await transfererSuppressions(segment.id, recOriginale.id, dateCharniere))){ terminer(); return; }
  }
  for(const segment of segmentsRemplaces){
    if(!(await supprimerRecurrence(segment.id, true))){ terminer(); return; }
  }

  if(!jourPlafonne){
    if(recOriginale.dateDebut === dateCharniere){
      await supprimerRecurrence(recOriginale.id, true);
    } else if(await tronquerRecurrenceAvant(recOriginale.id, dateCharniere)){
      await supprimerExceptions(recOriginale.id, { depuis: dateCharniere });
    }
    terminer();
    return;
  }

  /* 3) Cas plafonné : l'ancienne série couvre encore la charnière (et les éventuelles
     occurrences plafonnées suivantes), jusqu'à la veille de la nouvelle règle — ou jusqu'à
     la vraie fin de la famille si aucune nouvelle règle n'a été créée. */
  let finOriginale;
  if(creerNouvelle) finOriginale = veilleISO(debutNouvelle);
  else if(queue.id !== recOriginale.id) finOriginale = finDateEquivalente(queue);
  if(finOriginale && !(await tronquerRecurrenceAvant(recOriginale.id, lendemainISO(finOriginale)))){ terminer(); return; }
  if(!(await supprimerExceptions(recOriginale.id, { depuis: dateCharniere, garderSuppressions: true }))){ terminer(); return; }

  const suppressions = new Set(exceptions
    .filter(x => x.recurrenceId === recOriginale.id && x.supprimee)
    .map(x => x.dateOrigine));
  const champs = champsExceptionDepuisFormulaire(depense, nv);
  const aRetoucher = genererOccurrences(recOriginale, horizonMaximal())
    .map(formaterDateISO)
    .filter(d => d >= dateCharniere && !suppressions.has(d));
  for(const d of aRetoucher){
    const champsOcc = d === dateCharniere ? champs : { ...champs, nouvelleDate: null };
    if(!(await enregistrerException(recOriginale, d, champsOcc))) break;
  }
  terminer();
}

/* ===================== MODAL DE DÉTAIL D'UNE OCCURRENCE (clic sur une dépense) =====================
   Point d'entrée unique pour éditer/supprimer une dépense, que ce soit depuis le calendrier
   récurrent ou une liste de dépenses. Affiche d'abord un résumé avec deux boutons ; si la
   dépense fait partie d'une série récurrente, ces boutons ouvrent le choix de portée. */
let occurrenceCourante = null;

function fermerOccurrenceModal(){
  document.getElementById('occurrence-modal').style.display = 'none';
  occurrenceCourante = null;
}

function ouvrirDetailOccurrence(id){
  const depense = depenses.find(e=>e.id===id) || depotsAConfirmer.find(e=>e.id===id);
  if(!depense) return;
  occurrenceCourante = depense;
  if(depense.depotPlanifie) rendreVueDepotPlanifie();
  else if(estDepotConfirme(depense)) rendreVueDepotConfirme();
  else rendreVueDetailOccurrence();
  document.getElementById('occurrence-modal').style.display = 'flex';
}

function rendreVueDetailOccurrence(){
  const d = occurrenceCourante;
  if(!d) return;
  const contenu = document.getElementById('occurrence-modal-content');
  const qui = d.estCompte ? 'Compte conjoint' : (nomsPersonnes[d.who] || d.who);
  const repartition = d.estCompte ? ` (${d.pourcentageP1!=null?d.pourcentageP1:50}% ${nomsPersonnes.p1})` : '';
  const rec = d.recurrenceId ? recurrences.find(r=>r.id===d.recurrenceId) : null;
  const sousTitre = rec ? `Série récurrente · ${libelleRecurrence(rec)}` : 'Dépense ponctuelle';
  const dateLisible = dateLocaleDepuisISO(d.date).toLocaleDateString('fr-CA',{weekday:'long', day:'numeric', month:'long', year:'numeric'});
  contenu.innerHTML = `
    <div class="modal-header">
      <h3>${echapperHTML(d.note || d.category)}<span class="modal-sous-titre">${sousTitre}</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      <div style="font-size:28px;font-weight:600;margin-bottom:10px;">${formaterMonnaie(d.amount)}</div>
      <div style="color:var(--text-secondary);font-size:13px;margin-bottom:4px;text-transform:capitalize;">${dateLisible}</div>
      <div style="color:var(--text-secondary);font-size:13px;">${echapperHTML(d.category)} · ${echapperHTML(qui)}${repartition}</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary btn-danger" id="occ-btn-supprimer">Supprimer</button>
      <button class="btn-add" id="occ-btn-modifier">Modifier</button>
    </div>
  `;
  document.getElementById('occ-fermer').addEventListener('click', fermerOccurrenceModal);
  document.getElementById('occ-btn-modifier').addEventListener('click', ()=>{
    if(d.recurrenceId) rendreChoixPortee('modifier');
    else { fermerOccurrenceModal(); ouvrirEdition(d.id); }
  });
  document.getElementById('occ-btn-supprimer').addEventListener('click', ()=>{
    if(d.recurrenceId) rendreChoixPortee('supprimer');
    else if(confirm('Supprimer cette dépense ?')){ fermerOccurrenceModal(); supprimerDepense(d.id); }
  });
}

function rendreChoixPortee(action){
  const d = occurrenceCourante;
  const contenu = document.getElementById('occurrence-modal-content');
  const verbe = action==='modifier' ? 'Modifier' : 'Supprimer';
  contenu.innerHTML = `
    <div class="modal-header">
      <h3>${verbe} une occurrence<span class="modal-sous-titre">Cette dépense fait partie d'une série récurrente</span></h3>
      <button class="modal-close-btn" id="occ-fermer" aria-label="Fermer">&times;</button>
    </div>
    <div class="modal-body">
      <div class="portee-choix">
        <button class="portee-option" id="portee-seulement">
          <span class="portee-titre">Cette dépense seulement</span>
          <span class="portee-desc">N'affecte que l'occurrence du ${dateLocaleDepuisISO(d.date).toLocaleDateString('fr-CA',{day:'numeric',month:'long'})}</span>
        </button>
        <button class="portee-option" id="portee-suivantes">
          <span class="portee-titre">Cette dépense et les suivantes</span>
          <span class="portee-desc">Les occurrences précédentes restent inchangées</span>
        </button>
        <button class="portee-option" id="portee-serie">
          <span class="portee-titre">Toute la série</span>
          <span class="portee-desc">Toutes les occurrences, passées et futures</span>
        </button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="portee-annuler">Retour</button>
    </div>
  `;
  document.getElementById('occ-fermer').addEventListener('click', fermerOccurrenceModal);
  document.getElementById('portee-annuler').addEventListener('click', rendreVueDetailOccurrence);
  document.getElementById('portee-seulement').addEventListener('click', ()=>{
    if(action==='modifier'){ fermerOccurrenceModal(); ouvrirEdition(d.id); }
    else if(confirm('Supprimer seulement cette occurrence ? Le reste de la série ne sera pas touché.')){ fermerOccurrenceModal(); supprimerOccurrenceSeule(d); }
  });
  document.getElementById('portee-suivantes').addEventListener('click', ()=>{
    if(action==='modifier'){ fermerOccurrenceModal(); ouvrirEdition(d.id, 'suivantes'); }
    else if(confirm('Supprimer cette dépense et toutes celles qui suivent dans la série ?')){ fermerOccurrenceModal(); supprimerDepuisOccurrence(d); }
  });
  document.getElementById('portee-serie').addEventListener('click', ()=>{
    if(action==='modifier'){ fermerOccurrenceModal(); ouvrirEditionRecurrence(d.recurrenceId); }
    else { fermerOccurrenceModal(); supprimerSerieComplete(d.recurrenceId); }
  });
}

/* Part de la personne connectée dans une récurrence conjointe affichée dans Personnel :
   50/50 normalement, vrai % pour une récurrence "compte". */
function partPersonnelleRecurrence(r){
  const p1Pct = (r.pourcentageP1 != null ? r.pourcentageP1 : 50) / 100;
  return currentUser==='p1' ? p1Pct : (1 - p1Pct);
}

function afficherRecurrencesScope(scope){
  /* Les segments terminés d'une série de dépôt (après « ce dépôt et les suivants ») ne sont
     que l'historique : on n'affiche que la série en cours. */
  const liste = recurrences.filter(r => (scope==='conjoint' ? r.type==='conjointe' : (r.type==='personnelle' && r.who===currentUser))
    && !(estSerieDepot(r) && serieTerminee(r)));
  const listeSansRevenu = liste.filter(r=>!r.estRevenu);
  const actifs = listeSansRevenu.filter(r=>r.actif);
  const totalMensuel = actifs.reduce((s,r)=>s+r.montant*multiplicateurMensuel(r),0);

  /* Dans Personnel, "+ Conjoint" ajoute aussi les paiements récurrents conjoints à la
     liste (en lecture seule, clairement identifiés) : leur vrai % pour les récurrences
     "compte", 50/50 pour les autres. Le formulaire d'ajout reste réservé aux perso. */
  const inclusionActive = scope==='personnel' && inclureConjointDansPersonnel;
  const recurrentesConjointes = inclusionActive ? recurrences.filter(r=>r.type==='conjointe' && !r.estRevenu) : [];
  const actifsConjoints = recurrentesConjointes.filter(r=>r.actif);
  const totalMensuelConjointPart = actifsConjoints.reduce((s,r)=>s+r.montant*multiplicateurMensuel(r)*partPersonnelleRecurrence(r),0);

  const statsEl = document.getElementById(`recurrent-stats-${scope}`);
  if(statsEl){
    statsEl.innerHTML = `
      <div class="stat-card"><div class="label">Total<span class="mobile-line"> mensuel${inclusionActive ? ' (+ conjoint)' : ' équiv.'}</span></div><div class="value">${formaterMonnaie(totalMensuel + totalMensuelConjointPart)}</div></div>
      <div class="stat-card"><div class="label">Paiements<span class="mobile-line"> actifs</span></div><div class="value">${actifs.length}</div></div>
      <div class="stat-card"><div class="label">Total<span class="mobile-line"> (incl. inactifs)</span></div><div class="value">${listeSansRevenu.length}</div></div>
    `;
  }

  /* Le calendrier des dépenses (récurrentes ou non) vit maintenant dans la vue Transactions
     fusionnée, peu importe le scope ('conjoint' ou 'personnel') qui a déclenché ce
     rafraîchissement (ajout, édition, confirmation de dépôt, etc.). */
  afficherTransactions();

  const listEl = document.getElementById(`recurrent-list-${scope}`);
  if(!listEl) return;
  const listeComplete = liste.map(r=>({...r, estConjoint:false})).concat(recurrentesConjointes.map(r=>({...r, estConjoint:true})));
  if(!listeComplete.length){
    listEl.innerHTML = `<div class="budget-empty">Aucun paiement récurrent pour l'instant. Utilisez le formulaire ci-dessus pour en ajouter un.</div>`;
    return;
  }
  const listeTriee = listeComplete.sort((a,b)=> (b.actif - a.actif) || a.nom.localeCompare(b.nom));
  listEl.innerHTML = listeTriee.map(r=>{
    const partPct = Math.round(partPersonnelleRecurrence(r)*100);
    const badgeType = estSerieDepot(r)
      ? `<span class="freq-pill badge-revenu" title="Dépôt pour payer le compte ; chaque dépôt se confirme à la main">🏦 Dépôt au compte</span>`
      : r.estRevenu
      ? `<span class="freq-pill badge-revenu">Revenu</span>`
      : (r.estCompte
          ? `<span class="freq-pill badge-compte" title="Payé automatiquement par le compte conjoint">🏦</span>`
          : (r.estConjoint ? `<span class="freq-pill" style="background:var(--mauve)22;color:var(--mauve);" title="Récurrence conjointe">👥</span>` : ''));
    const sousMontant = r.estConjoint
      ? `<div style="font-size:11px;color:var(--text-secondary);font-weight:400;white-space:nowrap;">${partPct}%: ${formaterMonnaie(r.montant*partPersonnelleRecurrence(r))}</div>`
      : '';
    const montantAffiche = r.estRevenu ? `+${formaterMonnaie(r.montant)}` : formaterMonnaie(r.montant);
    return `
    <div class="recurrent-row ${r.actif?'':'inactive'} ${r.estRevenu?'row-revenu-item':(r.estCompte?'row-compte-item':(r.estConjoint?'row-conjoint-share':''))}" onclick="ouvrirEditionRecurrence('${r.id}')" style="cursor:pointer;">
      <div class="recurrent-info">
        <div class="recurrent-nom">${echapperHTML(r.nom || r.categorie)}${(scope==='conjoint' || r.estConjoint) ? ` <span class="who-badge"><span class="dot ${estSerieDepot(r) ? personneSerieDepot(r) : r.who}"></span>${echapperHTML(libellePersonne(estSerieDepot(r) ? personneSerieDepot(r) : r.who))}</span>` : ''}</div>
        <div class="recurrent-meta">
          ${badgeType}
          ${r.estRevenu ? '' : `<span class="cat-pill" style="background:${COULEURS_CATEGORIES[r.categorie]||'#9aa0a6'}22;color:${COULEURS_CATEGORIES[r.categorie]||'#9aa0a6'}">${echapperHTML(r.categorie)}</span>`}
          <span class="freq-pill">${libelleRecurrence(r)}</span>
          ${r.finType==='nombre' ? `<span class="freq-pill">${r.finNombre} paiement${r.finNombre>1?'s':''} max</span>` : ''}
          ${r.finType==='date' ? `<span class="freq-pill">Jusqu'au ${r.finDate}</span>` : ''}
        </div>
      </div>
      <div class="recurrent-actions">
        <div class="recurrent-montant" style="${r.estRevenu?'color:var(--green);':''}">${montantAffiche}${sousMontant}</div>
        <label class="switch small" title="${r.actif ? 'Actif' : 'Inactif'}" onclick="event.stopPropagation()">
          <input type="checkbox" ${r.actif?'checked':''} onchange="basculerActifRecurrence('${r.id}')">
          <span class="switch-track"></span>
        </label>
      </div>
    </div>
  `;
  }).join('');
}

/* ===================== CALENDRIER DES DÉPENSES (façon Outlook) =====================
   Affiche, pour un scope (conjoint/personnel), toutes les dépenses (récurrentes ou non)
   qui tombent dans la période choisie (jour, semaine, période de paie ou mois), avec
   navigation ‹ › et clic sur une entrée pour ouvrir son détail (voir ouvrirDetailOccurrence). */
/* La période affichée (vue + date de référence) est PARTAGÉE entre Conjoint et Personnel,
   tout comme le mois/l'année globaux ailleurs dans l'app : un seul sélecteur, toujours au
   même endroit (en haut de la page), pilote la période peu importe l'onglet consulté. Seul
   le mode d'affichage (calendrier ou liste) reste propre à chaque scope, puisque c'est une
   préférence d'affichage plutôt qu'une période. */
let etatCalendrierPeriode = { vue: 'mois', dateRef: debutJour(new Date()) };
/* En vue "Mois", on peut basculer entre la grille façon calendrier et la liste — les autres
   vues (Jour/Semaine/Paie/Année) sont toujours des listes, ce choix ne s'applique qu'au mois. */
let afficherGrilleMois = false;

/* Filtres d'affichage (façon Google Agenda : cases à cocher pour montrer/cacher certains
   types d'entrées). Persistés localement par appareil - un filtre d'affichage est une
   préférence personnelle, pas une donnée à synchroniser. */
/* Un seul jeu de filtres pour la vue Transactions fusionnée (plus un par scope) : `typesCaches`
   remplace l'ancien `quiCaches` avec trois catégories grossières (Personnel / Conjoint /
   Compte conjoint), pilotées par les cases à cocher du menu ☰ plutôt que par les onglets. */
function filtresParDefaut(){ return { categoriesCachees: [], masquerRevenus: false, typesCaches: [], quiConjointCaches: [], montantMin: 0, montantMax: null }; }
let filtresTransactions = filtresParDefaut();
(function chargerFiltresTransactions(){
  try{
    const brut = localStorage.getItem('depenses_transactions_filtres');
    if(brut) filtresTransactions = Object.assign(filtresParDefaut(), JSON.parse(brut));
  } catch(e){ /* préférence locale seulement : on ignore silencieusement si corrompue */ }
})();
function sauvegarderFiltresTransactions(){
  localStorage.setItem('depenses_transactions_filtres', JSON.stringify(filtresTransactions));
}

const JOURS_SEMAINE_DIM_SAM = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MOIS_NOMS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

const VUES_CALENDRIER = [ ['jour','Jour'], ['semaine','Semaine'], ['paie','Paie'], ['mois','Mois'], ['annee','Année'] ];

/* Dimanche de la semaine contenant `date`. La semaine commence le dimanche, comme dans le
   sélecteur de jours des récurrences (D L M M J V S) et dans les calendriers nord-américains :
   une seule convention partout, sinon la grille du mois et le choix des jours ne s'accordent
   pas. Sert aussi bien à la vue « Semaine » qu'aux bornes de la grille du mois. */
function debutDeSemaine(date){
  const d = debutJour(date);
  return ajouterJours(d, -d.getDay()); /* getDay() : 0=dimanche..6=samedi */
}
function borneMois(dateRef){
  return { debut: new Date(dateRef.getFullYear(), dateRef.getMonth(), 1), fin: new Date(dateRef.getFullYear(), dateRef.getMonth()+1, 0) };
}
function borneAnnee(dateRef){
  return { debut: new Date(dateRef.getFullYear(), 0, 1), fin: new Date(dateRef.getFullYear(), 11, 31) };
}
function bornePeriodePaie(dateRef){
  const ancrage = debutJour(dateLocaleDepuisISO(paieAncrage));
  const debut = paieDate(ancrage, indexPaiePourDate(ancrage, dateRef));
  return { debut, fin: ajouterJours(debut, 13) };
}
function bornePeriode(vue, dateRef){
  if(vue==='jour') return { debut: debutJour(dateRef), fin: debutJour(dateRef) };
  if(vue==='semaine'){ const debut = debutDeSemaine(dateRef); return { debut, fin: ajouterJours(debut,6) }; }
  if(vue==='paie') return bornePeriodePaie(dateRef);
  if(vue==='annee') return borneAnnee(dateRef);
  return borneMois(dateRef);
}
function avancerPeriode(vue, dateRef, direction){
  if(vue==='jour') return ajouterJours(dateRef, direction);
  if(vue==='semaine') return ajouterJours(dateRef, direction*7);
  if(vue==='paie') return ajouterJours(dateRef, direction*14);
  if(vue==='annee'){ const d = new Date(dateRef); d.setFullYear(d.getFullYear()+direction); return d; }
  const d = new Date(dateRef); d.setMonth(d.getMonth()+direction); return d;
}
function formatCourtDate(d){ return `${d.getDate()} ${MOIS_NOMS[d.getMonth()].slice(0,3)}`; }
function libellePeriodeCalendrier(vue, debut, fin){
  if(vue==='jour') return capitaliser(debut.toLocaleDateString('fr-CA', {weekday:'long', day:'numeric', month:'long', year:'numeric'}));
  if(vue==='mois') return `${capitaliser(MOIS_NOMS[debut.getMonth()])} ${debut.getFullYear()}`;
  if(vue==='annee') return String(debut.getFullYear());
  return `${formatCourtDate(debut)} – ${formatCourtDate(fin)} ${fin.getFullYear()}`;
}
/* Regroupement grossier utilisé par le filtre à cases à cocher de Transactions (Personnel /
   Conjoint / Compte conjoint), et par les pastilles de couleur de la grille du mois. */
function bucketDepense(e){
  if(e.type==='personnelle') return 'personnel';
  return e.who==='compte' ? 'compte' : 'conjoint';
}
function classeTypeDepense(e){
  if(e.type==='personnelle') return 'cal-personnel';
  if(e.estCompte) return 'cal-compte';
  if(e.who==='p2') return 'cal-p2';
  return 'cal-p1';
}
function depensesPourTransactions(debut, fin){
  const debutStr = formaterDateISO(debut), finStr = formaterDateISO(fin);
  const f = filtresTransactions;
  const appliquerFiltres = e => !f.typesCaches.includes(bucketDepense(e))
    && !(e.type==='conjointe' && e.who!=='compte' && f.quiConjointCaches.includes(e.who))
    && !(f.masquerRevenus && e.estRevenu) && !f.categoriesCachees.includes(e.category)
    && e.amount >= f.montantMin && (f.montantMax == null || e.amount <= f.montantMax);

  /* Personnel : jamais les dépenses de l'autre personne, même si elles étaient présentes en
     mémoire — même garde que partout ailleurs dans l'app (vie privée). */
  const conjointes = depenses.concat(depotsAConfirmer)
    .filter(e => e.type==='conjointe' && e.date>=debutStr && e.date<=finStr);
  const personnelles = depenses
    .filter(e => e.type==='personnelle' && e.who===currentUser && e.date>=debutStr && e.date<=finStr);

  return conjointes.concat(personnelles).filter(appliquerFiltres).sort((a,b)=> a.date.localeCompare(b.date));
}

function afficherTransactions(){
  const corpsEl = document.getElementById('cal-corps-transactions');
  if(!corpsEl) return;
  const { vue, dateRef } = etatCalendrierPeriode;
  const { debut, fin } = bornePeriode(vue, dateRef);
  const tri = etatTri.transactions;

  const barreOutils = rendreBarreOutilsTransactionsHTML(tri);

  if(vue === 'mois' && afficherGrilleMois){
    corpsEl.innerHTML = barreOutils + rendreGrilleMoisCalendrierTransactions(dateRef);
  } else {
    /* Jour / Semaine / Paie / Mois / Année partagent le même visuel : une liste triable
       (Date/Montant), façon agenda. */
    corpsEl.innerHTML = barreOutils + rendreAgendaCorpsHTMLTransactions(debut, fin, tri);
    wirerTriAgendaTransactions();
  }
  wirerBarreOutilsTransactions();
  rendreFiltresTransactionsDrawer();
}

/* Barre d'outils du calendrier/liste : bascule grille/liste (📅) centrée — visible
   uniquement en vue "Mois" — et le contrôle de tri (Date/Montant) à droite. Les filtres
   (catégories, qui, montant) vivent maintenant en permanence dans le menu ☰, plus besoin
   d'une icône dédiée ici.

   Le tri n'est PAS produit quand la grille de calendrier est active : les dépenses y sont
   placées dans les cases des jours, l'ordre de tri n'a alors aucun effet visible. On retire
   le bloc du HTML plutôt que de le masquer, parce que `.cal-toolbar .mobile-sort` porte un
   `display:flex!important` qui l'emporterait sur un style en ligne. */
function rendreBarreOutilsTransactionsHTML(tri){
  const vue = etatCalendrierPeriode.vue;
  const triUtile = !(vue === 'mois' && afficherGrilleMois);
  return `
    <div class="cal-toolbar">
      ${vue==='mois' ? `<button type="button" class="cal-hamburger-btn cal-toolbar-centre" id="cal-grille-toggle-transactions" aria-label="Basculer vue calendrier">📅</button>` : ''}
      ${triUtile ? `<div class="mobile-sort" id="cal-toolbar-tri-transactions">
        <select id="agenda-tri-transactions" aria-label="Trier les dépenses">
          <option value="Date">Date</option><option value="Montant">Montant</option>
        </select>
        <button type="button" class="sort-direction" id="agenda-tri-dir-transactions" aria-label="${tri.dir==='asc'?'Tri croissant':'Tri décroissant'}">${tri.dir==='asc'?'↑':'↓'}</button>
      </div>` : ''}
    </div>`;
}
function wirerBarreOutilsTransactions(){
  const btnGrille = document.getElementById('cal-grille-toggle-transactions');
  if(btnGrille){
    btnGrille.classList.toggle('active', afficherGrilleMois);
    btnGrille.addEventListener('click', ()=>{
      afficherGrilleMois = !afficherGrilleMois;
      afficherTransactions();
    });
  }
}

/* ===================== FILTRES D'AFFICHAGE DE TRANSACTIONS (façon Google Agenda) =====================
   Rendus en permanence dans le menu ☰ (plus de fenêtre séparée à ouvrir/fermer) : les trois
   cases Personnel/Conjoint/Compte conjoint remplacent les anciens onglets, et le reste
   (catégories, revenus, montant) reprend exactement l'ancienne fenêtre de filtres. */
/* Cases Personnel/Conjoint/Compte conjoint : branchées UNE SEULE FOIS (elles sont statiques
   dans le HTML du menu, contrairement au reste des filtres régénéré à chaque rendu) — sinon
   chaque rafraîchissement de Transactions empilerait un nouvel écouteur. */
function majTypesCachesTransactions(){
  const f = filtresTransactions;
  f.typesCaches = [];
  if(!document.getElementById('tx-filtre-personnel').checked) f.typesCaches.push('personnel');
  if(!document.getElementById('tx-filtre-conjoint').checked) f.typesCaches.push('conjoint');
  if(!document.getElementById('tx-filtre-compte').checked) f.typesCaches.push('compte');
  sauvegarderFiltresTransactions();
  rendreSousFiltreQuiConjoint();
  /* Personnel/Conjoint changent ce que montrent Transactions ET Résumé/Budget (voir
     afficherResumePage/afficherBudgetPage) : on rafraîchit la page réellement affichée,
     pas seulement Transactions. */
  if(estOngletAvecPeriode(activeMainTab)) rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
}
['tx-filtre-personnel','tx-filtre-conjoint','tx-filtre-compte'].forEach(id=>{
  document.getElementById(id).addEventListener('change', majTypesCachesTransactions);
});

/* Sous-filtre Gabriel/Mélissa, affiché seulement quand "Conjoint" est coché : n'affecte QUE
   Transactions (quelles dépenses conjointes apparaissent dans le calendrier/liste) — Résumé
   et Budget ne distinguent jamais les deux personnes dans leurs totaux. */
function rendreSousFiltreQuiConjoint(){
  const conteneur = document.getElementById('tx-filtre-qui-conjoint');
  if(!conteneur) return;
  const f = filtresTransactions;
  if(!conjointCoche()){
    conteneur.style.display = 'none';
    conteneur.innerHTML = '';
    return;
  }
  conteneur.style.display = '';
  conteneur.innerHTML = `
    <label class="cal-menu-check">
      <input type="checkbox" data-filtre-qui-conjoint="p1" ${f.quiConjointCaches.includes('p1')?'':'checked'}>
      <span class="dot-cat" style="background:${couleursPersonnes.p1}"></span> ${echapperHTML(nomsPersonnes.p1)}
    </label>
    <label class="cal-menu-check">
      <input type="checkbox" data-filtre-qui-conjoint="p2" ${f.quiConjointCaches.includes('p2')?'':'checked'}>
      <span class="dot-cat" style="background:${couleursPersonnes.p2}"></span> ${echapperHTML(nomsPersonnes.p2)}
    </label>
  `;
  conteneur.querySelectorAll('[data-filtre-qui-conjoint]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const qui = cb.dataset.filtreQuiConjoint;
      f.quiConjointCaches = cb.checked
        ? f.quiConjointCaches.filter(q=>q!==qui)
        : [...f.quiConjointCaches, qui];
      sauvegarderFiltresTransactions();
      afficherTransactions();
    });
  });
}

function rendreFiltresTransactionsDrawer(){
  const conteneur = document.getElementById('tx-filtres-plus');
  if(!conteneur) return;
  const f = filtresTransactions;
  const catsPresentes = categories.filter(c => c!=='Revenu');

  document.getElementById('tx-filtre-personnel').checked = !f.typesCaches.includes('personnel');
  document.getElementById('tx-filtre-conjoint').checked = !f.typesCaches.includes('conjoint');
  document.getElementById('tx-filtre-compte').checked = !f.typesCaches.includes('compte');
  rendreSousFiltreQuiConjoint();

  /* Borne haute du curseur : le plus gros montant existant (arrondi vers le haut), avec un
     plancher raisonnable pour éviter un curseur dégénéré s'il y a peu de données. */
  const plusGrosMontant = depenses.reduce((m,e)=>Math.max(m,e.amount),0);
  const bordureMax = Math.max(100, Math.ceil(plusGrosMontant/50)*50);
  const montantMaxActuel = f.montantMax == null ? bordureMax : Math.min(f.montantMax, bordureMax);

  conteneur.innerHTML = `
    <div class="cal-menu-section-title">Afficher</div>
    <label class="cal-menu-check">
      <input type="checkbox" data-filtre-revenu ${f.masquerRevenus?'':'checked'}>
      <span class="icone-revenu" aria-hidden="true">+</span> Revenus
    </label>
    ${catsPresentes.map(c=>`
      <label class="cal-menu-check">
        <input type="checkbox" data-filtre-categorie="${c}" ${f.categoriesCachees.includes(c)?'':'checked'}>
        <span class="dot-cat" style="background:${COULEURS_CATEGORIES[c]||'#9aa0a6'}"></span> ${c}
      </label>
    `).join('')}
    <div class="cal-menu-section-title">Montant</div>
    <div class="cal-menu-montant-valeurs">
      <span id="filtre-montant-min-val">${formaterMonnaie(f.montantMin)}</span>
      <span>–</span>
      <span id="filtre-montant-max-val">${f.montantMax == null ? `${formaterMonnaie(bordureMax)}+` : formaterMonnaie(f.montantMax)}</span>
    </div>
    <div class="cal-menu-montant-sliders">
      <input type="range" id="filtre-montant-min" min="0" max="${bordureMax}" step="5" value="${f.montantMin}">
      <input type="range" id="filtre-montant-max" min="0" max="${bordureMax}" step="5" value="${montantMaxActuel}">
    </div>
  `;

  const curseurMin = document.getElementById('filtre-montant-min');
  const curseurMax = document.getElementById('filtre-montant-max');
  const majAffichageMontant = ()=>{
    document.getElementById('filtre-montant-min-val').textContent = formaterMonnaie(Number(curseurMin.value));
    document.getElementById('filtre-montant-max-val').textContent = Number(curseurMax.value) >= bordureMax ? `${formaterMonnaie(bordureMax)}+` : formaterMonnaie(Number(curseurMax.value));
  };
  curseurMin.addEventListener('input', ()=>{
    if(Number(curseurMin.value) > Number(curseurMax.value)) curseurMin.value = curseurMax.value;
    majAffichageMontant();
  });
  curseurMax.addEventListener('input', ()=>{
    if(Number(curseurMax.value) < Number(curseurMin.value)) curseurMax.value = curseurMin.value;
    majAffichageMontant();
  });
  const appliquerMontant = ()=>{
    f.montantMin = Number(curseurMin.value);
    f.montantMax = Number(curseurMax.value) >= bordureMax ? null : Number(curseurMax.value);
    sauvegarderFiltresTransactions();
    afficherTransactions();
  };
  curseurMin.addEventListener('change', appliquerMontant);
  curseurMax.addEventListener('change', appliquerMontant);

  const caseRevenu = conteneur.querySelector('[data-filtre-revenu]');
  if(caseRevenu) caseRevenu.addEventListener('change', (e)=>{
    f.masquerRevenus = !e.target.checked;
    sauvegarderFiltresTransactions();
    afficherTransactions();
  });
  conteneur.querySelectorAll('[data-filtre-categorie]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const cat = cb.dataset.filtreCategorie;
      f.categoriesCachees = cb.checked
        ? f.categoriesCachees.filter(c=>c!==cat)
        : [...f.categoriesCachees, cat];
      sauvegarderFiltresTransactions();
      afficherTransactions();
    });
  });
}

function rendreGrilleMoisCalendrierTransactions(dateRef){
  const { debut, fin } = borneMois(dateRef);
  const premierJourGrille = debutDeSemaine(debut);
  const dernierJourGrille = ajouterJours(debutDeSemaine(fin), 6);
  const items = depensesPourTransactions(premierJourGrille, dernierJourGrille);
  const parJour = {};
  items.forEach(e => { (parJour[e.date] = parJour[e.date] || []).push(e); });
  const aujourdhuiStr = formaterDateISO(debutJour(new Date()));

  let html = '<div class="cal-month-grid">';
  JOURS_SEMAINE_DIM_SAM.forEach(j => html += `<div class="cal-month-dow">${j}</div>`);
  let curseur = new Date(premierJourGrille);
  while(curseur <= dernierJourGrille){
    const iso = formaterDateISO(curseur);
    const dansLeMois = curseur.getMonth()===dateRef.getMonth();
    const jourItems = parJour[iso] || [];
    const nb = jourItems.length;
    /* Une seule pastille par type présent ce jour-là (max 4), et un chiffre à côté
       seulement s'il y a 2 dépenses ou plus (léger et lisible, façon Google Agenda en
       vue compacte). */
    const couleursPresentes = [...new Set(jourItems.map(classeTypeDepense))].slice(0,4);
    /* `today` va sur la CASE, pas sur le numéro : c'est la case qui porte la règle qui
       dessine la pastille bleue (façon Google Agenda) autour du chiffre. */
    const estAujourdhui = iso === aujourdhuiStr;
    html += `<div class="cal-month-cell ${dansLeMois?'':'outside'} ${estAujourdhui?'today':''}" onclick="allerVueJourTransactions('${iso}')">
      ${estJourDePaie(curseur) ? `<span class="cal-paie-marqueur" title="Jour de paie">✉</span>` : ''}
      <div class="cal-month-daynum ${estAujourdhui?'today':''}">${curseur.getDate()}</div>
      ${nb>0 ? `<div class="cal-month-dots">
        ${couleursPresentes.map(c=>`<span class="cal-dot-mini ${c}"></span>`).join('')}
        ${nb>=2 ? `<span class="cal-month-count">${nb}</span>` : ''}
      </div>` : ''}
    </div>`;
    curseur = ajouterJours(curseur, 1);
  }
  html += '</div>';
  return html;
}

/* Cliquer une date dans la grille du mois bascule directement vers la vue "Jour" pour cette
   date, plutôt que d'ouvrir une fenêtre par-dessus. */
function allerVueJourTransactions(iso){
  etatCalendrierPeriode.vue = 'jour';
  etatCalendrierPeriode.dateRef = dateLocaleDepuisISO(iso);
  synchroniserMoisActif();
  afficherTransactions();
  afficherNavigationPeriode();
}

/* Carte de dépense unifiée, réutilisée partout où une liste de dépenses s'affiche (agenda
   Jour/Semaine/Paie, fiche d'une journée, mode Liste) — même visuel partout plutôt qu'un
   tableau différent selon l'endroit. `montrerDate` ajoute un petit badge de date (utile
   seulement quand le regroupement par jour n'est pas déjà visible, comme en mode Liste). */
/* Carte à disposition FIXE en 2 lignes, identique peu importe le tri ou le type de dépense :
   Ligne 1 = Date, Qui, % (celui de la personne affichée comme "Qui"), puis Montant à droite.
   Ligne 2 = Note, puis Catégorie à droite. */
function rendreCarteDepenseHTML(e){
  const dotClass = e.who;
  const quiLabel = e.estCompte ? 'Compte conjoint' : libellePersonne(e.who);
  const iconeRecurrente = e.recurrenceId ? '<span class="recurring-icon" title="Dépense récurrente">↻</span>' : '';
  const montantAffiche = e.estRevenu ? `+${formaterMonnaie(e.amount)}` : formaterMonnaie(e.amount);
  /* Le % affiché correspond toujours à la part de la personne indiquée comme "Qui" (pas
     toujours Gabriel), et seulement pour une dépense conjointe (une dépense personnelle
     n'a pas de partage à afficher). */
  let pourcentageAffiche = '';
  if(e.type==='conjointe' && e.pourcentageP1!=null){
    const pct = e.who==='p2' ? (100 - e.pourcentageP1) : e.pourcentageP1;
    pourcentageAffiche = `<span class="cal-agenda-pct">${pct}%</span>`;
  }
  const dateCourte = dateLocaleDepuisISO(e.date).toLocaleDateString('fr-CA',{day:'numeric', month:'short'});
  const categorieAffichee = e.depotPlanifie ? (STATUT_DEPOT_TEXTE[e.depotStatut] || 'Dépôt prévu')
    : estDepotConfirme(e) ? 'Dépôt confirmé' : (e.estRevenu ? 'Revenu' : e.category);
  const couleurCategorie = e.depotPlanifie && e.depotStatut !== 'prevu' ? '#e8710a'
    : e.estRevenu ? 'var(--green)' : (COULEURS_CATEGORIES[e.category]||'#9aa0a6');

  return `
    <div class="cal-agenda-item${e.depotPlanifie ? ' depot-planifie' : ''}" onclick="ouvrirDetailOccurrence('${e.id}')">
      <div class="cal-agenda-item-ligne1">
        <span class="cal-agenda-item-date">${dateCourte}</span>
        <span class="cal-agenda-item-recur">${iconeRecurrente}</span>
        <span class="who-badge"><span class="dot ${dotClass}"></span>${quiLabel}</span>
        <span class="cal-agenda-item-right">
          ${pourcentageAffiche}
          <span class="cal-agenda-item-montant" style="${e.estRevenu?'color:var(--green);':''}">${montantAffiche}</span>
        </span>
      </div>
      <div class="cal-agenda-item-ligne2">
        <span class="cal-agenda-item-note">${echapperHTML(e.note) || '—'}</span>
        <span class="cal-agenda-item-cat" style="color:${couleurCategorie}">${echapperHTML(categorieAffichee)}</span>
      </div>
    </div>`;
}

/* Trie une liste de dépenses selon l'état de tri d'un scope (même logique partout : Jour,
   Semaine, Paie, Mois utilisent tous ce même contrôle, pour un visuel et un comportement
   uniformes). */
function trierListeDepenses(items, tri){
  const cle = tri.key === 'Date' ? 'date' : tri.key === 'Qui' ? 'who' : tri.key === 'Categorie' ? 'category' : tri.key === 'Note' ? 'note' : 'amount';
  const triees = [...items].sort((a,b)=>{
    let va = a[cle], vb = b[cle];
    if(cle==='who'){ va = libellePersonne(va); vb = libellePersonne(vb); }
    if(cle==='amount'){ va = Number(va); vb = Number(vb); }
    if(va<vb) return tri.dir==='asc' ? -1 : 1;
    if(va>vb) return tri.dir==='asc' ? 1 : -1;
    return 0;
  });
  return triees;
}

function wirerTriAgendaTransactions(){
  /* Sécurité : si un tri par Qui/Catégorie/Note était actif avant leur retrait, on retombe
     sur Date plutôt que de laisser un état invalide. */
  if(!['Date','Montant'].includes(etatTri.transactions.key)) etatTri.transactions.key = 'Date';
  const sel = document.getElementById('agenda-tri-transactions');
  const dir = document.getElementById('agenda-tri-dir-transactions');
  if(sel){
    sel.value = etatTri.transactions.key;
    sel.addEventListener('change', ()=>{ etatTri.transactions.key = sel.value; afficherTransactions(); });
  }
  if(dir) dir.addEventListener('click', ()=>{
    etatTri.transactions.dir = etatTri.transactions.dir==='asc' ? 'desc' : 'asc';
    afficherTransactions();
  });
}

/* Vue "agenda", utilisée pour Jour/Semaine/Paie/Mois/Année — même carte partout, TOUJOURS en
   liste à plat (aucun regroupement par jour) : le tri se comporte donc exactement pareil peu
   importe le critère choisi. Le contrôle de tri lui-même vit maintenant dans la barre
   d'outils commune (voir rendreBarreOutilsTransactionsHTML), pas ici. */
function rendreAgendaCorpsHTMLTransactions(debut, fin, tri){
  const items = trierListeDepenses(depensesPourTransactions(debut, fin), tri);
  const corps = items.length
    ? items.map(e=>rendreCarteDepenseHTML(e)).join('')
    : '<div class="cal-agenda-empty">Aucune dépense pour cette période</div>';
  return corps;
}

/* Fenêtre « jour » : plus ouverte depuis que cliquer une date bascule en vue Jour (voir
   allerVueJour). Seule la fermeture reste branchée, par sécurité. */
function fermerJourModal(){ document.getElementById('jour-modal').style.display = 'none'; }
document.getElementById('close-jour-modal').addEventListener('click', fermerJourModal);

/* Modal d'édition d'un paiement récurrent */
/* Le même champ % sert pour une dépense (part de chacun) et pour un dépôt (qui a mis
   l'argent). Pour un dépôt, le libellé le dit clairement : 100 = dépôt de Gabriel,
   0 = dépôt de Mélissa. Un dépôt mal réparti fausserait le montant de chacun. */
const CHAMPS_REPARTITION = [
  { nom:'f-compte-nom-p1-conjoint', revenu:'f-est-revenu-conjoint' },
  { nom:'edit-compte-nom-p1',       revenu:'edit-est-revenu' },
  { nom:'edit-rec-compte-nom-p1',   revenu:'edit-rec-est-revenu' }
];
function majLibellesRepartition(){
  CHAMPS_REPARTITION.forEach(({ nom, revenu }) => {
    const span = document.getElementById(nom), caseRevenu = document.getElementById(revenu);
    if(!span || !caseRevenu) return;
    const label = span.parentElement;
    const estDepot = caseRevenu.checked;
    label.innerHTML = `${estDepot ? 'Part versée par' : 'Part de'} <span id="${nom}">${echapperHTML(nomsPersonnes.p1)}</span> (%)`
      + (estDepot ? `<span style="display:block;font-weight:400;font-size:12px;color:var(--text-secondary)">100 = dépôt de ${echapperHTML(nomsPersonnes.p1)}, 0 = dépôt de ${echapperHTML(nomsPersonnes.p2)}, 50 = argent commun</span>` : '');
  });
}
document.addEventListener('change', e => {
  if(e.target && CHAMPS_REPARTITION.some(c => c.revenu === e.target.id)) majLibellesRepartition();
});

function ouvrirEditionRecurrence(id){
  const rec = recurrences.find(r=>r.id===id); if(!rec) return;
  recurrenceEnEdition = rec;
  document.getElementById('edit-rec-nom').value = rec.nom;
  document.getElementById('edit-rec-montant').value = rec.montant;
  document.getElementById('edit-rec-categorie').innerHTML = categories.map(c=>`<option>${echapperHTML(c)}</option>`).join('');
  document.getElementById('edit-rec-categorie').value = rec.categorie;
  /* La date doit être en place AVANT de remplir les contrôles : ils en déduisent le jour du
     mois et la présence de l'option « dernier jour ». Avant, ils lisaient la date de la série
     ouverte précédemment (ou aujourd'hui), et une série « dernier jour du mois » était
     convertie en « le N de chaque mois » à la sauvegarde.
     On affiche le début de toute la famille : c'est la date que « Toute la série » modifie. */
  const debutsFamille = familleDeRecurrence(rec).map(r => r.dateDebut).filter(Boolean).sort();
  document.getElementById('edit-rec-date-debut').value = debutsFamille[0] || rec.dateDebut || '';
  remplirControlesRecurrence(CONTROLES_RECURRENCE_EDITION, { unite: rec.unite, intervalle: rec.intervalle, joursSemaine: rec.joursSemaine, typeMensuel: rec.typeMensuel });
  document.getElementById('edit-rec-fin-type').value = rec.finType || 'jamais';
  document.getElementById('edit-rec-fin-nombre').value = rec.finNombre || '';
  document.getElementById('edit-rec-fin-date').value = rec.finDate || '';
  appliquerAffichageFinRecurrence('edit-rec-fin-type','edit-rec-fin-nombre-field','edit-rec-fin-date-field');

  const quiField = document.getElementById('edit-rec-qui-field');
  const compteField = document.getElementById('edit-rec-compte-repartition-field');
  const repartitionInput = document.getElementById('edit-rec-compte-repartition');
  const estRevenuField = document.getElementById('edit-rec-est-revenu-field');
  const estRevenuCheckbox = document.getElementById('edit-rec-est-revenu');
  estRevenuField.style.display = ''; /* nettoie l'ancien masquage, l'état passe par activerChamp */
  document.getElementById('edit-rec-compte-nom-p1').textContent = nomsPersonnes.p1;
  document.getElementById('edit-rec-compte-repartition').value = rec.pourcentageP1 != null ? rec.pourcentageP1 : 50;
  estRevenuCheckbox.checked = !!rec.estRevenu;

  if(rec.type==='conjointe'){
    remplirOptionsQui('edit-rec-qui', true);
    document.getElementById('edit-rec-qui').value = rec.estCompte ? 'Compte conjoint' : libellePersonne(rec.who==='compte' ? 'p1' : rec.who);
    activerChamp('edit-rec-qui-field', true);
    activerChamp('edit-rec-compte-repartition-field', true);
    activerChamp('edit-rec-est-revenu-field', !!rec.estCompte);
  } else {
    activerChamp('edit-rec-qui-field', false);
    activerChamp('edit-rec-compte-repartition-field', false);
    activerChamp('edit-rec-est-revenu-field', true);
  }
  document.getElementById('edit-rec-toggle-type').textContent =
    rec.type === 'personnelle' ? 'Série personnelle' : 'Série conjointe';

  appliquerAffichageCategoriePourRevenu('edit-rec-est-revenu','edit-rec-categorie-field');

  document.getElementById('edit-rec-est-depot').checked = estSerieDepot(rec);
  appliquerAffichageDepotEdition();
  document.getElementById('edit-rec-sous-titre').textContent = estSerieDepot(rec) && rec.dateDebut < formaterDateISO(new Date())
    ? `Dépôts à venir · ${libelleRecurrence(rec)}`
    : `Toute la série · ${libelleRecurrence(rec)}`;
  document.getElementById('edit-recurrent-modal').style.display = 'flex';
  majLibellesRepartition();
}
document.getElementById('edit-rec-qui').addEventListener('change', ()=>{
  /* Même mécanique qu'à l'ouverture (activerChamp) : avant, ce gestionnaire masquait le
     champ avec style.display, ce qui laissait la case désactivée en revenant à « Compte
     conjoint », ou le champ caché pour les séries ouvertes ensuite. */
  const estCompte = document.getElementById('edit-rec-qui').value === 'Compte conjoint';
  activerChamp('edit-rec-est-revenu-field', estCompte);
  if(!estCompte) document.getElementById('edit-rec-est-revenu').checked = false;
  appliquerAffichageCategoriePourRevenu('edit-rec-est-revenu','edit-rec-categorie-field');
});
document.getElementById('close-edit-recurrent').addEventListener('click', ()=>document.getElementById('edit-recurrent-modal').style.display='none');
document.getElementById('delete-edit-recurrent').addEventListener('click', actionVerrouillee(document.getElementById('delete-edit-recurrent'), async ()=>{
  if(recurrenceEnEdition && estSerieDepot(recurrenceEnEdition)){
    if(confirm("Supprimer les dépôts prévus de cette série (à venir et à confirmer) ? Les dépôts confirmés restent.")){
      document.getElementById('edit-recurrent-modal').style.display='none';
      await supprimerSerieDepotEdition(recurrenceEnEdition);
    }
    return;
  }
  if(recurrenceEnEdition && confirm("Supprimer ce paiement récurrent ? Toutes ses occurrences (passées et futures) disparaîtront.")){
    document.getElementById('edit-recurrent-modal').style.display='none';
    /* Supprime toute la famille : une série fractionnée par des "et les suivantes" est
       composée de plusieurs segments, qui doivent tous disparaître ensemble. */
    await supprimerSerieComplete(recurrenceEnEdition.id, true);
  }
}));
/* Convertit n'importe quelle condition de fin en date de fin équivalente (ou null pour
   "jamais"). Permet de fusionner une famille de récurrences sans avoir à recompter un
   nombre d'occurrences à travers des segments aux motifs différents. */
function finDateEquivalente(rec){
  if(rec.finType === 'date') return rec.finDate;
  if(rec.finType === 'jamais') return null;
  const occ = genererOccurrences(rec, horizonMaximal());
  return occ.length ? formaterDateISO(occ[occ.length-1]) : null;
}

document.getElementById('save-edit-recurrent').addEventListener('click', actionVerrouillee(document.getElementById('save-edit-recurrent'), async ()=>{
  if(!recurrenceEnEdition) return;
  const nom = document.getElementById('edit-rec-nom').value.trim();
  const montant = parseFloat(document.getElementById('edit-rec-montant').value);
  if(!nom || !montant || montant<=0){ afficherAlerte("Merci d'entrer un nom et un montant valides."); return; }
  const categorie = document.getElementById('edit-rec-categorie').value;
  const dateDebutFormulaire = document.getElementById('edit-rec-date-debut').value;
  const cfgRepetition = lireControlesRecurrence(CONTROLES_RECURRENCE_EDITION) || { unite:'mois', intervalle:1, typeMensuel:'jour_mois' };
  const finType = document.getElementById('edit-rec-fin-type').value;
  const finNombreFormulaire = finType==='nombre' ? (parseInt(document.getElementById('edit-rec-fin-nombre').value,10) || null) : null;
  const finDateFormulaire = finType==='date' ? (document.getElementById('edit-rec-fin-date').value || null) : null;
  /* L'état actif/inactif se règle depuis la liste des récurrences ; la sauvegarde le
     conserve tel quel plutôt que de le réinitialiser. */
  const actif = recurrenceEnEdition.actif;

  if(finType==='nombre' && !finNombreFormulaire){ afficherAlerte("Merci d'entrer un nombre de paiements valide."); return; }
  if(finType==='date' && !finDateFormulaire){ afficherAlerte("Merci d'entrer une date de fin."); return; }

  let who = recurrenceEnEdition.who;
  let estCompte = false;
  let pourcentageP1 = null;
  if(recurrenceEnEdition.type==='conjointe'){
    estCompte = document.getElementById('edit-rec-qui').value === 'Compte conjoint';
    pourcentageP1 = Number(document.getElementById('edit-rec-compte-repartition').value);
    who = estCompte ? 'compte' : clePersonne(document.getElementById('edit-rec-qui').value);
  }
  const estRevenu = (recurrenceEnEdition.type==='personnelle' || estCompte) && document.getElementById('edit-rec-est-revenu').checked;
  const categorieFinale = estRevenu ? 'Revenu' : categorie;

  /* "Toute la série" s'applique à TOUTE la famille : si la série avait été fractionnée par
     des "cette dépense et les suivantes", tous les segments sont refondus en une seule règle
     portant les nouvelles valeurs. Toutes les occurrences changent — passées, présentes et
     futures — puisque plus rien n'est figé en base. Seules les suppressions individuelles
     survivent (une occurrence supprimée ne doit jamais réapparaître) ; les modifications
     individuelles sont écrasées, comme dans un calendrier. */
  const famille = familleDeRecurrence(recurrenceEnEdition);
  const segmentsAbsorbes = famille.filter(r => r.id !== recurrenceEnEdition.id);

  /* Début = la date du formulaire, qui affiche le début de toute la famille à l'ouverture.
     Avant, une date plus tardive était ignorée sans message : impossible de retarder le
     départ d'une série. */
  const vraiDebut = famille.reduce((a,b) => b.dateDebut < a.dateDebut ? b : a).dateDebut;
  const dateDebut = dateDebutFormulaire || vraiDebut;

  /* Fin : si l'utilisateur n'a pas touché "Se termine", on reprend la vraie fin de la
     famille (portée par le segment le plus tardif) plutôt que la fin tronquée du segment
     ouvert, qui n'est qu'un artefact des fractionnements précédents. */
  const finInchangee = finType === recurrenceEnEdition.finType
    && String(finNombreFormulaire || '') === String(recurrenceEnEdition.finNombre || '')
    && (finDateFormulaire || '') === (recurrenceEnEdition.finDate || '');
  let finTypeFinal = finType, finNombreFinal = finNombreFormulaire, finDateFinal = finDateFormulaire;
  if(finInchangee && segmentsAbsorbes.length){
    const queue = famille.reduce((a,b) => b.dateDebut > a.dateDebut ? b : a);
    const dateFin = finDateEquivalente(queue);
    if(dateFin == null){ finTypeFinal = 'jamais'; finNombreFinal = null; finDateFinal = null; }
    else { finTypeFinal = 'date'; finDateFinal = dateFin; finNombreFinal = null; }
  }

  /* Série de dépôt : seuls les dépôts à venir changent (voir remplacerAvenirSerieDepot). */
  if(depotEditionActif() && estRevenu){
    const recDepot = recurrenceEnEdition;
    document.getElementById('edit-recurrent-modal').style.display = 'none';
    const okDepot = await enregistrerSerieDepotEdition(recDepot, { nom, montant, pourcentageP1, cfg: cfgRepetition,
      dateDebut, finType: finTypeFinal, finNombre: finNombreFinal, finDate: finDateFinal });
    if(!okDepot) document.getElementById('edit-recurrent-modal').style.display = 'flex';
    return;
  }

  const update = {
    Nom: nom, Montant: montant, Categorie: categorieFinale,
    Frequence: frequenceHeritee(cfgRepetition.unite, cfgRepetition.intervalle),
    Unite: cfgRepetition.unite, Intervalle: cfgRepetition.intervalle,
    JoursSemaine: cfgRepetition.joursSemaine && cfgRepetition.joursSemaine.length ? cfgRepetition.joursSemaine.join(',') : null,
    TypeMensuel: cfgRepetition.typeMensuel || null,
    RacineId: recurrenceEnEdition.id,
    DateDebut: dateDebut, FinType: finTypeFinal, FinNombre: finNombreFinal, FinDate: finDateFinal,
    Qui: nomPersonneSupabase(who), Actif: actif, EstCompte: estCompte, EstRevenu: estRevenu, PourcentageP1: pourcentageP1
  };

  if(recurrencesSupabaseDisponible){
    let res = await ecritureVerifiee(supabaseClient.from('Recurrences').update(update).eq('id', recurrenceEnEdition.id));
    if(!res.ok){
      /* Colonnes récentes peut-être absentes sur une base plus ancienne : on réessaie sans
         elles pour que la mise à jour ne soit pas totalement bloquée. */
      console.warn("Mise à jour avec certaines colonnes récentes impossible, nouvel essai sans elles.", res.error);
      const { EstCompte, EstRevenu, PourcentageP1, Unite, Intervalle, JoursSemaine, TypeMensuel, RacineId, ...sansColonnesRecentes } = update;
      res = await ecritureVerifiee(supabaseClient.from('Recurrences').update(sansColonnesRecentes).eq('id', recurrenceEnEdition.id));
      if(!res.ok){
        /* La fenêtre reste ouverte avec la saisie : on peut réessayer sans tout retaper. */
        signalerEchecEnregistrement("La modification de la série", res.error);
        return;
      }
    }
  }

  Object.assign(recurrenceEnEdition, {
    nom, montant, categorie: categorieFinale,
    unite: cfgRepetition.unite, intervalle: cfgRepetition.intervalle, joursSemaine: cfgRepetition.joursSemaine, typeMensuel: cfgRepetition.typeMensuel,
    racineId: recurrenceEnEdition.id,
    dateDebut, finType: finTypeFinal, finNombre: finNombreFinal, finDate: finDateFinal, who, actif, estCompte, estRevenu, pourcentageP1: pourcentageP1 != null ? pourcentageP1 : 50
  });
  sauvegarderRecurrencesLocal();
  document.getElementById('edit-recurrent-modal').style.display = 'none';

  /* Les segments absorbés transmettent leurs suppressions individuelles à la règle unique,
     puis disparaissent. Les modifications individuelles restantes sont effacées : la
     nouvelle règle s'applique désormais à toutes les occurrences. */
  for(const segment of segmentsAbsorbes){
    if(!(await transfererSuppressions(segment.id, recurrenceEnEdition.id))) break;
    if(!(await supprimerRecurrence(segment.id, true))) break;
  }
  await supprimerExceptions(recurrenceEnEdition.id, { garderSuppressions: true });

  recalculerDepenses();
  afficherRecurrencesScope(recurrenceEnEdition.type==='personnelle' ? 'personnel' : 'conjoint');
  rafraichirActif();
  if(recurrenceEnEdition.type==='conjointe') notifierActivitePartenaire('modification', `${categorieFinale} — ${formaterMonnaie(montant)}`);
}));

function libellePersonne(who){ return nomsPersonnes[who] || who; }
function clePersonne(who){
  if(who === 'compte' || who === 'Compte') return 'compte';
  return who === 'Mélissa' || who === 'p2' ? 'p2' : 'p1';
}
function nomPersonneSupabase(who){
  const cle = clePersonne(who);
  if(cle === 'compte') return 'Compte';
  return cle === 'p2' ? 'Mélissa' : 'Gabriel';
}

function dansAnnee(dateStr, year){ return new Date(dateStr+"T00:00:00").getFullYear()===year; }
function dansMois(dateStr, year, month){
  const d = new Date(dateStr+"T00:00:00");
  return d.getFullYear()===year && d.getMonth()===month;
}

/* Rafraîchit les selects "Qui" et "Catégorie" des deux formulaires d'ajout (Conjoint / Personnel) */
function rafraichirOptionsFormulaires(){
  ['conjoint','personnel'].forEach(scope=>{
    const select = document.getElementById(`f-category-${scope}`);
    const current = select.value;
    select.innerHTML = categories.map(c=>`<option>${echapperHTML(c)}</option>`).join('');
    if(categories.includes(current)) select.value = current;

    const selectRec = document.getElementById(`rec-categorie-${scope}`);
    if(selectRec){
      const currentRec = selectRec.value;
      selectRec.innerHTML = categories.map(c=>`<option>${echapperHTML(c)}</option>`).join('');
      if(categories.includes(currentRec)) selectRec.value = currentRec;
    }
  });

  const whoConjoint = document.getElementById('f-who-conjoint');
  const valeurActuelle = whoConjoint.value;
  remplirOptionsQui('f-who-conjoint', !ajoutConjointSansCompte);
  const optionsValides = ajoutConjointSansCompte
    ? [nomsPersonnes.p1, nomsPersonnes.p2]
    : [nomsPersonnes.p1, nomsPersonnes.p2, 'Compte conjoint'];
  whoConjoint.value = optionsValides.includes(valeurActuelle) ? valeurActuelle : (nomsPersonnes[currentUser] || nomsPersonnes.p1);
}

function capitaliser(mot){
  return mot.charAt(0).toUpperCase() + mot.slice(1);
}

function afficherNavigationPeriode(){
  const estSection = estOngletAvecPeriode(activeMainTab);
  const sub = estSection ? activeSubtab[activeMainTab] : null;
  const nav = document.getElementById('period-nav');
  const switchEl = document.getElementById('period-type-switch');
  const label = document.getElementById('period-label');

  ['conjoint','personnel'].forEach(scope=>{
    const el = document.getElementById(`month-evolution-title-${scope}`);
    if(el){
      const { debut, fin } = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
      el.textContent = `Évolution des dépenses - ${libellePeriodeCalendrier(etatCalendrierPeriode.vue, debut, fin)}`;
    }
  });

  /* Un seul sélecteur de période, toujours placé juste sous les onglets Transactions /
     Résumé / Budget (et nulle part ailleurs) : on déplace le même élément dans le bon
     "emplacement" selon la section active, plutôt que d'en dupliquer un par section. */
  if(estSection){
    const emplacement = document.getElementById(`period-nav-slot-${activeMainTab}`);
    if(emplacement && nav.parentElement !== emplacement) emplacement.appendChild(nav);
  }

  /* Un seul sélecteur de période, toujours au même endroit (juste sous les onglets
     principaux), pour Transactions, Résumé et Budget — plus besoin de chercher où cliquer
     d'un onglet à l'autre. */
  if(!estSection || (sub!=='budget' && sub!=='resume' && sub!=='mois' && sub!=='compte')){
    nav.style.display = 'none';
    return;
  }
  nav.style.display = 'flex';

  if(sub==='budget'){
    /* Le budget lui-même reste toujours mensuel (voir afficherSectionBudget), mais on peut
       tout de même consulter la comparaison budget/réel à n'importe quelle granularité. */
    switchEl.style.display = '';
    switchEl.innerHTML = VUES_CALENDRIER.map(([v,lbl])=>
      `<button type="button" data-type="${v}" class="${etatCalendrierPeriode.vue===v?'active':''}">${lbl}</button>`).join('');
    switchEl.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
      etatCalendrierPeriode.vue = b.dataset.type;
      rafraichirSousOnglet(activeMainTab, 'budget');
      afficherNavigationPeriode();
    }));
    const { debut, fin } = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
    label.textContent = libellePeriodeCalendrier(etatCalendrierPeriode.vue, debut, fin);
  } else if(sub==='resume' || sub==='mois' || sub==='compte'){
    /* Transactions et Résumé partagent exactement le même sélecteur de période (Jour /
       Semaine / Paie / Mois / Année) — plus besoin de synchroniser deux états séparés, il
       n'y en a qu'un seul, donc c'est automatiquement pareil des deux côtés. */
    switchEl.style.display = '';
    switchEl.innerHTML = VUES_CALENDRIER.map(([v,lbl])=>
      `<button type="button" data-type="${v}" class="${etatCalendrierPeriode.vue===v?'active':''}">${lbl}</button>`).join('');
    switchEl.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
      etatCalendrierPeriode.vue = b.dataset.type;
      rafraichirSousOnglet(activeMainTab, sub);
      afficherNavigationPeriode();
    }));
    const { debut, fin } = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
    label.textContent = libellePeriodeCalendrier(etatCalendrierPeriode.vue, debut, fin);
  }
}

function afficherComparaison(){
  /* Uniquement des dépenses (les revenus étaient additionnés comme des dépenses), et jamais
     les dépenses personnelles de l'autre personne. */
  const source = depenses.filter(e=>{
    if(e.estRevenu) return false;
    if(modeCompareScope==='conjoint') return e.type==='conjointe';
    if(modeCompareScope==='personnel') return e.type==='personnelle' && e.who===currentUser;
    return e.type==='conjointe' || e.who===currentUser;
  });
  const options=[...new Set(source.map(e=>{const d=new Date(e.date+'T00:00:00');return modeComparaison==='mois'?`${d.getFullYear()}-${d.getMonth()}`:String(d.getFullYear());}))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const label=key=>modeComparaison==='mois'?(()=>{const [y,m]=key.split('-').map(Number);return `${NOMS_MOIS[m]} ${y}`;})():key;
  const period=key=>modeComparaison==='mois'?(()=>{const [y,m]=key.split('-').map(Number);return e=>dansMois(e.date,y,m);})():e=>dansAnnee(e.date,Number(key));
  const a=document.getElementById('compare-a'),b=document.getElementById('compare-b');
  /* On garde la sélection de l'utilisateur quand elle existe encore. Avant, chaque
     changement de sélection reconstruisait les listes et revenait de force aux deux
     dernières périodes : on ne pouvait rien comparer d'autre. */
  const choixA = a.value, choixB = b.value;
  a.innerHTML=options.map(key=>`<option value="${key}">${label(key)}</option>`).join(''); b.innerHTML=a.innerHTML;
  if(options.length>1){a.selectedIndex=options.length-2;b.selectedIndex=options.length-1;}
  if(options.includes(choixA)) a.value = choixA;
  if(options.includes(choixB)) b.value = choixB;
  const listA=source.filter(period(a.value)),listB=source.filter(period(b.value));
  const totalA=listA.reduce((s,e)=>s+e.amount,0),totalB=listB.reduce((s,e)=>s+e.amount,0),diff=totalB-totalA;
  document.getElementById('compare-stats').innerHTML=`<div class="stat-card"><div class="label">${label(a.value||'')}</div><div class="value">${formaterMonnaie(totalA)}</div></div><div class="stat-card"><div class="label">${label(b.value||'')}</div><div class="value">${formaterMonnaie(totalB)}</div></div><div class="stat-card"><div class="label">Écart</div><div class="value">${diff>=0?'+':''}${formaterMonnaie(diff)}</div></div>`;
  detruireGraphique('compare');
  charts.compare=new Chart(document.getElementById('chart-compare'),{type:'bar',data:{labels:[label(a.value||''),label(b.value||'')],datasets:[{label:'Dépenses',data:[totalA,totalB],backgroundColor:couleursPersonnes.p1,borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>formaterMonnaie(v)}}}}});
}
document.querySelectorAll('#compare-scope-toggle button').forEach(bouton=>{
  bouton.addEventListener('click', ()=>{
    document.querySelectorAll('#compare-scope-toggle button').forEach(b=>b.classList.remove('active'));
    bouton.classList.add('active');
    modeCompareScope = bouton.dataset.scope;
    afficherComparaison();
  });
});

/* Personnel/Conjoint cochés dans le menu ☰ ("scope" au sens des DONNÉES : qui possède la
   dépense — à ne pas confondre avec l'onglet PRINCIPAL affiché, qui est maintenant
   Transactions/Résumé/Compte/Budget). Compte conjoint compte comme du Conjoint ici : Résumé
   et Budget n'ont jamais distingué les dépenses payées par le compte des autres dépenses
   conjointes, seule Transactions fait cette distinction visuelle. */
function personnelCoche(){ return !filtresTransactions.typesCaches.includes('personnel'); }
function conjointCoche(){ return !filtresTransactions.typesCaches.includes('conjoint'); }

function afficherResumePage(){
  const persoOn = personnelCoche(), conjointOn = conjointCoche();
  /* "+ Conjoint" (l'ancien bouton) est maintenant simplement : les deux cases sont cochées
     en même temps. Le bloc Personnel inclut alors la part personnelle des dépenses
     conjointes, exactement comme avant. */
  inclureConjointDansPersonnel = persoOn && conjointOn;
  const blocConjoint = document.getElementById('resume-bloc-conjoint');
  const blocPersonnel = document.getElementById('resume-bloc-personnel');
  blocConjoint.style.display = conjointOn ? '' : 'none';
  blocPersonnel.style.display = persoOn ? '' : 'none';
  /* Les mêmes tableaux (stats + graphiques) s'affichent peu importe la période choisie —
     seules les valeurs à l'intérieur changent, calculées pour la période sélectionnée
     (resume-annee-* est un ancien bloc "Année" désormais fusionné dans "Mois", toujours
     masqué). */
  ['conjoint','personnel'].forEach(s=>{
    const moisBlock = document.getElementById(`resume-mois-${s}`);
    const anneeBlock = document.getElementById(`resume-annee-${s}`);
    const anneeStats = document.getElementById(`annee-stats-${s}`);
    if(moisBlock) moisBlock.style.display = '';
    if(anneeBlock) anneeBlock.style.display = 'none';
    if(anneeStats) anneeStats.style.display = 'none';
  });
  if(conjointOn) afficherResumeUnifie('conjoint');
  if(persoOn) afficherResumeUnifie('personnel');
}

function afficherBudgetPage(){
  const persoOn = personnelCoche(), conjointOn = conjointCoche();
  inclureConjointDansPersonnel = persoOn && conjointOn;
  const blocConjoint = document.getElementById('budget-bloc-conjoint');
  const blocPersonnel = document.getElementById('budget-bloc-personnel');
  blocConjoint.style.display = conjointOn ? '' : 'none';
  blocPersonnel.style.display = persoOn ? '' : 'none';
  if(conjointOn) afficherSectionBudget('conjoint');
  if(persoOn) afficherSectionBudget('personnel');
}

function rafraichirSousOnglet(scope, sub){
  /* S'assure que les occurrences des récurrences couvrent bien la période consultée, même
     très loin dans le futur, AVANT de dessiner quoi que ce soit. */
  const borne = bornePeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef);
  assurerHorizon(borne.fin);

  if(scope==='transactions'){
    /* Vue fusionnée (Personnel + Conjoint + Compte conjoint), filtrée par les cases à
       cocher du menu ☰ — plus de scope à distinguer ici, `sub` vaut toujours 'mois'. */
    afficherTransactions();
  } else if(sub==='resume'){
    afficherResumePage();
  } else if(sub==='compte'){
    afficherEcheancierCompteConjoint();
  } else if(sub==='budget'){
    afficherBudgetPage();
  }
}

/* Rafraîchit tout ce qui est visible à l'écran en ce moment (après un ajout/modif/suppr.) */
function rafraichirActif(){
  /* L'échéancier lu par les notifications est recalculé à chaque changement, peu importe
     l'onglet ouvert. Avant, il ne l'était qu'à l'affichage de « Prochains dépôts » et
     jamais quand la carte était masquée : d'anciens montants restaient notifiés. Toujours
     le même nombre de paies, pour que la signature ne change pas d'un écran à l'autre. */
  if(currentSession && currentUser) synchroniserEcheancierNotifications(echeancierPourNotifications(executerMoteurCompte()));
  appliquerTheme();
  rafraichirOptionsFormulaires();
  if(estOngletAvecPeriode(activeMainTab)){
    rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
  } else if(activeMainTab==='comparer'){
    afficherComparaison();
  }
  afficherNavigationPeriode();
}

/* `moisActif`/`anneeActive` restent la référence pour le Budget (mensuel par nature). Ils
   sont maintenant recalculés depuis `etatCalendrierPeriode.dateRef` à CHAQUE déplacement de
   période, quelle que soit la vue.

   Avant, seules les vues "Mois" et "Année" les mettaient à jour : en vue Jour/Semaine/Paie,
   avancer avec ‹ › jusque dans le mois suivant changeait bien les dépenses affichées, mais
   le budget comparé (et le prorata, et l'entête "Gérer le budget de ...") restait bloqué sur
   le mois précédent. */
function synchroniserMoisActif(){
  const ref = etatCalendrierPeriode.dateRef;
  moisActif = { year: ref.getFullYear(), month: ref.getMonth() };
  anneeActive = ref.getFullYear();
}
function changerMois(amount){
  const date = new Date(moisActif.year, moisActif.month + amount, 1);
  etatCalendrierPeriode.dateRef = date;
  synchroniserMoisActif();
  if(estOngletAvecPeriode(activeMainTab)) rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
  afficherNavigationPeriode();
}
function allerAuMoisActuel(){
  etatCalendrierPeriode.dateRef = debutJour(new Date());
  synchroniserMoisActif();
  if(estOngletAvecPeriode(activeMainTab)) rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
  afficherNavigationPeriode();
}
function changerAnnee(amount){
  etatCalendrierPeriode.dateRef = new Date(anneeActive + amount, etatCalendrierPeriode.dateRef.getMonth(), 1);
  synchroniserMoisActif();
  if(estOngletAvecPeriode(activeMainTab)) rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
  afficherNavigationPeriode();
}

/* Dispatcher unique du sélecteur de période commun : selon l'onglet actif, ‹/› et le
   libellé pilotent soit le mois, soit l'année, soit la période du calendrier — mais restent
   toujours au même endroit à l'écran, pour une navigation simple et prévisible. Mois/Année
   passent par changerMois/changerAnnee pour garder Budget synchronisé ; Jour/Semaine/Paie
   avancent directement `etatCalendrierPeriode.dateRef`. */
function periodeNavigation(direction){
  const sub = activeSubtab[activeMainTab];
  if(sub!=='budget' && sub!=='resume' && sub!=='mois' && sub!=='compte') return;
  if(etatCalendrierPeriode.vue==='mois') changerMois(direction);
  else if(etatCalendrierPeriode.vue==='annee') changerAnnee(direction);
  else {
    etatCalendrierPeriode.dateRef = avancerPeriode(etatCalendrierPeriode.vue, etatCalendrierPeriode.dateRef, direction);
    synchroniserMoisActif();
    rafraichirSousOnglet(activeMainTab, sub);
    afficherNavigationPeriode();
  }
}
function periodeLabelClick(){
  const sub = activeSubtab[activeMainTab];
  if(sub!=='budget' && sub!=='resume' && sub!=='mois' && sub!=='compte') return;
  if(etatCalendrierPeriode.vue==='mois'){
    allerAuMoisActuel();
  } else {
    etatCalendrierPeriode.dateRef = debutJour(new Date());
    synchroniserMoisActif();
    rafraichirSousOnglet(activeMainTab, sub);
    afficherNavigationPeriode();
  }
}
document.getElementById('period-prev').addEventListener('click', ()=>periodeNavigation(-1));
document.getElementById('period-next').addEventListener('click', ()=>periodeNavigation(1));
document.getElementById('period-label').addEventListener('click', periodeLabelClick);
document.getElementById('period-label').addEventListener('keydown', (e)=>{
  if(e.key==='Enter' || e.key===' '){ e.preventDefault(); periodeLabelClick(); }
});
document.querySelectorAll('.compare-toggle button[data-mode]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('.compare-toggle button[data-mode]').forEach(b=>b.classList.remove('active'));button.classList.add('active');modeComparaison=button.dataset.mode;afficherComparaison();}));
document.getElementById('compare-a').addEventListener('change',afficherComparaison);
document.getElementById('compare-b').addEventListener('change',afficherComparaison);

/* Gestion des onglets principaux (Transactions / Résumé / Compte / Budget / Comparer) */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    document.getElementById('header-title').innerHTML = btn.innerHTML;
    activeMainTab = btn.dataset.tab;
    if(estOngletAvecPeriode(activeMainTab)){
      rafraichirSousOnglet(activeMainTab, activeSubtab[activeMainTab]);
    } else if(activeMainTab==='comparer'){
      afficherComparaison();
    }
    afficherNavigationPeriode();
  });
});
/* Les paramètres sont une fenêtre, pas un onglet : on n'y « navigue » pas, on y fait un
   réglage et on revient là où on était. L'onglet actif et la période affichée restent donc
   intacts pendant qu'elle est ouverte. */
function fermerSettingsModal(){ document.getElementById('settings-modal').style.display = 'none'; }
document.getElementById('open-settings').addEventListener('click',()=>{
  document.getElementById('settings-modal').style.display = 'flex';
});
document.getElementById('close-settings-modal').addEventListener('click', fermerSettingsModal);
document.getElementById('settings-modal').addEventListener('click', (e)=>{
  if(e.target.id === 'settings-modal') fermerSettingsModal();
});

/* Menu latéral (☰) : regroupe la navigation entre sections et l'accès aux paramètres.
   Les boutons qu'il contient (onglets, paramètres) gardent leurs gestionnaires d'origine ;
   on se contente ici de refermer le menu après un clic dessus, par délégation. */
function ouvrirMenu(){
  document.getElementById('side-drawer').classList.add('open');
  document.getElementById('side-drawer-overlay').classList.add('open');
  /* Les cases doivent refléter l'état actuel même si on ouvre le menu depuis Résumé/Compte/
     Budget, où elles n'ont pas forcément été redessinées récemment. */
  rendreFiltresTransactionsDrawer();
}
function fermerMenu(){
  document.getElementById('side-drawer').classList.remove('open');
  document.getElementById('side-drawer-overlay').classList.remove('open');
}
document.getElementById('open-menu').addEventListener('click', ouvrirMenu);
document.getElementById('side-drawer-overlay').addEventListener('click', fermerMenu);
document.getElementById('side-drawer').addEventListener('click', (e)=>{
  if(e.target.closest('button')) fermerMenu();
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') fermerMenu();
});

/* Ajout d'une dépense (en envoyant les colonnes avec majuscules). Le type est désormais
   implicite selon la section (Conjoint -> conjointe, Personnel -> personnelle). */
function determinerQui(scope){
  return scope==='conjoint' ? document.getElementById('f-who-conjoint').value : (nomsPersonnes[currentUser] || nomsPersonnes.p1);
}

async function ajouterDepense(scope){
  const type = scope==='conjoint' ? 'conjointe' : 'personnelle';
  const estCompte = scope==='conjoint' && document.getElementById('f-who-conjoint').value === 'Compte conjoint';
  const estRevenu = scope==='conjoint' ? (estCompte && document.getElementById('f-est-revenu-conjoint').checked) : document.getElementById('f-est-revenu-personnel').checked;
  const who = estCompte ? 'compte' : determinerQui(scope);
  let pourcentageP1 = type==='conjointe' ? Number(document.getElementById('f-compte-repartition-conjoint').value) : null;
  const amount = parseFloat(document.getElementById(`f-amount-${scope}`).value);
  const date = document.getElementById(`f-date-${scope}`).value;
  let category = estRevenu ? 'Revenu' : document.getElementById(`f-category-${scope}`).value;
  let note = document.getElementById(`f-note-${scope}`).value.trim();
  /* La bascule « Se répète » décide : à OFF c'est une dépense ponctuelle, à ON on lit les
     réglages dépliés juste en dessous. */
  let cfgRepetition = document.getElementById(`f-repete-${scope}`).checked
    ? lireControlesRecurrence(controlesRecurrenceAjout(scope))
    : null;
  /* Dépôt pour payer le compte : toujours une prévision (récurrente, ou unique). */
  const depotPrevu = scope==='conjoint' && depotAjoutActif();
  let depotUnique = false;
  if(depotPrevu){
    if(date && date < formaterDateISO(new Date())){ afficherAlerte("Un dépôt prévu doit être daté d'aujourd'hui ou plus tard."); return; }
    const v = valeursDepotAjout();
    pourcentageP1 = v.pourcentageP1;
    category = v.categorie;
    if(!note) note = v.nom;
    if(!cfgRepetition){
      depotUnique = true;
      cfgRepetition = { unite: 'mois', intervalle: 1, joursSemaine: null, typeMensuel: 'jour_mois' };
    }
  }

  if(!amount || amount<=0 || !date){
    afficherAlerte("Merci d'entrer un montant et une date valides.");
    return;
  }

  /* "Se répète" != Ne se répète pas : au lieu d'une dépense ponctuelle, on crée une
     récurrence à partir de cette date (façon "Se répète" de Google Agenda) — le calendrier
     matérialisera ensuite ses occurrences comme n'importe quelle autre récurrence. */
  if(cfgRepetition){
    const finType = depotUnique ? 'nombre' : document.getElementById(`f-fin-type-${scope}`).value;
    const finNombreRaw = depotUnique ? '1' : document.getElementById(`f-fin-nombre-${scope}`).value;
    const finNombre = finType==='nombre' ? (parseInt(finNombreRaw,10) || null) : null;
    const finDateRaw = document.getElementById(`f-fin-date-${scope}`).value;
    const finDate = finType==='date' ? (finDateRaw || null) : null;
    if(finType==='nombre' && !finNombre){ afficherAlerte("Merci d'entrer un nombre de paiements valide."); return; }
    if(finType==='date' && !finDate){ afficherAlerte("Merci d'entrer une date de fin."); return; }

    const idCree = await creerRecurrenceDepuisValeurs({
      type, nom: note, montant: amount, categorie: category,
      unite: cfgRepetition.unite, intervalle: cfgRepetition.intervalle, joursSemaine: cfgRepetition.joursSemaine, typeMensuel: cfgRepetition.typeMensuel,
      dateDebut: date, finType, finNombre, finDate, who, estCompte, estRevenu, pourcentageP1
    });
    if(!idCree) return; /* saisie conservée dans le formulaire pour réessayer */
    recalculerDepenses();
    reinitialiserFormulaireAjoutDepense(scope);
    afficherRecurrencesScope(scope);
    rafraichirActif();
    if(type==='conjointe') notifierActivitePartenaire('ajout', depotPrevu ? `${note} prévu — ${formaterMonnaie(amount)}` : `${category} — ${formaterMonnaie(amount)}`);
    if(depotPrevu){
      document.getElementById('f-est-depot-conjoint').checked = false;
      delete document.getElementById('f-depot-qui-conjoint').dataset.choisi;
      appliquerAffichageDepotAjout();
    }
    return;
  }

  const nouvelleDepenseDB = {
    id: uid(),
    Qui: nomPersonneSupabase(who),
    Montant: amount,
    Date: date,
    Categorie: category,
    Note: note,
    Type: type,
    EstCompte: estCompte,
    EstRevenu: estRevenu,
    PourcentageP1: pourcentageP1,
    /* Pour une dépense personnelle, on l'associe à l'utilisateur connecté : c'est ce qui
       permet à Supabase de la garder invisible pour l'autre personne (RLS). */
    user_id: type === 'personnelle' ? (currentSession?.user?.id || null) : null
  };

  let { error } = await supabaseClient.from('Depenses').insert([nouvelleDepenseDB]);
  if(error){
    /* Les colonnes EstCompte/EstRevenu/PourcentageP1 n'existent peut-être pas encore : on
       réessaie sans elles pour que la dépense soit tout de même enregistrée. */
    console.warn("Insertion avec EstCompte/EstRevenu/PourcentageP1 impossible, nouvel essai sans ces colonnes.", error);
    const { EstCompte, EstRevenu, PourcentageP1, ...sansColonnesRecentes } = nouvelleDepenseDB;
    const retry = await supabaseClient.from('Depenses').insert([sansColonnesRecentes]);
    if(retry.error){
      afficherAlerte("Erreur lors de l'enregistrement sur Supabase.");
      console.error(retry.error);
      return;
    }
  }

  depensesReelles.push({
    ajout: formaterDateISO(new Date()),
    id: nouvelleDepenseDB.id,
    who: clePersonne(who),
    amount: nouvelleDepenseDB.Montant,
    date: nouvelleDepenseDB.Date,
    category: nouvelleDepenseDB.Categorie,
    note: nouvelleDepenseDB.Note,
    type: nouvelleDepenseDB.Type,
    recurrenceId: null,
    estCompte: nouvelleDepenseDB.EstCompte,
    estRevenu: nouvelleDepenseDB.EstRevenu,
    pourcentageP1: nouvelleDepenseDB.PourcentageP1 != null ? nouvelleDepenseDB.PourcentageP1 : 50
  });
  recalculerDepenses();

  reinitialiserFormulaireAjoutDepense(scope);
  rafraichirActif();
  if(type==='conjointe') notifierActivitePartenaire('ajout', `${category} — ${formaterMonnaie(amount)}`);
}

/* Remet le formulaire d'ajout à zéro après une insertion réussie (dépense ou récurrence). */
function reinitialiserFormulaireAjoutDepense(scope){
  document.getElementById(`f-amount-${scope}`).value = '';
  document.getElementById(`f-note-${scope}`).value = '';
  document.getElementById(`f-repete-${scope}`).checked = false;
  /* Formulaire vidé : les jours redeviennent libres de suivre la prochaine date choisie. */
  const conteneurJours = document.getElementById(`f-rec-jours-${scope}`);
  if(conteneurJours) conteneurJours.dataset.choisiParUtilisateur = '0';
  document.getElementById(`f-rec-unite-${scope}`).dataset.initialise = '';
  appliquerAffichageRepetition(scope, false);
  document.getElementById(`f-fin-type-${scope}`).value = 'jamais';
  document.getElementById(`f-fin-nombre-${scope}`).value = '';
  document.getElementById(`f-fin-date-${scope}`).value = '';
  appliquerAffichageFinRecurrence(`f-fin-type-${scope}`, `f-fin-nombre-field-${scope}`, `f-fin-date-field-${scope}`);
  document.getElementById(`f-fin-type-field-${scope}`).style.display = 'none';
  document.getElementById(`form-modal-${scope}`).style.display = 'none';
  /* Valeurs de base : date du jour, catégorie par défaut, et côté conjoint la personne qui
     utilise l'application avec un partage à parts égales. Sans ça, rouvrir le formulaire
     réaffichait la saisie précédente, ce qui fait facilement enregistrer une dépense avec la
     date ou la catégorie de la fois d'avant. */
  document.getElementById(`f-date-${scope}`).value = formaterDateISO(new Date());
  document.getElementById(`f-category-${scope}`).value = 'Épicerie';
  if(scope==='conjoint'){
    document.getElementById('f-est-revenu-conjoint').checked = false;
    document.getElementById('f-compte-repartition-conjoint').value = 50;
    document.getElementById('f-who-conjoint').value = nomsPersonnes[currentUser] || nomsPersonnes.p1;
    appliquerChoixQuiConjoint('f-who-conjoint','f-compte-repartition-conjoint','f-est-revenu-field-conjoint');
    document.getElementById('f-est-depot-conjoint').checked = false;
    appliquerAffichageDepotAjout();
    appliquerAffichageCategoriePourRevenu('f-est-revenu-conjoint','f-category-field-conjoint');
  } else {
    document.getElementById('f-est-revenu-personnel').checked = false;
    appliquerAffichageCategoriePourRevenu('f-est-revenu-personnel','f-category-field-personnel');
  }
  rafraichirOptionsFormulaires();
  majLibellesRepartition();
}
['conjoint','personnel'].forEach(scope=>{
  const bouton = document.getElementById(`btn-add-${scope}`);
  bouton.addEventListener('click', actionVerrouillee(bouton, ()=>ajouterDepense(scope)));
});

/* ===================== RÉCURRENCE : CONTRÔLES EN LIGNE =====================
   Une bascule « Se répète » dans le formulaire ; quand elle est à ON, les réglages se
   déplient juste en dessous, dans le même écran. Il n'y a plus de fenêtre « Personnaliser… »
   ni de liste de préréglages : un seul chemin pour un seul résultat.

   Les mêmes contrôles servent aux deux formulaires d'ajout et à la fenêtre d'édition d'une
   récurrence ; chaque emplacement fournit simplement les identifiants de SES éléments. */

function controlesRecurrenceAjout(scope){
  return {
    intervalle: `f-rec-intervalle-${scope}`,
    unite: `f-rec-unite-${scope}`,
    jours: `f-rec-jours-${scope}`,
    joursField: `f-rec-jours-field-${scope}`,
    typeMensuel: `f-rec-type-mensuel-${scope}`,
    mensuelField: `f-rec-mensuel-field-${scope}`,
    dates: `f-rec-${scope}-dates`, datesField: `f-rec-${scope}-dates-field`, finType: `f-fin-type-${scope}`,
    date: `f-date-${scope}`
  };
}
const CONTROLES_RECURRENCE_EDITION = {
  intervalle:'edit-rec-intervalle', unite:'edit-rec-unite',
  jours:'edit-rec-jours', joursField:'edit-rec-jours-field',
  typeMensuel:'edit-rec-type-mensuel', mensuelField:'edit-rec-mensuel-field',
  dates:'edit-rec-dates', datesField:'edit-rec-dates-field', finType:'edit-rec-fin-type',
  date:'edit-rec-date-debut'
};

function peuplerJoursSemaineBoutons(conteneurId, joursSelectionnes){
  const conteneur = document.getElementById(conteneurId);
  if(!conteneur) return;
  conteneur.innerHTML = NOMS_JOURS_LETTRE.map((lettre,i)=>
    `<button type="button" class="jour-btn${joursSelectionnes.includes(i)?' selected':''}" data-jour="${i}">${lettre}</button>`
  ).join('');
}

/* « Le dernier jour du mois » n'est proposé QUE si la date choisie tombe effectivement le
   dernier jour : partout ailleurs ce serait un réglage impossible à deviner à la lecture de
   la date. Si l'option disparaît alors qu'elle était sélectionnée, on retombe sur le jour
   du mois. */
function peuplerTypeMensuel(ids){
  const select = document.getElementById(ids.typeMensuel);
  if(!select) return;
  const dateISO = document.getElementById(ids.date).value;
  const d = dateISO ? new Date(dateISO+"T00:00:00") : new Date();
  const estDernierJour = d.getDate() === dernierJourDuMois(d).getDate();
  const ancienChoix = select.value;
  let html = `<option value="jour_mois">Le ${d.getDate()} de chaque mois</option>`;
  if(estDernierJour) html += `<option value="dernier_jour">Le dernier jour du mois</option>`;
  select.innerHTML = html;
  select.value = (ancienChoix === 'dernier_jour' && estDernierJour) ? 'dernier_jour' : 'jour_mois';
}

/* Les jours de la semaine ne concernent qu'une règle hebdomadaire, le choix du jour du mois
   qu'une règle mensuelle : on n'affiche que ce qui s'applique. */
function appliquerAffichageRecurrence(ids){
  const unite = document.getElementById(ids.unite).value;
  document.getElementById(ids.joursField).style.display = unite === 'semaine' ? '' : 'none';
  document.getElementById(ids.mensuelField).style.display = unite === 'mois' ? '' : 'none';
  if(unite === 'mois') peuplerTypeMensuel(ids);
  if(unite === 'semaine') semerJoursDepuisDate(ids);
  appliquerAffichageDatesMultiples(ids);
}

/* Les jours cochés SUIVENT la date choisie, tant que l'utilisateur n'en a pas coché
   lui-même. Sans ça, passer sur « semaine » laissait en place les jours d'un réglage
   précédent : on pouvait croire avoir choisi « le samedi » alors qu'un autre jour restait
   coché en dessous, et la première occurrence tombait au mauvais endroit. */
function semerJoursDepuisDate(ids){
  const conteneur = document.getElementById(ids.jours);
  if(!conteneur || conteneur.dataset.choisiParUtilisateur === '1') return;
  const dateISO = document.getElementById(ids.date).value;
  const d = dateISO ? new Date(dateISO+"T00:00:00") : new Date();
  peuplerJoursSemaineBoutons(ids.jours, [d.getDay()]);
}

function remplirControlesRecurrence(ids, cfg){
  const dateISO = document.getElementById(ids.date).value;
  const d = dateISO ? new Date(dateISO+"T00:00:00") : new Date();
  const c = cfg || { unite:'mois', intervalle:1 };
  document.getElementById(ids.intervalle).value = Math.max(1, c.intervalle || 1);
  document.getElementById(ids.unite).value = c.unite || 'mois';
  ecrireDatesMultiples(ids, c.unite === 'dates' ? c.joursSemaine : []);
  const joursExplicites = !!(c.joursSemaine && c.joursSemaine.length);
  peuplerJoursSemaineBoutons(ids.jours, joursExplicites ? c.joursSemaine : [d.getDay()]);
  document.getElementById(ids.jours).dataset.choisiParUtilisateur = joursExplicites ? '1' : '0';
  appliquerAffichageRecurrence(ids);
  const selMensuel = document.getElementById(ids.typeMensuel);
  if(selMensuel && c.typeMensuel === 'dernier_jour'){
    /* Une série existante réglée sur « dernier jour » garde ce réglage même si sa date de
       début n'est pas un dernier jour (données d'une version précédente) : on ajoute
       l'option plutôt que de la convertir en silence. */
    if(!selMensuel.querySelector('option[value="dernier_jour"]')){
      selMensuel.insertAdjacentHTML('beforeend', '<option value="dernier_jour">Le dernier jour du mois</option>');
    }
    selMensuel.value = 'dernier_jour';
  }
}

function lireControlesRecurrence(ids){
  const unite = document.getElementById(ids.unite).value;
  const intervalle = Math.max(1, parseInt(document.getElementById(ids.intervalle).value,10) || 1);
  const joursSemaine = unite === 'semaine'
    ? Array.from(document.querySelectorAll(`#${ids.jours} .jour-btn.selected`)).map(b=>parseInt(b.dataset.jour,10)).sort((a,b)=>a-b)
    : unite === 'dates' ? lireDatesMultiples(ids) : null;
  const selMensuel = document.getElementById(ids.typeMensuel);
  const typeMensuel = unite === 'mois' && selMensuel ? selMensuel.value : null;
  const dateISO = document.getElementById(ids.date).value;
  return normaliserConfigRepetition({ unite, intervalle, joursSemaine, typeMensuel }, dateISO);
}

function brancherControlesRecurrence(ids){
  brancherDatesMultiples(ids);
  document.getElementById(ids.unite).addEventListener('change', ()=>appliquerAffichageRecurrence(ids));
  document.getElementById(ids.jours).addEventListener('click', (e)=>{
    const btn = e.target.closest('.jour-btn');
    if(!btn) return;
    btn.classList.toggle('selected');
    /* Au moins un jour doit rester coché, sinon la règle n'a plus de sens. */
    if(!document.querySelector(`#${ids.jours} .jour-btn.selected`)) btn.classList.add('selected');
    /* À partir d'ici, le choix appartient à l'utilisateur : la date ne le réécrit plus. */
    e.currentTarget.dataset.choisiParUtilisateur = '1';
  });
  document.getElementById(ids.date).addEventListener('change', ()=>{
    const unite = document.getElementById(ids.unite).value;
    if(unite === 'mois') peuplerTypeMensuel(ids);
    if(unite === 'semaine') semerJoursDepuisDate(ids);
  });
}

/* Fenêtre d'édition d'une récurrence : contrôles toujours visibles, pas de bascule. */
brancherControlesRecurrence(CONTROLES_RECURRENCE_EDITION);

/* Bascule « Se répète » des deux formulaires d'ajout : à ON, tous les réglages de récurrence
   se déplient sous la ligne « Date / Se répète ». */
['conjoint','personnel'].forEach(scope=>{
  const ids = controlesRecurrenceAjout(scope);
  brancherControlesRecurrence(ids);

  /* Tout changement de réglage (unité, intervalle, jours, date) refait l'aperçu. */
  [ids.unite, ids.intervalle, ids.jours, ids.typeMensuel, ids.date, ids.dates].forEach(elId=>{
    const el = document.getElementById(elId);
    if(el) ['change','click','input'].forEach(evt => el.addEventListener(evt, ()=>{
      if(document.getElementById(`f-repete-${scope}`).checked) rafraichirApercuRecurrence(scope);
    }));
  });

  document.getElementById(`f-repete-${scope}`).addEventListener('change', function(){
    appliquerAffichageRepetition(scope, this.checked);
    if(!this.checked) return;
    /* Les réglages viennent d'apparaître sous la ligne 4. Sur mobile ils seraient cachés par
       le clavier : on le referme et on les amène dans le champ de vision. */
    if(document.activeElement && document.activeElement.blur) document.activeElement.blur();
    setTimeout(()=>{
      const bloc = document.getElementById(`f-rec-intervalle-field-${scope}`);
      if(bloc) bloc.scrollIntoView({block:'nearest', behavior:'smooth'});
    }, 250);
  });

  document.getElementById(`f-fin-type-${scope}`).addEventListener('change', ()=>
    appliquerAffichageFinRecurrence(`f-fin-type-${scope}`, `f-fin-nombre-field-${scope}`, `f-fin-date-field-${scope}`));

  appliquerAffichageRepetition(scope, false);
});

/* Affiche ou masque d'un bloc tous les réglages de récurrence d'un formulaire d'ajout. */
function appliquerAffichageRepetition(scope, actif){
  const ids = controlesRecurrenceAjout(scope);
  if(actif){
    /* Re-déplier le bloc relit ses propres contrôles : ça ne doit pas être compris comme un
       choix de l'utilisateur, sinon les jours cesseraient de suivre la date. */
    const conteneurJours = document.getElementById(ids.jours);
    const choixAnterieur = conteneurJours ? conteneurJours.dataset.choisiParUtilisateur : '0';
    remplirControlesRecurrence(ids, lireConfigCouranteOuDefaut(scope));
    if(conteneurJours) conteneurJours.dataset.choisiParUtilisateur = choixAnterieur || '0';
  }
  document.querySelectorAll(`#form-card-${scope} .bloc-recurrence`).forEach(el=>{
    el.style.display = actif ? '' : 'none';
  });
  /* Pour une série, la date saisie est un point de DÉPART : la première occurrence peut
     tomber plus tard (choisir le 11 septembre avec « toutes les semaines le samedi » donne
     une première occurrence le 12). Le libellé le dit, et l'aperçu la donne explicitement. */
  document.getElementById(`f-date-label-${scope}`).textContent = actif ? 'À partir de' : 'Date';
  if(actif){
    appliquerAffichageRecurrence(ids);
    appliquerAffichageFinRecurrence(`f-fin-type-${scope}`, `f-fin-nombre-field-${scope}`, `f-fin-date-field-${scope}`);
    rafraichirApercuRecurrence(scope);
  }
}

/* Annonce la première occurrence réellement générée par les réglages en cours. */
function rafraichirApercuRecurrence(scope){
  const champ = document.getElementById(`f-apercu-${scope}`);
  const bloc = document.getElementById(`f-apercu-field-${scope}`);
  if(!champ || !bloc) return;
  const dateISO = document.getElementById(`f-date-${scope}`).value;
  if(!dateISO){ bloc.style.display = 'none'; return; }
  const cfg = lireControlesRecurrence(controlesRecurrenceAjout(scope));
  const apercu = { ...cfg, dateDebut: dateISO, finType:'jamais' };
  const occs = genererOccurrences(apercu, ajouterJours(new Date(dateISO+"T00:00:00"), 800));
  bloc.style.display = '';
  if(!occs.length){
    champ.textContent = "Aucune occurrence ne correspond à ces réglages.";
    champ.className = 'apercu-alerte';
    return;
  }
  const premiere = occs[0];
  const memeJour = formaterDateISO(premiere) === dateISO;
  champ.className = '';
  champ.textContent = memeJour
    ? `Première occurrence : ${premiere.toLocaleDateString('fr-CA',{weekday:'long', day:'numeric', month:'long', year:'numeric'})}.`
    : `Première occurrence : ${premiere.toLocaleDateString('fr-CA',{weekday:'long', day:'numeric', month:'long', year:'numeric'})} — la date choisie sert de point de départ.`;
}

/* Au premier dépliage, on propose « tous les mois », le réglage le plus courant pour une
   dépense; ensuite on conserve ce que l'utilisateur avait déjà réglé. */
function lireConfigCouranteOuDefaut(scope){
  const ids = controlesRecurrenceAjout(scope);
  const dejaRegle = document.getElementById(ids.unite).dataset.initialise === '1';
  if(dejaRegle) return lireControlesRecurrence(ids);
  document.getElementById(ids.unite).dataset.initialise = '1';
  return { unite:'mois', intervalle:1 };
}

/* Bascule générique : quand la case "payé par le compte conjoint" est cochée, on cache le
   sélecteur "Qui" et on montre le champ de répartition en %, et vice-versa. */
/* Une entrée "revenu" n'a pas besoin de catégorie (ce n'est pas une dépense classée) :
   on cache simplement le champ pendant qu'elle est cochée. */
function appliquerAffichageCategoriePourRevenu(checkboxId, categoryFieldId){
  /* Un revenu est toujours classé dans la catégorie "Revenu" : le champ reste visible mais
     grisé, pour que la disposition ne change pas. */
  activerChamp(categoryFieldId, !document.getElementById(checkboxId).checked);
}
document.getElementById('f-est-revenu-conjoint').addEventListener('change', ()=>
  appliquerAffichageCategoriePourRevenu('f-est-revenu-conjoint','f-category-field-conjoint'));
document.getElementById('f-est-revenu-personnel').addEventListener('change', ()=>
  appliquerAffichageCategoriePourRevenu('f-est-revenu-personnel','f-category-field-personnel'));
document.getElementById('edit-est-revenu').addEventListener('change', ()=>
  appliquerAffichageCategoriePourRevenu('edit-est-revenu','edit-category-field'));
document.getElementById('edit-rec-est-revenu').addEventListener('change', ()=>
  appliquerAffichageCategoriePourRevenu('edit-rec-est-revenu','edit-rec-categorie-field'));

/* Génère les options du sélecteur "Qui" : Gabriel/Mélissa, plus "Compte conjoint" si
   `includeCompte` est vrai (pertinent seulement pour les dépenses conjointes). */
/* Options sans teinte : la couleur de fond des <option> est rendue par le système et pas par
   la page, elle ressortait donc différemment d'un navigateur et d'un thème à l'autre — et
   illisible en thème sombre. Les couleurs de personne et de catégorie restent partout où
   elles sont vraiment utiles (pastilles, montants, graphiques). */
function remplirOptionsQui(selectId, includeCompte){
  let html = ['p1','p2'].map(key=>nomsPersonnes[key])
    .map(name=>`<option value="${echapperHTML(name)}">${echapperHTML(name)}</option>`).join('');
  if(includeCompte) html += `<option value="Compte conjoint">Compte conjoint</option>`;
  document.getElementById(selectId).innerHTML = html;
}

/* "Qui" inclut "Compte conjoint" comme un choix parmi les personnes. Le champ de
   répartition (%) est maintenant toujours actif, peu importe qui est sélectionné : même
   une dépense payée par Gabriel ou Mélissa peut être partagée dans une proportion autre que
   50/50. Seul le champ "revenu" (argent qui entre dans le compte) reste réservé au choix
   "Compte conjoint", puisque ce concept ne s'applique qu'à lui. */
function appliquerChoixQuiConjoint(quiSelectId, repartitionInputId, revenuFieldId){
  const estCompte = document.getElementById(quiSelectId).value === 'Compte conjoint';
  if(revenuFieldId){
    const revenuField = document.getElementById(revenuFieldId);
    revenuField.style.display = estCompte ? '' : 'none';
    if(!estCompte){
      const revenuCheckbox = revenuField.querySelector('input[type="checkbox"]');
      if(revenuCheckbox && revenuCheckbox.checked){
        revenuCheckbox.checked = false;
        revenuCheckbox.dispatchEvent(new Event('change'));
      }
    }
  }
  return estCompte;
}
document.getElementById('f-compte-nom-p1-conjoint').textContent = nomsPersonnes.p1;
majLibellesRepartition();
document.getElementById('f-who-conjoint').addEventListener('change', ()=>
  appliquerChoixQuiConjoint('f-who-conjoint','f-compte-repartition-conjoint','f-est-revenu-field-conjoint'));

/* Affiche ou cache le champ "Qui" selon le type actuellement sélectionné dans le modal
   d'édition (le type peut être basculé via le bouton "↔ Rendre..." avant de sauvegarder). */
function appliquerVerrouEditType(type){
  const whoSelect = document.getElementById('edit-who');
  const compteField = document.getElementById('edit-compte-repartition-field');
  const repartitionInput = document.getElementById('edit-compte-repartition');
  const estRevenuField = document.getElementById('edit-est-revenu-field');
  const estRevenuCheckbox = document.getElementById('edit-est-revenu');

  let estCompte = false;
  if(type === 'personnelle'){
    remplirOptionsQui('edit-who', false);
    whoSelect.value = nomsPersonnes[currentUser] || nomsPersonnes.p1;
    activerChamp('edit-who-field', false);
    activerChamp('edit-compte-repartition-field', false);
    activerChamp('edit-est-revenu-field', true);
  } else {
    const valeurActuelle = whoSelect.value;
    remplirOptionsQui('edit-who', true);
    activerChamp('edit-who-field', true);
    if(['Gabriel','Mélissa','Compte conjoint'].includes(valeurActuelle)) whoSelect.value = valeurActuelle;
    estCompte = whoSelect.value === 'Compte conjoint';
    activerChamp('edit-compte-repartition-field', true);
    activerChamp('edit-est-revenu-field', estCompte);
    if(!estCompte) estRevenuCheckbox.checked = false;
  }

  appliquerAffichageCategoriePourRevenu('edit-est-revenu','edit-category-field');
}
document.getElementById('edit-who').addEventListener('change', ()=> appliquerVerrouEditType(editTypeActuel));
document.getElementById('edit-est-revenu').addEventListener('change', ()=> appliquerVerrouEditType(editTypeActuel));

/* Type actuellement sélectionné dans le modal d'édition (peut différer du type d'origine
   de la dépense tant que "Sauvegarder" n'a pas été cliqué). */
let editTypeActuel = 'conjointe';
function mettreAJourBoutonType(){
  const bouton = document.getElementById('edit-toggle-type');
  if(editTypeActuel === 'personnelle'){
    bouton.textContent = '↔ Rendre conjointe';
    bouton.title = 'Sera visible par vous deux';
  } else {
    bouton.textContent = '↔ Rendre personnelle';
    bouton.title = 'Sera privée, juste pour moi';
  }
}
document.getElementById('edit-toggle-type').addEventListener('click', ()=>{
  editTypeActuel = editTypeActuel === 'personnelle' ? 'conjointe' : 'personnelle';
  appliquerVerrouEditType(editTypeActuel);
  mettreAJourBoutonType();
});

/* Mode d'édition en cours pour le formulaire de dépense : 'normal' modifie juste cette
   ligne (comportement historique) ; 'suivantes' déclenche un fractionnement de la série au
   moment de la sauvegarde (voir diviserRecurrenceAPartirDe). */
let modeEditionDepense = 'normal';

/* ===================== PONCTUELLE → RÉCURRENTE =====================
   Une dépense ponctuelle vit dans `Depenses`, une série dans `Recurrences` — et les
   occurrences d'une série ne sont jamais stockées, elles sont calculées à partir de la
   règle. Convertir revient donc à un simple échange : on crée la règle à partir des valeurs
   de la dépense, puis on supprime la ligne d'origine.

   La bascule « Se répète » du formulaire d'édition (même mécanique que dans les formulaires
   d'ajout) déplie directement les réglages de fréquence : plus besoin d'un bouton séparé
   « Rendre récurrente » qui ouvrait ensuite une deuxième fenêtre pour choisir la fréquence. */
const CONTROLES_RECURRENCE_NOUVELLE = {
  intervalle:'edit-nouv-rec-intervalle', unite:'edit-nouv-rec-unite',
  jours:'edit-nouv-rec-jours', joursField:'edit-nouv-rec-jours-field',
  typeMensuel:'edit-nouv-rec-type-mensuel', mensuelField:'edit-nouv-rec-mensuel-field',
  dates:'edit-nouv-rec-dates', datesField:'edit-nouv-rec-dates-field', finType:'edit-nouv-fin-type',
  date:'edit-date'
};
brancherControlesRecurrence(CONTROLES_RECURRENCE_NOUVELLE);

function appliquerAffichageRepetitionEdit(actif){
  if(actif){
    const conteneurJours = document.getElementById(CONTROLES_RECURRENCE_NOUVELLE.jours);
    const choixAnterieur = conteneurJours ? conteneurJours.dataset.choisiParUtilisateur : '0';
    remplirControlesRecurrence(CONTROLES_RECURRENCE_NOUVELLE, { unite:'mois', intervalle:1 });
    if(conteneurJours) conteneurJours.dataset.choisiParUtilisateur = choixAnterieur || '0';
  }
  document.querySelectorAll('#edit-modal .bloc-recurrence-edit').forEach(el=>{ el.style.display = actif ? '' : 'none'; });
  document.getElementById('edit-date-label').textContent = actif ? 'À partir de' : 'Date';
  if(actif){
    appliquerAffichageRecurrence(CONTROLES_RECURRENCE_NOUVELLE);
    appliquerAffichageFinRecurrence('edit-nouv-fin-type','edit-nouv-fin-nombre-field','edit-nouv-fin-date-field');
  }
}
document.getElementById('edit-repete-toggle').addEventListener('change', function(){
  appliquerAffichageRepetitionEdit(this.checked);
});
document.getElementById('edit-nouv-fin-type').addEventListener('change', ()=>
  appliquerAffichageFinRecurrence('edit-nouv-fin-type','edit-nouv-fin-nombre-field','edit-nouv-fin-date-field'));

function ouvrirEdition(id, mode){
  const depense=depenses.find(e=>e.id===id); if(!depense) return;
  modeEditionDepense = mode || 'normal';
  depenseEnEdition=depense;
  document.getElementById('edit-amount').value=depense.amount;
  remplirOptionsQui('edit-who', depense.type !== 'personnelle');
  document.getElementById('edit-who').value = depense.estCompte ? 'Compte conjoint' : libellePersonne(depense.who==='compte' ? currentUser : depense.who);
  document.getElementById('edit-date').value=depense.date;
  activerChamp('edit-date-field', modeEditionDepense !== 'suivantes', 'edit-date');
  document.getElementById('edit-date').disabled = modeEditionDepense === 'suivantes';
  document.getElementById('edit-note').value=depense.note;
  document.getElementById('edit-category').innerHTML=categories.map(c=>`<option>${echapperHTML(c)}</option>`).join('');
  document.getElementById('edit-category').value=depense.category;
  document.getElementById('edit-compte-nom-p1').textContent = nomsPersonnes.p1;
  document.getElementById('edit-compte-repartition').value = depense.pourcentageP1 != null ? depense.pourcentageP1 : 50;
  document.getElementById('edit-est-revenu').checked = !!depense.estRevenu;

  /* Champs de contexte de la série : toujours présents pour que la disposition soit
     identique à celle de la fenêtre "paiement récurrent", mais en lecture seule ici —
     on modifie une occurrence, pas la règle de répétition. */
  const rec = depense.recurrenceId ? recurrences.find(r=>r.id===depense.recurrenceId) : null;
  const selRepetition = document.getElementById('edit-repetition');
  const selFinType = document.getElementById('edit-fin-type');
  const inputFinNombre = document.getElementById('edit-fin-nombre');
  const inputFinDate = document.getElementById('edit-fin-date');
  /* « Se répète » n'a de sens à activer que pour une dépense qui n'appartient à aucune
     série : une occurrence en fait déjà partie, et sa règle se modifie depuis l'éditeur de
     série. Pour elle, on garde l'affichage en lecture seule de sa règle ; pour une dépense
     ponctuelle, on montre plutôt la bascule qui permet de la transformer en série. */
  const peutDevenirRecurrente = !rec && !depense.virtuelle;
  if(rec){
    selRepetition.innerHTML = `<option>${libelleRecurrence(rec)}</option>`;
    const libellesFin = { jamais:'Jamais', nombre:'Après un nombre de paiements', date:'À une date précise' };
    selFinType.innerHTML = `<option>${libellesFin[rec.finType] || 'Jamais'}</option>`;
    inputFinNombre.value = rec.finType==='nombre' && rec.finNombre != null ? String(rec.finNombre) : '';
    inputFinDate.value = rec.finType==='date' && rec.finDate
      ? dateLocaleDepuisISO(rec.finDate).toLocaleDateString('fr-CA',{day:'numeric',month:'long',year:'numeric'}) : '';
  } else {
    selRepetition.innerHTML = '<option>Ne se répète pas</option>';
    selFinType.innerHTML = '<option>—</option>';
    inputFinNombre.value = '';
    inputFinDate.value = '';
  }
  activerChamp('edit-repetition-field', false);
  activerChamp('edit-fin-type-field', false);
  activerChamp('edit-fin-nombre-field', false);
  activerChamp('edit-fin-date-field', false);
  ['edit-repetition-field','edit-fin-type-field','edit-fin-nombre-field','edit-fin-date-field'].forEach(id=>{
    document.getElementById(id).style.display = peutDevenirRecurrente ? 'none' : '';
  });
  document.getElementById('edit-repete-toggle-field').style.display = peutDevenirRecurrente ? '' : 'none';
  document.getElementById('edit-repete-toggle').checked = false;
  appliquerAffichageRepetitionEdit(false);

  editTypeActuel = depense.type==='personnelle' ? 'personnelle' : 'conjointe';
  appliquerVerrouEditType(editTypeActuel);
  mettreAJourBoutonType();
  /* Une occurrence de série ne peut pas basculer conjointe/personnelle toute seule :
     ça se change sur la série entière. */
  activerChamp('edit-toggle-type-field', !depense.virtuelle, 'edit-toggle-type');

  document.getElementById('edit-modal-titre').firstChild.textContent = modeEditionDepense === 'suivantes'
    ? 'Modifier cette dépense et les suivantes'
    : (rec ? 'Modifier une occurrence' : 'Modifier une dépense');
  document.getElementById('edit-modal-sous-titre').textContent = rec
    ? `Série récurrente · ${libelleRecurrence(rec)}`
    : 'Dépense ponctuelle';
  document.getElementById('edit-modal').style.display='flex';
  majLibellesRepartition();
}
document.getElementById('close-edit').addEventListener('click',()=>{document.getElementById('edit-modal').style.display='none'; modeEditionDepense='normal'; document.getElementById('edit-date').disabled=false;});
document.getElementById('delete-edit').addEventListener('click', actionVerrouillee(document.getElementById('delete-edit'), async()=>{if(depenseEnEdition && confirm('Supprimer cette dépense ?')){document.getElementById('edit-modal').style.display='none';await supprimerDepense(depenseEnEdition.id);}}));
document.getElementById('save-edit').addEventListener('click', actionVerrouillee(document.getElementById('save-edit'), async()=>{
  const amount=parseFloat(document.getElementById('edit-amount').value),date=document.getElementById('edit-date').value;
  if(!depenseEnEdition||!amount||amount<=0||!date){afficherAlerte('Merci d’entrer un montant et une date valides.');return;}
  const type=editTypeActuel==='personnelle'?'personnelle':'conjointe';
  const estCompte = type==='conjointe' && document.getElementById('edit-who').value === 'Compte conjoint';
  const estRevenu = (type==='personnelle' || estCompte) && document.getElementById('edit-est-revenu').checked;
  const pourcentageP1 = type==='conjointe' ? Number(document.getElementById('edit-compte-repartition').value) : null;
  const who = estCompte ? 'compte' : clePersonne(document.getElementById('edit-who').value);
  const categorieFinale = estRevenu ? 'Revenu' : document.getElementById('edit-category').value;
  const noteFinale = document.getElementById('edit-note').value.trim();
  const nouvellesValeurs = { amount, date, category: categorieFinale, note: noteFinale, who, estCompte, estRevenu, pourcentageP1 };

  const fermer = ()=>{
    modeEditionDepense = 'normal';
    document.getElementById('edit-date').disabled = false;
    document.getElementById('edit-modal').style.display='none';
  };

  /* Occurrence d'une récurrence : selon la portée choisie, on fractionne la série
     ("les suivantes") ou on enregistre une exception pour cette seule date. Aucune ligne
     n'est écrite dans Depenses : les occurrences sont calculées à l'affichage. */
  if(depenseEnEdition.virtuelle){
    if(modeEditionDepense === 'suivantes'){
      await diviserRecurrenceAPartirDe(depenseEnEdition, nouvellesValeurs);
    } else if(!(await modifierOccurrenceSeule(depenseEnEdition, nouvellesValeurs))){
      return; /* échec signalé : la fenêtre reste ouverte avec la saisie */
    }
    fermer();
    if(depenseEnEdition.type==='conjointe') notifierActivitePartenaire('modification', `${categorieFinale} — ${formaterMonnaie(amount)}`);
    return;
  }

  /* Dépense ponctuelle sur laquelle « Se répète » vient d'être activé : conversion en série
     plutôt que mise à jour simple (voir la section PONCTUELLE → RÉCURRENTE plus haut). */
  if(document.getElementById('edit-repete-toggle-field').style.display !== 'none'
     && document.getElementById('edit-repete-toggle').checked){
    const cfg = lireControlesRecurrence(CONTROLES_RECURRENCE_NOUVELLE);
    const finType = document.getElementById('edit-nouv-fin-type').value;
    const finNombreRaw = document.getElementById('edit-nouv-fin-nombre').value;
    const finNombre = finType==='nombre' ? (parseInt(finNombreRaw,10) || null) : null;
    const finDateRaw = document.getElementById('edit-nouv-fin-date').value;
    const finDate = finType==='date' ? (finDateRaw || null) : null;
    if(finType==='nombre' && !finNombre){ afficherAlerte("Merci d'entrer un nombre de paiements valide."); return; }
    if(finType==='date' && !finDate){ afficherAlerte("Merci d'entrer une date de fin."); return; }

    const idCree = await creerRecurrenceDepuisValeurs({
      type, nom: noteFinale, montant: amount, categorie: categorieFinale,
      unite: cfg.unite, intervalle: cfg.intervalle, joursSemaine: cfg.joursSemaine, typeMensuel: cfg.typeMensuel,
      dateDebut: date, finType, finNombre, finDate, who, estCompte, estRevenu, pourcentageP1
    });
    /* Série non créée : on ne touche surtout pas à la dépense d'origine (elle était
       supprimée quand même avant, et donc perdue). */
    if(!idCree) return;

    /* La dépense d'origine disparaît : elle est désormais la première occurrence de la série. */
    const { error: erreurSuppression } = await ecritureVerifiee(supabaseClient.from('Depenses').delete().eq('id', depenseEnEdition.id));
    if(erreurSuppression){
      afficherAlerte("La série a été créée, mais la dépense d'origine n'a pas pu être supprimée : elle risque d'apparaître en double.");
    } else {
      depensesReelles = depensesReelles.filter(e => e.id !== depenseEnEdition.id);
    }
    depenseEnEdition = null;
    recalculerDepenses();
    fermer();
    rafraichirActif();
    if(type==='conjointe') notifierActivitePartenaire('modification', `${categorieFinale} — ${formaterMonnaie(amount)}`);
    return;
  }

  /* Dépense ponctuelle ordinaire : mise à jour directe de sa ligne. */
  const update={
    Qui:nomPersonneSupabase(who),
    Montant:amount,
    Date:date,
    Categorie: categorieFinale,
    Note:noteFinale,
    Type:type,
    EstCompte: estCompte,
    EstRevenu: estRevenu,
    PourcentageP1: pourcentageP1,
    user_id: type === 'personnelle' ? (currentSession?.user?.id || null) : null
  };
  const resultat = await ecritureVerifiee(supabaseClient.from('Depenses').update(update).eq('id',depenseEnEdition.id));
  if(!resultat.ok){
    console.warn("Mise à jour avec EstCompte/EstRevenu/PourcentageP1 impossible, nouvel essai sans ces colonnes.", resultat.error);
    const { EstCompte, EstRevenu, PourcentageP1, ...sansColonnesRecentes } = update;
    const retry = await ecritureVerifiee(supabaseClient.from('Depenses').update(sansColonnesRecentes).eq('id',depenseEnEdition.id));
    if(!retry.ok){ signalerEchecEnregistrement("La modification de la dépense", retry.error); return; }
  }
  /* On met à jour la dépense réelle elle-même (et non une copie qui aurait pu être
     remplacée par un rechargement entre-temps). */
  const reelle = depensesReelles.find(e => e.id === depenseEnEdition.id) || depenseEnEdition;
  Object.assign(reelle,{who,amount,date,category:update.Categorie,note:update.Note,type:update.Type,estCompte,estRevenu,pourcentageP1});
  recalculerDepenses();
  fermer();
  rafraichirActif();
  if(type==='conjointe') notifierActivitePartenaire('modification', `${categorieFinale} — ${formaterMonnaie(amount)}`);
}));

document.getElementById('dark-mode').addEventListener('change',e=>{localStorage.setItem('depenses_theme',e.target.checked?'dark':'light');appliquerTheme();});

/* ===================== NOTIFICATIONS : DÉPÔT AU COMPTE CONJOINT =====================
   Une notification push (Web Push) annonce le montant à déposer au compte conjoint, un
   certain nombre de jours avant/après/le jour même de la paie, à l'heure choisie. Elle
   fonctionne même app fermée : une tâche planifiée côté Supabase (pg_cron) envoie les push
   au bon moment, en lisant un échéancier précalculé par le client (voir
   synchroniserEcheancierNotifications ci-dessous) — aucune logique de calcul n'est
   dupliquée côté serveur, seul le résultat déjà affiché dans "Prochains dépôts" y est copié. */
const VAPID_PUBLIC_KEY = 'BHYNfW_M1gKqwjCNnYiV4OuXI8Un2Bhi2475P_0UuZmZHDpYFVYRrAU7ApiE600O8_3S2RUrzLTFI3rIYVmk4JI';

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c=>c.charCodeAt(0)));
}

/* Copie l'échéancier (déjà calculé pour l'affichage "Prochains dépôts") dans une table
   partagée, pour que la fonction planifiée n'ait qu'à le lire — jamais à le recalculer.
   On évite les écritures redondantes en ne renvoyant que si le contenu a changé depuis la
   dernière synchronisation. */
let dernierSignatureEcheancierSync = null;
async function synchroniserEcheancierNotifications(echeancierComplet){
  if(!currentSession || !echeancierComplet) return;
  const lignes = echeancierComplet.map(l=>({
    iso: l.iso,
    montant_p1: Math.round(l.p1*100)/100,
    montant_p2: Math.round(l.p2*100)/100
  }));
  const signature = JSON.stringify(lignes);
  if(signature === dernierSignatureEcheancierSync) return;
  dernierSignatureEcheancierSync = signature;
  /* Les dates qui n'ont plus de dépôt à confirmer (confirmé, déplacé, supprimé) sont remises
     à 0 : la table ne permet pas de supprimer, et la fonction ignore les montants nuls. */
  const { data: existantes, error: erreurLecture } = await supabaseClient.from('depots_echeancier').select('iso,montant_p1,montant_p2');
  if(erreurLecture){ dernierSignatureEcheancierSync = null; return; }
  const vues = new Set(lignes.map(l => l.iso));
  (existantes || []).forEach(e => {
    const iso = String(e.iso).slice(0, 10);
    if(!vues.has(iso) && (Number(e.montant_p1) || Number(e.montant_p2))) lignes.push({ iso, montant_p1: 0, montant_p2: 0 });
  });
  if(!lignes.length) return;
  const { error } = await supabaseClient.from('depots_echeancier').upsert(
    lignes.map(l=>({ ...l, updated_at: new Date().toISOString() }))
  );
  if(error){
    dernierSignatureEcheancierSync = null; /* on réessaiera au prochain calcul */
    console.warn("Impossible de synchroniser l'échéancier pour les notifications.", error);
  }
}

/* Traduit le formulaire (Quand / Nombre de jours) en un seul entier signé, tel qu'attendu
   par la fonction planifiée : négatif = avant la paie, positif = après, 0 = le jour même. */
function lireJoursOffsetFormulaireNotif(){
  const quand = document.getElementById('notif-quand').value;
  const jours = Math.max(1, parseInt(document.getElementById('notif-jours').value,10) || 1);
  if(quand === 'avant') return -jours;
  if(quand === 'apres') return jours;
  return 0;
}
function ecrireJoursOffsetFormulaireNotif(joursOffset){
  const quand = joursOffset < 0 ? 'avant' : (joursOffset > 0 ? 'apres' : 'le-jour');
  document.getElementById('notif-quand').value = quand;
  document.getElementById('notif-jours').value = Math.abs(joursOffset) || 1;
  document.getElementById('notif-jours-field').style.display = quand === 'le-jour' ? 'none' : '';
}

/* Sélecteur d'heure maison, deux listes déroulantes, plutôt qu'un <input type="time"> : la
   boîte de dialogue « horloge » d'Android se dessinait de travers, ses boutons finissant
   hors de l'écran, et elle est rendue par le système — aucun CSS ne peut la replacer. Deux
   <select> s'ouvrent en feuille native, toujours bien positionnée, et produisent exactement
   la même valeur "HH:MM" que le champ d'avant. Rien à changer en base. */
(function peuplerSelecteurHeure(){
  const selH = document.getElementById('notif-heure-h');
  const selM = document.getElementById('notif-heure-m');
  if(!selH || !selM) return;
  let h = '', m = '';
  for(let i=0; i<24; i++){ const v = String(i).padStart(2,'0'); h += `<option value="${v}">${v}</option>`; }
  for(let i=0; i<60; i+=5){ const v = String(i).padStart(2,'0'); m += `<option value="${v}">${v}</option>`; }
  selH.innerHTML = h;
  selM.innerHTML = m;
})();

function lireHeureNotif(){
  const h = document.getElementById('notif-heure-h').value || '08';
  const m = document.getElementById('notif-heure-m').value || '00';
  return `${h}:${m}`;
}

function ecrireHeureNotif(valeur){
  const [hh, mm] = String(valeur || '08:00').split(':').map(n => parseInt(n, 10));
  /* Les minutes vont de 5 en 5. Une valeur enregistrée hors de ces crans (héritée de l'ancien
     champ horloge, qui permettait la minute près) est ramenée au cran le plus proche : sans
     ça le <select> resterait sur sa première option et l'heure changerait toute seule au
     prochain enregistrement. */
  const m = Math.min(55, Math.round((Number.isFinite(mm) ? mm : 0) / 5) * 5);
  document.getElementById('notif-heure-h').value = String(Number.isFinite(hh) ? hh : 8).padStart(2,'0');
  document.getElementById('notif-heure-m').value = String(m).padStart(2,'0');
}

async function chargerPreferencesNotification(){
  if(!currentSession) return;
  const { data, error } = await supabaseClient.from('notification_prefs').select('*').eq('user_id', currentSession.user.id).maybeSingle();
  if(error){ console.warn("Impossible de charger les préférences de notification.", error); return; }
  document.getElementById('notif-toggle').checked = !!(data && data.enabled);
  ecrireJoursOffsetFormulaireNotif(data ? data.jours_offset : 0);
  ecrireHeureNotif(data ? data.heure : '08:00');
  document.getElementById('notif-reglages').style.display = (data && data.enabled) ? '' : 'none';
  document.getElementById('notif-activite-toggle').checked = !!(data && data.notif_activite);
}

/* Correspondance auth user -> personne (p1/p2), pour que la fonction serveur sache qui est
   "l'autre" quand elle notifie un ajout/modification de dépense conjointe. */
async function enregistrerPersonneUtilisateur(){
  if(!currentSession || !currentUser) return;
  const { error } = await supabaseClient.from('personnes_utilisateurs').upsert({
    user_id: currentSession.user.id, personne: currentUser, updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if(error) console.warn("Impossible d'enregistrer la correspondance utilisateur.", error);
}

/* Prévient le partenaire (jamais soi-même) qu'une dépense conjointe vient d'être ajoutée ou
   modifiée. Volontairement non bloquant : un échec ici ne doit jamais empêcher l'enregistrement
   de la dépense elle-même. */
function notifierActivitePartenaire(action, description){
  if(!currentSession) return;
  supabaseClient.functions.invoke('notify-partner-activity', { body: { action, description } })
    .catch(err => console.warn("Notification d'activité au partenaire non envoyée.", err));
}

function afficherStatutNotif(message, estErreur){
  const el = document.getElementById('notif-statut');
  el.textContent = message || '';
  el.style.color = estErreur ? 'var(--red)' : 'var(--text-secondary)';
}

async function enregistrerAbonnementPush(){
  if(!('serviceWorker' in navigator) || !('PushManager' in window)){
    afficherStatutNotif("Ce navigateur ne prend pas en charge les notifications.", true);
    return false;
  }
  let sub;
  try{
    const permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      afficherStatutNotif("Permission refusée : autorise les notifications pour ce site dans ton navigateur.", true);
      return false;
    }
    const registration = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if(!subscription){
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    sub = subscription.toJSON();
  } catch(err){
    /* Ex. sur iPhone, l'app doit d'abord être ajoutée à l'écran d'accueil. Avant, l'erreur
       n'était pas attrapée : la bascule restait activée sans rien afficher. */
    console.error(err);
    afficherStatutNotif("Impossible d'activer les notifications sur cet appareil. Sur iPhone, ajoute d'abord l'app à l'écran d'accueil.", true);
    return false;
  }
  const { error } = await supabaseClient.from('push_subscriptions').upsert({
    user_id: currentSession.user.id,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth
  }, { onConflict: 'endpoint' });
  if(error){
    afficherStatutNotif("Erreur lors de l'enregistrement de l'abonnement.", true);
    console.error(error);
    return false;
  }
  return true;
}

/* Un upsert PostgREST remplace la ligne entière : toute colonne omise retombe à son défaut.
   Les deux réglages (dépôt et activité) vivant dans la même ligne, chaque écriture doit
   renvoyer l'état complet du formulaire, sinon activer l'un éteint silencieusement l'autre. */
function lirePreferencesNotificationCompletes(){
  return {
    user_id: currentSession.user.id,
    personne: currentUser,
    enabled: document.getElementById('notif-toggle').checked,
    jours_offset: lireJoursOffsetFormulaireNotif(),
    heure: lireHeureNotif(),
    notif_activite: document.getElementById('notif-activite-toggle').checked,
    updated_at: new Date().toISOString()
  };
}

async function sauvegarderPreferencesNotification(enabled){
  const prefs = { ...lirePreferencesNotificationCompletes(), enabled };
  const { error } = await supabaseClient.from('notification_prefs').upsert(prefs, { onConflict: 'user_id' });
  if(error){
    afficherStatutNotif("Erreur lors de l'enregistrement des préférences.", true);
    console.error(error);
    return false;
  }
  return true;
}

document.getElementById('notif-toggle').addEventListener('change', async function(){
  const actif = this.checked;
  document.getElementById('notif-reglages').style.display = actif ? '' : 'none';
  afficherStatutNotif('');
  if(actif){
    const ok = await enregistrerAbonnementPush();
    if(!ok){ this.checked = false; document.getElementById('notif-reglages').style.display = 'none'; return; }
  }
  const ok = await sauvegarderPreferencesNotification(actif);
  if(ok && actif) afficherStatutNotif("Notifications activées.");
});
document.getElementById('notif-quand').addEventListener('change', function(){
  document.getElementById('notif-jours-field').style.display = this.value === 'le-jour' ? 'none' : '';
  if(document.getElementById('notif-toggle').checked) sauvegarderPreferencesNotification(true);
});
document.getElementById('notif-jours').addEventListener('change', ()=>{
  if(document.getElementById('notif-toggle').checked) sauvegarderPreferencesNotification(true);
});
['notif-heure-h','notif-heure-m'].forEach(id => document.getElementById(id).addEventListener('change', ()=>{
  if(document.getElementById('notif-toggle').checked) sauvegarderPreferencesNotification(true);
}));

function afficherStatutNotifActivite(message, estErreur){
  const el = document.getElementById('notif-activite-statut');
  el.textContent = message || '';
  el.style.color = estErreur ? 'var(--red)' : 'var(--text-secondary)';
}
document.getElementById('notif-activite-toggle').addEventListener('change', async function(){
  const actif = this.checked;
  afficherStatutNotifActivite('');
  if(actif){
    const ok = await enregistrerAbonnementPush();
    if(!ok){ this.checked = false; return; }
  }
  const { error } = await supabaseClient.from('notification_prefs').upsert({
    ...lirePreferencesNotificationCompletes(), notif_activite: actif
  }, { onConflict: 'user_id' });
  if(error){
    afficherStatutNotifActivite("Erreur lors de l'enregistrement.", true);
    console.error(error);
    return;
  }
  if(actif) afficherStatutNotifActivite("Notifications d'activité activées.");
});

/* Suppression d'une dépense */
async function supprimerDepense(id){
  /* Une occurrence de récurrence n'existe pas en base : sa "suppression" passe par une
     exception (voir supprimerOccurrenceSeule), jamais par un DELETE. */
  const occurrence = depenses.find(e => e.id === id);
  if(occurrence && occurrence.virtuelle){ await supprimerOccurrenceSeule(occurrence); return; }

  const res = await ecritureVerifiee(supabaseClient.from('Depenses').delete().eq('id', id));
  if(!res.ok){
    signalerEchecEnregistrement("La suppression de la dépense", res.error);
    return;
  }
  depensesReelles = depensesReelles.filter(e=>e.id!==id);
  await libererDepotConfirme(id);
  recalculerDepenses();
  rafraichirActif();
}

document.getElementById('save-budgets-personnel').addEventListener('click', ()=>sauvegarderBudget('personnel'));
document.getElementById('save-budgets-conjoint').addEventListener('click', ()=>sauvegarderBudget('conjoint'));

/* ===================== RENDU : SOUS-ONGLET MOIS (par section) ===================== */
/* Calcule, du point de vue de la personne connectée, combien elle doit encore payer
   (ou a payé en trop) pour arriver à égalité avec l'autre sur les dépenses conjointes. */
function carteEcartEqualisation(paidP1, paidP2, dueP1, dueP2){
  const moiPaye = currentUser==='p2' ? paidP2 : paidP1;
  const moiDu = currentUser==='p2' ? dueP2 : dueP1;
  const autreCle = currentUser==='p2' ? 'p1' : 'p2';
  const ecart = moiDu - moiPaye; /* positif = je dois payer plus ; négatif = j'ai payé en trop */
  if(Math.abs(ecart) < 0.005){
    return `<div class="label">Équilibré<span class="mobile-line"> avec ${nomsPersonnes[autreCle]}</span></div><div class="value">${formaterMonnaie(0)}</div>`;
  }
  if(ecart > 0){
    return `<div class="label">Reste à payer<span class="mobile-line"> pour être égal</span></div><div class="value" style="color:var(--red)">${formaterMonnaie(ecart)}</div>`;
  }
  return `<div class="label">Payé en trop<span class="mobile-line"> (à récupérer)</span></div><div class="value" style="color:var(--green)">${formaterMonnaie(Math.abs(ecart))}</div>`;
}

/* ===================== RÉSUMÉ UNIFIÉ (mêmes tableaux peu importe la période) =====================
   Un seul jeu de "tableaux" (3 cartes de stats + graphique d'évolution + répartition par
   catégorie) s'affiche pour Jour/Semaine/Paie/Mois/Année — seules les VALEURS à l'intérieur
   changent, calculées pour la période actuellement sélectionnée (etatCalendrierPeriode). */
function afficherResumeUnifie(scope){
  const vue = etatCalendrierPeriode.vue;
  const { debut, fin } = bornePeriode(vue, etatCalendrierPeriode.dateRef);
  const debutStr = formaterDateISO(debut), finStr = formaterDateISO(fin);
  const dansPeriode = e => e.date >= debutStr && e.date <= finStr;

  const liste = depenses.filter(e =>
    (scope==='conjoint' ? e.type==='conjointe' : (e.type==='personnelle' && e.who===currentUser)) &&
    !e.estRevenu && dansPeriode(e)
  );
  const total = liste.reduce((s,e)=>s+e.amount,0);
  const el = document.getElementById(`mois-stats-${scope}`);

  /* La comparaison à un budget ne fait sens qu'au mois (les budgets sont mensuels) : pour
     les autres périodes, la 3e carte affiche autre chose de pertinent à cette échelle. */
  if(scope==='conjoint'){
    /* L'équilibrage « payé par moi / reste à payer » ne concerne que l'argent sorti de la
       poche de Gabriel ou Mélissa : une dépense payée par le compte conjoint n'est due par
       personne en particulier (même si elle est attribuée à 100% à l'un des deux dans le
       partage des %), donc elle est exclue de ce calcul. */
    const listeHorsCompte = liste.filter(e=>!e.estCompte);
    const t1 = listeHorsCompte.filter(e=>e.who==='p1').reduce((s,e)=>s+e.amount,0);
    const t2 = listeHorsCompte.filter(e=>e.who==='p2').reduce((s,e)=>s+e.amount,0);
    const totalHorsCompte = t1 + t2;
    const dueP1 = listeHorsCompte.reduce((s,e)=>s + e.amount * ((e.pourcentageP1 != null ? e.pourcentageP1 : 50) / 100), 0);
    const dueP2 = totalHorsCompte - dueP1;
    const moi = currentUser==='p2' ? t2 : t1;
    let troisiemeCarte;
    if(vue==='mois'){
      const budgetTotal = budgetTotalCalcule('conjoint', periodeActive());
      const ecartBudget = total - budgetTotal;
      troisiemeCarte = `<div class="stat-card">
        <div class="label">Total<span class="mobile-line"> conjoint</span></div>
        <div class="value">${formaterMonnaie(total)}</div>
        ${budgetTotal > 0 ? `<div style="font-size:11px;margin-top:4px;color:${ecartBudget>0?'var(--red)':'var(--green)'}">${ecartBudget>0?'+':''}${formaterMonnaie(ecartBudget)} vs budget</div>` : ''}
      </div>`;
    } else {
      troisiemeCarte = `<div class="stat-card"><div class="label">Total<span class="mobile-line"> conjoint</span></div><div class="value">${formaterMonnaie(total)}</div></div>`;
    }
    el.innerHTML = `
      <div class="stat-card"><div class="label">Payé par<span class="mobile-line"> moi</span></div><div class="value ${currentUser}">${formaterMonnaie(moi)}</div></div>
      ${troisiemeCarte}
      <div class="stat-card">${carteEcartEqualisation(t1, t2, dueP1, dueP2)}</div>
    `;
  } else {
    /* Même filtre que totalConjointPourInclusion() : les revenus conjoints sont exclus du
       total, ils doivent donc l'être aussi du compteur — sinon la "Dépense moyenne"
       (total / nombre) est faussée. */
    const nbConjoint = inclureConjointDansPersonnel ? depenses.filter(e=>e.type==='conjointe' && !e.estRevenu && dansPeriode(e)).length : 0;
    const nb = liste.length + nbConjoint;
    const totalAffiche = total + totalConjointPourInclusion(dansPeriode);
    let troisiemeCarte;
    if(vue==='mois'){
      const budgetTotal = budgetTotalCalcule(currentUser, periodeActive());
      const restant = budgetTotal - total;
      troisiemeCarte = `<div class="stat-card"><div class="label">Restant<span class="mobile-line"> à dépenser</span></div><div class="value" style="color:${budgetTotal>0 ? (restant<0?'var(--red)':'var(--green)') : 'inherit'}">${budgetTotal>0 ? formaterMonnaie(restant) : '—'}</div></div>`;
    } else {
      troisiemeCarte = `<div class="stat-card"><div class="label">Dépense<span class="mobile-line"> moyenne</span></div><div class="value">${formaterMonnaie(nb ? totalAffiche/nb : 0)}</div></div>`;
    }
    el.innerHTML = `
      <div class="stat-card"><div class="label">Total<span class="mobile-line"> ${inclureConjointDansPersonnel ? '(+ conjoint)' : 'personnel'}</span></div><div class="value ${currentUser}">${formaterMonnaie(totalAffiche)}</div></div>
      <div class="stat-card"><div class="label">Nombre<span class="mobile-line"> de dépenses</span></div><div class="value">${nb}</div></div>
      ${troisiemeCarte}
    `;
  }

  /* Évolution : toujours regroupée par jour, sur toute la période sélectionnée (1 jour pour
     "Jour", jusqu'à ~365 pour "Année") — même graphique partout, l'étendue s'adapte. */
  const nbJours = Math.round((fin - debut) / 86400000) + 1;
  const ctx = document.getElementById(`chart-evolution-${scope}`);
  detruireGraphique(`evolution-${scope}`);
  const labels = [];
  { let c = new Date(debut); for(let i=0;i<nbJours;i++){ labels.push(c.getDate()); c = ajouterJours(c,1); } }
  let datasets;
  if(scope==='conjoint'){
    const cum1 = new Array(nbJours).fill(0), cum2 = new Array(nbJours).fill(0);
    liste.forEach(e=>{
      const idx = Math.round((dateLocaleDepuisISO(e.date) - debut) / 86400000);
      if(idx>=0 && idx<nbJours){ if(e.who==='p1') cum1[idx]+=e.amount; else if(e.who==='p2') cum2[idx]+=e.amount; }
    });
    for(let i=1;i<nbJours;i++){ cum1[i]+=cum1[i-1]; cum2[i]+=cum2[i-1]; }
    datasets = [
      { label:nomsPersonnes.p1, data:cum1, borderColor:couleursPersonnes.p1, backgroundColor:couleursPersonnes.p1+'18', fill:true, tension:.3, pointRadius:0, borderWidth:2.5 },
      { label:nomsPersonnes.p2, data:cum2, borderColor:couleursPersonnes.p2, backgroundColor:couleursPersonnes.p2+'18', fill:true, tension:.3, pointRadius:0, borderWidth:2.5 }
    ];
  } else {
    const cum = new Array(nbJours).fill(0);
    liste.forEach(e=>{ const idx = Math.round((dateLocaleDepuisISO(e.date) - debut) / 86400000); if(idx>=0 && idx<nbJours) cum[idx]+=e.amount; });
    for(let i=1;i<nbJours;i++) cum[i]+=cum[i-1];
    const couleur = couleursPersonnes[currentUser] || couleursPersonnes.p1;
    datasets = [{ label:nomsPersonnes[currentUser] || nomsPersonnes.p1, data:cum, borderColor:couleur, backgroundColor:couleur+'18', fill:true, tension:.3, pointRadius:0, borderWidth:2.5 }];
  }
  charts[`evolution-${scope}`] = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index', intersect:false},
      plugins:{ legend:{position:'bottom', labels:{boxWidth:10, font:{family:'Roboto', size:12}}} },
      scales:{
        x:{ title:{display:true,text:'Jour'}, grid:{display:false} },
        y:{ ticks:{callback:v=>formaterMonnaie(v)}, grid:{color:'#eef0f3'} }
      }
    }
  });

  /* Répartition par catégorie, pour la même période. */
  const parCat = {};
  liste.forEach(e=> parCat[e.category] = (parCat[e.category]||0) + e.amount);
  if(scope==='personnel'){
    const parCatConjoint = parCategorieConjointPourInclusion(dansPeriode);
    Object.entries(parCatConjoint).forEach(([cat,montant])=>{ parCat[cat] = (parCat[cat]||0) + montant; });
  }
  const labelsCat = Object.keys(parCat);
  const dataCat = Object.values(parCat);
  const colorsCat = labelsCat.map(l=>COULEURS_CATEGORIES[l]||'#9aa0a6');
  const ctxC = document.getElementById(`chart-categories-mois-${scope}`);
  detruireGraphique(`categories-mois-${scope}`);
  charts[`categories-mois-${scope}`] = new Chart(ctxC, {
    type:'doughnut',
    data:{ labels:labelsCat, datasets:[{ data:dataCat, backgroundColor:colorsCat, borderWidth:0, borderColor:'transparent' }] },
    options:{
      responsive:true, maintainAspectRatio:false,
      cutout:'62%',
      plugins:{ legend:{position:'bottom', labels:{boxWidth:10, font:{family:'Roboto', size:12}}},
        tooltip:{ callbacks:{ label:(c)=> `${c.label}: ${formaterMonnaie(c.raw)}` } } }
    }
  });
}


function afficherSectionBudget(scope){
  const cfg = configSection(scope);
  const periode = periodeActive();
  const { vue, dateRef } = etatCalendrierPeriode;
  const { debut, fin } = bornePeriode(vue, dateRef);
  const libellePeriodeCourte = libellePeriodeCalendrier(vue, debut, fin);
  const periodeLabelEl = document.getElementById(`periode-label-${scope}`);
  /* Le budget édité est toujours celui de `periode` (= moisActif) : on affiche ce mois-là,
     pas celui où commence la période, pour qu'une période de paie à cheval sur deux mois
     n'affiche jamais une étiquette qui contredit le budget réellement modifié. */
  if(periodeLabelEl) periodeLabelEl.textContent = `${NOMS_MOIS[moisActif.month]} ${moisActif.year}`;

  /* L'édition des montants-cibles (le budget mensuel lui-même) n'est possible qu'en vue
     "Paie" — dans les autres vues, on ne fait que consulter la comparaison budget/réel
     pour la période choisie. */
  const carteEditionEl = document.getElementById(`budget-edit-card-${scope}`);
  if(carteEditionEl) carteEditionEl.style.display = vue === 'paie' ? '' : 'none';

  const listeComplete = depenses.filter(cfg.filtre);
  const liste = listeComplete.filter(e=>!e.estRevenu);
  const total = liste.reduce((s,e)=>s+e.amount,0);
  /* Côté conjoint, le budget ne parle que de dépenses : les revenus (dépôts au compte,
     remboursements) sont suivis dans « Prochains dépôts au compte conjoint », pas ici. Les
     compter en douce dans le restant donnerait un chiffre qu'aucune ligne de l'écran ne
     permettrait d'expliquer. Le budget personnel, lui, les garde. */
  const compterRevenus = scope !== 'conjoint';
  const revenuMois = compterRevenus ? listeComplete.filter(e=>e.estRevenu).reduce((s,e)=>s+e.amount,0) : 0;

  /* Liste des revenus de la période, bien visible, pour qu'on voie clairement ce qui a été
     comptabilisé (et pas juste un chiffre agrégé dans les statistiques). */
  const revenusCardEl = document.getElementById(`budget-revenus-card-${scope}`);
  const revenusListEl = document.getElementById(`budget-revenus-list-${scope}`);
  const revenusPeriodeEl = document.getElementById(`budget-revenus-periode-${scope}`);
  if(revenusCardEl && revenusListEl){
    const revenusListe = listeComplete.filter(e=>e.estRevenu);
    if(revenusListe.length){
      revenusCardEl.style.display = '';
      if(revenusPeriodeEl) revenusPeriodeEl.textContent = libellePeriodeCourte;
      const revenusTries = revenusListe.slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
      revenusListEl.innerHTML = revenusTries.map(e=>{
        const dateFmt = new Date(e.date+"T00:00:00").toLocaleDateString('fr-CA', {day:'numeric', month:'long'});
        return `
          <div class="recurrent-row row-revenu-item" onclick="ouvrirDetailOccurrence('${e.id}')" style="cursor:pointer;">
            <div class="recurrent-info">
              <div class="recurrent-nom">${e.note ? echapperHTML(e.note) : 'Revenu'}</div>
              <div class="recurrent-meta">
                <span class="freq-pill badge-revenu">Revenu</span>
                <span class="freq-pill">${dateFmt}</span>
                ${e.recurrenceId ? '<span class="recurring-icon" title="Revenu récurrent">↻</span>' : ''}
              </div>
            </div>
            <div class="recurrent-actions">
              <div class="recurrent-montant" style="color:var(--green);">+${formaterMonnaie(e.amount)}</div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      revenusCardEl.style.display = 'none';
      revenusListEl.innerHTML = '';
    }
  }

  /* budgetActuel = les montants-cibles bruts (toujours mensuels, utilisés pour le
     formulaire d'édition) ; budgetAffiche = ces montants ramenés au prorata de la période
     actuellement consultée, pour comparer "pommes avec pommes". */
  const budgetActuel = (budgets[cfg.budgetKey] && budgets[cfg.budgetKey][periode]) || {};
  const sommeCategories = categories.reduce((s,c)=>s+(budgetActuel[c]||0),0);
  const budgetAffiche = budgetProratePourPeriode(sommeCategories, vue, debut, fin);
  const restant = budgetAffiche - total + revenuMois;
  const libelleDepense = scope === 'conjoint' ? `${libellePeriodeCourte} (conjoint)` : `${libellePeriodeCourte} (perso)`;

  /* Dans Personnel, quand "+ Conjoint" est activé, on affiche AUSSI le budget conjoint
     entre parenthèses à côté du budget perso, sans jamais les fusionner en un seul chiffre :
     ce sont deux budgets distincts qu'on veut pouvoir comparer d'un coup d'œil. */
  let conjointInfo = null;
  if(scope === 'personnel' && inclureConjointDansPersonnel){
    const cfgC = configSection('conjoint');
    const listeCompleteC = depenses.filter(cfgC.filtre);
    const listeC = listeCompleteC.filter(e=>!e.estRevenu);
    const totalC = listeC.reduce((s,e)=>s+e.amount,0);
    /* Même règle que pour l'onglet Conjoint lui-même : pas de revenus dans le budget conjoint. */
    const revenuMoisC = 0;
    const budgetActuelC = (budgets.conjoint && budgets.conjoint[periode]) || {};
    const sommeCategoriesC = categories.reduce((s,c)=>s+(budgetActuelC[c]||0),0);
    const budgetAfficheC = budgetProratePourPeriode(sommeCategoriesC, vue, debut, fin);
    const restantC = budgetAfficheC - totalC + revenuMoisC;
    const parCatC = {};
    listeC.forEach(e=> parCatC[e.category] = (parCatC[e.category]||0) + e.amount);
    conjointInfo = { total: totalC, budget: budgetAfficheC, restant: restantC, budgetParCat: budgetActuelC, parCat: parCatC };
  }
  const parenthese = (val) => conjointInfo ? `<div style="font-size:11px;margin-top:4px;color:var(--text-secondary);">(conjoint : ${val})</div>` : '';

  const carteRevenu = revenuMois > 0.005 ? `
    <div class="stat-card"><div class="label">Revenu<span class="mobile-line"> cette période</span></div><div class="value" style="color:var(--green)">+${formaterMonnaie(revenuMois)}</div></div>
  ` : '';

  document.getElementById(`stats-${scope}`).innerHTML = `
    <div class="stat-card"><div class="label">Dépensé<span class="mobile-line"> ${libelleDepense}</span></div><div class="value ${cfg.valueClass}">${formaterMonnaie(total)}</div>${parenthese(conjointInfo && formaterMonnaie(conjointInfo.total))}</div>
    <div class="stat-card"><div class="label">Budget<span class="mobile-line"> pour cette période</span></div><div class="value">${formaterMonnaie(budgetAffiche)}</div>${parenthese(conjointInfo && formaterMonnaie(conjointInfo.budget))}</div>
    <div class="stat-card"><div class="label">Restant<span class="mobile-line"> à dépenser</span></div><div class="value ${restant>=0?'p1':'p2'}">${restant>=0?'':'-'}${formaterMonnaie(Math.abs(restant))}</div>${parenthese(conjointInfo && (conjointInfo.restant>=0?'':'-')+formaterMonnaie(Math.abs(conjointInfo.restant)))}</div>
    ${carteRevenu}
  `;

  /* Liste des barres de progression par catégorie (budget de la catégorie ramené au
     prorata de la période, comme le total). */
  const parCat = {};
  liste.forEach(e=> parCat[e.category] = (parCat[e.category]||0) + e.amount);
  const catAvecBudgetOuDepense = categories.filter(c =>
    (budgetActuel[c]||0) > 0 || (parCat[c]||0) > 0 ||
    (conjointInfo && ((conjointInfo.budgetParCat[c]||0) > 0 || (conjointInfo.parCat[c]||0) > 0))
  );
  const budgetListEl = document.getElementById(`budget-list-${scope}`);
  if(!catAvecBudgetOuDepense.length){
    budgetListEl.innerHTML = `<div class="budget-empty">Aucun budget défini pour ${libellePeriodeCourte}. Passez en vue "Paie" pour en ajouter un par catégorie.</div>`;
  } else {
    budgetListEl.innerHTML = catAvecBudgetOuDepense.map(cat=>{
      const depense = parCat[cat]||0;
      const budgetBrut = budgetActuel[cat]||0;
      const budget = budgetProratePourPeriode(budgetBrut, vue, debut, fin);
      const pct = budget>0 ? Math.min(100, (depense/budget)*100) : (depense>0 ? 100 : 0);
      const depasse = budget>0 && depense>budget;
      const couleur = depasse ? 'var(--red)' : (COULEURS_CATEGORIES[cat]||'#9aa0a6');
      const budgetConjointC = conjointInfo ? budgetProratePourPeriode(conjointInfo.budgetParCat[cat]||0, vue, debut, fin) : 0;
      const conjointTxt = conjointInfo ? `(conjoint : ${formaterMonnaie(conjointInfo.parCat[cat]||0)}${budgetConjointC>0 ? ' / '+formaterMonnaie(budgetConjointC) : ''})` : '';
      return `<div class="budget-row">
        <div class="budget-row-top">
          <div class="budget-row-cat"><span class="swatch" style="background:${COULEURS_CATEGORIES[cat]||'#9aa0a6'}"></span>${cat}</div>
          <div class="budget-row-amounts"><strong>${formaterMonnaie(depense)}</strong>${budget>0 ? ' / '+formaterMonnaie(budget) : ' (pas de budget)'}</div>
        </div>
        ${conjointTxt ? `<div class="budget-row-conjoint">${conjointTxt}</div>` : ''}
        <div class="budget-bar"><div class="budget-bar-fill" style="width:${pct}%;background:${couleur};"></div></div>
      </div>`;
    }).join('');
  }

  /* Graphique en doughnut de la répartition */
  const labels = Object.keys(parCat);
  const data = Object.values(parCat);
  const colors = labels.map(l=>COULEURS_CATEGORIES[l]||'#9aa0a6');
  const ctx = document.getElementById(`chart-categories-${scope}`);
  const chartKey = scope === 'conjoint' ? 'chartConjointCategories' : 'chartPersonnelCategories';
  if(window[chartKey]) window[chartKey].destroy();
  if(labels.length){
    window[chartKey] = new Chart(ctx, {
      type:'doughnut',
      data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:0, borderColor:'transparent' }] },
      options:{
        responsive:true, maintainAspectRatio:false, cutout:'62%',
        plugins:{ legend:{position:'bottom', labels:{boxWidth:10, font:{family:'Roboto', size:12}}},
          tooltip:{ callbacks:{ label:(c)=> `${c.label}: ${formaterMonnaie(c.raw)}` } } }
      }
    });
  }

  /* Formulaire de gestion du budget par catégorie — seulement pertinent en vue "Paie"
     (voir plus haut), mais on le construit dans tous les cas pour rester simple ; il est
     juste invisible ailleurs. */
  const formEl = document.getElementById(`budget-form-${scope}`);
  formEl.innerHTML = categories.map(cat=>`
    <div class="field budget-input-field">
      <label><span class="swatch" style="background:${COULEURS_CATEGORIES[cat]||'#9aa0a6'}"></span>${cat}</label>
      <div class="input-money">
        <input type="number" id="budget-input-${scope}-${cat}" step="1" min="0" value="${budgetActuel[cat]||''}" placeholder="0" autocomplete="off">
        <span class="suffix">$ / mois</span>
      </div>
    </div>
  `).join('');
}

/* ===================== EXPORT / IMPORT EXCEL & CSV (import seulement) ===================== */

/* Ouverture / fermeture du modal de choix de période à exporter */
function ouvrirExport(){
  remplirSelectsExport();
  document.getElementById('export-modal').style.display = 'flex';
}
function fermerExport(){
  document.getElementById('export-modal').style.display = 'none';
}

function remplirSelectsExport(){
  const moisDisponibles = new Map();
  const anneesDisponibles = new Set();
  depenses.filter(e => e.type === 'conjointe' || e.who === currentUser).forEach(e=>{
    const d = new Date(e.date+"T00:00:00");
    const cle = `${d.getFullYear()}-${d.getMonth()}`;
    moisDisponibles.set(cle, `${NOMS_MOIS[d.getMonth()]} ${d.getFullYear()}`);
    anneesDisponibles.add(d.getFullYear());
  });
  const cleMoisActif = `${moisActif.year}-${moisActif.month}`;
  if(!moisDisponibles.has(cleMoisActif)) moisDisponibles.set(cleMoisActif, `${NOMS_MOIS[moisActif.month]} ${moisActif.year}`);
  anneesDisponibles.add(anneeActive);

  const moisTries = [...moisDisponibles.entries()].sort((a,b)=>a[0].localeCompare(b[0], undefined, {numeric:true}));
  const anneesTriees = [...anneesDisponibles].sort((a,b)=>a-b);

  const selectMois = document.getElementById('export-mois');
  selectMois.innerHTML = moisTries.map(([cle,label])=>`<option value="${cle}">${label}</option>`).join('');
  selectMois.value = cleMoisActif;

  const selectAnnee = document.getElementById('export-annee');
  selectAnnee.innerHTML = anneesTriees.map(a=>`<option value="${a}">${a}</option>`).join('');
  selectAnnee.value = String(anneeActive);
}

/* Export Excel (.xlsx) via SheetJS pour une liste de dépenses déjà filtrée */
/* Les colonnes Revenu / Compte / PourcentageP1 permettent un aller-retour complet : sans
   elles, un revenu réimporté redevenait une dépense. */
function exporterExcel(liste, suffixeFichier){
  if(!liste.length){ afficherAlerte("Aucune dépense à exporter pour cette période."); return; }
  const data = liste
    .slice()
    .sort((a,b)=> a.date.localeCompare(b.date))
    .map(e => ({
      Qui: e.estCompte ? 'Compte conjoint' : libellePersonne(e.who),
      Date: e.date,
      Montant: e.amount,
      Categorie: e.category,
      Note: e.note || '',
      Type: e.type === 'personnelle' ? 'Personnelle' : 'Conjointe',
      Revenu: e.estRevenu ? 'Oui' : 'Non',
      Compte: e.estCompte ? 'Oui' : 'Non',
      PourcentageP1: e.type === 'personnelle' ? '' : (e.pourcentageP1 != null ? e.pourcentageP1 : 50)
    }));
  const feuille = XLSX.utils.json_to_sheet(data);
  feuille['!cols'] = [{wch:16},{wch:12},{wch:10},{wch:14},{wch:30},{wch:12},{wch:8},{wch:8},{wch:14}];
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Dépenses');
  XLSX.writeFile(classeur, `depenses_${suffixeFichier}.xlsx`);
}


/* Analyse d'un texte CSV en tableau d'objets, en détectant automatiquement le séparateur (, ou ;) */
function parserCSV(texte){
  if(texte.charCodeAt(0) === 0xFEFF) texte = texte.slice(1);
  const premiereLigne = texte.split(/\r?\n/)[0] || '';
  const separateur = (premiereLigne.match(/;/g)||[]).length >= (premiereLigne.match(/,/g)||[]).length ? ';' : ',';

  const lignes = [];
  let ligneCourante = [];
  let champ = '';
  let dansGuillemets = false;

  for(let i=0;i<texte.length;i++){
    const c = texte[i];
    if(dansGuillemets){
      if(c === '"'){
        if(texte[i+1] === '"'){ champ += '"'; i++; }
        else dansGuillemets = false;
      } else champ += c;
    } else {
      if(c === '"') dansGuillemets = true;
      else if(c === separateur){ ligneCourante.push(champ); champ = ''; }
      else if(c === '\n' || c === '\r'){
        if(c === '\r' && texte[i+1] === '\n') i++;
        ligneCourante.push(champ); champ = '';
        if(ligneCourante.some(v=>v!=='')) lignes.push(ligneCourante);
        ligneCourante = [];
      } else champ += c;
    }
  }
  if(champ !== '' || ligneCourante.length){ ligneCourante.push(champ); lignes.push(ligneCourante); }
  if(!lignes.length) return [];

  const entetes = lignes[0].map(h=>h.trim());
  return lignes.slice(1).map(ligne => {
    const obj = {};
    entetes.forEach((h,idx)=> obj[h] = ligne[idx] !== undefined ? ligne[idx].trim() : '');
    return obj;
  });
}

/* Dates « a/b/aaaa » : jour/mois par défaut (usage au Québec), sauf si l'ordre inverse est
   la seule lecture possible (ex. 04/25/2026). */
function normaliserDate(val){
  if(val instanceof Date) return `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
  if(typeof val === 'number'){
    // Numéro de série Excel (jours depuis le 30 déc. 1899)
    const epoque = new Date(Date.UTC(1899,11,30));
    const d = new Date(epoque.getTime() + val*86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  const str = String(val ?? '').trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = str.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if(m){
    let jour = Number(m[1]), mois = Number(m[2]);
    if(mois > 12 && jour <= 12){ [jour, mois] = [mois, jour]; }
    if(mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
    return `${m[3]}-${String(mois).padStart(2,'0')}-${String(jour).padStart(2,'0')}`;
  }
  return null;
}

/* Formats acceptés : 1234.56, 1234,56, 1 234,56 $, 1,234.56, 1.234,56. Quand les deux
   séparateurs sont présents, le DERNIER est le séparateur décimal (avant, « 1,234.56 »
   donnait 1,23). Un seul séparateur suivi de groupes de 3 chiffres (« 1,234 ») est lu
   comme un séparateur de milliers. */
function normaliserMontant(val){
  if(typeof val === 'number') return val;
  let str = String(val ?? '').trim().replace(/[\s$]/g,'');
  const virgule = str.lastIndexOf(','), point = str.lastIndexOf('.');
  if(virgule !== -1 && point !== -1){
    const decimal = virgule > point ? ',' : '.';
    const milliers = decimal === ',' ? '.' : ',';
    str = str.split(milliers).join('').replace(decimal, '.');
  } else if(virgule !== -1 || point !== -1){
    const sep = virgule !== -1 ? ',' : '.';
    const groupesDeMilliers = new RegExp(`^-?\\d{1,3}(\\${sep}\\d{3})+$`);
    str = groupesDeMilliers.test(str) ? str.split(sep).join('') : str.replace(sep, '.');
  }
  if(!/^-?\d*\.?\d+$/.test(str)) return null;
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function estOui(val){
  return ['oui','o','yes','y','true','vrai','1','x'].includes(String(val ?? '').trim().toLowerCase());
}

function normaliserQui(val, parDefaut){
  const str = String(val ?? '').trim().toLowerCase();
  if(str === 'p1' || str === nomsPersonnes.p1.toLowerCase()) return 'p1';
  if(str === 'p2' || str === nomsPersonnes.p2.toLowerCase()) return 'p2';
  return parDefaut;
}

function normaliserCategorie(val){
  const str = String(val ?? '').trim();
  const trouve = categories.find(c => c.toLowerCase() === str.toLowerCase());
  return trouve || 'Autre';
}

function normaliserType(val){
  const str = String(val ?? '').trim().toLowerCase();
  if(str.startsWith('personnel')) return 'Personnelle';
  return 'Conjointe';
}

function valeurColonne(ligne, nomsPossibles){
  for(const cle of Object.keys(ligne)){
    if(nomsPossibles.includes(cle.trim().toLowerCase())) return ligne[cle];
  }
  return undefined;
}

async function importerLignes(lignes){
  if(!lignes.length){ afficherAlerte("Aucune ligne trouvée dans le fichier."); return; }

  const utilisateurParDefaut = nomsPersonnes[currentUser] ? currentUser : 'p1';
  const aInserer = [];
  let ignorees = 0;

  lignes.forEach(ligne => {
    const quiVal = valeurColonne(ligne, ['qui','who']);
    const dateVal = valeurColonne(ligne, ['date']);
    const montantVal = valeurColonne(ligne, ['montant','amount']);
    const catVal = valeurColonne(ligne, ['categorie','catégorie','category']);
    const noteVal = valeurColonne(ligne, ['note','notes']);
    const typeVal = valeurColonne(ligne, ['type']);
    const revenuVal = valeurColonne(ligne, ['revenu','estrevenu']);
    const compteVal = valeurColonne(ligne, ['compte','estcompte']);
    const pctVal = valeurColonne(ligne, ['pourcentagep1','pourcentage']);

    const date = normaliserDate(dateVal);
    const amount = normaliserMontant(montantVal);
    if(!date || amount === null || !(amount > 0)){ ignorees++; return; }

    const type = normaliserType(typeVal) === 'Personnelle' ? 'personnelle' : 'conjointe';
    /* Une dépense personnelle importée est toujours attribuée à la personne qui importe
       (comme pour l'ajout manuel), afin qu'elle reste visible pour elle et cachée pour l'autre. */
    const estCompte = type === 'conjointe'
      && (estOui(compteVal) || String(quiVal ?? '').trim().toLowerCase() === 'compte conjoint');
    const qui = type === 'personnelle' ? utilisateurParDefaut
      : (estCompte ? 'compte' : normaliserQui(quiVal, utilisateurParDefaut));
    const estRevenu = (type === 'personnelle' || estCompte) && estOui(revenuVal);
    const pctLu = normaliserMontant(pctVal);
    const pourcentageP1 = type === 'conjointe'
      ? (pctLu != null && pctLu >= 0 && pctLu <= 100 ? Math.round(pctLu) : 50)
      : null;

    aInserer.push({
      id: uid(),
      Qui: nomPersonneSupabase(qui),
      Montant: amount,
      Date: date,
      Categorie: estRevenu ? 'Revenu' : normaliserCategorie(catVal),
      Note: String(noteVal ?? '').trim(),
      Type: type,
      EstCompte: estCompte,
      EstRevenu: estRevenu,
      PourcentageP1: pourcentageP1,
      user_id: type === 'personnelle' ? (currentSession?.user?.id || null) : null
    });
  });

  if(!aInserer.length){
    afficherAlerte("Aucune ligne valide n'a pu être importée. Vérifiez les colonnes Qui, Date, Montant, Categorie, Note.");
    return;
  }

  const statut = document.getElementById('import-status');
  if(statut) statut.textContent = "Importation en cours...";

  let { error } = await supabaseClient.from('Depenses').insert(aInserer);
  let colonnesRecentes = true;
  if(error){
    /* Même repli que pour l'ajout manuel : base sans les colonnes récentes. */
    console.warn("Import avec EstCompte/EstRevenu/PourcentageP1 impossible, nouvel essai sans ces colonnes.", error);
    colonnesRecentes = false;
    ({ error } = await supabaseClient.from('Depenses').insert(
      aInserer.map(({ EstCompte, EstRevenu, PourcentageP1, ...reste }) => reste)));
  }
  if(error){
    afficherAlerte("Erreur lors de l'importation dans Supabase. Aucune ligne n'a été ajoutée.");
    console.error(error);
    if(statut) statut.textContent = "";
    return;
  }

  aInserer.forEach(d => depensesReelles.push({
    ajout: formaterDateISO(new Date()),
    id: d.id, who: clePersonne(d.Qui), amount: d.Montant, date: d.Date, category: d.Categorie, note: d.Note, type: d.Type,
    recurrenceId: null,
    estCompte: colonnesRecentes && d.EstCompte,
    estRevenu: colonnesRecentes && d.EstRevenu,
    pourcentageP1: colonnesRecentes && d.PourcentageP1 != null ? d.PourcentageP1 : 50
  }));
  recalculerDepenses();

  rafraichirActif();
  const message = `${aInserer.length} dépense${aInserer.length>1?'s':''} importée${aInserer.length>1?'s':''}` +
    (ignorees ? ` (${ignorees} ligne${ignorees>1?'s':''} ignorée${ignorees>1?'s':''} car incomplète${ignorees>1?'s':''}).` : '.');
  if(statut) statut.textContent = message;
  afficherAlerte(message);
}

document.getElementById('btn-export').addEventListener('click', ouvrirExport);
document.getElementById('close-export').addEventListener('click', fermerExport);
document.querySelectorAll('#export-toggle button').forEach(bouton=>{
  bouton.addEventListener('click', ()=>{
    document.querySelectorAll('#export-toggle button').forEach(b=>b.classList.remove('active'));
    bouton.classList.add('active');
    const modeMois = bouton.dataset.mode === 'mois';
    document.getElementById('export-field-mois').style.display = modeMois ? 'block' : 'none';
    document.getElementById('export-field-annee').style.display = modeMois ? 'none' : 'block';
  });
});
document.getElementById('do-export').addEventListener('click', ()=>{
  const mode = document.querySelector('#export-toggle button.active').dataset.mode;
  /* Jamais les dépenses personnelles de l'autre personne dans un export. */
  const exportables = depenses.filter(e => e.type === 'conjointe' || e.who === currentUser);
  if(mode === 'mois'){
    const [y,m] = document.getElementById('export-mois').value.split('-').map(Number);
    const liste = exportables.filter(e=>dansMois(e.date,y,m));
    exporterExcel(liste, `${y}-${String(m+1).padStart(2,'0')}`);
  } else {
    const y = Number(document.getElementById('export-annee').value);
    const liste = exportables.filter(e=>dansAnnee(e.date,y));
    exporterExcel(liste, String(y));
  }
  fermerExport();
});
document.getElementById('btn-import').addEventListener('click', ()=>document.getElementById('import-file').click());
document.getElementById('import-file').addEventListener('change', async (e)=>{
  const fichier = e.target.files[0];
  if(!fichier) return;
  const statut = document.getElementById('import-status');
  try{
    let lignes;
    if(/\.csv$/i.test(fichier.name)){
      const texte = await fichier.text();
      lignes = parserCSV(texte);
    } else {
      const tampon = await fichier.arrayBuffer();
      const classeur = XLSX.read(tampon, {type:'array', cellDates:true});
      const feuille = classeur.Sheets[classeur.SheetNames[0]];
      lignes = XLSX.utils.sheet_to_json(feuille, {defval:''});
    }
    await importerLignes(lignes);
  } catch(err){
    console.error(err);
    if(statut) statut.textContent = '';
    afficherAlerte("Impossible de lire ce fichier. Vérifiez qu'il s'agit bien d'un fichier CSV ou Excel valide.");
  }
  e.target.value = '';
});

/* ===================== CONTRAINTES DE SAISIE NUMÉRIQUE =====================
   Les attributs min/max/step d'un <input type="number" autocomplete="off"> ne sont vérifiés par le navigateur
   qu'à la validation d'un formulaire — ici il n'y en a pas, donc rien n'empêchait de taper
   un pourcentage de 250 ou un montant à cinq décimales. Chaque champ marqué `data-num`
   est donc corrigé en direct, à la frappe comme au collage.

   La valeur est TRONQUÉE et non arrondie : taper un chiffre de trop ne doit jamais modifier
   les chiffres déjà saisis. */
const REGLES_NUMERIQUES = {
  pourcentage: { decimales:0, min:0,  max:100 },  /* part d'une personne : 0 à 100, entier */
  montant:     { decimales:2, min:0 },            /* dollars : 2 décimales maximum */
  entier:      { decimales:0, min:1 }             /* nombre de paiements, intervalle */
};

function appliquerRegleNumerique(champ){
  const regle = REGLES_NUMERIQUES[champ.dataset.num];
  if(!regle) return;
  /* Saisie en cours d'être invalide (ex: "12.") : le navigateur renvoie une valeur vide,
     on le laisse finir plutôt que d'effacer ce qu'il tape. */
  if(champ.value === '') return;
  const texte = champ.value;
  const saisi = Number(texte);
  if(!isFinite(saisi)) return;

  /* Troncature sur le TEXTE, pas sur le nombre : Math.trunc(2.3 * 100) donne 229 à cause de
     l'arrondi binaire, et 2,30 devenait 2,29 (ainsi qu'environ 4,6 % des montants en cents),
     y compris sur un montant existant au simple passage dans le champ. La valeur d'un
     <input type="number"> utilise toujours le point décimal, peu importe la langue. */
  let texteCorrige = texte;
  const [partieEntiere, decimales] = texte.split('.');
  if(decimales !== undefined && !/e/i.test(texte) && decimales.length > regle.decimales){
    texteCorrige = regle.decimales > 0 ? `${partieEntiere}.${decimales.slice(0, regle.decimales)}` : partieEntiere;
  }
  let corrige = Number(texteCorrige);
  if(!isFinite(corrige)) return;
  if(regle.min != null && corrige < regle.min) corrige = regle.min;
  if(regle.max != null && corrige > regle.max) corrige = regle.max;

  /* On ne réécrit le champ que si la valeur change VRAIMENT : sinon taper "12,30" se
     ferait réécrire en "12,3" au troisième caractère, avec le curseur qui saute. */
  if(corrige !== saisi) champ.value = String(corrige);
}

function activerContraintesNumeriques(){
  document.querySelectorAll('[data-num]').forEach(champ=>{
    champ.addEventListener('input', ()=>appliquerRegleNumerique(champ));
    champ.addEventListener('blur',  ()=>appliquerRegleNumerique(champ));
  });
}
activerContraintesNumeriques();

/* ===================== CLAVIER VIRTUEL SUR MOBILE =====================
   Sur mobile, les fenêtres d'édition occupent tout l'écran. Tant qu'elles se dimensionnaient
   sur la hauteur de la FENÊTRE, l'ouverture du clavier poussait le bas du formulaire (et le
   pied avec ses boutons) sous le clavier, sans moyen d'y accéder.

   visualViewport donne la hauteur réellement visible. On la publie dans une variable CSS et
   on marque le body quand le clavier est ouvert, ce qui laisse la mise en page rendre
   l'entête et le pied défilants : tous les champs redeviennent atteignables. */
function suivreClavierVirtuel(){
  const vv = window.visualViewport;
  if(!vv) return; /* repli CSS : 100dvh */

  /* Seuil : en dessous, une variation de hauteur vient d'une barre d'adresse qui se replie,
     pas d'un clavier. */
  const SEUIL_CLAVIER = 140;
  let hauteurMax = vv.height;

  const majuster = () => {
    hauteurMax = Math.max(hauteurMax, vv.height);
    document.documentElement.style.setProperty('--hauteur-visible', `${Math.round(vv.height)}px`);
    const clavierOuvert = (hauteurMax - vv.height) > SEUIL_CLAVIER;
    document.body.classList.toggle('clavier-ouvert', clavierOuvert);
  };

  vv.addEventListener('resize', majuster);
  vv.addEventListener('scroll', majuster);
  window.addEventListener('orientationchange', ()=>{ hauteurMax = 0; setTimeout(majuster, 250); });
  majuster();

  /* Quand on passe d'un champ à l'autre, le navigateur ne ramène pas toujours le champ visé
     au-dessus du clavier : on s'en assure une fois la mise en page stabilisée. */
  document.addEventListener('focusin', (e)=>{
    const champ = e.target;
    if(!champ.matches || !champ.matches('input, select, textarea')) return;
    if(!champ.closest('.edit-card')) return;
    setTimeout(()=>{
      if(document.activeElement === champ){
        champ.scrollIntoView({block:'nearest', behavior:'smooth'});
      }
    }, 300);
  });
}
suivreClavierVirtuel();

/* Boîte de message custom, à la place de alert() natif (dont l'entête "x dit" est
   disgracieuse et affiche l'adresse du serveur local). */
function afficherAlerte(message){
  document.getElementById('alerte-message').textContent = message;
  document.getElementById('alerte-modal').classList.add('visible');
}
document.getElementById('alerte-ok').addEventListener('click', ()=>{
  document.getElementById('alerte-modal').classList.remove('visible');
});

/* Lancement au démarrage */
initAuth();
