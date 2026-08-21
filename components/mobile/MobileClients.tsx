'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { formatMoney } from '@/app/focus_mensuel/page'
import MobileDetailSheet, { type DetailField } from './MobileDetailSheet'
import MobileTaskDetailSheet, { type TaskRow } from './MobileTaskDetailSheet'

// ─────────────────────────────────────────────────────────────────────────
// Schéma confirmé via synthese_multi_clients/page.tsx :
// - Table clients : synthese_multi_clients_cache, row_kind = 'client', annee = N.
//   Colonne tiers réelle sur CETTE table : numero_tiers (confirmée, aucune erreur).
// - "Profil CA 12MG" : calculé côté client (caBand), pas une colonne stockée.
// - Dates de visite : objectif_tiers, domaine='Visite', 24 rubriques, valeur_date.
// - Actions client : todo_actions.numero_tiers (migration à appliquer).
//
// - facture_lignes : erreur confirmée en prod → "numero_tiers" N'EXISTE PAS
//   sur cette table. Seule numero_tiers_entete existe. Colonnes de date
//   (date_document / date_facture / date_piece) toujours non confirmées :
//   plus aucun filtre/tri serveur dessus, tout est fait côté client sur les
//   lignes déjà récupérées (impossible de planter sur un nom de colonne
//   inconnu quand on ne fait que lire des clés d'objet).
//
// - Devis N-1 (comparaison) : la valeur brute du cache au niveau client
//   (devis_ytd_n1) est fausse/à 0 pour certains clients — le desktop la
//   recalcule à partir des lignes mensuelles du cache
//   (recomputeClientN1ComparisonFromMonths). Reproduit ici pour Devis
//   uniquement — CA et Marge N-1 du cache client correspondent déjà
//   exactement au desktop, testé sur DUPRE HABITAT ENERGIES.
//
// - Actions (todo_actions) : désormais éditables au tap (assigned_to,
//   status, due_date, description_action) via MobileTaskDetailSheet,
//   au lieu du MobileDetailSheet générique en lecture seule.
// ─────────────────────────────────────────────────────────────────────────

const N = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1
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
function pick(row: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const v = row?.[key]
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}
const NUMERO_KEYS = ['numero_piece', 'numero_document', 'num_piece', 'facture', 'piece']
const DATE_KEYS = ['date_document', 'date_facture', 'date_piece', 'date_bl', 'date_piece_bl', 'date_livraison_bl', 'date_livraison', 'date_devis', 'date']

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
  devisYtdN: number
  margePctYtdN: number | null
  margePctYtdN1: number | null
}

