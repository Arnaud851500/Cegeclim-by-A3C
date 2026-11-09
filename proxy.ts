// ============================================================================
// proxy.ts — contrôle d'accès des routes /api (09/11/2026)
// ----------------------------------------------------------------------------
// Audit du 09/11/2026 : une vingtaine de routes /api utilisaient la clé
// service_role (qui passe outre tout le RLS) ou la clé OpenAI sans vérifier
// qui les appelait. N'importe qui connaissant l'URL pouvait lire les factures
// via /api/atelier-ai-db, lancer les jobs d'administration, consommer des
// jetons OpenAI…
//
// Règle appliquée ici, AVANT chaque route /api :
//   1. routes publiques (liste PUBLIC_PATHS) : laissées passer ;
//   2. appels machine porteurs d'un secret connu (cron Vercel, worker de
//      maintenance clients, rendu PDF, synchro BLG) : laissés passer ;
//   3. sinon, jeton de session Supabase obligatoire (en-tête
//      Authorization: Bearer <access_token>), vérifié auprès de Supabase Auth.
//      Le navigateur l'ajoute automatiquement (lib/apiAuthFetch.ts) ;
//   4. /api/admin/* : en plus, droit administrateur (todo_is_admin :
//      can_autorisation utilisateur OU profil, ou profil « Administrateur »).
//
// Les routes gardent leurs propres contrôles : ce fichier est une barrière
// supplémentaire, pas un remplacement.
// ============================================================================

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/** Routes accessibles sans session (page /installer avant connexion). */
const PUBLIC_PATHS = new Set<string>(['/api/manifest'])

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

/** Cache court des jetons déjà vérifiés (best effort : peut être vide à chaque instance). */
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 500
type Verdict = { ok: boolean; email: string | null; admin: boolean | null; at: number }
const cache = new Map<string, Verdict>()

function secretsConnus(): string[] {
  return [
    process.env.CRON_SECRET,
    process.env.CLIENT_MAINTENANCE_SECRET,
    process.env.REPORT_PDF_RENDER_SECRET,
    process.env.INTERNAL_API_SECRET,
    process.env.BLG_SYNC_TRIGGER_SECRET,
  ]
    .map((value) => String(value || '').trim())
    .filter((value) => value.length >= 16)
}

/** Comparaison à durée constante (évite de deviner un secret caractère par caractère). */
function egal(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function bearer(req: NextRequest) {
  const header = req.headers.get('authorization') || ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

function appelMachineAutorise(req: NextRequest) {
  const secrets = secretsConnus()
  if (!secrets.length) return false
  const candidats = [
    bearer(req),
    req.headers.get('x-client-maintenance-secret') || '',
    req.headers.get('x-report-secret') || '',
    req.headers.get('x-internal-secret') || '',
    req.nextUrl.searchParams.get('secret') || '',
  ].filter(Boolean)
  return candidats.some((valeur) => secrets.some((secret) => egal(valeur, secret)))
}

function refuser(status: 401 | 403, message: string) {
  return NextResponse.json({ success: false, error: message }, { status })
}

function memoriser(token: string, verdict: Verdict) {
  if (cache.size >= CACHE_MAX) {
    const plusAncien = cache.keys().next().value
    if (plusAncien) cache.delete(plusAncien)
  }
  cache.set(token, verdict)
}

async function verifierSession(token: string, avecAdmin: boolean): Promise<Verdict> {
  const now = Date.now()
  const enCache = cache.get(token)
  if (enCache && now - enCache.at < CACHE_TTL_MS && (!avecAdmin || enCache.admin !== null)) {
    return enCache
  }

  const entetes = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: entetes, cache: 'no-store' })
  if (!userRes.ok) {
    const verdict: Verdict = { ok: false, email: null, admin: false, at: now }
    memoriser(token, verdict)
    return verdict
  }
  const user = (await userRes.json().catch(() => null)) as { email?: string } | null
  let admin: boolean | null = enCache?.admin ?? null

  if (avecAdmin && admin === null) {
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/todo_is_admin`, {
      method: 'POST',
      headers: { ...entetes, 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    })
    admin = rpcRes.ok ? (await rpcRes.json().catch(() => false)) === true : false
  }

  const verdict: Verdict = { ok: true, email: String(user?.email || '').toLowerCase() || null, admin, at: now }
  memoriser(token, verdict)
  return verdict
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // L'en-tête d'identité n'est jamais accepté tel qu'envoyé par l'appelant.
  const sansIdentite = () => {
    const headers = new Headers(req.headers)
    headers.delete('x-cegeclim-user-email')
    return NextResponse.next({ request: { headers } })
  }

  // Pré-requêtes CORS et routes publiques
  if (req.method === 'OPTIONS' || PUBLIC_PATHS.has(pathname)) return sansIdentite()

  // Appels machine (cron Vercel, workers internes, VPS) porteurs d'un secret
  if (appelMachineAutorise(req)) return sansIdentite()

  const token = bearer(req)
  if (!token) return refuser(401, 'Non authentifié : session requise.')

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes')
    return refuser(401, 'Configuration serveur incomplète.')
  }

  const estAdmin = pathname.startsWith('/api/admin/')

  let verdict: Verdict
  try {
    verdict = await verifierSession(token, estAdmin)
  } catch (error) {
    console.error('[proxy] vérification de session impossible', error)
    return refuser(401, 'Session non vérifiable, réessayez.')
  }

  if (!verdict.ok) return refuser(401, 'Session expirée ou invalide : reconnectez-vous.')
  if (estAdmin && !verdict.admin) return refuser(403, 'Accès réservé aux administrateurs.')

  // L'e-mail vérifié est transmis aux routes qui voudraient s'en servir.
  const headers = new Headers(req.headers)
  headers.set('x-cegeclim-user-email', verdict.email || '')
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: '/api/:path*',
}
