'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { usePageFilterAccess } from '@/lib/pageAccessFilters'
// ⚠️ Ajuster ce chemin relatif à l'emplacement réel de ce composant dans
// l'arborescence (ex: si ce fichier vit dans components/mobile/, le chemin
// vers app/focus_mensuel/page.tsx sera probablement "@/app/focus_mensuel/page"
// selon ta config tsconfig, sinon un chemin relatif "../../app/focus_mensuel/page").
import { DOC_TYPES, DOC_COLORS, formatMoney, type DailyRow, type DocType } from '@/app/focus_mensuel/page'

// Widgets additionnels accessibles via "Voir plus" — noms provisoires.
// À faire correspondre aux vrais écrans une fois vision-tci (One Page)
// transmis, pour brancher les bonnes RPC derrière chaque entrée.
const MORE_WIDGETS: { key: string; label: string }[] = [
  { key: 'portefeuille', label: 'Portefeuille de commandes' },
  { key: 'projection', label: 'Projection du CA' },
  { key: 'rolling12', label: 'Rolling 12 mois' },
  { key: 'top20', label: 'TOP 20 documents' },
]

// ---------------------------------------------------------------------------
// Utilitaires de dates locales (mêmes conventions que les pages desktop :
// chaînes ISO "YYYY-MM-DD", comparables lexicographiquement)
// ---------------------------------------------------------------------------

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function addDaysIso(iso: string, delta: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return toIso(d)
}
function shiftYearIso(iso: string, deltaYears: number) {
  const [y, m, day] = iso.split('-').map(Number)
  return toIso(new Date(y + deltaYears, m - 1, day))
}
function yearStartIso(iso: string) {
  return `${iso.slice(0, 4)}-01-01`
}
function monthStartIso(iso: string) {
  return `${iso.slice(0, 7)}-01`
}

function sumByTypeAndRange(rows: DailyRow[], type: DocType, fromIso: string, toIsoBound: string) {
  return rows
    .filter((r) => r.type_document === type && r.jour >= fromIso && r.jour <= toIsoBound)
    .reduce((sum, r) => sum + Number(r.montant_ht || 0), 0)
}

function evolPct(value: number, valueN1: number): number | null {
  if (!valueN1) return null
  return ((value - valueN1) / valueN1) * 100
}

