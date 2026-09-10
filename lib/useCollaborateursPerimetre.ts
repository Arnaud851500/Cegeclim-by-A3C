'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * Liste des collaborateurs proposables dans un filtre "Collaborateur"
 * mobile, en fonction du périmètre de l'utilisateur connecté
 * (user_page_access) -- règle demandée le 2026-09-10 :
 *
 *  - allowed_collaborateurs non vide  -> exactement ces collaborateurs ;
 *  - sinon allowed_agences non vide   -> tous les collaborateurs rattachés
 *    à ces agences (ref_collaborateurs) -- ex. Vassili autorisé sur une
 *    agence voit tous les commerciaux de cette agence ;
 *  - sinon (Administrateur, périmètre national) -> tous les collaborateurs.
 *
 * Utilisé par MobileActivite.tsx et MobileClients.tsx.
 */

export type PerimetreCollaborateurs = { agences: string[]; collaborateurs: string[] }

export function normalizeComparable(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function pick(row: Record<string, any> | null | undefined, keys: string[]): string {
  if (!row) return ''
  for (const key of keys) {
    const v = row[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

/** Même logique de rapprochement souple que le bandeau desktop
 * (agenceMatchesAllowed dans ClientRootShell.tsx) : égalité ou inclusion
 * dans un sens ou dans l'autre, insensible à la casse/accents. */
export function agenceMatchesAllowed(agence: string, allowed: string[]): boolean {
  if (!allowed.length) return true
  const a = normalizeComparable(agence)
  if (!a) return false
  return allowed.some((x) => {
    const b = normalizeComparable(x)
    return Boolean(b) && (a === b || a.includes(b) || b.includes(a))
  })
}

/** true si `collaborateur` correspond au filtre `filtre` (souple). */
export function collaborateurMatches(collaborateur: string, filtre: string): boolean {
  if (!filtre) return true
  const a = normalizeComparable(collaborateur)
  const b = normalizeComparable(filtre)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

export function useCollaborateursPerimetre(perimetre: PerimetreCollaborateurs | null) {
  const [collaborateurs, setCollaborateurs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const agencesKey = (perimetre?.agences || []).join('|')
  const collaborateursKey = (perimetre?.collaborateurs || []).join('|')
  const ready = perimetre !== null

  useEffect(() => {
    if (!ready) return
    const allowedCollabs = collaborateursKey ? collaborateursKey.split('|').filter(Boolean) : []
    const allowedAgences = agencesKey ? agencesKey.split('|').filter(Boolean) : []

    // Cas 1 : liste explicite de collaborateurs -> pas besoin d'aller en base.
    if (allowedCollabs.length > 0) {
      setCollaborateurs(Array.from(new Set(allowedCollabs)).sort((a, b) => a.localeCompare(b, 'fr')))
      setLoading(false)
      return
    }

    let cancelled = false
    async function charger() {
      setLoading(true)
      const { data, error } = await supabase.from('ref_collaborateurs').select('*').range(0, 9999)
      if (cancelled) return
      if (error) {
        console.warn('[useCollaborateursPerimetre] ref_collaborateurs illisible :', error.message)
        setCollaborateurs([])
        setLoading(false)
        return
      }
      const noms = new Set<string>()
      for (const row of (data || []) as Record<string, any>[]) {
        const nom = pick(row, ['nom', 'collaborateur', 'representant', 'code'])
        const agence = pick(row, ['agence', 'agence_rattachement', 'agence_collaborateur'])
        if (!nom) continue
        // Cas 2 : périmètre agence -> uniquement les collaborateurs de ces agences.
        if (allowedAgences.length > 0 && !agenceMatchesAllowed(agence, allowedAgences)) continue
        noms.add(nom)
      }
      // Cas 3 (aucune restriction) : tout ref_collaborateurs.
      setCollaborateurs(Array.from(noms).sort((a, b) => a.localeCompare(b, 'fr')))
      setLoading(false)
    }
    void charger()
    return () => { cancelled = true }
  }, [ready, agencesKey, collaborateursKey])

  return useMemo(() => ({ collaborateurs, loading }), [collaborateurs, loading])
}
