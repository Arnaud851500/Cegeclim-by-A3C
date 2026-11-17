'use client'

/**
 * Écran « Suivi agences / commerciaux » (bloc « Mes agences / Mes commerciaux »,
 * /suivi-agences). Créé le 09/10/2026.
 *
 * - Vue Agences (dépliables pour voir leurs collaborateurs) ou vue Collaborateurs.
 * - Filtres multi-sélection Agences / Collaborateurs / Familles macro, rangés
 *   dans une barre compacte ; variantes de sélection enregistrables par
 *   utilisateur (une par défaut) — table user_filtres_variantes.
 * - Liste : CA facturé N-1, N à date, évolution vs N-1, évolution par
 *   trimestre, marge, écart à l'entreprise, positionnement.
 * - Croix de positionnement vs N-1 avec trajectoire trimestre par trimestre
 *   (logique « Point commerce » : ça va / ça va pas, ça va mieux / se dégrade).
 * - Clic sur une ligne ou une bulle : fiche détaillée (components/suivi-agences/FicheDetail).
 *
 * Sources : RPC get_suivi_agences_data (RLS appliquée), get_suivi_agences_reference
 * (entreprise hors exclusions), get_suivi_objectifs, get_suivi_profil_clients,
 * get_suivi_impayes (objectif « Zéro impayé > 45 j », ajout du 11/10/2026) —
 * migration supabase/migrations/20261009_suivi_agences_commerciaux.sql.
 * URL : ?vue=collaborateurs, ?fiche=A:ANGLET ou ?fiche=C:BRPAROUTOT.
 *
 * Bilan commercial 2026 (15/10/2026, demandé par Arnaud) — migration
 * 20261015_bilan_commercial_2026_objectifs_creations.sql :
 *   - objectifs de CA par agence / collaborateur / entreprise repris du bilan
 *     (collaborateurs sans compte : périmètre « collaborateur » au code SAGE) ;
 *   - objectif à date = objectif annuel × cumul de la répartition mensuelle du
 *     bilan (saisonnalité de l'année passée) jusqu'au dernier mois clos ;
 *     colonnes « Obj. à date » et « Réal. / obj. », KPI global vs objectif ;
 *   - créations de comptes clients (bilan, complété par les fiches SAGE au-delà
 *     du dernier mois du bilan) : colonne et KPI, comparées à N-1 au prorata.
 *
 * 17/11/2026 (demandé par Arnaud) :
 *   - agence avec contrats d'objectifs : son CA = CA des seuls collaborateurs sous
 *     contrat (ex. ANGLET = AACHATO + AALARTEGUY + AAMENA) ; les autres
 *     collaborateurs de l'agence sont regroupés sur une ligne « <AGENCE> · hors
 *     contrats ». Objectif de l'agence = objectif « CA agence » d'un contrat s'il
 *     existe, sinon somme des objectifs CA perso (RPC get_suivi_contrats) ;
 *     collaborateur sous contrat = objectif de son contrat (aucun s'il est sur le
 *     CA agence) ; sans contrat, objectif du bilan commercial comme avant ;
 *   - fiche : calculée sur toutes les lignes de l'entité, indépendamment des
 *     filtres Agences / Collaborateurs du tableau (une fiche affichait 0 €) ;
 *   - tableau : montants en k€ / M€, zones CA / Marge / Transfo devis /
 *     Comptes / Position, « Obj. à date » après le CA à date, « Évol. vs N-1 »
 *     puis « Réal. / obj. » ; marge : écart vs N-1 et vs entreprise ; taux de
 *     transformation des devis à 60 j (RPC get_suivi_transfo_devis) avec écarts
 *     vs N-1 et vs entreprise ; croix de positionnement fermée par défaut.
 *
 * 17/11/2026 (suite, demandé par Arnaud) :
 *   - en-têtes de colonnes et colonne Agence / collaborateur figés (le tableau
 *     défile dans son propre cadre, comme des volets figés Excel) ;
 *   - vue Agences : toutes les lignes « · hors contrats » sont regroupées en une
 *     seule ligne « Hors contrats » placée en fin de liste, quel que soit le tri ;
 *     son développement liste directement les collaborateurs, avec leur agence
 *     en abrégé (ex. « ANBERTHELOT Nicolas sommeil (Mér.) »), sans passer par
 *     un sous-niveau par agence.
 *
 * Droits (13/10/2026) : écran ouvert par can_suivi_agences (profil). Le
 * périmètre agences / collaborateurs de la personne (user_page_access) est
 * appliqué côté base par suivi_perimetre() dans chaque RPC — migration
 * 20261013_suivi_agences_droit_perimetre.sql. L'écran se contente d'afficher
 * ce périmètre, de refuser une fiche hors périmètre ouverte par URL et de
 * masquer les montants de la référence entreprise (le % reste affiché).
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import MultiSelect from '@/components/suivi-agences/MultiSelect'
import VariantesMenu, { useVariantes, type Variante } from '@/components/suivi-agences/VariantesMenu'
import PositionCross, { type CrossPoint } from '@/components/suivi-agences/PositionCross'
import FicheDetail from '@/components/suivi-agences/FicheDetail'
import {
  DYNAMIQUE_LIBELLES,
  FAMILLES_LIBELLES,
  MOIS_LONGS,
  QUADRANT_LIBELLES,
  addToSerie,
  emptySerie,
  evolPct,
  fmtEuro,
  fmtK,
  fmtPct,
  fmtPts,
  normAgence,
  creationsPour,
  impayesPourCodes,
  objectifsPourEntite,
  parseCreations,
  parseImpayes,
  parseRepartition,
  partAnneeEcoulee,
  partObjectifADate,
  parseDataRows,
  parseRefRows,
  positionsTrimestrielles,
  quadrantOf,
  sumMonths,
  tauxMarge,
  toneOf,
  type Collaborateur,
  type Commercial,
  type CreationsData,
  type CreationsEntite,
  type Repartition,
  type DataRow,
  type ImpayesData,
  type Entity,
  type Objectif,
  type ObjectifsEntite,
  type RefRow,
  type Serie,
} from '@/lib/suiviAgences'

const ECRAN = 'suivi-agences'

type Vue = 'agences' | 'collaborateurs'

type Filtres = {
  agences: string[]
  collaborateurs: string[]
  familles: string[]
  vue: Vue
  masquerPetits: boolean
}

const FILTRES_VIDES: Filtres = { agences: [], collaborateurs: [], familles: [], vue: 'agences', masquerPetits: true }
const SEUIL_PETIT = 10000

type Perimetre = { restreint: boolean; agences: string[]; collaborateurs: string[] }
const PERIMETRE_LIBRE: Perimetre = { restreint: false, agences: [], collaborateurs: [] }

type SortKey =
  | 'label' | 'caN1' | 'caN1Date' | 'caNDate' | 'evol' | 'ecart' | 'marge' | 'margeDelta' | 'vsEntreprise'
  | 'objectifADate' | 'realisation' | 'creationsN' | 'margeVsEntr' | 'transfo' | 'transfoDelta' | 'transfoVsEntr'

/** Contrat d'objectifs de l'année (RPC get_suivi_contrats). */
type ContratSuivi = { code: string; agence: string; perimetre: 'perso' | 'agence'; objectif: number | null }
/** Agrégat de devis pour le taux de transformation : CA devisé et CA transformé en commande dans le délai. */
type TransfoAgg = { caN: number; trN: number; caN1: number; trN1: number }
type TransfoData = { delai: number; dateLimite: string | null; maj: string | null; rows: Array<{ code: string; famille: string } & TransfoAgg>; ref: Array<{ famille: string } & TransfoAgg> }
const HORS_CONTRATS = ' · hors contrats'
/** Ligne unique regroupant tous les collaborateurs hors contrats (vue Agences, en fin de liste). */
const HORS_GLOBAL = 'Hors contrats'
const estHors = (groupe: string) => groupe === HORS_GLOBAL || groupe.endsWith(HORS_CONTRATS)

/**
 * Abréviation d'agence la plus courte (3 lettres minimum) qui reste unique parmi
 * les agences connues : MERIGNAC → « Mér. », ANGLET / ANGOULEME → « Angl. » / « Ango. ».
 */
function abregerAgences(noms: string[]): Map<string, string> {
  const uniques = Array.from(new Set(noms.filter(Boolean)))
  const plat = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const out = new Map<string, string>()
  uniques.forEach((nom) => {
    const n = plat(nom)
    let len = Math.min(3, n.length)
    while (len < n.length && uniques.some((o) => o !== nom && plat(o).startsWith(n.slice(0, len)))) len++
    const pref = nom.slice(0, len)
    const joli = pref.charAt(0).toUpperCase() + pref.slice(1).toLowerCase()
    out.set(nom, len >= nom.length ? joli : `${joli}.`)
  })
  return out
}
/** Séparateur vertical des zones du tableau (CA, Marge, Transfo devis, Comptes, Position). */
const ZONE = 'border-l-2 border-[#E2DFD8]'
/** 1re colonne figée (volets figés) : reste visible au défilement horizontal. */
const FIGE = 'sticky left-0 z-20 shadow-[1px_0_0_#E2DFD8]'
const DELAI_TRANSFO = 60

