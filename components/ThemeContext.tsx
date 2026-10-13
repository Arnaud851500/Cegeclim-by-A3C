'use client'

// ============================================================================
// components/ThemeContext.tsx — Préférence clair / sombre (13/10/2026)
// ----------------------------------------------------------------------------
// - mémorisée dans le navigateur (localStorage « cegeclim.theme ») ;
// - posée sur <html data-theme> (app/layout.tsx la pose déjà avant
//   l'affichage pour éviter un flash) ;
// - PC uniquement : sur mobile l'application reste sombre.
// ThemeToggle = sélecteur « Clair | Sombre » du bandeau.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type React from 'react'
import { useViewport } from '@/lib/useViewport'
import { THEME_STORAGE_KEY, type ThemeMode } from '@/lib/theme'

type ThemeContextValue = {
  /** Choix de l'utilisateur. */
  preference: ThemeMode
  /** Thème réellement appliqué (toujours sombre sur mobile). */
  theme: ThemeMode
  setPreference: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  preference: 'dark',
  theme: 'dark',
  setPreference: () => {},
})

// Préférence lue dans localStorage via un petit « store » externe : pas de
// setState dans un effet, et rendu serveur toujours en sombre (le script de
// app/layout.tsx a déjà posé data-theme avant l'affichage).
const THEME_EVENT = 'cegeclim:theme-changed'

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return 'dark'
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(THEME_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(THEME_EVENT, onChange)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isMobile } = useViewport()
  const preference = useSyncExternalStore<ThemeMode>(subscribe, readStored, () => 'dark')

  const theme: ThemeMode = isMobile ? 'dark' : preference

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setPreference = useCallback((mode: ThemeMode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode)
    } catch {
      // stockage indisponible (navigation privée) : on applique quand même
      document.documentElement.setAttribute('data-theme', mode)
    }
    window.dispatchEvent(new Event(THEME_EVENT))
  }, [])

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}

export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  const option = (mode: ThemeMode, label: string, icon: React.ReactNode) => {
    const active = preference === mode
    return (
      <button
        type="button"
        onClick={() => setPreference(mode)}
        aria-pressed={active}
        title={mode === 'light' ? 'Afficher en mode clair' : 'Afficher en mode sombre'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 11px',
          borderRadius: 999,
          border: 'none',
          cursor: active ? 'default' : 'pointer',
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          fontWeight: 600,
          background: active ? 'var(--cg-ink)' : 'transparent',
          color: active ? 'var(--cg-bg)' : 'rgba(var(--cg-ink-rgb), 0.62)',
          transition: 'background 0.16s ease, color 0.16s ease',
        }}
      >
        {icon}
        {label}
      </button>
    )
  }

  return (
    <div
      role="group"
      aria-label="Thème d'affichage"
      style={{
        display: 'inline-flex',
        padding: 3,
        borderRadius: 999,
        border: '1px solid rgba(var(--cg-ink-rgb), 0.16)',
        background: 'rgba(var(--cg-ink-rgb), 0.04)',
        flexShrink: 0,
      }}
    >
      {option('light', 'Clair', <SunIcon />)}
      {option('dark', 'Sombre', <MoonIcon />)}
    </div>
  )
}
