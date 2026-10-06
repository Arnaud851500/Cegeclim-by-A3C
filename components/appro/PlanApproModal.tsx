'use client'

/**
 * Plan d'appro & couverture de stock (fenêtre de l'écran Calcul de besoin, 06/10/2026).
 * ---------------------------------------------------------------------------
 * Sur la sélection de l'écran (groupe ou jeu filtré) :
 *  - projection mensuelle du stock selon des hypothèses de consommation
 *    (ventes N-1 du même mois ou conso moyenne retenue, × coefficient par mois,
 *    pour toutes les références ou référence par référence) ;
 *  - chaînage total ou partiel de références : la cible récupère X % des ventes
 *    passées de la source (et la source les perd) ;
 *  - saisie des quantités d'appro par mois de livraison (une commande par mois,
 *    fenêtre de livraison paramétrable, ex. mars → septembre) ou proposition
 *    automatique pour atteindre une couverture cible ;
 *  - lecture de la couverture en quantité, en mois et en valeur au prix d'achat SAGE
 *    (net fournisseur par défaut, PMP ou dernier prix d'achat ; mv_sage_articles_complet), agrégée et par référence ;
 *  - scénarios enregistrés (appro_plan_scenarios / _lignes / _hypotheses / _chainages),
 *    export Excel.
 *
 * Moteur de calcul : lib/planAppro.ts. Migration : supabase/sql/20261006_plan_appro_operation.sql.
 * Le plan est une simulation : rien n'est écrit dans SAGE / BLG.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabaseClient'
import {
  type AgregatMois, type Chainage, type ContexteProjection, type PlanArticle, type ProjectionArticle, type ScenarioParams,
  agreger, ajouterMois, cleHypo, clePlan, cleRef, listeMois, moisDe, moisHistorique, projeterArticle, proposerPlanArticle,
} from '@/lib/planAppro'

// ── Formats ─────────────────────────────────────────────────────────────────
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
function libMois(cle: string) { const [y, m] = cle.split('-').map(Number); return `${MOIS_COURTS[m - 1]} ${String(y).slice(2)}` }
function fmtNum(v: number | null | undefined, dec = 0) { return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) }
function fmtEuro(v: number | null | undefined) { return v === null || v === undefined ? '—' : `${Math.round(v).toLocaleString('fr-FR')} €` }
function fmtK(v: number | null | undefined) { if (v === null || v === undefined) return '—'; return Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€` : `${Math.round(v / 1000).toLocaleString('fr-FR')} k€` }
function messageErreur(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
const estTableAbsente = (e: unknown) => /does not exist|relation .* does not exist|Could not find the table|schema cache/i.test(messageErreur(e))

// ── Types ───────────────────────────────────────────────────────────────────
type Scenario = {
  id: string; nom: string; description: string | null; groupe_id: string | null; references_articles: string[]
  mois_debut_appro: string; mois_fin_appro: string; mois_fin_horizon: string
  base_demande: 'n1' | 'mu'; coef_defaut: number; couverture_cible_mois: number; inclure_reserve: boolean
  updated_at: string | null; cree_par: string | null
}
type Lecture = 'stock' | 'couverture' | 'valeur'

export type PlanApproModalProps = {
  articles: PlanArticle[]
  groupe: { id: string; nom: string } | null
  aujourdhui: string
  retardMaxJours: number
  onClose: () => void
  /** Appliquer une liste de références au filtre de l'écran (scénario chargé sur une autre sélection) */
  onFiltrerRefs?: (refs: string[], nom: string) => void
  /** Références connues (calcul de besoin) pour la recherche d'une référence à chaîner */
  catalogue?: { ref: string; designation: string | null }[]
}

type SuggestionChainage = { source: string; pct: number; commentaire: string | null }

/** Ajout d'une référence chaînée sur la ligne d'une référence : recherche dans le catalogue ou saisie libre,
 * suggestions issues des remplacements de la Projection stock. */
function AjoutChainage({ cible, dejaChainees, suggestions, catalogue, designationDe, onAjouter }: {
  cible: string; dejaChainees: Set<string>; suggestions: SuggestionChainage[]
  catalogue: { ref: string; designation: string | null }[]; designationDe: (ref: string) => string | null
  onAjouter: (source: string, pct: number, commentaire?: string | null) => void
}) {
  const [texte, setTexte] = useState('')
  const [pct, setPct] = useState(100)
  const [ouvert, setOuvert] = useState(false)
  const terme = texte.trim().toUpperCase()
  const resultats = useMemo(() => {
    if (terme.length < 2) return []
    const out: { ref: string; designation: string | null }[] = []
    for (const c of catalogue) {
      if (out.length >= 10) break
      const r = c.ref.toUpperCase()
      if (r === cible || dejaChainees.has(r)) continue
      if (r.includes(terme) || (c.designation || '').toUpperCase().includes(terme)) out.push(c)
    }
    return out
  }, [terme, catalogue, cible, dejaChainees])
  const valide = terme.length > 0 && terme !== cible && !dejaChainees.has(terme)
  function ajouter(ref: string, p = pct, commentaire?: string | null) {
    const r = cleRef(ref)
    if (!r || r === cible || dejaChainees.has(r)) return
    onAjouter(r, Math.max(1, Math.min(100, p)), commentaire)
    setTexte(''); setOuvert(false)
  }
  const sugg = suggestions.filter((x) => !dejaChainees.has(x.source) && x.source !== cible)
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5 text-[11px]">
      <span className="font-bold text-[#5B4387]">+ Chaîner une référence</span>
      <span className="relative">
        <input value={texte} onChange={(e) => { setTexte(e.target.value); setOuvert(true) }} onFocus={() => setOuvert(true)} onBlur={() => setTimeout(() => setOuvert(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter' && valide) ajouter(terme) }}
          placeholder="Référence ou désignation…" className="h-6 w-56 rounded border border-[#E5E1D8] bg-white px-1.5 font-semibold uppercase outline-none focus:border-[#7A5EA8]" />
        {ouvert && resultats.length > 0 && (
          <div className="absolute left-0 top-7 z-40 w-[380px] overflow-hidden rounded-lg border border-[#E5E1D8] bg-white shadow-xl">
            {resultats.map((r) => (
              <button key={r.ref} type="button" onMouseDown={(e) => { e.preventDefault(); ajouter(r.ref) }} className="block w-full px-2 py-1 text-left hover:bg-[#F6F2FB]">
                <span className="font-bold text-[#111820]">{r.ref}</span> <span className="text-[#8A8474]">{r.designation || ''}</span>
              </button>
            ))}
          </div>
        )}
      </span>
      <CelluleSaisie valeur={pct} onCommit={(v) => setPct(Math.max(1, Math.min(100, v ?? 100)))} className="w-14 pr-4" suffixe="%" titre="Part des ventes passées de la référence intégrée à la demande" />
      <button type="button" disabled={!valide} onClick={() => ajouter(terme)} className="h-6 rounded bg-[#7A5EA8] px-2 font-bold text-white disabled:opacity-40" title="Ajouter la référence saisie (nouvelle référence acceptée, même hors calcul de besoin)">Ajouter</button>
      {sugg.length > 0 && <span className="ml-2 text-[#8A8474]">Projection stock :</span>}
      {sugg.map((x) => (
        <button key={x.source} type="button" onClick={() => ajouter(x.source, x.pct, x.commentaire || 'Repris des remplacements de la projection stock')}
          className="rounded-full border border-[#7A5EA8] bg-[#F6F2FB] px-2 py-0.5 font-bold text-[#5B4387] hover:bg-[#EFE9F7]" title={designationDe(x.source) || x.commentaire || ''}>
          ↺ {x.source} {fmtNum(x.pct)} %
        </button>
      ))}
    </div>
  )
}

/** Fenêtre par défaut : opération de l'année suivante, livraisons de mars à septembre, horizon décembre. */
function paramsParDefaut(aujourdhui: string): ScenarioParams {
  const [y, m] = aujourdhui.split('-').map(Number)
  const an = m >= 3 ? y + 1 : y
  return {
    moisDebutAppro: `${an}-03-01`, moisFinAppro: `${an}-09-01`, moisFinHorizon: `${an}-12-01`,
    baseDemande: 'n1', coefDefaut: 1, couvertureCible: 3, inclureReserve: true,
  }
}

// ── Chargement de l'historique de conso (écrêtage appliqué) ────────────────
async function chargerConso(refs: string[], depuis: string, jusqua: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  const uniq = Array.from(new Set(refs.map(cleRef))).filter(Boolean)
  for (let i = 0; i < uniq.length; i += 80) {
    const lot = uniq.slice(i, i + 80)
    let from = 0
    while (true) {
      const { data, error } = await supabase.from('appro_article_conso_mensuelle').select('reference_article, mois, qte')
        .in('reference_article', lot).gte('mois', depuis).lte('mois', jusqua).order('reference_article').order('mois').range(from, from + 999)
      if (error) throw error
      const rows = (data || []) as { reference_article: string; mois: string; qte: number | null }[]
      rows.forEach((r) => {
        const k = cleRef(r.reference_article)
        if (!out.has(k)) out.set(k, new Map())
        out.get(k)!.set(String(r.mois).slice(0, 10), Number(r.qte || 0))
      })
      if (rows.length < 1000) break
      from += 1000
    }
    const { data: ecr } = await supabase.from('appro_article_conso_ecretage').select('reference_article, mois, qte_retenue').in('reference_article', lot)
    ;((ecr || []) as { reference_article: string; mois: string; qte_retenue: number }[]).forEach((e) => {
      const k = cleRef(e.reference_article)
      if (!out.has(k)) out.set(k, new Map())
      out.get(k)!.set(String(e.mois).slice(0, 10), Number(e.qte_retenue || 0))
    })
  }
  return out
}

// ── Saisie numérique légère (valide à la sortie du champ) ───────────────────
function CelluleSaisie({ valeur, onCommit, placeholder, className, suffixe, titre, desactive }: {
  valeur: number | null; onCommit: (v: number | null) => void; placeholder?: string; className?: string; suffixe?: string; titre?: string; desactive?: boolean
}) {
  const [brouillon, setBrouillon] = useState<string | null>(null)
  const affiche = brouillon ?? (valeur === null ? '' : String(valeur))
  function valider() {
    if (brouillon === null) return
    const t = brouillon.replace(',', '.').trim()
    setBrouillon(null)
    if (t === '') { onCommit(null); return }
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) onCommit(n)
  }
  return (
    <span className="relative inline-flex items-center">
      <input value={affiche} disabled={desactive} title={titre} placeholder={placeholder} inputMode="decimal"
        onChange={(e) => setBrouillon(e.target.value)} onBlur={valider}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBrouillon(null) }}
        className={`h-6 rounded border border-[#E5E1D8] bg-white px-1 text-right text-[11.5px] font-semibold tabular-nums outline-none focus:border-[#B4761A] disabled:bg-transparent disabled:text-[#B8B2A3] ${className || 'w-14'}`} />
      {suffixe && <span className="pointer-events-none absolute right-1 text-[9.5px] text-[#8A8474]">{suffixe}</span>}
    </span>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'alerte' | 'violet' }) {
  const color = tone === 'ok' ? '#3F9142' : tone === 'warn' ? '#B4761A' : tone === 'alerte' ? '#B42318' : tone === 'violet' ? '#7A5EA8' : '#111820'
  return (
    <div className="min-w-0 rounded-lg border border-[#E5E1D8] bg-white px-3 py-1.5">
      <div className="truncate text-[9.5px] font-bold uppercase tracking-wide text-[#8A8474]">{label}</div>
      <div className="text-[17px] font-bold leading-6 tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="truncate text-[10.5px] text-[#8A8474]">{sub}</div>}
    </div>
  )
}

// ── Composant ───────────────────────────────────────────────────────────────
/** Prix d'achat SAGE d'une référence (mv_sage_articles_complet). */
type PrixAchat = { net: number | null; dernier: number | null; pmp: number | null; ar: number | null }
type SourcePrix = 'net' | 'dernier' | 'pmp'
const LIB_SOURCE_PRIX: Record<SourcePrix, string> = { net: 'Prix d’achat net fournisseur', dernier: 'Dernier prix d’achat', pmp: 'PMP (prix moyen pondéré)' }
const prixPositif = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) || n <= 0 ? null : n }

