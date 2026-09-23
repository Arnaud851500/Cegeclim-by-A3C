'use client'

// ============================================================================
// app/stock/page.tsx — Stock articles (desktop)
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-16) : version PC de l'écran mobile « Stock articles »
// (components/mobile/MobileStockArticles.tsx) : recherche libre ou liste de
// références collées + filtres (famille macro → famille, dépôt, dispo), RPC
// search_stock_articles_mobile (même source que le mobile), fiche article avec
// bandeau KPI, courbe de projection sur documents réels (stock dispo − CDC à
// leur date de livraison + CDF à leur date de réception ; CDF en retard ou sans
// date supposées reçues demain, comme v_portefeuille_couverture_stock),
// commandes non complètes à la date de livraison client, simulateur « nouvelle
// commande », stock par dépôt et réceptions fournisseurs.
// ÉVOLUTION (2026-09-20) : échelons de disponibilité (quantité promissible
// aujourd'hui puis paliers « Y dès telle date » apportés par les réceptions).
// ÉVOLUTION (2026-09-23) : nouvelle mise en page.
//   - Bandeau de recherche pleine largeur (zone de texte : bout de code,
//     désignation ou liste de références + filtres + « Qté à promettre »).
//   - Liste pleine largeur « du stock d'aujourd'hui aux échéances » : pour
//     chaque référence, stock Sage − PL, puis par période (aujourd'hui + CDC
//     en retard, fin du mois en cours, fins des 3 mois suivants, au-delà) :
//       • CDC à livrer, dont quantités livrables / en retard (part non servie
//         à la date de livraison demandée, en service FIFO par date) ;
//       • CDF à recevoir avec leurs dates et quantités ;
//       • stock projeté fin de période ;
//       • dispo pour nouvelles CDC livrées d'ici l'échéance (plus bas niveau du
//         stock projeté à partir de l'échéance).
//     Colonne finale : quantité promissible aujourd'hui puis paliers datés, et
//     première date pour la « Qté à promettre » saisie.
//   - Filtre rapide : toutes / avec CDC en retard / sans dispo immédiate.
//   - Clic sur une référence → fiche détaillée (courbe, tableaux) dans une
//     fenêtre flottante (Échap pour fermer, ← → pour naviguer).
//   - Chargement paginé (1000 lignes par page) pour les références à
//     nombreuses lignes CDC.
//   - ?ref=XXXX ouvre directement la fiche.
// Sur mobile (< 768 px) on rend MobileStockArticles tel quel.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useViewport } from '@/lib/useViewport'
import MobileStockArticles from '@/components/mobile/MobileStockArticles'

// ── Types ─────────────────────────────────────────────────────────────────
type StockRow = {
  reference_article: string
  designation: string | null
  famille: string | null
  famille_macro: string | null
  depot: string
  stock_reel: number
  stock_disponible: number
  stock_a_terme: number
}

type DepotStockRow = {
  depot: string
  stock_reel: number
  stock_reserve: number
  stock_commande_fournisseur: number
  stock_prepare: number
  stock_disponible: number
  stock_a_terme: number
}

type FamilleRow = { famille: string; famille_macro: string; libelle_famille: string | null }

type ReceptionRow = {
  ligne_cdf_id: string
  numero_cdf: string | null
  numero_fournisseur: string | null
  nom_fournisseur: string | null
  depot_reception: string | null
  date_commande: string | null
  date_livraison_sage: string | null
  quantite_attendue: number
  hypothese_reception: 'PREVUE' | 'RETARD' | 'SANS_DATE'
  date_reception_retenue: string
}

type CouvertureRow = {
  id: string
  numero_document: string | null
  numero_tiers: string | null
  nom_tiers: string | null
  representant: string | null
  agence: string | null
  date_creation_document: string | null
  date_livraison: string | null
  quantite: number
  montant_ht: number
  rang_service: number
  stock_disponible: number
  besoin_cumule: number
  receptions_avant_livraison: number
  stock_projete_a_date: number
  manque_a_date: number
  statut_couverture: 'COUVERT' | 'COUVERT_PAR_RECEPTION' | 'RECEPTION_TARDIVE' | 'RUPTURE'
  date_couverture_estimee: string | null
  retard_estime_jours: number | null
  prochaine_reception_date: string | null
  prochaine_reception_quantite: number | null
  prochaine_reception_cdf: string | null
  prochaine_reception_hypothese: boolean
}

type EvenementProjection = {
  date: string
  ordre: 0 | 1 // 0 = réception (avant), 1 = besoin
  type: 'RECEPTION' | 'CDC'
  quantite: number // signée
  label: string
  detail: string
  hypothese: boolean
  stockApres: number
}

/** Point minimal d'une projection (date + niveau après mouvement). */
type ProjPoint = { date: string; stockApres: number }

/** Palier de disponibilité : `quantite` pièces promissibles à partir de `date`. */
type Echelon = { date: string; quantite: number }

/** Mouvement de la projection allégée de la liste. */
type EvtLeger = {
  date: string
  ordre: 0 | 1
  q: number // signée
  rang: number
  hypothese: boolean
  cdf: string | null
  stockApres: number
  manque: number // part de la CDC non servie à sa date (0 pour une réception)
}

type ReceptionPeriode = { date: string; q: number; hypothese: boolean; cdf: string | null }

type PeriodeAgg = {
  cdc: number // quantité CDC à livrer dans la période
  retard: number // dont non servie à la date de livraison demandée
  cdf: number // réceptions attendues dans la période
  receptions: ReceptionPeriode[]
  stockFin: number // stock projeté à la fin de la période
  dispoNouvelles: number // promissible pour une nouvelle CDC livrée d'ici la fin de période
}

type RefProjection = {
  stock0: number
  stockReel: number | null
  stockATerme: number | null
  evts: EvtLeger[]
  periodes: PeriodeAgg[]
  echelons: Echelon[]
  stockFinal: number
  nbCdcRetard: number
  qteRetard: number
  receptionsAttendues: number
  besoins: number
}

type Vue = 'toutes' | 'retard' | 'sansDispo'

// ── Constantes ────────────────────────────────────────────────────────────
const DEPOTS_PROPOSES = [
  'ANGLET CEGECLIM', 'ANGOULEME CEGECLIM', 'ARCACHON CEGECLIM', 'ARTIGUES CEGECLIM',
  'BRIVE CEGECLIM', 'DAX CEGECLIM', 'FMS', 'LA ROCHELLE CEGECLIM',
  'MARMANDE CEGECLIM', 'MERIGNAC CEGECLIM', 'PAU CEGECLIM',
]
const HORIZONS: Array<[number, string]> = [[3, '3 mois'], [6, '6 mois'], [12, '12 mois']]
const NB_MOIS_LISTE = 4 // fin du mois en cours + 3 mois suivants
const STATUT_LABEL: Record<CouvertureRow['statut_couverture'], string> = {
  COUVERT: 'Couvert (stock)',
  COUVERT_PAR_RECEPTION: 'Couvert par réception',
  RECEPTION_TARDIVE: 'Réception tardive',
  RUPTURE: 'Rupture',
}
const STATUT_COLOR: Record<CouvertureRow['statut_couverture'], string> = {
  COUVERT: '#8fd4a8',
  COUVERT_PAR_RECEPTION: '#8FC7DA',
  RECEPTION_TARDIVE: '#E0A961',
  RUPTURE: '#e0a685',
}
const C_VERT = '#8fd4a8'
const C_BLEU = '#8FC7DA'
const C_ORANGE = '#E0A961'
const C_ROUGE = '#e0a685'

// ── Helpers ───────────────────────────────────────────────────────────────
function toNumber(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('fr-FR')
}
function formatMoney(n: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0)
}
function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function todayIso(): string {
  return toIsoDate(new Date())
}
function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return toIsoDate(d)
}
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000)
}
function formatDateFr(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
function formatDateCourte(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y.slice(2)}`
}
function formatJourMois(iso?: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}`
}
function depotCourt(depot: string): string {
  return String(depot || '').replace(/\s*CEGECLIM\s*$/i, '').trim() || depot
}
function couleurDispo(n: number): string {
  if (n > 0) return C_VERT
  if (n < 0) return C_ROUGE
  return 'rgba(255,255,255,0.35)'
}
function parseReferences(q: string): string[] {
  return Array.from(new Set(q.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase())))
}

/** Bornes des périodes de la liste : aujourd'hui, puis fin du mois en cours et
 * fins des mois suivants. */
function bornesPeriodes(auj: string, nbMois = NB_MOIS_LISTE): string[] {
  const d = new Date(`${auj}T00:00:00`)
  const out = [auj]
  for (let k = 0; k < nbMois; k += 1) out.push(toIsoDate(new Date(d.getFullYear(), d.getMonth() + k + 1, 0)))
  return out
}
function libellePeriode(bornes: string[], k: number): string {
  if (k === 0) return 'Auj. (+ retard)'
  if (k >= bornes.length) return 'Au-delà'
  const d = new Date(`${bornes[k]}T00:00:00`)
  const mois = d.toLocaleDateString('fr-FR', { month: 'long' })
  const memeAnnee = bornes[k].slice(0, 4) === bornes[0].slice(0, 4)
  return `Fin ${mois}${memeAnnee ? '' : ` ${bornes[k].slice(2, 4)}`}`
}
function indexPeriode(bornes: string[], date: string): number {
  if (date <= bornes[0]) return 0
  for (let k = 1; k < bornes.length; k += 1) if (date <= bornes[k]) return k
  return bornes.length
}

/** Lecture paginée (PostgREST limite à 1000 lignes par requête). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<any>): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message || String(error))
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** Projection sur documents réels : stock dispo d'aujourd'hui, réceptions
 * fournisseurs (+) et besoins CDC (−) dans l'ordre chronologique, réception
 * avant besoin à date égale. Les besoins dont la livraison est passée sont
 * ramenés à aujourd'hui (besoin immédiat). */
