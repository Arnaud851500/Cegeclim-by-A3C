'use client'

/**
 * Écran « Pénuries — vue mensuelle » (menu Stocks & logistique, /stock/penurie/mensuel).
 * ---------------------------------------------------------------------------
 * Créé le 21/10/2026 (réunion pénuries / CA / position clients).
 *
 * Mois en cours + 5 mois (octobre → mars), par référence :
 *  - arrivages = CDF en cours à leur date de réception retenue (en retard / sans date = mois en cours) ;
 *  - CDC fermes = commandes clients à livrer (même périmètre que get_references_penurie :
 *    ancienneté max appro_parametres.cdc_a_livrer_anciennete_max_jours ; en retard = mois en cours) ;
 *  - CDC non tenables = lignes ouvertes INTENABLE / CREE_RETARD de v_cdc_promesses_interdites
 *    (risque de perte de commande) ;
 *  - ventes N-1 = quantités facturées le même mois l'an dernier (mois en cours : au prorata des jours restants).
 *
 * Solde projeté (cumulé, fin de mois) :
 *  - mode Ferme        : stock dispo SAGE (réel − préparé) + arrivages − CDC fermes ;
 *  - mode Prévisionnel : on retire en plus le complément de prévision
 *                        max(ventes N-1 × coefficient − CDC fermes du mois, 0)
 *                        (les CDC fermes sont déjà une partie de la demande : pas de double compte).
 *    Coefficients par famille macro, modifiables : R/O 121 %, R/R 191 %, autres 100 %.
 *
 * Deux niveaux :
 *  - « Par référence » : une ligne par référence, triable (famille macro, famille, manque, solde d'un mois…) ;
 *  - « Qté pertinente » : agrégé par famille macro ou par famille, uniquement les familles
 *    ref_familles.pert_qte = true (U.E, monoblocs… — mêmes règles que les indicateurs de quantité pertinente).
 *    Le manque agrégé est la somme des soldes négatifs des références (un surstock sur une référence
 *    ne comble pas le manque d'une autre).
 *
 * Courbes : arrivages, CDC fermes (+ prévision), solde net et manque de la sélection — ou de la
 * ligne cliquée dans le tableau.
 *
 * Source : RPC get_penurie_projection_mensuelle(p_nb_mois)
 * (SQL supabase/migrations/20261021_penurie_projection_mensuelle.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type MoisData = {
  mois: string
  arrivages: number
  cdc: number
  non_tenable: number
  nb_cdc_non_tenables: number
  prevision_n1: number
}

type Ligne = {
  reference_article: string
  designation: string | null
  famille: string | null
  libelle_famille: string | null
  famille_macro: string | null
  pert_qte: boolean | null
  fournisseur_principal: string | null
  nom_fournisseur: string | null
  mystock: boolean | null
  sommeil: boolean | null
  arret_appro: boolean | null
  en_penurie: boolean | null
  cause: string | null
  stock_reel: number | null
  stock_disponible: number | null
  date_prochaine_dispo: string | null
  mois: MoisData[]
}

type MoisCalc = {
  mois: string
  arrivages: number
  cdc: number
  prev: number
  non_tenable: number
  nb_cdc_non_tenables: number
  prevision_n1: number
  solde: number
}

type RefCalc = Ligne & {
  calc: MoisCalc[]
  manque_max: number
  nt_total: number
  nb_cdc_nt: number
  mois_rupture: string | null
}

type MoisAgr = {
  mois: string
  arrivages: number
  cdc: number
  prev: number
  non_tenable: number
  soldeNet: number
  manque: number
  nbNeg: number
}

type Groupe = {
  cle: string
  libelle: string
  famille_macro: string
  nbRefs: number
  stock: number
  mois: MoisAgr[]
  manque_max: number
  nt_total: number
  refs: RefCalc[]
}

type Mode = 'ferme' | 'previsionnel'
type Niveau = 'reference' | 'pertinente'
type Regroupement = 'famille_macro' | 'famille'
type CleTri = 'reference_article' | 'famille_macro' | 'famille' | 'fournisseur' | 'stock' | 'nt' | 'manque' | 'rupture' | `m${number}`

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const COEF_DEFAUT: Record<string, number> = { 'R/O': 121, 'R/R': 191 }
const SANS = 'Sans famille'

const n0 = (v: number | null | undefined) => Number(v ?? 0)
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function libMois(m: string, court = false): string {
  const [a, mm] = m.split('-')
  const nom = NOMS_MOIS[Number(mm) - 1] || m
  return court ? nom : `${nom} ${a.slice(2)}`
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
function isoAujourdhui(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Agrège une liste de références calculées, mois par mois. */
function agreger(refs: RefCalc[], moisListe: string[]): MoisAgr[] {
  return moisListe.map((m, i) => {
    const a: MoisAgr = { mois: m, arrivages: 0, cdc: 0, prev: 0, non_tenable: 0, soldeNet: 0, manque: 0, nbNeg: 0 }
    for (const r of refs) {
      const c = r.calc[i]
      if (!c) continue
      a.arrivages += c.arrivages
      a.cdc += c.cdc
      a.prev += c.prev
      a.non_tenable += c.non_tenable
      a.soldeNet += c.solde
      if (c.solde < 0) { a.manque += c.solde; a.nbNeg += 1 }
    }
    return a
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'alerte' | 'warn' | 'ok' }) {
  const color = tone === 'alerte' ? '#B42318' : tone === 'warn' ? '#B4761A' : tone === 'ok' ? '#3F9142' : '#111820'
  return (
    <div className="min-w-0 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[20px] font-bold leading-7 tracking-tight" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[#8A8474]">{sub}</div>}
    </div>
  )
}

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>
}

/** Mini-courbe du solde projeté (SVG, sans librairie : une par ligne du tableau). */
function Sparkline({ values }: { values: number[] }) {
  const w = 96, h = 28, pad = 2
  if (values.length === 0) return null
  const min = Math.min(0, ...values), max = Math.max(0, ...values)
  const span = max - min || 1
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(values.length - 1, 1)
  const y = (v: number) => pad + ((max - v) * (h - 2 * pad)) / span
  const neg = values.some((v) => v < 0)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <line x1={pad} x2={w - pad} y1={y(0)} y2={y(0)} stroke="#D9D3C5" strokeDasharray="2 2" />
      <polyline fill="none" stroke={neg ? '#B42318' : '#3F9142'} strokeWidth={1.6} points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={1.6} fill={v < 0 ? '#B42318' : '#3F9142'} />)}
    </svg>
  )
}

