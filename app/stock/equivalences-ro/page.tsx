'use client'

/**
 * Écran « Équivalences R/O AirH2O 600 / 800 » (menu Stocks & logistique, /stock/equivalences-ro).
 * ---------------------------------------------------------------------------
 * Créé le 21/10/2026 — v2 le même jour, validée par Arnaud sur l'exemple de la taille 3,5.
 *
 * Pénurie R/O hiver 2026-2027 : les groupes extérieurs AirH2O 600 (split) et 800 (monobloc)
 * manquent jusqu'à fin mars. Un groupe ne se vend pas seul : selon l'usage, il entre dans une
 * solution (groupe + module intérieur + ballon / accessoire). Pour chaque taille, chaque groupe
 * et chaque usage, l'écran montre :
 *  - la solution AirH2O actuelle ;
 *  - en face, des solutions backup d'anciennes générations (Premium, S-Combi, Yutaki M/H,
 *    AirH2O 400…) — règle d'Arnaud : puissance équivalente ou supérieure, gestion commerciale
 *    et marge, sans passer par le technique.
 * Pour chaque solution : prix public de chaque composant, stock libre (promettable aujourd'hui,
 * après les CDC déjà prises), composant limitant, nombre de solutions réalisables
 * (min libre / quantité), prix total et écart avec la solution AirH2O.
 *
 * Usages : Chauffage / réversible (S), Chauffage + ECS (S + ballon séparé), Combi (220 L intégrés),
 *          Monobloc H, Monobloc H Combi.
 *
 * Glisser-déposer :
 *  - un article du panneau de droite (ou de la recherche SAGE) sur une solution = l'ajouter
 *    comme composant (module, ballon, kit…) ; sur la zone vide d'un usage = nouvelle solution ;
 *  - une solution vers un autre usage / un autre groupe = la déplacer (Ctrl ou Alt = copier) ;
 *    sur une autre solution du même usage = changer l'ordre de proposition ;
 *  - un composant d'une solution vers une autre = le déplacer (Ctrl ou Alt = copier) ;
 *  - × retire un composant ou une solution ; le nom et la quantité se modifient directement.
 * Tout est partagé (tables stock_solutions / stock_solution_composants).
 *
 * Sources : RPC get_equivalences_ro remplacée par get_solutions_ro, rechercher_article_equivalence
 * (SQL supabase/migrations/20261021c_solutions_ro.sql).
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '@/lib/supabaseClient'

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Usage = 'S' | 'S_ECS' | 'COMBI' | 'MONO_H' | 'MONO_H_COMBI'
type Role = 'actuelle' | 'backup'
type MoisData = { mois: string; arrivages: number; cdc: number; non_tenable: number }

type Cible = {
  ref: string
  designation: string | null
  gamme: '600' | '800'
  taille: string
  alim: string
  prix: number | null
  stock_disponible: number | null
  qte_dispo_aujourdhui: number | null
  besoin_cdc_total: number | null
  nb_cdc: number | null
  date_prochaine_dispo: string | null
  mois: MoisData[]
}

type Article = {
  designation: string | null
  famille: string | null
  prix: number | null
  stock_disponible: number | null
  libre: number | null
  cdc?: number | null
  cdf?: number | null
  prochaine_reception_date?: string | null
  date_prochaine_dispo?: string | null
  pool?: boolean
  sommeil?: boolean | null
}

type Composant = { id: string; ref: string; quantite: number; rang: number }

type Solution = {
  id: string
  ref_cible: string
  usage: Usage
  role: Role
  libelle: string | null
  rang: number
  origine: 'auto' | 'manuel'
  commentaire: string | null
  modifie_par?: string | null
  composants: Composant[]
}

type Donnees = { calcule_le: string; cibles: Cible[]; solutions: Solution[]; articles: Record<string, Article> }

type Glisse =
  | { type: 'article'; ref: string }
  | { type: 'solution'; id: string; ref_cible: string; usage: Usage; role: Role }
  | { type: 'composant'; id: string; ref: string; solutionId: string }

type Calcul = { total: number; realisable: number; limitants: Set<string>; manquePrix: boolean }

type RawSolution = {
  id: string; ref_cible: string; usage: Usage; role: Role; libelle: string | null; rang: number
  origine: 'auto' | 'manuel'; commentaire: string | null; created_by_email: string | null; updated_by_email: string | null
  stock_solution_composants: { id: string; ref_article: string; quantite: number; rang: number }[] | null
}

// ─────────────────────────────────────────────────────────────────────────
// Constantes et helpers
// ─────────────────────────────────────────────────────────────────────────

const USAGES: Record<Usage, { label: string; sub: string; gamme: '600' | '800' }> = {
  S: { label: 'Chauffage / réversible', sub: 'module hydraulique S', gamme: '600' },
  S_ECS: { label: 'Chauffage + ECS', sub: 'S + ballon séparé', gamme: '600' },
  COMBI: { label: 'Combi', sub: 'ECS 220 L intégrée', gamme: '600' },
  MONO_H: { label: 'Monobloc H', sub: 'module hydraulique', gamme: '800' },
  MONO_H_COMBI: { label: 'Monobloc H Combi', sub: 'ECS 220 L intégrée', gamme: '800' },
}
const USAGES_600: Usage[] = ['S', 'S_ECS', 'COMBI']
const USAGES_800: Usage[] = ['MONO_H', 'MONO_H_COMBI']
const TAILLE_KW_600: Record<string, string> = { '1.5': '3,5 kW', '2': '4 kW', '2.5': '6 kW', '3': '8 kW', '3.5': '8,5 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }
const TAILLE_KW_800: Record<string, string> = { '2': '4 kW', '3': '6 kW', '3.5': '8 kW', '4': '10 kW', '5': '12 kW', '6': '14 kW' }
const NOMS_MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

const n0 = (v: number | null | undefined) => Number(v ?? 0)
function fmtNum(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fmtPrix(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return `${Math.round(Number(v)).toLocaleString('fr-FR')} €`
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}
function libMois(m: string): string {
  return NOMS_MOIS[Number(m.split('-')[1]) - 1] || m
}
function nonConfirme(m: string): boolean {
  return Number(m.slice(0, 4)) > new Date().getFullYear()
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
const estNouvelleGen = (ref: string) => /^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E|RWM-[0-9.]+R3E|RWD-[0-9.]+RW3E-220S|HWM-W2E|HWD-W2E-220S)$/.test(ref)

/** Catégorie du panneau de droite. */
function categorie(ref: string, a: Article | undefined): string {
  const f = a?.famille || ''
  if (f === '00RORASUE' || f === '00ROH2OUE') return '1. Groupes extérieurs split'
  if (f === '00RORASM') return '2. Groupes monobloc'
  if (['00RORWMUI', '00RORWDUI', '00RORWHUI', '00ROHUI', '00ROH2OUI'].includes(f)) return '3. Modules intérieurs'
  if (f === '00ROECS') return '4. Ballons ECS'
  if (f === '00ACC') return '5. Accessoires'
  return ref.startsWith('RAS') ? '1. Groupes extérieurs split' : '6. Autres'
}
/** Libellé par défaut d'une nouvelle solution créée à partir d'un article. */
function libelleDefaut(ref: string): string {
  if (/^RAS-(8|10)WH/.test(ref)) return 'IVX'
  if (/^RAS-[0-9.]+WHV?NPE$/.test(ref)) return 'Premium'
  if (/^RAS-[0-9.]+WHVRP1$/.test(ref)) return 'Premium R32'
  if (/^RAS-[0-9.]+WHVN$/.test(ref)) return 'S-Combi Lite'
  if (/^HZKF/.test(ref)) return 'AirH2O 400'
  if (/^RASM-.*RW1E$/.test(ref)) return 'Yutaki H'
  if (/^RASM-/.test(ref)) return 'Yutaki M'
  return 'Solution'
}