function tauxTransfo(a: TransfoAgg | null, n1 = false): number | null {
  if (!a) return null
  const ca = n1 ? a.caN1 : a.caN
  if (!ca || ca <= 0) return null
  return ((n1 ? a.trN1 : a.trN) / ca) * 100
}
function addTransfo(t: TransfoAgg, x: TransfoAgg) {
  t.caN += x.caN; t.trN += x.trN; t.caN1 += x.caN1; t.trN1 += x.trN1
}
const transfoVide = (): TransfoAgg => ({ caN: 0, trN: 0, caN1: 0, trN1: 0 })

type Ligne = {
  entity: Entity
  serie: Serie
  caN1: number
  caN1Date: number
  caNDate: number
  evol: number | null
  ecart: number
  trims: Array<{ q: number; evol: number | null; partiel: boolean } | null>
  marge: number | null
  margeDelta: number | null
  vsEntreprise: number | null
  /** Objectif annuel de CA (null si aucun, ou si un filtre familles est actif). */
  objectifCa: number | null
  /** Objectif à date = annuel × répartition mensuelle cumulée des mois clos. */
  objectifADate: number | null
  /** Réalisé à date / objectif à date, en %. */
  realisation: number | null
  creations: CreationsEntite | null
  creationsN: number | null
  positions: ReturnType<typeof positionsTrimestrielles>
  /** Taux de marge − taux de marge entreprise, en points. */
  margeVsEntr: number | null
  /** Taux de transformation des devis à 60 j (en CA), N à date. */
  transfo: number | null
  transfoDelta: number | null
  transfoVsEntr: number | null
}

export default function SuiviAgencesPageWrapper() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-slate-500">Chargement…</div>}>
      <SuiviAgencesPage />
    </Suspense>
  )
}

function SuiviAgencesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [annee, setAnnee] = useState(new Date().getFullYear())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<DataRow[]>([])
  const [refRows, setRefRows] = useState<RefRow[]>([])
  const [collaborateurs, setCollaborateurs] = useState<Collaborateur[]>([])
  const [moisClos, setMoisClos] = useState(0)
  const [moisMax, setMoisMax] = useState(0)
  const [exclusionsLibelle, setExclusionsLibelle] = useState('')
  const [objectifs, setObjectifs] = useState<Objectif[]>([])
  const [commerciaux, setCommerciaux] = useState<Commercial[]>([])
  const [impayes, setImpayes] = useState<ImpayesData | null>(null)
  const [repartition, setRepartition] = useState<Repartition>(null)
  const [creations, setCreations] = useState<CreationsData | null>(null)
  const [perimetre, setPerimetre] = useState<Perimetre>(PERIMETRE_LIBRE)
  const [contrats, setContrats] = useState<ContratSuivi[]>([])
  const [transfoData, setTransfoData] = useState<TransfoData | null>(null)

  const [filtres, setFiltres] = useState<Filtres>({ ...FILTRES_VIDES, vue: searchParams.get('vue') === 'collaborateurs' ? 'collaborateurs' : 'agences' })
  const [activeVarianteId, setActiveVarianteId] = useState<string | null>(null)
  const [defaultApplied, setDefaultApplied] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // 17/11/2026 : croix de positionnement fermée par défaut.
  const [showCross, setShowCross] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'caNDate', dir: -1 })

  const variantesApi = useVariantes<Filtres>(ECRAN)

  // ------------------------------------------------------------------ chargement
  const load = useCallback(async (targetAnnee: number) => {
    setLoading(true)
    setError(null)
    const [dataRes, refRes, objRes, impRes, creRes, ctrRes, trRes] = await Promise.all([
      supabase.rpc('get_suivi_agences_data', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_agences_reference', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_objectifs', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_impayes', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_creations_comptes', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_contrats', { p_annee: targetAnnee }),
      supabase.rpc('get_suivi_transfo_devis', { p_annee: targetAnnee, p_delai: DELAI_TRANSFO }),
    ])
    // Contrats d'objectifs et transfo devis : facultatifs (migration 20261117 non appliquée → règles d'avant).
    setContrats(
      ctrRes.error || !Array.isArray(ctrRes.data)
        ? []
        : (ctrRes.data as any[]).map((c) => ({
            code: String(c.code || '').toUpperCase(),
            agence: String(c.agence || ''),
            perimetre: c.perimetre === 'agence' ? 'agence' : 'perso',
            objectif: c.objectif === null || c.objectif === undefined ? null : Number(c.objectif),
          }))
    )
    if (trRes.error || !trRes.data) setTransfoData(null)
    else {
      const t = trRes.data as any
      const num = (v: any) => Number(v) || 0
      setTransfoData({
        delai: Number(t.delai) || DELAI_TRANSFO,
        dateLimite: t.date_limite ? String(t.date_limite) : null,
        maj: t.maj ? String(t.maj) : null,
        rows: ((t.rows || []) as any[]).map((r) => ({ code: String(r[0]), famille: String(r[1]), caN: num(r[2]), trN: num(r[3]), caN1: num(r[4]), trN1: num(r[5]) })),
        ref: ((t.ref || []) as any[]).map((r) => ({ famille: String(r[0]), caN: num(r[1]), trN: num(r[2]), caN1: num(r[3]), trN1: num(r[4]) })),
      })
    }
    // Créations de comptes : facultatif (migration 20261015 non appliquée → pas de colonne).
    setCreations(creRes.error ? null : parseCreations(creRes.data))
    // Impayés : facultatif (migration 20261011 non appliquée → pas de pavé).
    setImpayes(impRes.error ? null : parseImpayes(impRes.data))
    if (dataRes.error) {
      setError(dataRes.error.message)
      setLoading(false)
      return
    }
    const data = (dataRes.data || {}) as any
    const p = (data.perimetre || {}) as any
    setPerimetre({
      restreint: !!p.restreint,
      agences: Array.isArray(p.agences) ? p.agences.map(String) : [],
      collaborateurs: Array.isArray(p.collaborateurs) ? p.collaborateurs.map(String) : [],
    })
    setRows(parseDataRows(data.rows))
    setCollaborateurs(((data.collaborateurs || []) as any[]).map((c) => ({
      code: String(c.code),
      nom: String(c.nom || c.code),
      agence: String(c.agence || 'NON AFFECTE'),
      sommeil: !!c.sommeil,
      fonction: c.fonction ? String(c.fonction) : null,
    })))
    setMoisClos(Number(data.mois_clos) || 0)
    setMoisMax(Number(data.mois_max) || 0)

    const ref = (refRes.data || {}) as any
    setRefRows(parseRefRows(ref.rows))
    const excl = ((ref.exclusions || []) as any[]).map((e) => String(e.libelle || e.valeur))
    setExclusionsLibelle(excl.length ? `hors ${excl.join(' et ')}` : '')

    const obj = (objRes.data || {}) as any
    setObjectifs(((obj.objectifs || []) as any[]).map((o) => ({
      perimetre_type: o.perimetre_type,
      perimetre_ref: o.perimetre_ref,
      type_objectif: String(o.type_objectif),
      famille_macro: o.famille_macro ? String(o.famille_macro) : null,
      valeur_cible: Number(o.valeur_cible),
    })))
    setRepartition(parseRepartition(obj.repartition))
    setCommerciaux(((obj.commerciaux || []) as any[]).map((c) => ({
      email: String(c.email || ''),
      display_name: String(c.display_name || ''),
      agence_objectif: String(c.agence_objectif || ''),
      code: c.code ? String(c.code) : null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(annee)
  }, [annee, load])

  // Variante par défaut appliquée une fois, à l'ouverture.
  useEffect(() => {
    if (defaultApplied || !variantesApi.loaded) return
    const def = variantesApi.variantes.find((v) => v.par_defaut)
    if (def) {
      setFiltres({ ...FILTRES_VIDES, ...def.filtres })
      setActiveVarianteId(def.id)
    }
    setDefaultApplied(true)
  }, [variantesApi.loaded, variantesApi.variantes, defaultApplied])

  const activeVariante = variantesApi.variantes.find((v) => v.id === activeVarianteId) || null
  const dirty = !!activeVariante && JSON.stringify({ ...FILTRES_VIDES, ...activeVariante.filtres }) !== JSON.stringify(filtres)

  function applyVariante(v: Variante<Filtres> | null) {
    setActiveVarianteId(v ? v.id : null)
    setFiltres(v ? { ...FILTRES_VIDES, ...v.filtres } : { ...FILTRES_VIDES, vue: filtres.vue })
  }

  function patchFiltres(patch: Partial<Filtres>) {
    setFiltres((current) => ({ ...current, ...patch }))
  }

  // ------------------------------------------------------------------ options
  const collabByCode = useMemo(() => new Map(collaborateurs.map((c) => [c.code, c])), [collaborateurs])

  const agenceOptions = useMemo(() => {
    const totals = new Map<string, number>()
    rows.forEach((r) => {
      if (r.annee >= annee - 1) totals.set(r.agence, (totals.get(r.agence) || 0) + r.ca)
    })
    return Array.from(new Set(collaborateurs.map((c) => c.agence)))
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((a) => ({ value: a, label: a, hint: fmtK(totals.get(a) || 0) }))
  }, [collaborateurs, rows, annee])

  const collabOptions = useMemo(
    () =>
      collaborateurs
        .filter((c) => filtres.agences.length === 0 || filtres.agences.includes(c.agence))
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
        .map((c) => ({ value: c.code, label: c.nom, hint: c.agence, muted: c.sommeil })),
    [collaborateurs, filtres.agences]
  )

  const familleOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.famille))
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, 'fr'))
      .map((f) => ({ value: f, label: FAMILLES_LIBELLES[f] && FAMILLES_LIBELLES[f] !== f ? `${f} · ${FAMILLES_LIBELLES[f]}` : f }))
  }, [rows])

  // ------------------------------------------------------------------ agrégats
  const famSet = useMemo(() => (filtres.familles.length ? new Set(filtres.familles) : null), [filtres.familles])
  const agSet = useMemo(() => (filtres.agences.length ? new Set(filtres.agences) : null), [filtres.agences])
  const coSet = useMemo(() => (filtres.collaborateurs.length ? new Set(filtres.collaborateurs) : null), [filtres.collaborateurs])

  // ---------------------------------------------------------------- contrats
  // 17/11/2026 : une agence qui a des contrats d'objectifs = ses collaborateurs sous contrat ;
  // les autres collaborateurs de l'agence forment une ligne « <AGENCE> · hors contrats ».
  const contratParCode = useMemo(() => new Map(contrats.map((c) => [c.code, c])), [contrats])
  const contratsParAgence = useMemo(() => {
    const m = new Map<string, { codes: Set<string>; objectif: number | null; agenceObjectif: boolean }>()
    contrats.forEach((c) => {
      const k = normAgence(c.agence)
      if (!k) return
      if (!m.has(k)) m.set(k, { codes: new Set(), objectif: null, agenceObjectif: false })
      m.get(k)!.codes.add(c.code)
    })
    m.forEach((v, k) => {
      const ag = contrats.filter((c) => normAgence(c.agence) === k)
      const surAgence = ag.filter((c) => c.perimetre === 'agence' && c.objectif !== null)
      if (surAgence.length) {
        v.objectif = Math.max(...surAgence.map((c) => c.objectif || 0))
        v.agenceObjectif = true
      } else {
        const perso = ag.filter((c) => c.objectif !== null)
        v.objectif = perso.length ? perso.reduce((s, c) => s + (c.objectif || 0), 0) : null
      }
    })
    return m
  }, [contrats])
  /** Ligne agence d'un collaborateur : son agence, ou « <AGENCE> · hors contrats ». */
  const groupeDe = useCallback(
    (code: string, agence: string) => {
      const ct = contratsParAgence.get(normAgence(agence))
      return !ct || ct.codes.has(code.toUpperCase()) ? agence : `${agence}${HORS_CONTRATS}`
    },
    [contratsParAgence]
  )
  /** Ligne du tableau en vue Agences : les « <AGENCE> · hors contrats » sont fondues dans « Hors contrats ». */
  const ligneDe = useCallback((code: string, agence: string) => {
    const g = groupeDe(code, agence)
    return g.endsWith(HORS_CONTRATS) ? HORS_GLOBAL : g
  }, [groupeDe])
  const ligneDeCode = useCallback((code: string) => ligneDe(code, collabByCode.get(code)?.agence || ''), [ligneDe, collabByCode])
  /** Une ligne agence (ou ancienne clé « <AGENCE> · hors contrats ») contient-elle ce collaborateur ? */
  const dansGroupe = useCallback(
    (groupe: string, code: string, agence: string) =>
      groupe === HORS_GLOBAL ? ligneDe(code, agence) === HORS_GLOBAL : groupeDe(code, agence) === groupe,
    [groupeDe, ligneDe]
  )
  const abrevAgence = useMemo(() => abregerAgences(collaborateurs.map((c) => c.agence)), [collaborateurs])
  const agenceReelle = (groupe: string) => (groupe === HORS_GLOBAL ? '' : groupe.endsWith(HORS_CONTRATS) ? groupe.slice(0, -HORS_CONTRATS.length) : groupe)

  const { seriesByCode, seriesByAgence, serieTotal } = useMemo(() => {
    const byCode = new Map<string, Serie>()
    const byAgence = new Map<string, Serie>()
    const total = emptySerie()
    rows.forEach((r) => {
      if (famSet && !famSet.has(r.famille)) return
      if (agSet && !agSet.has(r.agence)) return
      if (coSet && !coSet.has(r.code)) return
      const y = r.annee - (annee - 2)
      const g = ligneDe(r.code, r.agence)
      if (!byCode.has(r.code)) byCode.set(r.code, emptySerie())
      if (!byAgence.has(g)) byAgence.set(g, emptySerie())
      addToSerie(byCode.get(r.code)!, y, r.mois, r.ca, r.marge)
      addToSerie(byAgence.get(g)!, y, r.mois, r.ca, r.marge)
      addToSerie(total, y, r.mois, r.ca, r.marge)
    })
    return { seriesByCode: byCode, seriesByAgence: byAgence, serieTotal: total }
  }, [rows, famSet, agSet, coSet, annee, ligneDe])

  // ------------------------------------------------------- transfo devis 60 j
  const transfoByCode = useMemo(() => {
    const m = new Map<string, TransfoAgg>()
    ;(transfoData?.rows || []).forEach((r) => {
      if (famSet && !famSet.has(r.famille)) return
      if (!m.has(r.code)) m.set(r.code, transfoVide())
      addTransfo(m.get(r.code)!, r)
    })
    return m
  }, [transfoData, famSet])
  const transfoRef = useMemo(() => {
    if (!transfoData) return null
    const t = transfoVide()
    transfoData.ref.forEach((r) => {
      if (!famSet || famSet.has(r.famille)) addTransfo(t, r)
    })
    return t
  }, [transfoData, famSet])
  const transfoPour = useCallback(
    (codes: string[]): TransfoAgg | null => {
      if (!transfoData) return null
      const t = transfoVide()
      codes.forEach((c) => {
        const x = transfoByCode.get(c)
        if (x) addTransfo(t, x)
      })
      return t
    },
    [transfoData, transfoByCode]
  )

  const refSerie = useMemo(() => {
    const s = emptySerie()
    refRows.forEach((r) => {
      if (famSet && !famSet.has(r.famille)) return
      addToSerie(s, r.annee - (annee - 2), r.mois, r.ca, r.marge)
    })
    return s
  }, [refRows, famSet, annee])

  const refEvol = evolPct(sumMonths(refSerie.ca[2], 1, moisClos), sumMonths(refSerie.ca[1], 1, moisClos))
  const refMarge = tauxMarge(sumMonths(refSerie.mg[2], 1, moisClos), sumMonths(refSerie.ca[2], 1, moisClos))
  const refTransfo = tauxTransfo(transfoRef)

  // Objectif à date : part de l'objectif annuel attendue à fin du dernier mois clos.
  const partADate = useMemo(() => partObjectifADate(repartition, moisClos), [repartition, moisClos])
  const partAnnee = useMemo(() => partAnneeEcoulee(annee), [annee])
  const agenceDeCode = useCallback((code: string) => collabByCode.get(code.toUpperCase())?.agence, [collabByCode])

  /** Créations de comptes d'une entité (agence = agence de la fiche collaborateur). */
  const creationsEntite = useCallback(
    (entity: Entity): CreationsEntite | null => {
      if (entity.kind === 'collaborateur') return creationsPour(creations, (r) => r.code === entity.id.toUpperCase(), annee, partAnnee)
      if (entity.kind === 'agence' && entity.horsContrats) {
        const codes = new Set(entity.codes.map((c) => c.toUpperCase()))
        return creationsPour(creations, (r) => codes.has(r.code), annee, partAnnee)
      }
      if (entity.kind === 'agence') return creationsPour(creations, (r) => r.agence === entity.id && (!coSet || coSet.has(r.code)), annee, partAnnee)
      if (entity.id === 'entreprise') return creationsPour(creations, () => true, annee, partAnnee)
      return creationsPour(creations, (r) => (!agSet || agSet.has(r.agence)) && (!coSet || coSet.has(r.code)), annee, partAnnee)
    },
    [creations, annee, partAnnee, agSet, coSet]
  )

  /** Objectif CA issu des contrats : undefined = pas de contrat (règle bilan), null = aucun objectif propre. */
  const objectifContrat = useCallback(
    (entity: Entity): number | null | undefined => {
      if (entity.kind === 'agence') {
        if (entity.horsContrats) return null
        const ct = contratsParAgence.get(normAgence(entity.agence))
        return ct ? ct.objectif : undefined
      }
      if (entity.kind === 'collaborateur') {
        const c = contratParCode.get(entity.id.toUpperCase())
        if (!c) return undefined
        return c.perimetre === 'perso' ? c.objectif : null
      }
      return undefined
    },
    [contratsParAgence, contratParCode]
  )

  const buildLigne = useCallback(
    (entity: Entity, serie: Serie): Ligne => {
      const caN1 = sumMonths(serie.ca[1], 1, 12)
      const caN1Date = sumMonths(serie.ca[1], 1, moisClos)
      const caNDate = sumMonths(serie.ca[2], 1, moisClos)
      const evol = evolPct(caNDate, caN1Date)
      const trims = [1, 2, 3, 4].map((q) => {
        const from = q * 3 - 2
        if (from > moisClos) return null
        const to = Math.min(q * 3, moisClos)
        return { q, evol: evolPct(sumMonths(serie.ca[2], from, to), sumMonths(serie.ca[1], from, to)), partiel: to < q * 3 }
      })
      const tN = tauxMarge(sumMonths(serie.mg[2], 1, moisClos), caNDate)
      const tN1 = tauxMarge(sumMonths(serie.mg[1], 1, moisClos), caN1Date)
      const objs = objectifsPourEntite(entity, objectifs, commerciaux, agenceDeCode)
      const objCaRow = objs.propres.find((o) => o.type_objectif === 'ca_valeur' && !o.famille_macro)
      const objContrat = objectifContrat(entity)
      // Un filtre familles rend la comparaison à l'objectif global sans objet.
      const objCa = famSet ? null : objContrat !== undefined ? objContrat : objCaRow ? objCaRow.valeur_cible : null
      const tr = entity.id === 'entreprise' && entity.kind === 'entreprise' ? transfoRef : transfoPour(entity.codes)
      const trN = tauxTransfo(tr)
      const trN1 = tauxTransfo(tr, true)
      const objADate = objCa !== null ? objCa * partADate : null
      const cre = creationsEntite(entity)
      return {
        entity,
        serie,
        caN1,
        caN1Date,
        caNDate,
        evol,
        ecart: caNDate - caN1Date,
        trims,
        marge: tN,
        margeDelta: tN !== null && tN1 !== null ? tN - tN1 : null,
        vsEntreprise: evol !== null && refEvol !== null ? evol - refEvol : null,
        objectifCa: objCa,
        objectifADate: objADate,
        realisation: objADate && objADate > 0 ? (caNDate / objADate) * 100 : null,
        creations: cre,
        creationsN: cre ? cre.n : null,
        positions: positionsTrimestrielles(serie, moisClos),
        margeVsEntr: tN !== null && refMarge !== null ? tN - refMarge : null,
        transfo: trN,
        transfoDelta: trN !== null && trN1 !== null ? trN - trN1 : null,
        transfoVsEntr: trN !== null && refTransfo !== null ? trN - refTransfo : null,
      }
    },
    [moisClos, objectifs, commerciaux, refEvol, refMarge, refTransfo, transfoRef, transfoPour, agenceDeCode, famSet, partADate, creationsEntite, objectifContrat]
  )

  const isPetit = useCallback(
    (serie: Serie) => Math.abs(sumMonths(serie.ca[1], 1, 12)) < SEUIL_PETIT && Math.abs(sumMonths(serie.ca[2], 1, 12)) < SEUIL_PETIT,
    []
  )

  const collabEntity = useCallback(
    (code: string): Entity => {
      const c = collabByCode.get(code)
      return { key: `C:${code}`, kind: 'collaborateur', id: code, label: c?.nom || code, agence: c?.agence || '—', sommeil: c?.sommeil, codes: [code] }
    },
    [collabByCode]
  )

  const lignesCollab = useMemo(() => {
    const out: Ligne[] = []
    seriesByCode.forEach((serie, code) => {
      if (filtres.masquerPetits && isPetit(serie)) return
      out.push(buildLigne(collabEntity(code), serie))
    })
    return out
  }, [seriesByCode, filtres.masquerPetits, isPetit, buildLigne, collabEntity])

  const lignesAgence = useMemo(() => {
    const out: Ligne[] = []
    seriesByAgence.forEach((serie, groupe) => {
      const codes = Array.from(seriesByCode.keys()).filter((code) => ligneDeCode(code) === groupe)
      out.push(buildLigne({ key: `A:${groupe}`, kind: 'agence', id: groupe, label: groupe, agence: agenceReelle(groupe), codes, horsContrats: estHors(groupe) }, serie))
    })
    return out
  }, [seriesByAgence, seriesByCode, ligneDeCode, buildLigne])

  const sorter = useCallback(
    (a: Ligne, b: Ligne) => {
      const get = (l: Ligne): number | string | null => (sort.key === 'label' ? l.entity.label : (l as any)[sort.key])
      const va = get(a)
      const vb = get(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'fr') * sort.dir
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return ((va as number) - (vb as number)) * sort.dir
    },
    [sort]
  )

  // 17/11/2026 : en vue Agences, la ligne « Hors contrats » reste en fin de liste quel que soit le tri.
  const topLignes = useMemo(() => {
    if (filtres.vue !== 'agences') return [...lignesCollab].sort(sorter)
    const normales = lignesAgence.filter((l) => !l.entity.horsContrats).sort(sorter)
    return [...normales, ...lignesAgence.filter((l) => l.entity.horsContrats)]
  }, [filtres.vue, lignesAgence, lignesCollab, sorter])

  const totalLigne = useMemo(() => {
    const l = buildLigne({ key: 'T', kind: 'entreprise', id: 'total', label: 'Total sélection', agence: '', codes: Array.from(seriesByCode.keys()) }, serieTotal)
    // Objectif de la sélection : objectif entreprise sans filtre agence / collaborateur,
    // sinon somme des objectifs des lignes affichées.
    let objCa = l.objectifCa
    if (famSet) objCa = null
    else if (agSet || coSet || objCa === null) {
      const avecObjectif = topLignes.filter((x) => x.objectifCa !== null)
      objCa = avecObjectif.length ? avecObjectif.reduce((s, x) => s + (x.objectifCa || 0), 0) : null
    }
    const objADate = objCa !== null ? objCa * partADate : null
    return { ...l, objectifCa: objCa, objectifADate: objADate, realisation: objADate && objADate > 0 ? (l.caNDate / objADate) * 100 : null }
  }, [buildLigne, serieTotal, seriesByCode, topLignes, famSet, agSet, coSet, partADate])
  const refLigne = useMemo(() => {
    const l = buildLigne({ key: 'R', kind: 'entreprise', id: 'entreprise', label: 'Entreprise (réf.)', agence: '', codes: [] }, refSerie)
    // La référence est « hors exclusions » : pas d'objectif comparable.
    return { ...l, objectifCa: null, objectifADate: null, realisation: null }
  }, [buildLigne, refSerie])

  const nbTrimestres = Math.min(4, Math.floor(moisClos / 3))

  const crossPoints: CrossPoint[] = useMemo(() => {
    const pts: CrossPoint[] = topLignes.map((l) => ({
      key: l.entity.key,
      label: l.entity.kind === 'collaborateur' ? l.entity.id : l.entity.label,
      positions: l.positions,
      poids: l.caNDate,
    }))
    const poidsMax = pts.reduce((m, p) => Math.max(m, p.poids), 0)
    pts.push({ key: 'R', label: 'Entreprise', positions: refLigne.positions, poids: perimetre.restreint ? poidsMax : refLigne.caNDate, reference: true })
    return pts
  }, [topLignes, refLigne, perimetre.restreint])

  // ------------------------------------------------------------------ fiche
  // CORRECTIF (15/10/2026) — « Fermer » sans effet : la fiche ouverte ne
  // dépendait que de ?fiche= dans l'adresse, mise à jour par router.replace ;
  // quand cette navigation cliente n'aboutit pas, la fiche restait affichée.
  // La fiche suit désormais un état local, appliqué immédiatement, l'adresse
  // n'étant qu'un reflet (lien partageable, retour arrière).
  const ficheUrl = searchParams.get('fiche')
  const [ficheLocale, setFicheLocale] = useState<{ key: string | null; depuisUrl: string | null } | null>(null)
  // Si l'adresse change d'elle-même (retour arrière, lien), elle reprend la main.
  const ficheKey = ficheLocale && ficheLocale.depuisUrl === ficheUrl ? ficheLocale.key : ficheUrl
  const openFiche = useCallback(
    (key: string | null) => {
      setFicheLocale({ key, depuisUrl: ficheUrl })
      const params = new URLSearchParams(searchParams.toString())
      if (key) params.set('fiche', key)
      else params.delete('fiche')
      const href = `/suivi-agences${params.toString() ? `?${params}` : ''}`
      try {
        window.history.replaceState(window.history.state, '', href)
      } catch {
        // historique indisponible : l'état local suffit
      }
      router.replace(href, { scroll: false })
    },
    [router, searchParams, ficheUrl]
  )

  const ficheHorsPerimetre = useMemo(() => {
    if (!ficheKey || loading || !perimetre.restreint) return false
    if (ficheKey.startsWith('C:')) return !collabByCode.has(ficheKey.slice(2))
    if (ficheKey.startsWith('A:')) {
      const g = ficheKey.slice(2)
      return g === HORS_GLOBAL ? !collaborateurs.some((c) => ligneDeCode(c.code) === HORS_GLOBAL) : !collaborateurs.some((c) => c.agence === agenceReelle(g))
    }
    return true
  }, [ficheKey, loading, perimetre.restreint, collabByCode, collaborateurs, ligneDeCode])

  // 17/11/2026 : la fiche est calculée sur toutes les lignes de l'entité (seul le filtre
  // familles s'applique) — elle ne dépend plus des filtres Agences / Collaborateurs du
  // tableau, qui pouvaient la vider (« 0 collaborateur », 0 €).
  const fiche = useMemo(() => {
    if (!ficheKey || loading || ficheHorsPerimetre) return null
    const serieDe = (keep: (r: DataRow) => boolean) => {
      const s = emptySerie()
      rows.forEach((r) => {
        if (famSet && !famSet.has(r.famille)) return
        if (keep(r)) addToSerie(s, r.annee - (annee - 2), r.mois, r.ca, r.marge)
      })
      return s
    }
    if (ficheKey.startsWith('C:')) {
      const code = ficheKey.slice(2)
      return { entity: collabEntity(code), serie: serieDe((r) => r.code === code) }
    }
    if (ficheKey.startsWith('A:')) {
      const groupe = ficheKey.slice(2)
      const codes = Array.from(new Set(rows.filter((r) => dansGroupe(groupe, r.code, r.agence)).map((r) => r.code)))
      const serie = serieDe((r) => dansGroupe(groupe, r.code, r.agence))
      return {
        entity: { key: ficheKey, kind: 'agence' as const, id: groupe, label: groupe, agence: agenceReelle(groupe), codes, horsContrats: estHors(groupe) },
        serie,
      }
    }
    return null
  }, [ficheKey, loading, ficheHorsPerimetre, rows, famSet, annee, dansGroupe, collabEntity])

  const ficheRows = useMemo(() => {
    if (!fiche) return []
    const codes = new Set(fiche.entity.codes)
    return rows.filter((r) => codes.has(r.code))
  }, [fiche, rows])

  const ficheImpayes = useMemo(() => {
    if (!fiche) return null
    // Agence : tous les collaborateurs rattachés à l'agence (même sans CA sur la sélection).
    const codes =
      fiche.entity.kind === 'agence'
        ? Array.from(new Set([...fiche.entity.codes, ...collaborateurs.filter((c) => dansGroupe(fiche.entity.id, c.code, c.agence)).map((c) => c.code)]))
        : fiche.entity.codes
    return impayesPourCodes(impayes, codes)
  }, [fiche, impayes, collaborateurs, dansGroupe])

  const ficheObjectifs = useMemo((): ObjectifsEntite => {
    if (!fiche) return { propres: [], familles: [], zeroImpaye: null, herites: [], heritesDe: null }
    const o = objectifsPourEntite(fiche.entity, objectifs, commerciaux, agenceDeCode)
    // Objectif CA : celui des contrats d'objectifs quand il y en a (17/11/2026).
    const val = objectifContrat(fiche.entity)
    if (val === undefined) return o
    const propres = o.propres.filter((x) => !(x.type_objectif === 'ca_valeur' && !x.famille_macro))
    if (val !== null)
      propres.push({
        perimetre_type: fiche.entity.kind === 'agence' ? 'agence' : 'collaborateur',
        perimetre_ref: fiche.entity.id,
        type_objectif: 'ca_valeur',
        famille_macro: null,
        valeur_cible: val,
      })
    return { ...o, propres }
  }, [fiche, objectifs, commerciaux, agenceDeCode, objectifContrat])
  const ficheCreations = useMemo(() => (fiche ? creationsEntite(fiche.entity) : null), [fiche, creationsEntite])

  // ------------------------------------------------------------------ rendu
  function toggleExpand(agence: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(agence)) next.delete(agence)
      else next.add(agence)
      return next
    })
  }

  const allExpanded = filtres.vue === 'agences' && lignesAgence.length > 0 && lignesAgence.every((l) => expanded.has(l.entity.id))

  function header(key: SortKey, label: string, align: 'left' | 'right' = 'right', title?: string, extra = '') {
    const active = sort.key === key
    return (
      <th
        className={`cursor-pointer select-none whitespace-nowrap px-2 py-2.5 font-semibold ${align === 'left' ? 'text-left' : 'text-right'} ${active ? 'text-slate-900' : ''} ${extra}`}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === 'label' ? 1 : -1 }))}
        title={title}
      >
        {label}
        {active ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  const filtresActifs = filtres.agences.length + filtres.collaborateurs.length + filtres.familles.length
  const fmtJour = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—')
  const libTransfo = transfoData
    ? `Transfo devis ${transfoData.delai} j = CA des devis du 1er janvier au ${fmtJour(transfoData.dateLimite)} transformé en commande dans les ${transfoData.delai} jours / CA devisé, comparé à la même fenêtre ${annee - 1} (cycle des documents mis à jour le ${fmtJour(transfoData.maj)})`
    : 'Transfo devis : donnée indisponible'

  return (
    <div className="min-h-screen bg-[#F4F3F0] pb-16">
      {/* ------------------------------------------------------------ bandeau */}
      {/* Bandeau : couleurs du thème (sombre = inchangé, clair = blanc / encre marine), 15/10/2026 */}
      <header className="border-b border-[color:var(--cg-hdr-border)] bg-[color:var(--cg-hdr-bg)]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-end justify-between gap-4 px-4 py-4 md:px-8">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#B4761A]">Mes agences / Mes commerciaux</div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight text-[color:var(--cg-hdr-ink)] md:text-[28px]">Suivi agences – commerciaux</h1>
            <p className="mt-1 text-[12px] text-[color:var(--cg-hdr-muted)]">
              CA facturé {annee} · à date = janvier → {MOIS_LONGS[moisClos] || '—'} (dernier mois clos), comparé aux mêmes mois {annee - 1}
              {exclusionsLibelle && ` · référence entreprise ${exclusionsLibelle}`}
              <span className="ml-2 rounded bg-[color:var(--cg-hdr-chip)] px-1.5 py-0.5 text-[11px] font-semibold text-[color:var(--cg-hdr-ink-2)]">Hors statistique : exclus</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={annee}
              onChange={(e) => setAnnee(Number(e.target.value))}
              className="h-9 cursor-pointer rounded-lg border border-[color:var(--cg-hdr-line)] bg-[color:var(--cg-hdr-field)] px-2.5 text-sm font-semibold text-[color:var(--cg-hdr-ink)] outline-none focus:border-[#B4761A]"
              aria-label="Année"
            >
              {[new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <a href={`/objectifs/contrats?annee=${annee}`} className="flex h-9 items-center rounded-lg border border-[color:var(--cg-hdr-line)] px-3 text-sm font-semibold text-[color:var(--cg-hdr-ink-2)] hover:border-[#B4761A] hover:text-[color:var(--cg-hdr-ink)]">
              🎯 Contrats d’objectifs
            </a>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------- barre de filtres */}
      <div className="relative z-40 border-b border-[#E2DFD8] bg-[#F4F3F0]">
        <div className="mx-auto flex w-full max-w-[1760px] flex-wrap items-center gap-2 px-4 py-2 md:px-8">
          <div className="flex rounded-lg border border-[#D8D3C8] bg-white p-0.5 text-[13px]">
            {(['agences', 'collaborateurs'] as Vue[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => patchFiltres({ vue: v })}
                className={`rounded-md px-3 py-1.5 font-semibold transition ${filtres.vue === v ? 'bg-[#111820] text-white' : 'text-slate-600 hover:text-slate-900'}`}
              >
                {v === 'agences' ? 'Agences' : 'Collaborateurs'}
              </button>
            ))}
          </div>
          <span className="mx-1 hidden h-6 w-px bg-[#D8D3C8] md:block" />
          <MultiSelect label="Agences" allLabel="Toutes" options={agenceOptions} selected={filtres.agences} onChange={(v) => patchFiltres({ agences: v })} />
          <MultiSelect label="Collab." allLabel="Tous" options={collabOptions} selected={filtres.collaborateurs} onChange={(v) => patchFiltres({ collaborateurs: v })} width={320} />
          <MultiSelect label="Familles" allLabel="Toutes" options={familleOptions} selected={filtres.familles} onChange={(v) => patchFiltres({ familles: v })} />
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-600" title={`Masque les collaborateurs sous ${fmtK(SEUIL_PETIT)} de CA en N-1 et en N`}>
            <input type="checkbox" checked={filtres.masquerPetits} onChange={(e) => patchFiltres({ masquerPetits: e.target.checked })} className="h-3.5 w-3.5 accent-[#B4761A]" />
            Masquer &lt; 10 k€
          </label>
          {filtresActifs > 0 && (
            <button type="button" onClick={() => patchFiltres({ agences: [], collaborateurs: [], familles: [] })} className="text-[12px] font-semibold text-slate-500 hover:text-[#A32C2C]">
              Effacer les filtres
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCross((v) => !v)}
              className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition ${showCross ? 'border-[#111820] bg-[#111820] text-white' : 'border-[#D8D3C8] bg-white text-slate-700 hover:border-[#B4761A]'}`}
            >
              ✛ Croix de positionnement
            </button>
            <VariantesMenu<Filtres>
              variantes={variantesApi.variantes}
              activeId={activeVarianteId}
              dirty={dirty}
              onApply={applyVariante}
              onSave={async (nom, parDefaut) => {
                const err = await variantesApi.save(nom, filtres, parDefaut)
                if (!err) {
                  const { data } = await supabase.from('user_filtres_variantes').select('id').eq('ecran', ECRAN).eq('nom', nom).maybeSingle()
                  if (data) setActiveVarianteId(String((data as any).id))
                }
                return err
              }}
              onSetDefault={variantesApi.setDefault}
              onRemove={async (id) => {
                const err = await variantesApi.remove(id)
                if (!err && id === activeVarianteId) setActiveVarianteId(null)
                return err
              }}
            />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1760px] px-4 py-5 md:px-8">
        {error ? (
          <div className="rounded-2xl border border-[#F0C5BE] bg-[#FCEFEC] p-6 text-sm text-[#7F1D1D]">
            <div className="font-semibold">Chargement impossible</div>
            <div className="mt-1">{error}</div>
            {/Accès refusé|42501|permission denied/i.test(error) && (
              <div className="mt-2 text-[13px]">Demandez à un administrateur de cocher « Suivi agences – commerciaux » sur votre profil (Admin › Profils et autorisations).</div>
            )}
            {/function .* does not exist|Could not find the function/i.test(error) && (
              <div className="mt-2 text-[13px]">La migration 20261009_suivi_agences_commerciaux.sql n’est pas encore appliquée en base.</div>
            )}
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-[#E2DFD8] bg-white p-16 text-center text-sm text-slate-500">Chargement du CA facturé…</div>
        ) : (
          <>
            {perimetre.restreint && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#EBD8AE] bg-[#FDF7EA] px-4 py-2.5 text-[13px] text-[#6B470E]">
                <span className="font-semibold">Votre périmètre :</span>
                {perimetre.collaborateurs.length > 0 ? (
                  <span>
                    {perimetre.collaborateurs.length > 1 ? 'collaborateurs ' : 'collaborateur '}
                    {perimetre.collaborateurs.map((c) => collabByCode.get(c)?.nom || c).join(', ')}
                  </span>
                ) : (
                  <span>
                    {perimetre.agences.length > 1 ? 'agences ' : 'agence '}
                    {perimetre.agences.join(', ')}
                  </span>
                )}
                <span className="text-[12px] text-[#8A5A11]">· la ligne Entreprise n’est donnée qu’en évolution (%), pour comparaison.</span>
              </div>
            )}
            {ficheHorsPerimetre && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#F0C5BE] bg-[#FCEFEC] px-4 py-2.5 text-[13px] text-[#7F1D1D]">
                <span>Cette fiche est hors de votre périmètre d’autorisation.</span>
                <button type="button" onClick={() => openFiche(null)} className="font-semibold underline">Fermer</button>
              </div>
            )}

            {/* KPI sélection */}
            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Kpi label={`CA ${annee} à date`} value={fmtK(totalLigne.caNDate)} sub={`${annee - 1} : ${fmtK(totalLigne.caN1Date)}`} />
              <Kpi
                label="vs objectif à date"
                value={totalLigne.realisation === null ? '—' : `${Math.round(totalLigne.realisation)} %`}
                tone={totalLigne.realisation === null ? 'text-slate-400' : totalLigne.realisation >= 100 ? 'text-[#1F6B3A]' : 'text-[#A32C2C]'}
                sub={
                  totalLigne.objectifADate === null
                    ? filtres.familles.length ? 'filtre familles actif' : 'aucun objectif'
                    : `${totalLigne.caNDate - totalLigne.objectifADate >= 0 ? '+' : ''}${fmtK(totalLigne.caNDate - totalLigne.objectifADate)} · obj. ${fmtK(totalLigne.objectifADate)}`
                }
                title={totalLigne.objectifCa !== null ? `Objectif annuel ${fmtEuro(totalLigne.objectifCa)} · attendu à fin ${MOIS_LONGS[moisClos] || '—'} : ${fmtPct(partADate * 100, 1, false)}` : undefined}
              />
              <Kpi
                label={`Objectif ${annee}`}
                value={totalLigne.objectifCa === null ? '—' : fmtK(totalLigne.objectifCa)}
                sub={totalLigne.objectifCa === null ? '' : `réalisé ${fmtPct((totalLigne.caNDate / totalLigne.objectifCa) * 100, 0, false)} · reste ${fmtK(Math.max(0, totalLigne.objectifCa - totalLigne.caNDate))}`}
              />
              <Kpi label="Évolution vs N-1" value={fmtPct(totalLigne.evol)} tone={toneOf(totalLigne.evol)} sub={`${totalLigne.ecart >= 0 ? '+' : ''}${fmtK(totalLigne.ecart)}`} />
              <Kpi label="Entreprise (réf.)" value={fmtPct(refLigne.evol)} tone={toneOf(refLigne.evol)} sub={exclusionsLibelle || 'toutes agences'} />
              <Kpi label="Écart vs entreprise" value={fmtPts(totalLigne.vsEntreprise)} tone={toneOf(totalLigne.vsEntreprise)} sub="sélection − entreprise" />
              <Kpi label="Taux de marge" value={fmtPct(totalLigne.marge, 1, false)} sub={`vs N-1 ${fmtPts(totalLigne.margeDelta)}`} />
              {creations && totalLigne.creations ? (
                <Kpi
                  label="Comptes créés"
                  value={String(totalLigne.creations.n)}
                  tone={totalLigne.creations.n >= totalLigne.creations.n1Prorata ? 'text-[#1F6B3A]' : 'text-[#A32C2C]'}
                  sub={`${annee - 1} : ${totalLigne.creations.n1} (prorata ${Math.round(totalLigne.creations.n1Prorata)})`}
                />
              ) : (
                <Kpi label={`CA ${annee - 1} année`} value={fmtK(totalLigne.caN1)} sub={`${annee - 2} : ${fmtK(sumMonths(serieTotal.ca[0], 1, 12))}`} />
              )}
            </div>

            <div className={`grid grid-cols-1 gap-4 ${showCross ? '2xl:grid-cols-[minmax(0,1fr)_640px]' : ''}`}>
              {/* ------------------------------------------------------ tableau */}
              <section className="min-w-0 rounded-2xl border border-[#E2DFD8] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EFEDE8] px-4 py-3">
                  <div className="text-[14px] font-bold text-slate-900">
                    {filtres.vue === 'agences' ? `${topLignes.length} agences` : `${topLignes.length} collaborateurs`}
                    <span className="ml-2 text-[12px] font-normal text-slate-500">cliquer sur un nom pour ouvrir la fiche</span>
                  </div>
                  {filtres.vue === 'agences' && (
                    <button
                      type="button"
                      onClick={() => setExpanded(allExpanded ? new Set() : new Set(lignesAgence.map((l) => l.entity.id)))}
                      className="rounded-lg border border-[#D8D3C8] px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:border-[#B4761A]"
                    >
                      {allExpanded ? '▾ Replier les agences' : '▸ Développer les agences'}
                    </button>
                  )}
                </div>
                {/* 17/11/2026 : volets figés — le tableau défile dans son cadre, en-têtes et 1re colonne restent visibles */}
                <div className="max-h-[calc(100vh-110px)] overflow-auto">
                  <table className="w-full min-w-[1360px] border-separate border-spacing-0 text-[13px]">
                    <thead className="sticky top-0 z-30 bg-[#FAF9F7] text-[11px] uppercase tracking-[0.05em] text-slate-500 shadow-[0_1px_0_#E2DFD8,0_2px_4px_rgba(17,24,32,0.06)]">
                      {/* 17/11/2026 : zones CA / Marge / Transfo devis / Comptes / Position */}
                      <tr className="text-[10px] tracking-[0.12em]">
                        <th className={`${FIGE} bg-[#FAF9F7] px-2 pt-2`} />
                        <th colSpan={9} className={`${ZONE} bg-[#EEF3F8] px-2 pt-2 pb-1 text-center font-bold text-[#245A9E]`}>Chiffre d’affaires</th>
                        <th colSpan={3} className={`${ZONE} bg-[#F1F6EF] px-2 pt-2 pb-1 text-center font-bold text-[#2F6B3A]`}>Marge</th>
                        <th colSpan={3} className={`${ZONE} bg-[#F7F2FA] px-2 pt-2 pb-1 text-center font-bold text-[#6B4E8A]`} title={libTransfo}>
                          Transfo devis {transfoData?.delai || DELAI_TRANSFO} j
                        </th>
                        {creations && <th className={`${ZONE} px-2 pt-2 pb-1 text-center font-bold`}>Comptes</th>}
                        <th className={`${ZONE} px-2 pt-2 pb-1 text-left font-bold`}>Position</th>
                      </tr>
                      <tr>
                        {header('label', filtres.vue === 'agences' ? 'Agence / collaborateur' : 'Collaborateur', 'left', undefined, `${FIGE} bg-[#FAF9F7]`)}
                        {header('caN1', `CA ${annee - 1}`, 'right', undefined, ZONE)}
                        {header('caN1Date', `${annee - 1} à date`)}
                        {header('caNDate', `${annee} à date`)}
                        {header(
                          'objectifADate',
                          'Obj. à date',
                          'right',
                          `Objectif annuel × répartition mensuelle du bilan, janvier → ${MOIS_LONGS[moisClos] || '—'} (${fmtPct(partADate * 100, 1, false)} de l’année). Objectif annuel = contrat d’objectifs quand il existe (agence : objectif « CA agence » d’un contrat, sinon somme des objectifs CA perso), sinon bilan commercial.`
                        )}
                        {header('evol', 'Évol. vs N-1', 'right', `CA ${annee} à date vs mêmes mois ${annee - 1}`)}
                        {header('realisation', 'Réal. / obj.', 'right', 'CA à date / objectif à date')}
                        {header('ecart', 'Écart €', 'right', `CA ${annee} à date − CA ${annee - 1} à date`)}
                        <th className="whitespace-nowrap px-2 py-2.5 text-center font-semibold" title="Évolution de chaque trimestre vs le même trimestre N-1">
                          T1 · T2 · T3 · T4
                        </th>
                        {header('vsEntreprise', 'vs entr.', 'right', `Évolution − évolution entreprise ${exclusionsLibelle}`)}
                        {header('marge', 'Taux', 'right', `Taux de marge ${annee} à date`, ZONE)}
                        {header('margeDelta', 'vs N-1', 'right', `Taux de marge − taux de marge ${annee - 1} sur les mêmes mois, en points`)}
                        {header('margeVsEntr', 'vs entr.', 'right', `Taux de marge − taux de marge entreprise ${exclusionsLibelle}, en points`)}
                        {header('transfo', 'Taux', 'right', libTransfo, ZONE)}
                        {header('transfoDelta', 'vs N-1', 'right', `Taux ${annee} − taux ${annee - 1} sur la même fenêtre de devis, en points`)}
                        {header('transfoVsEntr', 'vs entr.', 'right', `Taux − taux entreprise ${exclusionsLibelle}, en points`)}
                        {creations && header('creationsN', 'Créés', 'right', `Comptes clients créés en ${annee} (à ce jour), comparés à ${annee - 1} au prorata de l’année écoulée`, ZONE)}
                        <th className={`whitespace-nowrap px-2 py-2.5 text-left font-semibold ${ZONE}`}>Position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLignes.map((l) => {
                        const isAgence = l.entity.kind === 'agence'
                        const open = isAgence && expanded.has(l.entity.id)
                        const enfants = open
                          ? lignesCollab.filter((c) => ligneDeCode(c.entity.id) === l.entity.id).sort(sorter)
                          : []
                        return (
                          <LigneGroupe
                            key={l.entity.key}
                            ligne={l}
                            enfants={enfants}
                            open={open}
                            onToggle={isAgence ? () => toggleExpand(l.entity.id) : undefined}
                            onOpen={(key) => openFiche(key)}
                            showAgence={filtres.vue === 'collaborateurs'}
                            agenceEnfants={l.entity.horsContrats ? abrevAgence : undefined}
                            avecCreations={!!creations}
                          />
                        )
                      })}
                      {topLignes.length === 0 && (
                        <tr>
                          <td colSpan={20} className="px-4 py-10 text-center text-sm text-slate-500">
                            Aucune ligne pour cette sélection.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <LigneRow ligne={totalLigne} variant="total" avecCreations={!!creations} />
                      <LigneRow ligne={refLigne} variant="ref" masquerMontants={perimetre.restreint} avecCreations={!!creations} />
                    </tfoot>
                  </table>
                </div>
                <div className="border-t border-[#EFEDE8] px-4 py-2 text-[11px] text-slate-500">
                  Agence = agence de la fiche collaborateur. Trimestre en italique = trimestre en cours, comparé sur les mêmes mois. Obj. à date = objectif annuel ×{' '}
                  {repartition ? 'répartition mensuelle du bilan commercial (saisonnalité de l’année passée)' : 'prorata des mois clos'} ; Réal. / obj. = CA à date / objectif à date
                  {filtres.familles.length > 0 && ' (masqué : filtre familles actif)'}.
                  {creations && ` Comptes créés = bilan commercial${creations.moisBilan[annee] ? ` jusqu’à ${MOIS_LONGS[creations.moisBilan[annee] || 0]}` : ''}, puis fiches clients SAGE ; N-1 comparé au prorata de l’année écoulée.`}
                  {contrats.length > 0 && ' Agence avec contrats d’objectifs = collaborateurs sous contrat ; les autres collaborateurs de l’agence sont sur la ligne « · hors contrats ».'}
                  {` ${libTransfo}.`}
                </div>
              </section>

              {/* ------------------------------------------------------- croix */}
              {showCross && (
                <section className="rounded-2xl border border-[#E2DFD8] bg-white p-4">
                  <div className="mb-2">
                    <div className="text-[14px] font-bold text-slate-900">Croix de positionnement vs N-1</div>
                    <p className="text-[12px] text-slate-500">
                      Horizontal : évolution du CA cumulé à fin de trimestre vs {annee - 1} (ça va / ça va pas). Vertical : évolution du trimestre vs le même trimestre {annee - 1}
                      (ça va mieux / ça se dégrade). Couleur : rythme du trimestre comparé à la moyenne des trimestres précédents de l’année — T1 comparé au T4 {annee - 1} (écart de ±5 pt). ◆ = entreprise {exclusionsLibelle}.
                    </p>
                  </div>
                  <PositionCross points={crossPoints} nbTrimestres={nbTrimestres} onSelect={(key) => openFiche(key)} />
                </section>
              )}
            </div>
          </>
        )}
      </main>

      {fiche && (
        <FicheDetail
          entity={fiche.entity}
          annee={annee}
          moisClos={moisClos}
          moisMax={moisMax}
          serie={fiche.serie}
          refSerie={refSerie}
          rowsEntite={ficheRows}
          refRows={refRows}
          famillesFiltre={filtres.familles}
          objectifs={ficheObjectifs}
          exclusionsLibelle={exclusionsLibelle}
          impayes={ficheImpayes}
          repartition={repartition}
          partADate={partADate}
          creations={ficheCreations}
          onClose={() => openFiche(null)}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Lignes du tableau
// ----------------------------------------------------------------------------
function LigneGroupe({
  ligne,
  enfants,
  open,
  onToggle,
  onOpen,
  showAgence,
  agenceEnfants,
  avecCreations,
}: {
  ligne: Ligne
  enfants: Ligne[]
  open: boolean
  onToggle?: () => void
  onOpen: (key: string) => void
  showAgence: boolean
  /** Ligne « Hors contrats » : agence de chaque collaborateur en abrégé (nom complet → abréviation). */
  agenceEnfants?: Map<string, string>
  avecCreations: boolean
}) {
  return (
    <>
      <LigneRow ligne={ligne} open={open} onToggle={onToggle} onOpen={onOpen} showAgence={showAgence} avecCreations={avecCreations} />
      {enfants.map((e) => (
        <LigneRow key={e.entity.key} ligne={e} child onOpen={onOpen} agenceCourte={agenceEnfants ? agenceEnfants.get(e.entity.agence) || e.entity.agence : undefined} avecCreations={avecCreations} />
      ))}
    </>
  )
}

function LigneRow({
  ligne: l,
  open,
  onToggle,
  onOpen,
  child,
  showAgence,
  variant,
  masquerMontants,
  agenceCourte,
  avecCreations = false,
}: {
  ligne: Ligne
  /** Agence abrégée affichée après le nom (collaborateurs de la ligne « Hors contrats »). */
  agenceCourte?: string
  avecCreations?: boolean
  open?: boolean
  onToggle?: () => void
  onOpen?: (key: string) => void
  child?: boolean
  showAgence?: boolean
  variant?: 'total' | 'ref'
  /** Référence entreprise pour un utilisateur restreint : % seulement. */
  masquerMontants?: boolean
}) {
  const mask = (v: string) => (masquerMontants ? <span className="text-slate-300">—</span> : v)
  const last = l.positions[l.positions.length - 1]
  const quadrant = quadrantOf(last)
  const rowClass =
    variant === 'total'
      ? 'bg-[#FAF9F7] font-bold [&>td]:border-t-2 [&>td]:border-[#111820]'
      : variant === 'ref'
      ? 'bg-[#FDF7EA] text-[#6B470E]'
      : child
      ? 'bg-[#FCFBF9] hover:bg-[#F7F5F0] [&>td]:border-t [&>td]:border-[#F1EFEA]'
      : l.entity.horsContrats
      ? 'bg-[#F7F5F0] hover:bg-[#F1EFEA] [&>td]:border-t-2 [&>td]:border-[#D8D3C8]'
      : 'bg-white hover:bg-[#FAF9F7] [&>td]:border-t [&>td]:border-[#EFEDE8]'

  // 17/11/2026 : valeur et unité toujours sur une seule ligne (whitespace-nowrap)
  return (
    <tr className={`${rowClass} whitespace-nowrap`}>
      <td className={`${FIGE} bg-inherit px-2 py-2`}>
        <div className={`flex items-center gap-1.5 ${child ? 'pl-7' : ''}`}>
          {onToggle && (
            <button type="button" onClick={onToggle} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-[#EDEAE3] hover:text-slate-700" aria-label={open ? 'Replier' : 'Déplier'}>
              {open ? '▾' : '▸'}
            </button>
          )}
          {onOpen ? (
            <button type="button" onClick={() => onOpen(l.entity.key)} className={`truncate text-left hover:text-[#245A9E] hover:underline ${child ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'} ${l.entity.sommeil ? 'italic text-slate-400' : ''}`}>
              {l.entity.label}
            </button>
          ) : (
            <span>{l.entity.label}</span>
          )}
          {showAgence && <span className="shrink-0 rounded bg-[#EDEAE3] px-1.5 text-[10px] font-semibold text-slate-500">{l.entity.agence}</span>}
          {l.entity.sommeil && <span className="shrink-0 text-[10px] text-slate-400">sommeil</span>}
          {agenceCourte && (
            <span className="shrink-0 text-[11px] text-slate-500" title={l.entity.agence}>
              ({agenceCourte})
            </span>
          )}
        </div>
      </td>
      {/* 17/11/2026 : montants en k€ / M€ (détail exact au survol) */}
      <td className={`px-2 py-2 text-right tabular-nums text-slate-600 ${ZONE}`} title={masquerMontants ? undefined : fmtEuro(l.caN1)}>{mask(fmtK(l.caN1))}</td>
      <td className="px-2 py-2 text-right tabular-nums" title={masquerMontants ? undefined : fmtEuro(l.caN1Date)}>{mask(fmtK(l.caN1Date))}</td>
      <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900" title={masquerMontants ? undefined : fmtEuro(l.caNDate)}>{mask(fmtK(l.caNDate))}</td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-600" title={l.objectifCa !== null ? `Objectif annuel ${fmtEuro(l.objectifCa)}` : undefined}>
        {l.objectifADate === null ? <span className="text-slate-300">—</span> : mask(fmtK(l.objectifADate))}
      </td>
      <td className={`px-2 py-2 text-right font-semibold tabular-nums ${toneOf(l.evol)}`}>{fmtPct(l.evol)}</td>
      <td
        className="px-2 py-2 text-right tabular-nums"
        title={l.objectifADate !== null ? `${fmtEuro(l.caNDate)} / ${fmtEuro(l.objectifADate)} (écart ${l.caNDate - l.objectifADate >= 0 ? '+' : ''}${fmtK(l.caNDate - l.objectifADate)})` : undefined}
      >
        {l.realisation === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span className={`rounded px-1.5 py-0.5 text-[12px] font-semibold ${l.realisation >= 100 ? 'bg-[#E5F2E8] text-[#1F6B3A]' : l.realisation >= 90 ? 'bg-[#FBF1DC] text-[#8A5A11]' : 'bg-[#FBE6E3] text-[#A32C2C]'}`}>
            {Math.round(l.realisation)} %
          </span>
        )}
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${masquerMontants ? '' : toneOf(l.ecart, 1)}`}>{mask(`${l.ecart > 0 ? '+' : ''}${fmtK(l.ecart)}`)}</td>
      <td className="px-2 py-2">
        <div className="flex justify-center gap-1">
          {l.trims.map((t, i) =>
            t ? (
              <span
                key={i}
                className={`min-w-[46px] rounded px-1 py-0.5 text-center text-[11px] font-semibold tabular-nums ${t.partiel ? 'italic' : ''} ${
                  t.evol === null ? 'bg-[#F1EFEA] text-slate-400' : t.evol >= 0 ? 'bg-[#E5F2E8] text-[#1F6B3A]' : 'bg-[#FBE6E3] text-[#A32C2C]'
                }`}
                title={`T${t.q}${t.partiel ? ' (en cours)' : ''} vs N-1`}
              >
                {t.evol === null ? '—' : `${t.evol > 0 ? '+' : ''}${Math.round(t.evol)}%`}
              </span>
            ) : (
              <span key={i} className="min-w-[46px] rounded bg-[#F7F5F0] px-1 py-0.5 text-center text-[11px] text-slate-300">
                T{i + 1}
              </span>
            )
          )}
        </div>
      </td>
      <td className={`px-2 py-2 text-right tabular-nums ${variant === 'ref' ? '' : toneOf(l.vsEntreprise)}`}>{variant === 'ref' ? '—' : fmtPts(l.vsEntreprise)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${ZONE}`}>{fmtPct(l.marge, 1, false)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${toneOf(l.margeDelta, 0.1)}`}>{fmtPts(l.margeDelta)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${variant === 'ref' ? '' : toneOf(l.margeVsEntr, 0.1)}`}>{variant === 'ref' ? '—' : fmtPts(l.margeVsEntr)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${ZONE}`}>{fmtPct(l.transfo, 1, false)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${toneOf(l.transfoDelta, 0.1)}`}>{fmtPts(l.transfoDelta)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${variant === 'ref' ? '' : toneOf(l.transfoVsEntr, 0.1)}`}>{variant === 'ref' ? '—' : fmtPts(l.transfoVsEntr)}</td>
      {avecCreations && (
        <td
          className={`px-2 py-2 text-right tabular-nums ${ZONE}`}
          title={l.creations ? `${l.creations.n} en N à ce jour · N-1 : ${l.creations.n1} sur l’année (prorata ${l.creations.n1Prorata.toFixed(1)})${l.creations.avecSage ? ' · derniers mois : fiches SAGE' : ''}` : undefined}
        >
          {!l.creations || (l.creations.n === 0 && l.creations.n1 === 0) ? (
            <span className="text-slate-300">—</span>
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <span className={`font-semibold ${l.creations.n >= l.creations.n1Prorata ? 'text-[#1F6B3A]' : 'text-[#A32C2C]'}`}>{l.creations.n}</span>
              <span className="text-[11px] text-slate-400">/ {l.creations.n1}</span>
            </span>
          )}
        </td>
      )}
      <td className={`px-2 py-2 ${ZONE}`}>
        {quadrant ? (
          <div className="flex items-center gap-1">
            <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: QUADRANT_LIBELLES[quadrant].bg, color: QUADRANT_LIBELLES[quadrant].tone }}>
              {QUADRANT_LIBELLES[quadrant].label}
            </span>
            {last?.dynamique && (
              <span
                className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: DYNAMIQUE_LIBELLES[last.dynamique].bg, color: DYNAMIQUE_LIBELLES[last.dynamique].tone }}
                title={`T${last.q} : ${fmtPct(last.y)} vs N-1, ${fmtPts(last.ecartTendance)} vs moyenne des trimestres précédents`}
              >
                {DYNAMIQUE_LIBELLES[last.dynamique].court}
              </span>
            )}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  )
}

function Kpi({ label, value, sub, tone = 'text-slate-900', title }: { label: string; value: string; sub?: string; tone?: string; title?: string }) {
  return (
    <div className="rounded-xl border border-[#E2DFD8] bg-white px-3.5 py-3" title={title}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-[19px] font-bold leading-tight ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

