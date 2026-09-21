'use client'

// ============================================================================
// app/stock/groupes/page.tsx — Disponibilité par groupe d'articles
// ----------------------------------------------------------------------------
// (2026-09-18) Groupes d'articles nommés (table stock_groupes_articles) et,
// pour le groupe choisi, à chaque échéance (aujourd'hui + fins de mois) :
//   • capacité de prise de commande livrable d'ici l'échéance sans repousser
//     une commande client déjà en base (min du stock projeté à partir de P) ;
//   • commandes clients déjà prises livrables sur la période, à leur date de
//     complétude (v_portefeuille_couverture_stock.date_couverture_estimee),
//     ventilées par référence et par agence ;
//   • arrivées de stock (CDF SAGE) datées.
// Calcul côté base : RPC get_stock_groupe_disponibilite(p_references,
// p_periodes) → jsonb { periodes, references, agences, receptions, cdc }.
// Même moteur d'événements que l'écran Stock articles (/stock).
// ?groupe=<uuid> ouvre directement un groupe ; ?refs=A,B,C un groupe ad hoc.
// À ajouter dans lib/navigation.ts sous « Stocks & logistique ».
// ÉVOLUTION (2026-09-20) :
//   • vocabulaire : « Qté dispo pour nouvelles CDC avec livraison d'ici à »,
//     « CDC à livrer d'ici à » (à la date de livraison DEMANDÉE, part non
//     livrable à cette date en rouge), « CDF à recevoir d'ici à » ;
//   • graphique en barres miroir par période : réceptions au-dessus, CDC à
//     livrer en dessous (orange = livrables à temps, rouge = non livrables) ;
//   • tableau par référence sur toute la largeur : stock dispo, puis période
//     par période à livrer / non livrables / à recevoir / stock projeté fin de
//     période / qté dispo pour nouvelles CDC ; la répartition par agence est
//     repliée derrière un bouton.
//   Les ventilations « à livrer » et « à recevoir » par période sont calculées
//   côté navigateur à partir des lignes CDC et des réceptions renvoyées par le
//   RPC (aucun changement côté base).
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'

// ── Types ─────────────────────────────────────────────────────────────────
type Groupe = { id: string; nom: string; description: string | null; references_articles: string[]; updated_at: string }
type PeriodeTotal = { p: string; atp: number; cdc_livrables: number; nb_cdc_livrables: number; receptions: number }
type RefPeriode = { p: string; atp: number; cdc_livrables: number; receptions: number }
type RefDispo = { ref: string; designation: string | null; stock_dispo: number; premiere_date: string | null; periodes: RefPeriode[] }
type AgencePeriode = { p: string; q: number; nb: number }
type AgenceDispo = { agence: string; total: number; periodes: AgencePeriode[] }
type Reception = { d: string; q: number; n: number; refs: Record<string, number> }
type CdcRow = {
  ref: string; id: string; numero_document: string | null; nom_tiers: string | null; numero_tiers: string | null; agence: string
  date_creation: string | null; date_livraison: string | null; date_complete: string; quantite: number; montant_ht: number; statut: string
}
type Dispo = { periodes: PeriodeTotal[]; references: RefDispo[]; agences: AgenceDispo[]; receptions: Reception[]; cdc: CdcRow[] }

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function formatNumber(n: number | null | undefined): string { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR') }
function formatMoney(n: number): string { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0) }
function formatDateFr(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function formatDateCourte(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y.slice(2)}` }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function todayIso(): string { return toIsoDate(new Date()) }
function finDeMois(offset: number): string { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0); return toIsoDate(d) }
function libellePeriode(p: string, index: number): string {
  if (index === 0) return `Aujourd'hui · ${formatDateCourte(p)}`
  const d = new Date(`${p}T00:00:00`)
  return `Fin ${d.toLocaleDateString('fr-FR', { month: 'long' })}`
}
/** Code couleur des quantités disponibles pour de nouvelles CDC : vert = on
 * peut prendre des commandes, rouge = rien de promissible à cette échéance. */
function couleurAtp(n: number): string { return n > 0 ? '#8fd4a8' : '#e0a685' }
const C_REC = '#8FC7DA'     // CDF à recevoir
const C_LIV = '#E0A961'     // CDC à livrer, livrables à temps
const C_NONLIV = '#e0a685'  // CDC à livrer, non livrables à leur date

/** Ventilation par période (intervalle ]P(i−1) ; P(i)], la première = aujourd'hui
 * et l'antériorité) : à livrer (date DEMANDÉE), dont non livrables à cette
 * date (date de complétude > fin de période ou inconnue), à recevoir. */
type Ventil = { p: string; aLivrer: number; nonLivrable: number; nbALivrer: number; nbNonLivrable: number; aRecevoir: number; cumALivrer: number; cumNonLivrable: number; cumARecevoir: number }
function ventiler(periodes: string[], cdc: Array<{ date_livraison: string | null; date_complete: string | null; quantite: number }>, receptions: Array<{ d: string; q: number }>): Ventil[] {
  const out: Ventil[] = periodes.map((p) => ({ p, aLivrer: 0, nonLivrable: 0, nbALivrer: 0, nbNonLivrable: 0, aRecevoir: 0, cumALivrer: 0, cumNonLivrable: 0, cumARecevoir: 0 }))
  const auj = periodes[0]
  const idx = (d: string | null): number => {
    const dd = d && d >= auj ? d : auj
    const i = periodes.findIndex((p) => dd <= p)
    return i // −1 = au-delà de l'horizon
  }
  for (const c of cdc) {
    const i = idx(c.date_livraison)
    if (i < 0) continue
    out[i].aLivrer += c.quantite; out[i].nbALivrer += 1
    if (!c.date_complete || c.date_complete > periodes[i]) { out[i].nonLivrable += c.quantite; out[i].nbNonLivrable += 1 }
  }
  for (const r of receptions) {
    const i = idx(r.d)
    if (i < 0) continue
    out[i].aRecevoir += r.q
  }
  let cl = 0, cr = 0
  for (const v of out) { cl += v.aLivrer; cr += v.aRecevoir; v.cumALivrer = cl; v.cumARecevoir = cr }
  // Non livrables en cumul : dues ≤ P et encore incomplètes à P (une CDC non
  // livrable à fin septembre peut l'être à fin octobre).
  out.forEach((v) => {
    v.cumNonLivrable = cdc.reduce((s, c) => {
      const due = c.date_livraison && c.date_livraison >= auj ? c.date_livraison : auj
      return due <= v.p && (!c.date_complete || c.date_complete > v.p) ? s + c.quantite : s
    }, 0)
  })
  return out
}
function parseReferences(q: string): string[] { return Array.from(new Set(q.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))) }
const STATUT_LABEL: Record<string, string> = { COUVERT: 'Couvert (stock)', COUVERT_PAR_RECEPTION: 'Couvert par réception', RECEPTION_TARDIVE: 'Réception tardive', RUPTURE: 'Rupture' }
const STATUT_COLOR: Record<string, string> = { COUVERT: '#8fd4a8', COUVERT_PAR_RECEPTION: '#8FC7DA', RECEPTION_TARDIVE: '#E0A961', RUPTURE: '#e0a685' }

