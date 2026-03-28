// ═══════════════════════════════════════════════════
// CONFIGURATION SUPABASE
// ═══════════════════════════════════════════════════
const sbUrl = "https://jfqsdbjkynsdjguommcm.supabase.co";
const sbKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpmcXNkYmpreW5zZGpndW9tbWNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MDU1NTIsImV4cCI6MjA5MDE4MTU1Mn0.cE_kYftsG1KPfjxCWvJLaucifX8_EDBWy5wYSYLxgHA";
const sb = window.supabase.createClient(sbUrl, sbKey);

// ═══════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════
const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DEF_CATS = ['Épicerie','Restaurant / Sorties','Transport','Loisirs','Abonnements','Santé','Maison','Autre'];
const now = new Date();
