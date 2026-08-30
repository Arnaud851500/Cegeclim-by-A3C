'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type AccessRights = {
  can_dashboard: boolean
  can_territoire: boolean
  can_cartographie: boolean
  can_clients: boolean
  can_carte: boolean
  can_todo: boolean
  can_clients_cegeclim: boolean
  can_suivi_prospects: boolean
  can_agences: boolean
  can_autorisation: boolean
  can_documents: boolean
  can_stocks: boolean
  can_activites: boolean
  can_change_scope: boolean
  allowed_scopes: string[]
  allowed_agences: string[]
  allowed_collaborateurs: string[]
  allowed_departements: string[]
  allowed_codes_postaux: string[]
  display_name: string
  default_landing_page: string
  profile_id: string | null
  profile_code: string
  profile_name: string
  show_alert_cerfa_ko: boolean
  show_alert_cdc_liv_avant_2026: boolean
  show_alert_controle_frais_port: boolean
  show_alert_capacite_gaz: boolean
  show_alert_todo: boolean
  show_alert_data_coherence: boolean
}

type AccessContextType = {
  loading: boolean
  email: string | null
  rights: AccessRights
  refreshAccess: () => Promise<void>
}

type UserAccessRow = {
  email?: string | null
  display_name?: string | null
  allowed_scopes?: unknown
  allowed_agences?: unknown
  allowed_collaborateurs?: unknown
  allowed_departements?: unknown
  allowed_codes_postaux?: unknown
  access_profile_id?: string | null
}

type AccessProfileRow = {
  id?: string | null
  code?: string | null
  name?: string | null
  is_active?: boolean | null
  can_dashboard?: boolean | null
  can_territoire?: boolean | null
  can_cartographie?: boolean | null
  can_clients?: boolean | null
  can_carte?: boolean | null
  can_todo?: boolean | null
  can_clients_cegeclim?: boolean | null
  can_suivi_prospects?: boolean | null
  can_agences?: boolean | null
  can_autorisation?: boolean | null
  can_documents?: boolean | null
  can_stocks?: boolean | null
  can_activites?: boolean | null
  can_change_scope?: boolean | null
  default_landing_page?: string | null
  show_alert_cerfa_ko?: boolean | null
  show_alert_cdc_liv_avant_2026?: boolean | null
  show_alert_controle_frais_port?: boolean | null
  show_alert_capacite_gaz?: boolean | null
  show_alert_todo?: boolean | null
  show_alert_data_coherence?: boolean | null
}

