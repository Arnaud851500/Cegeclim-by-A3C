'use client'

// Fiche d'un client « Convention CEE » (30/09/2026)
//
// Une ligne par parcours de vente, du devis à la facture :
//   Devis → Commande (CDC) → Préparation (PL) → BL → Facture
// Selon les cas on n'a que le devis, ou devis + commande, ou le parcours
// complet ; chaque document affiche son n°, sa date et son montant HT.
//
// Rattachements (RPC get_cee_client_parcours, migration
// 20260930_cee_clients_convention.sql) :
//   * CDC → PL → BL → facture : n° de commande / de BL portés par les lignes SAGE
//     (les BL facturés sont reconstitués à partir des lignes de facture) ;
//   * devis → CDC : lien SAGE quand il existe, sinon déduit de la référence
//     chantier (badge « déduit ») — SAGE n'exporte plus ce lien depuis juin 2026.
//
// Filtres : parcours contenant du R/O, parcours contenant l'article
// CEEPRENIUM (CEE Premium), étape atteinte, recherche. Un clic sur un
// document ouvre une fenêtre flottante avec ses lignes
// (RPC get_cee_document_detail).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

type TypeDoc = 'DE' | 'CDC' | 'PL' | 'BL' | 'FA'

type DocRef = {
  piece: string
  date: string | null
  ht: number | null
  ht_total?: number | null
  ro: boolean
  cee: boolean
  ref?: string | null
  lien?: 'sage' | 'reference' | null
  ouverte?: boolean
  facture?: boolean
}

type Parcours = {
  cle: string
  reference: string | null
  date_debut: string | null
  date_fin: string | null
  ro: boolean
  cee_premium: boolean
  etape: 'devis' | 'cdc' | 'pl' | 'bl' | 'facture'
  devis: DocRef[]
  cdc: DocRef[]
  pl: DocRef[]
  bl: DocRef[]
  factures: DocRef[]
}

type ClientInfo = {
  numero: string
  intitule: string
  adresse: string | null
  code_postal: string | null
  ville: string | null
  telephone: string | null
  email: string | null
  rge: string | null
  convention_cee: string | null
  representant: string | null
  collaborateur: string | null
  agence: string | null
}

type LigneDetail = {
  etape: TypeDoc
  piece: string
  date: string | null
  article: string | null
  designation: string | null
  famille: string | null
  quantite: number | null
  pu_net: number | null
  ht: number | null
  cdc: string | null
  bl: string | null
  ro: boolean
  cee_premium: boolean
}

type DetailDoc = {
  type: TypeDoc
  piece: string
  date: string | null
  reference: string | null
  ht: number | null
  ro: boolean
  cee_premium: boolean
  lignes: LigneDetail[]
}

const TYPE_LABEL: Record<TypeDoc, string> = { DE: 'Devis', CDC: 'Commande client', PL: 'Préparation de livraison', BL: 'Bon de livraison', FA: 'Facture' }

const ETAPE_LABEL: Record<Parcours['etape'], string> = {
  devis: 'Devis',
  cdc: 'Commandé',
  pl: 'En préparation',
  bl: 'Livré',
  facture: 'Facturé',
}

const ETAPE_STYLE: Record<Parcours['etape'], { bg: string; fg: string }> = {
  devis: { bg: '#EFEDE8', fg: '#44494E' },
  cdc: { bg: '#FDF1DE', fg: '#93600F' },
  pl: { bg: '#FDF1DE', fg: '#93600F' },
  bl: { bg: '#EEF5FA', fg: '#2E5E80' },
  facture: { bg: '#EAF3E8', fg: '#2E6B3E' },
}

function debutAnnee(): string {
  return `${new Date().getFullYear()}-01-01`
}

