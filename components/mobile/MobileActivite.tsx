'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { usePageFilterAccess } from '@/lib/pageAccessFilters'

// ─────────────────────────────────────────────────────────────────────────
// Reprend telle quelle la logique de components/VisionTciKpiPanel.tsx
// (fourni par Arnaud) plutôt que de reconstruire les totaux jour/mois/année
// côté client à partir de get_focus_mensuel_daily_summary_metier — c'est ce
// qui causait les valeurs fausses (0€ sur Jour/Mois, total incohérent sur
// Année). get_vision_tci_kpi renvoie déjà les 3 périodes + comparatif N-1,
// calculés côté serveur, pour chaque famille (BL/Devis/CDC/Factures/Marge).
// ─────────────────────────────────────────────────────────────────────────

const FOCUS_MENSUEL_COLORS: Record<string, string> = {
  BL: '#4B92AC',
  Devis: '#D69A4A',
  CDC: '#C1683C',
  Factures: '#3F9142',
  Marge: '#7A5EA8',
}

// Ordre d'affichage demandé initialement (Devis/CDC/BL/Factures), Marge à part.
const DISPLAY_ORDER = ['Devis', 'CDC', 'BL', 'Factures'] as const
type Famille = 'BL' | 'Devis' | 'CDC' | 'Factures' | 'Marge'

type FluxValues = {
  jour_valeur: number; jour_n1: number
  mois_valeur: number; mois_n1: number
  annee_valeur: number; annee_n1: number
}

function formatMontant(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€`
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} K€`
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`
}
function formatPct(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`
}

export default function MobileActivite() {
  const access = usePageFilterAccess()
  const [useYesterday, setUseYesterday] = useState(false)
  const [values, setValues] = useState<Record<Famille, FluxValues | null>>({
    BL: null, Devis: null, CDC: null, Factures: null, Marge: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null
  const collaborateurForcee = access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs[0] : null

  useEffect(() => {
    if (access.loading) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const familles: Famille[] = ['Devis', 'CDC', 'BL', 'Factures', 'Marge']
        const results = await Promise.all(
          familles.map((famille) =>
            supabase.rpc('get_vision_tci_kpi', {
              p_famille: famille,
              p_famille_macro: null,
              p_agence: agenceForcee,
              p_collaborateur: collaborateurForcee,
              p_utiliser_j_moins_1: useYesterday,
            }),
          ),
        )

        if (cancelled) return

        const next: Record<Famille, FluxValues | null> = { BL: null, Devis: null, CDC: null, Factures: null, Marge: null }
        results.forEach((res, i) => {
          const famille = familles[i]
          if (res.error) {
            console.error(`[MobileActivite] get_vision_tci_kpi(${famille})`, res.error)
            return
          }
          next[famille] = (Array.isArray(res.data) ? res.data[0] : res.data) as FluxValues
        })
        setValues(next)

        const firstError = results.find((r) => r.error)
        if (firstError?.error) setError(firstError.error.message)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [useYesterday, access.loading, agenceForcee, collaborateurForcee])

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
          color: 'rgba(255,255,255,0.65)',
          padding: '2px 2px 6px',
        }}
      >
        <input
          type="checkbox"
          checked={useYesterday}
          onChange={(e) => setUseYesterday(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: '#A6A181' }}
        />
        Afficher hier (J-1) au lieu d'aujourd'hui
      </label>

      {error && (
        <div
          style={{
            borderRadius: 10,
            border: '1px solid rgba(193,104,60,0.4)',
            background: 'rgba(193,104,60,0.12)',
            color: '#e0a685',
            fontSize: 13,
            padding: '10px 12px',
          }}
        >
          Impossible de charger les données : {error}
        </div>
      )}

      {loading
        ? DISPLAY_ORDER.map((f) => <CardSkeleton key={f} />)
        : DISPLAY_ORDER.map((famille) => (
            <ActiviteCard
              key={famille}
              famille={famille}
              dayLabel={useYesterday ? 'J-1' : 'Jour'}
              values={values[famille]}
            />
          ))}

      <ActiviteCard famille="Marge" dayLabel={useYesterday ? 'J-1' : 'Jour'} values={values.Marge} isMarge />
    </div>
  )
}

function evolPct(valeur: number, n1: number) {
  if (!n1) return null
  return ((valeur - n1) / Math.abs(n1)) * 100
}
function evolPoints(valeur: number, n1: number) {
  if (!Number.isFinite(valeur) || !Number.isFinite(n1)) return null
  return valeur - n1
}

function EvolBadge({ valeur, n1, isMarge }: { valeur: number; n1: number; isMarge?: boolean }) {
  if (isMarge) {
    const delta = evolPoints(valeur, n1)
    if (delta === null) return <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>—</span>
    const up = delta >= 0
    return (
      <span
        style={{
          display: 'inline-block', fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 6px',
          color: up ? '#8fd4a8' : '#e0a685', background: up ? 'rgba(63,145,66,0.16)' : 'rgba(193,104,60,0.16)',
        }}
      >
        {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)} pts
      </span>
    )
  }

  const pct = evolPct(valeur, n1)
  if (pct === null) return <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>—</span>
  const up = pct >= 0
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 6px',
        color: up ? '#8fd4a8' : '#e0a685', background: up ? 'rgba(63,145,66,0.16)' : 'rgba(193,104,60,0.16)',
      }}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function ActiviteCard({
  famille, dayLabel, values, isMarge,
}: { famille: Famille; dayLabel: string; values: FluxValues | null; isMarge?: boolean }) {
  const color = FOCUS_MENSUEL_COLORS[famille]
  const fmt = isMarge ? formatPct : formatMontant

  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        padding: '14px 14px 12px',
      }}
    >
      <span
        style={{
          display: 'inline-block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
          color, background: `${color}22`, borderRadius: 6, padding: '3px 8px', marginBottom: 10,
        }}
      >
        {famille}
      </span>

      {!values ? (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Donnée indisponible.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <Column label={dayLabel} value={values.jour_valeur} n1={values.jour_n1} fmt={fmt} isMarge={isMarge} />
          <Column label="Mois" value={values.mois_valeur} n1={values.mois_n1} fmt={fmt} isMarge={isMarge} />
          <Column label="Année" value={values.annee_valeur} n1={values.annee_n1} fmt={fmt} isMarge={isMarge} />
        </div>
      )}
    </div>
  )
}

function Column({
  label, value, n1, fmt, isMarge,
}: { label: string; value: number; n1: number; fmt: (n: number) => string; isMarge?: boolean }) {
  return (
    <div style={{ minWidth: 0, textAlign: 'left' }}>
      <div
        style={{
          fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.35)',
          marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 15.5, fontWeight: 600, color: '#fff', lineHeight: 1.15,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
      >
        {fmt(value)}
      </div>
      <div style={{ marginTop: 4 }}>
        <EvolBadge valeur={value} n1={n1} isMarge={isMarge} />
      </div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div
      style={{
        borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)',
        padding: '14px 14px 12px',
      }}
    >
      <div style={{ width: 60, height: 18, borderRadius: 6, background: 'rgba(255,255,255,0.08)', marginBottom: 12 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div style={{ width: '80%', height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', marginBottom: 6 }} />
            <div style={{ width: '90%', height: 16, borderRadius: 4, background: 'rgba(255,255,255,0.08)', marginBottom: 6 }} />
            <div style={{ width: '60%', height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
