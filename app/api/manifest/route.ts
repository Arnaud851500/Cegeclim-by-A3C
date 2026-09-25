// Manifest personnalisé par commercial (25/09/2026).
//
// GET /api/manifest?u=prenom.nom@cegeclim-energies.com
// → même manifest que app/manifest.ts, mais avec
//   start_url = /installer?u=<identifiant>
//
// Utilisé par la page /installer : l'icône ajoutée à l'écran d'accueil
// s'ouvre alors sur /installer?u=…, qui redirige vers /login avec
// l'identifiant prérempli (ou vers l'accueil si déjà connecté).
// Aucune donnée sensible : seul l'identifiant (adresse mail) transite,
// jamais de mot de passe.

import manifest from '@/app/manifest'

export const dynamic = 'force-dynamic'

// Identifiant raisonnable : une adresse mail simple, longueur bornée.
const IDENTIFIANT_VALIDE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$/i

export function GET(request: Request) {
  const base = manifest()
  const u = new URL(request.url).searchParams.get('u')?.trim() ?? ''

  const body =
    u && IDENTIFIANT_VALIDE.test(u)
      ? { ...base, start_url: `/installer?u=${encodeURIComponent(u.toLowerCase())}` }
      : base

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      // Jamais mis en cache : chaque commercial doit recevoir le sien.
      'Cache-Control': 'no-store',
    },
  })
}
