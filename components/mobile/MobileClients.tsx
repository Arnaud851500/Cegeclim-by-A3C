'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'

// ─────────────────────────────────────────────────────────────────────────
// Schéma confirmé via synthese_multi_clients/page.tsx (fourni par Arnaud) :
// - Table clients : synthese_multi_clients_cache, row_kind = 'client', annee = N.
// - "Profil CA 12MG" : PAS une colonne stockée — calculé côté client à partir
//   de ca12m = ca_ytd_n + max(0, ca_n1 - ca_ytd_n1), seuils identiques à la
//   fonction caBand() du fichier fourni (400K/150K/80K/20K/vide).
// - Dates de visite : table objectif_tiers, domaine='Visite', 24 rubriques
//   "Visite n°1".."Visite n°24", valeur_date. Dernière = max date passée,
//   prochaine = min date future.
// - Actions liées au client : todo_actions — lien exact vers le client
//   toujours non confirmé (⚠️ seul point encore en suspens sur cet écran).
// CA/commandes/devis : facture_lignes, schéma déjà validé ailleurs dans l'app.
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

type ClientRow = {
  numero: string
  nom: string
  dateCreationIso: string
  caYtdN: number
  caYtdN1: number
  caN1: number
  ca12m: number
  band: CaBand
}

type DocLigne = { numero_document: string; date_document: string; montant_ht: number }
type ClientDetail = {
  commandes: DocLigne[]
  devis: DocLigne[]
  actions: { id: string; libelle: string; status: string; due_date: string | null }[]
  derniereVisite: string
  prochaineVisite: string
}

export default function MobileClients() {
  const [allClients, setAllClients] = useState<ClientRow[] | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ClientRow | null>(null)
  const [detail, setDetail] = useState<ClientDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const rows = await fetchAllCache(
          'numero_tiers,intitule_tiers,date_creation,ca_n1,ca_ytd_n,ca_ytd_n1',
          (q) => q.eq('annee', N).eq('row_kind', 'client'),
        )
        if (cancelled) return

        const mapped: ClientRow[] = rows.map((row) => {
          const caYtdN = safeNumber(row.ca_ytd_n)
          const caYtdN1 = safeNumber(row.ca_ytd_n1)
          const caN1 = safeNumber(row.ca_n1)
          const ca12m = caYtdN + Math.max(0, caN1 - caYtdN1)
          return {
            numero: safeText(row.numero_tiers),
            nom: safeText(row.intitule_tiers),
            dateCreationIso: normalizeDateIso(row.date_creation),
            caYtdN,
            caYtdN1,
            caN1,
            ca12m,
            band: caBand(ca12m),
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
    setDetailError(null)
    setDetailLoading(true)

    try {
      const today = todayIso()
      const twoMonthsAgo = monthsAgoIso(2)

      const [cdcRes, devisRes, visitesRes, actionsRes] = await Promise.all([
        supabase
          .from('facture_lignes')
          .select('numero_document,date_document,montant_ht')
          .eq('type_document', 'CDC')
          .eq('numero_tiers', client.numero)
          .order('date_document', { ascending: false })
          .limit(20),
        supabase
          .from('facture_lignes')
          .select('numero_document,date_document,montant_ht')
          .eq('type_document', 'Devis')
          .eq('numero_tiers', client.numero)
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
        // ⚠️ Seule hypothèse restante sur cet écran : le lien action↔client.
        supabase
          .from('todo_actions')
          .select('id,libelle,status,due_date')
          .eq('numero_tiers', client.numero)
          .order('due_date', { ascending: true })
          .limit(30),
      ])

      const mapDocs = (res: { data: any[] | null; error: any }): DocLigne[] =>
        res.error
          ? []
          : (res.data || []).map((r) => ({
              numero_document: String(r.numero_document || ''),
              date_document: String(r.date_document || ''),
              montant_ht: Number(r.montant_ht || 0),
            }))

      const visitDates = visitesRes.error
        ? []
        : (visitesRes.data || [])
            .map((r: any) => normalizeDateIso(r.valeur_date))
            .filter(Boolean)
            .sort()

      const today0 = today
      const past = visitDates.filter((d) => d <= today0)
      const future = visitDates.filter((d) => d > today0)

      setDetail({
        commandes: mapDocs(cdcRes),
        devis: mapDocs(devisRes),
        actions: actionsRes.error
          ? []
          : (actionsRes.data || []).map((r: any) => ({
              id: String(r.id),
              libelle: String(r.libelle || ''),
              status: String(r.status || ''),
              due_date: r.due_date || null,
            })),
        derniereVisite: past.length ? formatDateFr(past[past.length - 1]) : '',
        prochaineVisite: future.length ? formatDateFr(future[0]) : '',
      })
    } catch (e) {
      console.error('[MobileClients] erreur chargement fiche client', e)
      setDetailError(e instanceof Error ? e.message : String(e))
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
        error={detailError}
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

function ClientDetailScreen({
  client, detail, loading, error, onBack,
}: {
  client: ClientRow
  detail: ClientDetail | null
  loading: boolean
  error: string | null
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

        {error && <div style={{ fontSize: 12.5, color: '#e0a685' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MiniCard label="Dernière visite" value={loading ? '…' : detail?.derniereVisite || 'Non renseigné'} />
          <MiniCard label="Prochaine visite" value={loading ? '…' : detail?.prochaineVisite || 'Non renseigné'} />
        </div>

        <div
          style={{
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.10)',
            background: 'rgba(255,255,255,0.04)',
            padding: '14px',
          }}
        >
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(255,255,255,0.4)' }}>
            CA depuis le 1er janvier
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color: '#fff', marginTop: 4 }}>
            {formatMoney(client.caYtdN)}
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            {pct !== null && (
              <span style={{ color: pct >= 0 ? '#e0a685' : '#8fc0d4', fontWeight: 600 }}>
                {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
              </span>
            )}
            <span style={{ color: 'rgba(255,255,255,0.4)' }}>N-1 : {formatMoney(client.caYtdN1)}</span>
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
            detail.commandes.map((d) => (
              <RowItem
                key={d.numero_document}
                title={d.numero_document || '—'}
                subtitle={formatDateFr(normalizeDateIso(d.date_document))}
                trailing={formatMoney(d.montant_ht)}
              />
            ))
          )}
        </Section>

        <Section title="Devis (2 derniers mois)">
          {loading ? (
            <Loading />
          ) : !detail || detail.devis.length === 0 ? (
            <Empty text="Aucun devis sur la période." />
          ) : (
            detail.devis.map((d) => (
              <RowItem
                key={d.numero_document}
                title={d.numero_document || '—'}
                subtitle={formatDateFr(normalizeDateIso(d.date_document))}
                trailing={formatMoney(d.montant_ht)}
              />
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