// ── Page ──────────────────────────────────────────────────────────────────
export default function StockGroupesPage() {
  const [groupes, setGroupes] = useState<Groupe[]>([])
  const [groupeId, setGroupeId] = useState<string>('')
  const [refsAdHoc, setRefsAdHoc] = useState<string[]>([])
  const [horizonMois, setHorizonMois] = useState(4)
  const [data, setData] = useState<Dispo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editeur, setEditeur] = useState<{ id: string | null; nom: string; description: string; refs: string } | null>(null)
  const [sauvegarde, setSauvegarde] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Détail
  const [detailRef, setDetailRef] = useState('')
  const [detailAgence, setDetailAgence] = useState('')
  const [detailPeriode, setDetailPeriode] = useState('')

  const periodes = useMemo(() => [todayIso(), ...Array.from({ length: horizonMois }, (_, i) => finDeMois(i))], [horizonMois])
  const groupe = groupes.find((g) => g.id === groupeId) || null
  const references = groupe ? groupe.references_articles : refsAdHoc

  async function chargerGroupes(): Promise<Groupe[]> {
    const { data: rows, error: err } = await supabase.from('stock_groupes_articles').select('id,nom,description,references_articles,updated_at').order('nom')
    if (err) { setError(err.message); return [] }
    const list = (rows || []) as Groupe[]
    setGroupes(list)
    return list
  }

  useEffect(() => {
    void (async () => {
      const list = await chargerGroupes()
      const params = new URLSearchParams(window.location.search)
      const g = params.get('groupe')
      const refs = params.get('refs')
      if (refs) { setRefsAdHoc(parseReferences(refs)); setGroupeId('') } else if (g && list.some((x) => x.id === g)) setGroupeId(g)
      else if (list.length > 0) setGroupeId(list[0].id)
    })()
  }, [])

  useEffect(() => {
    if (references.length === 0) { setData(null); return }
    let cancelled = false
    async function charger() {
      setLoading(true); setError(null)
      const { data: res, error: err } = await supabase.rpc('get_stock_groupe_disponibilite', { p_references: references, p_periodes: periodes })
      if (cancelled) return
      if (err) { setError(err.message); setData(null) } else {
        const r = res as any
        setData({
          periodes: ((r.periodes || []) as any[]).map((p) => ({ p: p.p, atp: toNumber(p.atp), cdc_livrables: toNumber(p.cdc_livrables), nb_cdc_livrables: toNumber(p.nb_cdc_livrables), receptions: toNumber(p.receptions) })),
          references: ((r.references || []) as any[]).map((x) => ({ ref: x.ref, designation: x.designation, stock_dispo: toNumber(x.stock_dispo), premiere_date: x.premiere_date, periodes: ((x.periodes || []) as any[]).map((p) => ({ p: p.p, atp: toNumber(p.atp), cdc_livrables: toNumber(p.cdc_livrables), receptions: toNumber(p.receptions) })) })),
          agences: ((r.agences || []) as any[]).map((a) => ({ agence: a.agence, total: toNumber(a.total), periodes: ((a.periodes || []) as any[]).map((p) => ({ p: p.p, q: toNumber(p.q), nb: toNumber(p.nb) })) })),
          receptions: ((r.receptions || []) as any[]).map((x) => ({ d: x.d, q: toNumber(x.q), n: toNumber(x.n), refs: x.refs || {} })),
          cdc: ((r.cdc || []) as any[]).map((c) => ({ ...c, quantite: toNumber(c.quantite), montant_ht: toNumber(c.montant_ht) })),
        })
      }
      setLoading(false)
    }
    void charger()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references.join('|'), periodes.join('|')])

  function choisirGroupe(id: string) {
    setGroupeId(id); setRefsAdHoc([]); setDetailRef(''); setDetailAgence(''); setDetailPeriode('')
    const url = new URL(window.location.href); url.searchParams.set('groupe', id); url.searchParams.delete('refs'); window.history.replaceState(null, '', url.toString())
  }

  async function sauvegarderGroupe() {
    if (!editeur) return
    const refs = parseReferences(editeur.refs)
    if (!editeur.nom.trim() || refs.length === 0) { setError('Un nom et au moins une référence sont nécessaires.'); return }
    setSauvegarde(true); setError(null)
    const payload = { nom: editeur.nom.trim(), description: editeur.description.trim() || null, references_articles: refs }
    const res = editeur.id
      ? await supabase.from('stock_groupes_articles').update(payload).eq('id', editeur.id).select('id').single()
      : await supabase.from('stock_groupes_articles').insert(payload).select('id').single()
    setSauvegarde(false)
    if (res.error) { setError(res.error.message); return }
    const list = await chargerGroupes()
    setEditeur(null)
    const id = (res.data as any)?.id as string
    if (id && list.some((g) => g.id === id)) choisirGroupe(id)
  }

  async function supprimerGroupe(g: Groupe) {
    if (!window.confirm(`Supprimer le groupe « ${g.nom} » ?`)) return
    const { error: err } = await supabase.from('stock_groupes_articles').delete().eq('id', g.id)
    if (err) { setError(err.message); return }
    const list = await chargerGroupes()
    setEditeur(null)
    if (list.length > 0) choisirGroupe(list[0].id); else { setGroupeId(''); setData(null) }
  }

  const [afficherAgences, setAfficherAgences] = useState(false)
  const receptionsHorizon = useMemo(() => (data ? data.receptions.filter((r) => r.d <= periodes[periodes.length - 1]) : []), [data, periodes])

  // Ventilation par période du groupe et de chaque référence (à livrer à la
  // date demandée / non livrables / à recevoir), à partir des lignes du RPC.
  const ventilGroupe = useMemo(() => (data ? ventiler(periodes, data.cdc, data.receptions) : []), [data, periodes])
  const ventilParRef = useMemo(() => {
    const out: Record<string, Ventil[]> = {}
    if (!data) return out
    for (const r of data.references) {
      const recs = data.receptions.map((x) => ({ d: x.d, q: toNumber(x.refs[r.ref]) })).filter((x) => x.q > 0)
      out[r.ref] = ventiler(periodes, data.cdc.filter((c) => c.ref === r.ref), recs)
    }
    return out
  }, [data, periodes])
  const maxBarre = useMemo(() => Math.max(1, ...ventilGroupe.map((v) => Math.max(v.aRecevoir, v.aLivrer))), [ventilGroupe])
  const agencesTriees = useMemo(() => (data ? [...data.agences].sort((a, b) => (b.periodes[b.periodes.length - 1]?.q ?? 0) - (a.periodes[a.periodes.length - 1]?.q ?? 0)) : []), [data])
  const maxAgence = useMemo(() => Math.max(1, ...agencesTriees.map((a) => a.periodes[a.periodes.length - 1]?.q ?? 0)), [agencesTriees])

  const cdcDetail = useMemo(() => {
    if (!data) return []
    return data.cdc.filter((c) => (!detailRef || c.ref === detailRef) && (!detailAgence || c.agence === detailAgence) && (!detailPeriode || c.date_complete <= detailPeriode))
  }, [data, detailRef, detailAgence, detailPeriode])
  const detailActif = Boolean(detailRef || detailAgence || detailPeriode)

  async function exporterExcel() {
    if (!data) return
    setExporting(true)
    try {
      const wb = new ExcelJS.Workbook(); wb.creator = 'CEGECLIM by A3C'
      const header = (ws: ExcelJS.Worksheet, xSplit?: number) => {
        ws.getRow(1).eachCell((c) => {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }
          c.font = { color: { argb: 'FFF5F3EC' }, bold: true }
        })
        ws.views = [{ state: 'frozen', ySplit: 2, xSplit: xSplit ?? 0 }]
      }
      const libs = periodes.map((p, i) => libellePeriode(p, i))
      const ws1 = wb.addWorksheet('Synthèse')
      ws1.columns = [{ header: 'Échéance', key: 'p', width: 22 }, { header: 'Qté dispo pour nouvelles CDC livrées d\'ici à', key: 'atp', width: 30 }, { header: 'CDC à livrer d\'ici à (pièces)', key: 'cdc', width: 24 }, { header: 'dont non livrables à la date', key: 'nl', width: 24 }, { header: 'CDC complètes d\'ici à (pièces)', key: 'cdcc', width: 24 }, { header: 'CDF à recevoir d\'ici à', key: 'rec', width: 22 }]
      header(ws1); data.periodes.forEach((p, i) => ws1.addRow({ p: libs[i], atp: p.atp, cdc: ventilGroupe[i]?.cumALivrer ?? 0, nl: ventilGroupe[i]?.cumNonLivrable ?? 0, cdcc: p.cdc_livrables, rec: p.receptions }))

      const ws2 = wb.addWorksheet('Par référence')
      ws2.columns = [{ header: 'Référence', key: 'ref', width: 16 }, { header: 'Désignation', key: 'des', width: 40 }, { header: 'Stock Sage − PL', key: 'dispo', width: 16 }, { header: '1ʳᵉ pièce disponible', key: 'pd', width: 18 }, ...periodes.flatMap((p, i) => [{ header: `À livrer ${libs[i]}`, key: `liv${i}`, width: 16 }, { header: `dont non livrables ${libs[i]}`, key: `nl${i}`, width: 20 }, { header: `À recevoir ${libs[i]}`, key: `rec${i}`, width: 16 }, { header: `Stock projeté ${libs[i]}`, key: `sp${i}`, width: 18 }, { header: `Dispo nouvelles CDC ${libs[i]}`, key: `atp${i}`, width: 22 }])]
      header(ws2, 4); // Freeze after column D (index 3)
      data.references.forEach((r) => {
        const v = ventilParRef[r.ref] || []
        const row = ws2.addRow({ ref: r.ref, des: r.designation, dispo: r.stock_dispo, pd: formatDateFr(r.premiere_date), ...Object.fromEntries(r.periodes.flatMap((p, i) => [[`liv${i}`, v[i]?.aLivrer ?? 0], [`nl${i}`, v[i]?.nonLivrable ?? 0], [`rec${i}`, v[i]?.aRecevoir ?? 0], [`sp${i}`, r.stock_dispo + (v[i]?.cumARecevoir ?? 0) - (v[i]?.cumALivrer ?? 0)], [`atp${i}`, p.atp]])) })
        // Highlight "Dispo nouvelles CDC" columns (atp0, atp1, atp2, ...)
        for (let i = 0; i < periodes.length; i++) {
          const colIndex = 5 + i * 5 // Column index for atp${i} (0-indexed: ref=0, des=1, dispo=2, pd=3, then each period has 5 cols, atp is 5th)
          const cell = row.getCell(colIndex)
          if (cell) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } } // Light green
        }
      })

      const ws3 = wb.addWorksheet('Par agence')
      ws3.columns = [{ header: 'Agence', key: 'agence', width: 16 }, ...periodes.map((p, i) => ({ header: `CDC complètes d'ici ${libs[i]}`, key: `q${i}`, width: 22 }))]
      header(ws3); data.agences.forEach((a) => ws3.addRow({ agence: a.agence, ...Object.fromEntries(a.periodes.map((p, i) => [`q${i}`, p.q])) }))
      const ws4 = wb.addWorksheet('Réceptions')
      ws4.columns = [{ header: 'Date', key: 'd', width: 12 }, { header: 'Pièces', key: 'q', width: 10 }, { header: 'Lignes CDF', key: 'n', width: 10 }, { header: 'Détail', key: 'refs', width: 60 }]
      header(ws4); data.receptions.forEach((r) => ws4.addRow({ d: formatDateFr(r.d), q: r.q, n: r.n, refs: Object.entries(r.refs).map(([k, v]) => `${k}: ${v}`).join(' · ') }))

      const ws5 = wb.addWorksheet('Commandes clients')
      ws5.columns = [{ header: 'Référence', key: 'ref', width: 16 }, { header: 'CDC', key: 'numero_document', width: 12 }, { header: 'Client', key: 'nom_tiers', width: 30 }, { header: 'N° tiers', key: 'numero_tiers', width: 10 }, { header: 'Agence', key: 'agence', width: 14 }, { header: 'Créée le', key: 'date_creation', width: 12 }, { header: 'Livraison demandée', key: 'date_livraison', width: 18 }, { header: 'Complète le', key: 'date_complete', width: 12 }, { header: 'Qté', key: 'quantite', width: 8 }, { header: 'Montant HT', key: 'montant_ht', width: 14, style: { numFmt: '#,##0 €' } }, { header: 'Statut', key: 'statut', width: 22 }]
      header(ws5);
      data.cdc.forEach((c) => {
        const row = ws5.addRow({ ...c, date_creation: formatDateFr(c.date_creation), date_livraison: formatDateFr(c.date_livraison), date_complete: formatDateFr(c.date_complete), statut: STATUT_LABEL[c.statut] || c.statut })
        // Color code rows based on STATUT: green for COUVERT, orange for COUVERT_PAR_RECEPTION, blue for RECEPTION_TARDIVE
        const color = STATUT_COLOR[c.statut]
        if (color) {
          const argb = color.replace('#', 'FF')
          row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } } })
        }
      })
      ws5.autoFilter = { from: 'A1', to: 'K1' }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `disponibilite-${(groupe?.nom || 'groupe').replace(/[^\w-]+/g, '_')}-${todayIso()}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setExporting(false) }
  }

  const derniere = data ? data.periodes[data.periodes.length - 1] : null

  return (
    <div style={styles.page}>
      <style>{`
        .sgBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .sgBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .sgTable th { position: sticky; top: 0; background: #101A2E; z-index: 1; }
        .sgTable tbody tr.sgClick { cursor: pointer; }
        .sgTable tbody tr.sgClick:hover td { background: rgba(255,255,255,0.05); }
      `}</style>

      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Stocks &amp; logistique</div>
          <h1 style={styles.title}>Disponibilité par groupe d'articles</h1>
          <div style={styles.lead}>Capacité de prise de commande livrable d'ici chaque échéance sans repousser une commande client déjà en base, en regard des commandes déjà prises livrables sur la même période (à leur date de complétude, pas à la date demandée).</div>
        </div>
        <div style={styles.params}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Groupe</span>
            <select value={groupeId} onChange={(e) => choisirGroupe(e.target.value)} style={{ ...styles.select, minWidth: 300 }}>
              {refsAdHoc.length > 0 && <option value="">Sélection ad hoc ({refsAdHoc.length} réf.)</option>}
              {groupes.map((g) => <option key={g.id} value={g.id}>{g.nom} — {g.references_articles.length} référence{g.references_articles.length > 1 ? 's' : ''}</option>)}
              {groupes.length === 0 && refsAdHoc.length === 0 && <option value="">Aucun groupe</option>}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Horizon</span>
            <select value={horizonMois} onChange={(e) => setHorizonMois(Number(e.target.value))} style={styles.select}>
              {[2, 3, 4, 6].map((m) => <option key={m} value={m}>{m} fins de mois</option>)}
            </select>
          </label>
          <button type="button" className="sgBtn" onClick={() => setEditeur({ id: null, nom: '', description: '', refs: refsAdHoc.join('\n') })} style={styles.ghostBtn}>+ Nouveau groupe</button>
          {groupe && <button type="button" className="sgBtn" onClick={() => setEditeur({ id: groupe.id, nom: groupe.nom, description: groupe.description || '', refs: groupe.references_articles.join('\n') })} style={styles.ghostBtn}>✎ Modifier</button>}
          {data && <button type="button" className="sgBtn" onClick={exporterExcel} disabled={exporting} style={styles.ghostBtn}>{exporting ? 'Export…' : 'Excel'}</button>}
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {editeur && (
        <div style={{ ...styles.card, border: '1px solid rgba(166,161,129,0.5)' }}>
          <div style={styles.cardTitle}>{editeur.id ? 'Modifier le groupe' : 'Nouveau groupe'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={styles.field}><span style={styles.fieldLabel}>Nom</span><input value={editeur.nom} onChange={(e) => setEditeur({ ...editeur, nom: e.target.value })} placeholder="Murales Airhome 400" style={styles.input} /></label>
              <label style={styles.field}><span style={styles.fieldLabel}>Description</span><input value={editeur.description} onChange={(e) => setEditeur({ ...editeur, description: e.target.value })} placeholder="Pourquoi ce groupe, pour qui" style={styles.input} /></label>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button type="button" className="sgBtn" onClick={sauvegarderGroupe} disabled={sauvegarde} style={styles.primaryBtn}>{sauvegarde ? 'Enregistrement…' : 'Enregistrer'}</button>
                <button type="button" className="sgBtn" onClick={() => setEditeur(null)} style={styles.ghostBtn}>Annuler</button>
                {editeur.id && groupe && <button type="button" className="sgBtn" onClick={() => supprimerGroupe(groupe)} style={{ ...styles.ghostBtn, marginLeft: 'auto', borderColor: 'rgba(193,104,60,0.5)', color: '#e0a685' }}>Supprimer</button>}
              </div>
            </div>
            <SelecteurReferences refs={parseReferences(editeur.refs)} onChange={(refs) => setEditeur({ ...editeur, refs: refs.join('\n') })} />
          </div>
        </div>
      )}

      {references.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={styles.fieldLabel}>Composition</span>
          {references.map((r) => <button key={r} type="button" className="sgBtn" onClick={() => setDetailRef((v) => (v === r ? '' : r))} style={{ ...styles.chip, ...(detailRef === r ? styles.chipActive : {}) }}>{r}</button>)}
          {groupe?.description && <span style={{ ...styles.muted, marginLeft: 8 }}>{groupe.description}</span>}
        </div>
      )}

      {references.length === 0 && !loading && (
        <div style={styles.emptyMain}>
          <div style={{ fontSize: 34 }}>📦</div>
          <div style={{ fontWeight: 700, color: '#fff', marginTop: 8, fontSize: 16 }}>Crée un groupe d'articles</div>
          <div style={{ ...styles.muted, marginTop: 6, maxWidth: 520, textAlign: 'center' }}>Un nom, une liste de références : la capacité de vente par échéance, les commandes déjà prises et leur répartition par agence s'affichent ici.</div>
        </div>
      )}
      {loading && <div style={styles.skeleton} />}

      {data && !loading && (
        <>
          {/* ── Cartes par échéance ── */}
          <div style={{ ...styles.kpiRow, gridTemplateColumns: `repeat(${data.periodes.length}, minmax(0, 1fr))` }}>
            {data.periodes.map((p, i) => {
              const actif = detailPeriode === p.p
              const v = ventilGroupe[i]
              const lib = i === 0 ? "aujourd'hui" : libellePeriode(p.p, i).toLowerCase()
              return (
                <button key={p.p} type="button" onClick={() => setDetailPeriode((v2) => (v2 === p.p ? '' : p.p))} style={{ ...styles.kpi, ...(actif ? styles.kpiActive : {}), textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <div style={styles.kpiLabel}>{libellePeriode(p.p, i)}</div>
                  <div style={{ ...styles.kpiValue, fontSize: 40, color: couleurAtp(p.atp) }}>{formatNumber(p.atp)}</div>
                  <div style={styles.kpiSub}>{i === 0 ? 'qté dispo pour nouvelles CDC en livraison immédiate' : `qté dispo pour nouvelles CDC avec livraison d'ici à ${lib}`}</div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, color: '#E9E5D6' }}>
                    <span>CDC à livrer d'ici à {lib} : <b style={{ fontFamily: 'var(--font-mono)', color: C_LIV }}>{formatNumber(v?.cumALivrer ?? 0)}</b>
                      {v && v.cumNonLivrable > 0 ? <span style={{ color: C_NONLIV }}> dont <b style={{ fontFamily: 'var(--font-mono)' }}>{formatNumber(v.cumNonLivrable)}</b> non livrables</span> : null}</span>
                    <span>CDF à recevoir d'ici à {lib} : <b style={{ fontFamily: 'var(--font-mono)', color: C_REC }}>+ {formatNumber(p.receptions)}</b></span>
                  </div>
                </button>
              )
            })}
          </div>
          <div style={styles.legendLine}>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#8fd4a8' }} />Vert : des pièces peuvent être promises à cette échéance</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: C_NONLIV }} />Rouge : rien de promissible (stock consommé par les CDC déjà prises)</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: C_LIV }} />Orange : CDC déjà en base, à leur date de livraison demandée</span>
            <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: C_REC }} />Bleu : commandes fournisseurs SAGE à recevoir</span>
          </div>

          {/* ── Entrées / sorties par période (barres miroir) ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>CDF à recevoir et CDC à livrer, période par période <span style={styles.muted}>(au-dessus : réceptions SAGE, CDF en retard ou sans date → demain · en dessous : CDC à leur date de livraison demandée)</span></div>
              <div style={styles.muted}>{formatNumber(receptionsHorizon.reduce((s, r) => s + r.q, 0))} pièces à recevoir · {formatNumber(ventilGroupe.reduce((s, v) => s + v.aLivrer, 0))} à livrer sur l'horizon, dont <span style={{ color: C_NONLIV }}>{formatNumber(ventilGroupe.reduce((s, v) => s + v.nonLivrable, 0))} non livrables à leur date</span></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ventilGroupe.length}, minmax(0, 1fr))`, gap: 10 }}>
              {ventilGroupe.map((v, i) => {
                const hRec = (v.aRecevoir / maxBarre) * 100
                const hLiv = (v.aLivrer / maxBarre) * 100
                const hNon = (v.nonLivrable / maxBarre) * 100
                const livrable = v.aLivrer - v.nonLivrable
                return (
                  <div key={v.p} title={`${libellePeriode(v.p, i)}\nà recevoir : +${formatNumber(v.aRecevoir)}\nà livrer : ${formatNumber(v.aLivrer)} (${v.nbALivrer} lignes)\nnon livrables à la date : ${formatNumber(v.nonLivrable)} (${v.nbNonLivrable} lignes)`} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                    <div style={{ height: 110, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: v.aRecevoir > 0 ? C_REC : 'rgba(255,255,255,0.3)' }}>+{formatNumber(v.aRecevoir)}</span>
                      <div style={{ width: '70%', height: `${Math.max(v.aRecevoir > 0 ? 3 : 0, hRec)}%`, borderRadius: '4px 4px 0 0', background: C_REC }} />
                    </div>
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.25)', textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '3px 0' }}>{i === 0 ? "Auj. + retard" : libellePeriode(v.p, i)}</div>
                    <div style={{ height: 110, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: '70%', height: `${Math.max(v.aLivrer > 0 ? 3 : 0, hLiv)}%`, borderRadius: '0 0 4px 4px', background: C_LIV, position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${v.aLivrer > 0 ? (hNon / Math.max(hLiv, 0.01)) * 100 : 0}%`, background: C_NONLIV }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: v.aLivrer > 0 ? C_LIV : 'rgba(255,255,255,0.3)' }}>−{formatNumber(v.aLivrer)}</span>
                      {v.nonLivrable > 0 && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: C_NONLIV }}>dont {formatNumber(v.nonLivrable)} non livr.</span>}
                      {v.nonLivrable === 0 && v.aLivrer > 0 && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{formatNumber(livrable)} livrables</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Par référence, période par période ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Par référence — du stock d'aujourd'hui aux échéances</div>
              <div style={styles.muted}>Clic sur une référence pour filtrer le détail des CDC · les colonnes « Fin … » sont des flux de la période, sauf « Stock projeté » et « Dispo nouvelles CDC » qui sont des positions à l'échéance.</div>
            </div>
            <div style={{ ...styles.tableWrap, maxHeight: 640 }}>
              <table className="sgTable" style={styles.table}>
                <thead><tr>
                  <th style={styles.th}>Référence</th>
                  <th style={styles.th}>Ligne</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Stock Sage − PL</th>
                  {data.periodes.map((p, i) => <th key={p.p} style={{ ...styles.th, textAlign: 'right' }}>{i === 0 ? "Auj. (+ retard)" : libellePeriode(p.p, i)}</th>)}
                  <th style={styles.th}>1ʳᵉ pièce disponible</th>
                </tr></thead>
                <tbody>
                  {data.references.map((r) => {
                    const v = ventilParRef[r.ref] || []
                    const actif = detailRef === r.ref
                    const bg = actif ? 'rgba(166,161,129,0.14)' : undefined
                    const tdL = { ...styles.td, whiteSpace: 'nowrap' as const, color: 'rgba(255,255,255,0.55)', fontSize: 11.5, background: bg }
                    const onClick = () => setDetailRef((x) => (x === r.ref ? '' : r.ref))
                    return (
                      <React.Fragment key={r.ref}>
                        <tr className="sgClick" onClick={onClick}>
                          <td rowSpan={4} style={{ ...styles.td, background: bg, borderBottom: '2px solid rgba(255,255,255,0.14)', verticalAlign: 'top', minWidth: 160 }}>
                            <a href={`/stock?ref=${encodeURIComponent(r.ref)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', textDecoration: 'none' }}>{r.ref} ↗</a>
                            <div style={styles.tdSub}>{r.designation || '—'}</div>
                          </td>
                          <td style={{ ...tdL, color: C_LIV }}>CDC à livrer</td>
                          <td rowSpan={4} style={{ ...styles.tdNum, background: bg, borderBottom: '2px solid rgba(255,255,255,0.14)', fontSize: 16, fontWeight: 700, color: r.stock_dispo > 0 ? '#8fd4a8' : '#e0a685' }}>{formatNumber(r.stock_dispo)}</td>
                          {v.map((x) => (
                            <td key={x.p} style={{ ...styles.tdNum, background: bg, color: x.aLivrer > 0 ? C_LIV : 'rgba(255,255,255,0.3)' }}>
                              {x.aLivrer > 0 ? `− ${formatNumber(x.aLivrer)}` : '·'}
                              {x.nonLivrable > 0 && <div style={{ fontSize: 10.5, color: C_NONLIV }}>dont {formatNumber(x.nonLivrable)} non livr.</div>}
                            </td>
                          ))}
                          <td rowSpan={4} style={{ ...styles.td, background: bg, borderBottom: '2px solid rgba(255,255,255,0.14)', whiteSpace: 'nowrap', color: r.premiere_date ? (r.premiere_date === todayIso() ? '#8fd4a8' : '#E0A961') : '#e0a685', fontWeight: 700 }}>{r.premiere_date ? (r.premiere_date === todayIso() ? "aujourd'hui" : formatDateFr(r.premiere_date)) : 'aucune réception suffisante'}</td>
                        </tr>
                        <tr className="sgClick" onClick={onClick}>
                          <td style={{ ...tdL, color: C_REC }}>CDF à recevoir</td>
                          {v.map((x) => <td key={x.p} style={{ ...styles.tdNum, background: bg, color: x.aRecevoir > 0 ? C_REC : 'rgba(255,255,255,0.3)' }}>{x.aRecevoir > 0 ? `+ ${formatNumber(x.aRecevoir)}` : '·'}</td>)}
                        </tr>
                        <tr className="sgClick" onClick={onClick}>
                          <td style={tdL}>Stock projeté fin de période</td>
                          {v.map((x) => { const sp = r.stock_dispo + x.cumARecevoir - x.cumALivrer; return <td key={x.p} style={{ ...styles.tdNum, background: bg, color: sp < 0 ? C_NONLIV : 'rgba(255,255,255,0.8)' }}>{formatNumber(sp)}</td> })}
                        </tr>
                        <tr className="sgClick" onClick={onClick}>
                          <td style={{ ...tdL, color: '#8fd4a8', borderBottom: '2px solid rgba(255,255,255,0.14)' }}>Dispo nouvelles CDC livrées d'ici à</td>
                          {r.periodes.map((p) => <td key={p.p} style={{ ...styles.tdNum, background: bg, borderBottom: '2px solid rgba(255,255,255,0.14)', color: couleurAtp(p.atp), fontWeight: 700, fontSize: 14 }}>{formatNumber(p.atp)}</td>)}
                        </tr>
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ ...styles.muted, marginTop: 8 }}>
              « Stock Sage − PL » = stock tous dépôts moins les préparations de livraison, avant les CDC en retard (comptées dans la colonne « Auj. »). « CDC à livrer » à la date de livraison demandée ; « non livr. » = part qui ne sera pas complète à la fin de la période avec les réceptions connues. « Stock projeté » = Stock Sage − PL + reçu − à livrer en cumul. « Dispo nouvelles CDC » = plus bas niveau du stock projeté à partir de l'échéance : ce qu'on peut promettre sans repousser une CDC déjà prise.
            </div>
          </div>

          {/* ── Par agence (replié) ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Par agence — CDC complètes d'ici à… <span style={styles.muted}>(cumul, pièces · agence du collaborateur de la fiche client)</span></div>
              <button type="button" className="sgBtn" onClick={() => setAfficherAgences((x) => !x)} style={styles.ghostBtn}>{afficherAgences ? 'Masquer' : 'Afficher la répartition par agence'}</button>
            </div>
            {afficherAgences && (<>
              <div style={styles.tableWrap}>
                <table className="sgTable" style={styles.table}>
                  <thead><tr>
                    <th style={styles.th}>Agence</th>
                    {data.periodes.map((p, i) => <th key={p.p} style={{ ...styles.th, textAlign: 'right' }}>{i === 0 ? 'Auj.' : libellePeriode(p.p, i)}</th>)}
                    <th style={{ ...styles.th, width: 110 }}>Part</th>
                  </tr></thead>
                  <tbody>
                    {agencesTriees.map((a) => {
                      const dernier = a.periodes[a.periodes.length - 1]?.q ?? 0
                      return (
                        <tr key={a.agence} className="sgClick" onClick={() => setDetailAgence((v) => (v === a.agence ? '' : a.agence))} style={{ background: detailAgence === a.agence ? 'rgba(166,161,129,0.14)' : undefined }}>
                          <td style={{ ...styles.td, color: '#fff' }}>{a.agence}</td>
                          {a.periodes.map((p, i) => <td key={p.p} style={{ ...styles.tdNum, fontWeight: i === a.periodes.length - 1 ? 700 : 400 }}>{formatNumber(p.q)}</td>)}
                          <td style={styles.td}><div style={styles.barTrack}><div style={{ ...styles.barFill, width: `${(dernier / maxAgence) * 100}%` }} /></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>)}
            {derniere && (
              <div style={styles.expected}>
                <strong>Discours commercial, lu tel quel :</strong> {data.periodes.slice(0, -1).every((p) => p.atp === 0)
                  ? `aucune nouvelle CDC livrable avant ${libellePeriode(derniere.p, data.periodes.length - 1).toLowerCase()}`
                  : `nouvelles CDC limitées à ${formatNumber(data.periodes[1]?.atp ?? 0)} pièces pour une livraison d'ici ${libellePeriode(data.periodes[1]?.p ?? derniere.p, 1).toLowerCase()}`}
                {' '}; {formatNumber(derniere.atp)} pièces disponibles pour de nouvelles CDC livrées d'ici {libellePeriode(derniere.p, data.periodes.length - 1).toLowerCase()}. Les {formatNumber(derniere.receptions)} pièces à recevoir sur l'horizon servent d'abord les {formatNumber(ventilGroupe[ventilGroupe.length - 1]?.cumALivrer ?? 0)} pièces de CDC déjà en base{agencesTriees.slice(0, 2).map((a) => `, dont ${formatNumber(a.periodes[a.periodes.length - 1]?.q ?? 0)} pour ${a.agence}`).join('')}.
              </div>
            )}
          </div>

          {/* ── Détail des CDC ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>
                Commandes clients en base <span style={styles.countTag}>{cdcDetail.length}</span>
                {detailRef && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>{detailRef}</span>}
                {detailAgence && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>{detailAgence}</span>}
                {detailPeriode && <span style={{ ...styles.countTag, color: '#E9E5D6' }}>complètes ≤ {formatDateCourte(detailPeriode)}</span>}
                {detailActif && <button type="button" className="sgBtn" onClick={() => { setDetailRef(''); setDetailAgence(''); setDetailPeriode('') }} style={{ ...styles.chip, padding: '2px 8px' }}>✕ tout afficher</button>}
              </div>
              <div style={styles.muted}>Clic sur une échéance, une référence ou une agence pour filtrer · {formatNumber(cdcDetail.reduce((s, c) => s + c.quantite, 0))} pièces · {formatMoney(cdcDetail.reduce((s, c) => s + c.montant_ht, 0))} HT</div>
            </div>
            <div style={{ ...styles.tableWrap, maxHeight: 520 }}>
              <table className="sgTable" style={styles.table}>
                <thead><tr>{['Référence', 'CDC', 'Client', 'Agence', 'Créée', 'Livraison demandée', 'Complète le', 'Qté', 'Montant HT', 'Statut'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {cdcDetail.slice(0, 600).map((c) => (
                    <tr key={c.id}>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', color: '#fff', whiteSpace: 'nowrap' }}>{c.ref}</td>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>{c.numero_document}</td>
                      <td style={styles.td}><div style={{ color: '#fff' }}>{c.nom_tiers || c.numero_tiers}</div><div style={styles.tdSub}>{c.numero_tiers}</div></td>
                      <td style={styles.td}>{c.agence}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(c.date_creation)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.date_livraison && c.date_livraison < todayIso() ? '#e0a685' : undefined }}>{formatDateCourte(c.date_livraison)}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', fontWeight: 700, color: c.date_complete > (c.date_livraison || '') ? '#E0A961' : '#8fd4a8' }}>{formatDateCourte(c.date_complete)}</td>
                      <td style={styles.tdNum}>{formatNumber(c.quantite)}</td>
                      <td style={styles.tdNum}>{formatMoney(c.montant_ht)}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: STATUT_COLOR[c.statut] || '#A6A181', color: STATUT_COLOR[c.statut] || '#E9E5D6' }}>{STATUT_LABEL[c.statut] || c.statut}</span></td>
                    </tr>
                  ))}
                  {cdcDetail.length === 0 && <tr><td colSpan={10} style={{ ...styles.td, textAlign: 'center' }}><span style={styles.muted}>Aucune commande pour ce filtre.</span></td></tr>}
                </tbody>
              </table>
            </div>
            {cdcDetail.length > 600 && <div style={{ ...styles.muted, marginTop: 6 }}>600 premières lignes affichées — l'export Excel contient tout.</div>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Sélecteur de références (recherche + cases à cocher) ──────────────────
type ArticleTrouve = { reference_article: string; designation: string | null; famille: string | null; stock_disponible: number; stock_reel: number; stock_a_terme: number }

/** Recherche par début de référence ou désignation (RPC
 * search_stock_articles_mobile, même source que l'écran Stock articles) ;
 * chaque résultat se coche pour entrer dans le groupe. Les références déjà
 * retenues sont listées avec leur stock et se retirent d'un clic. Un mode
 * « coller une liste » reste disponible pour les gros groupes. */
function SelecteurReferences({ refs, onChange }: { refs: string[]; onChange: (refs: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [resultats, setResultats] = useState<ArticleTrouve[]>([])
  const [loading, setLoading] = useState(false)
  const [modeListe, setModeListe] = useState(false)
  const [texteListe, setTexteListe] = useState('')
  const [infos, setInfos] = useState<Record<string, ArticleTrouve>>({})

  // Recherche avec léger délai de frappe.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResultats([]); return }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const { data } = await supabase.rpc('search_stock_articles_mobile', { p_query: q, p_references: null, p_famille_macro: null, p_famille: null, p_depot: null, p_disponible_only: null, p_limit: 40 })
      if (cancelled) return
      const rows = ((data || []) as any[]).map((r) => ({ reference_article: String(r.reference_article), designation: r.designation ?? null, famille: r.famille ?? null, stock_disponible: toNumber(r.stock_disponible), stock_reel: toNumber(r.stock_reel), stock_a_terme: toNumber(r.stock_a_terme) }))
      // Une ligne par référence (le RPC peut renvoyer un dépôt par ligne).
      const uniques = Array.from(new Map(rows.map((r) => [r.reference_article, r])).values())
      setResultats(uniques)
      setInfos((prev) => ({ ...prev, ...Object.fromEntries(uniques.map((r) => [r.reference_article, r])) }))
      setLoading(false)
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query])

  // Désignation et stock des références déjà retenues (ouverture d'un groupe existant).
  useEffect(() => {
    const manquantes = refs.filter((r) => !infos[r])
    if (manquantes.length === 0) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase.rpc('search_stock_articles_mobile', { p_query: null, p_references: manquantes, p_famille_macro: null, p_famille: null, p_depot: null, p_disponible_only: null, p_limit: 300 })
      if (cancelled) return
      const rows = ((data || []) as any[]).map((r) => ({ reference_article: String(r.reference_article), designation: r.designation ?? null, famille: r.famille ?? null, stock_disponible: toNumber(r.stock_disponible), stock_reel: toNumber(r.stock_reel), stock_a_terme: toNumber(r.stock_a_terme) }))
      setInfos((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.reference_article, r])) }))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refs.join('|')])

  const set = new Set(refs)
  function basculer(ref: string) { onChange(set.has(ref) ? refs.filter((r) => r !== ref) : [...refs, ref]) }
  function toutCocher() { onChange(Array.from(new Set([...refs, ...resultats.map((r) => r.reference_article)]))) }
  function appliquerListe() { onChange(Array.from(new Set([...refs, ...parseReferences(texteListe)]))); setTexteListe(''); setModeListe(false) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={styles.fieldLabel}>Références du groupe ({refs.length})</span>
        <button type="button" onClick={() => setModeListe((v) => !v)} style={styles.linkBtn}>{modeListe ? 'Revenir à la recherche' : 'Coller une liste'}</button>
      </div>

      {modeListe ? (
        <>
          <textarea value={texteListe} onChange={(e) => setTexteListe(e.target.value)} rows={5} placeholder={'RAK-DJ35RHAE\nRAK-DJ50RHAE\n…'} style={{ ...styles.input, height: 'auto', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 400, resize: 'vertical' }} />
          <div><button type="button" className="sgBtn" onClick={appliquerListe} disabled={parseReferences(texteListe).length === 0} style={styles.ghostBtn}>Ajouter {parseReferences(texteListe).length} référence{parseReferences(texteListe).length > 1 ? 's' : ''}</button></div>
        </>
      ) : (
        <>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Début de référence ou désignation (ex. RAK-DJ, Airhome 400, Yutampo)" style={{ ...styles.input, fontWeight: 400 }} />
          {query.trim().length >= 2 && (
            <div style={styles.pickerList}>
              <div style={styles.pickerHead}>
                <span style={styles.tdSub}>{loading ? 'Recherche…' : `${resultats.length} résultat${resultats.length > 1 ? 's' : ''}${resultats.length >= 40 ? ' (affine la recherche)' : ''}`}</span>
                {resultats.length > 1 && <button type="button" onClick={toutCocher} style={styles.linkBtn}>Tout cocher</button>}
              </div>
              {resultats.map((r) => {
                const coche = set.has(r.reference_article)
                return (
                  <label key={r.reference_article} style={{ ...styles.pickerRow, background: coche ? 'rgba(166,161,129,0.14)' : undefined }}>
                    <input type="checkbox" checked={coche} onChange={() => basculer(r.reference_article)} style={{ accentColor: '#A6A181', width: 16, height: 16, flexShrink: 0 }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', fontSize: 13 }}>{r.reference_article}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.designation || '—'}{r.famille ? ` · ${r.famille}` : ''}</span>
                    </span>
                    <span style={styles.pickerStats}>
                      <span style={{ ...styles.pickerStat, color: couleurAtp(r.stock_disponible) }}>{formatNumber(r.stock_disponible)}<small>dispo</small></span>
                      <span style={styles.pickerStat}>{formatNumber(r.stock_reel)}<small>réel</small></span>
                      <span style={{ ...styles.pickerStat, color: r.stock_a_terme < 0 ? '#e0a685' : undefined }}>{formatNumber(r.stock_a_terme)}<small>à terme</small></span>
                    </span>
                  </label>
                )
              })}
              {!loading && resultats.length === 0 && <div style={{ ...styles.tdSub, padding: 10 }}>Aucune référence trouvée.</div>}
            </div>
          )}
        </>
      )}

      {/* Références retenues */}
      <div style={{ ...styles.pickerList, maxHeight: 220 }}>
        {refs.length === 0 && <div style={{ ...styles.tdSub, padding: 10 }}>Aucune référence dans le groupe. Cherche une référence ci-dessus et coche-la.</div>}
        {refs.map((ref) => {
          const i = infos[ref]
          return (
            <div key={ref} style={styles.pickerRow}>
              <button type="button" onClick={() => basculer(ref)} title="Retirer du groupe" style={{ ...styles.linkBtn, margin: 0, padding: '0 4px', textDecoration: 'none', color: '#e0a685', fontSize: 14 }}>✕</button>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', fontSize: 13 }}>{ref}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i ? (i.designation || '—') : 'référence inconnue du stock'}</span>
              </span>
              {i && (
                <span style={styles.pickerStats}>
                  <span style={{ ...styles.pickerStat, color: couleurAtp(i.stock_disponible) }}>{formatNumber(i.stock_disponible)}<small>dispo</small></span>
                  <span style={styles.pickerStat}>{formatNumber(i.stock_reel)}<small>réel</small></span>
                  <span style={{ ...styles.pickerStat, color: i.stock_a_terme < 0 ? '#e0a685' : undefined }}>{formatNumber(i.stock_a_terme)}<small>à terme</small></span>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  linkBtn: { background: 'none', border: 'none', padding: '2px 0', fontSize: 12, color: 'rgba(255,255,255,0.55)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', fontFamily: 'inherit' },
  pickerList: { maxHeight: 300, overflowY: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', display: 'flex', flexDirection: 'column' },
  pickerHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', position: 'sticky', top: 0, background: '#101A2E', zIndex: 1 },
  pickerRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer' },
  pickerStats: { display: 'flex', gap: 10, flexShrink: 0 },
  pickerStat: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.1 },
  page: { maxWidth: 1700, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)', maxWidth: 980 },
  params: { display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  select: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#141A26', color: '#fff', padding: '0 10px', fontSize: 13.5, fontFamily: 'inherit' },
  input: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '8px 10px', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', boxSizing: 'border-box', width: '100%' },
  primaryBtn: { height: 40, padding: '0 16px', borderRadius: 10, border: '1px solid #A6A181', background: '#A6A181', color: '#0B1220', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' },
  chip: { padding: '4px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#fff', fontFamily: 'var(--font-mono)', fontSize: 12, cursor: 'pointer' },
  chipActive: { borderColor: 'rgba(166,161,129,0.8)', background: 'rgba(166,161,129,0.2)' },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10, flexWrap: 'wrap' },
  cardHeaderRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  countTag: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', letterSpacing: 0, textTransform: 'none' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, textTransform: 'none', letterSpacing: 0, fontWeight: 400 },
  errorBox: { padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13 },
  skeleton: { height: 160, borderRadius: 12, background: 'rgba(255,255,255,0.05)' },
  emptyMain: { minHeight: 360, borderRadius: 18, border: '1px dashed rgba(255,255,255,0.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28 },

  kpiRow: { display: 'grid', gap: 12 },
  kpi: { borderRadius: 16, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '14px 16px', minWidth: 0 },
  kpiOk: { border: '1px solid rgba(92,138,110,0.8)', background: 'rgba(19,37,30,0.8)' },
  kpiActive: { outline: '2px solid rgba(166,161,129,0.8)', outlineOffset: 1 },
  kpiLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  kpiValue: { marginTop: 6, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' },
  kpiSub: { marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.35 },

  legendLine: { display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: -4 },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
  tableWrap: { maxHeight: 460, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' },
  tdSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  badge: { display: 'inline-flex', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, border: '1px solid', fontSize: 11, fontWeight: 700 },
  barTrack: { height: 8, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 3, background: '#E0A961' },
  expected: { marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.10)', color: '#E9E5D6', fontSize: 12.5, lineHeight: 1.45 },
}
