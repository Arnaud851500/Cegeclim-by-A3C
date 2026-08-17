'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { usePageFilterAccess } from '@/lib/pageAccessFilters'
// ⚠️ Ajuster ce chemin relatif à l'emplacement réel de ce composant dans
// l'arborescence (ex: si ce fichier vit dans components/mobile/, le chemin
// vers app/focus_mensuel/page.tsx sera probablement "../../app/focus_mensuel/page"
// ou un alias "@/app/focus_mensuel/page" selon ta config tsconfig).
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

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthStartIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function MobileActivite() {
  const access = usePageFilterAccess()
  const [rows, setRows] = useState<DailyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  useEffect(() => {
    if (access.loading) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error } = await supabase.rpc('get_focus_mensuel_daily_summary_metier', {
          p_date_debut: monthStartIso(),
          p_date_fin: todayIso(),
          p_agence: access.hasAgenceRestriction ? access.allowedAgences[0] ?? null : null,
          p_famille_macro: null,
          p_collaborateur: access.hasCollaborateurRestriction ? access.allowedCollaborateurs[0] ?? null : null,
          p_include_hors_statistiques: true,
        })
        if (error) throw error
        if (!cancelled) setRows((data as DailyRow[]) || [])
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
  }, [access.loading, access.hasAgenceRestriction, access.hasCollaborateurRestriction])

  const totalsByType = useMemo(() => {
    const map: Record<DocType, number> = { Devis: 0, CDC: 0, BL: 0, Factures: 0 }
    rows.forEach((r) => {
      if (r.type_document in map) map[r.type_document as DocType] += Number(r.montant_ht || 0)
    })
    return map
  }, [rows])

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
        Cumul depuis le 1er du mois — {access.hasAgenceRestriction ? access.allowedAgences.join(', ') || 'périmètre restreint' : 'toutes agences'}
      </div>

      {error && <div style={{ color: '#e0a685', fontSize: 13 }}>Erreur de chargement : {error}</div>}

      {loading
        ? DOC_TYPES.map((t) => <SkeletonCard key={t} />)
        : DOC_TYPES.map((type) => (
            <ActiviteCard key={type} label={`Suivi des ${type}`} value={totalsByType[type]} color={DOC_COLORS[type]} />
          ))}

      {/* Marge : source de données à confirmer (pas présente dans
          get_focus_mensuel_daily_summary_metier). Placeholder en attendant
          la table/RPC correspondante. */}
      <ActiviteCard label="Suivi de la marge" value={null} color="#A6A181" placeholder />

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
  label,
  value,
  color,
  placeholder,
}: {
  label: string
  value: number | null
  color: string
  placeholder?: boolean
}) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 16,
        padding: '16px 16px',
        background: 'rgba(255,255,255,0.04)',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em', color }}>{label}</div>
      <div
        style={{
          marginTop: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: 26,
          fontWeight: 600,
          color: placeholder ? 'rgba(255,255,255,0.3)' : '#fff',
        }}
      >
        {placeholder || value === null ? '— à connecter' : formatMoney(value)}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return <div style={{ height: 78, borderRadius: 16, background: 'rgba(255,255,255,0.05)' }} />
}
