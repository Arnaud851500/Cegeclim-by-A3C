'use client'

// ============================================================================
// app/stock/reconstruction/page.tsx — Reconstruction du stock projeté (v2)
// ----------------------------------------------------------------------------
// (2026-09-18) v2 — « solde daté » + projection au-delà du jour.
// À partir de l'image du jour SAGE (sage.stock_depot, tous dépôts), le stock
// physique est déroulé à rebours avec les sorties BL clients et les réceptions
// fournisseurs RÉELLES (lignes de CDF BLG). Pour chaque commande client créée
// depuis la date de départ, on rejoue l'état de FIN DE JOURNÉE de saisie :
//   solde(t) = stock + réceptions ]saisie ; t] − promesses plus anciennes dues ≤ t
//   (une promesse ne consomme le stock qu'à SA date de livraison ; une promesse
//    déjà en retard est due le jour même)
//   • OK          : min solde(t ≥ échéance) ≥ quantité ;
//   • INTENABLE   : solde(échéance) < quantité → le client ne peut pas être livré ;
//   • CREE_RETARD : livrable à l'échéance, mais prend le stock d'une promesse plus
//                   lointaine qu'aucun arrivage ne recouvre à temps ;
//   • date exacte : première date où la commande ne lèse personne.
// Après aujourd'hui, la série est prolongée : stock du jour + CDF SAGE attendues
// − CDC ouvertes à leur échéance (retards positionnés à J+1).
// Tout le calcul est côté base : RPC get_stock_reconstruction(p_reference,
// p_depuis) → jsonb { meta, serie, mensuel, agences, cdc }.
// ?ref=XXXX&depuis=YYYY-MM-DD ouvre directement une référence.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import ExcelJS from 'exceljs'

