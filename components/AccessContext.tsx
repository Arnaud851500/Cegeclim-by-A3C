'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { peutVoirAllocationRo } from '@/lib/allocationRo'

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
  can_financement: boolean
  can_objectifs: boolean
  can_suivi_agences: boolean
  can_change_scope: boolean
  allowed_scopes: string[]
  allowed_agences: string[]
  allowed_collaborateurs: string[]
  allowed_departements: string[]
  allowed_codes_postaux: string[]
  display_name: string
  default_landing_page: string
  /** Profil principal : page d'accueil, disposition One Page, nom affiché. */
  profile_id: string | null
  profile_code: string
  /** Nom affiché : profil principal, suivi des profils complémentaires (« A + B »). */
  profile_name: string
  /** (2026-10-22) Tous les profils actifs appliqués : principal puis complémentaires. */
  profile_ids: string[]
  profile_names: string[]
  show_alert_cerfa_ko: boolean
  show_alert_cdc_liv_avant_2026: boolean
  show_alert_controle_frais_port: boolean
  show_alert_capacite_gaz: boolean
  show_alert_todo: boolean
  show_alert_data_coherence: boolean
  /** (2026-10-20) Alerte « Date de livraison interdite », indépendante de l'alerte CDC. */
  show_alert_dates_interdites: boolean
  /** (2026-10-24) Écran « Allocation AirH2O 600 / 800 » : liste nominative (lib/allocationRo.ts),
   * contrôlée aussi côté base (stock_alloc_ro_acces). */
  can_allocation_ro: boolean
  /** (2026-10-26) Droit de profil : écran Allocation limité aux agences du périmètre, en lecture. */
  can_allocation_airh2o: boolean
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
  profils_complementaires?: unknown
  can_financement?: boolean | null
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
  can_financement?: boolean | null
  can_objectifs?: boolean | null
  can_suivi_agences?: boolean | null
  can_change_scope?: boolean | null
  default_landing_page?: string | null
  show_alert_cerfa_ko?: boolean | null
  show_alert_cdc_liv_avant_2026?: boolean | null
  show_alert_controle_frais_port?: boolean | null
  show_alert_capacite_gaz?: boolean | null
  show_alert_todo?: boolean | null
  show_alert_data_coherence?: boolean | null
  show_alert_dates_interdites?: boolean | null
  can_allocation_airh2o?: boolean | null
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
  can_financement: false,
  can_objectifs: false,
  can_suivi_agences: false,
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
  profile_ids: [],
  profile_names: [],
  show_alert_cerfa_ko: false,
  show_alert_cdc_liv_avant_2026: false,
  show_alert_controle_frais_port: false,
  show_alert_capacite_gaz: false,
  show_alert_todo: false,
  show_alert_data_coherence: false,
  show_alert_dates_interdites: false,
  can_allocation_ro: false,
  can_allocation_airh2o: false,
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
  ['/financement', 'can_financement'],
  ['/suivi-agences', 'can_suivi_agences'],
  ['/objectifs', 'can_objectifs'],
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
  if (rights.can_financement) return '/financement'
  if (rights.can_suivi_agences) return '/suivi-agences'

  return '/unauthorized'
}

// (2026-10-22) Droits « écrans » et « pastilles » cumulables entre profils :
// un droit est accordé dès qu'UN des profils actifs de la personne l'accorde.
const PROFILE_FLAG_KEYS = [
  'can_dashboard',
  'can_territoire',
  'can_cartographie',
  'can_clients',
  'can_carte',
  'can_todo',
  'can_clients_cegeclim',
  'can_suivi_prospects',
  'can_agences',
  'can_autorisation',
  'can_documents',
  'can_stocks',
  'can_activites',
  'can_financement',
  'can_objectifs',
  'can_suivi_agences',
  'can_change_scope',
  'show_alert_cerfa_ko',
  'show_alert_cdc_liv_avant_2026',
  'show_alert_controle_frais_port',
  'show_alert_capacite_gaz',
  'show_alert_todo',
  'show_alert_data_coherence',
  'show_alert_dates_interdites',
  'can_allocation_airh2o',
] as const satisfies ReadonlyArray<keyof AccessRights & keyof AccessProfileRow>

