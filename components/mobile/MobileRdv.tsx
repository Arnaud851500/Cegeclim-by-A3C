'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

interface DocSearchResult {
  type: string
  numero: string
  tiers: string
  date: string
  montant: number
}

const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

export default function MobileRdv() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    const term = query.trim()
    if (!term) {
      setResults([])
      return
    }
    setSearching(true)
    setError(null)
    try {
      // ⚠️ Requête provisoire sur facture_lignes (type_document couvre en
      // principe Devis/CDC/BL/Factures selon focus_mensuel/page.tsx).
      // À remplacer par une RPC de recherche documentaire dédiée si le volume
      // ou le périmètre d'accès (agence/collaborateur) doit être filtré
      // côté serveur plutôt que par une requête directe.
      const { data, error } = await supabase
        .from('facture_lignes')
        .select('type_document,numero_document,numero_tiers,date_document,montant_ht')
        .or(`numero_document.ilike.%${term}%,numero_tiers.ilike.%${term}%`)
        .limit(20)
      if (error) throw error
      setResults(
        (data || []).map((r: any) => ({
          type: r.type_document,
          numero: r.numero_document,
          tiers: r.numero_tiers,
          date: r.date_document,
          montant: Number(r.montant_ht || 0),
        })),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section>
        <SectionTitle>Prochains rendez-vous</SectionTitle>
        <div
          style={{
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: 14,
            padding: 16,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 13,
          }}
        >
          Aucune source de données RDV connectée pour l’instant — à définir
          (table Supabase dédiée, ou agenda existant à brancher).
        </div>
      </section>

      <section>
        <SectionTitle>Assistant vocal — compte rendu de visite</SectionTitle>
        <button
          disabled
          style={{
            width: '100%',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 14,
            padding: '16px',
            background: 'rgba(255,255,255,0.03)',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 13.5,
            textAlign: 'left',
          }}
        >
          🎙️ Bientôt disponible — écoute, résumé, et proposition d’actions
          TODO avec confirmation orale.
        </button>
      </section>

      <section>
        <SectionTitle>Recherche de documents</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch()
            }}
            placeholder="N° devis, BL, tiers…"
            style={{
              flex: 1,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)',
              color: '#fff',
              padding: '10px 12px',
              fontSize: 14,
            }}
          />
          <button
            onClick={runSearch}
            style={{
              borderRadius: 12,
              border: 'none',
              background: '#A6A181',
              color: '#141A26',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {searching ? '…' : 'OK'}
          </button>
        </div>

        {error && <div style={{ marginTop: 8, color: '#e0a685', fontSize: 12.5 }}>{error}</div>}

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r, i) => (
            <div
              key={i}
              style={{
                border: '1px solid rgba(255,255,255,0.10)',
                borderRadius: 12,
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                color: '#fff',
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {r.type} {r.numero}
                </div>
                <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>
                  {r.tiers} · {r.date}
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)' }}>{money.format(r.montant)}</div>
            </div>
          ))}
          {!searching && query.trim() && results.length === 0 && (
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12.5 }}>Aucun résultat.</div>
          )}
        </div>
      </section>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'rgba(255,255,255,0.4)',
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  )
}
