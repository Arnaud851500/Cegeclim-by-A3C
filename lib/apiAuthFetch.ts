// ============================================================================
// lib/apiAuthFetch.ts — jeton de session ajouté aux appels /api (09/11/2026)
// ----------------------------------------------------------------------------
// Depuis le 09/11/2026, proxy.ts refuse tout appel /api sans session Supabase
// (en-tête Authorization: Bearer <access_token>). Plutôt que de modifier la
// soixantaine d'appels fetch('/api/…') du code, ce module enveloppe
// window.fetch une seule fois : pour toute requête vers une route /api du même
// site qui n'a pas déjà d'en-tête Authorization, il ajoute le jeton de la
// session en cours. Les autres requêtes (Supabase, Google, fichiers…) ne
// sont pas touchées.
//
// Installé par un import en tête de app/ClientRootShell.tsx.
// ============================================================================

import { supabase } from '@/lib/supabaseClient'

const MARQUEUR = '__cegeclimApiAuthFetch'

function estRouteApiLocale(url: URL) {
  return url.origin === window.location.origin && url.pathname.startsWith('/api/')
}

function urlDe(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href)
    if (input instanceof URL) return input
    return new URL(input.url, window.location.href)
  } catch {
    return null
  }
}

async function jetonCourant(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || null
  } catch {
    return null
  }
}

export function installerApiAuthFetch() {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { [MARQUEUR]?: boolean }
  if (w[MARQUEUR]) return
  w[MARQUEUR] = true

  const fetchOriginal = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlDe(input)
    if (!url || !estRouteApiLocale(url)) return fetchOriginal(input, init)

    // En-têtes existants : ceux de init priment, sinon ceux de la Request.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.has('authorization')) return fetchOriginal(input, init)

    const token = await jetonCourant()
    if (!token) return fetchOriginal(input, init)

    headers.set('Authorization', `Bearer ${token}`)

    if (input instanceof Request) {
      return fetchOriginal(new Request(input, { ...init, headers }))
    }
    return fetchOriginal(input, { ...init, headers })
  }
}

installerApiAuthFetch()
