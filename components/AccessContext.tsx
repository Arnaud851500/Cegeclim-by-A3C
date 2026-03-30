'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type AccessRights = {
  can_dashboard: boolean
  can_territoire: boolean
  can_cartographie: boolean
  can_clients: boolean
  can_agences: boolean
  can_autorisation: boolean
  can_documents: boolean
  can_stocks: boolean
  can_activites: boolean
  can_change_scope: boolean
  allowed_scopes: string[]
}

type AccessContextType = {
  loading: boolean
  email: string | null
  rights: AccessRights
  refreshAccess: () => Promise<void>
}

const defaultRights: AccessRights = {
  can_dashboard: false,
  can_territoire: false,
  can_cartographie: false,
  can_clients: false,
  can_agences: false,
  can_autorisation: false,
  can_documents: false,
  can_stocks: false,
  can_activites: false,
  can_change_scope: false,
  allowed_scopes: ['Global'],
}

const AccessContext = createContext<AccessContextType>({
  loading: true,
  email: null,
  rights: defaultRights,
  refreshAccess: async () => {},
})

export function getFirstAllowedPath(rights: AccessRights) {
  if (rights.can_dashboard) return '/dashboard'
  if (rights.can_territoire) return '/territoire'
  if (rights.can_cartographie) return '/cartographie'
  if (rights.can_clients) return '/clients'
  if (rights.can_agences) return '/agences'
  if (rights.can_autorisation) return '/autorisation'
  if (rights.can_activites) return '/activites'
  if (rights.can_documents) return '/documents'
  if (rights.can_stocks) return '/stocks'
  return '/unauthorized'
}

async function fetchAccess() {
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
        can_agences,
        can_autorisation,
        can_documents,
        can_stocks,
        can_activites,
        can_change_scope,
        allowed_scopes
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
        can_agences: !!data.can_agences,
        can_autorisation: !!data.can_autorisation,
        can_documents: !!data.can_documents,
        can_stocks: !!data.can_stocks,
        can_activites: !!data.can_activites,
        can_change_scope: !!data.can_change_scope,
        allowed_scopes:
          Array.isArray(data.allowed_scopes) && data.allowed_scopes.length > 0
            ? data.allowed_scopes
            : ['Global'],
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