'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

/**
 * ÉTAT DE CE COMPOSANT — à lire avant de tester
 * ------------------------------------------------------------------------
 * CE QUI EST BRANCHÉ (sur la table facture_lignes, déjà utilisée ailleurs
 * dans le code — colonnes confirmées : type_document, numero_document,
 * numero_tiers, date_document, montant_ht) :
 *   - CA depuis le 1er janvier, comparé à la même période N-1
 *   - Liste des commandes (type_document = 'CDC')
 *   - Devis des 2 derniers mois (type_document = 'Devis')
 *
 * CE QUI N'EST PAS BRANCHÉ (aucune table confirmée pour l'instant) :
 *   - Recherche de clients par nom → liste de résultats
 *   - Nombre total de clients / nouveaux clients cette année / répartition
 *     par profil CA 12MG
 *   - Date de dernière visite / prochaine visite
 *   - Liste des actions liées au client
 *
 * CONTOURNEMENT POUR TESTER DÈS MAINTENANT : la recherche accepte un numéro
 * de tiers saisi directement (celui que tu utilises déjà dans CEGECLIM) et
 * ouvre sa fiche réelle. Tape un numéro de tiers connu et valide — la
 * recherche par nom viendra une fois la table clients identifiée.
 */

interface ClientOrderRow {
  numero: string
  date: string
  montant: number
}

interface ClientDetail {
  numeroTiers: string
  nom: string
  caYtd: number
  caYtdN1: number
  commandes: ClientOrderRow[]
  devisRecents: ClientOrderRow[]
}

const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function yearStartIso(iso: string) {
  return `${iso.slice(0, 4)}-01-01`
}
function shiftYearIso(iso: string, deltaYears: number) {
  const [y, m, day] = iso.split('-').map(Number)
  return toIso(new Date(y + deltaYears, m - 1, day))
}
function addMonthsIso(iso: string, deltaMonths: number) {
  const [y, m, day] = iso.split('-').map(Number)
  return toIso(new Date(y, m - 1 + deltaMonths, day))
}

