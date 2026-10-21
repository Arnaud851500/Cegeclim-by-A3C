'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type PageFilterAccess = {
  email: string | null
  loading: boolean
  profileId: string | null
  profileName: string
  allowedAgences: string[]
  allowedCollaborateurs: string[]
  allowedDepartements: string[]
  allowedCodesPostaux: string[]
  hasAgenceRestriction: boolean
  hasCollaborateurRestriction: boolean
  hasDepartementRestriction: boolean
  hasCodePostalRestriction: boolean
  accessBadge: string
  error: string | null
}

const EMPTY_ACCESS: PageFilterAccess = {
  email: null,
  loading: true,
  profileId: null,
  profileName: '',
  allowedAgences: [],
  allowedCollaborateurs: [],
  allowedDepartements: [],
  allowedCodesPostaux: [],
  hasAgenceRestriction: false,
  hasCollaborateurRestriction: false,
  hasDepartementRestriction: false,
  hasCodePostalRestriction: false,
  accessBadge: '',
  error: null,
}

function normalizeKey(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

export function normalizeAccessList(value: unknown): string[] {
  if (value === null || value === undefined) return []

  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .flatMap((item) => normalizeAccessList(item))
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    )
  }

  if (typeof value === 'object') {
    return normalizeAccessList(Object.values(value as Record<string, unknown>))
  }

  const text = String(value || '').trim()
  if (!text) return []

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      return normalizeAccessList(JSON.parse(text))
    } catch {
      // On continue avec le découpage texte.
    }
  }

  return Array.from(
    new Set(
      text
        .split(/[;,|\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function restrictOptions(options: string[], allowedValues: string[]) {
  const allowedKeys = new Set(allowedValues.map(normalizeKey).filter(Boolean))
  if (allowedKeys.size === 0) return options

  return options.filter((option) => allowedKeys.has(normalizeKey(option)))
}

export function isAllowedByList(value: unknown, allowedValues: string[]) {
  const allowedKeys = new Set(allowedValues.map(normalizeKey).filter(Boolean))
  if (allowedKeys.size === 0) return true
  return allowedKeys.has(normalizeKey(value))
}

export function firstAllowedValue(allowedValues: string[]) {
  return allowedValues.length > 0 ? allowedValues[0] : ''
}

export function forcedSingleFilterValue(currentValue: string, allowedValues: string[]) {
  if (allowedValues.length === 0) return currentValue
  if (allowedValues.length === 1) return allowedValues[0]
  return ''
}

export function lockedFilterLabel(values: string[], emptyLabel: string) {
  if (values.length === 0) return emptyLabel
  if (values.length === 1) return `${values[0]} 🔒`
  return `${values.length} valeurs autorisées 🔒`
}

export function accessLockedSelectClassName(baseClassName: string, locked: boolean) {
  return locked
    ? `${baseClassName} cursor-not-allowed bg-slate-100 text-slate-500 opacity-90`
    : baseClassName
}

export function usePageFilterAccess() {
  const [state, setState] = useState<PageFilterAccess>(EMPTY_ACCESS)

  useEffect(() => {
    let cancelled = false

    async function loadAccess() {
      setState((previous) => ({ ...previous, loading: true, error: null }))

      try {
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError

        const email = String(userData?.user?.email || '').toLowerCase().trim()
        if (!email) {
          if (!cancelled) setState({ ...EMPTY_ACCESS, loading: false })
          return
        }

        // select('*') : tolère l'absence de profils_complementaires avant migration.
        const { data, error } = await supabase
          .from('user_page_access')
          .select('*')
          .eq('email', email)
          .maybeSingle()

        if (error) throw error

        const profileId = String((data as any)?.access_profile_id || '').trim() || null
        const complementaryIds = normalizeAccessList((data as any)?.profils_complementaires).filter((id) => id !== profileId)
        const allIds = [profileId, ...complementaryIds].filter(Boolean) as string[]
        let profileName = ''

        if (allIds.length) {
          const { data: profileData, error: profileError } = await supabase
            .from('access_profiles')
            .select('id, name, is_active')
            .in('id', allIds)

          if (profileError) throw profileError
          const byId = new Map(((profileData || []) as any[]).map((row) => [String(row.id), row]))
          // (2026-10-22) Profil principal puis profils complémentaires actifs.
          profileName = allIds
            .map((id) => byId.get(id))
            .filter((row) => row && (row.id === profileId || row.is_active !== false))
            .map((row) => String(row.name || '').trim())
            .filter(Boolean)
            .join(' + ')
        }

        const allowedAgences = normalizeAccessList((data as any)?.allowed_agences)
        const allowedCollaborateurs = normalizeAccessList((data as any)?.allowed_collaborateurs)
        const allowedDepartements = normalizeAccessList((data as any)?.allowed_departements)
        const allowedCodesPostaux = normalizeAccessList((data as any)?.allowed_codes_postaux)

        const badges = [
          profileName ? `Profil: ${profileName}` : '',
          allowedAgences.length ? `Agences: ${allowedAgences.join(', ')}` : '',
          allowedCollaborateurs.length ? `Collaborateurs: ${allowedCollaborateurs.join(', ')}` : '',
          allowedCodesPostaux.length ? `CP: ${allowedCodesPostaux.join(', ')}` : '',
          allowedDepartements.length ? `Dép.: ${allowedDepartements.join(', ')}` : '',
        ].filter(Boolean)

        if (!cancelled) {
          setState({
            email,
            loading: false,
            profileId,
            profileName,
            allowedAgences,
            allowedCollaborateurs,
            allowedDepartements,
            allowedCodesPostaux,
            hasAgenceRestriction: allowedAgences.length > 0,
            hasCollaborateurRestriction: allowedCollaborateurs.length > 0,
            hasDepartementRestriction: allowedDepartements.length > 0,
            hasCodePostalRestriction: allowedCodesPostaux.length > 0,
            accessBadge: badges.join(' · '),
            error: null,
          })
        }
      } catch (exception: any) {
        if (!cancelled) {
          setState({
            ...EMPTY_ACCESS,
            loading: false,
            error: exception?.message || String(exception),
          })
        }
      }
    }

    void loadAccess()

    const { data } = supabase.auth.onAuthStateChange(() => {
      void loadAccess()
    })

    const handleAccessChanged = () => void loadAccess()
    window.addEventListener('cegeclim:access-changed', handleAccessChanged)

    return () => {
      cancelled = true
      data.subscription.unsubscribe()
      window.removeEventListener('cegeclim:access-changed', handleAccessChanged)
    }
  }, [])

  return useMemo(() => state, [state])
}