// ── Types ─────────────────────────────────────────────────────────────────
type Verdict = 'OK' | 'INTENABLE' | 'CREE_RETARD'
type Meta = {
  stock_phys_ouverture: number
  stock_phys_debut: number
  promesses_debut: number
  premier_jour_projete_negatif: string | null
  premier_jour_phys_negatif: string | null
  receptions_total: number
  sorties_total: number
  nb_cdc: number
  q_cdc: number
  nb_livrees: number
  nb_ok: number
  nb_intenable: number
  q_intenable: number
  nb_cree_retard: number
  q_cree_retard: number
  nb_servies_aux_depens: number
  q_servies_aux_depens: number
  nb_a_recaler: number
  q_a_recaler: number
  nb_date_incoherente: number
  futur_receptions: number
  futur_cdc_pieces: number
  futur_cdc_nb: number
  futur_cdc_en_retard_pieces: number
  futur_premiere_rupture: string | null
  futur_fin_rupture: string | null
  futur_stock_min: number
  futur_stock_fin: number
}
type PointSerie = { d: string; futur: boolean; rec: number; sor: number; stock_phys: number; promesses: number; projete: number }
type LigneMois = {
  mois: string; nb: number; q: number; nb_ok: number; nb_intenable: number; q_intenable: number; nb_cree_retard: number; q_cree_retard: number
  nb_servies_aux_depens: number; nb_a_recaler: number; delai_promis: number | null; delai_reel: number | null; delai_exact: number | null; nb_sans_date: number
}
type LigneAgence = { agence: string; nb: number; q: number; nb_intenable: number; nb_cree_retard: number; q_fautif: number; nb_servies_aux_depens: number; nb_a_recaler: number }
type Cdc = {
  bc: string; date_bc: string; date_livraison: string | null; echeance: string; date_bl: string | null; ouverte: boolean
  tiers: string | null; nom: string | null; agence: string; q: number; stock_phys: number; promesses_ouvertes: number
  stock_projete_creation: number; solde_echeance: number; atp_echeance: number; verdict: Verdict; q_manque: number
  date_exacte: string | null; date_rupture: string | null; nb_victimes: number; q_victimes: number; victimes: string | null
}
type Reconstruction = {
  reference: string; depuis: string; aujourdhui: string; fin: string; stock_today: number
  meta: Meta; serie: PointSerie[]; mensuel: LigneMois[]; agences: LigneAgence[]; cdc: Cdc[]
}
type FiltreDetail = 'toutes' | 'fautives' | 'intenable' | 'cree_retard' | 'servies_aux_depens' | 'a_recaler'

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function toNumberOrNull(v: unknown): number | null { return v === null || v === undefined ? null : toNumber(v) }
function formatNumber(n: number | null | undefined): string { return n === null || n === undefined ? '—' : Math.round(n).toLocaleString('fr-FR') }
function formatSigne(n: number | null | undefined): string { return n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${formatNumber(n)}` }
function formatJours(n: number | null | undefined): string { return n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j` }
function formatDateFr(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
function formatDateCourte(iso?: string | null): string { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y.slice(2)}` }
function formatMois(ym: string): string { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function daysBetween(a: string, b: string): number { return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000) }
function couleurSigne(n: number): string { if (n > 0) return '#8fd4a8'; if (n < 0) return '#e0a685'; return 'rgba(255,255,255,0.5)' }
function defautDepuis(): string { const d = new Date(); d.setMonth(d.getMonth() - 3); d.setDate(1); return toIsoDate(d) }
function pct(n: number, total: number): number { return total > 0 ? Math.round((n / total) * 100) : 0 }
function serviAuxDepens(c: Cdc): boolean { return c.verdict !== 'OK' && !!c.date_bl && (!c.date_exacte || c.date_bl < c.date_exacte) }

const VERDICTS: Record<Verdict, { label: string; color: string; bg: string }> = {
  OK: { label: 'Tenable', color: '#8fd4a8', bg: 'rgba(143,212,168,0.12)' },
  INTENABLE: { label: 'Intenable', color: '#e0a685', bg: 'rgba(193,104,60,0.18)' },
  CREE_RETARD: { label: 'Crée un retard', color: '#E0A961', bg: 'rgba(224,169,97,0.16)' },
}

const FILTRES: Array<[FiltreDetail, string]> = [
  ['fautives', 'Promesses à problème'],
  ['intenable', 'Intenables'],
  ['cree_retard', 'Créent un retard'],
  ['servies_aux_depens', 'Servies aux dépens d\'autres'],
  ['a_recaler', 'Ouvertes à recaler'],
  ['toutes', 'Toutes'],
]

// ── Page ──────────────────────────────────────────────────────────────────
export default function ReconstructionPage() {
  const [reference, setReference] = useState('')
  const [depuis, setDepuis] = useState(defautDepuis())
  const [refChargee, setRefChargee] = useState<{ reference: string; depuis: string } | null>(null)
  const [data, setData] = useState<Reconstruction | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filtre, setFiltre] = useState<FiltreDetail>('fautives')
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
        const metaBrut = (r.meta || {}) as Record<string, unknown>
        const dateKeys = new Set(['premier_jour_projete_negatif', 'premier_jour_phys_negatif', 'futur_premiere_rupture', 'futur_fin_rupture'])
        setData({
          reference: r.reference, depuis: r.depuis, aujourdhui: r.aujourdhui || toIsoDate(new Date()), fin: r.fin || r.aujourdhui, stock_today: toNumber(r.stock_today),
          meta: Object.fromEntries(Object.entries(metaBrut).map(([k, v]) => [k, dateKeys.has(k) ? (v ? String(v).slice(0, 10) : null) : toNumber(v)])) as Meta,
          serie: ((r.serie || []) as any[]).map((p) => ({ d: p.d, futur: Boolean(p.futur), rec: toNumber(p.rec), sor: toNumber(p.sor), stock_phys: toNumber(p.stock_phys), promesses: toNumber(p.promesses), projete: toNumber(p.projete) })),
          mensuel: ((r.mensuel || []) as any[]).map((m) => ({ mois: m.mois, nb: toNumber(m.nb), q: toNumber(m.q), nb_ok: toNumber(m.nb_ok), nb_intenable: toNumber(m.nb_intenable), q_intenable: toNumber(m.q_intenable), nb_cree_retard: toNumber(m.nb_cree_retard), q_cree_retard: toNumber(m.q_cree_retard), nb_servies_aux_depens: toNumber(m.nb_servies_aux_depens), nb_a_recaler: toNumber(m.nb_a_recaler), delai_promis: toNumberOrNull(m.delai_promis), delai_reel: toNumberOrNull(m.delai_reel), delai_exact: toNumberOrNull(m.delai_exact), nb_sans_date: toNumber(m.nb_sans_date) })),
          agences: ((r.agences || []) as any[]).map((a) => ({ agence: a.agence, nb: toNumber(a.nb), q: toNumber(a.q), nb_intenable: toNumber(a.nb_intenable), nb_cree_retard: toNumber(a.nb_cree_retard), q_fautif: toNumber(a.q_fautif), nb_servies_aux_depens: toNumber(a.nb_servies_aux_depens), nb_a_recaler: toNumber(a.nb_a_recaler) })),
          cdc: ((r.cdc || []) as any[]).map((c) => ({ ...c, q: toNumber(c.q), stock_phys: toNumber(c.stock_phys), promesses_ouvertes: toNumber(c.promesses_ouvertes), stock_projete_creation: toNumber(c.stock_projete_creation), solde_echeance: toNumber(c.solde_echeance), atp_echeance: toNumber(c.atp_echeance), q_manque: toNumber(c.q_manque), nb_victimes: toNumber(c.nb_victimes), q_victimes: toNumber(c.q_victimes), ouverte: Boolean(c.ouverte), verdict: (c.verdict || 'OK') as Verdict })),
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
      if (filtre === 'fautives' && c.verdict === 'OK') return false
      if (filtre === 'intenable' && c.verdict !== 'INTENABLE') return false
      if (filtre === 'cree_retard' && c.verdict !== 'CREE_RETARD') return false
      if (filtre === 'servies_aux_depens' && !serviAuxDepens(c)) return false
      if (filtre === 'a_recaler' && !(c.verdict !== 'OK' && c.ouverte)) return false
      if (agenceFiltre && c.agence !== agenceFiltre) return false
      if (q && !`${c.bc} ${c.nom || ''} ${c.tiers || ''}`.toUpperCase().includes(q)) return false
      return true
    }).sort((a, b) => a.date_bc.localeCompare(b.date_bc) || a.bc.localeCompare(b.bc))
  }, [data, filtre, agenceFiltre, recherche])

  const meta = data?.meta

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
        { header: 'Créée le', key: 'date_bc', width: 12 }, { header: 'Livraison promise', key: 'date_livraison', width: 16 }, { header: 'Échéance retenue', key: 'echeance', width: 16 }, { header: 'Livrée le', key: 'date_bl', width: 12 },
        { header: 'Qté', key: 'q', width: 8 }, { header: 'Stock fin de journée de saisie', key: 'stock_phys', width: 24 }, { header: 'Promesses ouvertes (toutes dates)', key: 'promesses_ouvertes', width: 26 },
        { header: 'Solde à l\'échéance', key: 'solde_echeance', width: 18 }, { header: 'Dispo réelle à l\'échéance', key: 'atp_echeance', width: 22 }, { header: 'Verdict', key: 'verdict_label', width: 16 }, { header: 'Pièces en défaut', key: 'q_manque', width: 16 },
        { header: 'Date exacte', key: 'date_exacte', width: 12 }, { header: 'Écart exacte − promise (j)', key: 'ecart_promesse', width: 22 }, { header: 'Écart livrée − exacte (j)', key: 'ecart_livree', width: 22 },
        { header: 'Rupture créée le', key: 'date_rupture', width: 16 }, { header: 'Promesses exposées (nb)', key: 'nb_victimes', width: 20 }, { header: 'Promesses exposées (pièces)', key: 'q_victimes', width: 22 }, { header: 'Premières promesses exposées', key: 'victimes', width: 50 },
        { header: 'Servie aux dépens d\'autres', key: 'aux_depens', width: 22 }, { header: 'Encore ouverte', key: 'ouverte_label', width: 14 },
      ]
      header(ws1)
      data.cdc.forEach((c) => ws1.addRow({
        ...c, date_bc: formatDateFr(c.date_bc), date_livraison: formatDateFr(c.date_livraison), echeance: formatDateFr(c.echeance), date_bl: formatDateFr(c.date_bl), date_exacte: c.date_exacte ? formatDateFr(c.date_exacte) : 'aucune',
        date_rupture: formatDateFr(c.date_rupture), verdict_label: VERDICTS[c.verdict].label,
        ecart_promesse: c.date_exacte ? daysBetween(c.echeance, c.date_exacte) : null, ecart_livree: c.date_bl && c.date_exacte ? daysBetween(c.date_exacte, c.date_bl) : null,
        aux_depens: serviAuxDepens(c) ? 'oui' : '', ouverte_label: c.ouverte ? 'oui' : '',
      }))
      ws1.autoFilter = { from: 'A1', to: 'X1' }
      const ws2 = wb.addWorksheet('Série journalière')
      ws2.columns = [{ header: 'Date', key: 'd', width: 12 }, { header: 'Nature', key: 'nature', width: 12 }, { header: 'Réceptions', key: 'rec', width: 12 }, { header: 'Sorties', key: 'sor', width: 12 }, { header: 'Stock physique', key: 'stock_phys', width: 14 }, { header: 'Promesses ouvertes', key: 'promesses', width: 18 }, { header: 'Stock projeté', key: 'projete', width: 14 }]
      header(ws2)
      data.serie.forEach((p) => ws2.addRow({ ...p, d: formatDateFr(p.d), nature: p.futur ? 'projection' : 'réel' }))
      const ws3 = wb.addWorksheet('Par mois')
      ws3.columns = [{ header: 'Mois', key: 'mois', width: 10 }, { header: 'CDC', key: 'nb', width: 8 }, { header: 'Pièces', key: 'q', width: 8 }, { header: 'Tenables', key: 'nb_ok', width: 10 }, { header: 'Intenables', key: 'nb_intenable', width: 12 }, { header: 'Créent un retard', key: 'nb_cree_retard', width: 16 }, { header: 'Servies aux dépens d\'autres', key: 'nb_servies_aux_depens', width: 24 }, { header: 'Ouvertes à recaler', key: 'nb_a_recaler', width: 18 }, { header: 'Délai promis', key: 'delai_promis', width: 12 }, { header: 'Délai réel', key: 'delai_reel', width: 12 }, { header: 'Délai exact', key: 'delai_exact', width: 12 }]
      header(ws3)
      data.mensuel.forEach((m) => ws3.addRow(m))
      const ws4 = wb.addWorksheet('Par agence')
      ws4.columns = [{ header: 'Agence', key: 'agence', width: 16 }, { header: 'CDC', key: 'nb', width: 8 }, { header: 'Pièces', key: 'q', width: 8 }, { header: 'Intenables', key: 'nb_intenable', width: 12 }, { header: 'Créent un retard', key: 'nb_cree_retard', width: 16 }, { header: 'Pièces à problème', key: 'q_fautif', width: 16 }, { header: 'Servies aux dépens d\'autres', key: 'nb_servies_aux_depens', width: 24 }, { header: 'Ouvertes à recaler', key: 'nb_a_recaler', width: 18 }]
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
            Depuis l'image du jour SAGE (tous dépôts), le stock physique est déroulé à rebours avec les sorties BL clients et les réceptions fournisseurs réelles (lignes de CDF BLG). Pour chaque commande client créée depuis la date de départ, on rejoue la fin de journée de saisie : chaque promesse plus ancienne consomme le stock à sa propre date de livraison, chaque arrivage le recrée à la sienne. Une promesse est à problème si elle ne peut pas être livrée à sa date, ou si elle prend le stock d'une promesse plus lointaine qu'aucun arrivage ne recouvre à temps. Au-delà d'aujourd'hui, la courbe est prolongée avec les portefeuilles clients et fournisseurs.
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
            <Kpi label={`Stock physique à l'ouverture du ${formatDateCourte(data.depuis)}`} value={formatNumber(meta.stock_phys_ouverture)} sub={`+${formatNumber(meta.receptions_total)} reçues − ${formatNumber(meta.sorties_total)} sorties = ${formatNumber(data.stock_today)} aujourd'hui`} />
            <Kpi label="CDC créées" value={formatNumber(meta.nb_cdc)} sub={`${formatNumber(meta.q_cdc)} pièces · ${formatNumber(meta.nb_livrees)} livrées · ${formatNumber(meta.nb_ok)} promesses tenables (${pct(meta.nb_ok, meta.nb_cdc)} %)`} />
            <Kpi label="Promesses intenables" value={`${formatNumber(meta.nb_intenable)} · ${pct(meta.nb_intenable, meta.nb_cdc)} %`} color={meta.nb_intenable > 0 ? '#e0a685' : '#8fd4a8'} sub={`${formatNumber(meta.q_intenable)} pièces · à la date promise, le stock n'y était pas, même en comptant les arrivages`} />
            <Kpi label="Créent un retard" value={`${formatNumber(meta.nb_cree_retard)} · ${pct(meta.nb_cree_retard, meta.nb_cdc)} %`} color={meta.nb_cree_retard > 0 ? '#E0A961' : '#8fd4a8'} sub={`${formatNumber(meta.q_cree_retard)} pièces · livrables à leur date, mais sur le stock d'une promesse plus lointaine non recouverte`} big />
            <Kpi label="Servies aux dépens d'autres" value={formatNumber(meta.nb_servies_aux_depens)} color={meta.nb_servies_aux_depens > 0 ? '#e0a685' : '#8fd4a8'} sub={`${formatNumber(meta.q_servies_aux_depens)} pièces · promesses à problème réellement livrées avant leur date exacte`} />
            <Kpi label="Ouvertes à recaler" value={formatNumber(meta.nb_a_recaler)} color={meta.nb_a_recaler > 0 ? '#E0A961' : '#8fd4a8'} sub={`${formatNumber(meta.q_a_recaler)} pièces · promesses à problème encore en portefeuille`} />
            <Kpi label="Projection du portefeuille" value={meta.futur_premiere_rupture ? formatDateFr(meta.futur_premiere_rupture) : 'pas de rupture'} color={meta.futur_premiere_rupture ? '#e0a685' : '#8fd4a8'} sub={meta.futur_premiere_rupture ? `rupture physique à venir · creux ${formatNumber(meta.futur_stock_min)}${meta.futur_fin_rupture ? ` · recouvert le ${formatDateCourte(meta.futur_fin_rupture)}` : ' · jamais recouvert'}` : `+${formatNumber(meta.futur_receptions)} attendues − ${formatNumber(meta.futur_cdc_pieces)} à livrer = ${formatNumber(meta.futur_stock_fin)} au ${formatDateCourte(data.fin)}`} />
          </div>

          {meta.premier_jour_phys_negatif && (
            <div style={styles.warnBox}>
              Stock physique reconstruit négatif à partir du {formatDateFr(meta.premier_jour_phys_negatif)} : des réceptions manquent dans BLG sur cette période (réception saisie dans SAGE, BL non synchronisé, contremarque). Le constat reste valable, les dates exactes de cette période sont à prendre avec prudence.
            </div>
          )}
          {meta.nb_date_incoherente > 0 && (
            <div style={styles.warnBox}>
              {formatNumber(meta.nb_date_incoherente)} commande(s) portent une date de livraison antérieure à leur date de création (erreur de saisie). Leur échéance est ramenée au jour de création.
            </div>
          )}

          {/* ── Courbe ── */}
          <div style={styles.card}>
            <div style={styles.cardTitle}>Stock physique et stock projeté — réel jusqu'au {formatDateCourte(data.aujourdhui)}, puis projection du portefeuille jusqu'au {formatDateCourte(data.fin)}</div>
            <div style={styles.muted}>
              Stock projeté = stock physique − toutes les commandes clients créées et non livrées (quelle que soit leur date). Points bleus : réceptions fournisseurs (réelles, puis CDF SAGE attendues). En pointillés : stock du jour + CDF attendues − CDC ouvertes à leur date de livraison ({formatNumber(meta.futur_cdc_nb)} CDC · {formatNumber(meta.futur_cdc_pieces)} pièces, dont {formatNumber(meta.futur_cdc_en_retard_pieces)} déjà en retard positionnées à demain). Zone orange : stock projeté négatif ; zone rouge : rupture physique à venir.
            </div>
            <ReconstructionChart serie={data.serie} aujourdhui={data.aujourdhui} />
          </div>

          <div style={styles.twoCols}>
            {/* ── Par mois ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Mois par mois — ce qu'on a promis, ce qu'on a fait, ce qu'on aurait dû proposer</div>
              <div style={styles.tableWrap}>
                <table className="rcTable" style={styles.table}>
                  <thead><tr>{['Création', 'CDC', 'Pièces', 'Tenables', 'Intenables', 'Créent un retard', 'Servies aux dépens', 'À recaler', 'Délai promis', 'Délai réel', 'Délai exact'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.mensuel.map((m) => (
                      <tr key={m.mois}>
                        <td style={{ ...styles.td, color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMois(m.mois)}</td>
                        <td style={styles.tdNum}>{formatNumber(m.nb)}</td>
                        <td style={styles.tdNum}>{formatNumber(m.q)}</td>
                        <td style={{ ...styles.tdNum, color: '#8fd4a8' }}>{formatNumber(m.nb_ok)} <span style={styles.tdSub}>({pct(m.nb_ok, m.nb)} %)</span></td>
                        <td style={{ ...styles.tdNum, color: m.nb_intenable > 0 ? '#e0a685' : undefined, fontWeight: 700 }}>{formatNumber(m.nb_intenable)} <span style={styles.tdSub}>({formatNumber(m.q_intenable)} p.)</span></td>
                        <td style={{ ...styles.tdNum, color: m.nb_cree_retard > 0 ? '#E0A961' : undefined, fontWeight: 700 }}>{formatNumber(m.nb_cree_retard)} <span style={styles.tdSub}>({formatNumber(m.q_cree_retard)} p.)</span></td>
                        <td style={{ ...styles.tdNum, color: m.nb_servies_aux_depens > 0 ? '#e0a685' : undefined }}>{formatNumber(m.nb_servies_aux_depens)}</td>
                        <td style={{ ...styles.tdNum, color: m.nb_a_recaler > 0 ? '#E0A961' : undefined }}>{formatNumber(m.nb_a_recaler)}</td>
                        <td style={styles.tdNum}>{formatJours(m.delai_promis)}</td>
                        <td style={{ ...styles.tdNum, color: '#8fd4a8' }}>{formatJours(m.delai_reel)}</td>
                        <td style={{ ...styles.tdNum, color: '#E0A961', fontWeight: 700 }}>{m.delai_exact === null ? '—' : m.delai_exact === 0 ? 'immédiat' : formatJours(m.delai_exact)}{m.nb_sans_date > 0 ? <span style={styles.tdSub}> · {m.nb_sans_date} sans date</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ ...styles.muted, marginTop: 8 }}>
                Délai exact = première date où la commande peut être servie sans rendre négatif le solde daté (stock + réceptions − promesses plus anciennes à leur date), ni à cette date ni après. « Servies aux dépens » = promesses à problème livrées avant cette date exacte. « À recaler » = promesses à problème encore ouvertes.
              </div>
            </div>

            {/* ── Par agence ── */}
            <div style={styles.card}>
              <div style={styles.cardTitle}>Par agence <span style={styles.muted}>(agence du collaborateur de la fiche client)</span></div>
              <div style={styles.tableWrap}>
                <table className="rcTable" style={styles.table}>
                  <thead><tr>{['Agence', 'CDC', 'Pièces', 'Intenables', 'Créent un retard', 'Servies aux dépens', 'À recaler', 'Part à problème'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.agences.map((a) => {
                      const part = pct(a.nb_intenable + a.nb_cree_retard, a.nb)
                      return (
                        <tr key={a.agence} onClick={() => setAgenceFiltre((v) => (v === a.agence ? '' : a.agence))} style={{ cursor: 'pointer', background: agenceFiltre === a.agence ? 'rgba(166,161,129,0.14)' : undefined }}>
                          <td style={{ ...styles.td, color: '#fff' }}>{a.agence}</td>
                          <td style={styles.tdNum}>{formatNumber(a.nb)}</td>
                          <td style={styles.tdNum}>{formatNumber(a.q)}</td>
                          <td style={{ ...styles.tdNum, color: a.nb_intenable > 0 ? '#e0a685' : undefined }}>{formatNumber(a.nb_intenable)}</td>
                          <td style={{ ...styles.tdNum, color: a.nb_cree_retard > 0 ? '#E0A961' : undefined }}>{formatNumber(a.nb_cree_retard)}</td>
                          <td style={styles.tdNum}>{formatNumber(a.nb_servies_aux_depens)}</td>
                          <td style={styles.tdNum}>{formatNumber(a.nb_a_recaler)}</td>
                          <td style={{ ...styles.td, width: 120 }}><div style={styles.barTrack}><div style={{ ...styles.barFill, width: `${part}%` }} /></div><span style={styles.tdSub}>{part} % · {formatNumber(a.q_fautif)} p.</span></td>
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
              <div style={styles.cardTitle}>Détail des commandes <span style={styles.countTag}>{cdcFiltrees.length}</span>{agenceFiltre ? <span style={{ ...styles.countTag, color: '#E9E5D6', cursor: 'pointer' }} onClick={() => setAgenceFiltre('')}>{agenceFiltre} ✕</span> : null}</div>
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
                <thead><tr>{['Document', 'Client', 'Agence', 'Créée', 'Promise', 'Livrée le', 'Qté', 'Stock fin de journée', 'Solde à la date promise', 'Dispo réelle', 'Verdict', 'Date exacte', 'Exacte − promise', 'Livrée − exacte', 'Rupture créée le', 'Promesses exposées'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {cdcFiltrees.slice(0, 500).map((c) => {
                    const ecartPromesse = c.date_exacte ? daysBetween(c.echeance, c.date_exacte) : null
                    const ecartLivree = c.date_bl && c.date_exacte ? daysBetween(c.date_exacte, c.date_bl) : null
                    const v = VERDICTS[c.verdict]
                    const dateIncoherente = !!c.date_livraison && c.date_livraison < c.date_bc
                    return (
                      <tr key={c.bc}>
                        <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{c.bc}{c.ouverte ? <span title="Encore ouverte" style={{ ...styles.tdSub, marginLeft: 4 }}>ouv.</span> : null}</td>
                        <td style={styles.td}><div style={{ color: '#fff' }}>{c.nom || c.tiers}</div><div style={styles.tdSub}>{c.tiers}</div></td>
                        <td style={styles.td}>{c.agence}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(c.date_bc)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }} title={dateIncoherente ? `Date saisie ${formatDateFr(c.date_livraison)} antérieure à la création : échéance ramenée au jour de création` : undefined}>{formatDateCourte(c.echeance)}{dateIncoherente ? <span style={{ ...styles.tdSub, color: '#e0a685' }}> ⚠</span> : null}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.date_bl ? '#8fd4a8' : undefined }}>{c.date_bl ? formatDateCourte(c.date_bl) : <span style={styles.tdSub}>non livrée</span>}</td>
                        <td style={styles.tdNum}>{formatNumber(c.q)}</td>
                        <td style={styles.tdNum} title={`Promesses ouvertes toutes dates : ${formatNumber(c.promesses_ouvertes)} · stock projeté ${formatSigne(c.stock_projete_creation)}`}>{formatNumber(c.stock_phys)}</td>
                        <td style={{ ...styles.tdNum, color: c.solde_echeance >= c.q ? '#8fd4a8' : '#e0a685' }}>{formatSigne(c.solde_echeance)}</td>
                        <td style={{ ...styles.tdNum, fontWeight: 700, color: c.atp_echeance >= c.q ? '#8fd4a8' : '#e0a685' }}>{formatSigne(c.atp_echeance)}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}><span style={{ ...styles.verdictTag, color: v.color, background: v.bg }}>{v.label}</span>{c.verdict !== 'OK' ? <span style={styles.tdSub}> {formatNumber(c.q_manque)} p.</span> : null}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: c.verdict === 'OK' ? '#8fd4a8' : '#E0A961', fontWeight: 700 }}>{c.date_exacte ? (c.date_exacte === c.date_bc ? 'immédiat' : formatDateCourte(c.date_exacte)) : <span style={{ color: '#e0a685' }}>aucune</span>}</td>
                        <td style={{ ...styles.tdNum, color: ecartPromesse !== null && ecartPromesse > 0 ? '#e0a685' : undefined }}>{ecartPromesse === null ? '—' : `${ecartPromesse > 0 ? '+' : ''}${ecartPromesse} j`}</td>
                        <td style={{ ...styles.tdNum, color: ecartLivree !== null && ecartLivree < 0 && c.verdict !== 'OK' ? '#e0a685' : undefined }}>{ecartLivree === null ? '—' : `${ecartLivree > 0 ? '+' : ''}${ecartLivree} j`}</td>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap', color: '#e0a685' }}>{c.verdict === 'OK' ? '—' : formatDateCourte(c.date_rupture)}</td>
                        <td style={{ ...styles.td, minWidth: 220 }}>{c.nb_victimes > 0 ? <><div style={{ color: '#E0A961', fontFamily: 'var(--font-mono)' }}>{c.nb_victimes} CDC · {formatNumber(c.q_victimes)} p.</div><div style={styles.tdSub}>{c.victimes}{c.nb_victimes > 5 ? ' …' : ''}</div></> : '—'}</td>
                      </tr>
                    )
                  })}
                  {cdcFiltrees.length === 0 && <tr><td colSpan={16} style={{ ...styles.td, textAlign: 'center' }}><span style={styles.muted}>Aucune commande pour ce filtre.</span></td></tr>}
                </tbody>
              </table>
            </div>
            {cdcFiltrees.length > 500 && <div style={{ ...styles.muted, marginTop: 6 }}>500 premières lignes affichées — l'export Excel contient tout.</div>}
            <div style={{ ...styles.muted, marginTop: 8 }}>
              Solde à la date promise = stock de fin de journée de saisie + réceptions jusqu'à cette date − promesses plus anciennes dues d'ici là (hors la commande elle-même). Dispo réelle = plus bas niveau de ce solde à partir de la date promise : c'est ce qu'on peut promettre sans léser personne. Intenable : solde &lt; quantité. Crée un retard : solde ≥ quantité mais dispo réelle &lt; quantité — « Rupture créée le » donne la date où une promesse plus lointaine se retrouve sans stock, « Promesses exposées » celles dues entre cette date et la date exacte. Livrée − exacte négatif : servie avant son tour.
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Courbe stock physique / projeté (réel + projection) ───────────────────
function ReconstructionChart({ serie, aujourdhui }: { serie: PointSerie[]; aujourdhui: string }) {
  const width = 1100
  const height = 340
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

  // Réel : jusqu'à aujourd'hui inclus. Projection : d'aujourd'hui (point de raccord) à la fin.
  const idxToday = Math.max(0, serie.reduce((acc, p, i) => (!p.futur ? i : acc), 0))
  const passe = serie.slice(0, idxToday + 1)
  const futur = serie.slice(idxToday)
  const chemin = (pts: PointSerie[], get: (p: PointSerie) => number) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.d)} ${y(get(p))}`).join(' ')

  function segments(test: (p: PointSerie) => boolean): Array<{ x1: number; x2: number }> {
    const out: Array<{ x1: number; x2: number }> = []
    let seg: { x1: number; x2: number } | null = null
    serie.forEach((p, i) => {
      if (test(p)) { const px = x(p.d); if (!seg) seg = { x1: px, x2: px }; seg.x2 = i + 1 < serie.length ? x(serie[i + 1].d) : px } else if (seg) { out.push(seg); seg = null }
    })
    if (seg) out.push(seg)
    return out
  }
  const negProjete = segments((p) => !p.futur && p.projete < 0)
  const ruptureFuture = segments((p) => p.futur && p.stock_phys < 0)

  const mois: Array<{ iso: string; label: string }> = []
  { const d = new Date(`${debut}T00:00:00`); d.setDate(1); d.setMonth(d.getMonth() + 1); while (toIsoDate(d) <= fin) { mois.push({ iso: toIsoDate(d), label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) }); d.setMonth(d.getMonth() + 1) } }
  const pasMois = mois.length > 14 ? 2 : 1
  const range = maxVal - minVal || 1
  const ticks = [minVal, minVal + range / 4, minVal + range / 2, minVal + (range * 3) / 4, maxVal]
  const xToday = x(serie[idxToday].d)

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
        {mois.map((m, i) => (
          <g key={m.iso}>
            <line x1={x(m.iso)} y1={padding.top} x2={x(m.iso)} y2={padding.top + innerH} stroke="rgba(255,255,255,0.06)" />
            {i % pasMois === 0 && <text x={x(m.iso)} y={height - 12} fontSize={10} textAnchor="middle" fill="rgba(255,255,255,0.45)">{m.label}</text>}
          </g>
        ))}
        {/* Fond de la zone de projection */}
        <rect x={xToday} y={padding.top} width={Math.max(0, width - padding.right - xToday)} height={innerH} fill="rgba(143,199,218,0.04)" />
        {negProjete.map((s, i) => <rect key={`n${i}`} x={s.x1} y={padding.top} width={Math.max(0, s.x2 - s.x1)} height={innerH} fill="rgba(193,104,60,0.12)" />)}
        {ruptureFuture.map((s, i) => <rect key={`r${i}`} x={s.x1} y={padding.top} width={Math.max(0, s.x2 - s.x1)} height={innerH} fill="rgba(200,60,60,0.20)" />)}
        <line x1={padding.left} y1={yZero} x2={width - padding.right} y2={yZero} stroke="#C1683C" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.8} />
        <text x={padding.left + 4} y={yZero - 4} fontSize={10} textAnchor="start" fill="#e0a685">zéro</text>
        {/* Aujourd'hui */}
        <line x1={xToday} y1={padding.top} x2={xToday} y2={padding.top + innerH} stroke="#F5F3EC" strokeWidth={1.2} opacity={0.7} />
        <text x={xToday + 5} y={padding.top + 10} fontSize={10} fill="#F5F3EC">aujourd'hui → projection du portefeuille</text>
        {/* Réel */}
        <path d={chemin(passe, (p) => p.stock_phys)} fill="none" stroke="#E9E5D6" strokeWidth={1.6} opacity={0.85} />
        <path d={chemin(passe, (p) => p.projete)} fill="none" stroke="#8FC7DA" strokeWidth={2.4} strokeLinejoin="round" />
        {/* Projection */}
        {futur.length > 1 && <path d={chemin(futur, (p) => p.stock_phys)} fill="none" stroke="#E9E5D6" strokeWidth={1.8} strokeDasharray="5 4" opacity={0.95} />}
        {futur.length > 1 && <path d={chemin(futur, (p) => p.projete)} fill="none" stroke="#8FC7DA" strokeWidth={2} strokeDasharray="5 4" opacity={0.8} />}
        {serie.filter((p) => p.rec > 0).map((p) => <circle key={p.d} cx={x(p.d)} cy={y(p.stock_phys)} r={4} fill={p.futur ? '#101A2E' : '#8FC7DA'} stroke={p.futur ? '#8FC7DA' : '#101A2E'} strokeWidth={1.5} />)}
        {hp && <line x1={hpX} y1={padding.top} x2={hpX} y2={padding.top + innerH} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
      </svg>
      {hp && (
        <div style={{ ...styles.tooltip, left: `${Math.min(88, Math.max(6, (hpX / width) * 100))}%` }}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{formatDateFr(hp.d)} <span style={styles.tdSub}>{hp.futur ? '· projection' : hp.d === aujourdhui ? '· aujourd\'hui' : '· réel'}</span></div>
          <div>Stock physique{hp.futur ? ' projeté' : ''} : <strong style={{ color: hp.stock_phys < 0 ? '#e0a685' : '#E9E5D6' }}>{formatNumber(hp.stock_phys)}</strong></div>
          <div>{hp.futur ? 'Promesses restant à livrer' : 'Promesses ouvertes'} : <strong style={{ color: '#E0A961' }}>{formatNumber(hp.promesses)}</strong></div>
          <div>Stock projeté : <strong style={{ color: couleurSigne(hp.projete) }}>{formatNumber(hp.projete)}</strong></div>
          {(hp.rec > 0 || hp.sor > 0) && <div style={styles.tdSub}>{hp.rec > 0 ? `${hp.futur ? 'réception attendue' : 'réception'} +${formatNumber(hp.rec)}` : ''}{hp.rec > 0 && hp.sor > 0 ? ' · ' : ''}{hp.sor > 0 ? `${hp.futur ? 'CDC à livrer' : 'sorties'} −${formatNumber(hp.sor)}` : ''}</div>}
        </div>
      )}
      <div style={styles.legend}>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#E9E5D6' }} />Stock physique (reconstruit, puis projeté en pointillés)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#8FC7DA' }} />Stock projeté (physique − promesses ouvertes)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: '#101A2E', border: '1.5px solid #8FC7DA', boxSizing: 'border-box' }} />Réception attendue (CDF SAGE)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'rgba(193,104,60,0.5)' }} />Stock projeté négatif</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'rgba(200,60,60,0.6)' }} />Rupture physique à venir</span>
      </div>
    </div>
  )
}

// ── Petits composants ─────────────────────────────────────────────────────
function Kpi({ label, value, color, sub, big }: { label: string; value: string; color?: string; sub?: string; big?: boolean }) {
  return (
    <div style={{ ...styles.kpi, ...(big ? styles.kpiBig : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, color: color || '#fff' }}>{value}</div>
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
  verdictTag: { display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700 },
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
