'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type AccessRights = {
  can_dashboard: boolean
  can_territoire: boolean
  can_cartographie: boolean
  can_clients: boolean
  can_agences: boolean
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
  return '/unauthorized'
}

async function fetchAccess() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return { email: null, rights: defaultRights }
  }

  const email = user.email.toLowerCase().trim()

  const { data } = await supabase
    .from('user_page_access')
    .select('*')
    .ilike('email', email)
    .maybeSingle()

  if (!data) {
    return { email, rights: defaultRights }
  }

  return {
    email,
    rights: {
      can_dashboard: !!data.can_dashboard,
      can_territoire: !!data.can_territoire,
      can_cartographie: !!data.can_cartographie,
      can_clients: !!data.can_clients,
      can_agences: !!data.can_agences,
      can_change_scope: !!data.can_change_scope,
      allowed_scopes: data.allowed_scopes || ['Global'],
    },
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

    return () => data.subscription.unsubscribe()
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