function normalizeList(value: unknown, fallback: string[] = []): string[] {
  if (value === null || value === undefined) return fallback

  if (Array.isArray(value)) {
    const values = value
      .flatMap((item) => normalizeList(item, []))
      .map((item) => String(item || '').trim())
      .filter(Boolean)

    return values.length ? Array.from(new Set(values)) : fallback
  }

  if (typeof value === 'object') {
    return normalizeList(Object.values(value as Record<string, unknown>), fallback)
  }

  const text = String(value || '').trim()
  if (!text) return fallback

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      return normalizeList(JSON.parse(text), fallback)
    } catch {
      // On poursuit avec le découpage texte.
    }
  }

  const values = text
    .split(/[;,|\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

  return values.length ? Array.from(new Set(values)) : fallback
}

export const defaultRights: AccessRights = {
  can_dashboard: false,
  can_territoire: false,
  can_cartographie: false,
  can_clients: false,
  can_carte: false,
  can_todo: false,
  can_clients_cegeclim: false,
  can_suivi_prospects: false,
  can_agences: false,
  can_autorisation: false,
  can_documents: false,
  can_stocks: false,
  can_activites: false,
  can_change_scope: false,
  allowed_scopes: ['Global'],
  allowed_agences: [],
  allowed_collaborateurs: [],
  allowed_departements: [],
  allowed_codes_postaux: [],
  display_name: '',
  default_landing_page: '/accueil',
  profile_id: null,
  profile_code: '',
  profile_name: 'Aucun profil',
  show_alert_cerfa_ko: false,
  show_alert_cdc_liv_avant_2026: false,
  show_alert_controle_frais_port: false,
  show_alert_capacite_gaz: false,
  show_alert_todo: false,
  show_alert_data_coherence: false,
}

const AccessContext = createContext<AccessContextType>({
  loading: true,
  email: null,
  rights: defaultRights,
  refreshAccess: async () => {},
})

const PAGE_ACCESS_CHECKS: Array<[string, keyof AccessRights]> = [
  ['/indicateurs', 'can_dashboard'],
  ['/Indicateurs', 'can_dashboard'],
  ['/approvisionnements', 'can_dashboard'],
  ['/portefeuille-livraison', 'can_dashboard'],
  ['/synthese_multi_clients', 'can_dashboard'],
  ['/focus_mensuel', 'can_dashboard'],
  ['/territoire', 'can_territoire'],
  ['/cartographie', 'can_cartographie'],
  ['/clients', 'can_autorisation'],
  ['/carte', 'can_carte'],
  ['/todo', 'can_todo'],
  ['/clients_cegeclim', 'can_clients_cegeclim'],
  ['/suivi_prospects', 'can_suivi_prospects'],
  ['/agences', 'can_agences'],
  ['/autorisation', 'can_autorisation'],
  ['/admin/planification', 'can_autorisation'],
  ['/Import', 'can_autorisation'],
  ['/cycle-documents', 'can_autorisation'],
  ['/atelier-analyse', 'can_autorisation'],
  ['/documents', 'can_documents'],
  ['/stocks', 'can_stocks'],
  ['/stocks-disponibilites', 'can_stocks'],
  ['/activites', 'can_activites'],
]

function isPathAllowed(path: string, rights: AccessRights) {
  if (!path || path === '/accueil') return true
  const match = PAGE_ACCESS_CHECKS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  if (!match) return true
  return Boolean(rights[match[1]])
}

export function getFirstAllowedPath(rights: AccessRights) {
  const requestedLandingPage = String(rights.default_landing_page || '').trim()
  if (requestedLandingPage && requestedLandingPage !== '/accueil' && isPathAllowed(requestedLandingPage, rights)) {
    return requestedLandingPage
  }

  if (rights.can_dashboard) return '/indicateurs'
  if (rights.can_territoire) return '/territoire'
  if (rights.can_cartographie) return '/cartographie'
  if (rights.can_clients) return '/accueil'
  if (rights.can_carte) return '/carte'
  if (rights.can_todo) return '/todo'
  if (rights.can_clients_cegeclim) return '/clients_cegeclim'
  if (rights.can_suivi_prospects) return '/suivi_prospects'
  if (rights.can_agences) return '/agences'
  if (rights.can_autorisation) return '/autorisation'
  if (rights.can_activites) return '/activites'
  if (rights.can_documents) return '/documents'
  if (rights.can_stocks) return '/stocks-disponibilites'

  return '/unauthorized'
}

async function fetchAccess(): Promise<{ email: string | null; rights: AccessRights }> {
  try {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      console.error('ACCESS - erreur getSession()', sessionError)
      return { email: null, rights: defaultRights }
    }

    if (!session?.user?.email) {
      return { email: null, rights: defaultRights }
    }

    const normalizedEmail = session.user.email.toLowerCase().trim()

    const { data: userData, error: userError } = await supabase
      .from('user_page_access')
      .select(`
        email,
        display_name,
        allowed_scopes,
        allowed_agences,
        allowed_collaborateurs,
        allowed_departements,
        allowed_codes_postaux,
        access_profile_id
      `)
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (userError || !userData) {
      if (userError) console.error('ACCESS - lecture user_page_access', userError)
      return { email: normalizedEmail, rights: defaultRights }
    }

    const userRow = userData as UserAccessRow
    const profileId = String(userRow.access_profile_id || '').trim()
    if (!profileId) {
      return {
        email: normalizedEmail,
        rights: {
          ...defaultRights,
          display_name: String(userRow.display_name || '').trim(),
          allowed_scopes: normalizeList(userRow.allowed_scopes, ['Global']),
          allowed_agences: normalizeList(userRow.allowed_agences, []),
          allowed_collaborateurs: normalizeList(userRow.allowed_collaborateurs, []),
          allowed_departements: normalizeList(userRow.allowed_departements, []),
          allowed_codes_postaux: normalizeList(userRow.allowed_codes_postaux, []),
        },
      }
    }

    const { data: profileData, error: profileError } = await supabase
      .from('access_profiles')
      .select(`
        id,
        code,
        name,
        is_active,
        can_dashboard,
        can_territoire,
        can_cartographie,
        can_clients,
        can_carte,
        can_todo,
        can_clients_cegeclim,
        can_suivi_prospects,
        can_agences,
        can_autorisation,
        can_documents,
        can_stocks,
        can_activites,
        can_change_scope,
        default_landing_page,
        show_alert_cerfa_ko,
        show_alert_cdc_liv_avant_2026,
        show_alert_controle_frais_port,
        show_alert_capacite_gaz,
        show_alert_todo,
        show_alert_data_coherence
      `)
      .eq('id', profileId)
      .maybeSingle()

    if (profileError || !profileData) {
      if (profileError) console.error('ACCESS - lecture access_profiles', profileError)
      return {
        email: normalizedEmail,
        rights: {
          ...defaultRights,
          display_name: String(userRow.display_name || '').trim(),
          allowed_scopes: normalizeList(userRow.allowed_scopes, ['Global']),
          allowed_agences: normalizeList(userRow.allowed_agences, []),
          allowed_collaborateurs: normalizeList(userRow.allowed_collaborateurs, []),
          allowed_departements: normalizeList(userRow.allowed_departements, []),
          allowed_codes_postaux: normalizeList(userRow.allowed_codes_postaux, []),
          profile_id: profileId,
          profile_name: 'Profil introuvable',
        },
      }
    }

    const profile = profileData as AccessProfileRow
    if (profile.is_active === false) {
      return {
        email: normalizedEmail,
        rights: {
          ...defaultRights,
          display_name: String(userRow.display_name || '').trim(),
          allowed_scopes: normalizeList(userRow.allowed_scopes, ['Global']),
          allowed_agences: normalizeList(userRow.allowed_agences, []),
          allowed_collaborateurs: normalizeList(userRow.allowed_collaborateurs, []),
          allowed_departements: normalizeList(userRow.allowed_departements, []),
          allowed_codes_postaux: normalizeList(userRow.allowed_codes_postaux, []),
          profile_id: profileId,
          profile_code: String(profile.code || '').trim(),
          profile_name: `${String(profile.name || 'Profil').trim()} (inactif)`,
        },
      }
    }

    return {
      email: normalizedEmail,
      rights: {
        can_dashboard: !!profile.can_dashboard,
        can_territoire: !!profile.can_territoire,
        can_cartographie: !!profile.can_cartographie,
        can_clients: !!profile.can_clients,
        can_carte: !!profile.can_carte,
        can_todo: !!profile.can_todo,
        can_clients_cegeclim: !!profile.can_clients_cegeclim,
        can_suivi_prospects: !!profile.can_suivi_prospects,
        can_agences: !!profile.can_agences,
        can_autorisation: !!profile.can_autorisation,
        can_documents: !!profile.can_documents,
        can_stocks: !!profile.can_stocks,
        can_activites: !!profile.can_activites,
        can_change_scope: !!profile.can_change_scope,
        allowed_scopes: normalizeList(userRow.allowed_scopes, ['Global']),
        allowed_agences: normalizeList(userRow.allowed_agences, []),
        allowed_collaborateurs: normalizeList(userRow.allowed_collaborateurs, []),
        allowed_departements: normalizeList(userRow.allowed_departements, []),
        allowed_codes_postaux: normalizeList(userRow.allowed_codes_postaux, []),
        display_name: String(userRow.display_name || '').trim(),
        default_landing_page: String(profile.default_landing_page || '/accueil').trim() || '/accueil',
        profile_id: String(profile.id || profileId),
        profile_code: String(profile.code || '').trim(),
        profile_name: String(profile.name || 'Profil sans nom').trim(),
        show_alert_cerfa_ko: !!profile.show_alert_cerfa_ko,
        show_alert_cdc_liv_avant_2026: !!profile.show_alert_cdc_liv_avant_2026,
        show_alert_controle_frais_port: !!profile.show_alert_controle_frais_port,
        show_alert_capacite_gaz: !!profile.show_alert_capacite_gaz,
        show_alert_todo: !!profile.show_alert_todo,
        show_alert_data_coherence: !!profile.show_alert_data_coherence,
      },
    }
  } catch (error) {
    console.error('ACCESS - erreur inattendue', error)
    return { email: null, rights: defaultRights }
  }
}

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [rights, setRights] = useState<AccessRights>(defaultRights)

  const refreshAccess = useCallback(async () => {
    setLoading(true)
    const result = await fetchAccess()
    setEmail(result.email)
    setRights(result.rights)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refreshAccess()

    const { data } = supabase.auth.onAuthStateChange(() => {
      void refreshAccess()
    })

    const handleAccessChanged = () => void refreshAccess()
    const handleWindowFocus = () => void refreshAccess()

    window.addEventListener('cegeclim:access-changed', handleAccessChanged)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      data.subscription.unsubscribe()
      window.removeEventListener('cegeclim:access-changed', handleAccessChanged)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [refreshAccess])

  return (
    <AccessContext.Provider value={{ loading, email, rights, refreshAccess }}>
      {children}
    </AccessContext.Provider>
  )
}

export function useAccess() {
  return useContext(AccessContext)
}
