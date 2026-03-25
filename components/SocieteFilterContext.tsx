'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type SocieteFilter = 'Global' | 'Cegeclim' | 'CVC PdL'

type SocieteFilterContextType = {
  societeFilter: SocieteFilter
  setSocieteFilter: (value: SocieteFilter) => void
}

const SocieteFilterContext = createContext<SocieteFilterContextType | undefined>(undefined)

export function SocieteFilterProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [societeFilter, setSocieteFilterState] = useState<SocieteFilter>('Global')

  useEffect(() => {
    const saved = localStorage.getItem('societeFilter') as SocieteFilter | null
    if (saved === 'Global' || saved === 'Cegeclim' || saved === 'CVC PdL') {
      setSocieteFilterState(saved)
    }
  }, [])

  const setSocieteFilter = (value: SocieteFilter) => {
    setSocieteFilterState(value)
    localStorage.setItem('societeFilter', value)
  }

  const value = useMemo(
    () => ({
      societeFilter,
      setSocieteFilter,
    }),
    [societeFilter]
  )

  return (
    <SocieteFilterContext.Provider value={value}>
      {children}
    </SocieteFilterContext.Provider>
  )
}

export function useSocieteFilter() {
  const context = useContext(SocieteFilterContext)
  if (!context) {
    throw new Error('useSocieteFilter must be used inside SocieteFilterProvider')
  }
  return context
}