export default function MobileActivite() {
  const access = usePageFilterAccess()
  const [showYesterday, setShowYesterday] = useState(false)
  const [rowsN, setRowsN] = useState<DailyRow[]>([])
  const [rowsN1, setRowsN1] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  const todayIsoValue = useMemo(() => toIso(new Date()), [])

  useEffect(() => {
    if (access.loading) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const todayIsoN1 = shiftYearIso(todayIsoValue, -1)
        const commonParams = {
          p_agence: access.hasAgenceRestriction ? access.allowedAgences[0] ?? null : null,
          p_famille_macro: null,
          p_collaborateur: access.hasCollaborateurRestriction ? access.allowedCollaborateurs[0] ?? null : null,
          p_include_hors_statistiques: true,
        }

        // Deux appels seulement : l'année en cours du 1er janvier à
        // aujourd'hui, et son équivalent exact un an plus tôt. Le jour, le
        // mois en cours et l'année en cours (N et N-1) sont ensuite tous
        // dérivés de ces deux jeux de données côté client — pas d'appel RPC
        // supplémentaire par indicateur.
        const [resN, resN1] = await Promise.all([
          supabase.rpc('get_focus_mensuel_daily_summary_metier', {
            p_date_debut: yearStartIso(todayIsoValue),
            p_date_fin: todayIsoValue,
            ...commonParams,
          }),
          supabase.rpc('get_focus_mensuel_daily_summary_metier', {
            p_date_debut: yearStartIso(todayIsoN1),
            p_date_fin: todayIsoN1,
            ...commonParams,
          }),
        ])

        if (resN.error) throw resN.error
        if (resN1.error) throw resN1.error

        if (!cancelled) {
          setRowsN((resN.data as DailyRow[]) || [])
          setRowsN1((resN1.data as DailyRow[]) || [])
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [access.loading, access.hasAgenceRestriction, access.hasCollaborateurRestriction, todayIsoValue])

  const metrics = useMemo(() => {
    const dayIso = showYesterday ? addDaysIso(todayIsoValue, -1) : todayIsoValue
    const dayIsoN1 = shiftYearIso(dayIso, -1)
    const monthFromIso = monthStartIso(todayIsoValue)
    const monthFromIsoN1 = monthStartIso(shiftYearIso(todayIsoValue, -1))
    const yearFromIso = yearStartIso(todayIsoValue)
    const yearFromIsoN1 = yearStartIso(shiftYearIso(todayIsoValue, -1))
    const todayIsoN1 = shiftYearIso(todayIsoValue, -1)

    const result: Record<DocType, {
      day: number; dayN1: number
      month: number; monthN1: number
      year: number; yearN1: number
    }> = {} as any

    DOC_TYPES.forEach((type) => {
      result[type] = {
        day: sumByTypeAndRange(rowsN, type, dayIso, dayIso),
        dayN1: sumByTypeAndRange(rowsN1, type, dayIsoN1, dayIsoN1),
        month: sumByTypeAndRange(rowsN, type, monthFromIso, todayIsoValue),
        monthN1: sumByTypeAndRange(rowsN1, type, monthFromIsoN1, todayIsoN1),
        year: sumByTypeAndRange(rowsN, type, yearFromIso, todayIsoValue),
        yearN1: sumByTypeAndRange(rowsN1, type, yearFromIsoN1, todayIsoN1),
      }
    })

    return result
  }, [rowsN, rowsN1, showYesterday, todayIsoValue])

  const dayLabel = showYesterday ? 'Hier' : "Aujourd'hui"

  return (
    <div style={{ flex: 1, padding: '16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>
        Mois et année comparés à la même période N-1 (mêmes dates de début/fin).
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
          padding: '10px 12px',
          fontSize: 13,
          color: '#fff',
        }}
      >
        <input
          type="checkbox"
          checked={showYesterday}
          onChange={(e) => setShowYesterday(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
        Afficher hier (J-1) au lieu d'aujourd'hui pour la colonne « Jour »
      </label>

      {error && <div style={{ color: '#e0a685', fontSize: 13 }}>Erreur de chargement : {error}</div>}

      {loading
        ? DOC_TYPES.map((t) => <SkeletonCard key={t} />)
        : DOC_TYPES.map((type) => (
            <ActiviteCard
              key={type}
              label={`Suivi des ${type}`}
              color={DOC_COLORS[type]}
              dayLabel={dayLabel}
              day={metrics[type].day}
              dayN1={metrics[type].dayN1}
              month={metrics[type].month}
              monthN1={metrics[type].monthN1}
              year={metrics[type].year}
              yearN1={metrics[type].yearN1}
            />
          ))}

      {/* Marge : source de données à confirmer — pas présente dans
          get_focus_mensuel_daily_summary_metier. Placeholder en attendant
          la table/RPC correspondante. */}
      <div
        style={{
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16,
          padding: '16px',
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color: '#A6A181' }}>
          Suivi de la marge
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
          Source de données à connecter.
        </div>
      </div>

      <button
        onClick={() => setShowMore((v) => !v)}
        style={{
          marginTop: 8,
          border: '1px dashed rgba(255,255,255,0.25)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.7)',
          borderRadius: 12,
          padding: '12px',
          fontSize: 13,
        }}
      >
        {showMore ? 'Masquer les autres widgets' : 'Voir d’autres widgets KPI'}
      </button>

      {showMore && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MORE_WIDGETS.map((w) => (
            <button
              key={w.key}
              style={{
                textAlign: 'left',
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 12,
                padding: '12px 14px',
                color: 'rgba(255,255,255,0.75)',
                fontSize: 13.5,
              }}
              onClick={() => {
                // TODO: brancher sur l'écran détail correspondant une fois
                // les RPC vision-tci identifiées.
              }}
            >
              {w.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActiviteCard({
  label, color, dayLabel, day, dayN1, month, monthN1, year, yearN1,
}: {
  label: string
  color: string
  dayLabel: string
  day: number
  dayN1: number
  month: number
  monthN1: number
  year: number
  yearN1: number
}) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 16,
        padding: '14px 12px 16px',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color, marginBottom: 10 }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <MetricColumn label={dayLabel} value={day} valueN1={dayN1} />
        <MetricColumn label="Depuis le 1er du mois" value={month} valueN1={monthN1} />
        <MetricColumn label="Depuis le 1er janvier" value={year} valueN1={yearN1} />
      </div>
    </div>
  )
}

function MetricColumn({ label, value, valueN1 }: { label: string; value: number; valueN1: number }) {
  const pct = evolPct(value, valueN1)
  const isUp = (pct ?? 0) >= 0

  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div
        style={{
          fontSize: 9.5,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'rgba(255,255,255,0.35)',
          marginBottom: 4,
          lineHeight: 1.2,
          minHeight: 22,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 15,
          fontWeight: 600,
          color: '#fff',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {formatMoney(value)}
      </div>
      <div style={{ marginTop: 4 }}>
        {pct === null ? (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.25)' }}>—</span>
        ) : (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: isUp ? '#e0a685' : '#8fc0d4',
            }}
          >
            {isUp ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return <div style={{ height: 120, borderRadius: 16, background: 'rgba(255,255,255,0.05)' }} />
}