function pickField(row: Record<string, any> | null, keys: string[]): string {
  if (!row) return ''
  for (const k of keys) {
    const v = row[k]
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

export default function MobileClients() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ClientDetail | null>(null)

  async function handleSearch() {
    const numero = query.trim()
    if (!numero) return
    setSearching(true)
    setSearchError(null)
    setSelected(null)

    try {
      const todayIsoValue = toIso(new Date())
      const todayIsoN1 = shiftYearIso(todayIsoValue, -1)
      const twoMonthsAgoIso = addMonthsIso(todayIsoValue, -2)

      const [nameRes, caRes, caN1Res, cdcRes, devisRes] = await Promise.all([
        supabase.from('facture_lignes').select('*').eq('numero_tiers', numero).limit(1),
        supabase
          .from('facture_lignes')
          .select('montant_ht')
          .eq('numero_tiers', numero)
          .eq('type_document', 'Factures')
          .gte('date_document', yearStartIso(todayIsoValue))
          .lte('date_document', todayIsoValue),
        supabase
          .from('facture_lignes')
          .select('montant_ht')
          .eq('numero_tiers', numero)
          .eq('type_document', 'Factures')
          .gte('date_document', yearStartIso(todayIsoN1))
          .lte('date_document', todayIsoN1),
        supabase
          .from('facture_lignes')
          .select('numero_document,date_document,montant_ht')
          .eq('numero_tiers', numero)
          .eq('type_document', 'CDC')
          .order('date_document', { ascending: false })
          .limit(20),
        supabase
          .from('facture_lignes')
          .select('numero_document,date_document,montant_ht')
          .eq('numero_tiers', numero)
          .eq('type_document', 'Devis')
          .gte('date_document', twoMonthsAgoIso)
          .order('date_document', { ascending: false })
          .limit(50),
      ])

      for (const r of [nameRes, caRes, caN1Res, cdcRes, devisRes]) {
        if (r.error) throw r.error
      }

      if (!nameRes.data || nameRes.data.length === 0) {
        setSearchError(`Aucune ligne trouvée pour le numéro de tiers « ${numero} ».`)
        return
      }

      const nameRow = nameRes.data[0] as Record<string, any>
      const nom = pickField(nameRow, [
        'intitule_tiers',
        'intitule_tiers_entete',
        'nom_tiers',
        'libelle_tiers',
        'tiers_libelle',
        'client',
        'raison_sociale',
      ]) || numero

      const sumMontant = (rows: any[] | null) => (rows || []).reduce((s, r) => s + Number(r.montant_ht || 0), 0)

      setSelected({
        numeroTiers: numero,
        nom,
        caYtd: sumMontant(caRes.data),
        caYtdN1: sumMontant(caN1Res.data),
        commandes: (cdcRes.data || []).map((r: any) => ({
          numero: r.numero_document,
          date: r.date_document,
          montant: Number(r.montant_ht || 0),
        })),
        devisRecents: (devisRes.data || []).map((r: any) => ({
          numero: r.numero_document,
          date: r.date_document,
          montant: Number(r.montant_ht || 0),
        })),
      })
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : String(e))
    } finally {
      setSearching(false)
    }
  }

  if (selected) {
    return <ClientDetailScreen client={selected} onBack={() => setSelected(null)} />
  }

  return (
    <div style={{ flex: 1, padding: '16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch()
          }}
          placeholder="Numéro de tiers (ex : C001234)…"
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
          onClick={handleSearch}
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

      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 }}>
        Recherche par numéro de tiers en attendant la recherche par nom (voir
        note en tête de fichier).
      </div>

      {searchError && <div style={{ color: '#e0a685', fontSize: 13 }}>{searchError}</div>}

      {/* Stats globales : nombre de clients, nouveaux cette année, profil CA
          12MG. Aucune table identifiée pour l'instant — placeholders. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <StatCardPlaceholder label="Clients" />
        <StatCardPlaceholder label="Nouveaux (année)" />
        <StatCardPlaceholder label="Profil CA 12MG" />
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: -8 }}>
        Ces trois indicateurs sont en attente d'une source de données (table
        clients + définition du profil CA 12MG).
      </div>
    </div>
  )
}

function StatCardPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        flex: 1,
        border: '1px dashed rgba(255,255,255,0.18)',
        borderRadius: 14,
        padding: '12px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, color: 'rgba(255,255,255,0.3)' }}>—</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function ClientDetailScreen({ client, onBack }: { client: ClientDetail; onBack: () => void }) {
  const evolPct = client.caYtdN1 > 0 ? ((client.caYtd - client.caYtdN1) / client.caYtdN1) * 100 : null
  const isUp = (evolPct ?? 0) >= 0

  return (
    <div style={{ flex: 1, padding: '16px 14px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button
        onClick={onBack}
        style={{
          alignSelf: 'flex-start',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 10,
          padding: '7px 12px',
          fontSize: 13,
          color: '#fff',
          background: 'transparent',
        }}
      >
        ← Clients
      </button>

      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: '#fff' }}>
          {client.nom}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
          N° tiers {client.numeroTiers}
        </div>
      </div>

      {/* Dernière / prochaine visite : aucune source confirmée. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <VisitPlaceholder label="Dernière visite" />
        <VisitPlaceholder label="Prochaine visite" />
      </div>

      <div>
        <SectionTitle>CA depuis le 1er janvier</SectionTitle>
        <div
          style={{
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 14,
            padding: '14px 16px',
            background: 'rgba(255,255,255,0.04)',
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: '#fff' }}>
            {money.format(client.caYtd)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 }}>
            {evolPct !== null && (
              <span style={{ fontWeight: 600, color: isUp ? '#e0a685' : '#8fc0d4' }}>
                {isUp ? '▲' : '▼'} {Math.abs(evolPct).toFixed(1)}%
              </span>
            )}
            <span style={{ color: 'rgba(255,255,255,0.45)' }}>N-1 : {money.format(client.caYtdN1)}</span>
          </div>
        </div>
      </div>

      {/* Actions : aucune table confirmée pour le lien client ↔ action. */}
      <div>
        <SectionTitle>Actions</SectionTitle>
        <div
          style={{
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: 14,
            padding: 16,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 13,
          }}
        >
          Liste des actions à connecter (source à confirmer).
        </div>
      </div>

      <div>
        <SectionTitle>Commandes (CDC)</SectionTitle>
        <OrderList rows={client.commandes} emptyLabel="Aucune commande trouvée." />
      </div>

      <div>
        <SectionTitle>Devis des 2 derniers mois</SectionTitle>
        <OrderList rows={client.devisRecents} emptyLabel="Aucun devis sur la période." />
      </div>
    </div>
  )
}

function VisitPlaceholder({ label }: { label: string }) {
  return (
    <div
      style={{
        flex: 1,
        border: '1px dashed rgba(255,255,255,0.18)',
        borderRadius: 14,
        padding: '12px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>—</div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{label}</div>
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

function OrderList({ rows, emptyLabel }: { rows: ClientOrderRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12.5 }}>{emptyLabel}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div
          key={`${r.numero}-${i}`}
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
            <div style={{ fontWeight: 600 }}>{r.numero}</div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11.5 }}>{r.date}</div>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)' }}>{money.format(r.montant)}</div>
        </div>
      ))}
    </div>
  )
}
