'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { usePageFilterAccess } from '@/lib/pageAccessFilters'

// ─────────────────────────────────────────────────────────────────────────
// Reprend la logique de components/VisionTciKpiPanel.tsx (get_vision_tci_kpi)
// plutôt que de reconstruire les totaux côté client.
//
// NOUVEAU :
// - Cache localStorage par famille/J-J1, pour un affichage quasi instantané
//   au retour sur l'écran (affiche la dernière valeur connue tout de suite,
//   rafraîchit en tâche de fond, remplace silencieusement).
// - Chaque carte est cliquable : ouvre une fenêtre flottante avec la
//   ventilation par famille macro (par défaut) ou par agence (case en haut
//   de la fenêtre), pour tous les widgets (Devis/CDC/BL/Factures/Marge).
// ─────────────────────────────────────────────────────────────────────────

const FOCUS_MENSUEL_COLORS: Record<string, string> = {
  BL: '#4B92AC',
  Devis: '#D69A4A',
  CDC: '#C1683C',
  Factures: '#3F9142',
  Marge: '#7A5EA8',
}

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

const CACHE_PREFIX = 'cegeclim:mobileActivite:'
function loadCache(key: string): Record<Famille, FluxValues | null> | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveCache(key: string, data: Record<Famille, FluxValues | null>) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // Stockage indisponible (navigation privée, quota...) : tant pis, pas de cache.
  }
}

