'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'

// ─────────────────────────────────────────────────────────────────────────
// Recherche de document résiliente : facture_lignes a des colonnes qui
// varient selon le pipeline d'import (numero_document / numero_piece,
// numero_tiers / numero_tiers_entete...). Chaque champ candidat est
// interrogé séparément et isolé par son propre try/catch : si une colonne
// n'existe pas dans la table, seule cette requête échoue silencieusement,
// les autres candidats continuent de fonctionner.
// ─────────────────────────────────────────────────────────────────────────

const SEARCH_FIELDS = [
  { key: 'numero_document', label: 'N° de pièce' },
  { key: 'numero_piece', label: 'N° de pièce' },
  { key: 'reference_article', label: 'Référence' },
  { key: 'reference', label: 'Référence' },
  { key: 'numero_tiers', label: 'N° tiers' },
  { key: 'numero_tiers_entete', label: 'N° tiers' },
]

function safeText(value: any) {
  return String(value ?? '').trim()
}
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  return ''
}
function formatDateFr(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

type DocResult = {
  key: string
  type: string
  numero: string
  tiers: string
  reference: string
  date: string
  montant_ht: number
}

async function searchByField(field: string, term: string) {
  try {
    const { data, error } = await supabase
      .from('facture_lignes')
      .select('*')
      .ilike(field, `%${term}%`)
      .limit(30)
    if (error) return []
    return (data || []) as Record<string, any>[]
  } catch {
    return []
  }
}

export default function MobileRdv() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<DocResult[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function runSearch() {
    const q = term.trim()
    if (!q) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const rawResultsPerField = await Promise.all(SEARCH_FIELDS.map((f) => searchByField(f.key, q)))
      const merged = new Map<string, DocResult>()
      rawResultsPerField.flat().forEach((row) => {
        const numero = safeText(pick(row, ['numero_document', 'numero_piece', 'num_piece']))
        const type = safeText(row.type_document)
        const key = `${type}-${numero}-${safeText(pick(row, ['numero_tiers', 'numero_tiers_entete']))}`
        if (merged.has(key)) return
        merged.set(key, {
          key,
          type,
          numero,
          tiers: safeText(pick(row, ['numero_tiers', 'numero_tiers_entete'])),
          reference: safeText(pick(row, ['reference_article', 'reference'])),
          date: normalizeDateIso(pick(row, ['date_document', 'date_facture', 'date_piece'])),
          montant_ht: Number(row.montant_ht || 0),
        })
      })
      setResults(Array.from(merged.values()).slice(0, 40))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ---- Rendez-vous : pas de table identifiée à ce jour. ---- */}
      <div
        style={{
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.10)',
          background: 'rgba(255,255,255,0.04)',
          padding: '14px 16px',
        }}
      >
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
          Rendez-vous
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>
          Source de données à connecter (table des rendez-vous non identifiée).
        </div>
      </div>

      {/* ---- Assistant vocal : à venir. ---- */}
      <button
        disabled
        style={{
          borderRadius: 14,
          border: '1px dashed rgba(255,255,255,0.15)',
          background: 'transparent',
          color: 'rgba(255,255,255,0.35)',
          padding: '14px 16px',
          fontSize: 13,
          textAlign: 'left',
        }}
      >
        🎙️ Assistant visite (résumé vocal + actions) — Bientôt disponible
      </button>

      {/* ---- Recherche de document ---- */}
      <div>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
          Rechercher un document
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="N° de pièce, référence chantier, n° client…"
            style={{
              flex: 1,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              padding: '11px 13px',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            onClick={runSearch}
            style={{
              borderRadius: 12,
              border: '1px solid rgba(166,161,129,0.4)',
              background: 'rgba(166,161,129,0.15)',
              color: '#e4dfc9',
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Chercher
          </button>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Recherche…</div>
          ) : results === null ? null : results.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Aucun document trouvé.</div>
          ) : (
            results.map((r) => (
              <div
                key={r.key}
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '10px 12px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: '#fff' }}>{r.numero || '—'}</span>
                  {r.montant_ht > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
                      {formatMoney(r.montant_ht)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
                  {[r.type, r.tiers && `Client ${r.tiers}`, r.date && formatDateFr(r.date), r.reference]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
