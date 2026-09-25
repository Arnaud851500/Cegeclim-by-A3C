/*
 * Service worker du Compagnon CEGECLIM (ajouté le 25/09/2026).
 *
 * Rôle volontairement minimal :
 * - rendre l'application « installable » sur Chrome Android (bouton
 *   « Installer le Compagnon » de la page /installer) ;
 * - afficher une page « Pas de connexion » propre quand l'app installée est
 *   ouverte sans réseau, au lieu de l'écran d'erreur du navigateur.
 *
 * Aucune donnée métier n'est mise en cache : toutes les requêtes partent
 * sur le réseau comme avant (données toujours fraîches, pas de risque de
 * servir une ancienne version de l'app après un déploiement Vercel).
 */

const VERSION = 'compagnon-sw-v1'

const OFFLINE_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0B1220">
<title>Le compagnon CEGECLIM — hors connexion</title>
<style>
  html, body { margin: 0; height: 100%; background: #0B1220; color: #F5F3EC;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { min-height: 100%; display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 32px 24px; box-sizing: border-box; text-align: center; }
  .pastille { width: 56px; height: 56px; border-radius: 50%; border: 2px solid #A6A181;
    display: flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0 0 10px; }
  p { font-size: 15px; line-height: 1.5; color: rgba(245,243,236,.72); margin: 0 0 28px; max-width: 320px; }
  button { background: #F5F3EC; color: #0B1220; border: 0; border-radius: 12px;
    padding: 14px 28px; font-size: 16px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <div class="pastille">⌁</div>
  <h1>Pas de connexion</h1>
  <p>Le Compagnon a besoin du réseau pour afficher vos données. Vérifiez la 4G ou le Wi-Fi puis réessayez.</p>
  <button onclick="location.reload()">Réessayer</button>
</main>
</body>
</html>`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nettoie d'éventuels caches d'une version précédente.
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  // Seules les navigations (ouverture d'une page) sont interceptées, et
  // uniquement pour gérer l'absence de réseau. Tout le reste (API Supabase,
  // JS, images…) passe directement, sans intervention du service worker.
  if (request.mode !== 'navigate') return

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    ),
  )
})
