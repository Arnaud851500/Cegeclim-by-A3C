'use client'

/**
 * Écran « Allocation AirH2O 600 / 800 » (menu Stocks & logistique, /stock/allocation-airh2o).
 * ---------------------------------------------------------------------------
 * Créé le 24/10/2026 à partir du tableau Excel validé par Arnaud le même jour.
 * Accès réservé : Julien Ithurbide, Stéphane Chanteau, Jean-Marc Ladeuix, Arnaud
 * (menu : lib/allocationRo.ts ; données : table stock_alloc_ro_acces, vérifiée par la base).
 *
 * Une ligne par groupe extérieur AirH2O 600 / 800 du catalogue 2026, tailles ≥ 3,5 :
 *  - STOCK : Dispo (Phy-PL), Arrivage de l'année, A attribuer = Dispo + Arrivage (24/10 soir, demandé par Arnaud),
 *    Attribué = somme des allocations saisies ;
 *  - TOTAL VENTES puis un bloc par agence (ANGLET hors Julien Ithurbide, Julien Ithurbide,
 *    puis chaque agence) : BL du mois précédent, BL du mois, PL en cours, CDC à livrer d'ici
 *    le 31/12 (retards compris) et « Allocation 2026 » (saisie partagée, enregistrée
 *    à la sortie du champ) ;
 *  - un clic sur un chiffre ouvre le détail des lignes (CDC, PL, BL) ;
 *  - vue compacte : par agence, seulement CDC Liv et Alloc.
 *
 * Code couleur : A attribuer < 0 rouge, = 0 orange, > 0 vert ; Attribué > A attribuer rouge
 * (sur-allocation), = vert, < orange ; cases d'allocation jaunes.
 *
 * 24/10/2026 (suite) : filtre Split / Monobloc, ordre des lignes taille → mono puis tri → split puis monobloc,
 * et onglets de détail (comme le fichier Excel) : CDC à livrer (année + année suivante), BL du mois précédent et
 * du mois, CDC créées depuis 7 jours (livrées, en préparation ou à livrer, avec les CDC plus anciennes passées
 * derrière), Julien Ithurbide, Arrivages par mois — chacun filtrable par agence / recherche et exportable.
 *
 * 25/10/2026 : le bloc « Julien. Ith » cumule SAV / JMLADEUIX (CDC, BL, PL et allocations), côté base.
 *
 * 26/10/2026 :
 *  - onglet « SAV / JMLADEUIX » retiré (le bloc reste dans le tableau) ;
 *  - la fenêtre de détail des CDC affiche « Livrable à la date demandée » ;
 *  - accès élargi : droit de profil « Allocation AirH2O 600 / 800 » (Autorisations) → la personne ne voit
 *    que les agences de son périmètre, sans les colonnes de stock, allocations en lecture seule
 *    (filtrage fait par la base) ; la vue complète et la saisie restent réservées aux 4 personnes ;
 *  - période d'allocation : BL sept., BL oct. arrêtés au 25/10, nouvelle colonne « BL + PL depuis le 26/10 »
 *    (PL encours = PL créées avant le 26/10) ; contrôle : depuis 26/10 + CDC Liv ≤ Allocation (sinon rouge).
 *
 * Sources : RPC get_allocation_ro / set_allocation_ro (supabase/sql/20261024_allocation_airh2o.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type RefRow = {
  ref: string; designation: string | null; gamme: '600' | '800'; taille: number; alim: string; prix: number | null
  /** null en vue agence (colonnes de stock non transmises). */
  reel: number | null; prepa: number | null; dispo: number | null; arrivage_annee: number | null
  arrivages: { mois: string; q: number; cdf: string }[]
  dispo_fin_dec_ecran: number | null
}
type Valeur = { ref: string; bloc: string; bl_m1: number; bl_m: number; pl: number; post: number; cdc: number; cdc_suiv: number }
type Alloc = { ref: string; bloc: string; quantite: number; updated_at: string; updated_by: string | null }
/** POST_BL / POST_PL : BL datés et PL créées depuis le début de la période d'allocation (26/10). */
type Nature = 'CDC' | 'CDC_ANNEE_SUIVANTE' | 'PL' | 'BL_M' | 'BL_M1' | 'POST_BL' | 'POST_PL'
type LigneDoc = {
  ref: string; bloc: string; nature: Nature; piece: string; cdc: string | null; date_cdc: string | null; date_piece?: string | null
  date_livraison: string | null; date_bl: string | null; q: number; montant_ht: number | null
  tiers: string | null; client: string | null; representant: string | null; agence: string | null
  /** CDC : couverture à la date demandée (v_portefeuille_couverture_stock). */
  couv_statut?: 'COUVERT' | 'COUVERT_PAR_RECEPTION' | 'RECEPTION_TARDIVE' | 'RUPTURE' | 'A_COUVRIR_PAR_APPRO' | null
  couv_cdf?: string | null; couv_date?: string | null; couv_retard?: number | null
}
type Donnees = {
  genere_le: string; import_sage_le: string | null; fin_annee: string; mois_m1: string; mois_m: string
  debut_alloc?: string
  /** complet : vue et saisie (liste nominative) ; agence : agences du périmètre, lecture seule, sans stock. */
  mode?: 'complet' | 'agence'; blocs_user?: string[]
  refs: RefRow[]; blocs: string[]; valeurs: Valeur[]; allocations: Alloc[]; lignes: LigneDoc[]
}
type Metrique = 'bl_m1' | 'bl_m' | 'pl' | 'post' | 'cdc'
const estBl = (n: Nature) => n === 'BL_M' || n === 'BL_M1' || n === 'POST_BL'
const estPl = (n: Nature) => n === 'PL' || n === 'POST_PL'
type Detail = { titre: string; ref: string | null; bloc: string | null; natures: Nature[] }

// ─────────────────────────────────────────────────────────────────────────
// Helpers & palette
// ─────────────────────────────────────────────────────────────────────────

