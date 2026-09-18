'use client'

// ============================================================================
// app/stock/reconstruction/page.tsx — Reconstruction du stock projeté
// ----------------------------------------------------------------------------
// (2026-09-18) Analyse rétrospective d'une référence : à partir de l'image du
// jour SAGE (sage.stock_depot, tous dépôts), on déroule le stock physique à
// rebours avec les sorties BL clients et les réceptions fournisseurs BLG
// (lignes de CDF : quantité livrée à la date de livraison réelle), puis on
// recalcule, pour chaque commande client créée depuis la date de départ :
//   • le stock projeté (physique − promesses ouvertes) au moment de la saisie ;
//   • la date exacte que le système aurait dû proposer (première date où
//     stock projeté + réceptions ≥ quantité) ;
//   • les promesses plus anciennes doublées à la livraison réelle.
// Tout le calcul est côté base : RPC get_stock_reconstruction(p_reference,
// p_depuis) → jsonb { meta, serie, mensuel, agences, cdc }.
// ?ref=XXXX&depuis=YYYY-MM-DD ouvre directement une référence.
// À ajouter dans lib/navigation.ts sous « Stocks & logistique ».
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'

// ── Types ─────────────────────────────────────────────────────────────────
type Meta = {
  stock_phys_debut: number
  promesses_debut: number
  premier_jour_projete_negatif: string | null
  premier_jour_phys_negatif: string | null
  receptions_total: number
  sorties_total: number
  nb_cdc: number
  q_cdc: number
  nb_livrees: number
  nb_doublees: number
  q_doublees: number
  nb_projete_insuffisant: number
  nb_livrees_avant_date_exacte: number
  plus_ancienne_doublee: string | null
}
type PointSerie = { d: string; rec: number; sor: number; stock_phys: number; promesses: number; projete: number }
type LigneMois = {
  mois: string; nb: number; q: number; nb_doublees: number; q_doublees: number; nb_projete_insuffisant: number
  projete_moy: number | null; stock_phys_moy: number | null; delai_promis: number | null; delai_reel: number | null
  delai_exact: number | null; nb_sans_date: number; nb_livrees_avant_date_exacte: number
}
type LigneAgence = { agence: string; nb: number; q: number; nb_doublees: number; q_doublees: number; nb_projete_insuffisant: number }
type Cdc = {
  bc: string; date_bc: string; date_livraison: string | null; date_bl: string | null; ouverte: boolean
  tiers: string | null; nom: string | null; agence: string; q: number; stock_phys: number; promesses_ouvertes: number
  stock_projete_creation: number; date_exacte: string | null; nb_doublees: number; q_doublees: number; plus_ancienne_doublee: string | null
}
type Reconstruction = {
  reference: string; depuis: string; stock_today: number
  meta: Meta; serie: PointSerie[]; mensuel: LigneMois[]; agences: LigneAgence[]; cdc: Cdc[]
}
type FiltreDetail = 'toutes' | 'projete_insuffisant' | 'avant_date_exacte' | 'doublees' | 'ouvertes'

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function formatNumber(n: number | null | undefined): string { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR') }
function formatJours(n: number | null | undefined): string { return n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j` }
function formatDateFr(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function formatDateCourte(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y.slice(2)}` }
function formatMois(ym: string): string { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function daysBetween(a: string, b: string): number { return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000) }
function couleurSigne(n: number): string { if (n > 0) return '#8fd4a8'; if (n < 0) return '#e0a685'; return 'rgba(255,255,255,0.5)' }
function defautDepuis(): string { const d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(1); return toIsoDate(d) }

const FILTRES: Array<[FiltreDetail, string]> = [
  ['toutes', 'Toutes'],
  ['projete_insuffisant', 'Stock projeté insuffisant à la saisie'],
  ['avant_date_exacte', 'Livrées avant la date exacte'],
  ['doublees', 'Ont doublé une promesse'],
  ['ouvertes', 'Encore ouvertes'],
]

// ── Page ──────────────────────────────────────────────────────────────────
export default function ReconstructionPage() {
  const [reference, setReference] = useState('')
  const [depuis, setDepuis] = useState(defautDepuis())
  const [refChargee, setRefChargee] = useState<{ reference: string; depuis: string } | null>(null)
  const [data, setData] = useState<Reconstruction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtre, setFiltre] = useState<FiltreDetail>('projete_insuffisant')
  const [agenceFiltre, setAgenceFiltre] = useState('')
  const [recherche, setRecherche] = useState('')
  const [exporting, setExporting] = useState(false)

  // Ouverture directe ?ref=XXXX&depuis=YYYY-MM-DD
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = String(params.get('ref') || '').trim().toUpperCase()
    const dep = String(params.get('depuis') || '').trim()
    if (dep) setDepuis(dep)
    if (ref) { setReference(ref); setRefChargee({ reference: ref, depuis: dep || defautDepuis() }) }
  }, [])

  useEffect(() => {
    if (!refChargee) return
    let cancelled = false
    async function charger() {
      setLoading(true); setError(null)
      const { data: res, error: err } = await supabase.rpc('get_stock_reconstruction', { p_reference: refChargee!.reference, p_depuis: refChargee!.depuis })
      if (cancelled) return
      if (err) { setError(err.message); setData(null) } else {
        const r = res as any
        setData({
          reference: r.reference, depuis: r.depuis, stock_today: toNumber(r.stock_today),
          meta: Object.fromEntries(Object.entries(r.meta || {}).map(([k, v]) => [k, typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(v) ? toNumber(v) : v])) as Meta,
          serie: ((r.serie || []) as any[]).map((p) => ({ d: p.d, rec: toNumber(p.rec), sor: toNumber(p.sor), stock_phys: toNumber(p.stock_phys), promesses: toNumber(p.promesses), projete: toNumber(p.projete) })),
          mensuel: ((r.mensuel || []) as any[]).map((m) => ({ ...m, nb: toNumber(m.nb), q: toNumber(m.q), nb_doublees: toNumber(m.nb_doublees), q_doublees: toNumber(m.q_doublees), nb_projete_insuffisant: toNumber(m.nb_projete_insuffisant), nb_sans_date: toNumber(m.nb_sans_date), nb_livrees_avant_date_exacte: toNumber(m.nb_livrees_avant_date_exacte), projete_moy: m.projete_moy === null ? null : toNumber(m.projete_moy), stock_phys_moy: m.stock_phys_moy === null ? null : toNumber(m.stock_phys_moy), delai_promis: m.delai_promis === null ? null : toNumber(m.delai_promis), delai_reel: m.delai_reel === null ? null : toNumber(m.delai_reel), delai_exact: m.delai_exact === null ? null : toNumber(m.delai_exact) })),
          agences: ((r.agences || []) as any[]).map((a) => ({ agence: a.agence, nb: toNumber(a.nb), q: toNumber(a.q), nb_doublees: toNumber(a.nb_doublees), q_doublees: toNumber(a.q_doublees), nb_projete_insuffisant: toNumber(a.nb_projete_insuffisant) })),
          cdc: ((r.cdc || []) as any[]).map((c) => ({ ...c, q: toNumber(c.q), stock_phys: toNumber(c.stock_phys), promesses_ouvertes: toNumber(c.promesses_ouvertes), stock_projete_creation: toNumber(c.stock_projete_creation), nb_doublees: toNumber(c.nb_doublees), q_doublees: toNumber(c.q_doublees), ouverte: Boolean(c.ouverte) })),
        })
      }
      setLoading(false)
    }
    void charger()
    return () => { cancelled = true }
  }, [refChargee])

  function lancer() {
    const ref = reference.trim().toUpperCase()
    if (!ref) return
    setRefChargee({ reference: ref, depuis })
    const url = new URL(window.location.href)
    url.searchParams.set('ref', ref); url.searchParams.set('depuis', depuis)
    window.history.replaceState(null, '', url.toString())
  }

  const cdcFiltrees = useMemo(() => {
    if (!data) return []
    const q = recherche.trim().toUpperCase()
    return data.cdc.filter((c) => {
      if (filtre === 'projete_insuffisant' && !(c.stock_projete_creation < c.q)) return false
      if (filtre === 'avant_date_exacte' && !(c.date_bl && c.date_exacte && c.date_bl < c.date_exacte)) return false
      if (filtre === 'doublees' && !(c.nb_doublees > 0)) return false
      if (filtre === 'ouvertes' && !c.ouverte) return false
      if (agenceFiltre && c.agence !== agenceFiltre) return false
      if (q && !`${c.bc} ${c.nom || ''} ${c.tiers || ''}`.toUpperCase().includes(q)) return false
      return true
    }).sort((a, b) => b.q_doublees - a.q_doublees || a.date_bc.localeCompare(b.date_bc))
  }, [data, filtre, agenceFiltre, recherche])

  const meta = data?.meta
  const partDoublees = meta && meta.nb_cdc > 0 ? Math.round((meta.nb_doublees / meta.nb_cdc) * 100) : 0
  const partInsuffisant = meta && meta.nb_cdc > 0 ? Math.round((meta.nb_projete_insuffisant / meta.nb_cdc) * 100) : 0

  async function exporterExcel() {
    if (!data) return
    setExporting(true)
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'CEGECLIM by A3C'
      const header = (ws: ExcelJS.Worksheet) => { const row = ws.getRow(1); row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }; c.font = { color: { argb: 'FFF5F3EC' }, bold: true } }); ws.views = [{ state: 'frozen', ySplit: 1 }] }
      const ws1 = wb.addWorksheet('Commandes')
      ws1.columns = [
        { header: 'Document', key: 'bc', width: 14 }, { header: 'Client', key: 'nom', width: 30 }, { header: 'N° tiers', key: 'tiers', width: 10 }, { header: 'Agence', key: 'agence', width: 14 },
        { header: 'Créée le', key: 'date_bc', width: 12 }, { header: 'Livraison promise', key: 'date_livraison', width: 16 }, { header: 'Livrée le', key: 'date_bl', width: 12 },
        { header: 'Qté', key: 'q', width: 8 }, { header: 'Stock physique à la saisie', key: 'stock_phys', width: 22 }, { header: 'Promesses ouvertes', key: 'promesses_ouvertes', width: 18 },
        { header: 'Stock projeté à la saisie', key: 'stock_projete_creation', width: 22 }, { header: 'Date exacte', key: 'date_exacte', width: 12 }, { header: 'Écart livrée − exacte (j)', key: 'ecart', width: 20 },
        { header: 'Promesses doublées (nb)', key: 'nb_doublees', width: 20 }, { header: 'Promesses doublées (pièces)', key: 'q_doublees', width: 22 }, { header: 'Plus ancienne doublée', key: 'plus_ancienne_doublee', width: 20 },
      ]
      header(ws1)
      data.cdc.forEach((c) => ws1.addRow({ ...c, date_bc: formatDateFr(c.date_bc), date_livraison: formatDateFr(c.date_livraison), date_bl: formatDateFr(c.date_bl), date_exacte: formatDateFr(c.date_exacte), plus_ancienne_doublee: formatDateFr(c.plus_ancienne_doublee), ecart: c.date_bl && c.date_exacte ? daysBetween(c.date_exacte, c.date_bl) : null }))
      ws1.autoFilter = { from: 'A1', to: 'P1' }
      const ws2 = wb.addWorksheet('Série journalière')
      ws2.columns = [{ header: 'Date', key: 'd', width: 12 }, { header: 'Réceptions', key: 'rec', width: 12 }, { header: 'Sorties BL', key: 'sor', width: 12 }, { header: 'Stock physique', key: 'stock_phys', width: 14 }, { header: 'Promesses ouvertes', key: 'promesses', width: 18 }, { header: 'Stock projeté', key: 'projete', width: 14 }]
      header(ws2)
      data.serie.forEach((p) => ws2.addRow({ ...p, d: formatDateFr(p.d) }))
      const ws3 = wb.addWorksheet('Par mois')
      ws3.columns = [{ header: 'Mois', key: 'mois', width: 10 }, { header: 'CDC', key: 'nb', width: 8 }, { header: 'Pièces', key: 'q', width: 8 }, { header: 'Projeté insuffisant', key: 'nb_projete_insuffisant', width: 18 }, { header: 'Ont doublé', key: 'nb_doublees', width: 12 }, { header: 'Stock projeté moyen', key: 'projete_moy', width: 18 }, { header: 'Délai promis', key: 'delai_promis', width: 12 }, { header: 'Délai réel', key: 'delai_reel', width: 12 }, { header: 'Délai exact', key: 'delai_exact', width: 12 }, { header: 'Livrées avant date exacte', key: 'nb_livrees_avant_date_exacte', width: 22 }]
      header(ws3)
      data.mensuel.forEach((m) => ws3.addRow(m))
      const ws4 = wb.addWorksheet('Par agence')
      ws4.columns = [{ header: 'Agence', key: 'agence', width: 16 }, { header: 'CDC', key: 'nb', width: 8 }, { header: 'Pièces', key: 'q', width: 8 }, { header: 'Projeté insuffisant', key: 'nb_projete_insuffisant', width: 18 }, { header: 'Ont doublé (nb)', key: 'nb_doublees', width: 16 }, { header: 'Ont doublé (pièces)', key: 'q_doublees', width: 18 }]
      header(ws4)
      data.agences.forEach((a) => ws4.addRow(a))
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `reconstruction-${data.reference}-${data.depuis}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setExporting(false) }
  }

  return (
    <div style={styles.page}>
      <style>{`
        .rcBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .rcBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .rcTable th { position: sticky; top: 0; background: #101A2E; z-index: 1; }
        .rcTable tbody tr:hover td { background: rgba(255,255,255,0.04); }
      `}</style>

      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Stocks &amp; logistique · analyse rétrospective</div>
          <h1 style={styles.title}>Reconstruction du stock projeté</h1>
          <div style={styles.lead}>
            Depuis l'image du jour SAGE (tous dépôts), le stock physique est déroulé à rebours avec les sorties BL clients et les réceptions fournisseurs (lignes de CDF BLG). Pour chaque commande client créée depuis la date de départ : stock projeté à la saisie, date exacte que le système aurait dû proposer, promesses plus anciennes doublées à la livraison.
          </div>
        </div>
        <div style={styles.params}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Référence</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lancer() }} placeholder="RAK-DJ35RHAE" style={{ ...styles.input, width: 190, fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }} />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Depuis le</span>
            <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} style={{ ...styles.input, width: 160 }} />
          </label>
          <button type="button" className="rcBtn" onClick={lancer} disabled={loading || !reference.trim()} style={styles.primaryBtn}>{loading ? 'Calcul…' : 'Recalculer'}</button>
          {data && <button type="button" className="rcBtn" onClick={exporterExcel} disabled={exporting} style={styles.ghostBtn}>{exporting ? 'Export…' : 'Excel'}</button>}
          {data && <a href={`/stock?ref=${encodeURIComponent(data.reference)}`} target="_blank" rel="noopener noreferrer" className="rcBtn" style={styles.ghostBtn}>Fiche Stock articles ↗</a>}
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {!data && !loading && (
        <div style={styles.emptyMain}>
          <div style={{ fontSize: 34 }}>⏱</div>
          <div style={{ fontWeight: 700, color: '#fff', marginTop: 8, fontSize: 16 }}>Saisis une référence et une date de départ</div>
          <div style={{ ...styles.muted, marginTop: 6, maxWidth: 560, textAlign: 'center' }}>Le calcul rejoue la période jour par jour (quelques secondes sur une référence à forte rotation).</div>
        </div>
      )}
      {loading && <div style={styles.skeleton} />}

      {data && meta && !loading && (
        <>
          {/* ── Bandeau KPI ── */}
          <div style={styles.kpiRow}>
            <Kpi label={`Stock physique au ${formatDateCourte(data.depuis)}`} value={formatNumber(meta.stock_phys_debut)} sub={`${formatNumber(meta.promesses_debut)} pièces déjà promises · stock du jour ${formatNumber(data.stock_today)}`} />
            <Kpi label="Stock projeté négatif depuis le" value={meta.premier_jour_projete_negatif ? formatDateFr(meta.premier_jour_projete_negatif) : 'jamais'} color={meta.premier_jour_projete_negatif ? '#E0A961' : '#8fd4a8'} sub={meta.premier_jour_projete_negatif ? 'à partir de là, toute saisie aurait dû recevoir une date' : 'le stock projeté est resté positif'} big />
            <Kpi label="CDC créées" value={formatNumber(meta.nb_cdc)} sub={`${formatNumber(meta.q_cdc)} pièces · ${formatNumber(meta.nb_livrees)} déjà livrées`} />
            <Kpi label="Saisies avec stock projeté insuffisant" value={`${formatNumber(meta.nb_projete_insuffisant)} · ${partInsuffisant} %`} color={meta.nb_projete_insuffisant > 0 ? '#e0a685' : '#8fd4a8'} sub="stock projeté < quantité au moment de la saisie" />
            <Kpi label="Livrées avant leur date exacte" value={formatNumber(meta.nb_livrees_avant_date_exacte)} color={meta.nb_livrees_avant_date_exacte > 0 ? '#e0a685' : '#8fd4a8'} sub="servies avant la date que les réceptions permettaient" />
            <Kpi label="Ont doublé une promesse" value={`${formatNumber(meta.nb_doublees)} · ${partDoublees} %`} color={meta.nb_doublees > 0 ? '#E0A961' : '#8fd4a8'} sub={`${formatNumber(meta.q_doublees)} pièces · plus ancienne doublée ${formatDateCourte(meta.plus_ancienne_doublee)}`} />
            <Kpi label="Flux sur la période" value={`+${formatNumber(meta.receptions_total)} / −${formatNumber(meta.sorties_total)}`} color="#8FC7DA" sub="réceptions BLG / sorties BL clients" />
          </div>

          {meta.premier_jour_phys_negatif && (
            <div style={styles.warnBox}>
              Stock physique reconstruit négatif à partir du {formatDateFr(meta.premier_jour_phys_negatif)} : des réceptions manquent dans BLG sur cette période (réception saisie dans SAGE, BL non synchronisé, contremarque). Le constat reste valable, les dates exactes de cette période sont à prendre avec prudence.
            </div>
          )}

          {/* ── Courbe ── */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Stock physique et stock projeté, jour par jour</div>
            <div style={styles.muted}>Stock projeté = stock physique − commandes clients créées et non encore livrées. Points bleus : réceptions fournisseurs. Zone orange : période où toute nouvelle commande aurait dû recevoir une date.</div>
            <ReconstructionChart serie={data.serie} />
          </div>

          <div style={styles.twoCols}>
            {/* ── Par mois ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Mois par mois — ce qu'on a promis, ce qu'on a fait, ce qu'on aurait dû proposer</div>
              <div style={styles.tableWrap}>
                <table className="rcTable" style={styles.table}>
                  <thead><tr>{['Création', 'CDC', 'Pièces', 'Projeté insuffisant', 'Stock projeté moyen', 'Délai promis', 'Délai réel', 'Délai exact', 'Livrées avant date exacte', 'Ont doublé'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.mensuel.map((m) => (
                      <tr key={m.mois}>
                        <td style={{ ...styles.td, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMois(m.mois)}</td>
                        <td style={styles.tdNum}>{formatNumber(m.nb)}</td>
                        <td style={styles.tdNum}>{formatNumber(m.q)}</td>
                        <td style={{ ...styles.tdNum, color: m.nb_projete_insuffisant > 0 ? '#e0a685' : '#8fd4a8', fontWeight: 700 }}>{formatNumber(m.nb_projete_insuffisant)}</td>
                        <td style={{ ...styles.tdNum, color: couleurSigne(m.projete_moy ?? 0) }}>{m.projete_moy === null ? '—' : `${m.projete_moy > 0 ? '+' : ''}${formatNumber(m.projete_moy)}`}</td>
                        <td style={styles.tdNum}>{formatJours(m.delai_promis)}</td>
                        <td style={{ ...styles.tdNum, color: '#8fd4a8' }}>{formatJours(m.delai_reel)}</td>
                        <td style={{ ...styles.tdNum, color: '#E0A961', fontWeight: 700 }}>{m.delai_exact === null ? '—' : m.delai_exact === 0 ? 'immédiat' : formatJours(m.delai_exact)}{m.nb_sans_date > 0 ? <span style={styles.tdSub}> · {m.nb_sans_date} sans date</span> : null}</td>
                        <td style={{ ...styles.tdNum, color: m.nb_livrees_avant_date_exacte > 0 ? '#e0a685' : undefined }}>{formatNumber(m.nb_livrees_avant_date_exacte)}</td>
                        <td style={styles.tdNum}>{formatNumber(m.nb_doublees)} <span style={styles.tdSub}>({formatNumber(m.q_doublees)} p.)</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...styles.muted, marginTop: 8 }}>
                Délai exact = première date où stock projeté à la saisie + réceptions (réelles puis CDF SAGE à venir) ≥ quantité. « Ont doublé » = livrées alors qu'une commande plus ancienne, à date de livraison antérieure ou égale, attendait encore.
              </div>
            </div>

            {/* ── Par agence ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Par agence <span style={styles.muted}>(agence du collaborateur de la fiche client)</span></div>
              <div style={styles.tableWrap}>
                <table className="rcTable" style={styles.table}>
                  <thead><tr>{['Agence', 'CDC', 'Pièces', 'Projeté insuffisant', 'Ont doublé', 'Part'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.agences.map((a) => {
                      const part = a.nb > 0 ? Math.round((a.nb_doublees / a.nb) * 100) : 0
                      return (
                        <tr key={a.agence} onClick={() => setAgenceFiltre((v) => (v === a.agence ? '' : a.agence))} style={{ cursor: 'pointer', background: agenceFiltre === a.agence ? 'rgba(166,161,129,0.14)' : undefined }}>
                          <td style={{ ...styles.td, color: '#fff' }}>{a.agence}</td>
                          <td style={styles.tdNum}>{formatNumber(a.nb)}</td>
                          <td style={styles.tdNum}>{formatNumber(a.q)}</td>
                          <td style={{ ...styles.tdNum, color: a.nb_projete_insuffisant > 0 ? '#e0a685' : undefined }}>{formatNumber(a.nb_projete_insuffisant)}</td>
                          <td style={{ ...styles.tdNum, color: '#E0A961', fontWeight: 700 }}>{formatNumber(a.nb_doublees)} <span style={styles.tdSub}>({formatNumber(a.q_doublees)} p.)</span></td>
                          <td style={{ ...styles.td, width: 120 }}><div style={styles.barTrack}><div style={{ ...styles.barFill, width: `${part}%` }} /></div><span style={styles.tdSub}>{part} %</span></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ ...styles.muted, marginTop: 8 }}>Clic sur une agence pour filtrer le détail ci-dessous.</div>
            </div>
          </div>

          {/* ── Détail ── */}
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Détail des commandes <span style={styles.countTag}>{cdcFiltrees.length}</span>{agenceFiltre ? <span style={{ ...styles.countTag, color: '#E9E5D6' }}>{agenceFiltre} ✕</span> : null}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="N° document, client, tiers" style={{ ...styles.input, height: 34, width: 240, fontSize: 13, fontWeight: 400 }} />
                <div style={styles.segment}>
                  {FILTRES.map(([k, label]) => (
                    <button key={k} type="button" className="rcBtn" onClick={() => setFiltre(k)} style={{ ...styles.segmentBtn, ...(filtre === k ? styles.segmentBtnActive : {}) }}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ ...styles.tableWrap, maxHeight: 560 }}>
              <table className="rcTable" style={styles.table}>
                <thead><tr>{['Document', 'Client', 'Agence', 'Créée', 'Livraison promise', 'Livrée le', 'Qté', 'Stock phys.', 'Promesses ouvertes', 'Stock projeté', 'Date exacte', 'Écart', 'Promesses doublées', 'Plus ancienne'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {cdcFiltrees.slice(0, 500).map((c) => {
                    const ecart = c.date_bl && c.date_exacte ? daysBetween(c.date_exacte, c.date_bl) : null
                    return (
                      <tr key={c.bc}>
                        <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{c.bc}{c.ouverte ? <span title="Encore ouverte" style={{ ...styles.tdSub, marginLeft: 4 }}>ouv.</span> : null}</td>
                        <td style={styles.td}><div style={{ color: '#fff' }}>{c.nom || c.tiers}</div><div style={styles.tdSub}>{c.tiers}</div></td>
                        <td style={styles.td}>{c.agence}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(c.date_bc)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(c.date_livraison)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.date_bl ? '#8fd4a8' : undefined }}>{c.date_bl ? formatDateCourte(c.date_bl) : <span style={styles.tdSub}>non livrée</span>}</td>
                        <td style={styles.tdNum}>{formatNumber(c.q)}</td>
                        <td style={styles.tdNum}>{formatNumber(c.stock_phys)}</td>
                        <td style={styles.tdNum}>{formatNumber(c.promesses_ouvertes)}</td>
                        <td style={{ ...styles.tdNum, fontWeight: 700, color: couleurSigne(c.stock_projete_creation) }}>{c.stock_projete_creation > 0 ? '+' : ''}{formatNumber(c.stock_projete_creation)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.date_exacte === c.date_bc ? '#8fd4a8' : '#E0A961', fontWeight: 700 }}>{c.date_exacte ? (c.date_exacte === c.date_bc ? 'immédiat' : formatDateCourte(c.date_exacte)) : <span style={{ color: '#e0a685' }}>aucune</span>}</td>
                        <td style={{ ...styles.tdNum, color: ecart !== null && ecart < 0 ? '#e0a685' : undefined }}>{ecart === null ? '—' : `${ecart > 0 ? '+' : ''}${ecart} j`}</td>
                        <td style={{ ...styles.tdNum, color: c.nb_doublees > 0 ? '#E0A961' : undefined }}>{c.nb_doublees > 0 ? `${c.nb_doublees} CDC · ${formatNumber(c.q_doublees)} p.` : '—'}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: '#e0a685' }}>{formatDateCourte(c.plus_ancienne_doublee)}</td>
                      </tr>
                    )
                  })}
                  {cdcFiltrees.length === 0 && <tr><td colSpan={14} style={{ ...styles.td, textAlign: 'center' }}><span style={styles.muted}>Aucune commande pour ce filtre.</span></td></tr>}
                </tbody>
              </table>
            </div>
            {cdcFiltrees.length > 500 && <div style={{ ...styles.muted, marginTop: 6 }}>500 premières lignes affichées — l'export Excel contient tout.</div>}
            <div style={{ ...styles.muted, marginTop: 8 }}>Écart = livrée − date exacte (négatif : servie avant son tour). Stock physique et promesses ouvertes sont ceux de la fin de journée de saisie, hors la commande elle-même.</div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Courbe stock physique / projeté ───────────────────────────────────────
function ReconstructionChart({ serie }: { serie: PointSerie[] }) {
  const width = 1100
  const height = 320
  const padding = { top: 18, right: 20, bottom: 34, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (serie.length === 0) return <div style={styles.muted}>Aucune donnée.</div>
  const debut = serie[0].d
  const fin = serie[serie.length - 1].d
  const totalJours = Math.max(1, daysBetween(debut, fin))
  const x = (iso: string) => padding.left + (daysBetween(debut, iso) / totalJours) * innerW
  const allValues = serie.flatMap((p) => [p.stock_phys, p.projete])
  const maxVal = Math.max(1, ...allValues)
  const minVal = Math.min(0, ...allValues)
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH
  const yZero = y(0)
  const pathPhys = serie.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.d)} ${y(p.stock_phys)}`).join(' ')
  const pathProj = serie.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.d)} ${y(p.projete)}`).join(' ')
  const negSegments: Array<{ x1: number; x2: number }> = []
  let seg: { x1: number; x2: number } | null = null
  serie.forEach((p, i) => {
    if (p.projete < 0) { const px = x(p.d); if (!seg) seg = { x1: px, x2: px }; seg.x2 = i + 1 < serie.length ? x(serie[i + 1].d) : px } else if (seg) { negSegments.push(seg); seg = null }
  })
  if (seg) negSegments.push(seg)
  const mois: Array<{ iso: string; label: string }> = []
  { const d = new Date(`${debut}T00:00:00`); d.setDate(1); d.setMonth(d.getMonth() + 1); while (toIsoDate(d) <= fin) { mois.push({ iso: toIsoDate(d), label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) }); d.setMonth(d.getMonth() + 1) } }
  const range = maxVal - minVal || 1
  const ticks = [minVal, minVal + range / 4, minVal + range / 2, minVal + (range * 3) / 4, maxVal]

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    let best = 0
    for (let i = 0; i < serie.length; i += 1) if (x(serie[i].d) <= svgX) best = i
    setHover(best)
  }
  const hp = hover !== null ? serie[hover] : null
  const hpX = hp ? x(hp.d) : 0

  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padding.left} y1={y(t)} x2={width - padding.right} y2={y(t)} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <text x={padding.left - 8} y={y(t) + 3} fontSize={10} textAnchor="end" fill="rgba(255,255,255,0.45)" fontFamily="var(--font-mono)">{formatNumber(t)}</text>
          </g>
        ))}
        {mois.map((m) => (
          <g key={m.iso}>
            <line x1={x(m.iso)} y1={padding.top} x2={x(m.iso)} y2={padding.top + innerH} stroke="rgba(255,255,255,0.06)" />
            <text x={x(m.iso)} y={height - 12} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.45)">{m.label}</text>
          </g>
        ))}
        {negSegments.map((s, i) => <rect key={i} x={s.x1} y={padding.top} width={Math.max(0, s.x2 - s.x1)} height={innerH} fill="rgba(193,104,60,0.12)" />)}
        <line x1={padding.left} y1={yZero} x2={width - padding.right} y2={yZero} stroke="#C1683C" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.8} />
        <text x={width - padding.right} y={yZero - 4} fontSize={10} textAnchor="end" fill="#e0a685">projeté négatif</text>
        <path d={pathPhys} fill="none" stroke="#E9E5D6" strokeWidth={1.6} opacity={0.8} />
        <path d={pathProj} fill="none" stroke="#8FC7DA" strokeWidth={2.4} strokeLinejoin="round" />
        {serie.filter((p) => p.rec > 0).map((p) => <circle key={p.d} cx={x(p.d)} cy={y(p.stock_phys)} r={4} fill="#8FC7DA" stroke="#101A2E" strokeWidth={1.5} />)}
        {hp && <line x1={hpX} y1={padding.top} x2={hpX} y2={padding.top + innerH} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
      </svg>
      {hp && (
        <div style={{ ...styles.tooltip, left: `${Math.min(88, Math.max(6, (hpX / width) * 100))}%` }}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{formatDateFr(hp.d)}</div>
          <div>Stock physique : <strong style={{ color: '#E9E5D6' }}>{formatNumber(hp.stock_phys)}</strong></div>
          <div>Promesses ouvertes : <strong style={{ color: '#E0A961' }}>{formatNumber(hp.promesses)}</strong></div>
          <div>Stock projeté : <strong style={{ color: couleurSigne(hp.projete) }}>{formatNumber(hp.projete)}</strong></div>
          {(hp.rec > 0 || hp.sor > 0) && <div style={styles.tdSub}>{hp.rec > 0 ? `réception +${formatNumber(hp.rec)}` : ''}{hp.rec > 0 && hp.sor > 0 ? ' · ' : ''}{hp.sor > 0 ? `sorties −${formatNumber(hp.sor)}` : ''}</div>}
        </div>
      )}
      <div style={styles.legend}>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#E9E5D6' }} />Stock physique reconstruit</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#8FC7DA' }} />Stock projeté (physique − promesses ouvertes)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'rgba(193,104,60,0.5)' }} />Période où une date aurait dû être imposée</span>
      </div>
    </div>
  )
}

// ── Petits composants ─────────────────────────────────────────────────────
function Kpi({ label, value, color, sub, big }: { label: string; value: string; color?: string; sub?: string; big?: boolean }) {
  return (
    <div style={{ ...styles.kpi, ...(big ? styles.kpiBig : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(big ? { fontSize: 28 } : {}), color: color || '#fff' }}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1700, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column', gap: 14 },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)', maxWidth: 980 },
  params: { display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  input: { height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', boxSizing: 'border-box' },
  primaryBtn: { height: 40, padding: '0 16px', borderRadius: 10, border: '1px solid #A6A181', background: '#A6A181', color: '#0B1220', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10, flexWrap: 'wrap' },
  cardHeaderRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  countTag: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', letterSpacing: 0, textTransform: 'none' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, textTransform: 'none', letterSpacing: 0, fontWeight: 400 },
  errorBox: { padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: '#e0a685', fontSize: 13 },
  warnBox: { padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(224,169,97,0.45)', background: 'rgba(224,169,97,0.10)', color: '#E9E5D6', fontSize: 12.5, lineHeight: 1.45 },
  skeleton: { height: 160, borderRadius: 12, background: 'rgba(255,255,255,0.05)' },
  emptyMain: { minHeight: 360, borderRadius: 18, border: '1px dashed rgba(255,255,255,0.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28 },

  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 },
  kpi: { borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '12px 14px', minWidth: 0 },
  kpiBig: { border: '1px solid rgba(224,169,97,0.4)', background: 'rgba(224,169,97,0.10)' },
  kpiLabel: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  kpiValue: { marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap' },
  kpiSub: { marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.35 },

  twoCols: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' },
  tableWrap: { maxHeight: 420, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top' },
  tdNum: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top', textAlign: 'right', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' },
  tdSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  barTrack: { height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 3 },
  barFill: { height: '100%', borderRadius: 3, background: '#C1683C' },

  segment: { display: 'flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', flexWrap: 'wrap' },
  segmentBtn: { padding: '6px 10px', borderRadius: 9, border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  segmentBtnActive: { background: 'rgba(75,146,172,0.22)', borderColor: 'rgba(75,146,172,0.55)', color: '#8FC7DA' },

  tooltip: { position: 'absolute', top: 8, transform: 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#0B1220', padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 24px rgba(0,0,0,0.4)', zIndex: 5 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
}
