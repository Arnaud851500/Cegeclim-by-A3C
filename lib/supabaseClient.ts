import { createClient } from '@supabase/supabase-js'

console.log('URL =', process.env.NEXT_PUBLIC_SUPABASE_URL)
console.log('KEY =', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

// ============================================================================
// CORRECTIF (26/10/2026) — boucle connexion → accueil → connexion sur un poste
// dont l'horloge est décalée (cas de s.chanteau : 384 rafraîchissements de
// jeton et 23 connexions dans la journée, aucun autre utilisateur concerné).
//
// Supabase enregistre l'heure d'expiration du jeton (expires_at) à l'heure du
// SERVEUR, mais la compare à l'heure du POSTE (Date.now()). Si l'horloge du
// PC est en avance de plus de ~58 min (ex. changement d'heure du 25/10 mal
// pris en compte, heure réglée à la main), chaque jeton neuf paraît déjà
// expiré : le client le rafraîchit en rafale, les appels simultanés utilisent
// un jeton déjà révoqué, la session est supprimée → retour à l'écran de
// connexion, qui retrouve un instant la session et renvoie vers l'accueil…
//
// Correction : un stockage de session qui mesure l'écart entre l'heure du
// poste et l'heure d'émission du jeton (champ « iat » signé par le serveur),
// et décale expires_at d'autant quand l'écart dépasse 2 minutes. Le serveur
// continue de vérifier le jeton à sa propre heure : rien ne change côté
// sécurité, le client rafraîchit simplement au bon moment.
// L'écart mesuré est gardé dans localStorage (cegeclim.clockSkew) pour
// diagnostic.
// ============================================================================

const SKEW_KEY = 'cegeclim.clockSkew'
const SKEW_THRESHOLD_S = 120

function lireIat(accessToken: unknown): number | null {
  if (typeof accessToken !== 'string') return null
  const part = accessToken.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    return typeof json.iat === 'number' ? json.iat : null
  } catch {
    return null
  }
}

/** Écart (secondes) heure du poste − heure du serveur, mesuré une fois par jeton. */
function ecartHorloge(iat: number): number {
  try {
    const memo = JSON.parse(window.localStorage.getItem(SKEW_KEY) || 'null') as { iat?: number; skew?: number } | null
    if (memo && memo.iat === iat && typeof memo.skew === 'number') return memo.skew
  } catch {
    // mémo illisible : on remesure
  }
  const skew = Math.round(Date.now() / 1000) - iat
  try {
    window.localStorage.setItem(SKEW_KEY, JSON.stringify({ iat, skew, mesure_le: new Date().toISOString() }))
  } catch {
    // stockage indisponible : pas de mémo
  }
  if (Math.abs(skew) > SKEW_THRESHOLD_S) {
    console.warn(`[auth] horloge du poste décalée de ${Math.round(skew / 60)} min par rapport au serveur : expiration de session ajustée`)
  }
  return skew
}

const stockageSession = {
  getItem(key: string) {
    return window.localStorage.getItem(key)
  },
  setItem(key: string, value: string) {
    let aEcrire = value
    try {
      const session = JSON.parse(value)
      const iat = lireIat(session?.access_token)
      if (iat && typeof session?.expires_at === 'number' && session._cg_skew === undefined) {
        const skew = ecartHorloge(iat)
        if (Math.abs(skew) > SKEW_THRESHOLD_S) {
          session.expires_at = session.expires_at + skew
          session._cg_skew = skew
          aEcrire = JSON.stringify(session)
        }
      }
    } catch {
      // pas une session JSON (autre clé de l'auth) : écrite telle quelle
    }
    window.localStorage.setItem(key, aEcrire)
  },
  removeItem(key: string) {
    window.localStorage.removeItem(key)
  },
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  typeof window !== 'undefined' ? { auth: { storage: stockageSession } } : undefined,
)