const TOTAL = '__TOTAL__'
const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const libMois = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T12:00:00`); return NOMS_MOIS[d.getMonth()] }
const libMoisAnnee = (ym: string) => `${NOMS_MOIS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`
function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 })
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR')
}
function fmtDateHeure(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as { message?: string; details?: string; hint?: string; code?: string }
    return [o.message, o.details, o.hint, o.code ? `(${o.code})` : null].filter(Boolean).join(' — ') || JSON.stringify(e)
  }
  return String(e)
}
const n0 = (v: unknown) => Number(v ?? 0) || 0

function libBloc(b: string): string {
  if (b === 'ANGLET') return 'ANGLET'
  if (b === 'JITHURBIDE') return 'SAV / JMLADEUIX'   // 25/10/2026 : bloc cumulé, libellé demandé par Arnaud
  if (b === TOTAL) return 'TOTAL VENTES'
  return b
}
/** Couleurs par bloc : [en-tête, sous-en-tête, fond des cellules]. */
const PAL: [string, string, string][] = [
  ['#2F7D5B', '#D3ECDF', '#EEF8F2'], ['#7A5EA8', '#E3DAF1', '#F4F0FA'], ['#B4761A', '#F5E3C4', '#FBF4E8'], ['#1F7A8C', '#CFE9EE', '#EDF7F9'],
  ['#8C3B5E', '#EFD3DF', '#F8EEF2'], ['#4F6D2E', '#DDE8CF', '#F2F7EC'], ['#A0522D', '#F1DCCF', '#F9F0EA'], ['#3D5A99', '#D8E0F1', '#EEF2FA'],
]
const C_STOCK: [string, string, string] = ['#1D5C86', '#D6E6F2', '#EEF5FA']
const C_TOTAL: [string, string, string] = ['#5E5A50', '#E5E1D8', '#F7F5F0']

function clsAAttribuer(v: number): string {
  if (v < 0) return 'bg-[#F4B6B0] text-[#9B1C1C]'
  if (v === 0) return 'bg-[#FBE3B5] text-[#8A5A08]'
  return 'bg-[#C9EBD4] text-[#1E6B3A]'
}
function clsAttribue(attr: number, aAtt: number): string {
  if (attr <= 0) return 'text-[#8A8474]'
  const plafond = Math.max(aAtt, 0)
  if (attr > plafond) return 'bg-[#F4B6B0] text-[#9B1C1C]'
  if (attr === plafond) return 'bg-[#C9EBD4] text-[#1E6B3A]'
  return 'bg-[#FBE3B5] text-[#8A5A08]'
}

// ─────────────────────────────────────────────────────────────────────────
// Cellule d'allocation (saisie)
// ─────────────────────────────────────────────────────────────────────────

function CelluleAlloc({ valeur, info, onSave }: { valeur: number; info?: Alloc; onSave: (q: number) => Promise<void> }) {
  const [texte, setTexte] = useState(valeur ? String(valeur) : '')
  const [etat, setEtat] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [focus, setFocus] = useState(false)
  const affiche = focus ? texte : valeur ? String(valeur) : ''
  async function valider() {
    setFocus(false)
    const q = texte.trim() === '' ? 0 : Number(texte.replace(',', '.'))
    if (!Number.isFinite(q) || q < 0) { setTexte(valeur ? String(valeur) : ''); return }
    if (q === valeur) return
    setEtat('saving')
    try { await onSave(q); setEtat('ok'); window.setTimeout(() => setEtat('idle'), 1200) } catch { setEtat('err') }
  }
  return (
    <input
      inputMode="numeric"
      value={affiche}
      onFocus={() => { setFocus(true); setTexte(valeur ? String(valeur) : '') }}
      onChange={(e) => setTexte(e.target.value.replace(/[^\d.,]/g, ''))}
      onBlur={() => void valider()}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTexte(valeur ? String(valeur) : ''); (e.target as HTMLInputElement).blur() } }}
      title={info ? `Saisi le ${fmtDateHeure(info.updated_at)}${info.updated_by ? ` par ${info.updated_by}` : ''}` : 'Allocation de l’année pour cette agence'}
      className={`h-7 w-full min-w-[46px] rounded border text-center text-[12.5px] font-bold text-[#0000CC] outline-none focus:border-[#1D5C86] focus:bg-white
        ${etat === 'err' ? 'border-red-500 bg-red-50' : etat === 'ok' ? 'border-emerald-500 bg-emerald-50' : etat === 'saving' ? 'border-[#B4761A] bg-[#FFF2B3]' : 'border-[#E8D27A] bg-[#FFF2B3]'}`}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre de détail des lignes
// ─────────────────────────────────────────────────────────────────────────

const LIB_NATURE: Record<Nature, string> = {
  CDC: 'CDC à livrer', CDC_ANNEE_SUIVANTE: 'CDC année suivante', PL: 'En préparation (PL)', BL_M: 'BL oct. (jusqu’au 25/10)', BL_M1: 'BL sept.',
  POST_BL: 'BL depuis le 26/10', POST_PL: 'PL créée depuis le 26/10',
}

function DetailModal({ detail, lignes, onClose }: { detail: Detail; lignes: LigneDoc[]; onClose: () => void }) {
  const liste = useMemo(() => lignes.filter((l) =>
    (!detail.ref || l.ref === detail.ref) && (!detail.bloc || detail.bloc === TOTAL || l.bloc === detail.bloc) && detail.natures.includes(l.nature),
  ), [lignes, detail])
  const total = liste.reduce((s, l) => s + n0(l.q), 0)
  // 26/10/2026 : même information que l'onglet « CDC à livrer »
  const avecCouv = detail.natures.some((n) => n === 'CDC' || n === 'CDC_ANNEE_SUIVANTE')
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E1D8] px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">Détail</p>
            <h2 className="text-[17px] font-bold">{detail.titre}</h2>
            <p className="text-[12px] text-[#8A8474]">{fmtNum(liste.length)} ligne(s) · {fmtNum(total)} groupe(s)</p>
          </div>
          <button type="button" onClick={onClose} className="h-8 rounded-md bg-[#111820] px-3 text-[13px] font-bold text-white">Fermer</button>
        </div>
        <div className="overflow-y-auto p-3">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-white"><tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474]">
              <th className="px-1.5 py-1">Nature</th><th className="px-1.5">Référence</th><th className="px-1.5">Pièce</th><th className="px-1.5">N° CDC</th>
              <th className="px-1.5">Date CDC</th><th className="px-1.5">Livraison demandée</th>
              {avecCouv ? <th className="px-1.5">Livrable à la date demandée</th> : <th className="px-1.5">Date BL</th>}
              <th className="px-1.5 text-right">Qté</th><th className="px-1.5">Client</th><th className="px-1.5">Représentant</th><th className="px-1.5">Agence</th>
            </tr></thead>
            <tbody>
 {liste.length === 0 && <tr><td colSpan={11} className="px-2 py-6 text-center text-[#8A8474]">Aucune ligne.</td></tr>}
              {liste.map((l, i) => (
                <tr key={`${l.piece}-${l.ref}-${i}`} className={`border-t border-[#F0EDE6] ${l.bloc === 'JITHURBIDE' ? 'bg-[#F4F0FA]' : ''}`}>
                  <td className="whitespace-nowrap px-1.5 py-0.5">{LIB_NATURE[l.nature]}</td>
                  <td className="whitespace-nowrap px-1.5 font-semibold">{l.ref}</td>
                  <td className="whitespace-nowrap px-1.5">{l.piece}</td>
                  <td className="whitespace-nowrap px-1.5">{l.cdc || '—'}</td>
                  <td className="whitespace-nowrap px-1.5">{fmtDate(l.date_cdc)}</td>
                  <td className="whitespace-nowrap px-1.5">{fmtDate(l.date_livraison)}</td>
                  {avecCouv
                    ? <td className={`whitespace-nowrap px-1.5 ${clsCouverture(l)}`}>{libCouverture(l) ?? '—'}</td>
                    : <td className="whitespace-nowrap px-1.5">{fmtDate(l.date_bl)}</td>}
                  <td className="px-1.5 text-right font-bold">{fmtNum(l.q)}</td>
                  <td className="max-w-[260px] truncate px-1.5" title={`${l.tiers || ''} ${l.client || ''}`}>{l.client || l.tiers}</td>
                  <td className="whitespace-nowrap px-1.5">{l.representant || '—'}</td>
                  <td className="whitespace-nowrap px-1.5">{libBloc(l.bloc)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Listes de détail (onglets)
// ─────────────────────────────────────────────────────────────────────────

type Onglet = 'tableau' | 'cdc' | 'bl' | 'recentes' | 'arrivages'
type Col<T> = {
  h: string; v: (x: T) => string | number | null; cls?: (x: T) => string; right?: boolean; date?: boolean; w?: number
  /** Valeur de tri (à défaut : v). */
  s?: (x: T) => string | number | null
}

/** Livrable à la date demandée ? (CDC à livrer) */
function libCouverture(l: LigneDoc): string | null {
  if (estPl(l.nature)) return 'Préparée (stock réservé)'
  if (l.nature !== 'CDC' && l.nature !== 'CDC_ANNEE_SUIVANTE') return null
  const dc = l.couv_date ? fmtDate(l.couv_date) : null
  switch (l.couv_statut) {
    case 'COUVERT': return 'Stock actuel'
    case 'COUVERT_PAR_RECEPTION': return `Via ${l.couv_cdf || 'CDF'} · à l’heure${dc ? ` (dispo le ${dc})` : ''}`
    case 'RECEPTION_TARDIVE': return `Via ${l.couv_cdf || 'CDF'} · retard ${fmtNum(l.couv_retard)} j${dc ? ` (dispo le ${dc})` : ''}`
    case 'RUPTURE': return 'Rupture : aucune CDF suffisante'
    case 'A_COUVRIR_PAR_APPRO': return 'À couvrir par un nouvel appro'
    default: return '—'
  }
}
function clsCouverture(l: LigneDoc): string {
  if (estPl(l.nature)) return 'text-sky-800'
  switch (l.couv_statut) {
    case 'COUVERT': return 'font-semibold text-[#1E6B3A]'
    case 'COUVERT_PAR_RECEPTION': return 'font-semibold text-[#1D5C86]'
    case 'RECEPTION_TARDIVE': return 'font-bold text-orange-700'
    case 'RUPTURE': return 'font-bold text-red-700'
    case 'A_COUVRIR_PAR_APPRO': return 'font-semibold text-violet-800'
    default: return ''
  }
}
/** Ordre de tri : du plus critique au plus sûr. */
function rangCouverture(l: LigneDoc): number {
  if (estPl(l.nature)) return 6
  return ({ RUPTURE: 0, RECEPTION_TARDIVE: 1, A_COUVRIR_PAR_APPRO: 2, COUVERT_PAR_RECEPTION: 3, COUVERT: 4 } as Record<string, number>)[l.couv_statut || ''] ?? 5
}

const STATUT_NATURE: Record<Nature, string> = {
  CDC: 'À livrer', CDC_ANNEE_SUIVANTE: 'À livrer (année suivante)', PL: 'En préparation (PL)', BL_M: 'Livrée (BL)', BL_M1: 'Livrée (BL)',
  POST_BL: 'Livrée (BL)', POST_PL: 'En préparation (PL)',
}

async function exporterListe<T>(nom: string, cols: Col<T>[], rows: T[]) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(nom.slice(0, 30))
  ws.addRow(cols.map((c) => c.h)).font = { bold: true }
  rows.forEach((r) => ws.addRow(cols.map((c) => {
    const v = c.v(r)
    if (c.date && typeof v === 'string' && v) return new Date(`${v.slice(0, 10)}T12:00:00`)
    return v === null || v === undefined ? '' : v
  })))
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.w || 13
    if (c.date) ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy'
  })
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
  const buffer = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = `${nom.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
}

function ListeDetail<T>({ titre, sousTitre, cols, rows, cle, rowCls, totalQte }: {
  titre: string; sousTitre?: string; cols: Col<T>[]; rows: T[]; cle: (x: T, i: number) => string
  rowCls?: (x: T) => string; totalQte?: number
}) {
  // 26/10/2026 : tri sur la colonne choisie (clic sur l'en-tête, second clic = ordre inverse)
  const [tri, setTri] = useState<{ i: number; dir: 1 | -1 } | null>(null)
  const triees = useMemo(() => {
    if (!tri) return rows
    const c = cols[tri.i]
    const val = c.s || c.v
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === null || va === undefined || va === '') return 1
      if (vb === null || vb === undefined || vb === '') return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * tri.dir
      return String(va).localeCompare(String(vb), 'fr', { numeric: true }) * tri.dir
    })
  }, [rows, cols, tri])
  return (
    <section className="rounded-xl border border-[#E5E1D8] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E1D8] px-4 py-2">
        <div>
          <h2 className="text-[15px] font-bold">{titre}</h2>
          <p className="text-[11.5px] text-[#8A8474]">{fmtNum(rows.length)} ligne(s){totalQte !== undefined ? ` · ${fmtNum(totalQte)} groupe(s)` : ''}{sousTitre ? ` · ${sousTitre}` : ''}</p>
        </div>
        <button type="button" onClick={() => void exporterListe(titre, cols, triees)} disabled={rows.length === 0}
          className="h-9 rounded-lg bg-[#111820] px-3 text-[12.5px] font-bold text-white disabled:opacity-40">⬇ Excel ({fmtNum(rows.length)})</button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 300px)' }}>
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-[#E5E1D8] text-left text-[10.5px] font-bold uppercase tracking-wide text-[#8A8474]">
              {cols.map((c, i) => (
                <th key={c.h} onClick={() => setTri((x) => (x && x.i === i ? { i, dir: (x.dir === 1 ? -1 : 1) as 1 | -1 } : { i, dir: 1 }))}
                  title="Trier sur cette colonne"
                  className={`cursor-pointer select-none whitespace-nowrap px-2 py-1.5 hover:text-[#3A362E] ${c.right ? 'text-right' : ''} ${tri?.i === i ? 'text-[#1D5C86]' : ''}`}>
                  {c.h}{tri?.i === i ? (tri.dir === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {triees.length === 0 && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-[#8A8474]">Aucune ligne avec ces filtres.</td></tr>}
            {triees.map((r, i) => (
              <tr key={cle(r, i)} className={`border-b border-[#F0EDE6] ${rowCls ? rowCls(r) : ''}`}>
                {cols.map((c) => {
                  const v = c.v(r)
                  return (
                    <td key={c.h} className={`whitespace-nowrap px-2 py-1 ${c.right ? 'text-right' : ''} ${c.cls ? c.cls(r) : ''}`}>
                      {c.date ? fmtDate(v as string | null) : typeof v === 'number' ? fmtNum(v) : (v ?? '—')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function AllocationAirH2O() {
  const { rights, loading: accessLoading } = useAccess()
  const [d, setD] = useState<Donnees | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [allocs, setAllocs] = useState<Map<string, Alloc>>(new Map())
  const [compact, setCompact] = useState(false)
  const [masquerVides, setMasquerVides] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [typeF, setTypeF] = useState<'' | '600' | '800'>('600')   // par défaut : AirH2O 600 (Split)
  const [onglet, setOnglet] = useState<Onglet>('tableau')
  const [agenceF, setAgenceF] = useState('')
  const [search, setSearch] = useState('')
  const [exportEnCours, setExportEnCours] = useState(false)

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_allocation_ro')
    if (error) { setErreur(messageErreur(error)); setD(null) }
    else {
      const res = data as Donnees
      setD(res)
      setAllocs(new Map(res.allocations.map((a) => [`${a.ref}|${a.bloc}`, a])))
    }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  const valeurs = useMemo(() => {
    const m = new Map<string, Valeur>()
    d?.valeurs.forEach((v) => m.set(`${v.ref}|${v.bloc}`, v))
    return m
  }, [d])
  const val = useCallback((ref: string, bloc: string, k: Metrique): number => {
    if (!d) return 0
    if (bloc === TOTAL) return d.blocs.reduce((s, b) => s + n0(valeurs.get(`${ref}|${b}`)?.[k]), 0)
    return n0(valeurs.get(`${ref}|${bloc}`)?.[k])
  }, [d, valeurs])
  const alloc = useCallback((ref: string, bloc: string) => n0(allocs.get(`${ref}|${bloc}`)?.quantite), [allocs])

  // Ordre : taille, puis monophasé avant triphasé, puis Split (600) avant Monobloc (800) ; filtre de type
  const refsVis = useMemo(() => [...(d?.refs || [])]
    .filter((r) => !typeF || r.gamme === typeF)
    .sort((a, b) => a.taille - b.taille || (/230|mono/i.test(a.alim) ? 0 : 1) - (/230|mono/i.test(b.alim) ? 0 : 1) || a.gamme.localeCompare(b.gamme)), [d, typeF])
  const refsSet = useMemo(() => new Set(refsVis.map((r) => r.ref)), [refsVis])

  const blocs = useMemo(() => {
    if (!d) return [] as string[]
    if (!masquerVides) return d.blocs
    return d.blocs.filter((b) => b === 'ANGLET' || b === 'JITHURBIDE' || refsVis.some((r) => (['bl_m1', 'bl_m', 'pl', 'post', 'cdc'] as Metrique[]).some((k) => val(r.ref, b, k) !== 0) || alloc(r.ref, b) !== 0))
  }, [d, masquerVides, val, alloc, refsVis])

  const lignes = useMemo(() => refsVis.map((r) => {
    const cdc = val(r.ref, TOTAL, 'cdc')
    // 24/10/2026 soir (Arnaud) : A attribuer = Dispo (Phy-PL) + Arrivage de l'année (les CDC ne sont plus déduites)
    // 26/10/2026 (Arnaud) : + BL et PL créés depuis le début de période (26/10), qui ont réduit le Dispo :
    // la quantité à attribuer reste ainsi figée au 26/10.
    const aAtt = n0(r.dispo) + n0(r.arrivage_annee) + val(r.ref, TOTAL, 'post')
    const attr = (d?.blocs || []).reduce((s, b) => s + alloc(r.ref, b), 0)
    return { r, cdc, aAtt, attr }
  }), [refsVis, d, val, alloc])

  const tot = useMemo(() => ({
    dispo: lignes.reduce((s, l) => s + n0(l.r.dispo), 0),
    arr: lignes.reduce((s, l) => s + n0(l.r.arrivage_annee), 0),
    aAtt: lignes.reduce((s, l) => s + l.aAtt, 0),
    attr: lignes.reduce((s, l) => s + l.attr, 0),
  }), [lignes])
  const totBloc = useCallback((bloc: string, k: Metrique) => refsVis.reduce((s, r) => s + val(r.ref, bloc, k), 0), [refsVis, val])
  const totAlloc = useCallback((bloc: string) => refsVis.reduce((s, r) => s + alloc(r.ref, bloc), 0), [refsVis, alloc])

  async function sauverAlloc(ref: string, bloc: string, q: number) {
    const { error } = await supabase.rpc('set_allocation_ro', { p_reference: ref, p_bloc: bloc, p_quantite: q })
    if (error) { setErreur(`Enregistrement de l’allocation : ${messageErreur(error)}`); throw error }
    setAllocs((prev) => {
      const m = new Map(prev)
      if (q === 0) m.delete(`${ref}|${bloc}`)
      else m.set(`${ref}|${bloc}`, { ref, bloc, quantite: q, updated_at: new Date().toISOString(), updated_by: 'vous' })
      return m
    })
  }

  const annee = d ? d.fin_annee.slice(0, 4) : ''

  // ── Listes de détail ──
  const refInfo = useMemo(() => new Map((d?.refs || []).map((r) => [r.ref, r])), [d])
  const docsFiltres = useMemo(() => {
    const s = search.trim().toUpperCase()
    return (d?.lignes || []).filter((l) => refsSet.has(l.ref)
      && (!agenceF || l.bloc === agenceF)
      && (!s || `${l.ref} ${l.piece} ${l.cdc} ${l.client} ${l.tiers} ${l.representant}`.toUpperCase().includes(s)))
  }, [d, refsSet, agenceF, search])
  const listeCdc = useMemo(() => docsFiltres.filter((l) => l.nature === 'CDC' || l.nature === 'CDC_ANNEE_SUIVANTE' || estPl(l.nature))
    .sort((a, b) => (refsVis.findIndex((r) => r.ref === a.ref) - refsVis.findIndex((r) => r.ref === b.ref)) || (a.date_livraison || '9999').localeCompare(b.date_livraison || '9999')), [docsFiltres, refsVis])
  const listeBl = useMemo(() => docsFiltres.filter((l) => estBl(l.nature))
    .sort((a, b) => (a.date_bl || '').localeCompare(b.date_bl || '') || a.ref.localeCompare(b.ref)), [docsFiltres])
  const depuis = useMemo(() => { const x = new Date(); x.setDate(x.getDate() - 7); return x.toISOString().slice(0, 10) }, [])
  const listeRecentes = useMemo(() => {
    const ouvertes = (d?.lignes || []).filter((l) => l.nature === 'CDC' || l.nature === 'CDC_ANNEE_SUIVANTE')
    const ordre: Record<Nature, number> = { BL_M: 0, BL_M1: 0, POST_BL: 0, PL: 1, POST_PL: 1, CDC: 2, CDC_ANNEE_SUIVANTE: 2 }
    return docsFiltres.filter((l) => (l.date_cdc || '') >= depuis)
      .map((l) => {
        const lim = l.date_bl || l.date_livraison || '9999-12-31'
        const plusAnciennes = ouvertes.filter((o) => o.ref === l.ref && o.cdc !== l.cdc && (o.date_cdc || '') < (l.date_cdc || ''))
        return { ...l, anciennes: plusAnciennes.length, anciennesDues: plusAnciennes.filter((o) => (o.date_livraison || '0000') <= lim).length }
      })
      .sort((a, b) => ordre[a.nature] - ordre[b.nature] || (a.date_cdc || '').localeCompare(b.date_cdc || ''))
  }, [d, docsFiltres, depuis])
  const listeArrivages = useMemo(() => refsVis.flatMap((r) => r.arrivages.map((a) => ({ ref: r.ref, type: r.gamme === '600' ? 'Split' : 'Monobloc', taille: r.taille, alim: r.alim, ...a })))
    .filter((a) => !search.trim() || `${a.ref} ${a.cdf}`.toUpperCase().includes(search.trim().toUpperCase())), [refsVis, search])

  type LR = LigneDoc & { anciennes?: number; anciennesDues?: number }
  const colRef: Col<LR>[] = [
    { h: 'Référence', v: (l) => l.ref, cls: () => 'font-semibold', w: 16 },
    { h: 'Type', v: (l) => (refInfo.get(l.ref)?.gamme === '600' ? 'Split' : 'Monobloc'), w: 10 },
    { h: 'Taille', v: (l) => String(refInfo.get(l.ref)?.taille ?? '').replace('.', ','), w: 7 },
    { h: 'Alim.', v: (l) => refInfo.get(l.ref)?.alim ?? '', w: 11 },
  ]
  const colClient: Col<LR>[] = [
    { h: 'Qté', v: (l) => n0(l.q), right: true, cls: () => 'font-bold', w: 6 },
    { h: 'Montant HT', v: (l) => n0(l.montant_ht), right: true, w: 11 },
    { h: 'N° client', v: (l) => l.tiers, w: 10 },
    { h: 'Client', v: (l) => l.client, w: 30 },
    { h: 'Représentant', v: (l) => l.representant, w: 15 },
    { h: 'Agence', v: (l) => libBloc(l.bloc), w: 18 },
  ]
  const colsCdc: Col<LR>[] = [...colRef,
    { h: 'Statut', v: (l) => (estPl(l.nature) ? 'En préparation (PL)' : l.nature === 'CDC' ? `À livrer ${annee}` : `À livrer ${Number(annee) + 1}`),
      cls: (l) => (estPl(l.nature) ? 'text-sky-800' : l.nature === 'CDC' ? 'font-semibold' : 'text-[#7A5EA8]'), w: 18 },
    { h: 'N° CDC', v: (l) => l.cdc || l.piece, w: 11 }, { h: 'Pièce', v: (l) => l.piece, w: 11 },
    { h: 'Date CDC', v: (l) => l.date_cdc, date: true, w: 11 },
    { h: 'Livraison demandée', v: (l) => l.date_livraison, date: true, w: 12,
      cls: (l) => ((l.date_livraison || '9999') < new Date().toISOString().slice(0, 10) && l.nature === 'CDC' ? 'font-bold text-red-700' : '') },
    { h: 'Livrable à la date demandée', v: (l) => libCouverture(l), cls: (l) => clsCouverture(l), s: (l) => rangCouverture(l) * 1000 + n0(l.couv_retard), w: 36 },
    ...colClient]
  const colsBl: Col<LR>[] = [...colRef,
    { h: 'Période', v: (l) => (l.nature === 'POST_BL' ? `depuis le ${debutLib}` : l.nature === 'BL_M' ? `${libMois(d?.mois_m || '')} (→ ${veilleLib})` : libMois(d?.mois_m1 || '')), w: 14 },
    { h: 'N° BL / facture', v: (l) => l.piece, w: 13 }, { h: 'Date BL', v: (l) => l.date_bl, date: true, w: 11 },
    { h: 'N° CDC', v: (l) => l.cdc, w: 11 }, { h: 'Date CDC', v: (l) => l.date_cdc, date: true, w: 11 },
    ...colClient]
  const colsRecentes: Col<LR>[] = [
    { h: 'Statut', v: (l) => STATUT_NATURE[l.nature], cls: (l) => (estBl(l.nature) ? 'font-bold text-[#1E6B3A]' : estPl(l.nature) ? 'text-sky-800' : ''), w: 18 },
    ...colRef,
    { h: 'N° CDC', v: (l) => l.cdc || l.piece, w: 11 }, { h: 'Date CDC', v: (l) => l.date_cdc, date: true, w: 11 },
    { h: 'BL / PL', v: (l) => (l.nature === 'CDC' || l.nature === 'CDC_ANNEE_SUIVANTE' ? null : l.piece), w: 11 },
    { h: 'Date BL', v: (l) => l.date_bl, date: true, w: 11 },
    { h: 'Livraison demandée', v: (l) => l.date_livraison, date: true, w: 12 },
    ...colClient,
    { h: 'CDC plus anciennes en attente', v: (l) => l.anciennes ?? 0, right: true, w: 12 },
    { h: 'dont dues au plus tard le jour du BL', v: (l) => l.anciennesDues ?? 0, right: true, cls: (l) => ((l.anciennesDues ?? 0) > 0 ? 'font-bold text-red-700' : ''), w: 14 },
  ]
  type LA = (typeof listeArrivages)[number]
  const colsArr: Col<LA>[] = [
    { h: 'Référence', v: (a) => a.ref, cls: () => 'font-semibold', w: 16 }, { h: 'Type', v: (a) => a.type, w: 10 },
    { h: 'Taille', v: (a) => String(a.taille).replace('.', ','), w: 7 }, { h: 'Alim.', v: (a) => a.alim, w: 11 },
    { h: 'Mois', v: (a) => libMoisAnnee(a.mois), w: 10 },
    { h: 'Qté attendue', v: (a) => n0(a.q), right: true, cls: (a) => (a.mois <= (d?.fin_annee || '').slice(0, 7) ? 'font-bold' : 'text-[#8A8474]'), w: 10 },
    { h: 'CDF SAGE', v: (a) => a.cdf, w: 46 },
  ]
  const sommeQ = (rows: { q: number }[]) => rows.reduce((s, x) => s + n0(x.q), 0)
  const lm1 = d ? libMois(d.mois_m1) : 'M-1'
  const lm = d ? libMois(d.mois_m) : 'M'
  // Période d'allocation (26/10/2026) : BL oct. arrêté la veille du début, puis « BL + PL depuis le 26/10 »
  const debut = d?.debut_alloc || '2026-10-26'
  const debutLib = fmtDate(debut).slice(0, 5)
  const veilleLib = (() => { const x = new Date(`${debut}T12:00:00`); x.setDate(x.getDate() - 1); return x.toLocaleDateString('fr-FR').slice(0, 5) })()
  const subVentes: { k: Metrique; l: string }[] = [
    { k: 'bl_m1', l: `BL ${lm1}` }, { k: 'bl_m', l: `BL ${lm} (→ ${veilleLib})` }, { k: 'pl', l: `PL encours (av. ${debutLib})` },
    { k: 'post', l: `BL et PL depuis ${debutLib}` }, { k: 'cdc', l: `CDC Liv ${annee}` },
  ]
  const lecture = d?.mode === 'agence'
  /** Contrôle : BL + PL depuis le début de période + CDC à livrer ≤ Allocation. */
  const depasse = (ref: string | null, bloc: string) => {
    const a = ref ? alloc(ref, bloc) : totAlloc(bloc)
    const conso = ref ? val(ref, bloc, 'post') + val(ref, bloc, 'cdc') : totBloc(bloc, 'post') + totBloc(bloc, 'cdc')
    return conso > a ? conso - a : 0
  }
  const subBloc = compact ? subVentes.filter((s) => s.k === 'cdc') : subVentes

  function ouvrir(ref: string | null, bloc: string, k: Metrique) {
    const natures: Nature[] = k === 'cdc' ? ['CDC'] : k === 'pl' ? ['PL'] : k === 'post' ? ['POST_BL', 'POST_PL'] : k === 'bl_m' ? ['BL_M'] : ['BL_M1']
    const sub = subVentes.find((s) => s.k === k)?.l || ''
    setDetail({ titre: `${sub} · ${ref || 'toutes références'} · ${libBloc(bloc)}`, ref, bloc, natures })
  }

  async function exporterExcel() {
    if (!d) return
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Allocation')
      const vide = subVentes.slice(1).map(() => '')
      const h1: string[] = ['Référence', 'Désignation', 'Type', 'Taille', 'Alim.', ...(lecture ? [] : ['STOCK', '', '', '']), 'TOTAL VENTES', ...vide]
      const h2: string[] = ['', '', '', '', '', ...(lecture ? [] : ['Dispo (Phy-PL)', `Arrivage ${annee}`, 'A attribuer', 'Attribué']), ...subVentes.map((s) => s.l)]
      d.blocs.forEach((b) => { h1.push(libBloc(b), ...vide, ''); h2.push(...subVentes.map((s) => s.l), `Allocation ${annee}`) })
      ws.addRow(h1).font = { bold: true }; ws.addRow(h2).font = { bold: true }
      lignes.forEach(({ r, aAtt, attr }) => {
        const row: (string | number)[] = [r.ref, r.designation || '', r.gamme === '600' ? 'Split' : 'Monobloc', r.taille, r.alim, ...(lecture ? [] : [n0(r.dispo), n0(r.arrivage_annee), aAtt, attr]),
          ...subVentes.map((s) => val(r.ref, TOTAL, s.k))]
        d.blocs.forEach((b) => row.push(...subVentes.map((s) => val(r.ref, b, s.k)), alloc(r.ref, b)))
        ws.addRow(row)
      })
      const t: (string | number)[] = ['TOTAL', '', '', '', '', ...(lecture ? [] : [tot.dispo, tot.arr, tot.aAtt, tot.attr]), ...subVentes.map((s) => totBloc(TOTAL, s.k))]
      d.blocs.forEach((b) => t.push(...subVentes.map((s) => totBloc(b, s.k)), totAlloc(b)))
      ws.addRow(t).font = { bold: true }
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
      ws.getColumn(1).width = 17; ws.getColumn(2).width = 34
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url; a.download = `allocation_airh2o_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  if (!accessLoading && !rights.can_allocation_ro) {
    return (
      <main className="min-h-screen bg-[#F4F3F0] p-6 text-[#111820]">
        <div className="mx-auto max-w-[640px] rounded-xl border border-[#E5E1D8] bg-white p-6 text-center">
          <h1 className="text-[18px] font-bold">Accès réservé</h1>
          <p className="mt-1 text-[13px] text-[#8A8474]">Cet écran d’allocation n’est ouvert pour l’instant qu’à quelques personnes.</p>
        </div>
      </main>
    )
  }

  const th = 'border border-[#D9D3C5] px-1 py-1 text-center text-[10.5px] font-bold leading-tight'
  const td = 'border border-[#E5E1D8] px-1 py-0.5 text-center'
  const Num = ({ v, onClick, bold }: { v: number; onClick?: () => void; bold?: boolean }) => (
    <button type="button" onClick={onClick} disabled={!onClick || v === 0}
      className={`w-full rounded px-0.5 ${v === 0 ? 'text-[#C9C3B5]' : bold ? 'font-bold text-[#111820] hover:bg-white' : 'text-[#3A362E] hover:bg-white'} ${onClick && v !== 0 ? 'cursor-pointer underline-offset-2 hover:underline' : 'cursor-default'}`}>
      {v === 0 ? '0' : fmtNum(v)}
    </button>
  )

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[2400px] space-y-2.5">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">
              CEGECLIM — Stocks & logistique · {lecture ? `vue agence : ${(d?.blocs_user || []).map(libBloc).join(', ')} · lecture seule` : 'accès réservé'}
            </p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Allocation AirH2O 600 / 800 — groupes extérieurs T3,5 à 6</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              {lecture
                ? <>Allocation {annee} de votre agence · contrôle : « BL et PL depuis {debutLib} » + « CDC Liv {annee} » ≤ allocation (sinon en rouge)</>
                : <>A attribuer = Dispo (Phy-PL) + Arrivage {annee} + BL et PL depuis le {debutLib} (vision figée au {debutLib}) · Attribué = somme des colonnes jaunes « Allocation {annee} »</>}
              {d?.import_sage_le && <> · données SAGE du {fmtDateHeure(d.import_sage_le)}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A362E]">
              <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} /> Vue compacte (CDC + Alloc)
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A362E]">
              <input type="checkbox" checked={masquerVides} onChange={(e) => setMasquerVides(e.target.checked)} /> Masquer les agences sans activité
            </label>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || !d} className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : '⬇ Excel'}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recharger" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {/Accès réservé/.test(erreur) ? 'Aucune agence n’est rattachée à votre accès (périmètre agences, agence objectif ou collaborateurs dans Autorisations) : l’écran ne peut pas être filtré.' : erreur}
            {/get_allocation_ro|does not exist/.test(erreur) ? ' — la migration 20261026_allocation_airh2o_agences.sql est-elle appliquée ?' : ''}
          </div>
        )}

        {loading && !d && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Chargement…</div>}

        {d && (
          <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
            <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
              {([['', 'Split + Monobloc'], ['600', 'Split (AirH2O 600)'], ['800', 'Monobloc (AirH2O 800)']] as ['' | '600' | '800', string][]).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTypeF(k)} className={`rounded-md px-3 py-1 ${typeF === k ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474]'}`}>{l}</button>
              ))}
            </div>
            <span className="mx-1 h-6 w-px bg-[#E5E1D8]" />
            {([['tableau', 'Tableau d’allocation'], ['cdc', `CDC à livrer (${annee} + ${Number(annee) + 1})`], ['bl', `BL ${lm1} / ${lm} / depuis ${debutLib}`],
              ['recentes', 'CDC des 7 derniers jours'], ...(lecture ? [] : [['arrivages', 'Arrivages']])] as [Onglet, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setOnglet(k)}
                className={`h-8 rounded-lg px-3 text-[12.5px] font-bold ${onglet === k ? 'bg-[#1D5C86] text-white' : 'border border-[#E5E1D8] bg-white text-[#3A362E] hover:border-[#1D5C86]'}`}>{l}</button>
            ))}
            {onglet !== 'tableau' && (
              <>
                <span className="mx-1 h-6 w-px bg-[#E5E1D8]" />
                {onglet !== 'arrivages' && d.blocs.length > 1 && (
                  <select value={agenceF} onChange={(e) => setAgenceF(e.target.value)} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold">
                    <option value="">Toutes les agences</option>
                    {d.blocs.map((b) => <option key={b} value={b}>{libBloc(b)}</option>)}
                  </select>
                )}
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, CDC, client…"
                  className="h-8 w-[220px] rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold outline-none focus:border-[#1D5C86]" />
              </>
            )}
          </section>
        )}

        {d && onglet === 'cdc' && (
          <ListeDetail titre={`CDC à livrer ${annee} et ${Number(annee) + 1}`}
            sousTitre={`dont en préparation (PL) ; livraison demandée en rouge = déjà passée ; « Livrable » : stock actuel, ou CDF qui la complète (à l’heure / en retard), CDC servies par date de livraison puis date de création ; clic sur un en-tête pour trier`}
            cols={colsCdc} rows={listeCdc} cle={(l, i) => `${l.piece}-${l.ref}-${i}`} totalQte={sommeQ(listeCdc)}
            rowCls={(l) => (l.bloc === 'JITHURBIDE' ? 'bg-[#F4F0FA]' : '')} />
        )}
        {d && onglet === 'bl' && (
          <ListeDetail titre={`BL ${lm1}, ${lm} et depuis le ${debutLib}`} sousTitre={`BL facturés ou non, hors retours ; ${lm} = jusqu’au ${veilleLib}, puis « depuis le ${debutLib} »`}
            cols={colsBl} rows={listeBl} cle={(l, i) => `${l.piece}-${l.ref}-${i}`} totalQte={sommeQ(listeBl)}
            rowCls={(l) => (l.bloc === 'JITHURBIDE' ? 'bg-[#F4F0FA]' : '')} />
        )}
        {d && onglet === 'recentes' && (
          <ListeDetail titre="CDC créées depuis 7 jours" sousTitre={`depuis le ${fmtDate(depuis)} · en rouge : livrée alors qu’une CDC plus ancienne, due au plus tard le jour du BL, attend toujours`}
            cols={colsRecentes} rows={listeRecentes} cle={(l, i) => `${l.piece}-${l.ref}-${i}`} totalQte={sommeQ(listeRecentes)}
            rowCls={(l) => (estBl(l.nature) && (l.anciennesDues ?? 0) > 0 ? 'bg-[#FDE2DF]' : '')} />
        )}
        {d && onglet === 'arrivages' && !lecture && (
          <ListeDetail titre="Arrivages fournisseurs attendus" sousTitre={`CDF SAGE ouvertes ; en gras : arrivages d’ici le 31/12 (comptés dans « Arrivage ${annee} »)`}
            cols={colsArr} rows={listeArrivages} cle={(a, i) => `${a.ref}-${a.mois}-${i}`} totalQte={sommeQ(listeArrivages)} />
        )}

        {d && onglet === 'tableau' && (
          <section className="overflow-auto rounded-xl border border-[#E5E1D8] bg-white" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <table className="border-collapse text-[12px]">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th rowSpan={2} className={`${th} sticky left-0 z-30 min-w-[130px] bg-[#1D3557] text-white`}>Référence</th>
                  <th rowSpan={2} className={`${th} min-w-[200px] bg-[#1D3557] text-white`}>Désignation</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Type</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Taille</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Alim.</th>
                  {!lecture && <th colSpan={4} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: C_STOCK[0] }}>STOCK</th>}
                  <th colSpan={subVentes.length} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: C_TOTAL[0] }}>TOTAL VENTES</th>
                  {blocs.map((b, i) => {
                    const p = PAL[d.blocs.indexOf(b) % PAL.length]
                    return <th key={b} colSpan={subBloc.length + 1} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: p[0] }} data-i={i}>{libBloc(b)}</th>
                  })}
                </tr>
                <tr>
                  {(lecture ? [] : ['Dispo (Phy-PL)', `Arrivage ${annee}`, 'A attribuer', 'Attribué']).map((l, i) => (
                    <th key={l} className={`${th} min-w-[62px] ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: C_STOCK[1] }}>{l}</th>
                  ))}
                  {subVentes.map((s, i) => (
                    <th key={s.k} className={`${th} min-w-[56px] ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: C_TOTAL[1] }}>{s.l}</th>
                  ))}
                  {blocs.map((b) => {
                    const p = PAL[d.blocs.indexOf(b) % PAL.length]
                    return (
                      <React.Fragment key={b}>
                        {subBloc.map((s, i) => <th key={s.k} className={`${th} min-w-[52px] ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: p[1] }}>{s.l}</th>)}
                        <th className={`${th} min-w-[70px]`} style={{ background: '#F2D96B' }}>Allocation {annee}</th>
                      </React.Fragment>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {lignes.map(({ r, aAtt, attr }) => (
                  <tr key={r.ref} className="hover:brightness-[0.98]">
                    <td className={`${td} sticky left-0 z-10 bg-white text-left font-bold`}>
                      <a href={`/stock/penurie?ref=${encodeURIComponent(r.ref)}&mystock=tous`} className="hover:text-[#B4761A] hover:underline" title="Fiche pénurie">{r.ref}</a>
                    </td>
                    <td className={`${td} max-w-[240px] truncate text-left text-[11px] text-[#5E5A50]`} title={r.designation || ''}>{r.designation}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.gamme === '600' ? 'Split' : 'Monobloc'}</td>
                    <td className={td}>{String(r.taille).replace('.', ',')}</td>
                    <td className={`${td} whitespace-nowrap`}>{r.alim}</td>
                    {!lecture && (
                      <>
                        <td className={`${td} border-l-2 border-l-[#3A362E] font-semibold`} style={{ background: C_STOCK[2] }} title={`Stock réel ${fmtNum(r.reel)} − PL ${fmtNum(r.prepa)}`}>{fmtNum(r.dispo)}</td>
                        <td className={td} style={{ background: C_STOCK[2] }}
                          title={r.arrivages.length ? r.arrivages.map((a) => `${libMoisAnnee(a.mois)} : ${fmtNum(a.q)} (${a.cdf})`).join('\n') : 'Aucune CDF en cours'}>
                          {fmtNum(r.arrivage_annee)}
                        </td>
                        <td className={`${td} text-[13px] font-extrabold ${clsAAttribuer(aAtt)}`}>{fmtNum(aAtt)}</td>
                        <td className={`${td} text-[13px] font-extrabold ${clsAttribue(attr, aAtt)}`} style={attr <= 0 ? { background: C_STOCK[2] } : undefined}>{fmtNum(attr)}</td>
                      </>
                    )}
                    {subVentes.map((s, i) => (
                      <td key={s.k} className={`${td} ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: C_TOTAL[2] }}>
                        <Num v={val(r.ref, TOTAL, s.k)} bold={s.k === 'cdc'} onClick={() => ouvrir(r.ref, TOTAL, s.k)} />
                      </td>
                    ))}
                    {blocs.map((b) => {
                      const p = PAL[d.blocs.indexOf(b) % PAL.length]
                      return (
                        <React.Fragment key={b}>
                          {subBloc.map((s, i) => (
                            <td key={s.k} className={`${td} ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: p[2] }}>
                              <Num v={val(r.ref, b, s.k)} bold={s.k === 'cdc'} onClick={() => ouvrir(r.ref, b, s.k)} />
                            </td>
                          ))}
                          <td className={`${td} p-0.5 ${depasse(r.ref, b) ? 'ring-2 ring-inset ring-red-600' : ''}`} style={{ background: depasse(r.ref, b) ? '#F4B6B0' : '#FFF8D6' }}
                            title={depasse(r.ref, b) ? `Dépassement de ${fmtNum(depasse(r.ref, b))} : BL et PL depuis ${debutLib} (${fmtNum(val(r.ref, b, 'post'))}) + CDC Liv ${annee} (${fmtNum(val(r.ref, b, 'cdc'))}) > allocation (${fmtNum(alloc(r.ref, b))})` : undefined}>
                            {lecture
                              ? <span className={`block text-[12.5px] font-bold ${depasse(r.ref, b) ? 'text-[#9B1C1C]' : 'text-[#0000CC]'}`}>{alloc(r.ref, b) ? fmtNum(alloc(r.ref, b)) : ''}</span>
                              : <CelluleAlloc key={`${r.ref}|${b}|${alloc(r.ref, b)}`} valeur={alloc(r.ref, b)} info={allocs.get(`${r.ref}|${b}`)} onSave={(q) => sauverAlloc(r.ref, b, q)} />}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                <tr className="font-bold">
                  <td className={`${td} sticky left-0 z-30 border-t-2 border-t-[#3A362E] bg-[#1D3557] text-left text-white`}>TOTAL</td>
                  <td colSpan={4} className={`${td} border-t-2 border-t-[#3A362E] bg-[#1D3557]`} />
                  {!lecture && (
                    <>
                      <td className={`${td} border-l-2 border-t-2 border-l-[#3A362E] border-t-[#3A362E]`} style={{ background: C_STOCK[1] }}>{fmtNum(tot.dispo)}</td>
                      <td className={`${td} border-t-2 border-t-[#3A362E]`} style={{ background: C_STOCK[1] }}>{fmtNum(tot.arr)}</td>
                      <td className={`${td} border-t-2 border-t-[#3A362E] text-[13px] font-extrabold ${clsAAttribuer(tot.aAtt)}`}>{fmtNum(tot.aAtt)}</td>
                      <td className={`${td} border-t-2 border-t-[#3A362E] text-[13px] font-extrabold ${clsAttribue(tot.attr, tot.aAtt)}`} style={tot.attr <= 0 ? { background: C_STOCK[1] } : undefined}>{fmtNum(tot.attr)}</td>
                    </>
                  )}
                  {subVentes.map((s, i) => (
                    <td key={s.k} className={`${td} border-t-2 border-t-[#3A362E] ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: C_TOTAL[1] }}>
                      <Num v={totBloc(TOTAL, s.k)} bold onClick={() => ouvrir(null, TOTAL, s.k)} />
                    </td>
                  ))}
                  {blocs.map((b) => {
                    const p = PAL[d.blocs.indexOf(b) % PAL.length]
                    return (
                      <React.Fragment key={b}>
                        {subBloc.map((s, i) => (
                          <td key={s.k} className={`${td} border-t-2 border-t-[#3A362E] ${i === 0 ? 'border-l-2 border-l-[#3A362E]' : ''}`} style={{ background: p[1] }}>
                            <Num v={totBloc(b, s.k)} bold onClick={() => ouvrir(null, b, s.k)} />
                          </td>
                        ))}
                        <td className={`${td} border-t-2 border-t-[#3A362E] text-[12.5px] ${depasse(null, b) ? 'text-[#9B1C1C]' : 'text-[#0000CC]'}`} style={{ background: depasse(null, b) ? '#F4B6B0' : '#F2D96B' }}
                          title={depasse(null, b) ? `Dépassement de ${fmtNum(depasse(null, b))} sur l’agence` : undefined}>{fmtNum(totAlloc(b))}</td>
                      </React.Fragment>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {d && onglet === 'tableau' && (
          <section className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5 text-[11.5px] text-[#5E5A50]">
            <span className="font-bold text-[#111820]">Légende</span>
            {!lecture && (
              <>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#F4B6B0]" />A attribuer &lt; 0 · Attribué &gt; A attribuer : sur-allocation</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#FBE3B5]" />A attribuer = 0 · reste à allouer</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#C9EBD4]" />A attribuer &gt; 0 · tout est alloué</span>
                <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded border border-[#E8D27A] bg-[#FFF2B3]" />allocation à saisir (enregistrée à la sortie du champ, partagée)</span>
              </>
            )}
            <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#F4B6B0] ring-2 ring-inset ring-red-600" />allocation dépassée : BL et PL depuis le {debutLib} + CDC Liv {annee} &gt; Allocation {annee}</span>
            <span className="w-full text-[10.5px] text-[#8A8474]">
               {!lecture && <>Dispo (Phy-PL) = stock réel tous dépôts − PL. A attribuer ajoute les BL et PL faits depuis le {debutLib}, déjà sortis du Dispo. Arrivage = CDF SAGE attendues jusqu’au 31/12 (survol : détail par mois, au-delà compris). </>}CDC Liv = CDC à livrer d’ici le 31/12, retards compris.
              BL = livraisons (facturées ou non, hors retours) : {lm1}, {lm} jusqu’au {veilleLib}, puis « BL et PL depuis le {debutLib} » avec les PL créées depuis cette date (PL encours = PL créées avant). Agence = agence du représentant de la fiche client (client NON AFFECTE : collaborateur de la pièce) ;
              Un clic sur un chiffre ouvre le détail des lignes.
            </span>
          </section>
        )}
      </div>

      {detail && d && <DetailModal detail={detail} lignes={d.lignes} onClose={() => setDetail(null)} />}
    </main>
  )
}

export default function AllocationAirH2OPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <AllocationAirH2O />
    </Suspense>
  )
}
