'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'

// ─────────────────────────────────────────────────────────────────────────
// Schéma confirmé via synthese_multi_clients/page.tsx :
// - Table clients : synthese_multi_clients_cache, row_kind = 'client', annee = N.
// - "Profil CA 12MG" : calculé côté client (caBand), pas une colonne stockée.
// - Dates de visite : objectif_tiers, domaine='Visite', 24 rubriques, valeur_date.
// - Actions client : todo_actions.numero_tiers (nouvelle colonne, cf.
//   supabase/migrations/add_numero_tiers_to_todo_actions.sql — à appliquer).
//
// Commandes/devis : facture_lignes. Colonnes confirmées : type_document,
// numero_document, numero_tiers, date_document, montant_ht — MAIS certaines
// lignes (autre pipeline d'import) renseignent numero_tiers_entete au lieu de
// numero_tiers (cf. le contournement déjà en place pour CERFA dans
// layout.tsx). D'où le .or() ci-dessous plutôt qu'un simple .eq().
// ─────────────────────────────────────────────────────────────────────────

const N = new Date().getFullYear()
const CA_PROFILE_BANDS = ['400K€', '150K€', '80K€', '20K€', 'vide'] as const
type CaBand = typeof CA_PROFILE_BANDS[number]

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function safeText(value: any) {
  return String(value ?? '').trim()
}
function caBand(value: number | null | undefined): CaBand {
  const n = safeNumber(value)
  if (n >= 400000) return '400K€'
  if (n >= 150000) return '150K€'
  if (n >= 80000) return '80K€'
  if (n >= 20000) return '20K€'
  return 'vide'
}
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function yearStartIso() {
  return `${N}-01-01`
}
function monthsAgoIso(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function normalizeDateIso(value: any) {
  const text = safeText(value)
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  const fr = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
  return ''
}
function formatDateFr(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function escapeSupabaseValue(value: string) {
  return String(value || '').replace(/,/g, '\\,')
}
/** Lit une valeur parmi plusieurs noms de colonnes candidats (variantes de pipeline). */
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
const NUMERO_KEYS = ['numero_document', 'numero_piece', 'num_piece', 'facture', 'piece']
const DATE_KEYS = ['date_document', 'date_facture', 'date_piece', 'date']
const TIERS_KEYS = ['numero_tiers', 'numero_tiers_entete']

async function fetchAllCache(select: string, apply?: (q: any) => any) {
  const output: Record<string, any>[] = []
  const chunkSize = 1000
  let from = 0
  while (true) {
    let query = supabase.from('synthese_multi_clients_cache').select(select).range(from, from + chunkSize - 1)
    if (apply) query = apply(query)
    const { data, error } = await query
    if (error) throw error
    const rows = (data || []) as Record<string, any>[]
    output.push(...rows)
    if (rows.length < chunkSize) break
    from += chunkSize
  }
  return output
}

/** Filtre tiers résilient : essaie numero_tiers puis numero_tiers_entete. */
function tiersOrFilter(numero: string) {
  const escaped = escapeSupabaseValue(numero)
  return TIERS_KEYS.map((key) => `${key}.eq.${escaped}`).join(',')
}

type ClientRow = {
  numero: string
  nom: string
  dateCreationIso: string
  caYtdN: number
  caYtdN1: number
  caN1: number
  ca12m: number
  band: CaBand
  devisYtdN: number
  devisYtdN1: number
  margePctYtdN: number | null
  margePctYtdN1: number | null
}

type DocLigne = { numero: string; date: string; montant_ht: number }
type ClientDetail = {
  commandes: DocLigne[]
  devis: DocLigne[]
  actions: { id: string; libelle: string; status: string; due_date: string | null }[]
  derniereVisite: string
  prochaineVisite: string
  loadErrors: string[]
}

export default function MobileClients() {
  const [allClients, setAllClients] = useState<ClientRow[] | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await fetchAllCache(
          'numero_tiers,intitule_tiers,date_creation,ca_n1,ca_ytd_n,ca_ytd_n1,devis_ytd_n,devis_ytd_n1,marge_pct_ytd_n,marge_ytd_n1_value',
          (q) => q.eq('annee', N).eq('row_kind', 'client'),
        )
        if (cancelled) return

        const mapped: ClientRow[] = rows.map((row) => {
          const caYtdN = safeNumber(row.ca_ytd_n)
          const caYtdN1 = safeNumber(row.ca_ytd_n1)
          const caN1 = safeNumber(row.ca_n1)
          const ca12m = caYtdN + Math.max(0, caN1 - caYtdN1)
          const margeYtdN1Value = safeNumber(row.marge_ytd_n1_value)
          return {
            numero: safeText(row.numero_tiers),
            nom: safeText(row.intitule_tiers),
            dateCreationIso: normalizeDateIso(row.date_creation),
            caYtdN,
            caYtdN1,
            caN1,
            ca12m,
            band: caBand(ca12m),
            devisYtdN: safeNumber(row.devis_ytd_n),
            devisYtdN1: safeNumber(row.devis_ytd_n1),
            margePctYtdN: row.marge_pct_ytd_n === null || row.marge_pct_ytd_n === undefined ? null : safeNumber(row.marge_pct_ytd_n),
            margePctYtdN1: caYtdN1 ? (margeYtdN1Value / caYtdN1) * 100 : null,
          }
        })
        setAllClients(mapped)
      } catch (e) {
        console.error('[MobileClients] erreur chargement synthese_multi_clients_cache', e)
        if (!cancelled) setClientsError(e instanceof Error ? e.message : String(e))
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    if (!allClients) return { total: null as number | null, nouveaux: null as number | null, parProfil: null as { label: string; count: number }[] | null }
    const ys = yearStartIso()
    const nouveaux = allClients.filter((c) => c.dateCreationIso && c.dateCreationIso >= ys).length
    const counts = new Map<CaBand, number>()
    allClients.forEach((c) => counts.set(c.band, (counts.get(c.band) || 0) + 1))
    const parProfil = CA_PROFILE_BANDS
      .map((band) => ({ label: band, count: counts.get(band) || 0 }))
      .filter((p) => p.count > 0)
    return { total: allClients.length, nouveaux, parProfil }
  }, [allClients])

  const results = useMemo(() => {
    if (!allClients) return []
    const term = search.trim().toLowerCase()
    if (!term) return []
    return allClients
      .filter((c) => c.numero.toLowerCase().includes(term) || c.nom.toLowerCase().includes(term))
      .slice(0, 40)
  }, [allClients, search])

  async function openClient(client: ClientRow) {
    setSelected(client)
    setDetail(null)
    setDetailLoading(true)

    const loadErrors: string[] = []

    try {
      const twoMonthsAgo = monthsAgoIso(2)
      const tiersFilter = tiersOrFilter(client.numero)

      const [cdcRes, devisRes, visitesRes, actionsRes] = await Promise.all([
        supabase
          .from('facture_lignes')
          .select('*')
          .eq('type_document', 'CDC')
          .or(tiersFilter)
          .order('date_document', { ascending: false })
          .limit(20),
        supabase
          .from('facture_lignes')
          .select('*')
          .eq('type_document', 'Devis')
          .or(tiersFilter)
          .gte('date_document', twoMonthsAgo)
          .order('date_document', { ascending: false })
          .limit(50),
        supabase
          .from('objectif_tiers')
          .select('valeur_date')
          .eq('numero_tiers', client.numero)
          .eq('annee', N)
          .eq('domaine', 'Visite')
          .not('valeur_date', 'is', null),
        supabase
          .from('todo_actions')
          .select('id,description_action,status,due_date')
          .eq('numero_tiers', client.numero)
          .order('due_date', { ascending: true })
          .limit(30),
      ])

      const mapDocs = (res: { data: any[] | null; error: any }): DocLigne[] => {
        if (res.error) {
          loadErrors.push(res.error.message)
          return []
        }
        return (res.data || []).map((r) => ({
          numero: safeText(pick(r, NUMERO_KEYS)),
          date: normalizeDateIso(pick(r, DATE_KEYS)),
          montant_ht: safeNumber(r.montant_ht),
        }))
      }

      const visitDates = visitesRes.error
        ? []
        : (visitesRes.data || [])
            .map((r: any) => normalizeDateIso(r.valeur_date))
            .filter(Boolean)
            .sort()

      const today0 = todayIso()
      const past = visitDates.filter((d) => d <= today0)
      const future = visitDates.filter((d) => d > today0)

      if (actionsRes.error) loadErrors.push(actionsRes.error.message)

      setDetail({
        commandes: mapDocs(cdcRes),
        devis: mapDocs(devisRes),
        actions: actionsRes.error
          ? []
          : (actionsRes.data || []).map((r: any) => ({
              id: String(r.id),
              libelle: String(r.description_action || ''),
              status: String(r.status || ''),
              due_date: r.due_date || null,
            })),
        derniereVisite: past.length ? formatDateFr(past[past.length - 1]) : '',
        prochaineVisite: future.length ? formatDateFr(future[0]) : '',
        loadErrors,
      })
    } catch (e) {
      console.error('[MobileClients] erreur chargement fiche client', e)
      setDetail({
        commandes: [], devis: [], actions: [], derniereVisite: '', prochaineVisite: '',
        loadErrors: [e instanceof Error ? e.message : String(e)],
      })
    } finally {
      setDetailLoading(false)
    }
  }

  if (selected) {
    return (
      <ClientDetailScreen
        client={selected}
        detail={detail}
        loading={detailLoading}
        onBack={() => {
          setSelected(null)
          setDetail(null)
        }}
      />
    )
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher un client (nom ou n° tiers)"
        style={{
          width: '100%',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.05)',
          color: '#fff',
          padding: '12px 14px',
          fontSize: 15,
          outline: 'none',
        }}
      />

      {clientsError && (
        <div style={{ fontSize: 12.5, color: '#e0a685' }}>
          Impossible de charger la base clients (synthese_multi_clients_cache) : {clientsError}
        </div>
      )}

      {!search.trim() && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatCard label="Clients" value={stats.total} />
            <StatCard label="Nouveaux (année)" value={stats.nouveaux} />
          </div>

          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgba(255,255,255,0.04)',
              padding: '14px 14px 12px',
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: 10,
              }}
            >
              Profil CA 12MG
            </div>
            {stats.parProfil === null ? (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>Chargement…</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stats.parProfil.map((p) => (
                  <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                    <span style={{ color: 'rgba(255,255,255,0.75)' }}>{p.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{p.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {search.trim() && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {allClients === null ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Chargement…</div>
          ) : results.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Aucun client trouvé.</div>
          ) : (
            results.map((c) => (
              <button
                key={c.numero}
                onClick={() => openClient(c)}
                style={{
                  textAlign: 'left',
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: 'rgba(255,255,255,0.04)',
                  padding: '11px 13px',
                  color: '#fff',
                }}
              >
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{c.nom || '(nom non renseigné)'}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>N° {c.numero}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        padding: '12px 14px',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600, color: '#fff', marginTop: 4 }}>
        {value === null ? '—' : value}
      </div>
    </div>
  )
}

function EvolLine({ value, n1, isPoints }: { value: number | null; n1: number | null; isPoints?: boolean }) {
  if (value === null || n1 === null) return <span style={{ color: 'rgba(255,255,255,0.4)' }}>N-1 : —</span>
  const delta = isPoints ? value - n1 : n1 ? ((value - n1) / Math.abs(n1)) * 100 : null
  return (
    <>
      {delta !== null && (
        <span style={{ color: delta >= 0 ? '#8fd4a8' : '#e0a685', fontWeight: 600 }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}{isPoints ? ' pts' : '%'}
        </span>
      )}
      <span style={{ color: 'rgba(255,255,255,0.4)' }}>
        {' '}N-1 : {isPoints ? `${n1.toFixed(1)} %` : formatMoney(n1)}
      </span>
    </>
  )
}

function ClientDetailScreen({
  client, detail, loading, onBack,
}: {
  client: ClientRow
  detail: ClientDetail | null
  loading: boolean
  onBack: () => void
}) {
  const pct = client.caYtdN1 > 0 ? ((client.caYtdN - client.caYtdN1) / client.caYtdN1) * 100 : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={onBack}
        style={{
          alignSelf: 'flex-start',
          margin: '12px 0 4px 16px',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 9,
          padding: '6px 11px',
          fontSize: 12.5,
          color: 'rgba(255,255,255,0.75)',
          background: 'transparent',
        }}
      >
        ← Recherche
      </button>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>{client.nom || '(nom non renseigné)'}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>N° {client.numero}</div>
        </div>

        {detail && detail.loadErrors.length > 0 && (
          <div style={{ fontSize: 12, color: '#e0a685' }}>
            {detail.loadErrors.join(' · ')}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MiniCard label="Dernière visite" value={loading ? '…' : detail?.derniereVisite || 'Non renseigné'} />
          <MiniCard label="Prochaine visite" value={loading ? '…' : detail?.prochaineVisite || 'Non renseigné'} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div
            style={{
              borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
              padding: '12px 13px',
            }}
          >
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
              CA depuis le 1er janvier
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {formatMoney(client.caYtdN)}
            </div>
            <div style={{ marginTop: 5, fontSize: 11 }}>
              <EvolLine value={client.caYtdN} n1={client.caYtdN1} />
            </div>
          </div>

          <div
            style={{
              borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
              padding: '12px 13px',
            }}
          >
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
              Devis depuis le 1er janvier
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {formatMoney(client.devisYtdN)}
            </div>
            <div style={{ marginTop: 5, fontSize: 11 }}>
              <EvolLine value={client.devisYtdN} n1={client.devisYtdN1} />
            </div>
          </div>
        </div>

        <div
          style={{
            borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)',
            padding: '12px 13px',
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            Marge depuis le 1er janvier
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 19, fontWeight: 700, color: '#fff', marginTop: 4 }}>
            {client.margePctYtdN === null ? '—' : `${client.margePctYtdN.toFixed(1)} %`}
          </div>
          <div style={{ marginTop: 5, fontSize: 11 }}>
            <EvolLine value={client.margePctYtdN} n1={client.margePctYtdN1} isPoints />
          </div>
        </div>

        <Section title="Actions">
          {loading ? (
            <Loading />
          ) : !detail || detail.actions.length === 0 ? (
            <Empty text="Aucune action liée à ce client." />
          ) : (
            detail.actions.map((a) => (
              <RowItem
                key={a.id}
                title={a.libelle || '(sans libellé)'}
                subtitle={a.due_date ? `Échéance ${formatDateFr(normalizeDateIso(a.due_date))}` : ''}
                trailing={a.status}
              />
            ))
          )}
        </Section>

        <Section title="Commandes (CDC)">
          {loading ? (
            <Loading />
          ) : !detail || detail.commandes.length === 0 ? (
            <Empty text="Aucune commande." />
          ) : (
            detail.commandes.map((d, i) => (
              <RowItem key={`${d.numero}-${i}`} title={d.numero || '—'} subtitle={formatDateFr(d.date)} trailing={formatMoney(d.montant_ht)} />
            ))
          )}
        </Section>

        <Section title="Devis (2 derniers mois)">
          {loading ? (
            <Loading />
          ) : !detail || detail.devis.length === 0 ? (
            <Empty text="Aucun devis sur la période." />
          ) : (
            detail.devis.map((d, i) => (
              <RowItem key={`${d.numero}-${i}`} title={d.numero || '—'} subtitle={formatDateFr(d.date)} trailing={formatMoney(d.montant_ht)} />
            ))
          )}
        </Section>
      </div>
    </div>
  )
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.10)',
        background: 'rgba(255,255,255,0.04)',
        padding: '11px 13px',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, color: '#fff', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)', padding: '0 2px' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function RowItem({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        padding: '9px 12px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      {trailing && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', marginLeft: 10 }}>
          {trailing}
        </div>
      )}
    </div>
  )
}

function Loading() {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>Chargement…</div>
}
function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', padding: '4px 2px' }}>{text}</div>
}
