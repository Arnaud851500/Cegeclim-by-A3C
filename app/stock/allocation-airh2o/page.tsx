'use client'

/**
 * Écran « Allocation AirH2O 600 / 800 » (menu Stocks & logistique, /stock/allocation-airh2o).
 * ---------------------------------------------------------------------------
 * Créé le 24/10/2026 à partir du tableau Excel validé par Arnaud le même jour.
 * Accès réservé : Julien Ithurbide, Stéphane Chanteau, Jean-Marc Ladeuix, Arnaud
 * (menu : lib/allocationRo.ts ; données : table stock_alloc_ro_acces, vérifiée par la base).
 *
 * Une ligne par groupe extérieur AirH2O 600 / 800 du catalogue 2026, tailles ≥ 3,5 :
 *  - STOCK : Dispo (Phy-PL), Arrivage de l'année, A attribuer = Dispo − CDC Liv + Arrivage,
 *    Attribué = somme des allocations saisies ;
 *  - TOTAL VENTES puis un bloc par agence (ANGLET hors Julien Ithurbide, Julien Ithurbide,
 *    puis chaque agence) : BL du mois précédent, BL du mois, PL en cours, CDC à livrer d'ici
 *    le 31/12 (retards compris) et « Alloc en plus des CDC » (saisie partagée, enregistrée
 *    à la sortie du champ) ;
 *  - un clic sur un chiffre ouvre le détail des lignes (CDC, PL, BL) ;
 *  - vue compacte : par agence, seulement CDC Liv et Alloc.
 *
 * Code couleur : A attribuer < 0 rouge, = 0 orange, > 0 vert ; Attribué > A attribuer rouge
 * (sur-allocation), = vert, < orange ; cases d'allocation jaunes.
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
  reel: number; prepa: number; dispo: number; arrivage_annee: number
  arrivages: { mois: string; q: number; cdf: string }[]
  dispo_fin_dec_ecran: number | null
}
type Valeur = { ref: string; bloc: string; bl_m1: number; bl_m: number; pl: number; cdc: number; cdc_suiv: number }
type Alloc = { ref: string; bloc: string; quantite: number; updated_at: string; updated_by: string | null }
type Nature = 'CDC' | 'CDC_ANNEE_SUIVANTE' | 'PL' | 'BL_M' | 'BL_M1'
type LigneDoc = {
  ref: string; bloc: string; nature: Nature; piece: string; cdc: string | null; date_cdc: string | null
  date_livraison: string | null; date_bl: string | null; q: number; montant_ht: number | null
  tiers: string | null; client: string | null; representant: string | null; agence: string | null
}
type Donnees = {
  genere_le: string; import_sage_le: string | null; fin_annee: string; mois_m1: string; mois_m: string
  refs: RefRow[]; blocs: string[]; valeurs: Valeur[]; allocations: Alloc[]; lignes: LigneDoc[]
}
type Metrique = 'bl_m1' | 'bl_m' | 'pl' | 'cdc'
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
  if (b === 'ANGLET') return 'ANGLET - Hors J.It.'
  if (b === 'JITHURBIDE') return 'Julien. Ith'
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
      title={info ? `Saisi le ${fmtDateHeure(info.updated_at)}${info.updated_by ? ` par ${info.updated_by}` : ''}` : 'Allocation en plus des CDC déjà enregistrées'}
      className={`h-7 w-full min-w-[46px] rounded border text-center text-[12.5px] font-bold text-[#0000CC] outline-none focus:border-[#1D5C86] focus:bg-white
        ${etat === 'err' ? 'border-red-500 bg-red-50' : etat === 'ok' ? 'border-emerald-500 bg-emerald-50' : etat === 'saving' ? 'border-[#B4761A] bg-[#FFF2B3]' : 'border-[#E8D27A] bg-[#FFF2B3]'}`}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Fenêtre de détail des lignes
// ─────────────────────────────────────────────────────────────────────────

const LIB_NATURE: Record<Nature, string> = {
  CDC: 'CDC à livrer', CDC_ANNEE_SUIVANTE: 'CDC année suivante', PL: 'En préparation (PL)', BL_M: 'BL mois en cours', BL_M1: 'BL mois précédent',
}

function DetailModal({ detail, lignes, onClose }: { detail: Detail; lignes: LigneDoc[]; onClose: () => void }) {
  const liste = useMemo(() => lignes.filter((l) =>
    (!detail.ref || l.ref === detail.ref) && (!detail.bloc || detail.bloc === TOTAL || l.bloc === detail.bloc) && detail.natures.includes(l.nature),
  ), [lignes, detail])
  const total = liste.reduce((s, l) => s + n0(l.q), 0)
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
              <th className="px-1.5">Date CDC</th><th className="px-1.5">Livraison demandée</th><th className="px-1.5">Date BL</th>
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
                  <td className="whitespace-nowrap px-1.5">{fmtDate(l.date_bl)}</td>
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

  const blocs = useMemo(() => {
    if (!d) return [] as string[]
    if (!masquerVides) return d.blocs
    return d.blocs.filter((b) => b === 'ANGLET' || b === 'JITHURBIDE' || d.refs.some((r) => (['bl_m1', 'bl_m', 'pl', 'cdc'] as Metrique[]).some((k) => val(r.ref, b, k) !== 0) || alloc(r.ref, b) !== 0))
  }, [d, masquerVides, val, alloc])

  const lignes = useMemo(() => (d?.refs || []).map((r) => {
    const cdc = val(r.ref, TOTAL, 'cdc')
    const aAtt = n0(r.dispo) - cdc + n0(r.arrivage_annee)
    const attr = (d?.blocs || []).reduce((s, b) => s + alloc(r.ref, b), 0)
    return { r, cdc, aAtt, attr }
  }), [d, val, alloc])

  const tot = useMemo(() => ({
    dispo: lignes.reduce((s, l) => s + n0(l.r.dispo), 0),
    arr: lignes.reduce((s, l) => s + n0(l.r.arrivage_annee), 0),
    aAtt: lignes.reduce((s, l) => s + l.aAtt, 0),
    attr: lignes.reduce((s, l) => s + l.attr, 0),
  }), [lignes])
  const totBloc = useCallback((bloc: string, k: Metrique) => (d?.refs || []).reduce((s, r) => s + val(r.ref, bloc, k), 0), [d, val])
  const totAlloc = useCallback((bloc: string) => (d?.refs || []).reduce((s, r) => s + alloc(r.ref, bloc), 0), [d, alloc])

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
  const lm1 = d ? libMois(d.mois_m1) : 'M-1'
  const lm = d ? libMois(d.mois_m) : 'M'
  const subVentes: { k: Metrique; l: string }[] = [
    { k: 'bl_m1', l: `BL ${lm1}` }, { k: 'bl_m', l: `BL ${lm}` }, { k: 'pl', l: 'PL encours' }, { k: 'cdc', l: `CDC Liv ${annee}` },
  ]
  const subBloc = compact ? subVentes.filter((s) => s.k === 'cdc') : subVentes

  function ouvrir(ref: string | null, bloc: string, k: Metrique) {
    const natures: Nature[] = k === 'cdc' ? ['CDC'] : k === 'pl' ? ['PL'] : k === 'bl_m' ? ['BL_M'] : ['BL_M1']
    const sub = subVentes.find((s) => s.k === k)?.l || ''
    setDetail({ titre: `${sub} · ${ref || 'toutes références'} · ${libBloc(bloc)}`, ref, bloc, natures })
  }

  async function exporterExcel() {
    if (!d) return
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Allocation')
      const h1: string[] = ['Référence', 'Désignation', 'Type', 'Taille', 'Alim.', 'STOCK', '', '', '', 'TOTAL VENTES', '', '', '']
      const h2: string[] = ['', '', '', '', '', 'Dispo (Phy-PL)', `Arrivage ${annee}`, 'A attribuer', 'Attribué', ...subVentes.map((s) => s.l)]
      d.blocs.forEach((b) => { h1.push(libBloc(b), '', '', '', ''); h2.push(...subVentes.map((s) => s.l), `Alloc${annee} en plus des CDC`) })
      ws.addRow(h1).font = { bold: true }; ws.addRow(h2).font = { bold: true }
      lignes.forEach(({ r, aAtt, attr }) => {
        const row: (string | number)[] = [r.ref, r.designation || '', r.gamme === '600' ? 'Split' : 'Monobloc', r.taille, r.alim, r.dispo, r.arrivage_annee, aAtt, attr,
          ...subVentes.map((s) => val(r.ref, TOTAL, s.k))]
        d.blocs.forEach((b) => row.push(...subVentes.map((s) => val(r.ref, b, s.k)), alloc(r.ref, b)))
        ws.addRow(row)
      })
      const t: (string | number)[] = ['TOTAL', '', '', '', '', tot.dispo, tot.arr, tot.aAtt, tot.attr, ...subVentes.map((s) => totBloc(TOTAL, s.k))]
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
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique · accès réservé</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Allocation AirH2O 600 / 800 — groupes extérieurs T3,5 à 6</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              A attribuer = Dispo (Phy-PL) − CDC Liv {annee} + Arrivage {annee} · Attribué = somme des allocations saisies par agence
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
            {erreur}{/get_allocation_ro|does not exist/.test(erreur) ? ' — la migration 20261024_allocation_airh2o.sql est-elle appliquée ?' : ''}
          </div>
        )}

        {loading && !d && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Chargement…</div>}

        {d && (
          <section className="overflow-auto rounded-xl border border-[#E5E1D8] bg-white" style={{ maxHeight: 'calc(100vh - 220px)' }}>
            <table className="border-collapse text-[12px]">
              <thead className="sticky top-0 z-20">
                <tr>
                  <th rowSpan={2} className={`${th} sticky left-0 z-30 min-w-[130px] bg-[#1D3557] text-white`}>Référence</th>
                  <th rowSpan={2} className={`${th} min-w-[200px] bg-[#1D3557] text-white`}>Désignation</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Type</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Taille</th>
                  <th rowSpan={2} className={`${th} bg-[#1D3557] text-white`}>Alim.</th>
                  <th colSpan={4} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: C_STOCK[0] }}>STOCK</th>
                  <th colSpan={4} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: C_TOTAL[0] }}>TOTAL VENTES</th>
                  {blocs.map((b, i) => {
                    const p = PAL[d.blocs.indexOf(b) % PAL.length]
                    return <th key={b} colSpan={subBloc.length + 1} className={`${th} border-l-2 border-l-[#3A362E] text-[12.5px] text-white`} style={{ background: p[0] }} data-i={i}>{libBloc(b)}</th>
                  })}
                </tr>
                <tr>
                  {['Dispo (Phy-PL)', `Arrivage ${annee}`, 'A attribuer', 'Attribué'].map((l, i) => (
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
                        <th className={`${th} min-w-[70px]`} style={{ background: '#F2D96B' }}>Alloc{annee} en plus des CDC</th>
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
                    <td className={`${td} border-l-2 border-l-[#3A362E] font-semibold`} style={{ background: C_STOCK[2] }} title={`Stock réel ${fmtNum(r.reel)} − PL ${fmtNum(r.prepa)}`}>{fmtNum(r.dispo)}</td>
                    <td className={td} style={{ background: C_STOCK[2] }}
                      title={r.arrivages.length ? r.arrivages.map((a) => `${libMoisAnnee(a.mois)} : ${fmtNum(a.q)} (${a.cdf})`).join('\n') : 'Aucune CDF en cours'}>
                      {fmtNum(r.arrivage_annee)}
                    </td>
                    <td className={`${td} text-[13px] font-extrabold ${clsAAttribuer(aAtt)}`}>{fmtNum(aAtt)}</td>
                    <td className={`${td} text-[13px] font-extrabold ${clsAttribue(attr, aAtt)}`} style={attr <= 0 ? { background: C_STOCK[2] } : undefined}>{fmtNum(attr)}</td>
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
                          <td className={`${td} p-0.5`} style={{ background: '#FFF8D6' }}>
                            <CelluleAlloc key={`${r.ref}|${b}|${alloc(r.ref, b)}`} valeur={alloc(r.ref, b)} info={allocs.get(`${r.ref}|${b}`)} onSave={(q) => sauverAlloc(r.ref, b, q)} />
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
                  <td className={`${td} border-l-2 border-t-2 border-l-[#3A362E] border-t-[#3A362E]`} style={{ background: C_STOCK[1] }}>{fmtNum(tot.dispo)}</td>
                  <td className={`${td} border-t-2 border-t-[#3A362E]`} style={{ background: C_STOCK[1] }}>{fmtNum(tot.arr)}</td>
                  <td className={`${td} border-t-2 border-t-[#3A362E] text-[13px] font-extrabold ${clsAAttribuer(tot.aAtt)}`}>{fmtNum(tot.aAtt)}</td>
                  <td className={`${td} border-t-2 border-t-[#3A362E] text-[13px] font-extrabold ${clsAttribue(tot.attr, tot.aAtt)}`} style={tot.attr <= 0 ? { background: C_STOCK[1] } : undefined}>{fmtNum(tot.attr)}</td>
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
                        <td className={`${td} border-t-2 border-t-[#3A362E] text-[12.5px] text-[#0000CC]`} style={{ background: '#F2D96B' }}>{fmtNum(totAlloc(b))}</td>
                      </React.Fragment>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {d && (
          <section className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5 text-[11.5px] text-[#5E5A50]">
            <span className="font-bold text-[#111820]">Légende</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#F4B6B0]" />A attribuer &lt; 0 : CDC {annee} non couvertes · Attribué &gt; A attribuer : sur-allocation</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#FBE3B5]" />A attribuer = 0 · reste à allouer</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded bg-[#C9EBD4]" />A attribuer &gt; 0 · tout est alloué</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-3.5 w-6 rounded border border-[#E8D27A] bg-[#FFF2B3]" />allocation à saisir (enregistrée à la sortie du champ, partagée)</span>
            <span className="w-full text-[10.5px] text-[#8A8474]">
              Dispo (Phy-PL) = stock réel tous dépôts − PL. Arrivage = CDF SAGE attendues jusqu’au 31/12 (survol : détail par mois, au-delà compris). CDC Liv = CDC à livrer d’ici le 31/12, retards compris.
              BL = livraisons datées du mois (facturées ou non, hors retours). Agence = agence du représentant de la fiche client (client NON AFFECTE : collaborateur de la pièce) ;
              « ANGLET - Hors J.It. » exclut les clients de Julien Ithurbide, regroupés dans « Julien. Ith ». Un clic sur un chiffre ouvre le détail des lignes.
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
