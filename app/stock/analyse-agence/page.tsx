'use client'

/**
 * Écran « Analyse stock agence » (menu Stocks & logistique, /stock/analyse-agence?depot=1).
 * ---------------------------------------------------------------------------
 * Créé le 06/10/2026. Analyse le stock d'un dépôt (agence, ou FMS) à partir des ventes
 * au départ de ce dépôt (lignes BL facturées + BL non facturés portant le dépôt).
 *
 *  - indicateurs : valeur du stock, sur-stock (au-delà du MAX), stock à ne plus porter,
 *    références à stocker absentes du dépôt, sous le MIN ;
 *  - matrice ABC (CA 12 mois du dépôt) × XYZ (régularité mensuelle), cliquable ;
 *  - liste filtrable / triable : stock réel / préparé / dispo / réservé / transit,
 *    dispo FMS, fournisseur principal, MYSTOCK, dernier mouvement, fréquence de vente,
 *    μ / pic hebdomadaire, couverture, décision, MIN / MAX proposés ;
 *  - fenêtre article : ventes mensuelles depuis janvier 2025, semaines (pics et MIN),
 *    clients, dernières sorties, commandes clients en cours (mode d'expédition),
 *    commandes fournisseurs livrées au dépôt, stock par dépôt ; décision forcée et
 *    MIN / MAX retenus enregistrables.
 *
 * Sources : RPC get_stock_agence_analyse, get_stock_agence_article ;
 * tables stock_agence_depots, stock_agence_parametres, stock_agence_article_choix.
 * Migration requise : supabase/sql/20261006_stock_agence_analyse.sql.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Decision = 'STOCKER' | 'SURVEILLER' | 'NE_PAS_STOCKER' | 'NE_PLUS_STOCKER'
type Statut = 'A_STOCKER_SANS_STOCK' | 'SOUS_MIN' | 'SUR_STOCK' | 'OK' | 'SURVEILLER' | 'A_DESTOCKER' | 'HORS_STOCK'

type Ligne = {
  ref: string; designation: string | null; famille: string | null; famille_macro: string | null
  fournisseur: string | null; mystock: boolean; sommeil: boolean; blocage: boolean; exclu: boolean; vie_produit: string | null
  qte: number; prepa: number; dispo: number; res: number; cde: number; aterme: number; transit: number
  valeur: number; pu: number | null; sage_min: number | null; sage_max: number | null; emplacement: string | null
  fms_dispo: number | null; fms_res: number | null
  q_depuis: number; ca_depuis: number; q12: number; ca12: number; marge12: number
  q_per: number; nb_sem: number; nb_bl: number; nb_clients: number
  mu_sem: number; sigma_sem: number; pic_sem: number; p90_sem: number; plafond_pic: number | null; nb_pics: number; cv: number | null
  derniere_sortie: string | null; derniere_reception: string | null; dernier_mvt: string | null
  encours_cdf: number; cdc_7j: number; cdc_total: number
  abc: 'A' | 'B' | 'C' | 'N'; xyz: 'X' | 'Y' | 'Z' | 'N'; l_jours: number; r_jours: number
  decision_calc: Decision; hors_appro: boolean; decision: Decision
  min_calc: number; max_calc: number; smin: number; smax: number; couv_sem: number | null; nb_sem_sup_min: number | null
  statut: Statut
  excedent_qte: number; excedent_valeur: number; manque_qte: number; manque_valeur: number
  decision_forcee: 'STOCKER' | 'NE_PAS_STOCKER' | null; min_retenu: number | null; max_retenu: number | null
  commentaire: string | null; maj_par: string | null; maj_le: string | null
}
type Meta = {
  depot_num: string; depot: string; nom: string; central: boolean; depuis: string
  semaines_debut: string; semaines_fin: string; nb_semaines: number; mois_debut: string; mois_fin: string
  calcule_le: string; stock_charge_le: string | null
}
type Analyse = { meta: Meta; parametres: Record<string, number>; rows: Ligne[] }
type Depot = { depot_num: string; libelle: string; nom_court: string; central: boolean; ordre: number | null }
type Parametre = { cle: string; valeur: number; description: string | null }

type DetailArticle = {
  mois: { mois: string; qte: number; ca: number; nb_bl: number; nb_clients: number }[]
  semaines: { semaine: string; qte: number; nb_bl: number }[]
  clients: { numero_tiers: string | null; intitule: string | null; qte: number; ca: number; nb_bl: number; derniere: string | null }[]
  lignes: { d: string; bl: string | null; numero_tiers: string | null; intitule: string | null; qte: number; ca: number }[]
  cdc: { numero_piece: string; type_document: string | null; date_piece: string | null; date_livraison: string | null; numero_tiers: string | null; intitule: string | null; qte: number; expedition: string | null; collaborateur: string | null }[]
  cdf: { cdf_reference: string; cdf_order_date: string | null; cdf_lien_blg: string | null; nom_fournisseur: string | null; quantite_commandee: number | null; quantite_livree: number | null; quantite_ral: number | null; date_livraison_demandee: string | null; date_livraison: string | null }[]
  stocks: { depot_num: string; depot: string; qte: number; prepa: number; dispo: number; res: number; cde: number; aterme: number; sage_min: number | null; sage_max: number | null }[]
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const n0 = (v: number | null | undefined) => Number(v ?? 0)
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtEuro(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function fmtMoisCourt(v: string): string {
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`)
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}
function moisDepuis(v: string | null | undefined): number | null {
  if (!v) return null
  const d = new Date(`${String(v).slice(0, 10)}T12:00:00`)
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth()
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
function normaliser(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
}

const DECISION_STYLE: Record<Decision, { label: string; cls: string }> = {
  STOCKER: { label: 'À stocker', cls: 'bg-emerald-50 text-emerald-700' },
  SURVEILLER: { label: 'À surveiller', cls: 'bg-sky-50 text-sky-700' },
  NE_PAS_STOCKER: { label: 'Ne pas stocker', cls: 'bg-[#F4F3F0] text-[#8A8474]' },
  NE_PLUS_STOCKER: { label: 'Ne plus stocker', cls: 'bg-red-50 text-red-700' },
}
const STATUT_STYLE: Record<Statut, { label: string; cls: string; ordre: number }> = {
  A_STOCKER_SANS_STOCK: { label: 'À stocker — sans stock', cls: 'bg-red-600 text-white', ordre: 1 },
  SOUS_MIN: { label: 'Sous le MIN', cls: 'bg-orange-100 text-orange-800', ordre: 2 },
  SUR_STOCK: { label: 'Sur-stock', cls: 'bg-[#B4761A]/[0.15] text-[#8A5A08]', ordre: 3 },
  A_DESTOCKER: { label: 'À déstocker', cls: 'bg-red-50 text-red-700', ordre: 4 },
  SURVEILLER: { label: 'À surveiller', cls: 'bg-sky-50 text-sky-700', ordre: 5 },
  OK: { label: 'OK', cls: 'bg-emerald-50 text-emerald-700', ordre: 6 },
  HORS_STOCK: { label: 'Hors stock', cls: 'bg-[#F4F3F0] text-[#8A8474]', ordre: 7 },
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone, onClick, actif, title }: {
  label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok'; onClick?: () => void; actif?: boolean; title?: string
}) {
  const color = tone === 'alerte' ? '#B42318' : tone === 'warn' ? '#B4761A' : tone === 'ok' ? '#3F9142' : '#111820'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
      className={`min-w-0 rounded-xl border px-3 py-2 text-left ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.08]' : 'border-[#E5E1D8] bg-white'} ${onClick ? 'hover:border-[#B4761A]' : ''}`}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </Tag>
  )
}

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${cls}`}>{children}</span>
}

// ─────────────────────────────────────────────────────────────────────────
// Matrice ABC × XYZ
// ─────────────────────────────────────────────────────────────────────────

function MatriceAbcXyz({ rows, filtre, onFiltre }: { rows: Ligne[]; filtre: string | null; onFiltre: (c: string | null) => void }) {
  const cellules = useMemo(() => {
    const m = new Map<string, { refs: number; enStock: number; valeur: number; ca: number; sansStock: number; excedent: number }>()
    rows.forEach((r) => {
      const k = `${r.abc}${r.xyz}`
      const c = m.get(k) || { refs: 0, enStock: 0, valeur: 0, ca: 0, sansStock: 0, excedent: 0 }
      c.refs += 1; c.ca += n0(r.ca12); c.excedent += n0(r.excedent_valeur)
      if (r.qte > 0) { c.enStock += 1; c.valeur += n0(r.valeur) }
      if (r.statut === 'A_STOCKER_SANS_STOCK') c.sansStock += 1
      m.set(k, c)
    })
    return m
  }, [rows])
  const lignesAbc: ('A' | 'B' | 'C' | 'N')[] = ['A', 'B', 'C', 'N']
  const colsXyz: ('X' | 'Y' | 'Z' | 'N')[] = ['X', 'Y', 'Z', 'N']
  const libAbc: Record<string, string> = { A: 'A · 80 % du CA', B: 'B · 15 %', C: 'C · 5 %', N: 'Sans vente 12 m' }
  const libXyz: Record<string, string> = { X: 'X · régulier', Y: 'Y · variable', Z: 'Z · erratique', N: '—' }
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Matrice ABC (CA 12 mois du dépôt) × XYZ (régularité mensuelle)</div>
        {filtre && <button type="button" onClick={() => onFiltre(null)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline">✕ filtre {filtre}</button>}
      </div>
      <table className="w-full table-fixed text-[11.5px]">
        <thead>
          <tr className="text-[10px] uppercase text-[#8A8474]">
            <th className="w-[120px] px-1 py-1 text-left" />
            {colsXyz.map((x) => <th key={x} className="px-1 py-1 text-left font-bold">{libXyz[x]}</th>)}
          </tr>
        </thead>
        <tbody>
          {lignesAbc.map((a) => (
            <tr key={a}>
              <td className="px-1 py-1 text-[10.5px] font-bold text-[#3A362E]">{libAbc[a]}</td>
              {colsXyz.map((x) => {
                const k = `${a}${x}`
                const c = cellules.get(k)
                if (!c) return <td key={k} className="px-1 py-1"><div className="h-[54px] rounded-lg bg-[#FAF8F3]" /></td>
                const actif = filtre === k
                const fond = a === 'N' ? 'bg-[#F4F3F0]' : a === 'A' ? (x === 'X' ? 'bg-emerald-50' : x === 'Y' ? 'bg-emerald-50/60' : 'bg-amber-50') : a === 'B' ? 'bg-sky-50/70' : 'bg-[#FAF8F3]'
                return (
                  <td key={k} className="px-1 py-1">
                    <button type="button" onClick={() => onFiltre(actif ? null : k)}
                      className={`block h-[54px] w-full rounded-lg border px-2 py-1 text-left ${fond} ${actif ? 'border-[#B4761A] ring-2 ring-[#B4761A]/30' : 'border-transparent hover:border-[#B4761A]/60'}`}>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-[14px] font-bold text-[#111820]">{fmtNum(c.refs)}</span>
                        <span className="truncate text-[10.5px] text-[#5E5A50]">{fmtEuro(c.valeur)}</span>
                      </div>
                      <div className="flex justify-between gap-1 text-[10px] text-[#8A8474]">
                        <span>{fmtNum(c.enStock)} en stock</span>
                        {c.sansStock > 0 && <span className="font-bold text-red-700">{c.sansStock} manquant{c.sansStock > 1 ? 's' : ''}</span>}
                        {c.sansStock === 0 && c.excedent > 0 && <span className="font-bold text-[#8A5A08]">+{fmtEuro(c.excedent)}</span>}
                      </div>
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre article
// ─────────────────────────────────────────────────────────────────────────

function ArticleModal({ depotNum, depuis, ligne, position, onPrev, onNext, onClose, onSaved }: {
  depotNum: string; depuis: string; ligne: Ligne; position: string | null
  onPrev?: () => void; onNext?: () => void; onClose: () => void; onSaved: () => Promise<void>
}) {
  const [detail, setDetail] = useState<DetailArticle | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<'mois' | 'semaines'>('semaines')
  const [decision, setDecision] = useState<'' | 'STOCKER' | 'NE_PAS_STOCKER'>(ligne.decision_forcee ?? '')
  const [minR, setMinR] = useState(ligne.min_retenu === null ? '' : String(ligne.min_retenu))
  const [maxR, setMaxR] = useState(ligne.max_retenu === null ? '' : String(ligne.max_retenu))
  const [comm, setComm] = useState(ligne.commentaire ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let annule = false
    setDetail(null); setErreur(null); setMsg(null)
    setDecision(ligne.decision_forcee ?? ''); setMinR(ligne.min_retenu === null ? '' : String(ligne.min_retenu))
    setMaxR(ligne.max_retenu === null ? '' : String(ligne.max_retenu)); setComm(ligne.commentaire ?? '')
    void supabase.rpc('get_stock_agence_article', { p_depot_num: depotNum, p_ref: ligne.ref, p_depuis: depuis }).then(({ data, error }) => {
      if (annule) return
      if (error) setErreur(messageErreur(error))
      else setDetail(data as DetailArticle)
    })
    return () => { annule = true }
  }, [depotNum, depuis, ligne])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const saisie = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
      if (e.key === 'Escape') onClose()
      else if (!saisie && e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev() }
      else if (!saisie && e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  async function enregistrer(effacer = false) {
    setSaving(true); setMsg(null)
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
      if (effacer || (!decision && minR.trim() === '' && maxR.trim() === '' && comm.trim() === '')) {
        const { error } = await supabase.from('stock_agence_article_choix').delete().eq('depot_num', depotNum).eq('reference_article', ligne.ref)
        if (error) throw error
      } else {
        const { data: u } = await supabase.auth.getUser()
        const { error } = await supabase.from('stock_agence_article_choix').upsert({
          depot_num: depotNum, reference_article: ligne.ref, decision_forcee: decision || null,
          min_retenu: num(minR), max_retenu: num(maxR), commentaire: comm.trim() || null,
          maj_par: u.user?.email ?? null, maj_le: new Date().toISOString(),
        }, { onConflict: 'depot_num,reference_article' })
        if (error) throw error
      }
      await onSaved()
      setMsg('Enregistré — liste recalculée.')
    } catch (e) { setMsg('Erreur : ' + messageErreur(e)) } finally { setSaving(false) }
  }

  const minAffiche = ligne.decision === 'STOCKER' ? ligne.smin : null
  const serieSem = (detail?.semaines || []).map((s) => {
    const pic = ligne.plafond_pic !== null && s.qte > n0(ligne.plafond_pic)
    return { ...s, label: fmtDate(s.semaine).slice(0, 5), normal: pic ? null : s.qte, pic: pic ? s.qte : null }
  })
  const serieMois = (detail?.mois || []).map((m) => ({ ...m, label: fmtMoisCourt(m.mois) }))
  const expeditions = useMemo(() => {
    const m = new Map<string, number>()
    ;(detail?.cdc || []).forEach((c) => m.set(c.expedition || '—', (m.get(c.expedition || '—') || 0) + n0(c.qte)))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [detail])

  const inp = 'h-8 w-full rounded-lg border border-[#E5E1D8] bg-white px-2 text-[12.5px] outline-none focus:border-[#B4761A]'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E1D8] px-5 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-bold text-[#111820]">{ligne.ref}</span>
              {ligne.mystock && <Badge cls="bg-emerald-50 text-emerald-700">MYSTOCK</Badge>}
              {ligne.blocage && <Badge cls="bg-red-600 text-white">⛔ Blocage appro</Badge>}
              {ligne.sommeil && <Badge cls="bg-[#F4F3F0] text-[#8A8474]">Sommeil</Badge>}
              {ligne.vie_produit && <Badge cls="bg-orange-100 text-orange-700">{ligne.vie_produit}</Badge>}
              <Badge cls={DECISION_STYLE[ligne.decision].cls}>{DECISION_STYLE[ligne.decision].label}{ligne.decision_forcee ? ' (forcé)' : ''}</Badge>
              <Badge cls={STATUT_STYLE[ligne.statut].cls}>{STATUT_STYLE[ligne.statut].label}</Badge>
              <Badge cls="bg-[#111820] text-white">{ligne.abc}{ligne.xyz}</Badge>
            </div>
            <div className="truncate text-[16px] font-bold text-[#111820]">{ligne.designation || '—'}</div>
            <div className="text-[12px] text-[#8A8474]">
              Fournisseur {ligne.fournisseur || '—'} · {ligne.famille || 'famille —'}{ligne.famille_macro ? ` (${ligne.famille_macro})` : ''} · emplacement {ligne.emplacement || '—'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position && <span className="mr-1 text-[11px] text-[#8A8474]">{position}</span>}
            <button type="button" onClick={onPrev} disabled={!onPrev} title="Référence précédente (←)" className="h-8 w-8 rounded-lg border border-[#E5E1D8] font-bold hover:bg-[#F4F3F0] disabled:opacity-30">‹</button>
            <button type="button" onClick={onNext} disabled={!onNext} title="Référence suivante (→)" className="h-8 w-8 rounded-lg border border-[#E5E1D8] font-bold hover:bg-[#F4F3F0] disabled:opacity-30">›</button>
            <button type="button" onClick={onClose} className="ml-1 rounded-lg px-2 py-1 text-[13px] font-bold text-[#8A8474] hover:bg-[#F4F3F0]">✕</button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-5 py-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-3">
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              <Kpi label="Stock réel" value={fmtNum(ligne.qte)} sub={`${fmtEuro(ligne.valeur)}`} />
              <Kpi label="Dispo (réel − PL)" value={fmtNum(ligne.dispo)} sub={`réservé ${fmtNum(ligne.res)}`} tone={ligne.dispo <= 0 ? 'alerte' : undefined} />
              <Kpi label="μ / semaine" value={fmtNum(ligne.mu_sem, 1)} sub={`σ ${fmtNum(ligne.sigma_sem, 1)}`} />
              <Kpi label="Semaines vendues" value={`${fmtNum(ligne.nb_sem)} / 52`} sub={`${fmtNum(ligne.nb_bl)} BL · ${fmtNum(ligne.nb_clients)} clients`} />
              <Kpi label="Pic semaine" value={fmtNum(ligne.pic_sem)} sub={ligne.nb_pics ? `${ligne.nb_pics} pic(s) écrêté(s) > ${fmtNum(ligne.plafond_pic, 0)}` : `P90 ${fmtNum(ligne.p90_sem, 1)}`} tone={ligne.nb_pics ? 'warn' : undefined} />
              <Kpi label="Couverture" value={ligne.couv_sem === null ? '—' : `${fmtNum(ligne.couv_sem, 1)} sem.`} sub={`dispo FMS ${fmtNum(ligne.fms_dispo)}`} />
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <div className="flex gap-1">
                  {(['semaines', 'mois'] as const).map((o) => (
                    <button key={o} type="button" onClick={() => setOnglet(o)}
                      className={`rounded-md px-2.5 py-1 text-[11.5px] font-bold ${onglet === o ? 'bg-[#111820] text-white' : 'text-[#3A362E] hover:bg-[#F4F3F0]'}`}>
                      {o === 'semaines' ? `Semaines (${ligne.nb_pics ? 'pics en orange, ' : ''}MIN en rouge)` : `Mois depuis ${fmtMoisCourt(depuis)}`}
                    </button>
                  ))}
                </div>
                <span className="text-[10.5px] text-[#8A8474]">Sorties au départ du dépôt (retours déduits)</span>
              </div>
              <div className="h-[250px]">
                {erreur ? <div className="p-6 text-[12px] text-red-700">Détail indisponible : {erreur}</div> : !detail ? <div className="h-full animate-pulse rounded-lg bg-[#F4F3F0]" /> : onglet === 'semaines' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={serieSem} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barCategoryGap="12%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#EDEAE1" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: '#8A8474' }} tickLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 10.5, fill: '#8A8474' }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip formatter={(v) => fmtNum(Number(v))} labelFormatter={(l) => `Semaine du ${String(l)}`} />
                      <Bar dataKey="normal" name="Sorties" stackId="s" fill="#3A362E" isAnimationActive={false} />
                      <Bar dataKey="pic" name="Pic exceptionnel" stackId="s" fill="#C1683C" isAnimationActive={false} />
                      <ReferenceLine y={ligne.mu_sem} stroke="#7A5EA8" strokeDasharray="4 3" label={{ value: `μ ${fmtNum(ligne.mu_sem, 1)}`, position: 'insideTopLeft', fontSize: 10, fill: '#7A5EA8' }} />
                      {minAffiche !== null && minAffiche > 0 && <ReferenceLine y={minAffiche} stroke="#B42318" strokeWidth={1.5} label={{ value: `MIN ${fmtNum(minAffiche)}`, position: 'insideTopRight', fontSize: 10.5, fontWeight: 700, fill: '#B42318' }} />}
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={serieMois} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#EDEAE1" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8A8474' }} tickLine={false} interval={0} />
                      <YAxis yAxisId="q" tick={{ fontSize: 10.5, fill: '#8A8474' }} tickLine={false} axisLine={false} width={40} />
                      <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 10, fill: '#B4761A' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `${fmtNum(v / 1000)} k€`} />
                      <Tooltip formatter={(v, n) => (n === 'CA HT' ? fmtEuro(Number(v)) : fmtNum(Number(v)))} />
                      <Bar yAxisId="q" dataKey="qte" name="Quantité" fill="#3A362E" isAnimationActive={false} />
                      <Line yAxisId="c" dataKey="ca" name="CA HT" stroke="#B4761A" dot={false} strokeWidth={2} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#E5E1D8]">
                <div className="border-b border-[#E5E1D8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Clients — 52 semaines</div>
                <div className="max-h-[220px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.clients || []).map((c, i) => (
                        <tr key={i} className="border-t border-[#F4F3F0]">
                          <td className="px-2 py-1"><span className="font-mono text-[10.5px] text-[#8A8474]">{c.numero_tiers}</span> {c.intitule}</td>
                          <td className="px-2 py-1 text-right font-bold">{fmtNum(c.qte)}</td>
                          <td className="px-2 py-1 text-right text-[#8A8474]">{fmtNum(c.nb_bl)} BL</td>
                          <td className="px-2 py-1 text-right text-[#8A8474]">{fmtDate(c.derniere)}</td>
                        </tr>
                      ))}
                      {detail && detail.clients.length === 0 && <tr><td className="px-2 py-3 text-center text-[#8A8474]">Aucune vente sur la période.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-xl border border-[#E5E1D8]">
                <div className="border-b border-[#E5E1D8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Dernières sorties du dépôt</div>
                <div className="max-h-[220px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.lignes || []).map((l, i) => (
                        <tr key={i} className="border-t border-[#F4F3F0]">
                          <td className="whitespace-nowrap px-2 py-1 text-[#5E5A50]">{fmtDate(l.d)}</td>
                          <td className="px-2 py-1 font-mono text-[10.5px] text-[#8A8474]">{l.bl}</td>
                          <td className="max-w-[160px] truncate px-2 py-1">{l.intitule || l.numero_tiers}</td>
                          <td className={`px-2 py-1 text-right font-bold ${l.qte < 0 ? 'text-red-700' : ''}`}>{fmtNum(l.qte)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-xl border border-[#E5E1D8]">
                <div className="flex items-center justify-between border-b border-[#E5E1D8] px-3 py-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Commandes clients en cours (dépôt)</span>
                  <span className="text-[10.5px] text-[#8A8474]">{expeditions.slice(0, 3).map(([e, q]) => `${e} ${fmtNum(q)}`).join(' · ')}</span>
                </div>
                <div className="max-h-[200px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.cdc || []).map((c, i) => (
                        <tr key={i} className="border-t border-[#F4F3F0]">
                          <td className="whitespace-nowrap px-2 py-1">{fmtDate(c.date_livraison)}</td>
                          <td className="px-2 py-1 font-mono text-[10.5px] text-[#8A8474]" title={c.type_document || ''}>{c.numero_piece}</td>
                          <td className="max-w-[140px] truncate px-2 py-1">{c.intitule}</td>
                          <td className="px-2 py-1 text-[10.5px] text-[#5E5A50]">{c.expedition || '—'}</td>
                          <td className="px-2 py-1 text-right font-bold">{fmtNum(c.qte)}</td>
                        </tr>
                      ))}
                      {detail && detail.cdc.length === 0 && <tr><td className="px-2 py-3 text-center text-[#8A8474]">Aucune commande en cours.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-xl border border-[#E5E1D8]">
                <div className="border-b border-[#E5E1D8] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Commandes fournisseurs livrées au dépôt (BLG)</div>
                <div className="max-h-[200px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.cdf || []).map((c, i) => (
                        <tr key={i} className="border-t border-[#F4F3F0]">
                          <td className="whitespace-nowrap px-2 py-1">{fmtDate(c.cdf_order_date)}</td>
                          <td className="px-2 py-1 font-mono text-[10.5px]">{c.cdf_lien_blg ? <a href={c.cdf_lien_blg} target="_blank" rel="noopener noreferrer" className="text-[#B4761A] hover:underline">{c.cdf_reference}</a> : c.cdf_reference}</td>
                          <td className="max-w-[120px] truncate px-2 py-1">{c.nom_fournisseur}</td>
                          <td className="px-2 py-1 text-right">{fmtNum(c.quantite_livree)} / {fmtNum(c.quantite_commandee)}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right text-[#8A8474]">{fmtDate(c.date_livraison)}</td>
                        </tr>
                      ))}
                      {detail && detail.cdf.length === 0 && <tr><td className="px-2 py-3 text-center text-[#8A8474]">Aucune commande fournisseur livrée à ce dépôt.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border-2 border-[#B4761A]/40 bg-[#B4761A]/[0.04] p-3 text-[12px]">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#96600F]">Proposition</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-[#8A8474]">Décision calculée</span><span className="text-right font-semibold">{DECISION_STYLE[ligne.decision_calc].label}</span>
                <span className="text-[#8A8474]">Délai couvert L</span><span className="text-right font-semibold">{fmtNum(ligne.l_jours, 1)} j{ligne.mystock ? ' (MYSTOCK)' : ''}</span>
                <span className="text-[#8A8474]">Cycle de réappro R</span><span className="text-right font-semibold">{fmtNum(ligne.r_jours, 1)} j</span>
                <span className="text-[#8A8474]">MIN / MAX calculés</span><span className="text-right font-semibold">{fmtNum(ligne.min_calc)} / {fmtNum(ligne.max_calc)}</span>
                <span className="text-[#8A8474]">MIN / MAX retenus</span><span className="text-right font-bold text-[#111820]">{fmtNum(ligne.smin)} / {fmtNum(ligne.smax)}</span>
                <span className="text-[#8A8474]">MIN / MAX SAGE</span><span className="text-right">{fmtNum(ligne.sage_min)} / {fmtNum(ligne.sage_max)}</span>
                {ligne.nb_sem_sup_min !== null && <><span className="text-[#8A8474]">Semaines &gt; MIN</span><span className="text-right">{fmtNum(ligne.nb_sem_sup_min)} / 52</span></>}
                <span className="text-[#8A8474]">Excédent</span><span className="text-right font-semibold text-[#8A5A08]">{fmtNum(ligne.excedent_qte)} · {fmtEuro(ligne.excedent_valeur)}</span>
                <span className="text-[#8A8474]">À approvisionner</span><span className="text-right font-semibold text-red-700">{fmtNum(ligne.manque_qte)} · {fmtEuro(ligne.manque_valeur)}</span>
              </div>
              <div className="mt-2 rounded-lg bg-white p-2 font-mono text-[10.5px] leading-relaxed text-[#3A362E]">
                MIN = ⌈μ × L/7 + z × σ × √(L/7)⌉ = ⌈{fmtNum(ligne.mu_sem, 2)} × {fmtNum(ligne.l_jours / 7, 2)} + z × {fmtNum(ligne.sigma_sem, 2)} × √{fmtNum(ligne.l_jours / 7, 2)}⌉<br />
                MAX = MIN + ⌈μ × R/7⌉ (au moins MIN + 1)
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-3 text-[12px]">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Décision du dépôt</div>
              <label className="mb-2 flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">Décision</span>
                <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} className={inp}>
                  <option value="">Calculée ({DECISION_STYLE[ligne.decision_calc].label})</option>
                  <option value="STOCKER">Forcer : stocker</option>
                  <option value="NE_PAS_STOCKER">Forcer : ne pas stocker</option>
                </select></label>
              <div className="mb-2 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">MIN retenu</span><input value={minR} onChange={(e) => setMinR(e.target.value)} placeholder={`calc. ${fmtNum(ligne.min_calc)}`} className={inp} /></label>
                <label className="flex flex-col gap-0.5"><span className="font-semibold text-[#3A362E]">MAX retenu</span><input value={maxR} onChange={(e) => setMaxR(e.target.value)} placeholder={`calc. ${fmtNum(ligne.max_calc)}`} className={inp} /></label>
              </div>
              <textarea value={comm} onChange={(e) => setComm(e.target.value)} rows={2} placeholder="Commentaire…" className="w-full rounded-lg border border-[#E5E1D8] px-2 py-1 text-[12px]" />
              {ligne.maj_le && <div className="mt-1 text-[10.5px] text-[#8A8474]">Saisi par {ligne.maj_par || '—'} le {fmtDate(ligne.maj_le)}</div>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <button type="button" disabled={saving || (!ligne.decision_forcee && ligne.min_retenu === null && ligne.max_retenu === null && !ligne.commentaire)} onClick={() => void enregistrer(true)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline disabled:opacity-40">↺ Revenir au calcul</button>
                <button type="button" disabled={saving} onClick={() => void enregistrer()} className="h-8 rounded-lg bg-[#111820] px-3 text-[12px] font-bold text-white disabled:opacity-50">{saving ? '…' : 'Enregistrer'}</button>
              </div>
              {msg && <div className={`mt-1 text-[11.5px] ${msg.startsWith('Erreur') ? 'text-red-700' : 'text-emerald-700'}`}>{msg}</div>}
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-3 text-[12px]">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Stock par dépôt</div>
              <table className="w-full text-[11.5px]">
                <thead className="text-[10px] uppercase text-[#8A8474]"><tr><th className="text-left">Dépôt</th><th className="text-right">Réel</th><th className="text-right">Dispo</th><th className="text-right">Rés.</th><th className="text-right">Cdé</th></tr></thead>
                <tbody>
                  {(detail?.stocks || []).map((s) => (
                    <tr key={s.depot_num} className={`border-t border-[#F4F3F0] ${s.depot_num === depotNum ? 'font-bold' : ''}`}>
                      <td className="truncate py-0.5">{s.depot.replace(' CEGECLIM', '')}</td>
                      <td className="text-right">{fmtNum(s.qte)}</td>
                      <td className="text-right">{fmtNum(s.dispo)}</td>
                      <td className="text-right">{fmtNum(s.res)}</td>
                      <td className="text-right">{fmtNum(s.cde)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-3 text-[12px]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-[#8A8474]">Dernière sortie</span><span className="text-right">{fmtDate(ligne.derniere_sortie)}</span>
                <span className="text-[#8A8474]">Dernière réception CDF</span><span className="text-right">{fmtDate(ligne.derniere_reception)}</span>
                <span className="text-[#8A8474]">Encours CDF au dépôt</span><span className="text-right">{fmtNum(ligne.encours_cdf)}</span>
                <span className="text-[#8A8474]">En transit</span><span className="text-right">{fmtNum(ligne.transit)}</span>
                <span className="text-[#8A8474]">CDC à livrer ≤ 7 j / total</span><span className="text-right">{fmtNum(ligne.cdc_7j)} / {fmtNum(ligne.cdc_total)}</span>
                <span className="text-[#8A8474]">Ventes depuis {fmtMoisCourt(depuis)}</span><span className="text-right">{fmtNum(ligne.q_depuis)} · {fmtEuro(ligne.ca_depuis)}</span>
                <span className="text-[#8A8474]">CA / marge 12 mois</span><span className="text-right">{fmtEuro(ligne.ca12)} / {fmtEuro(ligne.marge12)}</span>
                <span className="text-[#8A8474]">PU (CMUP)</span><span className="text-right">{ligne.pu === null ? '—' : ligne.pu.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

type CleTri = 'ref' | 'fournisseur' | 'abc' | 'valeur' | 'qte' | 'dispo' | 'res' | 'nb_sem' | 'mu_sem' | 'pic_sem' | 'couv_sem' | 'smin' | 'excedent_valeur' | 'manque_valeur' | 'dernier_mvt' | 'ca12' | 'statut'
type FiltreRapide = '' | 'SUR_STOCK' | 'A_DESTOCKER' | 'A_STOCKER_SANS_STOCK' | 'SOUS_MIN' | 'SURVEILLER' | 'DORMANT'

function AnalyseStockAgence() {
  const router = useRouter()
  const params = useSearchParams()
  const [depots, setDepots] = useState<Depot[]>([])
  const [depotNum, setDepotNum] = useState(params.get('depot') || '1')
  const [depuis] = useState('2025-01-01')
  const [analyse, setAnalyse] = useState<Analyse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [parametres, setParametres] = useState<Parametre[]>([])
  const [paramsDraft, setParamsDraft] = useState<Record<string, string>>({})
  const [voirParams, setVoirParams] = useState(false)

  const [search, setSearch] = useState('')
  const [rapide, setRapide] = useState<FiltreRapide>('')
  const [decisionF, setDecisionF] = useState<'' | Decision>('')
  const [mystockF, setMystockF] = useState<'tous' | 'oui' | 'non'>('tous')
  const [stockF, setStockF] = useState<'tous' | 'avec' | 'sans'>('tous')
  const [fournF, setFournF] = useState('')
  const [abcXyz, setAbcXyz] = useState<string | null>(null)
  const [tri, setTri] = useState<{ k: CleTri; dir: 1 | -1 }>({ k: 'valeur', dir: -1 })
  const [nbAffichees, setNbAffichees] = useState(300)
  const [refOuverte, setRefOuverte] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  useEffect(() => {
    void supabase.from('stock_agence_depots').select('*').order('ordre').then(({ data }) => setDepots((data || []) as Depot[]))
    void supabase.from('stock_agence_parametres').select('*').order('cle').then(({ data }) => {
      const p = (data || []) as Parametre[]
      setParametres(p); setParamsDraft(Object.fromEntries(p.map((x) => [x.cle, String(x.valeur)])))
    })
  }, [])

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_stock_agence_analyse', { p_depot_num: depotNum, p_depuis: depuis })
    if (error) setErreur(messageErreur(error))
    else setAnalyse(data as Analyse)
    setLoading(false)
  }, [depotNum, depuis])
  useEffect(() => { void charger() }, [charger])

  function changerDepot(n: string) {
    setDepotNum(n); setRefOuverte(null); setAbcXyz(null)
    router.replace(`/stock/analyse-agence?depot=${n}`)
  }

  async function enregistrerParams() {
    const rows = parametres.map((p) => ({ cle: p.cle, valeur: Number(String(paramsDraft[p.cle] ?? p.valeur).replace(',', '.')), description: p.description }))
    if (rows.some((r) => !Number.isFinite(r.valeur))) { setErreur('Paramètre non numérique.'); return }
    const { error } = await supabase.from('stock_agence_parametres').upsert(rows, { onConflict: 'cle' })
    if (error) { setErreur(messageErreur(error)); return }
    setParametres(rows); setVoirParams(false)
    await charger()
  }

  const rows = useMemo(() => analyse?.rows || [], [analyse])
  const fournisseurs = useMemo(() => Array.from(new Set(rows.map((r) => r.fournisseur).filter(Boolean) as string[])).sort(), [rows])

  const kpis = useMemo(() => {
    const k = { valeur: 0, refsStock: 0, surStock: 0, surStockRefs: 0, destocker: 0, destockerRefs: 0, manquants: 0, manquantsValeur: 0, sousMin: 0, sousMinValeur: 0, surveiller: 0, surveillerValeur: 0, dormant: 0, dormantRefs: 0, aStocker: 0, reserveSupStock: 0 }
    rows.forEach((r) => {
      if (r.qte > 0) { k.valeur += n0(r.valeur); k.refsStock += 1 }
      if (r.statut === 'SUR_STOCK') { k.surStock += n0(r.excedent_valeur); k.surStockRefs += 1 }
      if (r.statut === 'A_DESTOCKER') { k.destocker += n0(r.excedent_valeur); k.destockerRefs += 1 }
      if (r.statut === 'A_STOCKER_SANS_STOCK') { k.manquants += 1; k.manquantsValeur += n0(r.manque_valeur) }
      if (r.statut === 'SOUS_MIN') { k.sousMin += 1; k.sousMinValeur += n0(r.manque_valeur) }
      if (r.statut === 'SURVEILLER') { k.surveiller += 1; if (r.qte > 0) k.surveillerValeur += n0(r.valeur) }
      if (r.qte > 0 && r.q12 <= 0) { k.dormant += n0(r.valeur); k.dormantRefs += 1 }
      if (r.decision === 'STOCKER') k.aStocker += 1
      if (r.res > r.qte && r.qte >= 0) k.reserveSupStock += 1
    })
    return k
  }, [rows])

  const filtres = useMemo(() => {
    const t = normaliser(search.trim())
    const list = rows.filter((r) => {
      if (rapide === 'DORMANT' ? !(r.qte > 0 && r.q12 <= 0) : rapide && r.statut !== rapide) return false
      if (decisionF && r.decision !== decisionF) return false
      if (mystockF !== 'tous' && r.mystock !== (mystockF === 'oui')) return false
      if (stockF === 'avec' && !(r.qte > 0)) return false
      if (stockF === 'sans' && r.qte > 0) return false
      if (fournF && r.fournisseur !== fournF) return false
      if (abcXyz && `${r.abc}${r.xyz}` !== abcXyz) return false
      if (t && !normaliser(`${r.ref} ${r.designation} ${r.famille} ${r.fournisseur}`).includes(t)) return false
      return true
    })
    const val = (r: Ligne): number | string | null => {
      switch (tri.k) {
        case 'ref': return r.ref
        case 'fournisseur': return r.fournisseur
        case 'abc': return `${r.abc}${r.xyz}`
        case 'statut': return STATUT_STYLE[r.statut].ordre
        case 'dernier_mvt': return r.dernier_mvt
        default: return (r[tri.k] as number | null) ?? null
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === null || va === '') return 1
      if (vb === null || vb === '') return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })
      return c * tri.dir
    })
  }, [rows, search, rapide, decisionF, mystockF, stockF, fournF, abcXyz, tri])
  useEffect(() => { setNbAffichees(300) }, [filtres.length, tri])

  const totaux = useMemo(() => filtres.reduce((t, r) => {
    t.valeur += r.qte > 0 ? n0(r.valeur) : 0; t.excedent += n0(r.excedent_valeur); t.manque += n0(r.manque_valeur); t.ca += n0(r.ca12)
    return t
  }, { valeur: 0, excedent: 0, manque: 0, ca: 0 }), [filtres])

  const indexOuvert = refOuverte ? filtres.findIndex((r) => r.ref === refOuverte) : -1
  const ligneOuverte = refOuverte ? rows.find((r) => r.ref === refOuverte) : undefined

  function basculerTri(k: CleTri) {
    setTri((t) => (t.k === k ? { k, dir: t.dir === 1 ? -1 : 1 } : { k, dir: ['ref', 'fournisseur', 'abc', 'statut', 'couv_sem'].includes(k) ? 1 : -1 }))
  }
  function Th({ k, children, right, title }: { k: CleTri; children: React.ReactNode; right?: boolean; title?: string }) {
    const actif = tri.k === k
    return (
      <th title={title} onClick={() => basculerTri(k)} className={`cursor-pointer select-none whitespace-nowrap bg-[#F4F3F0] px-2 py-2 font-bold hover:bg-[#EDEAE1] ${right ? 'text-right' : 'text-left'} ${actif ? 'text-[#111820]' : ''}`}>
        {children}<span className={`ml-1 text-[10px] ${actif ? 'text-[#B4761A]' : 'text-[#C9C4B8]'}`}>{actif ? (tri.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  async function exporterExcel() {
    if (!analyse) return
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(`Stock ${analyse.meta.nom}`.slice(0, 31))
      const cols: { h: string; f: (r: Ligne) => unknown; w?: number }[] = [
        { h: 'Référence', f: (r) => r.ref, w: 18 }, { h: 'Désignation', f: (r) => r.designation, w: 40 },
        { h: 'Famille', f: (r) => r.famille }, { h: 'Famille macro', f: (r) => r.famille_macro }, { h: 'Fournisseur principal', f: (r) => r.fournisseur },
        { h: 'MYSTOCK', f: (r) => (r.mystock ? 'OUI' : 'NON') }, { h: 'Sommeil', f: (r) => (r.sommeil ? 'Oui' : '') }, { h: 'Blocage appro', f: (r) => (r.blocage ? 'Oui' : '') }, { h: 'Vie produit', f: (r) => r.vie_produit },
        { h: 'Classe', f: (r) => `${r.abc}${r.xyz}` },
        { h: 'Stock réel', f: (r) => r.qte }, { h: 'Préparé', f: (r) => r.prepa }, { h: 'Dispo', f: (r) => r.dispo }, { h: 'Réservé', f: (r) => r.res },
        { h: 'Commandé', f: (r) => r.cde }, { h: 'À terme', f: (r) => r.aterme }, { h: 'Transit', f: (r) => r.transit }, { h: 'Dispo FMS', f: (r) => r.fms_dispo },
        { h: 'Valeur stock', f: (r) => r.valeur }, { h: 'PU', f: (r) => r.pu },
        { h: `Qté vendue depuis ${fmtDate(depuis)}`, f: (r) => r.q_depuis }, { h: `CA depuis ${fmtDate(depuis)}`, f: (r) => r.ca_depuis },
        { h: 'Qté 12 mois', f: (r) => r.q12 }, { h: 'CA 12 mois', f: (r) => r.ca12 }, { h: 'Marge 12 mois', f: (r) => r.marge12 },
        { h: 'Semaines vendues /52', f: (r) => r.nb_sem }, { h: 'BL 52 sem.', f: (r) => r.nb_bl }, { h: 'Clients 52 sem.', f: (r) => r.nb_clients },
        { h: 'μ semaine', f: (r) => r.mu_sem }, { h: 'σ semaine', f: (r) => r.sigma_sem }, { h: 'Pic semaine', f: (r) => r.pic_sem }, { h: 'Pics écrêtés', f: (r) => r.nb_pics },
        { h: 'Couverture (sem.)', f: (r) => r.couv_sem },
        { h: 'Dernière sortie', f: (r) => fmtDate(r.derniere_sortie) }, { h: 'Dernière réception', f: (r) => fmtDate(r.derniere_reception) },
        { h: 'Délai L (j)', f: (r) => r.l_jours }, { h: 'Cycle R (j)', f: (r) => r.r_jours },
        { h: 'Décision calculée', f: (r) => DECISION_STYLE[r.decision_calc].label }, { h: 'Décision', f: (r) => DECISION_STYLE[r.decision].label }, { h: 'Statut', f: (r) => STATUT_STYLE[r.statut].label },
        { h: 'MIN calculé', f: (r) => r.min_calc }, { h: 'MAX calculé', f: (r) => r.max_calc }, { h: 'MIN retenu', f: (r) => r.smin }, { h: 'MAX retenu', f: (r) => r.smax },
        { h: 'MIN SAGE', f: (r) => r.sage_min }, { h: 'MAX SAGE', f: (r) => r.sage_max },
        { h: 'Excédent qté', f: (r) => r.excedent_qte }, { h: 'Excédent valeur', f: (r) => r.excedent_valeur },
        { h: 'À approvisionner qté', f: (r) => r.manque_qte }, { h: 'À approvisionner valeur', f: (r) => r.manque_valeur },
        { h: 'Commentaire', f: (r) => r.commentaire, w: 30 },
      ]
      ws.addRow(cols.map((c) => c.h)).font = { bold: true }
      filtres.forEach((r) => ws.addRow(cols.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v })))
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 13 })
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `analyse_stock_${analyse.meta.nom}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  const meta = analyse?.meta
  const pm = analyse?.parametres || {}
  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const nbFiltres = [search.trim(), rapide, decisionF, fournF, abcXyz].filter(Boolean).length + (mystockF !== 'tous' ? 1 : 0) + (stockF !== 'tous' ? 1 : 0)

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Analyse stock {meta ? (meta.central ? 'FMS' : `agence ${meta.nom}`) : 'agence'}</h1>
            {meta && (
              <p className="text-[11.5px] text-[#8A8474]">
                Ventes au départ du dépôt « {meta.depot} » · {meta.nb_semaines} semaines du {fmtDate(meta.semaines_debut)} au {fmtDate(meta.semaines_fin)} ·
                stock SAGE du {meta.stock_charge_le ? new Date(meta.stock_charge_le).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={depotNum} onChange={(e) => changerDepot(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold">
              {depots.length === 0 && <option value={depotNum}>Dépôt {depotNum}</option>}
              {depots.map((d) => <option key={d.depot_num} value={d.depot_num}>{d.central ? 'FMS (central)' : d.nom_court}</option>)}
            </select>
            <button type="button" onClick={() => setVoirParams((v) => !v)} className={`h-10 rounded-lg border px-3 text-[13px] font-bold ${voirParams ? 'border-[#B4761A] text-[#96600F]' : 'border-[#E5E1D8] text-[#3A362E] hover:bg-[#F4F3F0]'}`}>⚙ Paramètres</button>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : `⬇ Excel (${fmtNum(filtres.length)})`}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {voirParams && (
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
              {parametres.map((p) => (
                <label key={p.cle} className="flex flex-col gap-0.5 text-[11.5px]" title={p.description || ''}>
                  <span className="truncate font-semibold text-[#3A362E]">{p.description || p.cle}</span>
                  <input value={paramsDraft[p.cle] ?? ''} onChange={(e) => setParamsDraft({ ...paramsDraft, [p.cle]: e.target.value })} className="h-7 rounded-md border border-[#E5E1D8] px-2" />
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[11px] text-[#8A8474]">Paramètres communs à tous les dépôts. MIN = ⌈μ × L/7 + z σ √(L/7)⌉, MAX = MIN + ⌈μ × R/7⌉ ; L / R MYSTOCK en agence = délai et cycle MYSTOCK, sinon délai fournisseur (FIA) et cycle hors MYSTOCK.</span>
              <button type="button" onClick={() => void enregistrerParams()} className="h-7 rounded-md bg-[#111820] px-3 text-[11.5px] font-bold text-white">Enregistrer et recalculer</button>
            </div>
          </section>
        )}

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/get_stock_agence_analyse|stock_agence_/.test(erreur) ? ' — la migration 20261006_stock_agence_analyse.sql est-elle appliquée ?' : ''}
          </div>
        )}

        <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <Kpi label="Valeur du stock" value={loading ? '…' : fmtEuro(kpis.valeur)} sub={`${fmtNum(kpis.refsStock)} réf. en stock · ${fmtNum(kpis.aStocker)} à stocker`} />
          <Kpi label="Sur-stock (au-delà du MAX)" value={loading ? '…' : fmtEuro(kpis.surStock)} sub={`${fmtNum(kpis.surStockRefs)} réf. à stocker en excès`} tone="warn" onClick={() => setRapide((v) => (v === 'SUR_STOCK' ? '' : 'SUR_STOCK'))} actif={rapide === 'SUR_STOCK'} />
          <Kpi label="À ne plus stocker" value={loading ? '…' : fmtEuro(kpis.destocker)} sub={`${fmtNum(kpis.destockerRefs)} réf. — stock libre (hors réservé)`} tone="alerte" onClick={() => setRapide((v) => (v === 'A_DESTOCKER' ? '' : 'A_DESTOCKER'))} actif={rapide === 'A_DESTOCKER'} />
          <Kpi label="Dormant (0 vente 12 mois)" value={loading ? '…' : fmtEuro(kpis.dormant)} sub={`${fmtNum(kpis.dormantRefs)} réf. en stock`} tone="alerte" onClick={() => setRapide((v) => (v === 'DORMANT' ? '' : 'DORMANT'))} actif={rapide === 'DORMANT'} />
          <Kpi label="À stocker — sans stock" value={loading ? '…' : fmtNum(kpis.manquants)} sub={`${fmtEuro(kpis.manquantsValeur)} pour atteindre le MAX`} tone="alerte" onClick={() => setRapide((v) => (v === 'A_STOCKER_SANS_STOCK' ? '' : 'A_STOCKER_SANS_STOCK'))} actif={rapide === 'A_STOCKER_SANS_STOCK'} />
          <Kpi label="Sous le MIN" value={loading ? '…' : fmtNum(kpis.sousMin)} sub={`${fmtEuro(kpis.sousMinValeur)} à réapprovisionner`} tone="warn" onClick={() => setRapide((v) => (v === 'SOUS_MIN' ? '' : 'SOUS_MIN'))} actif={rapide === 'SOUS_MIN'} />
          <Kpi label="À surveiller" value={loading ? '…' : fmtNum(kpis.surveiller)} sub={`${fmtEuro(kpis.surveillerValeur)} en stock`} onClick={() => setRapide((v) => (v === 'SURVEILLER' ? '' : 'SURVEILLER'))} actif={rapide === 'SURVEILLER'} />
        </section>

        <section className="grid gap-2.5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <MatriceAbcXyz rows={rows} filtre={abcXyz} onFiltre={setAbcXyz} />
          <div className="rounded-xl border border-[#E5E1D8] bg-white p-3 text-[12px] leading-relaxed text-[#3A362E]">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Règles appliquées</div>
            <p><b>Ventes</b> : sorties BL au départ du dépôt (lignes facturées + BL non facturés), retours et avoirs déduits. Le mode d’expédition (comptoir, GEZE…) n’est connu que sur les commandes en cours : il est visible dans la fenêtre article.</p>
            <p className="mt-1"><b>Décision</b> : à stocker si vendu au moins {fmtNum(pm.seuil_semaines_stocker)} semaines sur {fmtNum(meta?.nb_semaines ?? 52)} ; à surveiller entre {fmtNum(pm.seuil_semaines_surveiller)} et {fmtNum(n0(pm.seuil_semaines_stocker) - 1)} ; sinon ne pas stocker. Sommeil, blocage appro SAGE, exclusion et fin de vie : jamais stockés.</p>
            <p className="mt-1"><b>MIN / MAX</b> : MYSTOCK en agence → délai couvert {fmtNum(pm.delai_mystock_jours)} j (préparation + transport), cycle {fmtNum(pm.cycle_mystock_jours, 1)} j (2 réappros / semaine) ; sinon délai fournisseur (défaut {fmtNum(pm.delai_hors_mystock_defaut_jours)} j). Les semaines au-dessus de médiane + {fmtNum(pm.pic_mad_k)} écarts robustes sont des pics exceptionnels, écrêtés pour le calcul.</p>
            <p className="mt-1"><b>Sur-stock / à déstocker</b> : calculés sur le stock libre (réel − réservé). {kpis.reserveSupStock > 0 && <span className="font-semibold text-[#8A5A08]">{fmtNum(kpis.reserveSupStock)} réf. ont plus de réservé que de stock réel.</span>}</p>
          </div>
        </section>

        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'minmax(200px, 2fr) repeat(5, minmax(0, 1fr))' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation, famille, fournisseur…" className={`${ctl} font-medium`} />
            <select value={decisionF} onChange={(e) => setDecisionF(e.target.value as '' | Decision)} className={ctl}>
              <option value="">Décision : toutes</option>
              {(Object.keys(DECISION_STYLE) as Decision[]).map((d) => <option key={d} value={d}>{DECISION_STYLE[d].label}</option>)}
            </select>
            <select value={rapide} onChange={(e) => setRapide(e.target.value as FiltreRapide)} className={ctl}>
              <option value="">Statut : tous</option>
              {(Object.keys(STATUT_STYLE) as Statut[]).filter((s) => s !== 'HORS_STOCK' && s !== 'OK').map((s) => <option key={s} value={s}>{STATUT_STYLE[s].label}</option>)}
              <option value="DORMANT">Dormant (0 vente 12 mois)</option>
            </select>
            <select value={mystockF} onChange={(e) => setMystockF(e.target.value as typeof mystockF)} className={ctl}>
              <option value="tous">MYSTOCK : tous</option><option value="oui">MYSTOCK OUI</option><option value="non">MYSTOCK NON</option>
            </select>
            <select value={stockF} onChange={(e) => setStockF(e.target.value as typeof stockF)} className={ctl}>
              <option value="tous">Stock : tous</option><option value="avec">En stock</option><option value="sans">Sans stock</option>
            </select>
            <select value={fournF} onChange={(e) => setFournF(e.target.value)} className={ctl}>
              <option value="">Fournisseur : tous</option>
              {fournisseurs.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-[#8A8474]">
            <span>
              {loading ? 'Calcul en cours…' : `${fmtNum(filtres.length)} référence${filtres.length > 1 ? 's' : ''}`} · stock {fmtEuro(totaux.valeur)} · excédent {fmtEuro(totaux.excedent)} · à approvisionner {fmtEuro(totaux.manque)} · CA 12 mois {fmtEuro(totaux.ca)}
            </span>
            {nbFiltres > 0 && (
              <button type="button" onClick={() => { setSearch(''); setRapide(''); setDecisionF(''); setMystockF('tous'); setStockF('tous'); setFournF(''); setAbcXyz(null) }} className="font-bold text-[#B4761A] hover:underline">↺ Réinitialiser les filtres ({nbFiltres})</button>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[#E5E1D8] bg-white">
          <div className="max-h-[calc(100vh-160px)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-[12px]">
              <thead className="sticky top-0 z-10 text-[10px] uppercase tracking-wide text-[#8A8474]">
                <tr>
                  <Th k="ref">Référence</Th>
                  <Th k="fournisseur">Fourn.</Th>
                  <Th k="abc" title="ABC = poids dans le CA 12 mois du dépôt ; XYZ = régularité mensuelle">Classe</Th>
                  <Th k="qte" right title="Stock réel — en dessous : préparé">Réel</Th>
                  <Th k="dispo" right title="Disponible = réel − préparé">Dispo</Th>
                  <Th k="res" right title="Réservé par les commandes clients — en dessous : à livrer sous 7 j">Réservé</Th>
                  <Th k="valeur" right>Valeur</Th>
                  <Th k="nb_sem" right title="Semaines avec vente sur la période — en dessous : BL / clients">Sem. vendues</Th>
                  <Th k="mu_sem" right title="Moyenne hebdomadaire (pics écrêtés)">μ / sem.</Th>
                  <Th k="pic_sem" right title="Plus forte semaine — en dessous : pics exceptionnels écrêtés">Pic sem.</Th>
                  <Th k="couv_sem" right title="Dispo / μ hebdomadaire">Couv.</Th>
                  <Th k="dernier_mvt" right title="Dernier mouvement : sortie BL ou réception de commande fournisseur au dépôt">Dern. mvt</Th>
                  <Th k="statut">Décision / statut</Th>
                  <Th k="smin" right title="MIN / MAX retenus (calculés si rien n'est saisi) — en dessous : SAGE">MIN / MAX</Th>
                  <Th k="excedent_valeur" right title="Sur-stock au-delà du MAX ou stock libre à déstocker">Excédent</Th>
                  <Th k="manque_valeur" right title="Quantité pour remonter au MAX quand le stock à terme passe sous le MIN">À appro.</Th>
                  <Th k="ca12" right>CA 12 m</Th>
                </tr>
              </thead>
              <tbody>
                {filtres.slice(0, nbAffichees).map((r) => {
                  const mvt = moisDepuis(r.dernier_mvt)
                  return (
                    <tr key={r.ref} onClick={() => setRefOuverte(r.ref)} className="group cursor-pointer border-t border-[#EFECE4] hover:bg-[#FAF8F3]">
                      <td className="max-w-[300px] border-t border-[#EFECE4] px-2 py-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[11.5px] font-bold text-[#111820] underline decoration-[#D5D0C4] decoration-dotted underline-offset-2 group-hover:decoration-[#B4761A]">{r.ref}</span>
                          {r.mystock && <Badge cls="bg-emerald-50 text-emerald-700">MYSTOCK</Badge>}
                          {r.blocage && <Badge cls="bg-red-600 text-white">⛔</Badge>}
                          {r.sommeil && <Badge cls="bg-[#F4F3F0] text-[#8A8474]">zz</Badge>}
                          {r.vie_produit && <Badge cls="bg-orange-100 text-orange-700">{r.vie_produit}</Badge>}
                        </span>
                        <span className="block truncate text-[10.5px] text-[#5E5A50]">{r.designation || '—'}</span>
                      </td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 font-mono text-[10.5px] text-[#5E5A50]">{r.fournisseur || '—'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1"><span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${r.abc === 'A' ? 'bg-emerald-50 text-emerald-700' : r.abc === 'B' ? 'bg-sky-50 text-sky-700' : 'bg-[#F4F3F0] text-[#8A8474]'}`}>{r.abc}{r.xyz}</span></td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right"><span className="font-semibold">{fmtNum(r.qte)}</span>{r.prepa ? <div className="text-[10px] text-[#8A8474]">PL {fmtNum(r.prepa)}</div> : null}</td>
                      <td className={`border-t border-[#EFECE4] px-2 py-1 text-right font-semibold ${r.dispo <= 0 && r.decision === 'STOCKER' ? 'text-red-700' : ''}`}>{fmtNum(r.dispo)}{r.transit ? <div className="text-[10px] font-normal text-[#8A8474]">transit {fmtNum(r.transit)}</div> : null}</td>
                      <td className={`border-t border-[#EFECE4] px-2 py-1 text-right ${r.res > r.qte ? 'font-semibold text-[#8A5A08]' : ''}`}>{r.res ? fmtNum(r.res) : '—'}{r.cdc_7j ? <div className="text-[10px] text-[#8A8474]">≤ 7 j {fmtNum(r.cdc_7j)}</div> : null}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.qte > 0 ? fmtEuro(r.valeur) : '—'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right"><span className="font-semibold">{fmtNum(r.nb_sem)}</span>{r.nb_bl ? <div className="text-[10px] text-[#8A8474]">{fmtNum(r.nb_bl)} BL · {fmtNum(r.nb_clients)} cl.</div> : null}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.mu_sem ? fmtNum(r.mu_sem, 1) : '—'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.pic_sem ? fmtNum(r.pic_sem) : '—'}{r.nb_pics ? <div className="text-[10px] font-semibold text-[#C1683C]">{r.nb_pics} pic{r.nb_pics > 1 ? 's' : ''}</div> : null}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.couv_sem === null ? '—' : `${fmtNum(r.couv_sem, 1)} s`}</td>
                      <td className={`whitespace-nowrap border-t border-[#EFECE4] px-2 py-1 text-right ${mvt === null || mvt >= 12 ? 'font-semibold text-red-700' : mvt >= 6 ? 'text-[#96600F]' : 'text-[#5E5A50]'}`}>{r.dernier_mvt ? fmtDate(r.dernier_mvt) : 'Aucun'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1">
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge cls={STATUT_STYLE[r.statut].cls}>{STATUT_STYLE[r.statut].label}</Badge>
                          {r.decision_forcee && <span className="text-[9.5px] font-bold text-[#8A5A08]">décision forcée</span>}
                        </div>
                      </td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">
                        {r.decision === 'STOCKER' ? <span className={`font-bold ${r.min_retenu !== null || r.max_retenu !== null ? 'text-[#8A5A08]' : ''}`}>{fmtNum(r.smin)} / {fmtNum(r.smax)}</span> : '—'}
                        {(r.sage_min || r.sage_max) ? <div className="text-[10px] text-[#8A8474]">SAGE {fmtNum(r.sage_min)} / {fmtNum(r.sage_max)}</div> : null}
                      </td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.excedent_valeur > 0 ? <span className="font-semibold text-[#8A5A08]">{fmtEuro(r.excedent_valeur)}<div className="text-[10px] font-normal text-[#8A8474]">{fmtNum(r.excedent_qte)} p.</div></span> : '—'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.manque_qte > 0 ? <span className="font-semibold text-red-700">{fmtNum(r.manque_qte)} p.<div className="text-[10px] font-normal text-[#8A8474]">{fmtEuro(r.manque_valeur)}</div></span> : '—'}</td>
                      <td className="border-t border-[#EFECE4] px-2 py-1 text-right">{r.ca12 ? fmtEuro(r.ca12) : '—'}</td>
                    </tr>
                  )
                })}
                {!loading && filtres.length === 0 && <tr><td colSpan={17} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence pour ces filtres.</td></tr>}
              </tbody>
            </table>
            {filtres.length > nbAffichees && (
              <div className="flex items-center justify-center gap-3 border-t border-[#E5E1D8] bg-[#FAF8F3] py-2 text-[12px]">
                <span className="text-[#8A8474]">{fmtNum(nbAffichees)} / {fmtNum(filtres.length)} lignes</span>
                <button type="button" onClick={() => setNbAffichees((n) => n + 300)} className="rounded-md border border-[#E5E1D8] bg-white px-3 py-1 font-bold">Afficher 300 de plus</button>
                <button type="button" onClick={() => setNbAffichees(filtres.length)} className="font-bold text-[#B4761A] hover:underline">Tout afficher</button>
              </div>
            )}
          </div>
        </section>
      </div>

      {ligneOuverte && (
        <ArticleModal depotNum={depotNum} depuis={depuis} ligne={ligneOuverte}
          position={indexOuvert >= 0 ? `${indexOuvert + 1} / ${filtres.length}` : null}
          onPrev={indexOuvert > 0 ? () => setRefOuverte(filtres[indexOuvert - 1].ref) : undefined}
          onNext={indexOuvert >= 0 && indexOuvert < filtres.length - 1 ? () => setRefOuverte(filtres[indexOuvert + 1].ref) : undefined}
          onClose={() => setRefOuverte(null)} onSaved={charger} />
      )}
    </main>
  )
}

export default function AnalyseStockAgencePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <AnalyseStockAgence />
    </Suspense>
  )
}