function personalScope(userRow: UserAccessRow) {
  return {
    display_name: String(userRow.display_name || '').trim(),
    allowed_scopes: normalizeList(userRow.allowed_scopes, ['Global']),
    allowed_agences: normalizeList(userRow.allowed_agences, []),
    allowed_collaborateurs: normalizeList(userRow.allowed_collaborateurs, []),
    allowed_departements: normalizeList(userRow.allowed_departements, []),
    allowed_codes_postaux: normalizeList(userRow.allowed_codes_postaux, []),
  }
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

    // select('*') : tolère l'absence de colonnes récentes (profils_complementaires
    // tant que la migration 20261022 n'est pas passée).
    const { data: userData, error: userError } = await supabase
      .from('user_page_access')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (userError || !userData) {
      if (userError) console.error('ACCESS - lecture user_page_access', userError)
      return { email: normalizedEmail, rights: defaultRights }
    }

    const userRow = userData as UserAccessRow
    const scope = personalScope(userRow)
    const individualFinancement = !!userRow.can_financement

    const principalId = String(userRow.access_profile_id || '').trim()
    const complementaryIds = normalizeList(userRow.profils_complementaires, []).filter((id) => id !== principalId)
    const allIds = [principalId, ...complementaryIds].filter(Boolean)

    if (!allIds.length) {
      return {
        email: normalizedEmail,
        rights: { ...defaultRights, ...scope, can_financement: individualFinancement },
      }
    }

    const { data: profilesData, error: profilesError } = await supabase
      .from('access_profiles')
      .select('*')
      .in('id', allIds)

    if (profilesError) console.error('ACCESS - lecture access_profiles', profilesError)

    const profileById = new Map<string, AccessProfileRow>()
    ;((profilesData || []) as AccessProfileRow[]).forEach((row) => {
      if (row?.id) profileById.set(String(row.id), row)
    })

    const principal = principalId ? profileById.get(principalId) || null : null
    // Profils réellement appliqués : actifs, principal en tête.
    const applied = allIds
      .map((id) => profileById.get(id))
      .filter((row): row is AccessProfileRow => Boolean(row) && row!.is_active !== false)

    const merged: Partial<Record<(typeof PROFILE_FLAG_KEYS)[number], boolean>> = {}
    PROFILE_FLAG_KEYS.forEach((key) => {
      merged[key] = applied.some((row) => !!row[key])
    })

    const appliedNames = applied.map((row) => String(row.name || 'Profil sans nom').trim())

    let profileName: string
    if (!principalId) profileName = appliedNames.length ? appliedNames.join(' + ') : 'Aucun profil'
    else if (!principal) profileName = ['Profil introuvable', ...appliedNames].join(' + ')
    else if (principal.is_active === false) {
      profileName = [`${String(principal.name || 'Profil').trim()} (inactif)`, ...appliedNames].join(' + ')
    } else profileName = appliedNames.join(' + ')

    // Page d'accueil : celle du profil principal actif, sinon du premier profil
    // complémentaire qui en définit une autre que l'accueil.
    const landingSource =
      (principal && principal.is_active !== false ? principal : null) ||
      applied.find((row) => String(row.default_landing_page || '').trim() && row.default_landing_page !== '/accueil') ||
      null
    const landing = String(landingSource?.default_landing_page || '/accueil').trim() || '/accueil'

    return {
      email: normalizedEmail,
      rights: {
        ...defaultRights,
        ...merged,
        ...scope,
        can_financement: !!merged.can_financement || individualFinancement,
        default_landing_page: landing,
        profile_id: principalId || null,
        profile_code: String(principal?.code || '').trim(),
        profile_name: profileName,
        profile_ids: applied.map((row) => String(row.id)),
        profile_names: appliedNames,
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
    // Allocation AirH2O : vue complète (liste nominative) ou vue agence (droit de profil).
    setRights({ ...result.rights, can_allocation_ro: peutVoirAllocationRo(result.email) || result.rights.can_allocation_airh2o })
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
