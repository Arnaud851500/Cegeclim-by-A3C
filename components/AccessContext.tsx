'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
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
}

type AccessContextType = {
  loading: boolean
  email: string | null
  rights: AccessRights
  refreshAccess: () => Promise<void>
}

function normalizeList(value: unknown, fallback: string[] = []): string[] {
  if (value === null || value === undefined) return fallback

  if (Array.isArray(value)) {
    const values: string[] = value
      .flatMap((item: unknown): string[] => normalizeList(item, []))
      .map((item: string): string => String(item || '').trim())
      .filter((item: string): boolean => Boolean(item))

    return values.length ? Array.from(new Set(values)) : fallback
  }

  const text = String(value || '').trim()
  if (!text) return fallback

  const values = text
    .split(/[;,|\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

  return values.length ? Array.from(new Set(values)) : fallback
}

const defaultRights: AccessRights = {
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
}

const AccessContext = createContext<AccessContextType>({
  loading: true,
  email: null,
  rights: defaultRights,
  refreshAccess: async () => {},
})

export function getFirstAllowedPath(rights: AccessRights) {
  if (rights.default_landing_page && rights.default_landing_page !== '/accueil') {
    return rights.default_landing_page
  }

  if (rights.can_dashboard) return '/indicateurs'
  if (rights.can_territoire) return '/territoire'
  if (rights.can_cartographie) return '/cartographie'
  if (rights.can_clients) return '/clients'
  if (rights.can_todo) return '/todo'
  if (rights.can_carte) return '/carte'
  if (rights.can_clients_cegeclim) return '/clients_cegeclim'
  if (rights.can_suivi_prospects) return '/suivi_prospects'
  if (rights.can_agences) return '/agences'
  if (rights.can_autorisation) return '/autorisation'
  if (rights.can_activites) return '/activites'
  if (rights.can_documents) return '/documents'
  if (rights.can_stocks) return '/stocks'

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

    const { data, error } = await supabase
      .from('user_page_access')
      .select(`
        email,
        can_dashboard,
        can_territoire,
        can_cartographie,
        can_clients,
        can_todo,
        can_carte,
        can_clients_cegeclim,
        can_suivi_prospects,
        can_agences,
        can_autorisation,
        can_documents,
        can_stocks,
        can_activites,
        can_change_scope,
        allowed_scopes,
        allowed_agences,
        allowed_collaborateurs,
        allowed_departements,
        allowed_codes_postaux,
        display_name,
        default_landing_page
      `)
      .eq('email', normalizedEmail)
      .maybeSingle()

    console.log('ACCESS - session email =', normalizedEmail)
    console.log('ACCESS - query data =', data)
    console.log('ACCESS - query error =', error)

    if (error || !data) {
      return { email: normalizedEmail, rights: defaultRights }
    }

    return {
      email: normalizedEmail,
      rights: {
        can_dashboard: !!data.can_dashboard,
        can_territoire: !!data.can_territoire,
        can_cartographie: !!data.can_cartographie,
        can_clients: !!data.can_clients,
        can_carte: !!data.can_carte,
        can_todo: !!data.can_todo,
        can_clients_cegeclim: !!data.can_clients_cegeclim,
        can_suivi_prospects: !!data.can_suivi_prospects,
        can_agences: !!data.can_agences,
        can_autorisation: !!data.can_autorisation,
        can_documents: !!data.can_documents,
        can_stocks: !!data.can_stocks,
        can_activites: !!data.can_activites,
        can_change_scope: !!data.can_change_scope,
        allowed_scopes: normalizeList(data.allowed_scopes, ['Global']),
        allowed_agences: normalizeList(data.allowed_agences, []),
        allowed_collaborateurs: normalizeList(data.allowed_collaborateurs, []),
        allowed_departements: normalizeList(data.allowed_departements, []),
        allowed_codes_postaux: normalizeList(data.allowed_codes_postaux, []),
        display_name: String(data.display_name || '').trim(),
        default_landing_page:
          String(data.default_landing_page || '/accueil').trim() || '/accueil',
      },
    }
  } catch (err) {
    console.error('ACCESS - erreur inattendue', err)
    return { email: null, rights: defaultRights }
  }
}

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [rights, setRights] = useState<AccessRights>(defaultRights)

  const refreshAccess = async () => {
    setLoading(true)
    const res = await fetchAccess()
    setEmail(res.email)
    setRights(res.rights)
    setLoading(false)
  }

  useEffect(() => {
    refreshAccess()

    const { data } = supabase.auth.onAuthStateChange(() => {
      refreshAccess()
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  return (
    <AccessContext.Provider value={{ loading, email, rights, refreshAccess }}>
      {children}
    </AccessContext.Provider>
  )
}

export function useAccess() {
  return useContext(AccessContext)
}