function calculer(sol: Solution | undefined, articles: Record<string, Article>): Calcul {
  if (!sol || sol.composants.length === 0) return { total: 0, realisable: 0, limitants: new Set(), manquePrix: false }
  let total = 0
  let manquePrix = false
  let realisable = Infinity
  const parRef = sol.composants.map((c) => {
    const a = articles[c.ref]
    if (a?.prix === null || a?.prix === undefined) manquePrix = true
    total += n0(a?.prix) * n0(c.quantite)
    const r = Math.floor(Math.max(0, n0(a?.libre)) / Math.max(n0(c.quantite), 1))
    realisable = Math.min(realisable, r)
    return { ref: c.ref, r }
  })
  const limitants = new Set(sol.composants.length > 1 ? parRef.filter((x) => x.r === realisable).map((x) => x.ref) : [])
  return { total, realisable: Number.isFinite(realisable) ? realisable : 0, limitants, manquePrix }
}

// ─────────────────────────────────────────────────────────────────────────
// Petits composants
// ─────────────────────────────────────────────────────────────────────────

function Badge({ cls, children, title }: { cls: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>
}

function LibreTag({ a, limitant }: { a: Article | undefined; limitant?: boolean }) {
  const libre = n0(a?.libre)
  const stock = n0(a?.stock_disponible)
  const cls = libre <= 0 ? 'bg-red-50 text-red-700' : libre < 3 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'
  const suite = libre <= 0 && a?.date_prochaine_dispo ? ` · ${fmtDate(a.date_prochaine_dispo)}` : ''
  return (
    <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${cls} ${limitant ? 'ring-[1.5px] ring-[#B4761A]' : ''}`}
      title={`Libre (promettable aujourd’hui) ${fmtNum(libre)} · stock dispo ${fmtNum(stock)}${n0(a?.cdc) ? ` · CDC ${fmtNum(a?.cdc)}` : ''}${n0(a?.cdf) ? ` · CDF ${fmtNum(a?.cdf)}` : ''}${a?.date_prochaine_dispo ? ` · prochaine dispo ${fmtDate(a.date_prochaine_dispo)}` : ''}${limitant ? ' — composant limitant' : ''}`}>
      libre {fmtNum(libre)}{suite}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

function EquivalencesRO() {
  const [donnees, setDonnees] = useState<Donnees | null>(null)
  const [solutions, setSolutions] = useState<Solution[]>([])
  const [articlesExtra, setArticlesExtra] = useState<Record<string, Article>>({})
  const [loading, setLoading] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  const [gammeF, setGammeF] = useState<'' | '600' | '800'>('')
  const [alimF, setAlimF] = useState('')
  const [tailleF, setTailleF] = useState('')
  const [search, setSearch] = useState('')
  const [poolSearch, setPoolSearch] = useState('')
  const [poolAvecStock, setPoolAvecStock] = useState(true)
  const [rechercheArt, setRechercheArt] = useState('')
  const [resultatsArt, setResultatsArt] = useState<(Article & { ref: string })[]>([])
  const [survolZone, setSurvolZone] = useState<string | null>(null)
  const [exportEnCours, setExportEnCours] = useState(false)
  const glisse = useRef<Glisse | null>(null)

  const charger = useCallback(async () => {
    setLoading(true); setErreur(null)
    const { data, error } = await supabase.rpc('get_solutions_ro')
    if (error) { setErreur(messageErreur(error)); setDonnees(null) }
    else {
      const d = data as Donnees
      setDonnees(d)
      setSolutions((d.solutions || []).map((s) => ({ ...s, composants: s.composants || [] })))
      setArticlesExtra({})
    }
    setLoading(false)
  }, [])
  useEffect(() => { void charger() }, [charger])

  /** Rechargement rapide des seules solutions après une modification. */
  const rechargerSolutions = useCallback(async () => {
    const { data, error } = await supabase.from('stock_solutions')
      .select('id,ref_cible,usage,role,libelle,rang,origine,commentaire,created_by_email,updated_by_email,stock_solution_composants(id,ref_article,quantite,rang)')
      .eq('groupe', 'RO_AIRH2O')
    if (error) { setErreur(messageErreur(error)); return }
    setSolutions(((data || []) as unknown as RawSolution[]).map((s) => ({
      id: s.id, ref_cible: s.ref_cible, usage: s.usage, role: s.role, libelle: s.libelle, rang: Number(s.rang),
      origine: s.origine, commentaire: s.commentaire, modifie_par: s.updated_by_email || s.created_by_email,
      composants: (s.stock_solution_composants || []).map((c) => ({ id: c.id, ref: c.ref_article, quantite: Number(c.quantite), rang: Number(c.rang) }))
        .sort((a, b) => a.rang - b.rang),
    })))
  }, [])

  // Recherche dans toute la base SAGE
  useEffect(() => {
    const q = rechercheArt.trim()
    if (q.length < 2) { setResultatsArt([]); return }
    let annule = false
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('rechercher_article_equivalence', { p_q: q })
      if (annule) return
      if (error) { setErreur(messageErreur(error)); return }
      setResultatsArt(((data || []) as { ref: string; designation: string | null; famille: string | null; prix: number | null; stock_disponible: number | null }[])
        .map((r) => ({ ref: r.ref, designation: r.designation, famille: r.famille, prix: r.prix, stock_disponible: r.stock_disponible, libre: Math.max(0, n0(r.stock_disponible)) })))
    }, 300)
    return () => { annule = true; clearTimeout(t) }
  }, [rechercheArt])

  const articles = useMemo(() => ({ ...articlesExtra, ...(donnees?.articles ?? {}) }), [donnees, articlesExtra])
  const cibles = useMemo(() => donnees?.cibles ?? [], [donnees])

  const parUsage = useMemo(() => {
    const m = new Map<string, { actuelle?: Solution; backups: Solution[] }>()
    solutions.forEach((s) => {
      const k = `${s.ref_cible}|${s.usage}`
      const e = m.get(k) || { backups: [] }
      if (s.role === 'actuelle') e.actuelle = s
      else e.backups.push(s)
      m.set(k, e)
    })
    m.forEach((e) => e.backups.sort((a, b) => a.rang - b.rang || a.id.localeCompare(b.id)))
    return m
  }, [solutions])

  /** Nombre de solutions backup qui utilisent chaque référence (stock partagé). */
  const partages = useMemo(() => {
    const m = new Map<string, number>()
    solutions.forEach((s) => s.composants.forEach((c) => m.set(c.ref, (m.get(c.ref) || 0) + 1)))
    return m
  }, [solutions])

  const tailles = useMemo(() => {
    const s = normaliser(search.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = cibles.filter((c) => {
      if (gammeF && c.gamme !== gammeF) return false
      if (alimF && c.alim !== alimF) return false
      if (tailleF && c.taille !== tailleF) return false
      if (termes.length) {
        const comps = solutions.filter((x) => x.ref_cible === c.ref).flatMap((x) => [x.libelle || '', ...x.composants.map((k) => k.ref)]).join(' ')
        if (!termes.every((t) => normaliser(`${c.ref} ${c.designation} ${comps}`).includes(t))) return false
      }
      return true
    })
    const m = new Map<string, Cible[]>()
    list.forEach((c) => { const a = m.get(c.taille) || []; a.push(c); m.set(c.taille, a) })
    return Array.from(m.entries()).sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([taille, rows]) => ({ taille, rows: rows.sort((a, b) => a.gamme.localeCompare(b.gamme) || a.alim.localeCompare(b.alim)) }))
  }, [cibles, gammeF, alimF, tailleF, search, solutions])

  const listeTailles = useMemo(() => Array.from(new Set(cibles.map((c) => c.taille))).sort((a, b) => Number(a) - Number(b)), [cibles])
  const alims = useMemo(() => Array.from(new Set(cibles.map((c) => c.alim))).sort(), [cibles])

  const poolListe = useMemo(() => {
    const s = normaliser(poolSearch.trim())
    const termes = s.split(/[\s,;]+/).filter(Boolean)
    const list = Object.entries(donnees?.articles ?? {}).filter(([ref, a]) => {
      if (!a.pool || a.sommeil) return false
      if (poolAvecStock && n0(a.libre) <= 0 && n0(a.stock_disponible) <= 0) return false
      if (termes.length && !termes.every((t) => normaliser(`${ref} ${a.designation}`).includes(t))) return false
      return true
    })
    const m = new Map<string, [string, Article][]>()
    list.forEach(([ref, a]) => { const k = categorie(ref, a); const x = m.get(k) || []; x.push([ref, a]); m.set(k, x) })
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, rows]) => ({ k: k.replace(/^\d\.\s/, ''), rows: rows.sort((a, b) => a[0].localeCompare(b[0], 'fr', { numeric: true })) }))
  }, [donnees, poolSearch, poolAvecStock])

  // ── Écritures ──────────────────────────────────────────────────────────
  async function executer(fn: () => Promise<void>) {
    setEnCours(true); setErreur(null)
    try { await fn() } catch (e) { setErreur(messageErreur(e)) }
    await rechargerSolutions()
    setEnCours(false)
  }
  function verifier(error: unknown) { if (error) throw error }

  async function creerSolution(ref_cible: string, usage: Usage, role: Role, refs: { ref: string; quantite: number }[], libelle: string | null, commentaire: string | null = null) {
    const existantes = parUsage.get(`${ref_cible}|${usage}`)
    const rang = role === 'actuelle' ? 0 : (existantes?.backups.length ? Math.max(...existantes.backups.map((b) => b.rang)) + 1 : 1)
    const { data, error } = await supabase.from('stock_solutions')
      .insert({ groupe: 'RO_AIRH2O', ref_cible, usage, role, libelle, rang, origine: 'manuel', commentaire }).select('id').single()
    verifier(error)
    if (refs.length && data) {
      const { error: e2 } = await supabase.from('stock_solution_composants')
        .insert(refs.map((r, i) => ({ solution_id: data.id as string, ref_article: r.ref, quantite: r.quantite, rang: i + 1 })))
      verifier(e2)
    }
  }

  function memoriserArticle(ref: string) {
    if (articles[ref]) return
    const r = resultatsArt.find((x) => x.ref === ref)
    if (r) setArticlesExtra((p) => ({ ...p, [ref]: { designation: r.designation, famille: r.famille, prix: r.prix, stock_disponible: r.stock_disponible, libre: r.libre } }))
  }

  async function ajouterComposant(sol: Solution, ref: string) {
    if (sol.composants.some((c) => c.ref === ref)) { setInfo(`${ref} est déjà dans cette solution — modifier la quantité si besoin.`); return }
    memoriserArticle(ref)
    await executer(async () => {
      const rang = sol.composants.length ? Math.max(...sol.composants.map((c) => c.rang)) + 1 : 1
      const { error } = await supabase.from('stock_solution_composants').insert({ solution_id: sol.id, ref_article: ref, quantite: 1, rang })
      verifier(error)
      if (sol.origine === 'auto') await supabase.from('stock_solutions').update({ origine: 'manuel' }).eq('id', sol.id)
    })
  }

  async function deplacerComposant(compId: string, ref: string, depuis: string, vers: Solution, copier: boolean) {
    if (depuis === vers.id) return
    await executer(async () => {
      const deja = vers.composants.some((c) => c.ref === ref)
      const rang = vers.composants.length ? Math.max(...vers.composants.map((c) => c.rang)) + 1 : 1
      if (copier) {
        if (!deja) verifier((await supabase.from('stock_solution_composants').insert({ solution_id: vers.id, ref_article: ref, quantite: 1, rang })).error)
      } else if (deja) {
        verifier((await supabase.from('stock_solution_composants').delete().eq('id', compId)).error)
      } else {
        verifier((await supabase.from('stock_solution_composants').update({ solution_id: vers.id, rang }).eq('id', compId)).error)
      }
    })
  }

  async function deplacerSolution(solId: string, ref_cible: string, usage: Usage, copier: boolean, avantId?: string) {
    const sol = solutions.find((s) => s.id === solId)
    if (!sol) return
    const zone = parUsage.get(`${ref_cible}|${usage}`)
    const memeZone = sol.ref_cible === ref_cible && sol.usage === usage
    await executer(async () => {
      if (memeZone && sol.role === 'backup') {
        if (!avantId || avantId === solId) return
        const ordre = (zone?.backups || []).map((b) => b.id).filter((x) => x !== solId)
        const pos = ordre.indexOf(avantId)
        ordre.splice(pos >= 0 ? pos : ordre.length, 0, solId)
        for (let i = 0; i < ordre.length; i += 1) verifier((await supabase.from('stock_solutions').update({ rang: i + 1 }).eq('id', ordre[i])).error)
        return
      }
      if (copier || sol.role === 'actuelle') {
        await creerSolution(ref_cible, usage, 'backup', sol.composants.map((c) => ({ ref: c.ref, quantite: c.quantite })), sol.libelle, sol.commentaire)
        return
      }
      const rang = zone?.backups.length ? Math.max(...zone.backups.map((b) => b.rang)) + 1 : 1
      verifier((await supabase.from('stock_solutions').update({ ref_cible, usage, rang, origine: 'manuel' }).eq('id', solId)).error)
    })
  }

  async function supprimerSolution(sol: Solution) {
    if (sol.role === 'actuelle' && !window.confirm('Supprimer la solution AirH2O de cet usage ?')) return
    await executer(async () => { verifier((await supabase.from('stock_solutions').delete().eq('id', sol.id)).error) })
  }
  async function retirerComposant(compId: string) {
    await executer(async () => { verifier((await supabase.from('stock_solution_composants').delete().eq('id', compId)).error) })
  }
  async function changerQuantite(compId: string, q: number) {
    if (!Number.isFinite(q) || q <= 0) return
    await executer(async () => { verifier((await supabase.from('stock_solution_composants').update({ quantite: q }).eq('id', compId)).error) })
  }
  async function renommer(sol: Solution, libelle: string) {
    if ((sol.libelle || '') === libelle.trim()) return
    await executer(async () => { verifier((await supabase.from('stock_solutions').update({ libelle: libelle.trim() || null, origine: 'manuel' }).eq('id', sol.id)).error) })
  }

  // ── Glisser-déposer ────────────────────────────────────────────────────
  function debut(e: React.DragEvent, g: Glisse) {
    glisse.current = g
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('text/plain', g.type === 'solution' ? g.id : g.ref)
    e.stopPropagation()
  }
  function fin() { glisse.current = null; setSurvolZone(null) }
  function survol(e: React.DragEvent, zone: string) {
    if (!glisse.current) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = glisse.current.type === 'article' || e.ctrlKey || e.altKey ? 'copy' : 'move'
    if (survolZone !== zone) setSurvolZone(zone)
  }
  /** Dépôt sur une carte solution. */
  function deposerSurSolution(e: React.DragEvent, sol: Solution) {
    e.preventDefault(); e.stopPropagation()
    const g = glisse.current; fin()
    if (!g || enCours) return
    const copier = e.ctrlKey || e.altKey
    if (g.type === 'article') void ajouterComposant(sol, g.ref)
    else if (g.type === 'composant') void deplacerComposant(g.id, g.ref, g.solutionId, sol, copier)
    else if (sol.role === 'backup') void deplacerSolution(g.id, sol.ref_cible, sol.usage, copier, sol.id)
  }
  /** Dépôt sur la zone d'un usage (hors carte). */
  function deposerSurZone(e: React.DragEvent, ref_cible: string, usage: Usage, role: Role) {
    e.preventDefault(); e.stopPropagation()
    const g = glisse.current; fin()
    if (!g || enCours) return
    const copier = e.ctrlKey || e.altKey
    if (g.type === 'article') {
      memoriserArticle(g.ref)
      void executer(() => creerSolution(ref_cible, usage, role, [{ ref: g.ref, quantite: 1 }], role === 'actuelle' ? `AirH2O ${USAGES[usage].label}` : libelleDefaut(g.ref)))
    } else if (g.type === 'solution') void deplacerSolution(g.id, ref_cible, usage, copier)
    else setInfo('Déposer un composant sur une solution existante, ou un article du panneau sur la zone vide pour créer une solution.')
  }

  // ── Export Excel ───────────────────────────────────────────────────────
  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Solutions R-O')
      ws.addRow([`Équivalences R/O AirH2O 600 / 800 — solutions par usage — calculé le ${new Date().toLocaleString('fr-FR')} — libre = promettable aujourd’hui`]).font = { bold: true }
      ws.addRow(['Taille', 'Gamme', 'Alim.', 'Groupe AirH2O', 'Usage', 'Rôle', 'Solution', 'Composants (réf. × qté · prix · libre)', 'Prix public total', 'Réalisables', 'Composant(s) limitant(s)', 'Écart vs AirH2O (€)', 'Écart (%)', 'Commentaire']).font = { bold: true }
      tailles.forEach(({ taille, rows }) => rows.forEach((c) => {
        (c.gamme === '600' ? USAGES_600 : USAGES_800).forEach((u) => {
          const z = parUsage.get(`${c.ref}|${u}`)
          const ref = calculer(z?.actuelle, articles)
          const lignes = [...(z?.actuelle ? [z.actuelle] : []), ...(z?.backups || [])]
          lignes.forEach((s) => {
            const k = calculer(s, articles)
            const ecart = s.role === 'backup' && z?.actuelle ? k.total - ref.total : null
            ws.addRow([taille, c.gamme, c.alim, c.ref, USAGES[u].label, s.role === 'actuelle' ? 'AirH2O' : 'Backup', s.libelle || '',
              s.composants.map((x) => `${x.ref}${x.quantite !== 1 ? ` ×${x.quantite}` : ''} · ${fmtPrix(articles[x.ref]?.prix)} · libre ${fmtNum(articles[x.ref]?.libre)}`).join('\n'),
              Math.round(k.total), k.realisable, Array.from(k.limitants).join(', '),
              ecart === null ? '' : Math.round(ecart), ecart === null || !ref.total ? '' : Math.round((ecart / ref.total) * 100), s.commentaire || ''])
          })
        })
      }))
      ws.getColumn(4).width = 18; ws.getColumn(5).width = 20; ws.getColumn(7).width = 16; ws.getColumn(8).width = 60
      ws.getColumn(8).alignment = { wrapText: true, vertical: 'top' }
      ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 2 }]
      const buffer = await wb.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const a = document.createElement('a'); a.href = url
      a.download = `solutions_RO_airh2o_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click(); URL.revokeObjectURL(url)
    } catch (e) { setErreur('Export Excel : ' + messageErreur(e)) } finally { setExportEnCours(false) }
  }

  // ── Rendu d'une solution ───────────────────────────────────────────────
  function CarteSolution({ sol, refTotal }: { sol: Solution; refTotal: number | null }) {
    const k = calculer(sol, articles)
    const ecart = refTotal !== null && sol.role === 'backup' ? k.total - refTotal : null
    const zone = `sol:${sol.id}`
    const actif = survolZone === zone
    return (
      <div draggable onDragStart={(e) => debut(e, { type: 'solution', id: sol.id, ref_cible: sol.ref_cible, usage: sol.usage, role: sol.role })} onDragEnd={fin}
        onDragOver={(e) => survol(e, zone)} onDrop={(e) => deposerSurSolution(e, sol)}
        className={`w-[300px] shrink-0 cursor-grab rounded-lg border bg-white px-2 py-1.5 active:cursor-grabbing ${actif ? 'ring-2 ring-[#B4761A]' : ''} ${k.realisable > 0 ? 'border-[#CFE3C7]' : 'border-red-200 bg-red-50/40'}`}>
        <div className="flex items-center justify-between gap-1">
          <input defaultValue={sol.libelle || ''} key={`${sol.id}-${sol.libelle}`} placeholder="Nom de la solution"
            onBlur={(e) => void renommer(sol, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-0.5 text-[11.5px] font-bold text-[#5E5A50] hover:border-[#E5E1D8] focus:border-[#B4761A] focus:outline-none" />
          {sol.origine === 'auto' && <Badge cls="bg-[#EDEAE1] text-[#8A8474]" title="Pré-rempli automatiquement — à valider">auto</Badge>}
          <button type="button" onClick={() => void supprimerSolution(sol)} disabled={enCours} aria-label="Supprimer la solution"
            className="h-5 w-5 shrink-0 rounded text-[12px] font-bold text-[#8A8474] hover:bg-red-50 hover:text-red-700">×</button>
        </div>
        {sol.commentaire && <div className="text-[10.5px] font-semibold text-[#8A5A08]">{sol.commentaire}</div>}
        <div className="mt-0.5 space-y-0.5">
          {sol.composants.map((c) => {
            const a = articles[c.ref]
            const nb = partages.get(c.ref) || 0
            return (
              <div key={c.id} draggable onDragStart={(e) => debut(e, { type: 'composant', id: c.id, ref: c.ref, solutionId: sol.id })} onDragEnd={fin}
                className="group flex items-center justify-between gap-1 rounded px-0.5 hover:bg-[#FAF8F3]" title={a?.designation || ''}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[11.5px]">
                    <span className="truncate font-bold">{c.ref}</span>
                    {nb > 1 && <Badge cls="bg-violet-50 text-violet-800" title={`Référence utilisée dans ${nb} solutions : stock partagé`}>×{nb}</Badge>}
                  </div>
                  <div className="truncate text-[10px] text-[#8A8474]">{a?.designation || '—'}</div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold text-[#3A362E]">{fmtPrix(a?.prix)}</span>
                <input type="number" min={1} step={1} defaultValue={c.quantite} key={`${c.id}-${c.quantite}`} title="Quantité"
                  onMouseDown={(e) => e.stopPropagation()} onBlur={(e) => { const q = Number(e.target.value); if (q !== c.quantite) void changerQuantite(c.id, q) }}
                  className={`h-5 w-8 shrink-0 rounded border border-[#E5E1D8] px-0.5 text-right text-[10.5px] ${c.quantite === 1 ? 'text-[#C9C4B8]' : 'font-bold'}`} />
                <LibreTag a={a} limitant={k.limitants.has(c.ref)} />
                <button type="button" onClick={() => void retirerComposant(c.id)} disabled={enCours} aria-label={`Retirer ${c.ref}`}
                  className="h-5 w-4 shrink-0 text-[12px] font-bold text-[#C9C4B8] hover:text-red-700">×</button>
              </div>
            )
          })}
          {sol.composants.length === 0 && <div className="py-1 text-[11px] italic text-[#C9C4B8]">Déposer des articles ici</div>}
        </div>
        <div className="mt-1 flex items-center justify-between gap-1 border-t border-dashed border-[#E5E1D8] pt-1 text-[11.5px]">
          <span>
            <b>{fmtPrix(k.total)}</b>{k.manquePrix && <span className="text-[#8A5A08]" title="Un composant n’a pas de prix public dans SAGE"> *</span>}
            {ecart !== null && (
              <b className={`ml-1.5 ${ecart <= 0 ? 'text-[#3F9142]' : 'text-[#B4761A]'}`}>
                {ecart <= 0 ? '−' : '+'}{fmtPrix(Math.abs(ecart))}{refTotal ? ` (${ecart <= 0 ? '−' : '+'}${Math.round((Math.abs(ecart) / refTotal) * 100)} %)` : ''}
              </b>
            )}
          </span>
          <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${k.realisable > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {k.realisable > 0 ? `${fmtNum(k.realisable)} réalisable${k.realisable > 1 ? 's' : ''}` : 'non réalisable'}
          </span>
        </div>
      </div>
    )
  }

  const ctl = 'h-8 min-w-0 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const segBtn = (actif: boolean) => `rounded-md px-3 py-1.5 ${actif ? 'bg-white text-[#111820] shadow-sm' : 'text-[#8A8474] hover:text-[#3A362E]'}`

  return (
    <main className="min-h-screen bg-[#F4F3F0] px-4 py-3 text-[#111820]" style={{ fontFeatureSettings: '"tnum"' }}>
      <div className="mx-auto max-w-[1900px] space-y-2.5">
        {/* Bandeau */}
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#B4761A]">CEGECLIM — Stocks & logistique</p>
            <h1 className="text-[20px] font-bold leading-tight tracking-tight">Équivalences R/O — AirH2O 600 / 800</h1>
            <p className="text-[11.5px] text-[#8A8474]">
              Pour chaque groupe et chaque usage : la solution AirH2O et, en face, les solutions d’anciennes générations en stock · réalisable = tous les composants libres · écart de prix public
              {donnees?.calcule_le && <> · calculé à {new Date(donnees.calcule_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enCours && <span className="text-[12px] font-semibold text-[#8A8474]">Enregistrement…</span>}
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || loading || cibles.length === 0}
              className="h-10 rounded-lg bg-[#111820] px-3 text-[13px] font-bold text-white disabled:opacity-50">{exportEnCours ? 'Export…' : '⬇ Excel'}</button>
            <button type="button" onClick={() => void charger()} disabled={loading} title="Recalculer les stocks" className="h-10 rounded-lg border border-[#E5E1D8] bg-white px-3 text-[14px] font-bold disabled:opacity-50">{loading ? '…' : '↻'}</button>
          </div>
        </section>

        {erreur && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-800">
            <span>{erreur}{/get_solutions_ro|stock_solution/.test(erreur) ? ' — la migration 20261021c_solutions_ro.sql est-elle appliquée ?' : ''}</span>
            <button type="button" onClick={() => setErreur(null)} className="font-bold">✕</button>
          </div>
        )}
        {info && (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12.5px] text-[#3A362E]">
            <span>{info}</span><button type="button" onClick={() => setInfo(null)} className="font-bold text-[#8A8474]">✕</button>
          </div>
        )}

        {/* Filtres */}
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
          <div className="flex rounded-lg border border-[#E5E1D8] bg-[#F4F3F0] p-0.5 text-[12.5px] font-bold">
            <button type="button" onClick={() => setGammeF('')} className={segBtn(gammeF === '')}>600 + 800</button>
            <button type="button" onClick={() => setGammeF('600')} className={segBtn(gammeF === '600')}>AirH2O 600 (split)</button>
            <button type="button" onClick={() => setGammeF('800')} className={segBtn(gammeF === '800')}>AirH2O 800 (monobloc)</button>
          </div>
          <select value={tailleF} onChange={(e) => setTailleF(e.target.value)} className={`${ctl} ${tailleF ? 'border-[#B4761A] text-[#8A5A08]' : ''}`}>
            <option value="">Taille : toutes</option>
            {listeTailles.map((t) => <option key={t} value={t}>Taille {t.replace('.', ',')}</option>)}
          </select>
          <select value={alimF} onChange={(e) => setAlimF(e.target.value)} className={ctl}>
            <option value="">Alimentation : toutes</option>
            {alims.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Référence, composant, solution…" className={`${ctl} w-[260px] font-medium`} />
          <span className="ml-auto text-[11px] text-[#8A8474]">
            Encadré ocre = composant limitant · <b>Ctrl</b> / <b>Alt</b> en glissant = copier · arrivages janv.→mars non confirmés
          </span>
        </section>

        <div className="grid items-start gap-2.5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-2.5">
            {loading && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Calcul en cours…</div>}
            {!loading && tailles.length === 0 && <div className="rounded-xl border border-[#E5E1D8] bg-white px-4 py-10 text-center text-[12px] text-[#8A8474]">Aucun groupe avec ces filtres.</div>}
            {!loading && tailles.map(({ taille, rows }) => (
              <section key={taille} className="overflow-hidden rounded-xl border border-[#E5E1D8] bg-white">
                <div className="flex items-baseline gap-2 border-b border-[#E5E1D8] bg-[#FAF8F3] px-3 py-2">
                  <h2 className="text-[15px] font-bold">Taille {taille.replace('.', ',')}</h2>
                  <span className="text-[11.5px] text-[#8A8474]">
                    {[TAILLE_KW_600[taille] && `600 : ${TAILLE_KW_600[taille]}`, TAILLE_KW_800[taille] && `800 : ${TAILLE_KW_800[taille]}`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {rows.map((c) => {
                  const nt = c.mois.reduce((s, m) => s + n0(m.non_tenable), 0)
                  return (
                    <div key={c.ref} className="border-b border-[#E5E1D8] last:border-b-0">
                      {/* Groupe AirH2O */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[#FCFBF8] px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <a href={`/stock/penurie?ref=${encodeURIComponent(c.ref)}&mystock=tous`} className="text-[13.5px] font-bold hover:text-[#B4761A] hover:underline" title="Fiche pénurie">{c.ref}</a>
                          <Badge cls={c.gamme === '800' ? 'bg-sky-50 text-sky-800' : 'bg-[#EDEAE1] text-[#3A362E]'}>{c.gamme}</Badge>
                          <span className="text-[11px] text-[#8A8474]">{c.alim}</span>
                          <span className="text-[12px] font-bold text-[#3A362E]">{fmtPrix(c.prix)}</span>
                        </div>
                        <span className="text-[11.5px]">stock <b>{fmtNum(c.stock_disponible)}</b> · libre <b className={n0(c.qte_dispo_aujourdhui) <= 0 ? 'text-[#B42318]' : ''}>{fmtNum(c.qte_dispo_aujourdhui)}</b>
                          {n0(c.qte_dispo_aujourdhui) <= 0 && c.date_prochaine_dispo && <span className="text-[#8A5A08]"> · dispo {fmtDate(c.date_prochaine_dispo)}</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px]">
                          <span className="text-[#8A8474]">arrivages</span>
                          {c.mois.map((m, i) => (
                            <span key={m.mois} className={`rounded px-1 ${nonConfirme(m.mois) ? 'bg-[#FBF1E1] text-[#8A5A08]' : 'bg-[#F4F3F0]'}`} title={nonConfirme(m.mois) ? 'non confirmé' : i === 0 ? 'reste du mois, retards compris' : ''}>
                              {libMois(m.mois)} <b>{n0(m.arrivages) ? fmtNum(m.arrivages) : '·'}</b>
                            </span>
                          ))}
                        </span>
                        <span className="text-[11.5px]">CDC <b>{fmtNum(c.besoin_cdc_total)}</b> <span className="text-[#8A8474]">({fmtNum(c.nb_cdc)})</span>
                          {nt > 0 && <> <Badge cls="bg-red-50 text-red-700" title="Quantité en CDC non tenables">NT {fmtNum(nt)}</Badge></>}
                        </span>
                        <span className="truncate text-[11px] text-[#8A8474]">{c.designation}</span>
                      </div>
                      {/* Usages */}
                      {(c.gamme === '600' ? USAGES_600 : USAGES_800).map((u) => {
                        const z = parUsage.get(`${c.ref}|${u}`)
                        const refTotal = z?.actuelle ? calculer(z.actuelle, articles).total : null
                        const zA = `act:${c.ref}|${u}`
                        const zB = `bk:${c.ref}|${u}`
                        return (
                          <div key={u} className="grid grid-cols-[150px_310px_minmax(0,1fr)] gap-2 border-t border-[#F0EDE6] px-3 py-1.5">
                            <div className="pt-1">
                              <div className="text-[12.5px] font-bold">{USAGES[u].label}</div>
                              <div className="text-[10.5px] text-[#8A8474]">{USAGES[u].sub}</div>
                            </div>
                            <div onDragOver={(e) => survol(e, zA)} onDrop={(e) => deposerSurZone(e, c.ref, u, 'actuelle')}
                              className={`rounded-lg ${survolZone === zA ? 'bg-[#B4761A]/[0.08]' : ''}`}>
                              {z?.actuelle ? <CarteSolution sol={z.actuelle} refTotal={null} />
                                : <div className="flex h-full min-h-[48px] items-center justify-center rounded-lg border border-dashed border-[#E5E1D8] text-[11px] italic text-[#C9C4B8]">Solution AirH2O : déposer les articles</div>}
                            </div>
                            <div onDragOver={(e) => survol(e, zB)} onDrop={(e) => deposerSurZone(e, c.ref, u, 'backup')}
                              className={`flex min-h-[52px] flex-wrap items-start gap-1.5 rounded-lg p-0.5 ${survolZone === zB ? 'bg-[#B4761A]/[0.08] outline outline-2 -outline-offset-2 outline-[#B4761A]' : ''}`}>
                              {(z?.backups || []).map((s) => <CarteSolution key={s.id} sol={s} refTotal={refTotal} />)}
                              <div className="flex min-h-[48px] w-[150px] items-center justify-center rounded-lg border border-dashed border-[#D9D3C5] px-2 text-center text-[10.5px] italic text-[#B4AE9F]">
                                + glisser un groupe pour une nouvelle solution
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </section>
            ))}
            {!loading && (
              <p className="px-1 text-[10.5px] text-[#8A8474]">
                Libre = quantité promettable aujourd’hui pour une nouvelle commande (stock SAGE réel − préparé, après les CDC déjà prises). Réalisable = min(libre ÷ quantité) des composants.
                Un composant ×2, ×3… est utilisé dans plusieurs solutions : son stock est partagé. Prix = prix public SAGE. Arrivages = CDF SAGE en cours, à leur date de réception retenue.
              </p>
            )}
          </div>

          {/* Panneau des articles */}
          <aside className="space-y-2 xl:sticky xl:top-3">
            <section className="rounded-xl border border-[#E5E1D8] bg-white">
              <div className="border-b border-[#E5E1D8] px-3 py-2">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Articles R/O — à glisser</div>
                <div className="mt-1.5 flex gap-1.5">
                  <input value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} placeholder="Filtrer…" className={`${ctl} w-full font-medium`} />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#5E5A50]">
                    <input type="checkbox" checked={poolAvecStock} onChange={(e) => setPoolAvecStock(e.target.checked)} />en stock
                  </label>
                </div>
              </div>
              <div className="max-h-[calc(100vh-330px)] overflow-y-auto px-2 py-2">
                {poolListe.map(({ k, rows }) => (
                  <div key={k} className="mb-2">
                    <div className="px-1 pb-1 text-[10.5px] font-bold uppercase tracking-wide text-[#B4761A]">{k}</div>
                    <div className="space-y-1">
                      {rows.map(([ref, a]) => (
                        <div key={ref} draggable onDragStart={(e) => debut(e, { type: 'article', ref })} onDragEnd={fin} title={a.designation || ''}
                          className="cursor-grab rounded-lg border border-[#E5E1D8] bg-white px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[11.5px] font-bold">{ref}</span>
                            <span className="text-[11px] font-bold text-[#3A362E]">{fmtPrix(a.prix)}</span>
                          </div>
                          <div className="truncate text-[10.5px] text-[#5E5A50]">{a.designation || '—'}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <LibreTag a={a} />
                            {estNouvelleGen(ref) && <Badge cls="bg-sky-50 text-sky-800">AirH2O</Badge>}
                            {(partages.get(ref) || 0) > 0 && <Badge cls="bg-violet-50 text-violet-800" title="Nombre de solutions qui l’utilisent">dans {partages.get(ref)} sol.</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {!loading && poolListe.length === 0 && <div className="px-2 py-6 text-center text-[11.5px] text-[#8A8474]">Aucun article.</div>}
              </div>
            </section>
            <section className="rounded-xl border border-[#E5E1D8] bg-white px-3 py-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[#8A8474]">Autre article (toute la base SAGE)</div>
              <input value={rechercheArt} onChange={(e) => setRechercheArt(e.target.value)} placeholder="Réf. ou désignation (2 caractères min.)" className={`${ctl} mt-1.5 w-full font-medium`} />
              <div className="mt-1.5 max-h-[260px] space-y-1 overflow-y-auto">
                {resultatsArt.map((r) => (
                  <div key={r.ref} draggable onDragStart={(e) => debut(e, { type: 'article', ref: r.ref })} onDragEnd={fin}
                    className="cursor-grab rounded-lg border border-[#E5E1D8] px-2 py-1 hover:border-[#B4761A] active:cursor-grabbing">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-[11.5px] font-bold">{r.ref}</span>
                      <span className="text-[11px] font-bold">{fmtPrix(r.prix)}</span>
                    </div>
                    <div className="truncate text-[10.5px] text-[#5E5A50]">{r.designation}</div>
                    <span className="text-[10.5px] text-[#5E5A50]">stock {fmtNum(r.stock_disponible)}</span>
                  </div>
                ))}
                {rechercheArt.trim().length >= 2 && resultatsArt.length === 0 && <div className="py-2 text-center text-[11px] text-[#8A8474]">Aucun article.</div>}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default function EquivalencesROPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#F4F3F0] p-6 text-[13px] text-[#8A8474]">Chargement…</main>}>
      <EquivalencesRO />
    </Suspense>
  )
}