function euros(v: number | null | undefined, decimals = 0): string {
  return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function dateFr(v: string | null | undefined): string {
  if (!v) return '—'
  const [y, m, d] = v.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function qte(v: number | null | undefined): string {
  const n = Number(v || 0)
  return n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
}

export default function ClientCeeDetailPage() {
  const router = useRouter()
  const params = useParams<{ numero: string }>()
  const numero = decodeURIComponent(String(params?.numero || ''))
  const { rights, loading: accessLoading } = useAccess()

  const [accesAccorde, setAccesAccorde] = useState(false)
  useEffect(() => {
    if (accessLoading) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- verrou d'accès, posé une seule fois
    if (rights.can_financement) setAccesAccorde(true)
    else router.replace('/unauthorized')
  }, [accessLoading, rights.can_financement, router])

  const [depuis, setDepuis] = useState<string>(debutAnnee())
  const [roOnly, setRoOnly] = useState(false)
  const [ceeOnly, setCeeOnly] = useState(false)
  const [etapeFiltre, setEtapeFiltre] = useState<'' | Parcours['etape']>('')
  const [recherche, setRecherche] = useState('')
  const [pret, setPret] = useState(false)

  const [client, setClient] = useState<ClientInfo | null>(null)
  const [parcours, setParcours] = useState<Parcours[]>([])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const [docOuvert, setDocOuvert] = useState<{ type: TypeDoc; piece: string } | null>(null)
  const [detail, setDetail] = useState<DetailDoc | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  // Filtres transmis par la liste (?depuis=AAAA-MM-JJ&ro=1)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const d = sp.get('depuis')
    /* eslint-disable react-hooks/set-state-in-effect -- lecture unique de l'URL au montage */
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDepuis(d)
    if (sp.get('ro') === '1') setRoOnly(true)
    if (sp.get('cee') === '1') setCeeOnly(true)
    setPret(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  useEffect(() => {
    if (!accesAccorde || !pret || !numero || !depuis) return
    let annule = false
    async function charger() {
      setLoading(true)
      setErrorMsg('')
      const { data, error } = await supabase.rpc('get_cee_client_parcours', { p_numero: numero, p_depuis: depuis })
      if (annule) return
      setLoading(false)
      if (error) {
        setErrorMsg(`Chargement impossible : ${error.message}`)
        setParcours([])
        return
      }
      const res = data as { client?: ClientInfo; parcours?: Parcours[] } | null
      setClient(res?.client || null)
      setParcours(res?.parcours || [])
    }
    void charger()
    return () => {
      annule = true
    }
  }, [accesAccorde, pret, numero, depuis])

  // Garde les filtres dans l'URL (lien partageable, retour arrière)
  useEffect(() => {
    if (!pret) return
    const url = new URL(window.location.href)
    url.searchParams.set('depuis', depuis)
    if (roOnly) url.searchParams.set('ro', '1')
    else url.searchParams.delete('ro')
    if (ceeOnly) url.searchParams.set('cee', '1')
    else url.searchParams.delete('cee')
    window.history.replaceState(null, '', url.toString())
  }, [pret, depuis, roOnly, ceeOnly])

  const ouvrirDoc = useCallback(
    async (type: TypeDoc, piece: string) => {
      setDocOuvert({ type, piece })
      setDetail(null)
      setDetailError('')
      setDetailLoading(true)
      const { data, error } = await supabase.rpc('get_cee_document_detail', { p_numero: numero, p_type: type, p_piece: piece })
      setDetailLoading(false)
      if (error) {
        setDetailError(`Détail indisponible : ${error.message}`)
        return
      }
      setDetail(data as DetailDoc)
    },
    [numero]
  )

  useEffect(() => {
    if (!docOuvert) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDocOuvert(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docOuvert])

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    return parcours.filter((p) => {
      if (roOnly && !p.ro) return false
      if (ceeOnly && !p.cee_premium) return false
      if (etapeFiltre && p.etape !== etapeFiltre) return false
      if (!q) return true
      const hay = [p.reference, ...p.devis.map((d) => d.piece), ...p.cdc.map((d) => d.piece), ...p.pl.map((d) => d.piece), ...p.bl.map((d) => d.piece), ...p.factures.map((d) => d.piece)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [parcours, roOnly, ceeOnly, etapeFiltre, recherche])

  const kpis = useMemo(() => {
    const somme = (docs: DocRef[]) => docs.reduce((t, d) => t + Number(d.ht || 0), 0)
    return {
      total: filtres.length,
      ro: filtres.filter((p) => p.ro).length,
      cee: filtres.filter((p) => p.cee_premium).length,
      devis: filtres.reduce((t, p) => t + somme(p.devis), 0),
      commande: filtres.reduce((t, p) => t + somme(p.cdc), 0),
      facture: filtres.reduce((t, p) => t + somme(p.factures), 0),
    }
  }, [filtres])

  const nbParEtape = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of parcours) {
      if (roOnly && !p.ro) continue
      if (ceeOnly && !p.cee_premium) continue
      m[p.etape] = (m[p.etape] || 0) + 1
    }
    return m
  }, [parcours, roOnly, ceeOnly])

  function retourListe() {
    const qs = new URLSearchParams({ depuis })
    if (roOnly) qs.set('ro', '1')
    router.push(`/financement/clients-cee?${qs.toString()}`)
  }

  if (!accesAccorde) return <div className="min-h-screen bg-[#F4F3F0]" />

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      <header className="border-b border-[#1E2833] bg-[#111820]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-3 px-4 py-6 md:px-8">
          <button type="button" onClick={retourListe} className="w-fit text-xs font-medium text-slate-300 hover:text-white">
            ← Clients Convention CEE
          </button>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#9EAD43]">Financement CEE · Client {numero}</div>
          <h1 className="text-[26px] font-bold leading-tight text-white md:text-[30px]">{client?.intitule || numero}</h1>
          {client && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-300">
              <span>
                {[client.adresse, [client.code_postal, client.ville].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Adresse non renseignée'}
              </span>
              {client.telephone && <span>{client.telephone}</span>}
              {client.email && <span>{client.email}</span>}
            </div>
          )}
          {client && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge label={`Collaborateur : ${client.collaborateur || client.representant || '—'}`} />
              <Badge label={`Agence : ${client.agence || '—'}`} />
              <Badge label={`Convention CEE : ${client.convention_cee || '—'}`} tone="gold" />
              {client.rge && <Badge label={`RGE : ${client.rge}`} />}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-6 md:px-8">
        <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#E2DFD8] bg-white p-4">
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            Documents depuis le
            <input
              type="date"
              value={depuis}
              onChange={(e) => e.target.value && setDepuis(e.target.value)}
              className="h-10 rounded-xl border border-[#D8D3C8] px-3 text-sm text-slate-900 focus:border-[#B4761A] focus:outline-none"
            />
          </label>
          <Case checked={roOnly} onChange={setRoOnly} label="Uniquement avec du R/O" />
          <Case checked={ceeOnly} onChange={setCeeOnly} label="Uniquement avec CEE Premium" hint="Article CEEPRENIUM présent dans au moins un document du parcours" />
          <label className="grid min-w-[220px] flex-1 gap-1 text-xs font-medium text-slate-500">
            Recherche
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Référence chantier ou n° de document…"
              className="h-10 rounded-xl border border-[#D8D3C8] px-3 text-sm text-slate-900 focus:border-[#B4761A] focus:outline-none"
            />
          </label>
        </section>

        <div className="mt-3 flex flex-wrap gap-2">
          <FiltreEtape actif={etapeFiltre === ''} onClick={() => setEtapeFiltre('')} label="Toutes les étapes" />
          {(['devis', 'cdc', 'pl', 'bl', 'facture'] as const).map((e) =>
            nbParEtape[e] ? (
              <FiltreEtape key={e} actif={etapeFiltre === e} onClick={() => setEtapeFiltre(etapeFiltre === e ? '' : e)} label={`${ETAPE_LABEL[e]} (${nbParEtape[e]})`} />
            ) : null
          )}
        </div>

        {errorMsg && <div className="mt-4 rounded-xl border border-[#E7B7A6] bg-[#FBE9E9] px-4 py-3 text-sm text-[#A32C2C]">{errorMsg}</div>}

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Kpi label="Parcours affichés" value={String(kpis.total)} />
          <Kpi label="Avec du R/O" value={String(kpis.ro)} />
          <Kpi label="Avec CEE Premium" value={String(kpis.cee)} accent="#2E5E80" />
          <Kpi label="Devis HT" value={euros(kpis.devis)} />
          <Kpi label="Commandé HT" value={euros(kpis.commande)} />
          <Kpi label="Facturé HT" value={euros(kpis.facture)} accent="#2E6B3E" />
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[#E2DFD8] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2DFD8] px-4 py-3">
            <h2 className="text-[15px] font-semibold text-slate-900">{loading ? 'Chargement…' : `${filtres.length} parcours de vente`}</h2>
            <span className="text-xs text-slate-500">Une ligne par parcours, du devis à la facture · cliquez sur un document pour voir son détail</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1280px] text-sm">
              <thead>
                <tr className="border-b border-[#E7E4DD] bg-[#FAF9F7] text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5">Référence chantier</th>
                  <th className="px-3 py-2.5">Devis</th>
                  <th className="px-3 py-2.5">Commande</th>
                  <th className="px-3 py-2.5">BL</th>
                  <th className="px-3 py-2.5">Facture</th>
                  <th className="px-3 py-2.5 text-center">R/O</th>
                  <th className="px-3 py-2.5 text-center">CEE Premium</th>
                  <th className="px-3 py-2.5">Étape</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map((p) => (
                  <tr key={p.cle} className="border-b border-[#F0EEE8] align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{p.reference || <span className="font-normal italic text-slate-400">Sans référence</span>}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {dateFr(p.date_debut)}
                        {p.date_fin && p.date_fin !== p.date_debut ? ` → ${dateFr(p.date_fin)}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <Docs docs={p.devis} type="DE" onOpen={ouvrirDoc} />
                    </td>
                    <td className="px-3 py-3">
                      <Docs docs={p.cdc} type="CDC" onOpen={ouvrirDoc} />
                      {p.pl.length > 0 && (
                        <div className="mt-1.5">
                          <Docs docs={p.pl} type="PL" onOpen={ouvrirDoc} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Docs docs={p.bl} type="BL" onOpen={ouvrirDoc} />
                    </td>
                    <td className="px-3 py-3">
                      <Docs docs={p.factures} type="FA" onOpen={ouvrirDoc} />
                    </td>
                    <td className="px-3 py-3 text-center">{p.ro ? <Pastille label="R/O" bg="#F1ECF8" fg="#5E4390" /> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3 text-center">{p.cee_premium ? <Pastille label="Oui" bg="#EEF5FA" fg="#2E5E80" /> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-3">
                      <Pastille label={ETAPE_LABEL[p.etape]} bg={ETAPE_STYLE[p.etape].bg} fg={ETAPE_STYLE[p.etape].fg} />
                    </td>
                  </tr>
                ))}
                {!loading && filtres.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                      Aucun document de vente ne correspond aux filtres depuis le {dateFr(depuis)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-3 grid gap-1 text-xs leading-relaxed text-slate-500">
          <p>
            Commande : montant reconstitué (lignes encore en commande + lignes préparées, livrées ou facturées sous ce n°). Facture : part de la facture
            rattachée à ce parcours ; le total de la facture est dans le détail quand elle couvre plusieurs commandes.
          </p>
          <p>
            <span className="rounded bg-[#FDF1DE] px-1.5 py-0.5 font-semibold text-[#93600F]">déduit</span> : devis rattaché à la commande par la
            référence chantier (même référence, devis de moins d&apos;un an avant la commande), SAGE n&apos;exportant plus le lien devis → commande.
          </p>
        </div>
      </main>

      {docOuvert && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setDocOuvert(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="grid max-h-[calc(100vh-48px)] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2DFD8] px-5 py-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{TYPE_LABEL[docOuvert.type]}</div>
                <h2 className="text-lg font-semibold text-slate-900">{docOuvert.piece}</h2>
                {detail && (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>{dateFr(detail.date)}</span>
                    {detail.reference && <span>· Réf. {detail.reference}</span>}
                    <span>· {euros(detail.ht, 2)} HT</span>
                    {detail.ro && <Pastille label="R/O" bg="#F1ECF8" fg="#5E4390" />}
                    {detail.cee_premium && <Pastille label="CEE Premium" bg="#EEF5FA" fg="#2E5E80" />}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setDocOuvert(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-[#F4F3F0]">
                Fermer
              </button>
            </div>
            <div className="overflow-auto">
              {detailLoading && <div className="p-6 text-sm text-slate-500">Chargement des lignes…</div>}
              {detailError && <div className="p-6 text-sm text-[#A32C2C]">{detailError}</div>}
              {detail && (
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="sticky top-0 bg-[#FAF9F7]">
                    <tr className="border-b border-[#E7E4DD] text-left text-xs uppercase tracking-wide text-slate-500">
                      {(docOuvert.type === 'CDC' || docOuvert.type === 'BL') && <th className="px-4 py-2">Étape</th>}
                      <th className="px-4 py-2">Article</th>
                      <th className="px-4 py-2">Désignation</th>
                      <th className="px-4 py-2">Famille</th>
                      <th className="px-4 py-2 text-right">Qté</th>
                      <th className="px-4 py-2 text-right">PU net</th>
                      <th className="px-4 py-2 text-right">Montant HT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lignes.map((l, i) => (
                      <tr key={i} className={`border-b border-[#F0EEE8] ${l.ro ? 'bg-[#FAF8FD]' : ''}`}>
                        {(docOuvert.type === 'CDC' || docOuvert.type === 'BL') && (
                          <td className="px-4 py-2 text-xs text-slate-600">
                            <div>{ETAPE_LIGNE[l.etape]}</div>
                            <div className="font-mono text-[11px] text-slate-400">{l.piece}</div>
                          </td>
                        )}
                        <td className="px-4 py-2">
                          <div className="font-mono text-xs text-slate-800">{l.article || '—'}</div>
                          <div className="mt-0.5 flex gap-1">
                            {l.ro && <Pastille label="R/O" bg="#F1ECF8" fg="#5E4390" />}
                            {l.cee_premium && <Pastille label="CEE Premium" bg="#EEF5FA" fg="#2E5E80" />}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-700">{l.designation || '—'}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{l.famille || '—'}</td>
                        <td className="px-4 py-2 text-right">{qte(l.quantite)}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{l.pu_net != null ? euros(l.pu_net, 2) : '—'}</td>
                        <td className="px-4 py-2 text-right font-medium text-slate-900">{euros(l.ht, 2)}</td>
                      </tr>
                    ))}
                    {detail.lignes.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                          Aucune ligne trouvée pour ce document.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2DFD8] px-5 py-3 text-xs text-slate-500">
              <span>
                {detail ? `${detail.lignes.length} ligne${detail.lignes.length > 1 ? 's' : ''}` : ''}
                {detail && detail.lignes.some((l) => l.ro) ? ` · ${detail.lignes.filter((l) => l.ro).length} ligne(s) R/O surlignée(s)` : ''}
              </span>
              <span>Échap pour fermer</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const ETAPE_LIGNE: Record<TypeDoc, string> = { DE: 'Devis', CDC: 'En commande', PL: 'En préparation', BL: 'Livré, non facturé', FA: 'Facturé' }

function Docs({ docs, type, onOpen }: { docs: DocRef[]; type: TypeDoc; onOpen: (type: TypeDoc, piece: string) => void }) {
  if (!docs.length) return <span className="text-slate-300">—</span>
  return (
    <div className="grid gap-1.5">
      {docs.map((d) => (
        <button
          key={d.piece}
          type="button"
          onClick={() => onOpen(type, d.piece)}
          className="group grid w-full min-w-[150px] gap-0.5 rounded-lg border border-[#E7E4DD] bg-[#FAF9F7] px-2.5 py-1.5 text-left transition hover:border-[#B4761A] hover:bg-[#FAF7EE]"
          title={`Voir le détail de ${d.piece}`}
        >
          <span className="flex flex-wrap items-center gap-1">
            <span className="font-mono text-xs font-semibold text-slate-900 group-hover:text-[#B4761A]">{d.piece}</span>
            {type === 'PL' && <Mini label="PL" bg="#EFEDE8" fg="#44494E" />}
            {d.lien === 'reference' && <Mini label="déduit" bg="#FDF1DE" fg="#93600F" />}
            {type === 'CDC' && d.ouverte && <Mini label="en cours" bg="#FDF1DE" fg="#93600F" />}
            {type === 'BL' && d.facture === false && <Mini label="non facturé" bg="#EEF5FA" fg="#2E5E80" />}
            {d.cee && <Mini label="CEE" bg="#EEF5FA" fg="#2E5E80" />}
          </span>
          <span className="flex justify-between gap-2 text-[11px] text-slate-500">
            <span>{dateFr(d.date)}</span>
            <span className="font-medium text-slate-700">
              {euros(d.ht)}
              {d.ht_total != null && Math.abs(Number(d.ht_total) - Number(d.ht || 0)) > 0.5 ? ` / ${euros(d.ht_total)}` : ''}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

function Case({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label
      title={hint}
      className={`flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm transition ${
        checked ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#D8D3C8] text-slate-800 hover:border-[#B4761A]'
      }`}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#9EAD43]" />
      {label}
    </label>
  )
}

function FiltreEtape({ actif, onClick, label }: { actif: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        actif ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#E2DFD8] bg-white text-slate-700 hover:border-[#B4761A]'
      }`}
    >
      {label}
    </button>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-[#E2DFD8] bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold" style={{ color: accent || '#0F172A' }}>
        {value}
      </div>
    </div>
  )
}

function Badge({ label, tone }: { label: string; tone?: 'gold' }) {
  return (
    <span
      className="rounded-full border px-2.5 py-1"
      style={tone === 'gold' ? { borderColor: '#9EAD43', color: '#D9E3A0' } : { borderColor: '#394652', color: '#CBD5E1' }}
    >
      {label}
    </span>
  )
}

function Pastille({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function Mini({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span className="rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}