type DocLigne = { numero: string; date: string; montant_ht: number }
type ActionRow = { id: string; libelle: string; status: string; due_date: string | null; assigned_to: string | null }
type ClientDetail = {
  commandes: DocLigne[]
  devis: DocLigne[]
  actions: ActionRow[]
  derniereVisite: string
  prochaineVisite: string
  devisYtdN1: number
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
          'numero_tiers,intitule_tiers,date_creation,ca_n1,ca_ytd_n,ca_ytd_n1,devis_ytd_n,marge_pct_ytd_n,marge_ytd_n1_value',
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

  // Recherche : pas de limite basse ici (slice(0, 40) large), la liste
  // complète des clients est chargée en mémoire dès le montage.
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

      const [cdcRes, devisRes, visitesRes, actionsRes, monthRes] = await Promise.all([
        // Confirmé : les commandes (CDC) sont dans activite_lignes, avec le
        // libellé complet "Bon de commande" — pas dans facture_lignes.
        supabase
          .from('activite_lignes')
          .select('*')
          .eq('type_document', 'Bon de commande')
          .eq('numero_tiers_entete', client.numero)
          .limit(200),
        // Devis : table dédiée devis_lignes (cf. synthese_multi_clients/page.tsx,
        // qui va y chercher les dates), pas facture_lignes.
        supabase
          .from('devis_lignes')
          .select('*')
          .eq('numero_tiers_entete', client.numero)
          .limit(300),
        supabase
          .from('objectif_tiers')
          .select('valeur_date')
          .eq('numero_tiers', client.numero)
          .eq('annee', N)
          .eq('domaine', 'Visite')
          .not('valeur_date', 'is', null),
        supabase
          .from('todo_actions')
          .select('id,description_action,status,due_date,assigned_to')
          .eq('numero_tiers', client.numero)
          .order('due_date', { ascending: true })
          .limit(30),
        // Recalcul du Devis N-1 comparable, comme le fait le desktop
        // (recomputeClientN1ComparisonFromMonths) : la valeur brute au
        // niveau client (devis_ytd_n1) n'est pas fiable pour Devis.
        supabase
          .from('synthese_multi_clients_cache')
          .select('mois,devis_n1')
          .eq('annee', N)
          .eq('row_kind', 'month')
          .eq('numero_tiers', client.numero),
      ])

      // Tri + filtrage "2 derniers mois" côté client : aucune colonne de
      // date de facture_lignes n'est confirmée, donc aucun .order()/.gte()
      // serveur dessus (ça avait fait planter la requête précédemment).
      function mapAndSortDocs(res: { data: any[] | null; error: any }, sinceIso?: string): DocLigne[] {
        if (res.error) {
          loadErrors.push(res.error.message)
          return []
        }
        let docs = (res.data || []).map((r) => ({
          numero: safeText(pick(r, NUMERO_KEYS)),
          date: normalizeDateIso(pick(r, DATE_KEYS)),
          montant_ht: safeNumber(r.montant_ht),
        }))
        if (sinceIso) docs = docs.filter((d) => !d.date || d.date >= sinceIso)
        docs.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        return docs
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

      let devisYtdN1 = 0
      if (monthRes.error) {
        loadErrors.push(monthRes.error.message)
      } else {
        devisYtdN1 = (monthRes.data || [])
          .filter((r: any) => Number(r.mois || 0) <= CURRENT_MONTH)
          .reduce((sum: number, r: any) => sum + safeNumber(r.devis_n1), 0)
      }

      setDetail({
        commandes: mapAndSortDocs(cdcRes).slice(0, 20),
        devis: mapAndSortDocs(devisRes, twoMonthsAgo).slice(0, 50),
        actions: actionsRes.error
          ? []
          : (actionsRes.data || []).map((r: any) => ({
              id: String(r.id),
              libelle: String(r.description_action || ''),
              status: String(r.status || ''),
              due_date: r.due_date || null,
              assigned_to: r.assigned_to || null,
            })),
        derniereVisite: past.length ? formatDateFr(past[past.length - 1]) : '',
        prochaineVisite: future.length ? formatDateFr(future[0]) : '',
        devisYtdN1,
        loadErrors,
      })
    } catch (e) {
      console.error('[MobileClients] erreur chargement fiche client', e)
      setDetail({
        commandes: [], devis: [], actions: [], derniereVisite: '', prochaineVisite: '', devisYtdN1: 0,
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
        onActionSaved={(updated) => {
          setDetail((cur) => {
            if (!cur) return cur
            return {
              ...cur,
              actions: cur.actions.map((a) =>
                a.id === updated.id
                  ? {
                      id: updated.id,
                      libelle: updated.description_action || '',
                      status: updated.status,
                      due_date: updated.due_date,
                      assigned_to: updated.assigned_to,
                    }
                  : a,
              ),
            }
          })
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
  client, detail, loading, onBack, onActionSaved,
}: {
  client: ClientRow
  detail: ClientDetail | null
  loading: boolean
  onBack: () => void
  onActionSaved: (updated: TaskRow) => void
}) {
  const [openDetail, setOpenDetail] = useState<{ title: string; subtitle?: string; fields: DetailField[] } | null>(null)
  const [openTask, setOpenTask] = useState<TaskRow | null>(null)

  function openActionDetail(a: ActionRow) {
    setOpenTask({
      id: a.id,
      description_action: a.libelle,
      status: a.status,
      due_date: a.due_date,
      numero_tiers: client.numero,
      assigned_to: a.assigned_to,
    })
  }

  function openDocDetail(d: DocLigne, type: 'Commande (CDC)' | 'Devis') {
    setOpenDetail({
      title: d.numero || '(sans numéro)',
      subtitle: type,
      fields: [
        { label: 'N° de pièce', value: d.numero },
        { label: 'Date', value: formatDateFr(d.date) },
        { label: 'Montant HT', value: formatMoney(d.montant_ht) },
        { label: 'Client', value: `${client.nom} (${client.numero})` },
      ],
    })
  }

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
              {loading || !detail ? (
                <span style={{ color: 'rgba(255,255,255,0.4)' }}>…</span>
              ) : (
                <EvolLine value={client.devisYtdN} n1={detail.devisYtdN1} />
              )}
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
                subtitle={[
                  a.due_date ? `Échéance ${formatDateFr(normalizeDateIso(a.due_date))}` : '',
                  a.assigned_to ? `Assigné : ${a.assigned_to}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={a.status}
                onClick={() => openActionDetail(a)}
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
              <RowItem
                key={`${d.numero}-${i}`}
                title={d.numero || '—'}
                subtitle={formatDateFr(d.date)}
                trailing={formatMoney(d.montant_ht)}
                onClick={() => openDocDetail(d, 'Commande (CDC)')}
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
            detail.devis.map((d, i) => (
              <RowItem
                key={`${d.numero}-${i}`}
                title={d.numero || '—'}
                subtitle={formatDateFr(d.date)}
                trailing={formatMoney(d.montant_ht)}
                onClick={() => openDocDetail(d, 'Devis')}
              />
            ))
          )}
        </Section>
      </div>

      {openDetail && (
        <MobileDetailSheet
          title={openDetail.title}
          subtitle={openDetail.subtitle}
          fields={openDetail.fields}
          onClose={() => setOpenDetail(null)}
        />
      )}

      {openTask && (
        <MobileTaskDetailSheet
          task={openTask}
          onClose={() => setOpenTask(null)}
          onSaved={onActionSaved}
        />
      )}
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

function RowItem({
  title, subtitle, trailing, onClick,
}: { title: string; subtitle?: string; trailing?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.03)',
        padding: '9px 12px',
        cursor: onClick ? 'pointer' : 'default',
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