function construireProjection(stock0: number, receptions: ReceptionRow[], besoins: CouvertureRow[]): EvenementProjection[] {
  const auj = todayIso()
  const events: Omit<EvenementProjection, 'stockApres'>[] = []
  for (const r of receptions) {
    events.push({
      date: r.date_reception_retenue,
      ordre: 0,
      type: 'RECEPTION',
      quantite: toNumber(r.quantite_attendue),
      label: r.numero_cdf || 'CDF',
      detail: [r.nom_fournisseur || r.numero_fournisseur, r.depot_reception ? depotCourt(r.depot_reception) : null].filter(Boolean).join(' · '),
      hypothese: r.hypothese_reception !== 'PREVUE',
    })
  }
  for (const b of besoins) {
    const date = b.date_livraison && b.date_livraison >= auj ? b.date_livraison : auj
    events.push({
      date,
      ordre: 1,
      type: 'CDC',
      quantite: -toNumber(b.quantite),
      label: b.numero_document || 'CDC',
      detail: [b.nom_tiers || b.numero_tiers, b.date_livraison && b.date_livraison < auj ? `livraison prévue le ${formatDateCourte(b.date_livraison)} (dépassée)` : null].filter(Boolean).join(' · '),
      hypothese: false,
    })
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.ordre - b.ordre || a.label.localeCompare(b.label))
  let courant = stock0
  return events.map((e) => {
    courant += e.quantite
    return { ...e, stockApres: courant }
  })
}

/** Première date à laquelle `quantite` pièces peuvent être promises sans
 * mettre en rupture les commandes déjà prises : le stock projeté doit rester
 * ≥ quantite à cette date et pour tous les événements suivants. On raisonne
 * en fin de journée (après le dernier mouvement du jour). */
function premiereDateDisponible(stock0: number, events: ProjPoint[], quantite: number): { date: string | null; niveau: number } {
  if (quantite <= 0) return { date: todayIso(), niveau: stock0 }
  const n = events.length
  const suffixMin = new Array<number>(n + 1)
  suffixMin[n] = n > 0 ? events[n - 1].stockApres : stock0
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(events[i].stockApres, suffixMin[i + 1])
  const minGlobal = Math.min(stock0, n > 0 ? suffixMin[0] : stock0)
  if (minGlobal >= quantite) return { date: todayIso(), niveau: minGlobal }
  for (let i = 0; i < n; i += 1) {
    if (i + 1 < n && events[i + 1].date === events[i].date) continue // fin de journée seulement
    if (suffixMin[i] >= quantite) return { date: events[i].date, niveau: suffixMin[i] }
  }
  return { date: null, niveau: n > 0 ? events[n - 1].stockApres : stock0 }
}

/** Échelons de disponibilité : quantité promissible aujourd'hui (plus bas
 * niveau du stock projeté sur tout l'horizon, borné à 0), puis chaque date à
 * laquelle ce plancher remonte grâce aux réceptions — au plus `maxPaliers`
 * paliers après aujourd'hui. */
function calculerEchelons(stock0: number, events: ProjPoint[], maxPaliers = 3): Echelon[] {
  const auj = todayIso()
  const n = events.length
  const suffixMin = new Array<number>(n + 1)
  suffixMin[n] = Number.POSITIVE_INFINITY
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(events[i].stockApres, suffixMin[i + 1])
  let niveau = Math.max(0, Math.min(stock0, n > 0 ? suffixMin[0] : stock0))
  const out: Echelon[] = [{ date: auj, quantite: niveau }]
  for (let i = 0; i < n && out.length <= maxPaliers; i += 1) {
    if (i + 1 < n && events[i + 1].date === events[i].date) continue
    if (events[i].date <= auj) continue
    const v = suffixMin[i]
    if (v > niveau) { niveau = v; out.push({ date: events[i].date, quantite: v }) }
  }
  return out
}

/** Projection allégée d'une référence pour la liste, agrégée par période.
 * Mêmes règles que la fiche : réception avant besoin à date égale, besoins
 * échus ramenés à aujourd'hui, CDC servies dans l'ordre (date puis rang). */