/** Prix de valorisation selon la source choisie, avec repli sur les autres prix d'achat (jamais un prix de vente ni un tarif brut). */
function choisirPrix(p: PrixAchat | undefined, source: SourcePrix): { prix: number | null; origine: string } {
  if (!p) return { prix: null, origine: 'aucun prix d’achat SAGE' }
  const ordre: SourcePrix[] = source === 'net' ? ['net', 'dernier', 'pmp'] : source === 'dernier' ? ['dernier', 'net', 'pmp'] : ['pmp', 'dernier', 'net']
  for (const k of ordre) { const v = p[k]; if (v !== null) return { prix: v, origine: k === source ? LIB_SOURCE_PRIX[k] : `${LIB_SOURCE_PRIX[k]} (repli)` } }
  if (p.ar !== null) return { prix: p.ar, origine: 'Prix d’achat fiche article (repli)' }
  return { prix: null, origine: 'aucun prix d’achat SAGE' }
}

export default function PlanApproModal({ articles: articlesEntree, groupe, aujourdhui, retardMaxJours, onClose, onFiltrerRefs, catalogue = [] }: PlanApproModalProps) {
  const moisCourant = moisDe(aujourdhui)
  // Valorisation au prix d'achat (SAGE) : net fournisseur (tarif − remise) par défaut, PMP ou dernier prix d'achat au choix
  const [sourcePrix, setSourcePrix] = useState<SourcePrix>(() => { try { const v = localStorage.getItem('appro.plan.source_prix'); return v === 'pmp' || v === 'dernier' ? v : 'net' } catch { return 'net' } })
  useEffect(() => { try { localStorage.setItem('appro.plan.source_prix', sourcePrix) } catch { /* ignore */ } }, [sourcePrix])
  const [prixAchat, setPrixAchat] = useState<Map<string, PrixAchat> | null>(null)
  const refsEntree = useMemo(() => Array.from(new Set(articlesEntree.map((a) => cleRef(a.ref)))), [articlesEntree])
  useEffect(() => {
    let annule = false
    void (async () => {
      const m = new Map<string, PrixAchat>()
      for (let i = 0; i < refsEntree.length; i += 150) {
        const { data, error } = await supabase.from('mv_sage_articles_complet').select('reference, prix_net_fournisseur, dernier_prix_achat, pmp, prix_achat')
          .in('reference', refsEntree.slice(i, i + 150))
        if (error) { if (!annule) { setPrixAchat(new Map()); setMessage({ type: 'ko', texte: 'Prix d’achat SAGE (mv_sage_articles_complet) : ' + messageErreur(error) }) } return }
        ;((data || []) as { reference: string; prix_net_fournisseur: number | null; dernier_prix_achat: number | null; pmp: number | null; prix_achat: number | null }[]).forEach((r) => {
          m.set(cleRef(r.reference), { net: prixPositif(r.prix_net_fournisseur), dernier: prixPositif(r.dernier_prix_achat), pmp: prixPositif(r.pmp), ar: prixPositif(r.prix_achat) })
        })
      }
      if (!annule) setPrixAchat(m)
    })()
    return () => { annule = true }
  }, [refsEntree])
  const origineParRef = useMemo(() => new Map(articlesEntree.map((a) => [cleRef(a.ref), choisirPrix(prixAchat?.get(cleRef(a.ref)), sourcePrix)])), [articlesEntree, prixAchat, sourcePrix])
  const articles = useMemo<PlanArticle[]>(() => articlesEntree.map((a) => ({ ...a, prix: origineParRef.get(cleRef(a.ref))?.prix ?? null })), [articlesEntree, origineParRef])
  const [params, setParams] = useState<ScenarioParams>(() => paramsParDefaut(aujourdhui))
  const [plan, setPlan] = useState<Record<string, number>>({})
  const [hypotheses, setHypotheses] = useState<Record<string, number>>({})
  const [chainages, setChainages] = useState<Chainage[]>([])
  const [conso, setConso] = useState<Map<string, Map<string, number>>>(new Map())
  const [consoEtat, setConsoEtat] = useState<'chargement' | 'ok' | 'erreur'>('chargement')
  const [message, setMessage] = useState<{ type: 'ok' | 'ko'; texte: string } | null>(null)
  const [lecture, setLecture] = useState<Lecture>('stock')
  const [hypoParRef, setHypoParRef] = useState(false)
  const [voirChainages, setVoirChainages] = useState(false)
  const [voirDemande, setVoirDemande] = useState(true)
  const [refOuverte, setRefOuverte] = useState<string | null>(null)
  const [triRef, setTriRef] = useState<'rupture' | 'reference' | 'valeur'>('rupture')

  // scénarios
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [tablesOk, setTablesOk] = useState(true)
  const [scenarioId, setScenarioId] = useState<string>('')
  const [nomScenario, setNomScenario] = useState(groupe ? `Plan ${groupe.nom}` : '')
  const [descScenario, setDescScenario] = useState('')
  const [enregistrement, setEnregistrement] = useState(false)
  const [exportEnCours, setExportEnCours] = useState(false)

  const refsSelection = useMemo(() => articles.map((a) => cleRef(a.ref)), [articles])
  const designations = useMemo(() => {
    const m = new Map<string, string | null>()
    catalogue.forEach((c) => m.set(cleRef(c.ref), c.designation))
    articles.forEach((a) => m.set(cleRef(a.ref), a.designation))
    return m
  }, [catalogue, articles])
  const designationDe = useCallback((ref: string) => designations.get(cleRef(ref)) ?? null, [designations])
  // Remplacements paramétrés dans la Projection stock (suggestions de chaînage par référence cible)
  const [suggestions, setSuggestions] = useState<Map<string, SuggestionChainage[]>>(new Map())
  useEffect(() => {
    let annule = false
    void (async () => {
      const m = new Map<string, SuggestionChainage[]>()
      for (let i = 0; i < refsSelection.length; i += 100) {
        const { data, error } = await supabase.from('stock_article_substitutions').select('reference_source, reference_cible, pourcentage, actif, commentaire')
          .in('reference_cible', refsSelection.slice(i, i + 100))
        if (error) return
        ;((data || []) as { reference_source: string; reference_cible: string; pourcentage: number; actif: boolean | null; commentaire: string | null }[])
          .filter((r) => r.actif !== false).forEach((r) => {
            const c = cleRef(r.reference_cible), src = cleRef(r.reference_source)
            if (c === src) return
            const l = m.get(c) || []
            if (!l.some((x) => x.source === src)) l.push({ source: src, pct: Math.max(1, Math.min(100, Number(r.pourcentage) || 100)), commentaire: r.commentaire })
            m.set(c, l)
          })
      }
      if (!annule) setSuggestions(m)
    })()
    return () => { annule = true }
  }, [refsSelection])
  const horizon = useMemo(() => listeMois(moisCourant, params.moisFinHorizon), [moisCourant, params.moisFinHorizon])
  const fenetre = useMemo(() => new Set(listeMois(params.moisDebutAppro, params.moisFinAppro)), [params.moisDebutAppro, params.moisFinAppro])

  useEffect(() => { if (!message || message.type === 'ko') return; const t = setTimeout(() => setMessage(null), 6000); return () => clearTimeout(t) }, [message])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  // Historique : 24 mois clos (base N-1 / N-2) pour la sélection et les sources de chaînage
  const refsConso = useMemo(() => Array.from(new Set([...refsSelection, ...chainages.map((c) => cleRef(c.source))])).sort(), [refsSelection, chainages])
  useEffect(() => {
    let annule = false
    setConsoEtat('chargement')
    chargerConso(refsConso, ajouterMois(moisCourant, -24), ajouterMois(moisCourant, -1))
      .then((m) => { if (!annule) { setConso(m); setConsoEtat('ok') } })
      .catch((e) => { if (!annule) { setConsoEtat('erreur'); setMessage({ type: 'ko', texte: 'Historique de consommation : ' + messageErreur(e) }) } })
    return () => { annule = true }
  }, [refsConso, moisCourant])

  // Scénarios existants
  const chargerScenarios = useCallback(async () => {
    const { data, error } = await supabase.from('appro_plan_scenarios').select('*').order('updated_at', { ascending: false })
    if (error) { if (estTableAbsente(error)) setTablesOk(false); else setMessage({ type: 'ko', texte: 'Scénarios : ' + messageErreur(error) }); return [] as Scenario[] }
    const list = ((data || []) as Scenario[]).map((s) => ({ ...s, coef_defaut: Number(s.coef_defaut), couverture_cible_mois: Number(s.couverture_cible_mois) }))
    setScenarios(list)
    return list
  }, [])

  const chargerScenario = useCallback(async (s: Scenario, silencieux = false) => {
    setScenarioId(s.id); setNomScenario(s.nom); setDescScenario(s.description || '')
    setParams({
      moisDebutAppro: s.mois_debut_appro.slice(0, 10), moisFinAppro: s.mois_fin_appro.slice(0, 10), moisFinHorizon: s.mois_fin_horizon.slice(0, 10),
      baseDemande: s.base_demande, coefDefaut: Number(s.coef_defaut), couvertureCible: Number(s.couverture_cible_mois), inclureReserve: s.inclure_reserve,
    })
    const [l, h, c] = await Promise.all([
      supabase.from('appro_plan_lignes').select('reference_article, mois, qte').eq('scenario_id', s.id),
      supabase.from('appro_plan_hypotheses').select('reference_article, mois, coef').eq('scenario_id', s.id),
      supabase.from('appro_plan_chainages').select('reference_cible, reference_source, pourcentage, commentaire').eq('scenario_id', s.id),
    ])
    const err = l.error || h.error || c.error
    if (err) { setMessage({ type: 'ko', texte: 'Chargement du scénario : ' + messageErreur(err) }); return }
    const p: Record<string, number> = {}
    ;((l.data || []) as { reference_article: string; mois: string; qte: number }[]).forEach((r) => { p[clePlan(r.reference_article, r.mois.slice(0, 10))] = Number(r.qte) })
    const hy: Record<string, number> = {}
    ;((h.data || []) as { reference_article: string; mois: string; coef: number }[]).forEach((r) => { hy[cleHypo(r.reference_article, r.mois.slice(0, 10))] = Number(r.coef) })
    setPlan(p); setHypotheses(hy)
    setChainages(((c.data || []) as { reference_cible: string; reference_source: string; pourcentage: number; commentaire: string | null }[])
      .map((r) => ({ cible: cleRef(r.reference_cible), source: cleRef(r.reference_source), pct: Number(r.pourcentage), commentaire: r.commentaire })))
    setHypoParRef(Object.keys(hy).some((k) => !k.startsWith('*|')))
    const hors = s.references_articles.filter((r) => !refsSelection.includes(cleRef(r)))
    if (!silencieux) setMessage({ type: 'ok', texte: `Scénario « ${s.nom} » chargé.${hors.length ? ` ${hors.length} référence(s) du scénario hors de la sélection de l'écran.` : ''}` })
  }, [refsSelection])

  // Ouverture : scénario du groupe actif, sinon scénario dont les références correspondent
  useEffect(() => {
    void (async () => {
      const list = await chargerScenarios()
      const cle = [...refsSelection].sort().join('|')
      const s = (groupe && list.find((x) => x.groupe_id === groupe.id)) || list.find((x) => [...x.references_articles].map(cleRef).sort().join('|') === cle)
      if (s) await chargerScenario(s, true)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Calcul ───────────────────────────────────────────────────────────────
  const ctx = useMemo<ContexteProjection>(() => ({ aujourdhui, retardMaxJours, conso, chainages, hypotheses, plan, params }), [aujourdhui, retardMaxJours, conso, chainages, hypotheses, plan, params])
  const projections = useMemo(() => articles.map((a) => projeterArticle(a, ctx)), [articles, ctx])
  const agregat = useMemo(() => agreger(projections), [projections])

  const syntheses = useMemo(() => {
    const totalPlan = projections.reduce((s, p) => s + p.totalPlan, 0)
    const valeurPlan = projections.reduce((s, p) => s + (p.valeurPlan || 0), 0)
    const sansPrix = projections.filter((p) => p.article.prix === null).length
    const stockDepart = articles.reduce((s, a) => s + Math.max(0, a.stockBase), 0)
    const valeurDepart = articles.reduce((s, a) => s + (a.prix === null ? 0 : Math.max(0, a.stockBase) * a.prix), 0)
    const enRupture = projections.filter((p) => p.premiereRupture !== null)
    const finFenetre = agregat.find((m) => m.mois === params.moisFinAppro) || agregat[agregat.length - 1]
    const fin = agregat[agregat.length - 1]
    const pic = agregat.reduce<AgregatMois | null>((mx, m) => (!mx || m.valeurStock > mx.valeurStock ? m : mx), null)
    const parMoisPlan = listeMois(params.moisDebutAppro, params.moisFinAppro).map((m) => {
      const a = agregat.find((x) => x.mois === m)
      return { mois: m, qte: a?.plan || 0, valeur: a?.valeurPlan || 0 }
    })
    const encoursTotal = agregat.reduce((s, m) => s + m.encours, 0)
    const demandeTotale = agregat.reduce((s, m) => s + m.demande, 0)
    return { totalPlan, valeurPlan, sansPrix, stockDepart, valeurDepart, enRupture, finFenetre, fin, pic, parMoisPlan, encoursTotal, demandeTotale }
  }, [projections, articles, agregat, params.moisFinAppro, params.moisDebutAppro])

  const projectionsTriees = useMemo(() => {
    const l = [...projections]
    if (triRef === 'reference') return l.sort((a, b) => a.article.ref.localeCompare(b.article.ref))
    if (triRef === 'valeur') return l.sort((a, b) => (b.valeurPlan || 0) - (a.valeurPlan || 0))
    return l.sort((a, b) => (a.premiereRupture || '9999').localeCompare(b.premiereRupture || '9999') || a.stockMin - b.stockMin)
  }, [projections, triRef])

  // ── Actions ──────────────────────────────────────────────────────────────
  function setQtePlan(ref: string, mois: string, v: number | null) {
    setPlan((p) => { const n = { ...p }; const k = clePlan(ref, mois); if (v === null || v <= 0) delete n[k]; else n[k] = v; return n })
  }
  function setCoef(ref: string | '*', mois: string, pct: number | null) {
    setHypotheses((h) => { const n = { ...h }; const k = cleHypo(ref, mois); if (pct === null) delete n[k]; else n[k] = pct / 100; return n })
  }
  function appliquerCoefTousMois(pct: number) {
    setHypotheses((h) => { const n: Record<string, number> = {}; Object.entries(h).forEach(([k, v]) => { if (!k.startsWith('*|')) n[k] = v }); horizon.forEach((m) => { n[cleHypo('*', m)] = pct / 100 }); return n })
  }
  function proposerTout(seulementVides: boolean) {
    const n: Record<string, number> = { ...plan }
    let nb = 0
    articles.forEach((a) => {
      const aDuPlan = Array.from(fenetre).some((m) => (plan[clePlan(a.ref, m)] || 0) > 0)
      if (seulementVides && aDuPlan) return
      Object.keys(n).forEach((k) => { if (k.startsWith(`${cleRef(a.ref)}|`) && fenetre.has(k.split('|')[1])) delete n[k] })
      const p = proposerPlanArticle(a, { ...ctx, plan: n })
      Object.entries(p).forEach(([k, v]) => { n[k] = v })
      nb += 1
    })
    setPlan(n)
    setMessage({ type: 'ok', texte: `Proposition calculée pour ${nb} référence(s) : couverture cible ${fmtNum(params.couvertureCible, 1)} mois en fin de chaque mois de livraison, arrondie au colisage. Les quantités restent modifiables.` })
  }
  function proposerRef(a: PlanArticle) {
    const n: Record<string, number> = {}
    Object.entries(plan).forEach(([k, v]) => { if (!(k.startsWith(`${cleRef(a.ref)}|`) && fenetre.has(k.split('|')[1]))) n[k] = v })
    const p = proposerPlanArticle(a, { ...ctx, plan: n })
    setPlan({ ...n, ...p })
  }
  function effacerPlan(ref?: string) {
    if (!ref && !window.confirm('Effacer toutes les quantités du plan ?')) return
    setPlan((p) => { if (!ref) return {}; const n = { ...p }; Object.keys(n).forEach((k) => { if (k.startsWith(`${cleRef(ref)}|`)) delete n[k] }); return n })
  }
  function ajouterChainage() {
    const cible = articles[0]?.ref
    if (!cible) return
    setChainages((c) => [...c, { cible: cleRef(cible), source: '', pct: 100 }])
    setVoirChainages(true)
  }
  function ajouterChainageRef(cible: string, source: string, pct: number, commentaire?: string | null) {
    const c = cleRef(cible), src = cleRef(source)
    if (!src || c === src) return
    setChainages((l) => (l.some((x) => x.cible === c && x.source === src) ? l : [...l, { cible: c, source: src, pct, commentaire: commentaire ?? null }]))
  }
  function majChainage(cible: string, source: string, patch: Partial<Chainage>) {
    setChainages((l) => l.map((x) => (x.cible === cleRef(cible) && x.source === cleRef(source) ? { ...x, ...patch } : x)))
  }
  function retirerChainage(cible: string, source: string) {
    setChainages((l) => l.filter((x) => !(x.cible === cleRef(cible) && x.source === cleRef(source))))
  }
  async function importerRemplacements() {
    const { data, error } = await supabase.from('stock_article_substitutions').select('reference_source, reference_cible, pourcentage, actif, commentaire')
      .in('reference_cible', refsSelection).eq('actif', true)
    if (error) { setMessage({ type: 'ko', texte: 'Remplacements : ' + messageErreur(error) }); return }
    const rows = (data || []) as { reference_source: string; reference_cible: string; pourcentage: number; commentaire: string | null }[]
    let ajout = 0
    setChainages((c) => {
      const n = [...c]
      rows.forEach((r) => {
        const cible = cleRef(r.reference_cible), source = cleRef(r.reference_source)
        if (cible === source || n.some((x) => x.cible === cible && x.source === source)) return
        n.push({ cible, source, pct: Math.max(1, Math.min(100, Number(r.pourcentage) || 100)), commentaire: r.commentaire || 'Repris des remplacements de la projection stock' })
        ajout += 1
      })
      return n
    })
    setVoirChainages(true)
    setMessage({ type: 'ok', texte: rows.length ? `${rows.length} remplacement(s) actif(s) trouvé(s) dans la projection stock, ajout(s) au plan : ${ajout || 'déjà présents'}.` : 'Aucun remplacement actif vers ces références dans la projection stock.' })
  }

  async function enregistrer(commeNouveau: boolean) {
    const nom = nomScenario.trim()
    if (!nom) { setMessage({ type: 'ko', texte: 'Donne un nom au scénario.' }); return }
    const chainOk = chainages.filter((c) => c.source.trim() && c.cible.trim() && cleRef(c.source) !== cleRef(c.cible))
    setEnregistrement(true)
    try {
      const payload = {
        nom, description: descScenario.trim() || null, groupe_id: groupe?.id ?? null, references_articles: refsSelection,
        mois_debut_appro: params.moisDebutAppro, mois_fin_appro: params.moisFinAppro, mois_fin_horizon: params.moisFinHorizon,
        base_demande: params.baseDemande, coef_defaut: params.coefDefaut, couverture_cible_mois: params.couvertureCible, inclure_reserve: params.inclureReserve,
      }
      const res = scenarioId && !commeNouveau
        ? await supabase.from('appro_plan_scenarios').update(payload).eq('id', scenarioId).select('id').single()
        : await supabase.from('appro_plan_scenarios').insert(payload).select('id').single()
      if (res.error) throw res.error
      const id = (res.data as { id: string }).id
      const del = await Promise.all([
        supabase.from('appro_plan_lignes').delete().eq('scenario_id', id),
        supabase.from('appro_plan_hypotheses').delete().eq('scenario_id', id),
        supabase.from('appro_plan_chainages').delete().eq('scenario_id', id),
      ])
      const errDel = del.find((d) => d.error)?.error
      if (errDel) throw errDel
      const lignes = Object.entries(plan).filter(([, v]) => v > 0).map(([k, v]) => { const [ref, mois] = k.split('|'); return { scenario_id: id, reference_article: ref, mois, qte: v } })
      const hypos = Object.entries(hypotheses).map(([k, v]) => { const [ref, mois] = k.split('|'); return { scenario_id: id, reference_article: ref, mois, coef: v } })
      const chains = chainOk.map((c) => ({ scenario_id: id, reference_cible: cleRef(c.cible), reference_source: cleRef(c.source), pourcentage: c.pct, commentaire: c.commentaire || null }))
      for (const [table, rows] of [['appro_plan_lignes', lignes], ['appro_plan_hypotheses', hypos], ['appro_plan_chainages', chains]] as const) {
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await supabase.from(table).insert(rows.slice(i, i + 500))
          if (error) throw error
        }
      }
      setScenarioId(id)
      await chargerScenarios()
      setMessage({ type: 'ok', texte: `Scénario « ${nom} » enregistré : ${lignes.length} ligne(s) d'appro, ${hypos.length} hypothèse(s), ${chains.length} chaînage(s).` })
    } catch (e) {
      setMessage({ type: 'ko', texte: estTableAbsente(e) ? 'Tables du plan d’appro absentes : applique la migration 20261006_plan_appro_operation.sql.' : 'Enregistrement : ' + messageErreur(e) })
    } finally { setEnregistrement(false) }
  }

  async function supprimerScenario() {
    const s = scenarios.find((x) => x.id === scenarioId)
    if (!s || !window.confirm(`Supprimer le scénario « ${s.nom} » ?`)) return
    const { error } = await supabase.from('appro_plan_scenarios').delete().eq('id', s.id)
    if (error) { setMessage({ type: 'ko', texte: messageErreur(error) }); return }
    setScenarioId(''); await chargerScenarios()
    setMessage({ type: 'ok', texte: `Scénario « ${s.nom} » supprimé (le plan reste affiché, non enregistré).` })
  }

  async function exporterExcel() {
    setExportEnCours(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      wb.creator = 'Cegeclim by A3C'
      const entete = (ws: import('exceljs').Worksheet, titres: string[]) => {
        const r = ws.addRow(titres); r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        r.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111820' } } })
      }
      // Synthèse
      const s = wb.addWorksheet('Synthèse')
      s.addRow([`Plan d'appro — ${nomScenario || 'sans nom'}`]).font = { bold: true, size: 14 }
      s.addRow([`${articles.length} référence(s) · livraisons ${libMois(params.moisDebutAppro)} → ${libMois(params.moisFinAppro)} · horizon ${libMois(params.moisFinHorizon)} · base ${params.baseDemande === 'n1' ? 'ventes N-1' : 'conso moyenne retenue'} · valorisation ${LIB_SOURCE_PRIX[sourcePrix]} · coef par défaut ${fmtNum(params.coefDefaut * 100)} %`])
      s.addRow([])
      entete(s, ['Mois', 'Demande', 'dont ferme', 'Encours fournisseurs', 'Plan d’appro', 'Stock fin (positif)', 'Manque', 'Couverture (mois)', 'Valeur stock (€)', 'Valeur plan (€)', 'Réf. en rupture'])
      agregat.forEach((m) => s.addRow([libMois(m.mois), m.demande, m.ferme, m.encours, m.plan, m.stockFin, m.manque, m.couverture, m.valeurStock, m.valeurPlan, m.nbRupture]))
      s.columns.forEach((c, i) => { c.width = i === 0 ? 14 : 16 })
      // Plan (une ligne par référence, une colonne par mois de livraison)
      const fen = listeMois(params.moisDebutAppro, params.moisFinAppro)
      const p = wb.addWorksheet('Plan d’appro')
      entete(p, ['Référence', 'Désignation', 'Fournisseur', 'Colisage', 'Prix d’achat', 'Origine du prix', ...fen.map(libMois), 'Total qté', 'Total € (PA)'])
      projectionsTriees.forEach((pr) => {
        const q = fen.map((m) => plan[clePlan(pr.article.ref, m)] || null)
        p.addRow([pr.article.ref, pr.article.designation, pr.article.fournisseur, pr.article.colisage || null, pr.article.prix, origineParRef.get(cleRef(pr.article.ref))?.origine || '', ...q, pr.totalPlan, pr.valeurPlan])
      })
      p.columns.forEach((c, i) => { c.width = i === 1 ? 40 : 13 })
      p.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
      // Projection détaillée
      const d = wb.addWorksheet('Projection détaillée')
      entete(d, ['Référence', 'Ligne', ...horizon.map(libMois)])
      const lignesDetail: [string, (l: ProjectionArticle['mois'][number]) => number | null][] = [
        ['Base (N-1 / μ, chaînages)', (l) => l.base], ['Coef', (l) => l.coef], ['Demande', (l) => l.demande], ['dont ferme', (l) => l.ferme],
        ['Encours fournisseurs', (l) => l.encours], ['Plan d’appro', (l) => l.plan], ['Stock fin', (l) => l.stockFin], ['Couverture (mois)', (l) => l.couverture], ['Valeur stock (€)', (l) => l.valeurStock],
      ]
      projectionsTriees.forEach((pr) => {
        d.addRow([pr.article.ref, 'Ventes propres (N-1 / μ)', ...pr.mois.map((l) => l.propre)])
        chainages.filter((c) => c.cible === cleRef(pr.article.ref) && c.source.trim()).forEach((c) => {
          d.addRow(['', `↳ ${c.source} (${fmtNum(c.pct)} %)`, ...pr.mois.map((l) => l.apports.find((x) => x.source === c.source)?.qte ?? 0)]).font = { color: { argb: 'FF5B4387' } }
        })
        lignesDetail.forEach(([lib, f]) => {
          const r = d.addRow(['', lib, ...pr.mois.map(f)])
          if (lib === 'Stock fin') pr.mois.forEach((l, j) => { if (l.stockFin < 0) r.getCell(3 + j).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } } })
          if (lib === 'Plan d’appro') r.font = { bold: true, color: { argb: 'FF7A5EA8' } }
        })
      })
      d.columns.forEach((c, i) => { c.width = i === 0 ? 16 : i === 1 ? 24 : 10 })
      d.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }]
      // Hypothèses & chaînages
      const h = wb.addWorksheet('Hypothèses')
      entete(h, ['Portée', ...horizon.map(libMois)])
      h.addRow(['Toutes les références (%)', ...horizon.map((m) => Math.round((hypotheses[cleHypo('*', m)] ?? params.coefDefaut) * 100))])
      Array.from(new Set(Object.keys(hypotheses).filter((k) => !k.startsWith('*|')).map((k) => k.split('|')[0]))).forEach((ref) => {
        h.addRow([ref, ...horizon.map((m) => (hypotheses[cleHypo(ref, m)] === undefined ? null : Math.round(hypotheses[cleHypo(ref, m)] * 100)))])
      })
      h.addRow([]); entete(h, ['Chaînage : cible', 'Source', '% des ventes repris', 'Commentaire'])
      chainages.forEach((c) => h.addRow([c.cible, c.source, c.pct, c.commentaire || '']))
      h.columns.forEach((c, i) => { c.width = i === 0 ? 26 : 11 })

      const buffer = await wb.xlsx.writeBuffer()
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const lien = document.createElement('a'); lien.href = url
      lien.download = `Plan_appro_${(nomScenario || 'selection').replace(/[\\/:*?"<>|\s]+/g, '_')}_${aujourdhui}.xlsx`
      document.body.appendChild(lien); lien.click(); lien.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      setMessage({ type: 'ko', texte: 'Export Excel : ' + messageErreur(e) })
    } finally { setExportEnCours(false) }
  }

  // ── Données du graphique ────────────────────────────────────────────────
  const donneesGraphe = useMemo(() => agregat.map((m) => ({
    mois: libMois(m.mois), cle: m.mois,
    encours: m.encours, plan: m.plan, demande: -m.demande,
    stock: lecture === 'valeur' ? m.valeurStock : m.stockFin,
    manque: lecture === 'valeur' ? null : (m.manque > 0 ? -m.manque : null),
    couverture: m.couverture,
  })), [agregat, lecture])

  const ctl = 'h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-semibold text-[#3A362E] outline-none focus:border-[#B4761A]'
  const puce = (actif: boolean) => `h-7 rounded-full border px-2.5 text-[11.5px] font-semibold ${actif ? 'border-[#B4761A] bg-[#B4761A]/[0.1] text-[#8A5A08]' : 'border-[#E5E1D8] bg-white text-[#3A362E] hover:bg-[#F4F3F0]'}`
  const moisOptions = useMemo(() => listeMois(moisCourant, ajouterMois(moisCourant, 26)), [moisCourant])
  const thMois = (m: string) => `px-1.5 py-1 text-right font-bold ${fenetre.has(m) ? 'bg-[#EFE9F7] text-[#5B4387]' : ''}`
  const cellLecture = (l: ProjectionArticle['mois'][number]) => {
    if (lecture === 'couverture') return l.couverture === null ? '—' : fmtNum(l.couverture, 1)
    if (lecture === 'valeur') return l.valeurStock === null ? '—' : fmtK(l.valeurStock)
    return fmtNum(l.stockFin)
  }
  const tonStock = (l: ProjectionArticle['mois'][number]) => l.stockFin < 0 ? 'bg-red-50 text-red-700' : l.couverture !== null && l.couverture < 1 ? 'bg-orange-50 text-orange-700' : l.couverture !== null && l.couverture > params.couvertureCible * 2 ? 'text-sky-700' : 'text-[#111820]'

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-[#0B1220]/50 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex w-full max-w-[1900px] flex-col overflow-hidden rounded-2xl bg-[#F4F3F0] shadow-2xl" style={{ fontFeatureSettings: '"tnum"' }}>
        {/* En-tête */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[#E5E1D8] bg-white px-4 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A5EA8]">Calcul de besoin — simulation</p>
            <h2 className="text-[18px] font-bold leading-tight text-[#111820]">Plan d’appro & couverture de stock{groupe ? ` · ${groupe.nom}` : ''}</h2>
            <p className="text-[11.5px] text-[#8A8474]">{articles.length} référence{articles.length > 1 ? 's' : ''} · stock de départ = disponible SAGE du calcul de besoin · rien n’est écrit dans SAGE / BLG</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {tablesOk ? (
              <>
                <select value={scenarioId} onChange={(e) => { const s = scenarios.find((x) => x.id === e.target.value); if (s) void chargerScenario(s); else { setScenarioId(''); setNomScenario(groupe ? `Plan ${groupe.nom}` : '') } }} className={`${ctl} max-w-[220px]`}>
                  <option value="">Nouveau scénario</option>
                  {scenarios.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
                </select>
                <input value={nomScenario} onChange={(e) => setNomScenario(e.target.value)} placeholder="Nom du scénario" className={`${ctl} w-[200px]`} />
                <button type="button" onClick={() => void enregistrer(false)} disabled={enregistrement} className="h-8 rounded-md bg-[#111820] px-3 text-[12px] font-bold text-white hover:bg-[#252E3D] disabled:opacity-60">{enregistrement ? 'Enregistrement…' : scenarioId ? 'Enregistrer' : 'Enregistrer le scénario'}</button>
                {scenarioId && <button type="button" onClick={() => void enregistrer(true)} disabled={enregistrement} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]" title="Enregistrer sous un nouveau nom">Copie</button>}
                {scenarioId && <button type="button" onClick={() => void supprimerScenario()} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2 text-[12px] font-bold text-red-700 hover:bg-red-50" title="Supprimer le scénario">🗑</button>}
                {scenarioId && onFiltrerRefs && (() => { const s = scenarios.find((x) => x.id === scenarioId); return s && [...s.references_articles].sort().join('|') !== [...refsSelection].sort().join('|') ? <button type="button" onClick={() => onFiltrerRefs(s.references_articles, s.nom)} className="h-8 rounded-md border border-[#7A5EA8] bg-[#EFE9F7] px-2.5 text-[12px] font-bold text-[#5B4387]" title="Le scénario porte sur d'autres références : filtrer l'écran sur ses références">Sélection du scénario ({s.references_articles.length})</button> : null })()}
              </>
            ) : <span className="rounded-md bg-[#FFF4DC] px-2 py-1 text-[11.5px] font-semibold text-[#8A5A08]">Scénarios non enregistrables : migration 20261006_plan_appro_operation.sql à appliquer</span>}
            <button type="button" onClick={() => void exporterExcel()} disabled={exportEnCours || !articles.length} className="h-8 rounded-md border border-[#3F9142] bg-emerald-50 px-3 text-[12px] font-bold text-emerald-800 disabled:opacity-60">{exportEnCours ? 'Export…' : '⬇ Excel'}</button>
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-3 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]">Fermer</button>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 overflow-auto p-3">
          {/* Paramètres */}
          <section className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-xl border border-[#E5E1D8] bg-white px-3 py-2 text-[11.5px]">
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]">Livraisons de
              <select value={params.moisDebutAppro} onChange={(e) => setParams((p) => ({ ...p, moisDebutAppro: e.target.value, moisFinAppro: p.moisFinAppro < e.target.value ? e.target.value : p.moisFinAppro, moisFinHorizon: p.moisFinHorizon < e.target.value ? e.target.value : p.moisFinHorizon }))} className={ctl}>
                {moisOptions.map((m) => <option key={m} value={m}>{libMois(m)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]">à
              <select value={params.moisFinAppro} onChange={(e) => setParams((p) => ({ ...p, moisFinAppro: e.target.value, moisFinHorizon: p.moisFinHorizon < e.target.value ? e.target.value : p.moisFinHorizon }))} className={ctl}>
                {moisOptions.filter((m) => m >= params.moisDebutAppro).map((m) => <option key={m} value={m}>{libMois(m)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]">Projection jusqu’à
              <select value={params.moisFinHorizon} onChange={(e) => setParams((p) => ({ ...p, moisFinHorizon: e.target.value }))} className={ctl}>
                {moisOptions.filter((m) => m >= params.moisFinAppro).map((m) => <option key={m} value={m}>{libMois(m)}</option>)}
              </select>
            </label>
            <span className="h-8 w-px bg-[#E5E1D8]" />
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]" title="N-1 : ventes du même mois l'an dernier (N-2 au-delà de 12 mois), saisonnalité comprise. μ : conso moyenne retenue par le calcul de besoin, constante">Base de consommation
              <select value={params.baseDemande} onChange={(e) => setParams((p) => ({ ...p, baseDemande: e.target.value as 'n1' | 'mu' }))} className={ctl}>
                <option value="n1">Ventes N-1 du mois (saisonnalité)</option>
                <option value="mu">Conso moyenne retenue (μ)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]">Évolution vs base (tous mois)
              <span className="flex items-center gap-1">
                <CelluleSaisie valeur={Math.round(params.coefDefaut * 100)} onCommit={(v) => setParams((p) => ({ ...p, coefDefaut: (v ?? 100) / 100 }))} className="w-16 pr-4" suffixe="%" titre="Coefficient appliqué aux mois sans hypothèse (100 % = comme la base)" />
                <button type="button" onClick={() => appliquerCoefTousMois(Math.round(params.coefDefaut * 100))} className="h-6 rounded border border-[#E5E1D8] px-1.5 text-[10.5px] font-bold text-[#B4761A] hover:bg-[#FFF4DC]" title="Recopier ce coefficient sur tous les mois (efface les hypothèses mensuelles « toutes références »)">→ tous les mois</button>
              </span>
            </label>
            <label className="flex items-center gap-1.5 self-center font-semibold text-[#3A362E]" title="Le réservé SAGE daté (lignes de commandes clients en reliquat) sert de plancher à la demande du mois">
              <input type="checkbox" checked={params.inclureReserve} onChange={(e) => setParams((p) => ({ ...p, inclureReserve: e.target.checked }))} className="accent-[#B4761A]" /> Commandes clients fermes (plancher)
            </label>
            <span className="h-8 w-px bg-[#E5E1D8]" />
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]" title="Valorisation du stock et du plan au prix d'achat SAGE ; si le prix choisi manque, repli sur les autres prix d'achat (jamais le prix de vente)">Valorisation
              <select value={sourcePrix} onChange={(e) => setSourcePrix(e.target.value as SourcePrix)} className={ctl}>
                <option value="net">Prix d’achat net fournisseur</option>
                <option value="dernier">Dernier prix d’achat</option>
                <option value="pmp">PMP</option>
              </select>
            </label>
            <span className="h-8 w-px bg-[#E5E1D8]" />
            <label className="flex flex-col gap-0.5 font-semibold text-[#3A362E]">Couverture cible
              <CelluleSaisie valeur={params.couvertureCible} onCommit={(v) => setParams((p) => ({ ...p, couvertureCible: v ?? 3 }))} className="w-16 pr-7" suffixe="mois" titre="Stock visé en fin de chaque mois de livraison, en mois de demande des 3 mois suivants" />
            </label>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => proposerTout(false)} disabled={consoEtat !== 'ok'} className="h-8 rounded-md bg-[#7A5EA8] px-3 text-[12px] font-bold text-white hover:bg-[#6A4F96] disabled:opacity-50" title="Calcule pour chaque référence et chaque mois de livraison la quantité qui ramène le stock à la couverture cible (remplace les quantités de la fenêtre)">✦ Proposer le plan</button>
              <button type="button" onClick={() => proposerTout(true)} disabled={consoEtat !== 'ok'} className="h-8 rounded-md border border-[#7A5EA8] bg-white px-2.5 text-[12px] font-bold text-[#5B4387] disabled:opacity-50" title="Proposer seulement pour les références sans quantité saisie">… réf. sans saisie</button>
              <button type="button" onClick={() => effacerPlan()} className="h-8 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[12px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]">Effacer</button>
            </div>
          </section>

          {message && (
            <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[12px] font-semibold ${message.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
              <span>{message.texte}</span><button type="button" onClick={() => setMessage(null)} className="font-bold opacity-60">✕</button>
            </div>
          )}
          {consoEtat === 'chargement' && <div className="rounded-lg border border-[#E5E1D8] bg-white px-3 py-2 text-[12px] font-semibold text-[#8A8474]">Lecture des ventes des 24 derniers mois…</div>}

          {/* KPI */}
          <section className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <Kpi label="Stock de départ" value={fmtNum(syntheses.stockDepart)} sub={fmtEuro(syntheses.valeurDepart)} />
            <Kpi label="Encours fournisseurs" value={fmtNum(syntheses.encoursTotal)} sub="sur l’horizon" tone="ok" />
            <Kpi label="Demande projetée" value={fmtNum(syntheses.demandeTotale)} sub={`${libMois(moisCourant)} → ${libMois(params.moisFinHorizon)}`} tone="warn" />
            <Kpi label="Plan d’appro" value={fmtNum(syntheses.totalPlan)} sub={`${syntheses.parMoisPlan.filter((m) => m.qte > 0).length} livraison(s) mensuelle(s)`} tone="violet" />
            <Kpi label="Valeur du plan" value={fmtEuro(syntheses.valeurPlan)} sub={syntheses.sansPrix ? `${syntheses.sansPrix} réf. sans prix d’achat` : LIB_SOURCE_PRIX[sourcePrix]} tone="violet" />
            <Kpi label={`Stock fin ${syntheses.finFenetre ? libMois(syntheses.finFenetre.mois) : ''}`} value={fmtNum(syntheses.finFenetre?.stockFin)} sub={`${fmtNum(syntheses.finFenetre?.couverture, 1)} mois · ${fmtEuro(syntheses.finFenetre?.valeurStock)}`} />
            <Kpi label="Pic de valeur stock" value={fmtEuro(syntheses.pic?.valeurStock)} sub={syntheses.pic ? libMois(syntheses.pic.mois) : undefined} />
            <Kpi label={`Stock fin ${syntheses.fin ? libMois(syntheses.fin.mois) : ''}`} value={fmtNum(syntheses.fin?.stockFin)} sub={`${fmtNum(syntheses.fin?.couverture, 1)} mois · ${fmtEuro(syntheses.fin?.valeurStock)}`} />
            <Kpi label="Réf. en rupture" value={fmtNum(syntheses.enRupture.length)} sub={syntheses.enRupture.length ? `1re : ${libMois(syntheses.enRupture.map((p) => p.premiereRupture!).sort()[0])}` : 'aucune sur l’horizon'} tone={syntheses.enRupture.length ? 'alerte' : 'ok'} />
          </section>

          {/* Graphique */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-bold text-[#111820]">Projection mensuelle de la sélection</h3>
              <div className="ml-auto flex items-center gap-1">
                {(['stock', 'couverture', 'valeur'] as Lecture[]).map((l) => (
                  <button key={l} type="button" onClick={() => setLecture(l)} className={puce(lecture === l)}>{l === 'stock' ? 'Quantités' : l === 'couverture' ? 'Mois de couverture' : 'Valeur €'}</button>
                ))}
              </div>
            </div>
            <p className="mb-2 text-[11px] text-[#8A8474]">Barres : entrées (encours fournisseurs en vert, plan d’appro en violet) et demande (orange, vers le bas). Courbe : stock de fin de mois{lecture === 'valeur' ? ' en euros' : ''} ; pointillés verts : couverture en mois (axe de droite). Bande violette : fenêtre de livraison du plan. Un stock négatif (rupture) est reporté au mois suivant : la livraison suivante rattrape la demande non servie.</p>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={donneesGraphe} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 5" stroke="#E5E1D8" vertical={false} />
                  <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#8A8474' }} />
                  <YAxis yAxisId="q" tick={{ fontSize: 11, fill: '#8A8474' }} tickFormatter={(v: number) => (lecture === 'valeur' ? fmtK(v) : fmtNum(v))} width={64} />
                  <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11, fill: '#3F9142' }} tickFormatter={(v: number) => `${fmtNum(v, 0)} m`} width={44} />
                  {(() => {
                    const fen = listeMois(params.moisDebutAppro, params.moisFinAppro).filter((m) => horizon.includes(m))
                    return fen.length ? <ReferenceArea yAxisId="q" x1={libMois(fen[0])} x2={libMois(fen[fen.length - 1])} fill="#7A5EA8" fillOpacity={0.07} /> : null
                  })()}
                  <ReferenceLine yAxisId="q" y={0} stroke="#8A8474" />
                  <Tooltip
                    formatter={(v: unknown, nom: unknown) => {
                      const n = typeof v === 'number' ? v : Number(v)
                      const lib = String(nom)
                      if (lib === 'Couverture') return [`${fmtNum(n, 1)} mois`, lib]
                      if (lib === 'Stock fin' && lecture === 'valeur') return [fmtEuro(n), lib]
                      return [fmtNum(Math.abs(n)), lib]
                    }}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {lecture !== 'valeur' && <Bar yAxisId="q" dataKey="encours" name="Encours fournisseurs" stackId="e" fill="#A9D3A0" />}
                  {lecture !== 'valeur' && <Bar yAxisId="q" dataKey="plan" name="Plan d’appro" stackId="e" fill="#7A5EA8" />}
                  {lecture !== 'valeur' && voirDemande && <Bar yAxisId="q" dataKey="demande" name="Demande" fill="#F0C4A8" />}
                  {lecture !== 'valeur' && <Bar yAxisId="q" dataKey="manque" name="Manque (réf. en rupture)" fill="#B42318" />}
                  <Line yAxisId="q" type="monotone" dataKey="stock" name="Stock fin" stroke="#111820" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line yAxisId="c" type="monotone" dataKey="couverture" name="Couverture" stroke="#3F9142" strokeDasharray="5 4" strokeWidth={2} dot={false} hide={lecture === 'valeur'} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Hypothèses & chaînages */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-bold text-[#111820]">Hypothèses de consommation</h3>
              <span className="text-[11px] text-[#8A8474]">% de la base ({params.baseDemande === 'n1' ? 'ventes du même mois N-1, ou N-2 au-delà de 12 mois' : 'conso moyenne retenue'}) — vide = {fmtNum(params.coefDefaut * 100)} %</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setHypoParRef((v) => !v)} className={puce(hypoParRef)}>Hypothèses par référence</button>
                <button type="button" onClick={() => setVoirDemande((v) => !v)} className={puce(voirDemande)}>Voir la demande</button>
                <button type="button" onClick={() => setVoirChainages((v) => !v)} className={puce(voirChainages || chainages.length > 0)}>Chaînages ({chainages.length}) {voirChainages ? '▴' : '▾'}</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[11.5px]">
                <thead><tr className="text-[10px] uppercase tracking-wide text-[#8A8474]">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left">Mois</th>
                  {horizon.map((m) => <th key={m} className={thMois(m)}>{libMois(m)}</th>)}
                </tr></thead>
                <tbody>
                  <tr>
                    <td className="sticky left-0 z-10 bg-white px-2 py-1 font-bold text-[#3A362E]">Toutes les réf. (%)</td>
                    {horizon.map((m) => (
                      <td key={m} className="px-0.5 py-0.5 text-right">
                        <CelluleSaisie valeur={hypotheses[cleHypo('*', m)] === undefined ? null : Math.round(hypotheses[cleHypo('*', m)] * 100)} placeholder={String(Math.round(params.coefDefaut * 100))}
                          onCommit={(v) => setCoef('*', m, v)} className="w-12" />
                      </td>
                    ))}
                  </tr>
                  <tr className="text-[#8A8474]">
                    <td className="sticky left-0 z-10 bg-white px-2 py-1">Base de la sélection</td>
                    {horizon.map((m, i) => <td key={m} className="px-1.5 py-1 text-right tabular-nums" title={params.baseDemande === 'n1' ? `Ventes de ${libMois(moisHistorique(m, moisCourant))}` : 'μ retenu'}>{fmtNum(projections.reduce((s, p) => s + (p.mois[i]?.base || 0), 0))}</td>)}
                  </tr>
                  <tr className="font-bold text-[#B4761A]">
                    <td className="sticky left-0 z-10 bg-white px-2 py-1">Demande retenue</td>
                    {agregat.map((m) => <td key={m.mois} className="px-1.5 py-1 text-right tabular-nums" title={`Prévision ${fmtNum(m.prevision)} · dont commandes fermes ${fmtNum(m.ferme)}`}>{fmtNum(m.demande)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>

            {voirChainages && (
              <div className="mt-3 border-t border-[#EFECE4] pt-2">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-[#3A362E]">Chaînages de références</span>
                  <span className="text-[11px] text-[#8A8474]">La cible récupère X % des ventes passées de la source ; la source perd ces X % de sa propre prévision (pas de double compte).</span>
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" onClick={() => void importerRemplacements()} className="h-7 rounded-md border border-[#E5E1D8] bg-white px-2.5 text-[11.5px] font-bold text-[#3A362E] hover:bg-[#F4F3F0]" title="Reprendre les remplacements actifs paramétrés dans la Projection stock (stock_article_substitutions)">⇩ Remplacements de la projection stock</button>
                    <button type="button" onClick={ajouterChainage} className="h-7 rounded-md bg-[#111820] px-2.5 text-[11.5px] font-bold text-white">+ Chaînage</button>
                  </div>
                </div>
                {chainages.length === 0 ? <div className="text-[11.5px] text-[#8A8474]">Aucun chaînage.</div> : (
                  <table className="text-[11.5px]">
                    <thead><tr className="text-[10px] uppercase tracking-wide text-[#8A8474]"><th className="px-2 py-1 text-left">Cible (récupère)</th><th className="px-2 py-1 text-left">Source (ventes passées)</th><th className="px-2 py-1 text-right">%</th><th className="px-2 py-1 text-right">Ventes source 12 m</th><th className="px-2 py-1 text-left">Commentaire</th><th /></tr></thead>
                    <tbody>
                      {chainages.map((c, i) => {
                        const v12 = (() => { const m = conso.get(cleRef(c.source)); if (!m) return null; let s = 0; for (let k = 1; k <= 12; k += 1) s += m.get(ajouterMois(moisCourant, -k)) || 0; return s })()
                        return (
                          <tr key={`${i}|${c.cible}|${c.source}`}>
                            <td className="px-1 py-0.5">
                              <select value={c.cible} onChange={(e) => setChainages((l) => l.map((x, j) => (j === i ? { ...x, cible: e.target.value } : x)))} className="h-7 rounded border border-[#E5E1D8] bg-white px-1 font-semibold">
                                {articles.map((a) => <option key={a.ref} value={cleRef(a.ref)}>{a.ref}</option>)}
                              </select>
                            </td>
                            <td className="px-1 py-0.5"><input defaultValue={c.source} onBlur={(e) => { const v = cleRef(e.target.value); setChainages((l) => l.map((x, j) => (j === i ? { ...x, source: v } : x))) }} placeholder="Référence source" className="h-7 w-40 rounded border border-[#E5E1D8] px-1.5 font-semibold uppercase" /></td>
                            <td className="px-1 py-0.5 text-right"><CelluleSaisie valeur={c.pct} onCommit={(v) => setChainages((l) => l.map((x, j) => (j === i ? { ...x, pct: Math.max(1, Math.min(100, v ?? 100)) } : x)))} className="w-14 pr-4" suffixe="%" /></td>
                            <td className="px-2 py-0.5 text-right tabular-nums text-[#8A8474]">{c.source ? (v12 === null ? (consoEtat === 'chargement' ? '…' : 'aucune vente') : fmtNum(v12)) : ''}</td>
                            <td className="px-1 py-0.5"><input defaultValue={c.commentaire || ''} onBlur={(e) => { const v = e.target.value; setChainages((l) => l.map((x, j) => (j === i ? { ...x, commentaire: v } : x))) }} className="h-7 w-64 rounded border border-[#E5E1D8] px-1.5" /></td>
                            <td className="px-1 py-0.5"><button type="button" onClick={() => setChainages((l) => l.filter((_, j) => j !== i))} className="font-bold text-red-700">✕</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </section>

          {/* Plan par référence */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <h3 className="text-[13px] font-bold text-[#111820]">Plan d’appro par référence</h3>
              <span className="text-[11px] text-[#8A8474]">Saisie dans les mois violets (une livraison par mois). « ▸ Demande » : ventes N-1, références chaînées (ajout, %), coefficient, commandes fermes. Ligne 2 : {lecture === 'stock' ? 'stock de fin de mois' : lecture === 'couverture' ? 'couverture en mois' : 'valeur du stock'} — rouge : rupture, orange : moins d’un mois, bleu : plus de 2 × la cible.</span>
              <div className="ml-auto flex items-center gap-1">
                {(['stock', 'couverture', 'valeur'] as Lecture[]).map((l) => (
                  <button key={l} type="button" onClick={() => setLecture(l)} className={puce(lecture === l)}>{l === 'stock' ? 'Qté' : l === 'couverture' ? 'Mois' : '€'}</button>
                ))}
                <select value={triRef} onChange={(e) => setTriRef(e.target.value as typeof triRef)} className={`${ctl} h-7`}>
                  <option value="rupture">Tri : 1re rupture</option><option value="reference">Tri : référence</option><option value="valeur">Tri : valeur du plan</option>
                </select>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto border-t border-[#E5E1D8]">
              <table className="w-full border-separate border-spacing-0 text-[11.5px]">
                <thead className="sticky top-0 z-20 bg-[#F4F3F0] text-[10px] uppercase tracking-wide text-[#8A8474]">
                  <tr>
                    <th className="sticky left-0 z-30 min-w-[230px] bg-[#F4F3F0] px-2 py-1.5 text-left">Référence</th>
                    <th className="px-1.5 py-1.5 text-left">Ligne</th>
                    {horizon.map((m) => <th key={m} className={thMois(m)}>{libMois(m)}</th>)}
                    <th className="px-2 py-1.5 text-right">Plan</th>
                    <th className="px-2 py-1.5 text-right">Valeur</th>
                  </tr>
                  <tr className="bg-[#111820] text-white">
                    <td className="sticky left-0 z-30 bg-[#111820] px-2 py-1 font-bold normal-case">Total sélection</td>
                    <td className="px-1.5 py-1 normal-case">Plan</td>
                    {agregat.map((m) => <td key={m.mois} className={`px-1.5 py-1 text-right font-bold tabular-nums ${fenetre.has(m.mois) ? 'text-[#D9C6F2]' : 'text-white/40'}`}>{m.plan ? fmtNum(m.plan) : ''}</td>)}
                    <td className="px-2 py-1 text-right font-bold">{fmtNum(syntheses.totalPlan)}</td>
                    <td className="px-2 py-1 text-right font-bold">{fmtK(syntheses.valeurPlan)}</td>
                  </tr>
                  <tr className="bg-[#252E3D] text-white">
                    <td className="sticky left-0 z-30 bg-[#252E3D] px-2 py-1 normal-case" />
                    <td className="px-1.5 py-1 normal-case">{lecture === 'stock' ? 'Stock fin' : lecture === 'couverture' ? 'Couverture' : 'Valeur stock'}</td>
                    {agregat.map((m) => <td key={m.mois} className={`px-1.5 py-1 text-right font-bold tabular-nums ${m.nbRupture ? 'text-red-300' : ''}`} title={m.nbRupture ? `${m.nbRupture} réf. en rupture · manque ${fmtNum(m.manque)}` : undefined}>{lecture === 'stock' ? fmtNum(m.stockFin) : lecture === 'couverture' ? fmtNum(m.couverture, 1) : fmtK(m.valeurStock)}</td>)}
                    <td colSpan={2} />
                  </tr>
                </thead>
                <tbody>
                  {projectionsTriees.map((pr) => {
                    const a = pr.article
                    const ouverte = refOuverte === a.ref
                    const chainesRef = chainages.filter((c) => c.cible === cleRef(a.ref) && c.source.trim())
                    const pctCede = pr.mois[0]?.pctCede || 0
                    const afficheDemande = voirDemande || ouverte
                    const nbDetail = ouverte ? 1 + chainesRef.length + (chainesRef.length || pctCede ? 1 : 0) + 3 + 1 : 0
                    const n1 = params.baseDemande === 'n1'
                    return (
                      <React.Fragment key={a.ref}>
                        <tr className="bg-white">
                          <td rowSpan={2 + (afficheDemande ? 1 : 0) + (hypoParRef ? 1 : 0) + nbDetail} className="sticky left-0 z-10 border-t border-[#E5E1D8] bg-white px-2 py-1 align-top">
                            <button type="button" onClick={() => setRefOuverte(ouverte ? null : a.ref)} className="text-left">
                              <div className="font-bold text-[#111820] hover:underline">{a.ref}</div>
                              <div className="max-w-[220px] truncate text-[10.5px] text-[#8A8474]" title={a.designation || ''}>{a.designation || '—'}</div>
                            </button>
                            <div className="mt-0.5 text-[10px] text-[#8A8474]">
                              Stock {fmtNum(a.stockBase)} · μ {fmtNum(a.mu, 1)}{a.colisage > 1 ? ` · colis ${a.colisage}` : ''}
                              <span title={`Valorisation : ${origineParRef.get(cleRef(a.ref))?.origine || '—'}`} className={a.prix === null ? 'text-red-700' : ''}>{a.prix !== null ? ` · PA ${fmtNum(a.prix, 2)} €` : prixAchat ? ' · sans prix d’achat' : ' · PA …'}</span>
                            </div>
                            {pr.repriseChainage > 0 && <div className="text-[10px] font-semibold text-[#5B4387]">+ {fmtNum(pr.repriseChainage)} repris de {chainesRef.length} réf. chaînée{chainesRef.length > 1 ? 's' : ''}</div>}
                            {pctCede > 0 && <div className="text-[10px] font-semibold text-orange-700">{fmtNum(pctCede)} % de ses ventes repris par une autre réf.</div>}
                            <div className="mt-0.5 flex gap-2 text-[10.5px] font-bold">
                              <button type="button" onClick={() => proposerRef(a)} className="text-[#7A5EA8] hover:underline">✦ proposer</button>
                              <button type="button" onClick={() => effacerPlan(a.ref)} className="text-[#8A8474] hover:underline">effacer</button>
                              {pr.premiereRupture && <span className="text-red-700">rupture {libMois(pr.premiereRupture)}</span>}
                            </div>
                          </td>
                          <td className="border-t border-[#E5E1D8] px-1.5 py-0.5 font-semibold text-[#5B4387]">Appro</td>
                          {pr.mois.map((l) => (
                            <td key={l.mois} className={`border-t border-[#E5E1D8] px-0.5 py-0.5 text-right ${fenetre.has(l.mois) ? 'bg-[#F6F2FB]' : ''}`}>
                              {fenetre.has(l.mois)
                                ? <CelluleSaisie valeur={plan[clePlan(a.ref, l.mois)] ?? null} onCommit={(v) => setQtePlan(a.ref, l.mois, v)} className="w-14 font-bold text-[#5B4387]" />
                                : l.plan > 0 ? <span className="pr-1 font-bold text-[#5B4387]">{fmtNum(l.plan)}</span> : l.encours > 0 ? <span className="pr-1 text-[10.5px] text-emerald-700" title="Encours fournisseurs">+{fmtNum(l.encours)}</span> : null}
                            </td>
                          ))}
                          <td className="border-t border-[#E5E1D8] px-2 py-0.5 text-right font-bold text-[#5B4387]">{pr.totalPlan ? fmtNum(pr.totalPlan) : ''}</td>
                          <td className="border-t border-[#E5E1D8] px-2 py-0.5 text-right">{pr.valeurPlan ? fmtK(pr.valeurPlan) : ''}</td>
                        </tr>
                        <tr>
                          <td className="px-1.5 py-0.5 text-[#3A362E]">{lecture === 'stock' ? 'Stock fin' : lecture === 'couverture' ? 'Couv. (mois)' : 'Valeur'}</td>
                          {pr.mois.map((l) => <td key={l.mois} className={`px-1.5 py-0.5 text-right font-semibold tabular-nums ${tonStock(l)}`} title={`Stock fin ${fmtNum(l.stockFin)} · couverture ${fmtNum(l.couverture, 1)} mois · ${fmtEuro(l.valeurStock)}`}>{cellLecture(l)}</td>)}
                          <td colSpan={2} className="px-2 text-right text-[10.5px] text-[#8A8474]">min {fmtNum(pr.stockMin)}</td>
                        </tr>
                        {afficheDemande && (
                          <tr className="text-[#B4761A]">
                            <td className="px-1.5 py-0.5">
                              <button type="button" onClick={() => setRefOuverte(ouverte ? null : a.ref)} className="font-semibold hover:underline" title="Détail de la demande : ventes N-1, références chaînées, coefficient, commandes fermes">
                                {ouverte ? '▾' : '▸'} Demande{chainesRef.length ? ` (+${chainesRef.length})` : ''}
                              </button>
                            </td>
                            {pr.mois.map((l) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums" title={`Base ${fmtNum(l.base)} × ${fmtNum(l.coef * 100)} % = ${fmtNum(l.prevision)} · commandes fermes ${fmtNum(l.ferme)}`}>{fmtNum(l.demande)}{l.ferme > l.prevision ? <sup className="text-[#B42318]">f</sup> : null}</td>)}
                            <td colSpan={2} />
                          </tr>
                        )}
                        {hypoParRef && (
                          <tr>
                            <td className="px-1.5 py-0.5 text-[#8A8474]">Coef %</td>
                            {pr.mois.map((l) => (
                              <td key={l.mois} className="px-0.5 py-0.5 text-right">
                                <CelluleSaisie valeur={hypotheses[cleHypo(a.ref, l.mois)] === undefined ? null : Math.round(hypotheses[cleHypo(a.ref, l.mois)] * 100)}
                                  placeholder={String(Math.round(l.coef * 100))} onCommit={(v) => setCoef(a.ref, l.mois, v)} className="w-12 text-[#8A5A08]" />
                              </td>
                            ))}
                            <td colSpan={2} />
                          </tr>
                        )}
                        {ouverte && (
                          <>
                            <tr className="bg-[#FFFBF3] text-[10.5px] text-[#3A362E]">
                              <td className="px-1.5 py-0.5" title={n1 ? 'Ventes de la référence le même mois l’an dernier (N-2 au-delà de 12 mois)' : 'Conso moyenne retenue par le calcul de besoin'}>
                                {n1 ? 'Ventes N-1' : 'μ retenu'} {a.ref}{pctCede > 0 ? <span className="text-orange-700"> (−{fmtNum(pctCede)} %)</span> : null}
                              </td>
                              {pr.mois.map((l) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums" title={n1 ? `Ventes de ${libMois(l.histo)}` : undefined}>{fmtNum(l.propre)}</td>)}
                              <td colSpan={2} />
                            </tr>
                            {chainesRef.map((c) => (
                              <tr key={c.source} className="bg-[#FAF7FD] text-[10.5px] text-[#5B4387]">
                                <td className="px-1.5 py-0.5">
                                  <div className="flex items-center gap-1">
                                    <span className="font-bold" title={designationDe(c.source) || c.commentaire || ''}>↳ {c.source}</span>
                                    <CelluleSaisie valeur={c.pct} onCommit={(v) => majChainage(a.ref, c.source, { pct: Math.max(1, Math.min(100, v ?? 100)) })} className="w-12 pr-4" suffixe="%" titre="Part des ventes passées de cette référence intégrée à la demande" />
                                    <button type="button" onClick={() => retirerChainage(a.ref, c.source)} className="font-bold text-red-700" title="Retirer le chaînage">✕</button>
                                  </div>
                                  {designationDe(c.source) && <div className="max-w-[170px] truncate text-[9.5px] text-[#8A8474]">{designationDe(c.source)}</div>}
                                </td>
                                {pr.mois.map((l) => {
                                  const ap = l.apports.find((x) => x.source === c.source)
                                  return (
                                    <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums" title={ap ? `${n1 ? `Ventes ${libMois(l.histo)}` : 'μ 12 mois'} : ${fmtNum(ap.qte)} × ${fmtNum(ap.pct)} % = ${fmtNum(ap.apport, 1)} intégrés` : undefined}>
                                      <span className="text-[#8A8474]">{ap ? fmtNum(ap.qte) : consoEtat === 'chargement' ? '…' : '0'}</span>
                                      {ap && ap.pct < 100 && ap.qte > 0 ? <span className="ml-1 font-semibold">→{fmtNum(ap.apport)}</span> : null}
                                    </td>
                                  )
                                })}
                                <td colSpan={2} className="px-2 text-right text-[10px] text-[#8A8474]">{fmtNum(pr.mois.reduce((s2, l) => s2 + (l.apports.find((x) => x.source === c.source)?.apport || 0), 0))} intégrés</td>
                              </tr>
                            ))}
                            {(chainesRef.length > 0 || pctCede > 0) && (
                              <tr className="bg-[#FFFBF3] text-[10.5px] font-bold text-[#3A362E]">
                                <td className="px-1.5 py-0.5">= Base retenue</td>
                                {pr.mois.map((l) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums">{fmtNum(l.base)}</td>)}
                                <td colSpan={2} />
                              </tr>
                            )}
                            <tr className="bg-[#FFFBF3] text-[10.5px] text-[#3A362E]">
                              <td className="px-1.5 py-0.5">× coef → prévision</td>
                              {pr.mois.map((l, i) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums" title={`${fmtNum(l.base)} × ${fmtNum(l.coef * 100)} %${i === 0 ? ' au prorata des jours restants du mois' : ''} = ${fmtNum(l.prevision)}`}>{fmtNum(l.prevision)}<span className="ml-1 text-[9px] text-[#8A8474]">{fmtNum(l.coef * 100)}%</span></td>)}
                              <td colSpan={2} />
                            </tr>
                            <tr className="bg-[#FFFBF3] text-[10.5px] text-[#B42318]">
                              <td className="px-1.5 py-0.5" title="Réservé SAGE daté : plancher de la demande du mois (demande = le plus grand des deux)">Commandes fermes</td>
                              {pr.mois.map((l) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums">{l.ferme ? fmtNum(l.ferme) : ''}</td>)}
                              <td colSpan={2} />
                            </tr>
                            <tr className="text-[10.5px] text-emerald-700">
                              <td className="px-1.5 py-0.5">Encours fournisseurs</td>
                              {pr.mois.map((l) => <td key={l.mois} className="px-1.5 py-0.5 text-right tabular-nums">{l.encours ? fmtNum(l.encours) : ''}</td>)}
                              <td colSpan={2} />
                            </tr>
                            <tr className="bg-[#FAF7FD]">
                              <td colSpan={horizon.length + 3} className="px-1.5">
                                <AjoutChainage cible={cleRef(a.ref)} dejaChainees={new Set(chainesRef.map((c) => c.source))} suggestions={suggestions.get(cleRef(a.ref)) || []}
                                  catalogue={catalogue} designationDe={designationDe} onAjouter={(src, pct, com) => ajouterChainageRef(a.ref, src, pct, com)} />
                              </td>
                            </tr>
                          </>
                        )}
                      </React.Fragment>
                    )
                  })}
                  {articles.length === 0 && <tr><td colSpan={horizon.length + 4} className="px-3 py-8 text-center text-[#8A8474]">Aucune référence dans la sélection.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {/* Récapitulatif des commandes mensuelles */}
          <section className="rounded-xl border border-[#E5E1D8] bg-white p-3">
            <h3 className="mb-1.5 text-[13px] font-bold text-[#111820]">Commandes mensuelles à passer</h3>
            <div className="flex flex-wrap gap-1.5">
              {syntheses.parMoisPlan.map((m) => (
                <div key={m.mois} className={`min-w-[120px] rounded-lg border px-3 py-1.5 ${m.qte ? 'border-[#7A5EA8] bg-[#F6F2FB]' : 'border-[#E5E1D8]'}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[#5B4387]">Livraison {libMois(m.mois)}</div>
                  <div className="text-[15px] font-bold tabular-nums text-[#111820]">{fmtNum(m.qte)} p.</div>
                  <div className="text-[11px] text-[#8A8474]">{fmtEuro(m.valeur)} · {projections.filter((p) => (plan[clePlan(p.article.ref, m.mois)] || 0) > 0).length} réf.</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
