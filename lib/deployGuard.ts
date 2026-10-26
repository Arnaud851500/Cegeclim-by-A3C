// ============================================================================
// lib/deployGuard.ts — garde-fou « scintillement après déploiement » (26/10/2026)
// ----------------------------------------------------------------------------
// Symptôme : après certains déploiements Vercel, la page d'accueil se recharge
// en boucle (scintillement) jusqu'à un rechargement forcé (Maj+Cmd+R sur Mac,
// Ctrl+F5 sur PC).
//
// Cause : l'onglet garde une version de la page (HTML / données RSC) de
// l'ancien déploiement. À la première navigation interne, Next.js voit que
// le serveur a changé de version (identifiant de déploiement « dpl ») et
// force un rechargement complet ; si le navigateur ressert alors sa copie en
// cache de l'ancienne version, le même décalage recommence → boucle.
//
// Corrections :
//   1. next.config.ts : pages et données servies en « no-store » (le
//      navigateur ne garde plus de copie des pages, seulement des fichiers
//      /_next/static versionnés) ;
//   2. ce script, injecté en tête de page avant Next.js : s'il détecte
//      3 chargements en moins de 10 s, ou un fichier /_next/static qui ne se
//      charge pas, il fait lui-même l'équivalent d'un rechargement forcé
//      (désinscrit le service worker, vide les caches, recharge l'adresse
//      avec un paramètre anti-cache) — au plus une fois par minute ;
//   3. public/sw.js v2 + enregistrement sans cache HTTP (PwaSetup).
// ============================================================================

export const DEPLOY_GUARD_SCRIPT = `(function(){try{
var S=window.sessionStorage,K='cegeclim.loads',B='cegeclim.cachebust',P='_cb',now=Date.now();
var u=new URL(window.location.href);
if(u.searchParams.has(P)){u.searchParams.delete(P);history.replaceState(history.state,'',u.pathname+(u.search||'')+u.hash);}
function bust(){
  var last=+(S.getItem(B)||0);if(Date.now()-last<60000)return;
  S.setItem(B,String(Date.now()));S.removeItem(K);
  var fini=false;var done=function(){if(fini)return;fini=true;var t=new URL(window.location.href);t.searchParams.set(P,String(Date.now()));window.location.replace(t.toString());};
  var jobs=[];
  try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){jobs.push(navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister();}));}));}}catch(e){}
  try{if(window.caches&&caches.keys){jobs.push(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k);}));}));}}catch(e){}
  Promise.all(jobs).then(done,done);setTimeout(done,1500);
}
var l=[];try{l=JSON.parse(S.getItem(K)||'[]');}catch(e){l=[];}
l=l.filter(function(t){return now-t<10000;});l.push(now);S.setItem(K,JSON.stringify(l));
if(l.length>=3){bust();return;}
window.addEventListener('error',function(ev){var el=ev&&ev.target;if(!el||el===window)return;
  var src=(el.src||el.href||'');if(src.indexOf('/_next/static/')>=0)bust();},true);
window.addEventListener('unhandledrejection',function(ev){var r=ev&&ev.reason;var m=String((r&&(r.name+' '+r.message))||r||'');
  if(/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(m))bust();});
}catch(e){}})();`