/** Cellule mensuelle : solde en gras, détail des flux dessous. */
function CelluleMois({ arr, cdc, prev, nt, solde, mode, manque }: {
  arr: number; cdc: number; prev: number; nt: number; solde: number; mode: Mode; manque?: number
}) {
  return (
    <div className="leading-tight">
      <div className={`text-[12.5px] font-bold ${solde < 0 ? 'text-[#B42318]' : 'text-[#111820]'}`}>{fmtNum(solde)}</div>
      <div className="whitespace-nowrap text-[10px] text-[#8A8474]">
        <span className="text-[#3F9142]">+{fmtNum(arr)}</span>
        {' '}<span>−{fmtNum(cdc)}</span>
        {mode === 'previsionnel' && prev > 0 && <> <span className="text-[#8A5A08]">−{fmtNum(prev)}</span></>}
      </div>
      {(nt > 0 || (manque !== undefined && manque < 0)) && (
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          {nt > 0 && <Badge cls="bg-red-50 text-red-700" title="CDC fermes non tenables (INTENABLE / CREE_RETARD)">NT {fmtNum(nt)}</Badge>}
          {manque !== undefined && manque < 0 && <Badge cls="bg-[#B42318] text-white" title="Somme des soldes négatifs des références du groupe">manque {fmtNum(manque)}</Badge>}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function PenurieMensuelle() {
  const router = useRouter()
  const [rows, setRows] = useState<Ligne[]>([])
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargeLe, setChargeLe] = useState<Date | null>(null)

  const [niveau, setNiveau] = useState<Niveau>('reference')
  const [regroupement, setRegroupement] = useState<Regroupement>('famille_macro')
  const [mode, setMode] = useState<Mode>('ferme')
  const [coefs, setCoefs] = useState<Record<string, number>>(COEF_DEFAUT)
  const [coefAutres, setCoefAutres] = useState(100)

  const [search, setSearch] = useState('')
  const [familleMacroF, setFamilleMacroF] = useState('')
  const [familleF, setFamilleF] = useState('')
  const [fournF, setFournF] = useState('')
  const [mystockF, setMystockF] = useState<'oui' | 'non' | 'tous'>('oui')
  const [sommeilF, setSommeilF] = useState<'actives' | 'tous'>('actives')
  const [souffranceF, setSouffranceF] = useState<'souffrance' | 'nt' | 'tous'>('souffrance')
  const [tri, setTri] = useState<{ k: CleTri; dir: 1 | -1 }>({ k: 'manque', dir: 1 })
  const [nbAffichees, setNbAffichees] = useState(200)
  const [selection, setSelection] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_penurie_projection_mensuelle', { p_nb_mois: 6 })
    if (error) { setErreur(messageErreur(error)); setRows([]) }
    else { setRows((data || []) as Ligne[]); setChargeLe(new Date()) }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  const moisListe = useMemo(() => rows[0]?.mois.map((m) => m.mois) ?? [], [rows])
  const coefDe = useCallback((fm: string | null) => (fm && coefs[fm] !== undefined ? coefs[fm] : coefAutres) / 100, [coefs, coefAutres])

  // Calcul du solde projeté par référence (dépend du mode et des coefficients)
  const calculees: RefCalc[] = useMemo(() => rows.map((l) => {
    let solde = n0(l.stock_disponible)
    let manque = 0
    let rupture: string | null = null
    let nt = 0, nbNt = 0
    const k = coefDe(l.famille_macro)
    const calc: MoisCalc[] = (l.mois || []).map((m) => {
      const arr = n0(m.arrivages), cdc = n0(m.cdc)
      const prev = mode === 'previsionnel' ? Math.max(n0(m.prevision_n1) * k - cdc, 0) : 0
      solde = solde + arr - cdc - prev
      if (solde < manque) manque = solde
      if (solde < 0 && !rupture) rupture = m.mois
      nt += n0(m.non_tenable); nbNt += n0(m.nb_cdc_non_tenables)
      return { mois: m.mois, arrivages: arr, cdc, prev, non_tenable: n0(m.non_tenable), nb_cdc_non_tenables: n0(m.nb_cdc_non_tenables), prevision_n1: n0(m.prevision_n1), solde }
    })
    return { ...l, calc, manque_max: manque, nt_total: nt, nb_cdc_nt: nbNt, mois_rupture: rupture }
  }), [rows, mode, coefDe])

  // Listes des filtres
  const famillesMacro = useMemo(() => Array.from(new Set(rows.map((r) => r.famille_macro || SANS))).sort((a, b) => a.localeCompare(b, 'fr')), [rows])
  const familles = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach((r) => {
      if (familleMacroF && (r.famille_macro || SANS) !== familleMacroF) return
      if (niveau === 'pertinente' && !r.pert_qte) return
      const f = r.famille || SANS
      m.set(f, r.libelle_famille ? `${f} — ${r.libelle_famille}` : f)
    })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [rows, familleMacroF, niveau])
  const fournisseurs = useMemo(() => {
    const m = new Map<string, string>()
    rows.forEach((r) => { if (r.fournisseur_principal) m.set(r.fournisseur_principal, r.nom_fournisseur || r.fournisseur_principal) })
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'fr'))
  }, [rows])
  useEffect(() => { if (familleF && !familles.some(([f]) => f === familleF)) setFamilleF('') }, [familles, familleF])

  // Périmètre commun (filtres hors « en souffrance »)
  const perimetre = useMemo(() => {
    const s = normaliser(search.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    return calculees.filter((r) => {
      if (niveau === 'pertinente' && !r.pert_qte) return false
      if (sommeilF === 'actives' && r.sommeil) return false
      if (mystockF === 'oui' && r.mystock !== true) return false
      if (mystockF === 'non' && r.mystock === true) return false
      if (familleMacroF && (r.famille_macro || SANS) !== familleMacroF) return false
      if (familleF && (r.famille || SANS) !== familleF) return false
      if (fournF && r.fournisseur_principal !== fournF) return false
      if (termes.length) {
        const hay = normaliser(`${r.reference_article} ${r.designation} ${r.famille} ${r.libelle_famille} ${r.famille_macro} ${r.nom_fournisseur} ${r.fournisseur_principal}`)
        if (!termes.every((t) => hay.includes(t))) return false
      }
      return true
    })
  }, [calculees, niveau, sommeilF, mystockF, familleMacroF, familleF, fournF, search])

  // Niveau référence : filtre « en souffrance » + tri
  const references = useMemo(() => {
    const list = perimetre.filter((r) => {
      if (souffranceF === 'souffrance') return r.manque_max < 0 || r.nt_total > 0
      if (souffranceF === 'nt') return r.nt_total > 0
      return true
    })
    const val = (r: RefCalc): string | number | null => {
      if (typeof tri.k === 'string' && tri.k.startsWith('m') && /^m\d+$/.test(tri.k)) return r.calc[Number(tri.k.slice(1))]?.solde ?? null
      switch (tri.k) {
        case 'reference_article': return r.reference_article
        case 'famille_macro': return r.famille_macro
        case 'famille': return r.famille
        case 'fournisseur': return r.nom_fournisseur || r.fournisseur_principal
        case 'stock': return n0(r.stock_disponible)
        case 'nt': return r.nt_total
        case 'manque': return r.manque_max
        case 'rupture': return r.mois_rupture
        default: return null
      }
    }
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === null || va === '') return 1
      if (vb === null || vb === '') return -1
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr', { numeric: true })
      if (c !== 0) return c * tri.dir
      return a.reference_article.localeCompare(b.reference_article, 'fr')
    })
  }, [perimetre, souffranceF, tri])
  useEffect(() => { setNbAffichees(200) }, [references.length, tri, niveau])

  // Niveau qté pertinente : regroupement par famille macro ou famille
  const groupes: Groupe[] = useMemo(() => {
    if (niveau !== 'pertinente') return []
    const m = new Map<string, RefCalc[]>()
    perimetre.forEach((r) => {
      const cle = regroupement === 'famille_macro' ? (r.famille_macro || SANS) : (r.famille || SANS)
      const l = m.get(cle) || []
      l.push(r); m.set(cle, l)
    })
    const out: Groupe[] = Array.from(m.entries()).map(([cle, refs]) => {
      const mois = agreger(refs, moisListe)
      const lib = regroupement === 'famille' ? refs.find((r) => r.libelle_famille)?.libelle_famille || '' : ''
      return {
        cle,
        libelle: lib,
        famille_macro: refs[0]?.famille_macro || SANS,
        nbRefs: refs.length,
        stock: refs.reduce((s, r) => s + n0(r.stock_disponible), 0),
        mois,
        manque_max: Math.min(0, ...mois.map((x) => x.manque)),
        nt_total: mois.reduce((s, x) => s + x.non_tenable, 0),
        refs,
      }
    })
    const dir = tri.dir
    return out.sort((a, b) => {
      let c = 0
      if (tri.k === 'manque') c = a.manque_max - b.manque_max
      else if (tri.k === 'nt') c = a.nt_total - b.nt_total
      else if (tri.k === 'stock') c = a.stock - b.stock
      else if (/^m\d+$/.test(tri.k)) { const i = Number(tri.k.slice(1)); c = (a.mois[i]?.manque ?? 0) - (b.mois[i]?.manque ?? 0) }
      else c = a.cle.localeCompare(b.cle, 'fr')
      return (c || a.cle.localeCompare(b.cle, 'fr')) * (c ? dir : 1)
    })
  }, [niveau, perimetre, regroupement, moisListe, tri])

  // Sélection pour les courbes : une référence, un groupe, ou tout le périmètre affiché
  const baseCourbe: RefCalc[] = niveau === 'reference' ? references : perimetre
  const selectionRefs: RefCalc[] = useMemo(() => {
    if (!selection) return baseCourbe
    if (niveau === 'reference') return calculees.filter((r) => r.reference_article === selection)
    return groupes.find((g) => g.cle === selection)?.refs ?? baseCourbe
  }, [selection, niveau, calculees, groupes, baseCourbe])
  const libelleSelection = selection
    ? (niveau === 'reference' ? `Référence ${selection}` : `${regroupement === 'famille_macro' ? 'Famille macro' : 'Famille'} ${selection}`)
    : `Sélection affichée (${fmtNum(baseCourbe.length)} réf.)`
  useEffect(() => { setSelection(null) }, [niveau, regroupement])

  const serieCourbe = useMemo(() => {
    const stockDepart = selectionRefs.reduce((s, r) => s + n0(r.stock_disponible), 0)
    const agr = agreger(selectionRefs, moisListe)
    return [
      { label: 'Aujourd’hui', arrivages: 0, cdc: 0, prev: 0, soldeNet: stockDepart, manque: 0, nt: 0 },
      ...agr.map((a) => ({
        label: libMois(a.mois),
        arrivages: Math.round(a.arrivages),
        cdc: -Math.round(a.cdc),
        prev: -Math.round(a.prev),
        soldeNet: Math.round(a.soldeNet),
        manque: Math.round(a.manque),
        nt: Math.round(a.non_tenable),
      })),
    ]
  }, [selectionRefs, moisListe])

  // KPI du périmètre
  const kpis = useMemo(() => {
    const agr = agreger(perimetre, moisListe)
    const refsNeg = perimetre.filter((r) => r.manque_max < 0).length
    const refsNt = perimetre.filter((r) => r.nt_total > 0).length
    const nbCdcNt = perimetre.reduce((s, r) => s + r.nb_cdc_nt, 0)
    const ntQte = perimetre.reduce((s, r) => s + r.nt_total, 0)
    const pire = agr.reduce<MoisAgr | null>((p, a) => (!p || a.manque < p.manque ? a : p), null)
    const manqueMax = perimetre.reduce((s, r) => s + r.manque_max, 0)
    return { refs: perimetre.length, refsNeg, refsNt, nbCdcNt, ntQte, pire, manqueMax }
  }, [perimetre, moisListe])

  function basculerTri(k: CleTri) {
    setTri((t) => (t.k === k ? { k, dir: t.dir === 1 ? -1 : 1 } : { k, dir: ['reference_article', 'famille_macro', 'famille', 'fournisseur', 'rupture'].includes(k) ? 1 : (k === 'nt' ? -1 : 1) }))
  }
  function Th({ k, children, right, title, className = '' }: { k: CleTri; children: React.ReactNode; right?: boolean; title?: string; className?: string }) {
    const actif = tri.k === k
    return (
      <th title={title} onClick={() => basculerTri(k)}
        className={`sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap bg-[#F4F3F0] px-2 py-2 font-bold hover:bg-[#EDEAE1] ${right ? 'text-right' : 'text-left'} ${actif ? 'text-[#111820]' : ''} ${className}`}>
        {children}<span className={`ml-1 text-[10px] ${actif ? 'text-[#B4761A]' : 'text-[#C9C4B8]'}`}>{actif ? (tri.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </th>
    )
  }

  function changerNiveau(n: Niveau) {
    setNiveau(n)
    // agrégé : toutes les références par défaut (sinon le total sous-estime la demande)
    setMystockF(n === 'pertinente' ? 'tous' : 'oui')
    setTri(n === 'pertinente' ? { k: 'manque', dir: 1 } : { k: 'manque', dir: 1 })
  }
  function reinitialiser() { setSearch(''); setFamilleMacroF(''); setFamilleF(''); setFournF('') }
  const nbFiltres = [search.trim(), familleMacroF, familleF, fournF].filter(Boolean).length

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const hyp = mode === 'previsionnel'
        ? `Prévisionnel — ventes N-1 × coef. (${Object.entries(coefs).map(([k, v]) => `${k} ${v} %`).join(', ')}, autres ${coefAutres} %)`
        : 'Ferme — stock + arrivages − CDC fermes'
      if (niveau === 'reference') {
        const ws = wb.addWorksheet('Par référence')
        ws.addRow([`Pénuries — vue mensuelle — ${hyp} — calculé le ${new Date().toLocaleString('fr-FR')}`]).font = { bold: true }
        const entete = ['Référence', 'Désignation', 'Famille macro', 'Famille', 'Libellé famille', 'Fournisseur', 'MYSTOCK', 'Stock dispo']
        moisListe.forEach((m) => entete.push(`${libMois(m)} arrivages`, `${libMois(m)} CDC fermes`, `${libMois(m)} prév. ajoutée`, `${libMois(m)} non tenables`, `${libMois(m)} solde`))
        entete.push('Non tenables total', 'Nb CDC non tenables', 'Manque max', 'Mois de rupture')
        ws.addRow(entete).font = { bold: true }
        references.forEach((r) => {
          const l: (string | number)[] = [r.reference_article, r.designation || '', r.famille_macro || '', r.famille || '', r.libelle_famille || '', r.nom_fournisseur || r.fournisseur_principal || '', r.mystock ? 'OUI' : 'NON', n0(r.stock_disponible)]
          r.calc.forEach((c) => l.push(c.arrivages, c.cdc, Math.round(c.prev * 10) / 10, c.non_tenable, Math.round(c.solde * 10) / 10))
          l.push(r.nt_total, r.nb_cdc_nt, Math.round(r.manque_max * 10) / 10, r.mois_rupture ? libMois(r.mois_rupture) : '')
          ws.addRow(l)
        })
        ws.getColumn(1).width = 18; ws.getColumn(2).width = 38
        ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
      } else {
        const ws = wb.addWorksheet('Qté pertinente')
        ws.addRow([`Pénuries — quantités pertinentes par ${regroupement === 'famille_macro' ? 'famille macro' : 'famille'} — ${hyp} — calculé le ${new Date().toLocaleString('fr-FR')}`]).font = { bold: true }
        const entete = [regroupement === 'famille_macro' ? 'Famille macro' : 'Famille', 'Libellé', 'Nb réf.', 'Stock dispo']
        moisListe.forEach((m) => entete.push(`${libMois(m)} arrivages`, `${libMois(m)} CDC fermes`, `${libMois(m)} prév. ajoutée`, `${libMois(m)} non tenables`, `${libMois(m)} solde net`, `${libMois(m)} manque`, `${libMois(m)} nb réf. négatives`))
        entete.push('Non tenables total', 'Manque max')
        ws.addRow(entete).font = { bold: true }
        groupes.forEach((g) => {
          const l: (string | number)[] = [g.cle, g.libelle, g.nbRefs, g.stock]
          g.mois.forEach((a) => l.push(Math.round(a.arrivages), Math.round(a.cdc), Math.round(a.prev), Math.round(a.non_tenable), Math.round(a.soldeNet), Math.round(a.manque), a.nbNeg))
          l.push(Math.round(g.nt_total), Math.round(g.manque_max))
          ws.addRow(l)
        })
        ws.getColumn(1).width = 16; ws.getColumn(2).width = 30
        ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
      }
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `penuries_mensuel_${niveau === 'reference' ? 'references' : 'qte_pertinente'}_${mode}_${isoAujourdhui()}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const segBtn = (actif: boolean) => `rounded-md px-3 py-1.5 ${actif ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474] hover:text-[#3A362E]'}`
  const familleMacroCoefs = Array.from(new Set(['R/O', 'R/R', ...Object.keys(coefs)]))

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* Bandeau */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Pénuries — vue mensuelle</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Arrivages, commandes fermes, commandes non tenables et solde projeté de {moisListe.length ? `${libMois(moisListe[0])} à ${libMois(moisListe[moisListe.length - 1])}` : 'octobre à mars'}
              {chargeLe && <> · calculé à {chargeLe.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
              <button type="button" onClick={() => router.push('/stock/penurie')} className={segBtn(false)}>Vue commandes clients</button>
              <button type="button" onClick={() => router.push('/stock/penurie?vue=appro')} className={segBtn(false)}>Vue appro</button>
              <button type="button" className={segBtn(true)}>Vue mensuelle</button>
            </div>
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || (niveau === 'reference' ? references.length === 0 : groupes.length === 0)}
              className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">
              {exportEnCours ? 'Export…' : '⬇ Excel'}
            </button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            {erreur}{/get_penurie_projection_mensuelle/.test(erreur) ? ' — la migration 20261021_penurie_projection_mensuelle.sql est-elle appliquée ?' : ''}
          </div>
        )}

        {/* Niveau, mode, hypothèses */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
            <button type="button" onClick={() => changerNiveau('reference')} className={segBtn(niveau === 'reference')}>Par référence</button>
            <button type="button" onClick={() => changerNiveau('pertinente')} className={segBtn(niveau === 'pertinente')}
              title="Familles à quantité pertinente uniquement (ref_familles.pert_qte), agrégées par famille macro ou par famille">Qté pertinente</button>
          </div>
          {niveau === 'pertinente' && (
            <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12px] font-bold">
              <button type="button" onClick={() => setRegroupement('famille_macro')} className={segBtn(regroupement === 'famille_macro')}>par famille macro</button>
              <button type="button" onClick={() => setRegroupement('famille')} className={segBtn(regroupement === 'famille')}>par famille</button>
            </div>
          )}
          <div className="h-6 w-px bg-[#E5E1D8]" />
          <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
            <button type="button" onClick={() => setMode('ferme')} className={segBtn(mode === 'ferme')}>Ferme</button>
            <button type="button" onClick={() => setMode('previsionnel')} className={segBtn(mode === 'previsionnel')}>Ferme + prévisionnel</button>
          </div>
          {mode === 'previsionnel' && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-bold text-[#3A362E]">Ventes N-1 ×</span>
              {familleMacroCoefs.map((fm) => (
                <label key={fm} className="flex items-center gap-1">
                  <span className="font-semibold text-[#5E5A50]">{fm}</span>
                  <input type="number" min={0} step={1} value={coefs[fm] ?? coefAutres}
                    onChange={(e) => setCoefs((c) => ({ ...c, [fm]: Number(e.target.value) || 0 }))}
                    className="h-8 w-16 rounded-md border border-[#E5E1D8] px-1 text-right font-bold" />
                  <span className="text-[#8A8474]">%</span>
                </label>
              ))}
              <label className="flex items-center gap-1">
                <span className="font-semibold text-[#5E5A50]">Autres</span>
                <input type="number" min={0} step={1} value={coefAutres} onChange={(e) => setCoefAutres(Number(e.target.value) || 0)}
                  className="h-8 w-16 rounded-md border border-[#E5E1D8] px-1 text-right font-bold" />
                <span className="text-[#8A8474]">%</span>
              </label>
              <button type="button" onClick={() => { setCoefs({ 'R/O': 100, 'R/R': 100 }); setCoefAutres(100) }}
                className="h-8 rounded-md border border-[#E5E1D8] px-2 font-bold text-[#3A362E] hover:border-[#B4761A]">100 % N-1</button>
              <button type="button" onClick={() => { setCoefs(COEF_DEFAUT); setCoefAutres(100) }}
                className="h-8 rounded-md border border-[#E5E1D8] px-2 font-bold text-[#3A362E] hover:border-[#B4761A]">R/O 121 % · R/R 191 %</button>
            </div>
          )}
        </section>

        {/* KPI */}
        <section className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Kpi label={niveau === 'pertinente' ? 'Références (qté pertinente)' : 'Références du périmètre'} value={loading ? '…' : fmtNum(kpis.refs)} sub={`${fmtNum(kpis.refsNeg)} passent en négatif d’ici ${moisListe.length ? libMois(moisListe[moisListe.length - 1]) : 'mars'}`} tone={kpis.refsNeg > 0 ? 'alerte' : 'ok'} />
          <Kpi label="CDC fermes non tenables" value={loading ? '…' : fmtNum(kpis.ntQte)} sub={`${fmtNum(kpis.nbCdcNt)} ligne(s) CDC · ${fmtNum(kpis.refsNt)} réf. — risque de perte`} tone={kpis.ntQte > 0 ? 'alerte' : 'ok'} />
          <Kpi label="Mois le plus tendu" value={loading || !kpis.pire ? '…' : libMois(kpis.pire.mois)} sub={kpis.pire ? `manque ${fmtNum(kpis.pire.manque)} p. · ${fmtNum(kpis.pire.nbNeg)} réf. négatives` : ''} tone="warn" />
          <Kpi label="Manque max cumulé" value={loading ? '…' : fmtNum(kpis.manqueMax)} sub={mode === 'previsionnel' ? 'ferme + prévisionnel, point bas de chaque réf.' : 'ferme, point bas de chaque réf.'} tone={kpis.manqueMax < 0 ? 'alerte' : 'ok'} />
        </section>

        {/* Filtres */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="grid gap-1.5" style={{ gridTemplateColumns: 'minmax(220px, 2fr) repeat(6, minmax(0, 1fr))' }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, désignation, famille, fournisseur…" className={`${ctl} font-medium`} />
            <select value={familleMacroF} onChange={(e) => { setFamilleMacroF(e.target.value); setFamilleF('') }} className={`${ctl} ${familleMacroF ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
              <option value="">Famille macro : toutes</option>
              {famillesMacro.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={familleF} onChange={(e) => setFamilleF(e.target.value)} className={`${ctl} ${familleF ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
              <option value="">Famille : toutes</option>
              {familles.map(([code, lib]) => <option key={code} value={code}>{lib}</option>)}
            </select>
            <select value={fournF} onChange={(e) => setFournF(e.target.value)} className={ctl}>
              <option value="">Fournisseur : tous</option>
              {fournisseurs.map(([code, nom]) => <option key={code} value={code}>{nom}</option>)}
            </select>
            <select value={mystockF} onChange={(e) => setMystockF(e.target.value as 'oui' | 'non' | 'tous')} className={`${ctl} ${mystockF !== 'tous' ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
              <option value="oui">MYSTOCK : oui</option>
              <option value="non">MYSTOCK : non</option>
              <option value="tous">MYSTOCK : tous</option>
            </select>
            <select value={sommeilF} onChange={(e) => setSommeilF(e.target.value as 'actives' | 'tous')} className={ctl}>
              <option value="actives">Sommeil : exclus</option>
              <option value="tous">Sommeil : inclus</option>
            </select>
            {niveau === 'reference' ? (
              <select value={souffranceF} onChange={(e) => setSouffranceF(e.target.value as 'souffrance' | 'nt' | 'tous')} className={`${ctl} ${souffranceF !== 'tous' ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
                <option value="souffrance">En souffrance (négatif ou NT)</option>
                <option value="nt">Avec CDC non tenables</option>
                <option value="tous">Toutes les références</option>
              </select>
            ) : <div />}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[#8A8474]">
            <span>
              {niveau === 'reference'
                ? `${fmtNum(references.length)} référence(s) affichée(s) sur ${fmtNum(perimetre.length)} du périmètre`
                : `${fmtNum(groupes.length)} ${regroupement === 'famille_macro' ? 'famille(s) macro' : 'famille(s)'} · ${fmtNum(perimetre.length)} référence(s) à quantité pertinente`}
              {' · cellule : '}<b className="text-[#111820]">solde fin de mois</b>{' · '}<span className="text-[#3F9142]">+arrivages</span>{' −CDC fermes'}{mode === 'previsionnel' && <> <span className="text-[#8A5A08]">−prévision</span></>}{' · NT = non tenables'}
            </span>
            {nbFiltres > 0 && <button type="button" onClick={reinitialiser} className="font-bold text-[#B4761A] hover:underline">✕ effacer les filtres ({nbFiltres})</button>}
          </div>
        </section>

        {/* Courbes */}
        <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">
              Flux et solde projeté — {libelleSelection}{mode === 'previsionnel' ? ' — ferme + prévisionnel' : ' — ferme'}
            </div>
            {selection && <button type="button" onClick={() => setSelection(null)} className="text-[11.5px] font-bold text-[#B4761A] hover:underline">✕ revenir à toute la sélection</button>}
          </div>
          <div className="h-[260px]">
            {loading ? <div className="flex h-full items-center justify-center text-[12px] text-[#8A8474]">Chargement…</div> : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serieCourbe} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} stackOffset="sign">
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDEAE1" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} width={52} tickFormatter={(v) => fmtNum(Number(v))} />
                  <Tooltip formatter={(v, name) => [fmtNum(Math.abs(Number(v))), String(name)]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#B42318" strokeDasharray="4 3" />
                  <Bar dataKey="arrivages" name="Arrivages (CDF)" fill="#7FB77E" stackId="flux" isAnimationActive={false} />
                  <Bar dataKey="cdc" name="CDC fermes" fill="#5E5A50" stackId="flux" isAnimationActive={false} />
                  {mode === 'previsionnel' && <Bar dataKey="prev" name="Prévision ajoutée" fill="#D9A55B" stackId="flux" isAnimationActive={false} />}
                  <Line type="monotone" dataKey="soldeNet" name="Solde net projeté" stroke="#0B1220" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="manque" name="Manque (somme des réf. négatives)" stroke="#B42318" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="nt" name="CDC non tenables" stroke="#B4761A" strokeWidth={1.5} dot={{ r: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="mt-1 text-[10.5px] text-[#8A8474]">
            Cliquer une ligne du tableau pour afficher ses courbes. Le solde net additionne les références (un surstock compense un manque) ; le manque, lui, ne retient que les soldes négatifs — c’est la quantité réellement manquante.
          </p>
        </section>

        {/* Tableau */}
        <section className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
          <div className="max-h-[calc(100vh-280px)] min-h-[300px] overflow-auto">
            {niveau === 'reference' ? (
              <table className="w-full text-[12px]">
                <thead className="text-[10.5px] uppercase text-[#8A8474]">
                  <tr>
                    <Th k="reference_article" className="left-0 z-20">Référence</Th>
                    <Th k="famille_macro">Fam. macro</Th>
                    <Th k="famille">Famille</Th>
                    <Th k="fournisseur">Fournisseur</Th>
                    <Th k="stock" right title="Stock SAGE tous dépôts, réel − préparé">Stock dispo</Th>
                    {moisListe.map((m, i) => (
                      <Th key={m} k={`m${i}`} right title={`Trier par solde fin ${libMois(m)}${i === 0 ? ' (CDC et CDF en retard comptées ici)' : ''}`}>{libMois(m)}{i === 0 ? '*' : ''}</Th>
                    ))}
                    <Th k="nt" right title="Quantité des CDC fermes non tenables (INTENABLE / CREE_RETARD) sur la période">NT total</Th>
                    <Th k="manque" right title="Point bas du solde projeté sur la période">Manque max</Th>
                    <Th k="rupture" title="Premier mois de solde négatif">Rupture</Th>
                    <th className="sticky top-0 z-10 bg-[#F4F3F0] px-2 py-2 text-left font-bold">Courbe</th>
                  </tr>
                </thead>
                <tbody>
                  {references.slice(0, nbAffichees).map((r) => {
                    const actif = selection === r.reference_article
                    return (
                      <tr key={r.reference_article} onClick={() => setSelection(actif ? null : r.reference_article)}
                        className={`cursor-pointer border-t border-[#F0EDE6] align-top ${actif ? 'bg-[#B4761A]/[0.08]' : 'hover:bg-[#FAF8F3]'}`}>
                        <td className={`sticky left-0 z-[1] max-w-[260px] px-2 py-1.5 ${actif ? 'bg-[#F7EEDF]' : 'bg-white'}`}>
                          <div className="flex items-center gap-1">
                            <a href={`/stock/penurie?ref=${encodeURIComponent(r.reference_article)}&mystock=tous`} onClick={(e) => e.stopPropagation()}
                              className="font-bold text-[#111820] hover:text-[#B4761A] hover:underline" title="Ouvrir la fiche pénurie de la référence">{r.reference_article}</a>
                            {r.mystock && <Badge cls="bg-[#0B1220] text-white">MYSTOCK</Badge>}
                            {r.arret_appro && <Badge cls="bg-violet-100 text-violet-900">Arrêt appro</Badge>}
                          </div>
                          <div className="truncate text-[11px] text-[#8A8474]" title={r.designation || ''}>{r.designation}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-[#5E5A50]">{r.famille_macro || '—'}</td>
                        <td className="max-w-[160px] truncate px-2 py-1.5 text-[#5E5A50]" title={r.libelle_famille || ''}>{r.famille || '—'}</td>
                        <td className="max-w-[150px] truncate px-2 py-1.5" title={r.fournisseur_principal || ''}>{r.nom_fournisseur || r.fournisseur_principal || '—'}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right ${n0(r.stock_disponible) <= 0 ? 'text-red-700' : ''}`}>{fmtNum(r.stock_disponible)}</td>
                        {r.calc.map((c) => (
                          <td key={c.mois} className={`px-2 py-1.5 text-right ${c.solde < 0 ? 'bg-red-50/60' : ''}`}>
                            <CelluleMois arr={c.arrivages} cdc={c.cdc} prev={c.prev} nt={c.non_tenable} solde={c.solde} mode={mode} />
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">
                          {r.nt_total > 0 ? <span className="font-bold text-[#B42318]" title={`${fmtNum(r.nb_cdc_nt)} ligne(s) CDC`}>{fmtNum(r.nt_total)}</span> : <span className="text-[#C9C4B8]">0</span>}
                        </td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right font-bold ${r.manque_max < 0 ? 'text-[#B42318]' : 'text-[#C9C4B8]'}`}>{fmtNum(r.manque_max)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{r.mois_rupture ? libMois(r.mois_rupture) : '—'}</td>
                        <td className="px-2 py-1"><Sparkline values={[n0(r.stock_disponible), ...r.calc.map((c) => c.solde)]} /></td>
                      </tr>
                    )
                  })}
                  {!loading && references.length === 0 && (
                    <tr><td colSpan={10 + moisListe.length} className="px-4 py-10 text-center text-[#8A8474]">Aucune référence avec ces filtres.</td></tr>
                  )}
                  {loading && <tr><td colSpan={10 + moisListe.length} className="px-4 py-10 text-center text-[#8A8474]">Calcul en cours…</td></tr>}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="text-[10.5px] uppercase text-[#8A8474]">
                  <tr>
                    <Th k={regroupement === 'famille_macro' ? 'famille_macro' : 'famille'}>{regroupement === 'famille_macro' ? 'Famille macro' : 'Famille'}</Th>
                    <th className="sticky top-0 z-10 bg-[#F4F3F0] px-2 py-2 text-right font-bold">Nb réf.</th>
                    <Th k="stock" right>Stock dispo</Th>
                    {moisListe.map((m, i) => (
                      <Th key={m} k={`m${i}`} right title={`Trier par manque fin ${libMois(m)}`}>{libMois(m)}{i === 0 ? '*' : ''}</Th>
                    ))}
                    <Th k="nt" right>NT total</Th>
                    <Th k="manque" right title="Plus forte somme des soldes négatifs sur la période">Manque max</Th>
                  </tr>
                </thead>
                <tbody>
                  {groupes.map((g) => {
                    const actif = selection === g.cle
                    return (
                      <tr key={g.cle} onClick={() => setSelection(actif ? null : g.cle)}
                        className={`cursor-pointer border-t border-[#F0EDE6] align-top ${actif ? 'bg-[#B4761A]/[0.08]' : 'hover:bg-[#FAF8F3]'}`}>
                        <td className="px-2 py-1.5">
                          <div className="font-bold">{g.cle}</div>
                          {regroupement === 'famille' && <div className="text-[11px] text-[#8A8474]">{g.libelle || '—'} · {g.famille_macro}</div>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtNum(g.nbRefs)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">{fmtNum(g.stock)}</td>
                        {g.mois.map((a) => (
                          <td key={a.mois} className={`px-2 py-1.5 text-right ${a.manque < 0 ? 'bg-red-50/60' : ''}`}>
                            <CelluleMois arr={a.arrivages} cdc={a.cdc} prev={a.prev} nt={a.non_tenable} solde={a.soldeNet} mode={mode} manque={a.manque} />
                            {a.nbNeg > 0 && <div className="text-[10px] text-[#8A8474]">{fmtNum(a.nbNeg)} réf. nég.</div>}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-2 py-1.5 text-right">{g.nt_total > 0 ? <span className="font-bold text-[#B42318]">{fmtNum(g.nt_total)}</span> : <span className="text-[#C9C4B8]">0</span>}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right font-bold ${g.manque_max < 0 ? 'text-[#B42318]' : 'text-[#C9C4B8]'}`}>{fmtNum(g.manque_max)}</td>
                      </tr>
                    )
                  })}
                  {groupes.length > 1 && (() => {
                    const tot = agreger(perimetre, moisListe)
                    return (
                      <tr className="border-t-2 border-[#E5E1D8] bg-[#FAF8F3] align-top font-bold">
                        <td className="px-2 py-1.5">Total</td>
                        <td className="px-2 py-1.5 text-right">{fmtNum(perimetre.length)}</td>
                        <td className="px-2 py-1.5 text-right">{fmtNum(perimetre.reduce((s, r) => s + n0(r.stock_disponible), 0))}</td>
                        {tot.map((a) => (
                          <td key={a.mois} className="px-2 py-1.5 text-right">
                            <CelluleMois arr={a.arrivages} cdc={a.cdc} prev={a.prev} nt={a.non_tenable} solde={a.soldeNet} mode={mode} manque={a.manque} />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-right">{fmtNum(tot.reduce((s, a) => s + a.non_tenable, 0))}</td>
                        <td className="px-2 py-1.5 text-right text-[#B42318]">{fmtNum(Math.min(0, ...tot.map((a) => a.manque)))}</td>
                      </tr>
                    )
                  })()}
                  {!loading && groupes.length === 0 && (
                    <tr><td colSpan={5 + moisListe.length} className="px-4 py-10 text-center text-[#8A8474]">Aucune famille à quantité pertinente avec ces filtres.</td></tr>
                  )}
                  {loading && <tr><td colSpan={5 + moisListe.length} className="px-4 py-10 text-center text-[#8A8474]">Calcul en cours…</td></tr>}
                </tbody>
              </table>
            )}
          </div>
          {niveau === 'reference' && references.length > nbAffichees && (
            <div className="border-t border-[#E5E1D8] px-3 py-2 text-center">
              <button type="button" onClick={() => setNbAffichees((n) => n + 200)} className="text-[12px] font-bold text-[#B4761A] hover:underline">Afficher 200 de plus ({fmtNum(references.length - nbAffichees)} restantes)</button>
            </div>
          )}
        </section>
        <p className="px-1 text-[10.5px] text-[#8A8474]">
          * Mois en cours : les CDC et CDF en retard ou sans date y sont comptées, et la prévision N-1 est réduite au prorata des jours restants.
          Les ventes N-1 sont des quantités facturées : les ventes perdues l’an dernier faute de stock n’y figurent pas.
        </p>
      </div>
    </main>
  )
}

export default function PenurieMensuellePage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <PenurieMensuelle />
    </Suspense>
  )
}
