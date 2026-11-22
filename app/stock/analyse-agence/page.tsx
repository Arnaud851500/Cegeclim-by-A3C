'use client'

/**
 * Écran « Analyse stock agence » (menu Stocks & logistique, /stock/analyse-agence?depot=1).
 * ---------------------------------------------------------------------------
 * Créé le 06/10/2026. Analyse le stock d'un dépôt (agence, ou FMS) à partir des ventes
 * au départ de ce dépôt (lignes BL facturées + BL non facturés portant le dépôt).
 *
 *  - indicateurs : valeur du stock, sur-stock (au-delà du MAX), stock à ne plus porter,
 *    références à stocker absentes du dépôt, sous le MIN ;
 *  - matrice ABC (CA 12 mois du dépôt) × XYZ (régularité mensuelle), cliquable — repliée par défaut ;
 *  - liste filtrable / triable ;
 *  - fenêtre article : ventes mensuelles, semaines (immédiates / sur commande, pics, MIN), clients,
 *    dernières sorties, commandes clients en cours, commandes fournisseurs, stock par dépôt ;
 *    décision forcée et MIN / MAX retenus enregistrables.
 *
 * Sources : RPC get_stock_agence_analyse, get_stock_agence_article, stock_agence_figer_minmax,
 * get_stock_agence_minmax_export ; tables stock_agence_depots, stock_agence_parametres,
 * stock_agence_article_choix, stock_agence_minmax_fige(_entete).
 * Migrations : 20261006_stock_agence_analyse.sql, 20261027_stock_agence_depot_fige.sql,
 * 20261122_stock_agence_ventes_immediates.sql.
 *
 * 27/10/2026 : dépôt figé sur l'agence du collaborateur.
 * 29/10/2026 : la fenêtre article interroge le dépôt de l'analyse affichée (meta.depot_num).
 *
 * 22/11/2026 (Arnaud) :
 *  - VENTES IMMÉDIATES : une sortie compte pour la décision « stocker » et pour μ / σ / MIN / MAX
 *    seulement si le BL n'a pas de commande ou si la commande a ≤ 10 j (paramètre) ; les sorties
 *    sur commandes plus anciennes restent affichées (le dépôt a eu le temps de se faire livrer).
 *  - MIN / MAX FIGÉS : ils ne bougent plus à chaque ouverture ; bouton « Figer / mettre à jour »,
 *    une saisie manuelle refige la seule référence ; fichier MIN / MAX BLG (nouvelles valeurs,
 *    mise à 0 des références qui sortent du stock).
 *  - ID BLG dans l'export Excel ; matrice ABC × XYZ repliée, liste regroupée par blocs.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  q_depuis: number; ca_depuis: number; q12: number; ca12: number; marge12: number; q12_brut: number; ca12_brut: number
  /** ventes IMMÉDIATES sur la période (BL sans commande ou commande ≤ N j) */
  q_per: number; nb_sem: number; nb_bl: number; nb_clients: number
  /** toutes les sorties sur la période */
  q_per_tot: number; nb_sem_tot: number; nb_bl_tot: number; nb_clients_tot: number
  /** sorties sur commandes plus anciennes que N j */
  q_per_cde: number; nb_cde_longues: number
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
  blg_id: number | null
  /** MIN / MAX figés */
  fige: boolean; prop_decision: Decision; prop_min: number; prop_max: number; ecart_fige: boolean
}
type FigeEntete = { depot_num: string; fige_le: string; fige_par: string | null; maj_le: string | null; maj_par: string | null; nb_refs: number; nb_stocker: number }
type Meta = {
  depot_num: string; depot: string; nom: string; central: boolean; depuis: string
  semaines_debut: string; semaines_fin: string; nb_semaines: number; mois_debut: string; mois_fin: string
  calcule_le: string; stock_charge_le: string | null; blg_warehouse_id: number | null; fige: FigeEntete | null
}
type Analyse = { meta: Meta; parametres: Record<string, number>; rows: Ligne[] }
type Depot = { depot_num: string; libelle: string; nom_court: string; central: boolean; ordre: number | null }
type Parametre = { cle: string; valeur: number; description: string | null }

type DetailArticle = {
  delai_vente_immediate_jours?: number
  mois: { mois: string; qte: number; qte_imm?: number; ca: number; nb_bl: number; nb_clients: number }[]
  semaines: { semaine: string; qte: number; qte_imm?: number; nb_bl: number }[]
  clients: { numero_tiers: string | null; intitule: string | null; qte: number; qte_imm?: number; ca: number; nb_bl: number; derniere: string | null }[]
  lignes: { d: string; bl: string | null; numero_tiers: string | null; intitule: string | null; qte: number; ca: number; bc?: string | null; date_bc?: string | null; delai_cde?: number | null; imm?: boolean }[]
  cdc: { numero_piece: string; type_document: string | null; date_piece: string | null; date_livraison: string | null; numero_tiers: string | null; intitule: string | null; qte: number; expedition: string | null; collaborateur: string | null }[]
  cdf: { cdf_reference: string; cdf_order_date: string | null; cdf_lien_blg: string | null; nom_fournisseur: string | null; quantite_commandee: number | null; quantite_livree: number | null; quantite_ral: number | null; date_livraison_demandee: string | null; date_livraison: string | null }[]
  stocks: { depot_num: string; depot: string; qte: number; prepa: number; dispo: number; res: number; cde: number; aterme: number; sage_min: number | null; sage_max: number | null }[]
}

