'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useAccess } from '@/components/AccessContext'

export type SocieteFilter = string

type SocieteFilterContextType = {
  societeFilter: SocieteFilter
  setSocieteFilter: (value: SocieteFilter) => void
  availableScopes: string[]
}

const DEFAULT_SCOPE = 'Global'
const STORAGE_KEY = 'a3c_societe_filter'

const SocieteFilterContext = createContext<SocieteFilterContextType>({
  societeFilter: DEFAULT_SCOPE,
  setSocieteFilter: () => {},
  availableScopes: [DEFAULT_SCOPE],
})

function normalizeScope(value: string | null | undefined): string {
  return String(value || '').trim()
}

export function SocieteFilterProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { loading, rights, email } = useAccess()

  const availableScopes = useMemo(() => {
    const scopes =
      Array.isArray(rights.allowed_scopes) && rights.allowed_scopes.length > 0
        ? rights.allowed_scopes.map((s) => normalizeScope(s)).filter(Boolean)
        : [DEFAULT_SCOPE]

    const uniqueScopes = Array.from(new Set(scopes))

    return uniqueScopes.length > 0 ? uniqueScopes : [DEFAULT_SCOPE]
  }, [rights.allowed_scopes])

  const [societeFilter, setSocieteFilterState] = useState<SocieteFilter>(DEFAULT_SCOPE)

  // Chargement initial depuis localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return

    const saved = normalizeScope(window.localStorage.getItem(STORAGE_KEY))
    if (saved) {
      setSocieteFilterState(saved)
    } else {
      setSocieteFilterState(DEFAULT_SCOPE)
    }
  }, [])

  // Sécurisation : si le scope courant n'est pas autorisé pour l'utilisateur connecté,
  // on le remplace immédiatement par le premier scope autorisé.
  useEffect(() => {
    if (loading) return

    const normalizedCurrent = normalizeScope(societeFilter)
    const normalizedAllowed = availableScopes.map((s) => normalizeScope(s))

    const currentIsAllowed = normalizedAllowed.includes(normalizedCurrent)

    const nextScope = currentIsAllowed
      ? normalizedCurrent
      : normalizedAllowed[0] || DEFAULT_SCOPE

    if (nextScope !== normalizedCurrent) {
      setSocieteFilterState(nextScope)
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextScope)
    }
  }, [loading, email, availableScopes, societeFilter])

  const setSocieteFilter = (value: SocieteFilter) => {
    const normalizedValue = normalizeScope(value)
    const normalizedAllowed = availableScopes.map((s) => normalizeScope(s))

    const nextScope = normalizedAllowed.includes(normalizedValue)
      ? normalizedValue
      : normalizedAllowed[0] || DEFAULT_SCOPE

    setSocieteFilterState(nextScope)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, nextScope)
    }
  }

  return (
    <SocieteFilterContext.Provider
      value={{
        societeFilter,
        setSocieteFilter,
        availableScopes,
      }}
    >
      {children}
    </SocieteFilterContext.Provider>
  )
}

export function useSocieteFilter() {
  return useContext(SocieteFilterContext)
}