export default function MobileActivite() {
  const access = usePageFilterAccess()
  const [useYesterday, setUseYesterday] = useState(false)
  const [values, setValues] = useState<Record<Famille, FluxValues | null>>({
    BL: null, Devis: null, CDC: null, Factures: null, Marge: null,
  })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openFamille, setOpenFamille] = useState<Famille | null>(null)

  const [famillesMacro, setFamillesMacro] = useState<string[]>([])
  const [agences, setAgences] = useState<string[]>([])

  const agenceForcee = access.hasAgenceRestriction && access.allowedAgences.length > 0 ? access.allowedAgences[0] : null
  const collaborateurForcee = access.hasCollaborateurRestriction && access.allowedCollaborateurs.length > 0 ? access.allowedCollaborateurs[0] : null

  // Dimensions de ventilation — chargées une fois, réutilisées par toutes les fenêtres flottantes.
  useEffect(() => {
    let cancelled = false
    async function loadDims() {
      const [{ data: fams }, { data: ags }] = await Promise.all([
        supabase.from('ref_familles').select('famille_macro'),
        supabase.from('ref_collaborateurs').select('agence'),
      ])
      if (cancelled) return
      setFamillesMacro(Array.from(new Set(((fams || []) as any[]).map((f) => f.famille_macro).filter(Boolean))).sort())
      setAgences(Array.from(new Set(((ags || []) as any[]).map((a) => a.agence).filter(Boolean))).sort())
    }
    loadDims()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (access.loading) return
    const cacheKey = `${CACHE_PREFIX}${useYesterday ? 'j1' : 'j'}`
    const cached = loadCache(cacheKey)

    if (cached) {
      setValues(cached)
      setLoading(false)
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    let cancelled = false

    async function load() {
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
        saveCache(cacheKey, next)

        const firstError = results.find((r) => r.error)
        if (firstError?.error) setError(firstError.error.message)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [useYesterday, access.loading, agenceForcee, collaborateurForcee])

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
          <input
            type="checkbox"
            checked={useYesterday}
            onChange={(e) => setUseYesterday(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: '#A6A181' }}
          />
          Afficher hier (J-1) au lieu d'aujourd'hui
        </label>
        {refreshing && <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)' }}>Actualisation…</span>}
      </div>

      {error && (
        <div
          style={{
            borderRadius: 10, border: '1px solid rgba(193,104,60,0.4)', background: 'rgba(193,104,60,0.12)',
            color: '#e0a685', fontSize: 13, padding: '10px 12px',
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
              onClick={() => setOpenFamille(famille)}
            />
          ))}

      {!loading && (
        <ActiviteCard famille="Marge" dayLabel={useYesterday ? 'J-1' : 'Jour'} values={values.Marge} isMarge onClick={() => setOpenFamille('Marge')} />
      )}

      {openFamille && (
        <BreakdownModal
          famille={openFamille}
          dayLabel={useYesterday ? 'J-1' : 'Jour'}
          useYesterday={useYesterday}
          agenceForcee={agenceForcee}
          collaborateurForcee={collaborateurForcee}
          famillesMacro={famillesMacro}
          agences={agences}
          onClose={() => setOpenFamille(null)}
        />
      )}
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
  const delta = isMarge ? evolPoints(valeur, n1) : evolPct(valeur, n1)
  if (delta === null) return <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>—</span>
  const up = delta >= 0
  return (
    <span
      style={{
        display: 'inline-block', fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: '2px 6px',
        color: up ? '#8fd4a8' : '#e0a685', background: up ? 'rgba(63,145,66,0.16)' : 'rgba(193,104,60,0.16)',
      }}
    >
      {up ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}{isMarge ? ' pts' : '%'}
    </span>
  )
}

function ActiviteCard({
  famille, dayLabel, values, isMarge, onClick,
}: { famille: Famille; dayLabel: string; values: FluxValues | null; isMarge?: boolean; onClick: () => void }) {
  const color = FOCUS_MENSUEL_COLORS[famille]
  const fmt = isMarge ? formatPct : formatMontant

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: 'left', borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)', padding: '14px 14px 12px', width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span
          style={{
            display: 'inline-block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
            color, background: `${color}22`, borderRadius: 6, padding: '3px 8px',
          }}
        >
          {famille}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Détail ›</span>
      </div>

      {!values ? (
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Donnée indisponible.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          <Column label={dayLabel} value={values.jour_valeur} n1={values.jour_n1} fmt={fmt} isMarge={isMarge} />
          <Column label="Mois" value={values.mois_valeur} n1={values.mois_n1} fmt={fmt} isMarge={isMarge} />
          <Column label="Année" value={values.annee_valeur} n1={values.annee_n1} fmt={fmt} isMarge={isMarge} />
        </div>
      )}
    </button>
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
    <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', padding: '14px 14px 12px' }}>
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

// ── Fenêtre flottante de ventilation (famille macro / agence) ─────────────

type BreakdownRow = { label: string; values: FluxValues }
type BreakdownMode = 'macro' | 'agence'

function BreakdownModal({
  famille, dayLabel, useYesterday, agenceForcee, collaborateurForcee, famillesMacro, agences, onClose,
}: {
  famille: Famille
  dayLabel: string
  useYesterday: boolean
  agenceForcee: string | null
  collaborateurForcee: string | null
  famillesMacro: string[]
  agences: string[]
  onClose: () => void
}) {
  const [mode, setMode] = useState<BreakdownMode>('macro')
  const [rows, setRows] = useState<BreakdownRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const isMarge = famille === 'Marge'
  const color = FOCUS_MENSUEL_COLORS[famille]
  const fmt = isMarge ? formatPct : formatMontant

  // Ventilation par agence peu utile si l'utilisateur est déjà restreint à
  // une seule agence — bascule silencieusement sur famille macro dans ce cas.
  const canBreakdownByAgence = !agenceForcee

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const effectiveMode = mode === 'agence' && !canBreakdownByAgence ? 'macro' : mode
      const dims = effectiveMode === 'macro' ? famillesMacro : agences

      const results = await Promise.all(
        dims.map((dim) =>
          supabase.rpc('get_vision_tci_kpi', {
            p_famille: famille,
            p_famille_macro: effectiveMode === 'macro' ? dim : null,
            p_agence: effectiveMode === 'agence' ? dim : agenceForcee,
            p_collaborateur: collaborateurForcee,
            p_utiliser_j_moins_1: useYesterday,
          }),
        ),
      )

      if (cancelled) return

      const next: BreakdownRow[] = []
      dims.forEach((dim, i) => {
        const res = results[i]
        if (res.error) return
        const v = (Array.isArray(res.data) ? res.data[0] : res.data) as FluxValues
        if (!v) return
        if (!v.jour_valeur && !v.mois_valeur && !v.annee_valeur) return
        next.push({ label: dim, values: v })
      })
      next.sort((a, b) => (b.values.annee_valeur || 0) - (a.values.annee_valeur || 0))
      setRows(next)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [famille, mode, useYesterday, agenceForcee, collaborateurForcee, famillesMacro, agences, canBreakdownByAgence])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(6,10,18,0.62)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 480, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '12px auto 10px' }} />

        <div style={{ padding: '0 18px 12px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                display: 'inline-block', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                color, background: `${color}22`, borderRadius: 6, padding: '4px 9px',
              }}
            >
              {famille}
            </span>
            <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none' }}>✕</button>
          </div>

          <div style={{ marginTop: 12, display: 'inline-flex', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', padding: 2 }}>
            <button
              onClick={() => setMode('macro')}
              style={{
                borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
                background: mode === 'macro' ? '#A6A181' : 'transparent', color: mode === 'macro' ? '#141A26' : 'rgba(255,255,255,0.55)',
              }}
            >
              Par famille macro
            </button>
            <button
              onClick={() => setMode('agence')}
              disabled={!canBreakdownByAgence}
              style={{
                borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none',
                background: mode === 'agence' ? '#A6A181' : 'transparent',
                color: mode === 'agence' ? '#141A26' : 'rgba(255,255,255,0.55)',
                opacity: canBreakdownByAgence ? 1 : 0.4,
              }}
            >
              Par agence
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', padding: '0 18px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>Chargement…</div>
          ) : !rows || rows.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '20px 0', textAlign: 'center' }}>Aucune donnée sur ce périmètre.</div>
          ) : (
            rows.map((row) => (
              <div key={row.label} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '10px 12px' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', marginBottom: 8 }}>{row.label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  <Column label={dayLabel} value={row.values.jour_valeur} n1={row.values.jour_n1} fmt={fmt} isMarge={isMarge} />
                  <Column label="Mois" value={row.values.mois_valeur} n1={row.values.mois_n1} fmt={fmt} isMarge={isMarge} />
                  <Column label="Année" value={row.values.annee_valeur} n1={row.values.annee_n1} fmt={fmt} isMarge={isMarge} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