type LigneMinMax = {
  ref: string; designation: string | null; blg_id: number | null; blg_reference: string | null; blg_internal_reference: string | null
  blg_stock_id: number | null; blg_min: number | null; blg_max: number | null; sage_min: number | null; sage_max: number | null
  stock_sage: number; decision: string; manuel: boolean; new_min: number; new_max: number; action_blg: string; action_sage: string
}
type ExportMinMax = {
  meta: { depot_num: string; depot: string; nom: string; blg_warehouse_id: number | null; blg_warehouse_code: string | null; blg_warehouse_title: string | null
    fige_le: string; fige_par: string | null; maj_le: string | null; maj_par: string | null; extrait_le: string }
  rows: LigneMinMax[]
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
function fmtDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
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
function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((100 * part) / total) : null
}
const LIEN_ARTICLE_BLG = (id: number) => `https://app.blgcloud.com/dakar-11/?app/article/part/${id}#`

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
const ORDRE_ACTION: Record<string, number> = { 'Mettre à 0': 1, Nouveau: 2, Modifier: 3, 'Article absent de BLG': 4, Inchangé: 5 }

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
      className={`min-w-0 rounded-xl border px-3 py-1.5 text-left ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.08]' : 'border-[#E5E1D8] bg-white'} ${onClick ? 'hover:border-[#B4761A]' : ''}`}>
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[18px] font-bold leading-6 tracking-tight" style={{ color }}>{value}</div>
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
  const libAbc: Record<string, string> = { A: 'A · 80 % du CA', B: 'B · 15 %', C: 'C · 5 % (et sorties sans CA)', N: 'Aucune sortie 12 m' }
  const libXyz: Record<string, string> = { X: 'X · régulier', Y: 'Y · variable', Z: 'Z · erratique', N: '—' }
  return (
    <div className="rounded-xl border border-[#E5E1D8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Matrice ABC (CA brut 12 mois du dépôt, avant retours) × XYZ (régularité mensuelle)</div>
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

function ArticleModal({ depotNum, depuis, ligne, delaiImm, depotFige, position, onPrev, onNext, onClose, onSaved }: {
  depotNum: string; depuis: string; ligne: Ligne; delaiImm: number; depotFige: boolean; position: string | null
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
      // MIN / MAX figés : la saisie manuelle refige la seule référence (sans toucher aux autres)
      if (depotFige) {
        const { error } = await supabase.rpc('stock_agence_figer_minmax', { p_depot_num: depotNum, p_ref: ligne.ref })
        if (error) throw error
      }
      await onSaved()
      setMsg(depotFige ? 'Enregistré — MIN / MAX figés mis à jour pour cette référence.' : 'Enregistré — liste recalculée.')
    } catch (e) { setMsg('Erreur : ' + messageErreur(e)) } finally { setSaving(false) }
  }

  const minAffiche = ligne.decision === 'STOCKER' ? ligne.smin : null
  const serieSem = (detail?.semaines || []).map((s) => {
    const imm = s.qte_imm ?? s.qte
    const cde = Math.max(n0(s.qte) - n0(imm), 0)
    const pic = ligne.plafond_pic !== null && imm > n0(ligne.plafond_pic)
    return { ...s, label: fmtDate(s.semaine).slice(0, 5), normal: pic ? null : imm, pic: pic ? imm : null, cde: cde || null }
  })
  const serieMois = (detail?.mois || []).map((m) => ({ ...m, label: fmtMoisCourt(m.mois), imm: m.qte_imm ?? m.qte, cde: Math.max(n0(m.qte) - n0(m.qte_imm ?? m.qte), 0) || null }))
  const expeditions = useMemo(() => {
    const m = new Map<string, number>()
    ;(detail?.cdc || []).forEach((c) => m.set(c.expedition || '—', (m.get(c.expedition || '—') || 0) + n0(c.qte)))
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [detail])
  const partImm = pct(ligne.q_per, ligne.q_per_tot)

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
              {ligne.blg_id && <a href={LIEN_ARTICLE_BLG(ligne.blg_id)} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold text-[#B4761A] hover:underline">BLG #{ligne.blg_id} ↗</a>}
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
              <Kpi label="Ventes immédiates" value={fmtNum(ligne.q_per)} sub={`sur ${fmtNum(ligne.q_per_tot)} sorties${partImm !== null ? ` · ${partImm} %` : ''}`}
                title={`BL sans commande ou commande de ${delaiImm} j au plus avant le BL`} />
              <Kpi label="Semaines vendues" value={`${fmtNum(ligne.nb_sem)} / 52`} sub={`immédiates · ${fmtNum(ligne.nb_sem_tot)} toutes sorties`} />
              <Kpi label="μ / semaine" value={fmtNum(ligne.mu_sem, 1)} sub={`σ ${fmtNum(ligne.sigma_sem, 1)} · pic ${fmtNum(ligne.pic_sem)}${ligne.nb_pics ? ` (${ligne.nb_pics} écrêté${ligne.nb_pics > 1 ? 's' : ''})` : ''}`} tone={ligne.nb_pics ? 'warn' : undefined} />
              <Kpi label="Couverture" value={ligne.couv_sem === null ? '—' : `${fmtNum(ligne.couv_sem, 1)} sem.`} sub={`dispo FMS ${fmtNum(ligne.fms_dispo)}`} />
            </div>

            <div className="rounded-xl border border-[#E5E1D8] p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <div className="flex gap-1">
                  {(['semaines', 'mois'] as const).map((o) => (
                    <button key={o} type="button" onClick={() => setOnglet(o)}
                      className={`rounded-md px-2.5 py-1 text-[11.5px] font-bold ${onglet === o ? 'bg-[#111820] text-white' : 'text-[#3A362E] hover:bg-[#F4F3F0]'}`}>
                      {o === 'semaines' ? 'Semaines' : `Mois depuis ${fmtMoisCourt(depuis)}`}
                    </button>
                  ))}
                </div>
                <span className="flex items-center gap-3 text-[10.5px] text-[#8A8474]">
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#3A362E]" />Immédiates</span>
                  {onglet === 'semaines' && ligne.nb_pics > 0 && <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#C1683C]" />Pic écrêté</span>}
                  <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#D9D3C3]" />Sur commande &gt; {delaiImm} j</span>
                  {onglet === 'semaines' && minAffiche !== null && minAffiche > 0 && <span className="font-bold text-[#B42318]">— MIN</span>}
                </span>
              </div>
              <div className="h-[250px]">
                {erreur ? <div className="p-6 text-[12px] text-red-700">Détail indisponible : {erreur}</div> : !detail ? <div className="h-full animate-pulse rounded-lg bg-[#F4F3F0]" /> : onglet === 'semaines' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={serieSem} margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barCategoryGap="12%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#EDEAE1" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 9.5, fill: '#8A8474' }} tickLine={false} interval={3} />
                      <YAxis tick={{ fontSize: 10.5, fill: '#8A8474' }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip formatter={(v) => fmtNum(Number(v))} labelFormatter={(l) => `Semaine du ${String(l)}`} />
                      <Bar dataKey="normal" name="Immédiates" stackId="s" fill="#3A362E" isAnimationActive={false} />
                      <Bar dataKey="pic" name="Pic exceptionnel" stackId="s" fill="#C1683C" isAnimationActive={false} />
                      <Bar dataKey="cde" name={`Sur commande > ${delaiImm} j`} stackId="s" fill="#D9D3C3" isAnimationActive={false} />
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
                      <Bar yAxisId="q" dataKey="imm" name="Immédiates" stackId="m" fill="#3A362E" isAnimationActive={false} />
                      <Bar yAxisId="q" dataKey="cde" name={`Sur commande > ${delaiImm} j`} stackId="m" fill="#D9D3C3" isAnimationActive={false} />
                      <Line yAxisId="c" dataKey="ca" name="CA HT" stroke="#B4761A" dot={false} strokeWidth={2} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-[#E5E1D8]">
                <div className="flex items-center justify-between border-b border-[#E5E1D8] px-3 py-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Clients — 52 semaines</span>
                  <span className="text-[10.5px] text-[#8A8474]">immédiates / toutes</span>
                </div>
                <div className="max-h-[220px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.clients || []).map((c, i) => (
                        <tr key={i} className="border-t border-[#F4F3F0]">
                          <td className="px-2 py-1"><span className="font-mono text-[10.5px] text-[#8A8474]">{c.numero_tiers}</span> {c.intitule}</td>
                          <td className="whitespace-nowrap px-2 py-1 text-right"><b>{fmtNum(c.qte_imm ?? c.qte)}</b><span className="text-[#8A8474]"> / {fmtNum(c.qte)}</span></td>
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
                <div className="flex items-center justify-between border-b border-[#E5E1D8] px-3 py-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Dernières sorties du dépôt</span>
                  <span className="text-[10.5px] text-[#8A8474]">origine de la vente</span>
                </div>
                <div className="max-h-[220px] overflow-auto">
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      {(detail?.lignes || []).map((l, i) => (
                        <tr key={i} className={`border-t border-[#F4F3F0] ${l.imm === false ? 'text-[#8A8474]' : ''}`}>
                          <td className="whitespace-nowrap px-2 py-1">{fmtDate(l.d)}</td>
                          <td className="px-2 py-1 font-mono text-[10.5px] text-[#8A8474]">{l.bl}</td>
                          <td className="max-w-[140px] truncate px-2 py-1">{l.intitule || l.numero_tiers}</td>
                          <td className="whitespace-nowrap px-2 py-1" title={l.bc ? `Commande ${l.bc} du ${fmtDate(l.date_bc)}` : 'BL sans commande'}>
                            {!l.bc ? <Badge cls="bg-emerald-50 text-emerald-700">BL direct</Badge>
                              : l.imm ? <Badge cls="bg-emerald-50 text-emerald-700">cde J-{fmtNum(l.delai_cde)}</Badge>
                                : <Badge cls="bg-[#F4F3F0] text-[#8A8474]">cde J-{fmtNum(l.delai_cde)}</Badge>}
                          </td>
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
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#96600F]">MIN / MAX</span>
                {depotFige ? <Badge cls="bg-[#111820] text-white">figés</Badge> : <Badge cls="bg-amber-100 text-amber-800">non figés</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span className="text-[#8A8474]">{depotFige ? 'Décision figée' : 'Décision'}</span><span className="text-right font-bold">{DECISION_STYLE[ligne.decision].label}</span>
                <span className="text-[#8A8474]">{depotFige ? 'MIN / MAX figés' : 'MIN / MAX retenus'}</span><span className="text-right text-[14px] font-bold text-[#111820]">{fmtNum(ligne.smin)} / {fmtNum(ligne.smax)}</span>
                {depotFige && <>
                  <span className="text-[#8A8474]">Calcul du jour</span>
                  <span className={`text-right font-semibold ${ligne.ecart_fige ? 'text-[#C1683C]' : ''}`}>{DECISION_STYLE[ligne.prop_decision]?.label ?? ligne.prop_decision} · {fmtNum(ligne.prop_min)} / {fmtNum(ligne.prop_max)}</span>
                </>}
                <span className="text-[#8A8474]">MIN / MAX calculés</span><span className="text-right">{fmtNum(ligne.min_calc)} / {fmtNum(ligne.max_calc)}</span>
                <span className="text-[#8A8474]">MIN / MAX SAGE</span><span className="text-right">{fmtNum(ligne.sage_min)} / {fmtNum(ligne.sage_max)}</span>
                <span className="text-[#8A8474]">Délai couvert L</span><span className="text-right">{fmtNum(ligne.l_jours, 1)} j{ligne.mystock ? ' (MYSTOCK)' : ''}</span>
                <span className="text-[#8A8474]">Cycle de réappro R</span><span className="text-right">{fmtNum(ligne.r_jours, 1)} j</span>
                {ligne.nb_sem_sup_min !== null && <><span className="text-[#8A8474]">Semaines &gt; MIN</span><span className="text-right">{fmtNum(ligne.nb_sem_sup_min)} / 52</span></>}
                <span className="text-[#8A8474]">Excédent</span><span className="text-right font-semibold text-[#8A5A08]">{fmtNum(ligne.excedent_qte)} · {fmtEuro(ligne.excedent_valeur)}</span>
                <span className="text-[#8A8474]">À approvisionner</span><span className="text-right font-semibold text-red-700">{fmtNum(ligne.manque_qte)} · {fmtEuro(ligne.manque_valeur)}</span>
              </div>
              {ligne.ecart_fige && <div className="mt-1.5 text-[11px] text-[#C1683C]">Le calcul du jour diffère des valeurs figées : elles seront remplacées au prochain « Figer / mettre à jour ».</div>}
              <div className="mt-2 rounded-lg bg-white p-2 font-mono text-[10.5px] leading-relaxed text-[#3A362E]">
                Sur les ventes immédiates (≤ {delaiImm} j) :<br />
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
              {depotFige && <div className="mt-1 text-[10.5px] text-[#8A8474]">L’enregistrement met à jour les MIN / MAX figés de cette seule référence.</div>}
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
                <span className="text-[#8A8474]">Sorties 52 sem. (toutes)</span><span className="text-right">{fmtNum(ligne.q_per_tot)} · {fmtNum(ligne.nb_bl_tot)} BL · {fmtNum(ligne.nb_clients_tot)} cl.</span>
                <span className="text-[#8A8474]">dont immédiates</span><span className="text-right font-semibold">{fmtNum(ligne.q_per)} · {fmtNum(ligne.nb_bl)} BL · {fmtNum(ligne.nb_clients)} cl.</span>
                <span className="text-[#8A8474]">dont sur cde &gt; {delaiImm} j</span><span className="text-right">{fmtNum(ligne.q_per_cde)} · {fmtNum(ligne.nb_cde_longues)} cde</span>
                <span className="text-[#8A8474]">Dernière sortie</span><span className="text-right">{fmtDate(ligne.derniere_sortie)}</span>
                <span className="text-[#8A8474]">Dernière réception CDF</span><span className="text-right">{fmtDate(ligne.derniere_reception)}</span>
                <span className="text-[#8A8474]">Encours CDF au dépôt</span><span className="text-right">{fmtNum(ligne.encours_cdf)}</span>
                <span className="text-[#8A8474]">En transit</span><span className="text-right">{fmtNum(ligne.transit)}</span>
                <span className="text-[#8A8474]">CDC à livrer ≤ 7 j / total</span><span className="text-right">{fmtNum(ligne.cdc_7j)} / {fmtNum(ligne.cdc_total)}</span>
                <span className="text-[#8A8474]">Ventes depuis {fmtMoisCourt(depuis)}</span><span className="text-right">{fmtNum(ligne.q_depuis)} · {fmtEuro(ligne.ca_depuis)}</span>
                <span className="text-[#8A8474]">Net 12 mois (retours déduits)</span><span className="text-right">{fmtNum(ligne.q12)} · {fmtEuro(ligne.ca12)}</span>
                <span className="text-[#8A8474]">Marge 12 mois</span><span className="text-right">{fmtEuro(ligne.marge12)}</span>
                <span className="text-[#8A8474]">PU (CMUP)</span><span className="text-right">{ligne.pu === null ? '—' : ligne.pu.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
                <span className="text-[#8A8474]">ID article BLG</span><span className="text-right">{ligne.blg_id ?? '—'}</span>
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

type CleTri = 'ref' | 'abc' | 'valeur' | 'qte' | 'dispo' | 'res' | 'q_per_tot' | 'q_per' | 'nb_sem' | 'mu_sem' | 'pic_sem' | 'couv_sem' | 'smin' | 'excedent_valeur' | 'manque_valeur' | 'dernier_mvt' | 'ca12' | 'statut'
type FiltreRapide = '' | 'SUR_STOCK' | 'A_DESTOCKER' | 'A_STOCKER_SANS_STOCK' | 'SOUS_MIN' | 'SURVEILLER' | 'DORMANT' | 'ECART_FIGE' | 'SURTOUT_CDE'

const CLE_MATRICE = 'cegeclim:analyse-agence:matrice-ouverte'

function AnalyseStockAgence() {
  const router = useRouter()
  const params = useSearchParams()
  const [depots, setDepots] = useState<Depot[]>([])
  const [depotNum, setDepotNum] = useState(params.get('depot') || '1')
  /** null = pas de restriction ; sinon dépôts autorisés (agence du collaborateur). undefined = pas encore lu. */
  const [depotsUser, setDepotsUser] = useState<string[] | null | undefined>(undefined)
  const [depuis] = useState('2025-01-01')
  const [analyse, setAnalyse] = useState<Analyse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [parametres, setParametres] = useState<Parametre[]>([])
  const [paramsDraft, setParamsDraft] = useState<Record<string, string>>({})
  const [voirParams, setVoirParams] = useState(false)
  const [voirMatrice, setVoirMatrice] = useState(false)

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
  const [figeage, setFigeage] = useState<'' | 'confirmer' | 'en_cours'>('')
  const [exportMinMaxEnCours, setExportMinMaxEnCours] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    try { setVoirMatrice(window.localStorage.getItem(CLE_MATRICE) === '1') } catch { /* stockage indisponible */ }
  }, [])
  function basculerMatrice() {
    setVoirMatrice((v) => {
      try { window.localStorage.setItem(CLE_MATRICE, v ? '0' : '1') } catch { /* stockage indisponible */ }
      return !v
    })
  }

  useEffect(() => {
    void supabase.from('stock_agence_depots').select('*').order('ordre').then(({ data }) => setDepots((data || []) as Depot[]))
    void supabase.rpc('stock_agence_depots_user').then(({ data, error }) => {
      const liste = error ? null : (data as string[] | null)
      setDepotsUser(liste)
      if (liste && liste.length) setDepotNum((cur) => (liste.includes(cur) ? cur : liste[0]))
    })
    void supabase.from('stock_agence_parametres').select('*').order('cle').then(({ data }) => {
      const p = (data || []) as Parametre[]
      setParametres(p); setParamsDraft(Object.fromEntries(p.map((x) => [x.cle, String(x.valeur)])))
    })
  }, [])

  const requete = useRef(0)
  const charger = useCallback(async () => {
    if (depotsUser === undefined) return
    const id = ++requete.current
    if (depotsUser && !depotsUser.includes(depotNum)) {
      setAnalyse(null); setLoading(false)
      setErreur(depotsUser.length ? null : 'Aucun dépôt suivi pour l’agence de votre périmètre : l’analyse n’est pas disponible.')
      return
    }
    setLoading(true); setErreur(null)
    setAnalyse((cur) => (cur && String(cur.meta?.depot_num) !== String(depotNum) ? null : cur))
    const { data, error } = await supabase.rpc('get_stock_agence_analyse', { p_depot_num: depotNum, p_depuis: depuis })
    if (id !== requete.current) return
    if (error) { setErreur(messageErreur(error)); setAnalyse(null) }
    else setAnalyse(data as Analyse)
    setLoading(false)
  }, [depotNum, depuis, depotsUser])
  useEffect(() => { void charger() }, [charger])
  const depotsVisibles = depotsUser ? depots.filter((x) => depotsUser.includes(x.depot_num)) : depots

  function changerDepot(n: string) {
    setDepotNum(n); setRefOuverte(null); setAbcXyz(null); setFigeage(''); setInfo(null)
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
  const meta = analyse?.meta
  const pm = analyse?.parametres || {}
  const delaiImm = n0(pm.delai_vente_immediate_jours ?? 10)
  const fige = meta?.fige ?? null
  const fournisseurs = useMemo(() => Array.from(new Set(rows.map((r) => r.fournisseur).filter(Boolean) as string[])).sort(), [rows])

  const kpis = useMemo(() => {
    const k = { valeur: 0, refsStock: 0, surStock: 0, surStockRefs: 0, destocker: 0, destockerRefs: 0, manquants: 0, manquantsValeur: 0, sousMin: 0, sousMinValeur: 0, surveiller: 0, surveillerValeur: 0, dormant: 0, dormantRefs: 0, aStocker: 0, reserveSupStock: 0, ecarts: 0, qImm: 0, qTot: 0, surtoutCde: 0 }
    rows.forEach((r) => {
      if (r.qte > 0) { k.valeur += n0(r.valeur); k.refsStock += 1 }
      if (r.statut === 'SUR_STOCK') { k.surStock += n0(r.excedent_valeur); k.surStockRefs += 1 }
      if (r.statut === 'A_DESTOCKER') { k.destocker += n0(r.excedent_valeur); k.destockerRefs += 1 }
      if (r.statut === 'A_STOCKER_SANS_STOCK') { k.manquants += 1; k.manquantsValeur += n0(r.manque_valeur) }
      if (r.statut === 'SOUS_MIN') { k.sousMin += 1; k.sousMinValeur += n0(r.manque_valeur) }
      if (r.statut === 'SURVEILLER') { k.surveiller += 1; if (r.qte > 0) k.surveillerValeur += n0(r.valeur) }
      if (r.qte > 0 && n0(r.q12_brut) <= 0) { k.dormant += n0(r.valeur); k.dormantRefs += 1 }
      if (r.decision === 'STOCKER') k.aStocker += 1
      if (r.res > r.qte && r.qte >= 0) k.reserveSupStock += 1
      if (r.ecart_fige) k.ecarts += 1
      k.qImm += Math.max(n0(r.q_per), 0); k.qTot += Math.max(n0(r.q_per_tot), 0)
      if (n0(r.q_per_tot) > 0 && n0(r.q_per_cde) > n0(r.q_per)) k.surtoutCde += 1
    })
    return k
  }, [rows])

  const filtres = useMemo(() => {
    const t = normaliser(search.trim())
    const list = rows.filter((r) => {
      if (rapide === 'DORMANT') { if (!(r.qte > 0 && n0(r.q12_brut) <= 0)) return false }
      else if (rapide === 'ECART_FIGE') { if (!r.ecart_fige) return false }
      else if (rapide === 'SURTOUT_CDE') { if (!(n0(r.q_per_tot) > 0 && n0(r.q_per_cde) > n0(r.q_per))) return false }
      else if (rapide && r.statut !== rapide) return false
      if (decisionF && r.decision !== decisionF) return false
      if (mystockF !== 'tous' && r.mystock !== (mystockF === 'oui')) return false
      if (stockF === 'avec' && !(r.qte > 0)) return false
      if (stockF === 'sans' && r.qte > 0) return false
      if (fournF && r.fournisseur !== fournF) return false
      if (abcXyz && `${r.abc}${r.xyz}` !== abcXyz) return false
      if (t && !normaliser(`${r.ref} ${r.designation} ${r.famille} ${r.fournisseur} ${r.blg_id ?? ''}`).includes(t)) return false
      return true
    })
    const val = (r: Ligne): number | string | null => {
      switch (tri.k) {
        case 'ref': return r.ref
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
    setTri((t) => (t.k === k ? { k, dir: t.dir === 1 ? -1 : 1 } : { k, dir: ['ref', 'abc', 'statut', 'couv_sem'].includes(k) ? 1 : -1 }))
  }
  function Th({ k, children, right, title, bord }: { k: CleTri; children: React.ReactNode; right?: boolean; title?: string; bord?: boolean }) {
    const actif = tri.k === k
    return (
      <th title={title} onClick={() => basculerTri(k)} className={`cursor-pointer select-none whitespace-nowrap border-b border-[#E5E1D8] bg-[#F4F3F0] px-2 py-1.5 font-bold hover:bg-[#EDEAE1] ${right ? 'text-right' : 'text-left'} ${actif ? 'text-[#111820]' : ''} ${bord ? 'border-l border-l-[#E5E1D8]' : ''}`}>
        {children}<span className={`ml-1 text-[10px] ${actif ? 'text-[#B4761A]' : 'text-[#C9C4B8]'}`}>{actif ? (tri.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  async function figerMinMax() {
    if (!meta) return
    setFigeage('en_cours'); setErreur(null); setInfo(null)
    const { data, error } = await supabase.rpc('stock_agence_figer_minmax', { p_depot_num: String(meta.depot_num), p_ref: null })
    setFigeage('')
    if (error) { setErreur('Figer les MIN / MAX : ' + messageErreur(error)); return }
    const e = data as FigeEntete
    setInfo(`MIN / MAX figés pour ${meta.nom} : ${fmtNum(e?.nb_stocker)} référence(s) à stocker. Le fichier MIN / MAX BLG peut être extrait.`)
    await charger()
  }

  async function exporterMinMax() {
    if (!meta) return
    setExportMinMaxEnCours(true); setErreur(null)
    try {
      const { data, error } = await supabase.rpc('get_stock_agence_minmax_export', { p_depot_num: String(meta.depot_num) })
      if (error) throw error
      const ex = data as ExportMinMax
      const lignes = [...ex.rows].sort((a, b) => (ORDRE_ACTION[a.action_blg] ?? 9) - (ORDRE_ACTION[b.action_blg] ?? 9) || a.ref.localeCompare(b.ref, 'fr', { numeric: true }))
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('MIN MAX BLG')
      const cols: { h: string; f: (r: LigneMinMax) => unknown; w?: number }[] = [
        { h: 'Code entrepôt BLG', f: () => ex.meta.blg_warehouse_code, w: 14 },
        { h: 'ID entrepôt BLG', f: () => ex.meta.blg_warehouse_id, w: 12 },
        { h: 'ID article BLG', f: (r) => r.blg_id, w: 12 },
        { h: 'ID stock article BLG', f: (r) => r.blg_stock_id, w: 14 },
        { h: 'Référence', f: (r) => r.ref, w: 20 },
        { h: 'Référence BLG', f: (r) => r.blg_reference, w: 20 },
        { h: 'Désignation', f: (r) => r.designation, w: 42 },
        { h: 'MIN actuel BLG', f: (r) => r.blg_min ?? 0 },
        { h: 'MAX actuel BLG', f: (r) => r.blg_max ?? 0 },
        { h: 'Nouveau MIN', f: (r) => r.new_min },
        { h: 'Nouveau MAX', f: (r) => r.new_max },
        { h: 'Action BLG', f: (r) => r.action_blg, w: 18 },
        { h: 'MIN actuel SAGE', f: (r) => r.sage_min ?? 0 },
        { h: 'MAX actuel SAGE', f: (r) => r.sage_max ?? 0 },
        { h: 'Action SAGE', f: (r) => r.action_sage, w: 14 },
        { h: 'Stock SAGE dépôt', f: (r) => r.stock_sage },
        { h: 'Décision figée', f: (r) => DECISION_STYLE[r.decision as Decision]?.label ?? r.decision, w: 15 },
        { h: 'Saisie manuelle', f: (r) => (r.manuel ? 'Oui' : '') },
      ]
      const entete = ws.addRow(cols.map((c) => c.h))
      entete.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      entete.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } }
      const couleur: Record<string, string> = { 'Mettre à 0': 'FFFDE2E1', Nouveau: 'FFE6F4EA', Modifier: 'FFFFF4D6', 'Article absent de BLG': 'FFF4F3F0' }
      lignes.forEach((r) => {
        const row = ws.addRow(cols.map((c) => { const v = c.f(r); return v === null || v === undefined ? '' : v }))
        const fond = couleur[r.action_blg]
        if (fond) row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fond } }
        row.getCell(10).font = { bold: true }; row.getCell(11).font = { bold: true }
      })
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 11 })
      ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 1 }]
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }

      const nb = (a: string) => lignes.filter((r) => r.action_blg === a).length
      const lis = wb.addWorksheet('Lisez-moi')
      lis.getColumn(1).width = 34; lis.getColumn(2).width = 70
      ;([
        ['Dépôt', `${ex.meta.depot} (n° ${ex.meta.depot_num})`],
        ['Entrepôt BLG', `${ex.meta.blg_warehouse_code ?? '—'} — ${ex.meta.blg_warehouse_title ?? '—'} (ID ${ex.meta.blg_warehouse_id ?? '—'})`],
        ['MIN / MAX figés le', `${fmtDateHeure(ex.meta.fige_le)} par ${ex.meta.fige_par ?? '—'}`],
        ['Dernière retouche manuelle', ex.meta.maj_le ? `${fmtDateHeure(ex.meta.maj_le)} par ${ex.meta.maj_par ?? '—'}` : '—'],
        ['Extrait le', fmtDateHeure(ex.meta.extrait_le)],
        ['', ''],
        ['Nouveau', `${nb('Nouveau')} réf. — MIN / MAX à créer dans BLG`],
        ['Modifier', `${nb('Modifier')} réf. — MIN / MAX BLG à remplacer`],
        ['Mettre à 0', `${nb('Mettre à 0')} réf. — sortent du stock du dépôt : MIN = 0 et MAX = 0`],
        ['Article absent de BLG', `${nb('Article absent de BLG')} réf. — à créer dans BLG avant import`],
        ['Inchangé', `${nb('Inchangé')} réf. — rien à faire`],
        ['', ''],
        ['Règle', `Décision et MIN / MAX calculés sur les ventes immédiates du dépôt (BL sans commande ou commande ≤ ${delaiImm} j), figés sur demande dans l’écran Analyse stock dépôt.`],
      ] as [string, string][]).forEach(([a, b]) => { const r = lis.addRow([a, b]); r.getCell(1).font = { bold: true } })

      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url
      a.download = `minmax_blg_${ex.meta.nom}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Fichier MIN / MAX : ' + messageErreur(e)) } finally { setExportMinMaxEnCours(false) }
  }

  async function exporterExcel() {
    if (!analyse) return
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(`Stock ${analyse.meta.nom}`.slice(0, 31))
      const cols: { h: string; f: (r: Ligne) => unknown; w?: number }[] = [
        { h: 'Référence', f: (r) => r.ref, w: 18 }, { h: 'ID article BLG', f: (r) => r.blg_id, w: 12 }, { h: 'Désignation', f: (r) => r.designation, w: 40 },
        { h: 'Famille', f: (r) => r.famille }, { h: 'Famille macro', f: (r) => r.famille_macro }, { h: 'Fournisseur principal', f: (r) => r.fournisseur },
        { h: 'MYSTOCK', f: (r) => (r.mystock ? 'OUI' : 'NON') }, { h: 'Sommeil', f: (r) => (r.sommeil ? 'Oui' : '') }, { h: 'Blocage appro', f: (r) => (r.blocage ? 'Oui' : '') }, { h: 'Vie produit', f: (r) => r.vie_produit },
        { h: 'Classe', f: (r) => `${r.abc}${r.xyz}` },
        { h: 'Stock réel', f: (r) => r.qte }, { h: 'Préparé', f: (r) => r.prepa }, { h: 'Dispo', f: (r) => r.dispo }, { h: 'Réservé', f: (r) => r.res },
        { h: 'Commandé', f: (r) => r.cde }, { h: 'À terme', f: (r) => r.aterme }, { h: 'Transit', f: (r) => r.transit }, { h: 'Dispo FMS', f: (r) => r.fms_dispo },
        { h: 'Valeur stock', f: (r) => r.valeur }, { h: 'PU', f: (r) => r.pu },
        { h: 'Sorties 52 sem. (toutes)', f: (r) => r.q_per_tot }, { h: `Ventes immédiates 52 sem. (≤ ${delaiImm} j)`, f: (r) => r.q_per },
        { h: `Sorties sur cde > ${delaiImm} j`, f: (r) => r.q_per_cde }, { h: '% immédiat', f: (r) => pct(r.q_per, r.q_per_tot) },
        { h: 'Semaines vendues (immédiates) /52', f: (r) => r.nb_sem }, { h: 'Semaines vendues (toutes) /52', f: (r) => r.nb_sem_tot },
        { h: 'BL immédiats', f: (r) => r.nb_bl }, { h: 'Clients immédiats', f: (r) => r.nb_clients }, { h: 'BL 52 sem. (tous)', f: (r) => r.nb_bl_tot }, { h: 'Cdes > délai', f: (r) => r.nb_cde_longues },
        { h: 'μ semaine (immédiat)', f: (r) => r.mu_sem }, { h: 'σ semaine', f: (r) => r.sigma_sem }, { h: 'Pic semaine', f: (r) => r.pic_sem }, { h: 'Pics écrêtés', f: (r) => r.nb_pics },
        { h: 'Couverture (sem.)', f: (r) => r.couv_sem },
        { h: `Qté vendue depuis ${fmtDate(depuis)}`, f: (r) => r.q_depuis }, { h: `CA depuis ${fmtDate(depuis)}`, f: (r) => r.ca_depuis },
        { h: 'Qté 12 mois (nette)', f: (r) => r.q12 }, { h: 'CA 12 mois (net)', f: (r) => r.ca12 }, { h: 'Qté sortie 12 mois (brute)', f: (r) => r.q12_brut }, { h: 'CA 12 mois (brut)', f: (r) => r.ca12_brut }, { h: 'Marge 12 mois', f: (r) => r.marge12 },
        { h: 'Dernière sortie', f: (r) => fmtDate(r.derniere_sortie) }, { h: 'Dernière réception', f: (r) => fmtDate(r.derniere_reception) },
        { h: 'Délai L (j)', f: (r) => r.l_jours }, { h: 'Cycle R (j)', f: (r) => r.r_jours },
        { h: 'Décision calculée', f: (r) => DECISION_STYLE[r.decision_calc].label }, { h: 'Décision', f: (r) => DECISION_STYLE[r.decision].label }, { h: 'Statut', f: (r) => STATUT_STYLE[r.statut].label },
        { h: 'MIN calculé', f: (r) => r.min_calc }, { h: 'MAX calculé', f: (r) => r.max_calc },
        { h: fige ? 'MIN figé' : 'MIN retenu', f: (r) => r.smin }, { h: fige ? 'MAX figé' : 'MAX retenu', f: (r) => r.smax },
        { h: 'Écart calcul du jour / figé', f: (r) => (r.ecart_fige ? `${DECISION_STYLE[r.prop_decision]?.label ?? r.prop_decision} ${r.prop_min} / ${r.prop_max}` : '') },
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

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const nbFiltres = [search.trim(), rapide, decisionF, fournF, abcXyz].filter(Boolean).length + (mystockF !== 'tous' ? 1 : 0) + (stockF !== 'tous' ? 1 : 0)
  const td = 'border-t border-[#EFECE4] px-2 py-1'
  const tdG = `${td} border-l border-l-[#EFECE4]`
  const partImmGlobale = pct(kpis.qImm, kpis.qTot)

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Analyse stock {meta ? (meta.central ? 'FMS' : `agence ${meta.nom}`) : 'agence'}</h1>
            {meta && (
              <p className="text-[11.5px] text-[#8A8474]">
                Ventes au départ du dépôt « {meta.depot} » · {meta.nb_semaines} semaines du {fmtDate(meta.semaines_debut)} au {fmtDate(meta.semaines_fin)} ·
                stock SAGE du {fmtDateHeure(meta.stock_charge_le)}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {depotsUser && depotsVisibles.length <= 1 ? (
              <span className="flex h-10 items-center rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] px-3 text-[14px] font-bold" title="Dépôt de votre agence (périmètre défini dans Autorisations)">
                {depotsVisibles[0]?.nom_court || '—'}
              </span>
            ) : (
              <select value={depotNum} onChange={(e) => changerDepot(e.target.value)} className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold">
                {depotsVisibles.length === 0 && <option value={depotNum}>Dépôt {depotNum}</option>}
                {depotsVisibles.map((d) => <option key={d.depot_num} value={d.depot_num}>{d.central ? 'FMS (central)' : d.nom_court}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setVoirParams((v) => !v)} className={`h-10 rounded-lg border px-3 text-[13px] font-bold ${voirParams ? 'border-[#B4761A] text-[#96600F]' : 'border-[#E5E1D8] text-[#3A362E] hover:bg-[#F4F3F0]'}`}>⚙ Paramètres</button>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || filtres.length === 0} className="h-10 rounded-lg border border-[#111820] bg-white px-3 text-[13px] font-bold text-[#111820] disabled:opacity-50">
              {exportEnCours ? 'Export…' : `⬇ Excel analyse (${fmtNum(filtres.length)})`}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recharger les stocks et les ventes (les MIN / MAX figés ne bougent pas)" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
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
              <span className="text-[11px] text-[#8A8474]">Paramètres communs à tous les dépôts. Ils changent le « calcul du jour » ; les MIN / MAX figés ne changent qu’avec « Figer / mettre à jour ».</span>
              <button type="button" onClick={() => void enregistrerParams()} className="h-7 rounded-md bg-[#111820] px-3 text-[11.5px] font-bold text-white">Enregistrer et recalculer</button>
            </div>
          </section>
        )}

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/get_stock_agence_analyse|stock_agence_/.test(erreur) && !/figés|autorisé/.test(erreur) ? ' — la migration 20261122_stock_agence_ventes_immediates.sql est-elle appliquée ?' : ''}
          </div>
        )}

        {/* MIN / MAX figés */}
        {meta && (
          <section className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2 ${fige ? 'border-[#111820]/20 bg-white' : 'border-amber-300 bg-amber-50'}`}>
            <div className="min-w-0 text-[12.5px]">
              {fige ? (
                <>
                  <span className="mr-2 rounded-md bg-[#111820] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">MIN / MAX figés</span>
                  le <b>{fmtDateHeure(fige.fige_le)}</b> par {fige.fige_par || '—'} · <b>{fmtNum(fige.nb_stocker)}</b> réf. à stocker
                  {fige.maj_le && <span className="text-[#8A8474]"> · retouche manuelle le {fmtDateHeure(fige.maj_le)}</span>}
                  {kpis.ecarts > 0 && (
                    <button type="button" onClick={() => setRapide((v) => (v === 'ECART_FIGE' ? '' : 'ECART_FIGE'))}
                      className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${rapide === 'ECART_FIGE' ? 'bg-[#C1683C] text-white' : 'bg-[#C1683C]/15 text-[#9A4A22] hover:bg-[#C1683C]/25'}`}>
                      {fmtNum(kpis.ecarts)} écart{kpis.ecarts > 1 ? 's' : ''} avec le calcul du jour
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span className="mr-2 rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Non figés</span>
                  Les MIN / MAX affichés sont recalculés à chaque ouverture. Figez-les pour les stabiliser et extraire le fichier BLG.
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {figeage === 'confirmer' ? (
                <>
                  <span className="text-[12px] font-semibold text-[#3A362E]">{fige ? 'Remplacer les valeurs figées par le calcul du jour ?' : 'Figer le calcul du jour ?'}</span>
                  <button type="button" onClick={() => void figerMinMax()} className="h-8 rounded-lg bg-[#B4761A] px-3 text-[12.5px] font-bold text-white">Confirmer</button>
                  <button type="button" onClick={() => setFigeage('')} className="h-8 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[12.5px] font-bold">Annuler</button>
                </>
              ) : (
                <button type="button" onClick={() => setFigeage('confirmer')} disabled={loading || figeage === 'en_cours' || !analyse}
                  className={`h-8 rounded-lg px-3 text-[12.5px] font-bold disabled:opacity-50 ${fige ? 'border border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]' : 'bg-[#B4761A] text-white'}`}>
                  {figeage === 'en_cours' ? 'Calcul…' : fige ? '↻ Mettre à jour les MIN / MAX figés' : '📌 Figer les MIN / MAX'}
                </button>
              )}
              <button type="button" onClick={() => void exporterMinMax()} disabled={!fige || exportMinMaxEnCours}
                title={fige ? 'Fichier Excel : nouvelles valeurs par référence (ID BLG), mise à 0 des références qui sortent du stock' : 'Figez d’abord les MIN / MAX'}
                className="h-8 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40">
                {exportMinMaxEnCours ? 'Extraction…' : '⬇ Fichier MIN / MAX BLG'}
              </button>
            </div>
          </section>
        )}
        {info && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-800">{info}</div>}

        <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))' }}>
          <Kpi label="Valeur du stock" value={loading ? '…' : fmtEuro(kpis.valeur)} sub={`${fmtNum(kpis.refsStock)} réf. en stock · ${fmtNum(kpis.aStocker)} à stocker`} />
          <Kpi label="Sur-stock (au-delà du MAX)" value={loading ? '…' : fmtEuro(kpis.surStock)} sub={`${fmtNum(kpis.surStockRefs)} réf. à stocker en excès`} tone="warn" onClick={() => setRapide((v) => (v === 'SUR_STOCK' ? '' : 'SUR_STOCK'))} actif={rapide === 'SUR_STOCK'} />
          <Kpi label="À ne plus stocker" value={loading ? '…' : fmtEuro(kpis.destocker)} sub={`${fmtNum(kpis.destockerRefs)} réf. — stock libre (hors réservé)`} tone="alerte" onClick={() => setRapide((v) => (v === 'A_DESTOCKER' ? '' : 'A_DESTOCKER'))} actif={rapide === 'A_DESTOCKER'} />
          <Kpi label="Dormant (0 sortie 12 mois)" value={loading ? '…' : fmtEuro(kpis.dormant)} sub={`${fmtNum(kpis.dormantRefs)} réf. en stock`} tone="alerte" onClick={() => setRapide((v) => (v === 'DORMANT' ? '' : 'DORMANT'))} actif={rapide === 'DORMANT'} />
          <Kpi label="À stocker — sans stock" value={loading ? '…' : fmtNum(kpis.manquants)} sub={`${fmtEuro(kpis.manquantsValeur)} pour atteindre le MAX`} tone="alerte" onClick={() => setRapide((v) => (v === 'A_STOCKER_SANS_STOCK' ? '' : 'A_STOCKER_SANS_STOCK'))} actif={rapide === 'A_STOCKER_SANS_STOCK'} />
          <Kpi label="Sous le MIN" value={loading ? '…' : fmtNum(kpis.sousMin)} sub={`${fmtEuro(kpis.sousMinValeur)} à réapprovisionner`} tone="warn" onClick={() => setRapide((v) => (v === 'SOUS_MIN' ? '' : 'SOUS_MIN'))} actif={rapide === 'SOUS_MIN'} />
          <Kpi label="À surveiller" value={loading ? '…' : fmtNum(kpis.surveiller)} sub={`${fmtEuro(kpis.surveillerValeur)} en stock`} onClick={() => setRapide((v) => (v === 'SURVEILLER' ? '' : 'SURVEILLER'))} actif={rapide === 'SURVEILLER'} />
          <Kpi label="Ventes immédiates" value={loading ? '…' : partImmGlobale === null ? '—' : `${partImmGlobale} %`} sub={`${fmtNum(kpis.surtoutCde)} réf. vendues surtout sur commande`}
            title={`Part des sorties 52 semaines faites sans commande ou sur commande de ${delaiImm} j au plus. Clic : références vendues surtout sur commande.`}
            onClick={() => setRapide((v) => (v === 'SURTOUT_CDE' ? '' : 'SURTOUT_CDE'))} actif={rapide === 'SURTOUT_CDE'} />
        </section>

        {/* Matrice ABC × XYZ et règles — repliées par défaut */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white">
          <button type="button" onClick={basculerMatrice} className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-[#FAF8F3]">
            <span className="text-[11.5px] font-bold uppercase tracking-wide text-[#3A362E]">
              <span className="mr-1.5 inline-block w-3 text-[#B4761A]">{voirMatrice ? '▾' : '▸'}</span>
              Matrice ABC × XYZ et règles appliquées
            </span>
            <span className="truncate text-[11.5px] text-[#8A8474]">
              {abcXyz ? <b className="text-[#B4761A]">Filtre classe {abcXyz} actif · </b> : null}
              Décision sur les ventes immédiates : BL sans commande ou commande ≤ {fmtNum(delaiImm)} j · {voirMatrice ? 'réduire' : 'développer'}
            </span>
          </button>
          {voirMatrice && (
            <div className="grid gap-2.5 border-t border-[#E5E1D8] p-2.5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <MatriceAbcXyz rows={rows} filtre={abcXyz} onFiltre={setAbcXyz} />
              <div className="rounded-xl border border-[#E5E1D8] bg-white p-3 text-[12px] leading-relaxed text-[#3A362E]">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Règles appliquées</div>
                <p><b>Sorties</b> : BL au départ du dépôt (lignes facturées + BL non facturés), retours et avoirs déduits.</p>
                <p className="mt-1"><b>Ventes immédiates</b> : seules les sorties <b>sans commande</b> (BL direct, comptoir) ou issues d’une commande créée <b>{fmtNum(delaiImm)} jours au plus</b> avant le BL servent à décider du stockage et à calculer μ / σ / MIN / MAX. Une sortie sur commande plus ancienne a laissé le temps au dépôt de se faire livrer : elle reste affichée (« toutes sorties ») mais ne justifie pas un stock.</p>
                <p className="mt-1"><b>Décision</b> : à stocker si vendu immédiatement au moins {fmtNum(pm.seuil_semaines_stocker)} semaines sur {fmtNum(meta?.nb_semaines ?? 52)} ; à surveiller entre {fmtNum(pm.seuil_semaines_surveiller)} et {fmtNum(n0(pm.seuil_semaines_stocker) - 1)} ; sinon ne pas stocker. Sommeil, blocage appro SAGE, exclusion et fin de vie : jamais stockés.</p>
                <p className="mt-1"><b>MIN / MAX</b> : MYSTOCK en agence → délai couvert {fmtNum(pm.delai_mystock_jours)} j, cycle {fmtNum(pm.cycle_mystock_jours, 1)} j ; sinon délai fournisseur (défaut {fmtNum(pm.delai_hors_mystock_defaut_jours)} j). Pics au-dessus de médiane + {fmtNum(pm.pic_mad_k)} écarts robustes écrêtés. <b>Figés</b> sur demande : ils ne bougent plus à l’ouverture de l’écran.</p>
                <p className="mt-1"><b>ABC / XYZ</b> : sur toutes les sorties. <b>Sur-stock / à déstocker</b> : sur le stock libre (réel − réservé). {kpis.reserveSupStock > 0 && <span className="font-semibold text-[#8A5A08]">{fmtNum(kpis.reserveSupStock)} réf. ont plus de réservé que de stock réel.</span>}</p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'minmax(200px, 2fr) repeat(5, minmax(0, 1fr))' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation, famille, fournisseur, ID BLG…" className={`${ctl} font-medium`} />
            <select value={decisionF} onChange={(e) => setDecisionF(e.target.value as '' | Decision)} className={ctl}>
              <option value="">Décision : toutes</option>
              {(Object.keys(DECISION_STYLE) as Decision[]).map((d) => <option key={d} value={d}>{DECISION_STYLE[d].label}</option>)}
            </select>
            <select value={rapide} onChange={(e) => setRapide(e.target.value as FiltreRapide)} className={ctl}>
              <option value="">Statut : tous</option>
              {(Object.keys(STATUT_STYLE) as Statut[]).filter((s) => s !== 'HORS_STOCK' && s !== 'OK').map((s) => <option key={s} value={s}>{STATUT_STYLE[s].label}</option>)}
              <option value="DORMANT">Dormant (0 sortie 12 mois)</option>
              <option value="SURTOUT_CDE">Vendu surtout sur commande</option>
              {fige && <option value="ECART_FIGE">Écart calcul du jour / figé</option>}
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
          <div className="max-h-[calc(100vh-150px)] overflow-auto">
            <table className="w-full border-separate border-spacing-0 text-left text-[12px]">
              <thead className="sticky top-0 z-10 text-[10px] uppercase tracking-wide text-[#8A8474]">
                <tr className="text-[9.5px] tracking-[0.1em]">
                  <th colSpan={2} className="bg-[#EDEAE1] px-2 py-1 text-left font-bold text-[#3A362E]">Article</th>
                  <th colSpan={4} className="border-l border-l-[#E5E1D8] bg-[#EDEAE1] px-2 py-1 text-left font-bold text-[#3A362E]">Stock du dépôt</th>
                  <th colSpan={6} className="border-l border-l-[#E5E1D8] bg-[#E6EFE6] px-2 py-1 text-left font-bold text-[#2F6B33]" title={`Ventes immédiates = BL sans commande ou commande ≤ ${delaiImm} j : ce sont elles qui décident`}>
                    Ventes 52 semaines — <span className="normal-case tracking-normal">décision sur les ventes immédiates (≤ {fmtNum(delaiImm)} j ou sans commande)</span>
                  </th>
                  <th colSpan={4} className="border-l border-l-[#E5E1D8] bg-[#F3E9D8] px-2 py-1 text-left font-bold text-[#8A5A08]">{fige ? 'Proposition — MIN / MAX figés' : 'Proposition — MIN / MAX calculés'}</th>
                  <th colSpan={2} className="border-l border-l-[#E5E1D8] bg-[#EDEAE1] px-2 py-1 text-left font-bold text-[#3A362E]">Activité</th>
                </tr>
                <tr>
                  <Th k="ref">Référence</Th>
                  <Th k="abc" title="ABC = poids dans le CA 12 mois du dépôt ; XYZ = régularité mensuelle">Classe</Th>
                  <Th k="qte" right bord title="Stock réel — en dessous : préparé">Réel</Th>
                  <Th k="dispo" right title="Disponible = réel − préparé">Dispo</Th>
                  <Th k="res" right title="Réservé par les commandes clients — en dessous : à livrer sous 7 j">Réservé</Th>
                  <Th k="valeur" right>Valeur</Th>
                  <Th k="q_per_tot" right bord title="Toutes les sorties du dépôt sur 52 semaines — en dessous : semaines avec sortie">Toutes sorties</Th>
                  <Th k="q_per" right title={`Ventes immédiates (BL sans commande ou commande ≤ ${delaiImm} j) — en dessous : part et quantité sur commande plus ancienne`}>Immédiates</Th>
                  <Th k="nb_sem" right title="Semaines avec vente immédiate — en dessous : BL / clients">Sem. imm.</Th>
                  <Th k="mu_sem" right title="Moyenne hebdomadaire des ventes immédiates (pics écrêtés)">μ / sem.</Th>
                  <Th k="pic_sem" right title="Plus forte semaine de ventes immédiates — en dessous : pics exceptionnels écrêtés">Pic</Th>
                  <Th k="couv_sem" right title="Dispo / μ hebdomadaire">Couv.</Th>
                  <Th k="statut" bord>Décision / statut</Th>
                  <Th k="smin" right title={fige ? 'MIN / MAX figés — en orange dessous : le calcul du jour s’il diffère ; en gris : SAGE' : 'MIN / MAX retenus (calculés si rien n’est saisi) — en dessous : SAGE'}>MIN / MAX</Th>
                  <Th k="excedent_valeur" right title="Sur-stock au-delà du MAX ou stock libre à déstocker">Excédent</Th>
                  <Th k="manque_valeur" right title="Quantité pour remonter au MAX quand le stock à terme passe sous le MIN">À appro.</Th>
                  <Th k="dernier_mvt" right bord title="Dernier mouvement : sortie BL ou réception de commande fournisseur au dépôt">Dern. mvt</Th>
                  <Th k="ca12" right>CA 12 m</Th>
                </tr>
              </thead>
              <tbody>
                {filtres.slice(0, nbAffichees).map((r) => {
                  const mvt = moisDepuis(r.dernier_mvt)
                  const part = pct(r.q_per, r.q_per_tot)
                  return (
                    <tr key={r.ref} onClick={() => setRefOuverte(r.ref)} className="group cursor-pointer hover:bg-[#FAF8F3]">
                      <td className={`max-w-[320px] ${td}`}>
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[11.5px] font-bold text-[#111820] underline decoration-[#D5D0C4] decoration-dotted underline-offset-2 group-hover:decoration-[#B4761A]">{r.ref}</span>
                          {r.mystock && <Badge cls="bg-emerald-50 text-emerald-700">MYSTOCK</Badge>}
                          {r.blocage && <Badge cls="bg-red-600 text-white">⛔</Badge>}
                          {r.sommeil && <Badge cls="bg-[#F4F3F0] text-[#8A8474]">zz</Badge>}
                          {r.vie_produit && <Badge cls="bg-orange-100 text-orange-700">{r.vie_produit}</Badge>}
                        </span>
                        <span className="block truncate text-[10.5px] text-[#5E5A50]">{r.designation || '—'}</span>
                        <span className="block truncate font-mono text-[9.5px] text-[#A39D8F]">{r.fournisseur || '—'}{r.blg_id ? ` · BLG ${r.blg_id}` : ' · absent de BLG'}</span>
                      </td>
                      <td className={td}><span className={`rounded px-1.5 py-0.5 text-[10.5px] font-bold ${r.abc === 'A' ? 'bg-emerald-50 text-emerald-700' : r.abc === 'B' ? 'bg-sky-50 text-sky-700' : 'bg-[#F4F3F0] text-[#8A8474]'}`}>{r.abc}{r.xyz}</span></td>
                      <td className={`${tdG} text-right`}><span className="font-semibold">{fmtNum(r.qte)}</span>{r.prepa ? <div className="text-[10px] text-[#8A8474]">PL {fmtNum(r.prepa)}</div> : null}</td>
                      <td className={`${td} text-right font-semibold ${r.dispo <= 0 && r.decision === 'STOCKER' ? 'text-red-700' : ''}`}>{fmtNum(r.dispo)}{r.transit ? <div className="text-[10px] font-normal text-[#8A8474]">transit {fmtNum(r.transit)}</div> : null}</td>
                      <td className={`${td} text-right ${r.res > r.qte ? 'font-semibold text-[#8A5A08]' : ''}`}>{r.res ? fmtNum(r.res) : '—'}{r.cdc_7j ? <div className="text-[10px] text-[#8A8474]">≤ 7 j {fmtNum(r.cdc_7j)}</div> : null}</td>
                      <td className={`${td} text-right`}>{r.qte > 0 ? fmtEuro(r.valeur) : '—'}</td>
                      <td className={`${tdG} text-right text-[#5E5A50]`}>{r.q_per_tot ? fmtNum(r.q_per_tot) : '—'}{r.nb_sem_tot ? <div className="text-[10px] text-[#8A8474]">{fmtNum(r.nb_sem_tot)} sem.</div> : null}</td>
                      <td className={`${td} bg-[#F4F9F4] text-right`}>
                        <span className="font-bold text-[#111820]">{r.q_per_tot ? fmtNum(r.q_per) : '—'}</span>
                        {r.q_per_tot ? <div className={`text-[10px] ${part !== null && part < 50 ? 'font-semibold text-[#C1683C]' : 'text-[#8A8474]'}`}>{part ?? '—'} %{r.q_per_cde > 0 ? ` · ${fmtNum(r.q_per_cde)} sur cde` : ''}</div> : null}
                      </td>
                      <td className={`${td} bg-[#F4F9F4] text-right`}><span className="font-semibold">{fmtNum(r.nb_sem)}</span>{r.nb_bl ? <div className="text-[10px] text-[#8A8474]">{fmtNum(r.nb_bl)} BL · {fmtNum(r.nb_clients)} cl.</div> : null}</td>
                      <td className={`${td} bg-[#F4F9F4] text-right`}>{r.mu_sem ? fmtNum(r.mu_sem, 1) : '—'}</td>
                      <td className={`${td} bg-[#F4F9F4] text-right`}>{r.pic_sem ? fmtNum(r.pic_sem) : '—'}{r.nb_pics ? <div className="text-[10px] font-semibold text-[#C1683C]">{r.nb_pics} pic{r.nb_pics > 1 ? 's' : ''}</div> : null}</td>
                      <td className={`${td} bg-[#F4F9F4] text-right`}>{r.couv_sem === null ? '—' : `${fmtNum(r.couv_sem, 1)} s`}</td>
                      <td className={tdG}>
                        <div className="flex flex-col items-start gap-0.5">
                          <Badge cls={STATUT_STYLE[r.statut].cls}>{STATUT_STYLE[r.statut].label}</Badge>
                          {r.decision_forcee && <span className="text-[9.5px] font-bold text-[#8A5A08]">décision forcée</span>}
                        </div>
                      </td>
                      <td className={`${td} text-right`}>
                        {r.decision === 'STOCKER' ? <span className={`font-bold ${r.min_retenu !== null || r.max_retenu !== null ? 'text-[#8A5A08]' : ''}`}>{fmtNum(r.smin)} / {fmtNum(r.smax)}</span> : <span className="text-[#C9C4B8]">0 / 0</span>}
                        {r.ecart_fige && <div className="text-[10px] font-semibold text-[#C1683C]" title="Calcul du jour (non figé)">calc. {r.prop_decision === 'STOCKER' ? `${fmtNum(r.prop_min)} / ${fmtNum(r.prop_max)}` : DECISION_STYLE[r.prop_decision]?.label.toLowerCase()}</div>}
                        {(r.sage_min || r.sage_max) ? <div className="text-[10px] text-[#8A8474]">SAGE {fmtNum(r.sage_min)} / {fmtNum(r.sage_max)}</div> : null}
                      </td>
                      <td className={`${td} text-right`}>{r.excedent_valeur > 0 ? <span className="font-semibold text-[#8A5A08]">{fmtEuro(r.excedent_valeur)}<div className="text-[10px] font-normal text-[#8A8474]">{fmtNum(r.excedent_qte)} p.</div></span> : '—'}</td>
                      <td className={`${td} text-right`}>{r.manque_qte > 0 ? <span className="font-semibold text-red-700">{fmtNum(r.manque_qte)} p.<div className="text-[10px] font-normal text-[#8A8474]">{fmtEuro(r.manque_valeur)}</div></span> : '—'}</td>
                      <td className={`whitespace-nowrap ${tdG} text-right ${mvt === null || mvt >= 12 ? 'font-semibold text-red-700' : mvt >= 6 ? 'text-[#96600F]' : 'text-[#5E5A50]'}`}>{r.dernier_mvt ? fmtDate(r.dernier_mvt) : 'Aucun'}</td>
                      <td className={`${td} text-right`}>{r.ca12 ? fmtEuro(r.ca12) : '—'}</td>
                    </tr>
                  )
                })}
                {!loading && filtres.length === 0 && <tr><td colSpan={18} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence pour ces filtres.</td></tr>}
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
        <ArticleModal depotNum={String(meta?.depot_num ?? depotNum)} depuis={depuis} ligne={ligneOuverte} delaiImm={delaiImm} depotFige={!!fige}
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