function projeterReference(
  stock0: number,
  recs: ReceptionPeriode[],
  cdcs: Array<{ date: string | null; q: number; rang: number }>,
  bornes: string[],
  meta: { stockReel: number | null; stockATerme: number | null },
): RefProjection {
  const auj = bornes[0]
  const bruts: Array<Omit<EvtLeger, 'stockApres' | 'manque'>> = []
  for (const r of recs) bruts.push({ date: r.date, ordre: 0, q: r.q, rang: 0, hypothese: r.hypothese, cdf: r.cdf })
  for (const c of cdcs) bruts.push({ date: c.date && c.date >= auj ? c.date : auj, ordre: 1, q: -c.q, rang: c.rang, hypothese: false, cdf: null })
  bruts.sort((a, b) => a.date.localeCompare(b.date) || a.ordre - b.ordre || a.rang - b.rang)
  let courant = stock0
  const evts: EvtLeger[] = bruts.map((e) => {
    courant += e.q
    const manque = e.q < 0 ? Math.min(-e.q, Math.max(0, -courant)) : 0
    return { ...e, stockApres: courant, manque }
  })

  const nbPeriodes = bornes.length + 1
  const periodes: PeriodeAgg[] = Array.from({ length: nbPeriodes }, () => ({ cdc: 0, retard: 0, cdf: 0, receptions: [], stockFin: stock0, dispoNouvelles: 0 }))
  let nbCdcRetard = 0
  let qteRetard = 0
  for (const e of evts) {
    const p = periodes[indexPeriode(bornes, e.date)]
    if (e.q < 0) {
      p.cdc += -e.q
      p.retard += e.manque
      if (e.manque > 0) { nbCdcRetard += 1; qteRetard += e.manque }
    } else {
      p.cdf += e.q
      p.receptions.push({ date: e.date, q: e.q, hypothese: e.hypothese, cdf: e.cdf })
    }
  }
  const n = evts.length
  const suffixMin = new Array<number>(n + 1)
  suffixMin[n] = Number.POSITIVE_INFINITY
  for (let i = n - 1; i >= 0; i -= 1) suffixMin[i] = Math.min(evts[i].stockApres, suffixMin[i + 1])
  let idx = -1
  for (let k = 0; k < nbPeriodes; k += 1) {
    while (idx + 1 < n && indexPeriode(bornes, evts[idx + 1].date) <= k) idx += 1
    const fin = idx >= 0 ? evts[idx].stockApres : stock0
    periodes[k].stockFin = fin
    periodes[k].dispoNouvelles = Math.max(0, Math.min(fin, suffixMin[idx + 1]))
  }

  return {
    stock0,
    stockReel: meta.stockReel,
    stockATerme: meta.stockATerme,
    evts,
    periodes,
    echelons: calculerEchelons(stock0, evts, 4),
    stockFinal: n > 0 ? evts[n - 1].stockApres : stock0,
    nbCdcRetard,
    qteRetard,
    receptionsAttendues: recs.reduce((s, r) => s + r.q, 0),
    besoins: cdcs.reduce((s, c) => s + c.q, 0),
  }
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function StockPage() {
  const { isMobile } = useViewport()
  if (isMobile) return <MobileStockArticles />
  return <StockDesktop />
}

function StockDesktop() {
  // ── Recherche & filtres ────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [famillesRef, setFamillesRef] = useState<FamilleRow[] | null>(null)
  const [familleMacro, setFamilleMacro] = useState('')
  const [famille, setFamille] = useState('')
  const [depot, setDepot] = useState('')
  const [dispoFiltre, setDispoFiltre] = useState<'tous' | 'oui' | 'non'>('tous')
  const [quantiteCible, setQuantiteCible] = useState('')
  const [vue, setVue] = useState<Vue>('toutes')
  const filtresActifs = Boolean(familleMacro || famille || depot || dispoFiltre !== 'tous')

  // ── Référence ouverte en fenêtre flottante ─────────────────────────────
  const [selected, setSelected] = useState<{ reference: string; designation: string } | null>(null)
  const [horizonMois, setHorizonMois] = useState(6)
  const [quantiteSimulee, setQuantiteSimulee] = useState('1')

  const bornes = useMemo(() => bornesPeriodes(todayIso()), [])
  const nbPeriodes = bornes.length + 1

  useEffect(() => {
    let cancelled = false
    async function chargerFamilles() {
      const { data } = await supabase.from('ref_familles').select('famille, famille_macro, libelle_famille').order('famille_macro')
      if (!cancelled) setFamillesRef((data || []) as FamilleRow[])
    }
    void chargerFamilles()
    return () => { cancelled = true }
  }, [])

  // Ouverture directe ?ref=XXXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = String(params.get('ref') || '').trim().toUpperCase()
    if (ref) { setSelected({ reference: ref, designation: '' }); setQuery(ref) }
  }, [])

  const famillesMacroDisponibles = useMemo(
    () => (famillesRef ? Array.from(new Set(famillesRef.map((f) => f.famille_macro).filter(Boolean))).sort() : []),
    [famillesRef],
  )
  const famillesDuMacro = useMemo(
    () => (famillesRef && familleMacro ? famillesRef.filter((f) => f.famille_macro === familleMacro).sort((a, b) => a.famille.localeCompare(b.famille)) : []),
    [famillesRef, familleMacro],
  )

  useEffect(() => {
    const q = query.trim()
    if (!q && !filtresActifs) { setResults(null); setError(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const t = window.setTimeout(async () => {
      const refs = parseReferences(q)
      const isListe = refs.length > 1
      const { data, error: err } = await supabase.rpc('search_stock_articles_mobile', {
        p_query: isListe || !q ? null : q,
        p_references: isListe ? refs : null,
        p_famille_macro: familleMacro || null,
        p_famille: famille || null,
        p_depot: depot || null,
        p_disponible_only: dispoFiltre === 'tous' ? null : dispoFiltre === 'oui',
        p_limit: isListe ? 300 : 120,
      })
      if (cancelled) return
      if (err) { setError(err.message); setResults([]) } else {
        setError(null)
        setResults(((data || []) as any[]).map((r) => ({
          reference_article: r.reference_article,
          designation: r.designation,
          famille: r.famille,
          famille_macro: r.famille_macro,
          depot: r.depot,
          stock_reel: toNumber(r.stock_reel),
          stock_disponible: toNumber(r.stock_disponible),
          stock_a_terme: toNumber(r.stock_a_terme),
        })))
      }
      setLoading(false)
    }, 300)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query, familleMacro, famille, depot, dispoFiltre, filtresActifs])

  // Une ligne par référence (le RPC peut renvoyer une ligne par dépôt).
  const lignes = useMemo(() => {
    const m = new Map<string, StockRow>()
    for (const r of results || []) if (!m.has(r.reference_article)) m.set(r.reference_article, r)
    return Array.from(m.values())
  }, [results])
  const refsResultats = useMemo(() => lignes.map((r) => r.reference_article), [lignes])
  const refsResultatsKey = refsResultats.join('|')

  // ── Projections par référence (une requête paginée par source et par lot) ──
  const [projParRef, setProjParRef] = useState<Record<string, RefProjection>>({})
  const [projLoading, setProjLoading] = useState(false)
  const [projErreur, setProjErreur] = useState<string | null>(null)

  useEffect(() => {
    if (refsResultats.length === 0) { setProjLoading(false); return }
    let cancelled = false
    setProjLoading(true)
    setProjErreur(null)
    async function charger() {
      const TAILLE = 50
      for (let i = 0; i < refsResultats.length; i += TAILLE) {
        const lot = refsResultats.slice(i, i + TAILLE)
        try {
          const [stockRows, recRows, couvRows] = await Promise.all([
            fetchAll<any>((from, to) => supabase.from('v_stock_articles_latest')
              .select('reference_article,stock_disponible,stock_reel,stock_a_terme')
              .in('reference_article', lot).order('reference_article').range(from, to)),
            fetchAll<any>((from, to) => supabase.from('v_couverture_stock_receptions')
              .select('reference_article,ligne_cdf_id,numero_cdf,date_reception_retenue,quantite_attendue,hypothese_reception')
              .in('reference_article', lot).order('reference_article').order('date_reception_retenue').order('ligne_cdf_id').range(from, to)),
            fetchAll<any>((from, to) => supabase.from('v_portefeuille_couverture_stock')
              .select('id,reference_article,date_livraison,quantite,stock_disponible,rang_service')
              .in('reference_article', lot).order('reference_article').order('rang_service').order('id').range(from, to)),
          ])
          if (cancelled) return
          const stockParRef = new Map<string, { dispo: number; reel: number; aTerme: number }>()
          for (const s of stockRows) stockParRef.set(s.reference_article, { dispo: toNumber(s.stock_disponible), reel: toNumber(s.stock_reel), aTerme: toNumber(s.stock_a_terme) })
          const recParRef = new Map<string, ReceptionPeriode[]>()
          for (const r of recRows) {
            const q = toNumber(r.quantite_attendue)
            if (q <= 0) continue
            const l = recParRef.get(r.reference_article) || []
            l.push({ date: String(r.date_reception_retenue).slice(0, 10), q, hypothese: r.hypothese_reception !== 'PREVUE', cdf: r.numero_cdf || null })
            recParRef.set(r.reference_article, l)
          }
          const cdcParRef = new Map<string, Array<{ date: string | null; q: number; rang: number }>>()
          const stockCouvParRef = new Map<string, number>()
          for (const c of couvRows) {
            const l = cdcParRef.get(c.reference_article) || []
            l.push({ date: c.date_livraison ? String(c.date_livraison).slice(0, 10) : null, q: toNumber(c.quantite), rang: toNumber(c.rang_service) })
            cdcParRef.set(c.reference_article, l)
            if (!stockCouvParRef.has(c.reference_article)) stockCouvParRef.set(c.reference_article, toNumber(c.stock_disponible))
          }
          const out: Record<string, RefProjection> = {}
          for (const ref of lot) {
            const s = stockParRef.get(ref)
            const stock0 = stockCouvParRef.get(ref) ?? s?.dispo ?? 0
            out[ref] = projeterReference(stock0, recParRef.get(ref) || [], cdcParRef.get(ref) || [], bornes, {
              stockReel: s ? s.reel : null,
              stockATerme: s ? s.aTerme : null,
            })
          }
          if (!cancelled) setProjParRef((prev) => ({ ...prev, ...out }))
        } catch (e) {
          if (!cancelled) setProjErreur(e instanceof Error ? e.message : String(e))
        }
      }
      if (!cancelled) setProjLoading(false)
    }
    void charger()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsResultatsKey])

  const refsSaisies = useMemo(() => parseReferences(query), [query])
  const isListe = refsSaisies.length > 1
  const quantitePromise = Math.max(0, Math.floor(toNumber(quantiteCible)))

  const compteurs = useMemo(() => {
    let retard = 0
    let sansDispo = 0
    let qteRetard = 0
    for (const r of lignes) {
      const p = projParRef[r.reference_article]
      if (!p) continue
      if (p.nbCdcRetard > 0) { retard += 1; qteRetard += p.qteRetard }
      if (p.echelons[0].quantite <= 0) sansDispo += 1
    }
    return { retard, sansDispo, qteRetard }
  }, [lignes, projParRef])

  const lignesAffichees = useMemo(() => lignes.filter((r) => {
    if (vue === 'toutes') return true
    const p = projParRef[r.reference_article]
    if (!p) return true
    return vue === 'retard' ? p.nbCdcRetard > 0 : p.echelons[0].quantite <= 0
  }), [lignes, projParRef, vue])

  function reinitialiserFiltres() {
    setFamilleMacro(''); setFamille(''); setDepot(''); setDispoFiltre('tous')
  }

  const selectionner = useCallback((reference: string, designation: string) => {
    setSelected({ reference, designation })
    const url = new URL(window.location.href)
    url.searchParams.set('ref', reference)
    window.history.replaceState(null, '', url.toString())
  }, [])

  const fermer = useCallback(() => {
    setSelected(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('ref')
    window.history.replaceState(null, '', url.toString())
  }, [])

  const positionSelection = selected ? lignesAffichees.findIndex((r) => r.reference_article === selected.reference) : -1
  const precedente = positionSelection > 0 ? lignesAffichees[positionSelection - 1] : null
  const suivante = positionSelection >= 0 && positionSelection < lignesAffichees.length - 1 ? lignesAffichees[positionSelection + 1] : null

  return (
    <div style={styles.page}>
      <style>{`
        .stkBtn:hover { background: rgba(255,255,255,0.10); color: #fff; border-color: rgba(255,255,255,0.3); }
        .stkBtn:focus-visible, .stkRefBtn:focus-visible { outline: 2px solid #F5F3EC; outline-offset: 2px; }
        .stkTable th { position: sticky; top: 0; background: #101A2E; z-index: 1; }
        .stkGroup { cursor: pointer; }
        .stkGroup tr:first-child td { border-top: 2px solid rgba(255,255,255,0.12); }
        .stkGroup:hover td { background: rgba(255,255,255,0.035); }
        .stkGroup.stkActive td { background: rgba(166,161,129,0.10); }
        .stkRefBtn:hover .stkRefCode { text-decoration: underline; text-underline-offset: 3px; }
      `}</style>

      <div style={styles.header}>
        <div>
          <div style={styles.kicker}>Stocks &amp; logistique</div>
          <h1 style={styles.title}>Stock articles</h1>
          <div style={styles.lead}>Du stock Sage d'aujourd'hui aux échéances : commandes clients à livrer (livrables / en retard), commandes fournisseurs à recevoir, stock projeté et quantités disponibles pour de nouvelles commandes. Clique sur une référence pour ouvrir sa fiche détaillée.</div>
        </div>
      </div>

      {/* ── Recherche & filtres ── */}
      <div style={styles.card}>
        <div style={styles.searchGrid}>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Rechercher</span>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Bout de référence, désignation — ou une liste de références (une par ligne)"
              rows={isListe ? 4 : 2}
              style={styles.searchArea}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Famille macro</span>
            <select value={familleMacro} onChange={(e) => { setFamilleMacro(e.target.value); setFamille('') }} style={styles.select}>
              <option value="">Toutes</option>
              {famillesMacroDisponibles.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Famille</span>
            <select value={famille} onChange={(e) => setFamille(e.target.value)} disabled={!familleMacro} style={{ ...styles.select, opacity: familleMacro ? 1 : 0.5 }}>
              <option value="">Toutes</option>
              {famillesDuMacro.map((f) => <option key={f.famille} value={f.famille}>{f.famille}{f.libelle_famille ? ` — ${f.libelle_famille}` : ''}</option>)}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Dépôt</span>
            <select value={depot} onChange={(e) => setDepot(e.target.value)} style={styles.select}>
              <option value="">Tous (global)</option>
              {DEPOTS_PROPOSES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Stock dispo</span>
            <select value={dispoFiltre} onChange={(e) => setDispoFiltre(e.target.value as 'tous' | 'oui' | 'non')} style={styles.select}>
              <option value="tous">Tous</option>
              <option value="oui">Avec stock disponible</option>
              <option value="non">Sans stock disponible</option>
            </select>
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Qté à promettre</span>
            <input
              type="number" min={0} step={1} value={quantiteCible}
              onChange={(e) => setQuantiteCible(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="ex. 10"
              style={{ ...styles.select, fontFamily: 'var(--font-mono)', fontWeight: 700 }}
            />
          </label>
        </div>
        <div style={styles.searchFooter}>
          {isListe && <span style={styles.hint}>{refsSaisies.length} référence(s) détectée(s)</span>}
          {quantitePromise > 0 && <span style={styles.hint}>1ʳᵉ date à laquelle {formatNumber(quantitePromise)} pièce(s) peuvent être promises affichée pour chaque référence.</span>}
          {filtresActifs && (
            <button type="button" className="stkBtn" onClick={reinitialiserFiltres} style={{ ...styles.ghostBtn, borderColor: 'rgba(193,104,60,0.5)', color: C_ROUGE, marginLeft: 'auto' }}>✕ Réinitialiser les filtres</button>
          )}
        </div>
      </div>

      {/* ── Liste pleine largeur ── */}
      <div style={{ ...styles.card, marginTop: 14 }}>
        <div style={styles.cardHeaderRow}>
          <div>
            <div style={{ ...styles.cardTitle, marginBottom: 4 }}>
              Par référence — du stock d'aujourd'hui aux échéances
              {results ? <span style={styles.countTag}>{lignes.length}</span> : null}
              {loading || projLoading ? <span style={{ ...styles.muted, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· chargement…</span> : null}
            </div>
            <div style={styles.muted}>Les colonnes « Fin … » sont des flux de la période, sauf « Stock projeté » et « Dispo nouvelles CDC » qui sont des positions à l'échéance.</div>
          </div>
          {lignes.length > 0 && (
            <div style={styles.segment}>
              {([
                ['toutes', `Toutes · ${lignes.length}`],
                ['retard', `CDC en retard · ${compteurs.retard}`],
                ['sansDispo', `Sans dispo immédiate · ${compteurs.sansDispo}`],
              ] as Array<[Vue, string]>).map(([v, label]) => (
                <button key={v} type="button" className="stkBtn" onClick={() => setVue(v)} style={{ ...styles.segmentBtn, ...(vue === v ? styles.segmentBtnActive : {}) }}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}
        {projErreur && <div style={styles.errorBox}>Projection : {projErreur}</div>}
        {results === null && !loading && (
          <div style={styles.emptyList}>
            <div style={{ fontSize: 30 }}>📦</div>
            <div style={{ fontWeight: 700, color: '#fff', marginTop: 6 }}>Tape une référence, une désignation ou colle une liste</div>
            <div style={{ ...styles.muted, marginTop: 4 }}>ou choisis un filtre pour parcourir le stock.</div>
          </div>
        )}
        {results && lignes.length === 0 && !loading && <div style={styles.muted}>Aucune référence trouvée.</div>}

        {lignesAffichees.length > 0 && (
          <div style={styles.listWrap}>
            <table className="stkTable" style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, minWidth: 230 }}>Référence</th>
                  <th style={{ ...styles.th, minWidth: 150 }}>Ligne</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Stock Sage − PL</th>
                  {Array.from({ length: nbPeriodes }, (_, k) => (
                    <th key={k} style={{ ...styles.th, textAlign: 'right', minWidth: 104 }}>{libellePeriode(bornes, k)}</th>
                  ))}
                  <th style={{ ...styles.th, minWidth: 200 }}>Dispo nouvelle CDC</th>
                </tr>
              </thead>
              {lignesAffichees.map((r) => {
                const p = projParRef[r.reference_article]
                const actif = selected?.reference === r.reference_article
                return (
                  <tbody
                    key={r.reference_article}
                    className={`stkGroup${actif ? ' stkActive' : ''}`}
                    onClick={() => selectionner(r.reference_article, r.designation || '')}
                  >
                    <tr>
                      <td rowSpan={4} style={{ ...styles.td, ...styles.refCell }}>
                        <button type="button" className="stkRefBtn" style={styles.refBtn}>
                          <span className="stkRefCode" style={styles.resultRef}>{r.reference_article} <span style={{ color: 'rgba(255,255,255,0.45)' }}>↗</span></span>
                          <span style={styles.refDesignation}>{r.designation || '—'}</span>
                        </button>
                        <div style={styles.flags}>
                          {p && p.nbCdcRetard > 0 && (
                            <span style={{ ...styles.flag, borderColor: 'rgba(224,169,97,0.55)', color: C_ORANGE }}>{p.nbCdcRetard} CDC en retard · {formatNumber(p.qteRetard)} p.</span>
                          )}
                          {p && p.echelons[0].quantite <= 0 && (
                            <span style={{ ...styles.flag, borderColor: 'rgba(193,104,60,0.55)', color: C_ROUGE }}>Pas de dispo immédiate</span>
                          )}
                          {p && p.nbCdcRetard === 0 && p.echelons[0].quantite > 0 && p.besoins > 0 && (
                            <span style={{ ...styles.flag, borderColor: 'rgba(143,212,168,0.45)', color: C_VERT }}>CDC toutes servables</span>
                          )}
                        </div>
                      </td>
                      <td style={{ ...styles.td, ...styles.lineLabel, color: C_ORANGE }}>CDC à livrer</td>
                      <td rowSpan={4} style={{ ...styles.td, textAlign: 'right', verticalAlign: 'top' }}>
                        <div style={{ ...styles.bigNum, color: couleurDispo(p ? p.stock0 : r.stock_disponible) }}>{formatNumber(p ? p.stock0 : r.stock_disponible)}</div>
                        {p && p.stockReel !== null && (
                          <div style={styles.cellSub}>réel {formatNumber(p.stockReel)}{p.stockATerme !== null ? ` · à terme ${formatNumber(p.stockATerme)}` : ''}</div>
                        )}
                        {depot && <div style={{ ...styles.cellSub, color: 'rgba(166,161,129,0.95)' }}>{depotCourt(r.depot)} : {formatNumber(r.stock_disponible)}</div>}
                      </td>
                      {Array.from({ length: nbPeriodes }, (_, k) => (
                        <td key={k} style={styles.tdNum}>{p ? <CelluleCdc per={p.periodes[k]} /> : <Attente />}</td>
                      ))}
                      <td rowSpan={4} style={{ ...styles.td, verticalAlign: 'top' }}>
                        <DispoNouvelleCdc proj={p} quantite={quantitePromise} />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ ...styles.td, ...styles.lineLabel, color: C_BLEU }}>CDF à recevoir</td>
                      {Array.from({ length: nbPeriodes }, (_, k) => (
                        <td key={k} style={styles.tdNum}>{p ? <CelluleCdf per={p.periodes[k]} /> : <Attente />}</td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ ...styles.td, ...styles.lineLabel }}>Stock projeté fin de période</td>
                      {Array.from({ length: nbPeriodes }, (_, k) => (
                        <td key={k} style={{ ...styles.tdNum, color: p && p.periodes[k].stockFin < 0 ? C_ROUGE : 'rgba(255,255,255,0.85)' }}>
                          {p ? formatNumber(p.periodes[k].stockFin) : <Attente />}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ ...styles.td, ...styles.lineLabel, color: C_VERT }}>Dispo nouvelles CDC livrées d'ici à</td>
                      {Array.from({ length: nbPeriodes }, (_, k) => (
                        <td key={k} style={{ ...styles.tdNum, fontSize: 15, fontWeight: 800, color: p && p.periodes[k].dispoNouvelles > 0 ? C_VERT : C_ROUGE }}>
                          {p ? formatNumber(p.periodes[k].dispoNouvelles) : <Attente />}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
        {lignes.length > 0 && lignesAffichees.length === 0 && <div style={styles.muted}>Aucune référence ne correspond à cette vue.</div>}

        {lignes.length > 0 && (
          <div style={styles.footnote}>
            « Stock Sage − PL » = stock tous dépôts moins les préparations de livraison, avant les CDC en retard (comptées dans la colonne « Auj. »).
            « CDC à livrer » à la date de livraison demandée ; « en retard » = part non servie à cette date avec le stock et les réceptions connus (service dans l'ordre des dates de livraison).
            « CDF à recevoir » à la date de réception retenue (* = CDF en retard ou sans date, supposée reçue demain).
            « Stock projeté » = Stock Sage − PL + reçu − livré en cumul. « Dispo nouvelles CDC » = plus bas niveau du stock projeté à partir de l'échéance : ce qu'on peut promettre sans repousser une CDC déjà prise.
          </div>
        )}
      </div>

      {/* ── Fenêtre flottante : fiche article ── */}
      {selected && (
        <FenetreArticle
          onClose={fermer}
          onPrev={precedente ? () => selectionner(precedente.reference_article, precedente.designation || '') : null}
          onNext={suivante ? () => selectionner(suivante.reference_article, suivante.designation || '') : null}
          position={positionSelection >= 0 ? `${positionSelection + 1} / ${lignesAffichees.length}` : null}
        >
          <ArticleDetail
            key={selected.reference}
            reference={selected.reference}
            designation={selected.designation}
            horizonMois={horizonMois}
            onHorizonChange={setHorizonMois}
            quantiteSimulee={quantiteSimulee}
            onQuantiteSimuleeChange={setQuantiteSimulee}
          />
        </FenetreArticle>
      )}
    </div>
  )
}

// ── Cellules de la liste ──────────────────────────────────────────────────
function Attente() {
  return <span style={{ color: 'rgba(255,255,255,0.3)' }}>…</span>
}

function Point() {
  return <span style={{ color: 'rgba(255,255,255,0.25)' }}>·</span>
}

function CelluleCdc({ per }: { per: PeriodeAgg }) {
  if (per.cdc <= 0) return <Point />
  const livrables = per.cdc - per.retard
  return (
    <>
      <div style={{ color: C_ORANGE, fontWeight: 700 }}>− {formatNumber(per.cdc)}</div>
      {per.retard > 0 && (
        <>
          <div style={{ ...styles.cellSub, color: C_ROUGE }}>dont {formatNumber(per.retard)} en retard</div>
          {livrables > 0 && <div style={{ ...styles.cellSub, color: C_VERT }}>{formatNumber(livrables)} livrables</div>}
        </>
      )}
    </>
  )
}

function CelluleCdf({ per }: { per: PeriodeAgg }) {
  if (per.cdf <= 0) return <Point />
  const visibles = per.receptions.slice(0, 3)
  const reste = per.receptions.length - visibles.length
  return (
    <>
      <div style={{ color: C_BLEU, fontWeight: 700 }}>+ {formatNumber(per.cdf)}</div>
      {visibles.map((r, i) => (
        <div key={`${r.date}-${r.cdf}-${i}`} style={styles.cellSub} title={r.cdf ? `${r.cdf}${r.hypothese ? ' — en retard / sans date : supposée reçue demain' : ''}` : undefined}>
          <span style={{ color: r.hypothese ? C_ORANGE : 'rgba(143,199,218,0.85)' }}>{formatJourMois(r.date)}{r.hypothese ? '*' : ''}</span> +{formatNumber(r.q)}
        </div>
      ))}
      {reste > 0 && <div style={styles.cellSub}>+{reste} autre{reste > 1 ? 's' : ''}</div>}
    </>
  )
}

/** Colonne finale : promissible aujourd'hui, paliers datés, et 1ʳᵉ date pour la quantité à promettre. */
function DispoNouvelleCdc({ proj, quantite }: { proj: RefProjection | undefined; quantite: number }) {
  if (!proj) return <span style={styles.cellSub}>disponibilité…</span>
  const auj = todayIso()
  const [maintenant, ...paliers] = proj.echelons
  const rien = maintenant.quantite <= 0
  const cible = quantite > 0 ? premiereDateDisponible(proj.stock0, proj.evts, quantite) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={styles.echelonsRow}>
        <span style={{ ...styles.echelonChip, ...(rien ? styles.echelonChipRupture : styles.echelonChipNow) }}>
          <span style={{ ...styles.echelonQte, color: rien ? C_ROUGE : C_VERT }}>{formatNumber(maintenant.quantite)}</span>
          <span style={styles.echelonLabel}>aujourd'hui</span>
        </span>
        {paliers.map((p) => (
          <span key={p.date} style={styles.echelonChip}>
            <span style={{ ...styles.echelonQte, color: C_BLEU }}>{formatNumber(p.quantite)}</span>
            <span style={styles.echelonLabel}>dès {formatDateCourte(p.date)}<small style={{ opacity: 0.7 }}> · {daysBetween(auj, p.date)} j</small></span>
          </span>
        ))}
      </div>
      {paliers.length === 0 && rien && (
        <span style={{ ...styles.cellSub, color: C_ROUGE }}>
          {proj.receptionsAttendues > 0 ? `+${formatNumber(proj.receptionsAttendues)} attendues, absorbées par les CDC prises` : 'Aucun appro en cours'}
          {proj.stockFinal < 0 ? ` · ${formatNumber(-proj.stockFinal)} p. manquantes` : ''}
        </span>
      )}
      {paliers.length === 0 && !rien && proj.receptionsAttendues > 0 && proj.stockFinal <= maintenant.quantite && (
        <span style={styles.cellSub}>+{formatNumber(proj.receptionsAttendues)} attendues, absorbées par les CDC prises</span>
      )}
      {cible && (
        <div style={styles.cibleBox}>
          <span style={styles.cellSub}>Pour {formatNumber(quantite)} p. :</span>{' '}
          {cible.date === null ? (
            <strong style={{ color: C_ROUGE }}>réappro nécessaire</strong>
          ) : cible.date === auj ? (
            <strong style={{ color: C_VERT }}>aujourd'hui</strong>
          ) : (
            <strong style={{ color: C_ORANGE }}>le {formatDateFr(cible.date)} <span style={styles.cellSub}>· {daysBetween(auj, cible.date)} j</span></strong>
          )}
        </div>
      )}
    </div>
  )
}

// ── Fenêtre flottante ─────────────────────────────────────────────────────
function FenetreArticle({
  children, onClose, onPrev, onNext, position,
}: {
  children: React.ReactNode
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  position: string | null
}) {
  const handlers = useRef({ onClose, onPrev, onNext })
  handlers.current = { onClose, onPrev, onNext }

  useEffect(() => {
    const overflowAvant = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { handlers.current.onClose(); return }
      const t = e.target as HTMLElement | null
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === 'ArrowLeft' && handlers.current.onPrev) handlers.current.onPrev()
      if (e.key === 'ArrowRight' && handlers.current.onNext) handlers.current.onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflowAvant
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div style={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} role="dialog" aria-modal="true">
      <div style={styles.modal}>
        <div style={styles.modalBar}>
          <span style={styles.modalKicker}>Fiche article{position ? ` · ${position}` : ''}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="stkBtn" onClick={() => onPrev?.()} disabled={!onPrev} style={{ ...styles.ghostBtn, opacity: onPrev ? 1 : 0.35 }} title="Référence précédente (←)">‹ Précédente</button>
            <button type="button" className="stkBtn" onClick={() => onNext?.()} disabled={!onNext} style={{ ...styles.ghostBtn, opacity: onNext ? 1 : 0.35 }} title="Référence suivante (→)">Suivante ›</button>
            <button type="button" className="stkBtn" onClick={onClose} style={styles.ghostBtn} title="Fermer (Échap)">✕ Fermer</button>
          </div>
        </div>
        <div style={styles.modalBody}>{children}</div>
      </div>
    </div>
  )
}

// ── Fiche article ─────────────────────────────────────────────────────────
function ArticleDetail({
  reference, designation, horizonMois, onHorizonChange, quantiteSimulee, onQuantiteSimuleeChange,
}: {
  reference: string
  designation: string
  horizonMois: number
  onHorizonChange: (m: number) => void
  quantiteSimulee: string
  onQuantiteSimuleeChange: (v: string) => void
}) {
  const [designationResolue, setDesignationResolue] = useState(designation)
  const [depotRows, setDepotRows] = useState<DepotStockRow[] | null>(null)
  const [receptions, setReceptions] = useState<ReceptionRow[]>([])
  const [couverture, setCouverture] = useState<CouvertureRow[]>([])
  const [stockGlobal, setStockGlobal] = useState<{ stock_disponible: number; stock_reel: number; stock_a_terme: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [afficherDepotsVides, setAfficherDepotsVides] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function charger() {
      setLoading(true)
      setError(null)
      try {
        const [depotRes, recRows, couvRows, stockRes, refRes] = await Promise.all([
          supabase.rpc('get_stock_par_depot', { p_reference_article: reference }),
          fetchAll<any>((from, to) => supabase.from('v_couverture_stock_receptions').select('*').eq('reference_article', reference)
            .order('date_reception_retenue', { ascending: true }).order('ligne_cdf_id').range(from, to)),
          fetchAll<any>((from, to) => supabase.from('v_portefeuille_couverture_stock')
            .select('id,numero_document,numero_tiers,nom_tiers,representant,agence,date_creation_document,date_livraison,quantite,montant_ht,rang_service,stock_disponible,besoin_cumule,receptions_avant_livraison,stock_projete_a_date,manque_a_date,statut_couverture,date_couverture_estimee,retard_estime_jours,prochaine_reception_date,prochaine_reception_quantite,prochaine_reception_cdf,prochaine_reception_hypothese')
            .eq('reference_article', reference)
            .order('rang_service', { ascending: true }).order('id').range(from, to)),
          supabase.from('v_stock_articles_latest').select('designation,stock_disponible,stock_reel,stock_a_terme').eq('reference_article', reference).maybeSingle(),
          designation ? Promise.resolve({ data: null }) : supabase.from('ref_articles').select('designation').eq('reference_article', reference).maybeSingle(),
        ])
        if (cancelled) return
        if (depotRes.error) throw depotRes.error
        setDepotRows((depotRes.data || []) as DepotStockRow[])
        setReceptions(recRows.map((r) => ({ ...r, quantite_attendue: toNumber(r.quantite_attendue) })) as ReceptionRow[])
        setCouverture(couvRows.map((r) => ({
          ...r,
          quantite: toNumber(r.quantite), montant_ht: toNumber(r.montant_ht), rang_service: toNumber(r.rang_service),
          stock_disponible: toNumber(r.stock_disponible), besoin_cumule: toNumber(r.besoin_cumule),
          receptions_avant_livraison: toNumber(r.receptions_avant_livraison), stock_projete_a_date: toNumber(r.stock_projete_a_date),
          manque_a_date: toNumber(r.manque_a_date),
          prochaine_reception_quantite: r.prochaine_reception_quantite === null ? null : toNumber(r.prochaine_reception_quantite),
          prochaine_reception_hypothese: Boolean(r.prochaine_reception_hypothese),
        })) as CouvertureRow[])
        const s = stockRes.data as any
        setStockGlobal(s ? { stock_disponible: toNumber(s.stock_disponible), stock_reel: toNumber(s.stock_reel), stock_a_terme: toNumber(s.stock_a_terme) } : null)
        const desig = designation || String(s?.designation || (refRes as any)?.data?.designation || '')
        setDesignationResolue(desig)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String((e as any)?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void charger()
    return () => { cancelled = true }
  }, [reference, designation])

  // Stock de départ de la projection : dispo global (sto_qte − sto_prepa),
  // même base que v_portefeuille_couverture_stock.
  const totalDepot = useMemo(() => {
    if (!depotRows) return null
    return depotRows.reduce(
      (acc, r) => ({
        stock_reel: acc.stock_reel + toNumber(r.stock_reel),
        stock_reserve: acc.stock_reserve + toNumber(r.stock_reserve),
        stock_disponible: acc.stock_disponible + toNumber(r.stock_disponible),
        stock_a_terme: acc.stock_a_terme + toNumber(r.stock_a_terme),
        stock_commande_fournisseur: acc.stock_commande_fournisseur + toNumber(r.stock_commande_fournisseur),
      }),
      { stock_reel: 0, stock_reserve: 0, stock_disponible: 0, stock_a_terme: 0, stock_commande_fournisseur: 0 },
    )
  }, [depotRows])

  const stock0 = couverture.length > 0 ? couverture[0].stock_disponible : (stockGlobal?.stock_disponible ?? totalDepot?.stock_disponible ?? 0)
  const events = useMemo(() => construireProjection(stock0, receptions, couverture), [stock0, receptions, couverture])
  const horizonFin = useMemo(() => addMonthsIso(todayIso(), horizonMois), [horizonMois])
  const totalReceptions = useMemo(() => receptions.reduce((s, r) => s + toNumber(r.quantite_attendue), 0), [receptions])
  const totalBesoins = useMemo(() => couverture.reduce((s, r) => s + r.quantite, 0), [couverture])
  const nonCompletes = useMemo(() => couverture.filter((r) => r.statut_couverture === 'RUPTURE' || r.statut_couverture === 'RECEPTION_TARDIVE'), [couverture])
  const receptionsAvecHypothese = receptions.filter((r) => r.hypothese_reception !== 'PREVUE').length

  const quantite = Math.max(0, Math.floor(toNumber(quantiteSimulee)))
  const dispoNouvelleCommande = useMemo(() => premiereDateDisponible(stock0, events, quantite), [stock0, events, quantite])
  const stockFinal = events.length > 0 ? events[events.length - 1].stockApres : stock0
  const echelons = useMemo(() => calculerEchelons(stock0, events, 4), [stock0, events])

  const { depotsAvecStock, depotsVides, maxDispo } = useMemo(() => {
    const rows = [...(depotRows || [])].sort((a, b) => toNumber(b.stock_disponible) - toNumber(a.stock_disponible) || a.depot.localeCompare(b.depot, 'fr'))
    const avec = rows.filter((r) => toNumber(r.stock_reel) !== 0 || toNumber(r.stock_reserve) !== 0 || toNumber(r.stock_disponible) !== 0)
    const vides = rows.filter((r) => !avec.includes(r))
    return { depotsAvecStock: avec, depotsVides: vides, maxDispo: Math.max(1, ...avec.map((r) => Math.max(0, toNumber(r.stock_disponible)))) }
  }, [depotRows])

  return (
    <div style={styles.detail}>
      {/* ── En-tête article ── */}
      <div style={styles.detailHeader}>
        <div style={{ minWidth: 0 }}>
          <div style={styles.detailRef}>{reference}</div>
          <div style={styles.detailDesignation}>{designationResolue || '—'}</div>
        </div>
        <div style={styles.headerActions}>
          {!loading && (
            <div style={styles.echelonsRow}>
              {echelons.map((e, i) => (
                <span key={e.date} style={{ ...styles.echelonChip, ...(i === 0 ? (e.quantite > 0 ? styles.echelonChipNow : styles.echelonChipRupture) : {}) }}>
                  <span style={{ ...styles.echelonQte, color: i === 0 ? (e.quantite > 0 ? C_VERT : C_ROUGE) : C_BLEU }}>{formatNumber(e.quantite)}</span>
                  <span style={styles.echelonLabel}>{i === 0 ? "promissible aujourd'hui" : `dès ${formatDateCourte(e.date)}`}</span>
                </span>
              ))}
            </div>
          )}
          <a href={`/portefeuille-livraison?couverture=non-servable`} target="_blank" rel="noopener noreferrer" className="stkBtn" style={styles.ghostBtn}>Portefeuille livraison ↗</a>
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}

      {/* ── Bandeau KPI ── */}
      <div style={styles.kpiRow}>
        <Kpi label="Disponible tous dépôts" value={loading ? '…' : formatNumber(stock0)} color={couleurDispo(stock0)} big />
        <Kpi label="Réel" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_reel)} />
        <Kpi label="Réservé" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_reserve)} color={totalDepot && totalDepot.stock_reserve > 0 ? '#D69A4A' : undefined} />
        <Kpi label="À terme (SAGE)" value={loading || !totalDepot ? '…' : formatNumber(totalDepot.stock_a_terme)} color={totalDepot && totalDepot.stock_a_terme < 0 ? C_ROUGE : undefined} />
        <Kpi label="Réceptions attendues" value={loading ? '…' : `+ ${formatNumber(totalReceptions)}`} color={C_BLEU} sub={receptionsAvecHypothese > 0 ? `${receptionsAvecHypothese} CDF en retard / sans date → demain` : `${receptions.length} ligne(s) CDF`} />
        <Kpi label="Besoins CDC fermes" value={loading ? '…' : `− ${formatNumber(totalBesoins)}`} color={C_ORANGE} sub={`${couverture.length} ligne(s) · ${nonCompletes.length} non complète(s)`} />
        <Kpi label="Stock projeté fin de besoins" value={loading ? '…' : formatNumber(stockFinal)} color={couleurDispo(stockFinal)} sub="après toutes réceptions et CDC connus" />
      </div>

      {/* ── Projection ── */}
      <div style={styles.card}>
        <div style={styles.cardHeaderRow}>
          <div>
            <div style={styles.cardTitle}>Projection du stock disponible sur documents réels</div>
            <div style={styles.muted}>
              Stock dispo aujourd'hui, moins les commandes clients à leur date de livraison, plus les commandes fournisseurs à leur date de réception. Les CDF en retard ou sans date sont supposées reçues demain (pointillés).
            </div>
          </div>
          <div style={styles.segment}>
            {HORIZONS.map(([m, label]) => (
              <button key={m} type="button" className="stkBtn" onClick={() => onHorizonChange(m)} style={{ ...styles.segmentBtn, ...(horizonMois === m ? styles.segmentBtnActive : {}) }}>{label}</button>
            ))}
          </div>
        </div>
        {loading ? <div style={styles.skeleton} /> : <ProjectionChart stock0={stock0} events={events} debut={todayIso()} fin={horizonFin} />}
      </div>

      <div style={styles.twoCols}>
        {/* ── Alertes commandes non complètes ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>
            Commandes non complètes à la date de livraison client
            <span style={{ ...styles.countTag, background: nonCompletes.length > 0 ? 'rgba(193,104,60,0.25)' : 'rgba(255,255,255,0.08)', color: nonCompletes.length > 0 ? C_ROUGE : 'rgba(255,255,255,0.5)' }}>{nonCompletes.length}</span>
          </div>
          {loading ? <div style={styles.skeleton} /> : nonCompletes.length === 0 ? (
            <div style={styles.okBox}>✓ Toutes les commandes clients connues sur cette référence sont servables à leur date de livraison.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table className="stkTable" style={styles.table}>
                <thead>
                  <tr>
                    {['CDC', 'Client', 'Livraison', 'Qté', 'Manque', 'Statut', 'Complète le', 'Prochaine réception'].map((h) => <th key={h} style={styles.th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {nonCompletes.map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>{r.numero_document}</td>
                      <td style={styles.td}>
                        <div style={{ color: '#fff' }}>{r.nom_tiers || r.numero_tiers}</div>
                        <div style={styles.tdSub}>{[r.agence, r.representant].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: r.date_livraison && r.date_livraison < todayIso() ? C_ROUGE : undefined }}>{formatDateFr(r.date_livraison)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{formatNumber(r.quantite)}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: C_ROUGE, fontWeight: 700 }}>{formatNumber(r.manque_a_date)}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: STATUT_COLOR[r.statut_couverture], color: STATUT_COLOR[r.statut_couverture] }}>{STATUT_LABEL[r.statut_couverture]}</span></td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {r.date_couverture_estimee
                          ? <span style={{ color: C_ORANGE, fontWeight: 700 }}>{formatDateFr(r.date_couverture_estimee)}{r.retard_estime_jours !== null ? <span style={styles.tdSub}> +{r.retard_estime_jours} j</span> : null}</span>
                          : <span style={{ color: C_ROUGE, fontWeight: 700 }}>Aucune réception connue</span>}
                      </td>
                      <td style={styles.td}>
                        {r.prochaine_reception_date
                          ? <><span style={{ color: C_BLEU }}>{formatDateCourte(r.prochaine_reception_date)}</span> · +{formatNumber(r.prochaine_reception_quantite || 0)} <span style={styles.tdSub}>{r.prochaine_reception_cdf}{r.prochaine_reception_hypothese ? ' (hypothèse demain)' : ''}</span></>
                          : <span style={styles.tdSub}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && nonCompletes.length > 0 && (
            <div style={{ ...styles.tdSub, marginTop: 6 }}>Montant HT concerné : {formatMoney(nonCompletes.reduce((s, r) => s + r.montant_ht, 0))}</div>
          )}
          <div style={styles.expected}>
            <strong>Ce qui est attendu :</strong> chercher une substitution (autre référence), voir si une autre commande client peut être dépriorisée, puis contacter le client pour valider la solution et recaler la date de livraison dans SAGE / BLG.
          </div>
        </div>

        {/* ── Simulateur nouvelle commande ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Nouvelle commande sur cette référence</div>
          <div style={styles.muted}>Première date à laquelle la quantité peut être promise sans mettre en rupture les commandes clients déjà prises (stock projeté ≥ quantité à cette date et après).</div>
          <div style={styles.simRow}>
            <label style={styles.field}>
              <span style={styles.fieldLabel}>Quantité</span>
              <input type="number" min={1} step={1} value={quantiteSimulee} onChange={(e) => onQuantiteSimuleeChange(e.target.value)} onFocus={(e) => e.target.select()} style={styles.input} />
            </label>
            <div style={styles.simResult}>
              {loading ? <div style={styles.muted}>…</div> : quantite <= 0 ? (
                <div style={styles.muted}>Saisis une quantité.</div>
              ) : dispoNouvelleCommande.date ? (
                <>
                  <div style={styles.simKicker}>{dispoNouvelleCommande.date === todayIso() ? 'Disponible dès' : 'Disponible à partir du'}</div>
                  <div style={{ ...styles.simDate, color: dispoNouvelleCommande.date === todayIso() ? C_VERT : C_ORANGE }}>
                    {dispoNouvelleCommande.date === todayIso() ? "aujourd'hui" : formatDateFr(dispoNouvelleCommande.date)}
                  </div>
                  <div style={styles.tdSub}>
                    {dispoNouvelleCommande.date === todayIso() ? '' : `dans ${daysBetween(todayIso(), dispoNouvelleCommande.date)} j · `}
                    stock projeté minimum ensuite : {formatNumber(dispoNouvelleCommande.niveau)} · reste {formatNumber(dispoNouvelleCommande.niveau - quantite)} après cette commande
                  </div>
                </>
              ) : (
                <>
                  <div style={styles.simKicker}>Aucune date connue</div>
                  <div style={{ ...styles.simDate, color: C_ROUGE, fontSize: 18 }}>Réapprovisionnement nécessaire</div>
                  <div style={styles.tdSub}>Les réceptions connues ne couvrent pas les besoins déjà pris ({formatNumber(Math.max(0, quantite - Math.min(stockFinal, dispoNouvelleCommande.niveau)))} pièce(s) manquante(s) pour servir cette commande).</div>
                </>
              )}
            </div>
          </div>
          {!loading && events.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={styles.subTitle}>Chronologie des mouvements prévus</div>
              <div style={styles.tableWrap}>
                <table className="stkTable" style={styles.table}>
                  <thead><tr>{['Date', 'Mouvement', 'Détail', 'Qté', 'Stock après'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    <tr>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(todayIso())}</td>
                      <td style={styles.td}><span style={{ ...styles.badge, borderColor: '#A6A181', color: '#E9E5D6' }}>Stock dispo</span></td>
                      <td style={styles.td}><span style={styles.tdSub}>tous dépôts</span></td>
                      <td style={{ ...styles.td, textAlign: 'right' }}></td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: couleurDispo(stock0) }}>{formatNumber(stock0)}</td>
                    </tr>
                    {events.map((e, i) => (
                      <tr key={`${e.type}-${e.label}-${i}`} style={{ opacity: e.date > horizonFin ? 0.5 : 1 }}>
                        <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{formatDateCourte(e.date)}{e.hypothese ? <span title="CDF en retard ou sans date : supposée reçue demain" style={{ color: C_ORANGE }}> *</span> : null}</td>
                        <td style={styles.td}><span style={{ ...styles.badge, borderColor: e.type === 'RECEPTION' ? C_BLEU : C_ORANGE, color: e.type === 'RECEPTION' ? C_BLEU : C_ORANGE }}>{e.type === 'RECEPTION' ? 'Réception' : 'CDC'} {e.label}</span></td>
                        <td style={styles.td}><span style={styles.tdSub}>{e.detail || '—'}</span></td>
                        <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', color: e.quantite > 0 ? C_BLEU : C_ORANGE }}>{e.quantite > 0 ? '+' : ''}{formatNumber(e.quantite)}</td>
                        <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: couleurDispo(e.stockApres) }}>{formatNumber(e.stockApres)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {receptionsAvecHypothese > 0 && <div style={{ ...styles.tdSub, marginTop: 6 }}>* CDF en retard ou sans date SAGE : réception supposée demain (hypothèse).</div>}
            </div>
          )}
        </div>
      </div>

      <div style={styles.twoCols}>
        {/* ── Stock par dépôt ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Stock disponible par dépôt</div>
          {loading ? <div style={styles.skeleton} /> : !depotRows || depotRows.length === 0 ? (
            <div style={styles.muted}>Aucune position de stock.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {depotsAvecStock.length === 0 && <div style={styles.muted}>Aucun dépôt avec du stock pour cette référence.</div>}
              {depotsAvecStock.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
              {depotsVides.length > 0 && (
                <button type="button" onClick={() => setAfficherDepotsVides((v) => !v)} style={styles.linkBtn}>
                  {afficherDepotsVides ? 'Masquer' : 'Afficher'} les {depotsVides.length} dépôt{depotsVides.length > 1 ? 's' : ''} à zéro
                </button>
              )}
              {afficherDepotsVides && depotsVides.map((r) => <LigneDepot key={r.depot} row={r} maxDispo={maxDispo} />)}
            </div>
          )}
        </div>

        {/* ── Réceptions fournisseurs ── */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>Commandes fournisseurs en cours (SAGE) <span style={styles.countTag}>{receptions.length}</span></div>
          {loading ? <div style={styles.skeleton} /> : receptions.length === 0 ? (
            <div style={styles.muted}>Aucune commande fournisseur non réceptionnée pour cette référence.</div>
          ) : (
            <div style={styles.tableWrap}>
              <table className="stkTable" style={styles.table}>
                <thead><tr>{['Réception retenue', 'Date SAGE', 'N° CDF', 'Fournisseur', 'Dépôt', 'Qté'].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {receptions.map((r) => (
                    <tr key={r.ligne_cdf_id}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', color: r.hypothese_reception === 'PREVUE' ? C_BLEU : C_ORANGE, fontWeight: 700 }}>
                        {formatDateFr(r.date_reception_retenue)}
                        {r.hypothese_reception === 'RETARD' ? <span style={styles.tdSub}> · en retard, supposée demain</span> : r.hypothese_reception === 'SANS_DATE' ? <span style={styles.tdSub}> · sans date, supposée demain</span> : null}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{r.date_livraison_sage ? formatDateFr(r.date_livraison_sage) : <span style={styles.tdSub}>à confirmer</span>}</td>
                      <td style={{ ...styles.td, fontFamily: 'var(--font-mono)', color: '#fff' }}>{r.numero_cdf || '—'}</td>
                      <td style={styles.td}>{r.nom_fournisseur || r.numero_fournisseur || '—'}</td>
                      <td style={styles.td}>{r.depot_reception ? depotCourt(r.depot_reception) : '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#fff' }}>+ {formatNumber(r.quantite_attendue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Graphe de projection (courbe en escalier) ─────────────────────────────
function ProjectionChart({ stock0, events, debut, fin }: { stock0: number; events: EvenementProjection[]; debut: string; fin: string }) {
  const width = 1100
  const height = 300
  const padding = { top: 18, right: 20, bottom: 34, left: 60 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const totalJours = Math.max(1, daysBetween(debut, fin))
  const x = (iso: string) => padding.left + (Math.min(Math.max(daysBetween(debut, iso), 0), totalJours) / totalJours) * innerW

  const points = useMemo(() => {
    const pts: Array<{ date: string; stock: number; event: EvenementProjection | null }> = [{ date: debut, stock: stock0, event: null }]
    for (const e of events) {
      if (e.date > fin) break
      pts.push({ date: e.date, stock: e.stockApres, event: e })
    }
    return pts
  }, [events, stock0, debut, fin])

  const dernierNiveau = points[points.length - 1].stock
  const allValues = points.map((p) => p.stock)
  const maxVal = Math.max(1, ...allValues)
  const minVal = Math.min(0, ...allValues)
  const y = (v: number) => padding.top + innerH - ((v - minVal) / (maxVal - minVal || 1)) * innerH
  const yZero = y(0)

  const path = useMemo(() => {
    let d = ''
    points.forEach((p, i) => {
      const px = x(p.date)
      const py = y(p.stock)
      if (i === 0) d += `M ${px} ${py}`
      else d += ` L ${px} ${y(points[i - 1].stock)} L ${px} ${py}`
    })
    d += ` L ${padding.left + innerW} ${y(dernierNiveau)}`
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, dernierNiveau, maxVal, minVal, totalJours])

  const negSegments = useMemo(() => {
    const segs: Array<{ x1: number; x2: number; ymin: number }> = []
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].stock < 0) {
        const x1 = x(points[i].date)
        const x2 = i + 1 < points.length ? x(points[i + 1].date) : padding.left + innerW
        segs.push({ x1, x2, ymin: y(points[i].stock) })
      }
    }
    return segs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, maxVal, minVal, totalJours])

  const mois = useMemo(() => {
    const out: Array<{ iso: string; label: string }> = []
    const d = new Date(`${debut}T00:00:00`)
    d.setDate(1); d.setMonth(d.getMonth() + 1)
    while (toIsoDate(d) <= fin) {
      out.push({ iso: toIsoDate(d), label: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }) })
      d.setMonth(d.getMonth() + 1)
    }
    return out
  }, [debut, fin])

  const ticks = useMemo(() => {
    const range = maxVal - minVal || 1
    return [minVal, minVal + range / 4, minVal + range / 2, minVal + (range * 3) / 4, maxVal]
  }, [maxVal, minVal])

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const svgX = ((e.clientX - rect.left) / rect.width) * width
    let best = 0
    for (let i = 0; i < points.length; i += 1) if (x(points[i].date) <= svgX) best = i
    setHover(best)
  }

  const hp = hover !== null ? points[hover] : null
  const hpX = hp ? x(hp.date) : 0

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', cursor: 'crosshair' }} onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="stk-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C_BLEU} stopOpacity={0.22} />
            <stop offset="100%" stopColor={C_BLEU} stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <line x1={padding.left} y1={yZero} x2={width - padding.right} y2={yZero} stroke="#C1683C" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.8} />
        <text x={width - padding.right} y={yZero - 4} fontSize={10} textAnchor="end" fill={C_ROUGE}>rupture</text>
        {negSegments.map((s, i) => (
          <rect key={i} x={s.x1} y={yZero} width={Math.max(0, s.x2 - s.x1)} height={Math.max(0, s.ymin - yZero)} fill="rgba(193,104,60,0.25)" />
        ))}
        <path d={`${path} L ${padding.left + innerW} ${yZero} L ${padding.left} ${yZero} Z`} fill="url(#stk-area)" />
        <path d={path} fill="none" stroke={C_BLEU} strokeWidth={2.4} strokeLinejoin="round" />
        {points.slice(1).map((p, i) => (
          <g key={i}>
            <circle cx={x(p.date)} cy={y(p.stock)} r={4} fill={p.event?.type === 'RECEPTION' ? C_BLEU : C_ORANGE} stroke="#101A2E" strokeWidth={1.5} />
            {p.event?.hypothese && <circle cx={x(p.date)} cy={y(p.stock)} r={7} fill="none" stroke={C_ORANGE} strokeDasharray="2 2" />}
          </g>
        ))}
        <text x={padding.left} y={padding.top - 5} fontSize={10} fill="rgba(255,255,255,0.55)">aujourd'hui</text>
        {hp && (
          <line x1={hpX} y1={padding.top} x2={hpX} y2={padding.top + innerH} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
        )}
      </svg>
      {hp && (
        <div style={{ ...styles.tooltip, left: `${Math.min(88, Math.max(6, (hpX / width) * 100))}%` }}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{formatDateFr(hp.date)}</div>
          {hp.event ? (
            <div style={{ color: hp.event.type === 'RECEPTION' ? C_BLEU : C_ORANGE }}>
              {hp.event.type === 'RECEPTION' ? 'Réception' : 'CDC'} {hp.event.label} : {hp.event.quantite > 0 ? '+' : ''}{formatNumber(hp.event.quantite)}
              {hp.event.detail ? <div style={styles.tdSub}>{hp.event.detail}</div> : null}
              {hp.event.hypothese ? <div style={styles.tdSub}>hypothèse : CDF en retard / sans date → demain</div> : null}
            </div>
          ) : <div style={{ color: '#E9E5D6' }}>Stock disponible aujourd'hui</div>}
          <div style={{ marginTop: 3 }}>Stock projeté : <strong style={{ color: couleurDispo(hp.stock) }}>{formatNumber(hp.stock)}</strong></div>
        </div>
      )}
      <div style={styles.legend}>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: C_BLEU }} />Réception fournisseur</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: C_ORANGE }} />Commande client (CDC)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'transparent', border: `1.5px dashed ${C_ORANGE}` }} />Réception supposée demain (CDF en retard / sans date)</span>
        <span style={styles.legendItem}><span style={{ ...styles.legendDot, background: 'rgba(193,104,60,0.6)' }} />Période de rupture</span>
      </div>
    </div>
  )
}

// ── Petits composants ─────────────────────────────────────────────────────
function Kpi({ label, value, color, sub, big }: { label: string; value: string; color?: string; sub?: string; big?: boolean }) {
  return (
    <div style={{ ...styles.kpi, ...(big ? styles.kpiBig : {}) }}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(big ? { fontSize: 36 } : {}), color: color || '#fff' }}>{value}</div>
      {sub && <div style={styles.kpiSub}>{sub}</div>}
    </div>
  )
}

function LigneDepot({ row, maxDispo }: { row: DepotStockRow; maxDispo: number }) {
  const dispo = toNumber(row.stock_disponible)
  const reel = toNumber(row.stock_reel)
  const reserve = toNumber(row.stock_reserve)
  const largeur = Math.max(0, Math.min(100, (Math.max(0, dispo) / maxDispo) * 100))
  const couleur = couleurDispo(dispo)
  return (
    <div style={styles.depotRow}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{depotCourt(row.depot)}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: couleur }}>{formatNumber(dispo)}</span>
      </div>
      <div style={{ marginTop: 5, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${largeur}%`, height: '100%', borderRadius: 3, background: couleur }} />
      </div>
      <div style={{ marginTop: 4, display: 'flex', gap: 12, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'rgba(255,255,255,0.5)' }}>
        <span>réel <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatNumber(reel)}</span></span>
        <span>réservé <span style={{ color: reserve > 0 ? '#D69A4A' : 'rgba(255,255,255,0.8)' }}>{formatNumber(reserve)}</span></span>
        <span>cde fourn. <span style={{ color: 'rgba(255,255,255,0.8)' }}>{formatNumber(toNumber(row.stock_commande_fournisseur))}</span></span>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 1800, margin: '0 auto', padding: '10px 4px 40px', color: '#F5F3EC', fontFamily: 'var(--font-body)' },
  header: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 },
  kicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  title: { margin: '4px 0 0', fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' },
  lead: { marginTop: 4, fontSize: 13.5, color: 'rgba(255,255,255,0.6)', maxWidth: 1100 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  card: { borderRadius: 18, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: 16 },
  cardTitle: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  cardHeaderRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  subTitle: { fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6 },
  countTag: { display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', letterSpacing: 0, textTransform: 'none' },
  muted: { fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45 },
  hint: { fontSize: 11.5, color: 'rgba(166,161,129,0.9)' },
  errorBox: { marginBottom: 12, padding: 12, borderRadius: 12, border: '1px solid rgba(193,104,60,0.35)', background: 'rgba(193,104,60,0.12)', color: C_ROUGE, fontSize: 13 },
  okBox: { padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(143,212,168,0.35)', background: 'rgba(143,212,168,0.08)', color: C_VERT, fontSize: 13 },
  skeleton: { height: 120, borderRadius: 12, background: 'rgba(255,255,255,0.05)' },

  searchGrid: { display: 'grid', gridTemplateColumns: 'minmax(300px, 2.2fr) repeat(5, minmax(140px, 1fr))', gap: 10, alignItems: 'start' },
  searchFooter: { marginTop: 8, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minHeight: 4 },
  searchArea: { width: '100%', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '8px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 },
  select: { height: 36, borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)', background: '#141A26', color: '#fff', padding: '0 8px', fontSize: 13, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  input: { height: 40, width: 120, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', padding: '0 10px', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', boxSizing: 'border-box' },
  ghostBtn: { display: 'inline-flex', alignItems: 'center', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'transparent', color: 'rgba(255,255,255,0.78)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' },
  linkBtn: { marginTop: 4, alignSelf: 'flex-start', background: 'none', border: 'none', padding: '4px 0', fontSize: 12, color: 'rgba(255,255,255,0.45)', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', fontFamily: 'inherit' },

  emptyList: { minHeight: 220, borderRadius: 14, border: '1px dashed rgba(255,255,255,0.18)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' },
  listWrap: { maxHeight: 'calc(100vh - 230px)', minHeight: 300, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  refCell: { verticalAlign: 'top', maxWidth: 300 },
  refBtn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', maxWidth: '100%' },
  refDesignation: { fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35, whiteSpace: 'normal' },
  flags: { marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  flag: { display: 'inline-flex', padding: '2px 8px', borderRadius: 999, border: '1px solid', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' },
  lineLabel: { fontSize: 12, whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.7)' },
  tdNum: { padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 13, verticalAlign: 'top', color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' },
  bigNum: { fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 800, lineHeight: 1.1 },
  cellSub: { fontSize: 10.5, color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-mono)', lineHeight: 1.4, whiteSpace: 'nowrap' },
  cibleBox: { marginTop: 2, padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.10)', fontSize: 12.5 },
  footnote: { marginTop: 10, fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 },

  echelonsRow: { display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'stretch' },
  echelonChip: { display: 'inline-flex', flexDirection: 'column', padding: '3px 8px', borderRadius: 8, border: '1px solid rgba(143,199,218,0.35)', background: 'rgba(143,199,218,0.08)', lineHeight: 1.15 },
  echelonChipNow: { borderColor: 'rgba(143,212,168,0.45)', background: 'rgba(143,212,168,0.10)' },
  echelonChipRupture: { borderColor: 'rgba(193,104,60,0.5)', background: 'rgba(193,104,60,0.14)' },
  echelonQte: { fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: C_VERT },
  echelonLabel: { fontSize: 10, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' },
  resultRef: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: '#fff' },

  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,9,18,0.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2vh 2vw' },
  modal: { width: 'min(1560px, 96vw)', maxHeight: '96vh', display: 'flex', flexDirection: 'column', borderRadius: 20, border: '1px solid rgba(255,255,255,0.14)', background: '#101A2E', boxShadow: '0 30px 80px rgba(0,0,0,0.55)', overflow: 'hidden' },
  modalBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.10)', background: '#0D1526' },
  modalKicker: { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' },
  modalBody: { overflow: 'auto', padding: 18 },

  detail: { display: 'flex', flexDirection: 'column', gap: 14 },
  detailHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  detailRef: { fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' },
  detailDesignation: { marginTop: 2, fontSize: 14, color: 'rgba(255,255,255,0.65)' },

  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 10 },
  kpi: { borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', padding: '12px 14px', minWidth: 0 },
  kpiBig: { border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.12)' },
  kpiLabel: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  kpiValue: { marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap' },
  kpiSub: { marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.35 },

  segment: { display: 'flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', flexShrink: 0, flexWrap: 'wrap' },
  segmentBtn: { padding: '6px 12px', borderRadius: 9, border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.65)', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  segmentBtnActive: { background: 'rgba(75,146,172,0.22)', borderColor: 'rgba(75,146,172,0.55)', color: C_BLEU },

  twoCols: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' },

  tableWrap: { maxHeight: 360, overflow: 'auto', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 10px', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.45)', borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.8)', verticalAlign: 'top' },
  tdSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)' },
  badge: { display: 'inline-flex', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 999, border: '1px solid', fontSize: 11, fontWeight: 700 },
  expected: { marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(166,161,129,0.4)', background: 'rgba(166,161,129,0.10)', color: '#E9E5D6', fontSize: 12.5, lineHeight: 1.45 },

  simRow: { marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  simResult: { flex: 1, minWidth: 220, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' },
  simKicker: { fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: 'rgba(255,255,255,0.5)' },
  simDate: { marginTop: 2, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, lineHeight: 1.1 },

  depotRow: { borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', padding: '9px 12px' },

  tooltip: { position: 'absolute', top: 8, transform: 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: '#0B1220', padding: '8px 10px', fontSize: 12, color: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 24px rgba(0,0,0,0.4)', zIndex: 5 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 8, fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block' },
}
