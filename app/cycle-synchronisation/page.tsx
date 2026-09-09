'use client'

// Page "Fraîcheur des données" -- pour chaque source externe, table de base
// et cache agrégat suivi (voir data_lineage_registry / get_data_lineage_status
// côté base), affiche la date de dernière mise à jour et une pastille verte
// si elle est postérieure (ou égale) à celle de ses dépendances amont, rouge
// sinon. Les entrées marquées "à confirmer" viennent d'une dépendance déduite
// du nom/comportement de la fonction plutôt que vérifiée ligne à ligne dans
// le code -- à valider au besoin.
//
// Ne modifie ni ne lit aucune donnée métier : uniquement des métadonnées de
// fraîcheur (colonnes updated_at/refreshed_at des tables suivies).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type LineageRow = {
  table_name: string
  category: 'source_externe' | 'table_base' | 'cache_agregat'
  label: string
  last_updated_at: string | null
  depends_on: string[]
  used_by: string[]
  description: string | null
  confidence: 'confirmee' | 'deduite'
}

const CATEGORY_LABELS: Record<LineageRow['category'], string> = {
  source_externe: 'Sources externes',
  table_base: 'Tables de base',
  cache_agregat: 'Caches / indicateurs agrégats',
}
const CATEGORY_ORDER: LineageRow['category'][] = ['source_externe', 'table_base', 'cache_agregat']

function formatDateHeure(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ecouleDepuis(iso: string | null) {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const heures = diffMs / 3_600_000
  if (heures < 1) return `il y a ${Math.max(1, Math.round(diffMs / 60_000))} min`
  if (heures < 48) return `il y a ${Math.round(heures)} h`
  return `il y a ${Math.round(heures / 24)} j`
}

export default function FraicheurDonneesPage() {
  const [rows, setRows] = useState<LineageRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<string>('')

  async function charger() {
    setError(null)
    const { data, error: err } = await supabase.rpc('get_data_lineage_status')
    if (err) {
      setError(err.message)
      return
    }
    setRows((data || []) as LineageRow[])
    setCheckedAt(new Date().toISOString())
  }

  useEffect(() => {
    void charger()
  }, [])

  const byName = useMemo(() => {
    const map = new Map<string, LineageRow>()
    ;(rows || []).forEach((r) => map.set(r.table_name, r))
    return map
  }, [rows])

  function statutFraicheur(row: LineageRow): 'ok' | 'retard' | 'inconnu' {
    if (!row.last_updated_at) return 'inconnu'
    if (!row.depends_on.length) return 'ok'
    for (const dep of row.depends_on) {
      const depRow = byName.get(dep)
      if (!depRow?.last_updated_at) continue
      if (new Date(depRow.last_updated_at).getTime() > new Date(row.last_updated_at).getTime() + 60_000) {
        return 'retard'
      }
    }
    return 'ok'
  }

  return (
    <div style={{ padding: '24px 20px', background: '#0B1220', minHeight: '100vh', color: '#fff', fontFamily: 'var(--font-sans, sans-serif)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 10, marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Fraîcheur des données</h1>
        <button
          onClick={() => void charger()}
          style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)', padding: '6px 14px', fontSize: 12.5 }}
        >
          ↻ Actualiser
        </button>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 2, marginBottom: 20 }}>
        Chaîne d'alimentation, des sources externes jusqu'aux caches consommés par l'app. Vérifié {checkedAt ? ecouleDepuis(checkedAt) : ''}.
      </p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#3F9142', marginRight: 6 }} />à jour</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: '#C1683C', marginRight: 6 }} />en retard sur une dépendance</span>
        <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', marginRight: 6 }} />date inconnue</span>
        <span style={{ borderRadius: 6, border: '1px solid rgba(230,159,74,0.4)', color: '#E8A96A', padding: '1px 7px' }}>à confirmer</span>
        <span style={{ color: 'rgba(255,255,255,0.35)' }}>= dépendance déduite, pas vérifiée dans le code</span>
      </div>

      {error && <div style={{ color: '#e0a685', marginBottom: 16 }}>Erreur de chargement : {error}</div>}
      {!rows && !error && <div style={{ color: 'rgba(255,255,255,0.4)' }}>Chargement…</div>}

      {rows && CATEGORY_ORDER.map((cat) => {
        const items = rows.filter((r) => r.category === cat)
        if (!items.length) return null
        return (
          <div key={cat} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>
              {CATEGORY_LABELS[cat]}
            </div>
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              {items.map((row, idx) => {
                const statut = statutFraicheur(row)
                const dotColor = statut === 'ok' ? '#3F9142' : statut === 'retard' ? '#C1683C' : 'rgba(255,255,255,0.25)'
                return (
                  <div
                    key={row.table_name}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
                      borderTop: idx === 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, marginTop: 5, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{row.label}</span>
                        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono, monospace)' }}>{row.table_name}</span>
                        {row.confidence === 'deduite' && (
                          <span style={{ borderRadius: 6, border: '1px solid rgba(230,159,74,0.4)', color: '#E8A96A', padding: '1px 7px', fontSize: 10.5 }}>à confirmer</span>
                        )}
                      </div>
                      {row.description && (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>{row.description}</div>
                      )}
                      {row.depends_on.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                          Dépend de : {row.depends_on.map((d) => byName.get(d)?.label || d).join(', ')}
                        </div>
                      )}
                      {row.used_by.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'rgba(166,161,129,0.85)', marginTop: 2 }}>
                          Utilisé par : {row.used_by.join(', ')}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, color: '#fff' }}>{formatDateHeure(row.last_updated_at)}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{ecouleDepuis(row.last_updated_at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
