'use client'

// ============================================================================
// app/analyse-ventes/page.tsx — Analyse des ventes & devis (Mon activité) — 26/11/2026
// ----------------------------------------------------------------------------
// Demande de Michaël G. relayée par Arnaud : sortir en quelques clics, pour un
// ou plusieurs clients et une période, le CA et les quantités par catégorie
// (famille macro / famille) et par article, avec export Excel ; même lecture
// sur les devis (références et familles les plus devisées / transformées).
//
// Construit sur le moteur du Requêteur (Admin) avec un niveau de lecture choisi
// par l'utilisateur :
//   1. la source, choisie dès le départ (règle d'Arnaud) : lignes de factures,
//      de BL (facturés + non facturés), de CDC ou de devis ;
//   2. les clients (plusieurs possibles) et la période, lue sur la date de la
//      source (date de facture, de BL, de CDC ou de devis) ;
//   3. « Regrouper par » (famille macro, famille, article, client, mois…),
//      « Mesures » (quantité, CA HT, nombre de clients…), Top N, sous-totaux,
//      part du CA ;
//   4. des filtres complémentaires (agence, famille, marque, autres dates…).
// Le résultat s'affiche en arborescence repliable avec sous-totaux, se trie
// d'un clic et s'exporte sur Excel (groupes en plan, critères en tête).
//
// Données : RPC analyse_catalogue / analyse_valeurs / analyse_clients /
// analyse_executer, table analyse_modeles (migration 20261126d_analyse_ventes_devis.sql).
// Droits : can_analyse_ventes (écran), can_voir_marge (mesures de marge) ;
// périmètre agences / collaborateurs appliqué en base.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ───────────────────────────────────────────────────────────────────

type TypeChamp = 'texte' | 'liste' | 'nombre' | 'montant' | 'pourcent' | 'date'
type Role = 'dimension' | 'mesure' | 'filtre'

type Champ = {
  code: string
  libelle: string
  groupe: string
  role: Role
  type: TypeChamp
  description: string | null
  a_valeurs: boolean
}

type Source = {
  code: string
  libelle: string
  description: string | null
  icone: string | null
  date_libelle: string
  famille: 'ventes' | 'devis'
  champs: Champ[]
}

type Catalogue = {
  droits: { voir_marge: boolean; partager: boolean; perimetre_limite: boolean }
  sources: Source[]
}

type Filtre = {
  id: string
  champ: string
  operateur: string
  valeur: string
  valeur2: string
  valeurs: string[]
}

type Colonne = { code: string; libelle: string; type: TypeChamp }

type Resultat = {
  dimensions: Colonne[]
  mesures: Colonne[]
  lignes: unknown[][]
  sous_totaux: unknown[][]
  total: unknown[] | null
  nb: number
  tronque: boolean
  limite?: number
  executee: boolean
  alerte: { niveau: 'lourd' | 'bloquant'; message: string } | null
  perimetre_limite?: boolean
  duree_ms: number
}

type Definition = {
  dimensions: string[]
  mesures: string[]
  filtres: Omit<Filtre, 'id'>[]
  tri: { champ: string; sens: 'asc' | 'desc' }[]
  top: number | null
  sous_totaux: boolean
  part_ca: boolean
}

type Modele = {
  id: string
  nom: string
  description: string | null
  source: string
  definition: Definition
  partage: boolean
  ordre: number
  created_by: string
}

type Client = { code: string; nom: string; ville: string | null; ca_12m: number | null; dernier_mois: string | null }

/** Ligne affichée (détail, sous-total ou total). */
type LigneAff = {
  cle: string
  niveau: number // 0 = total, 1..n = profondeur ; n = détail
  detail: boolean
  dims: unknown[]
  mes: unknown[]
  nbEnfants: number
}

// ── Vocabulaire ─────────────────────────────────────────────────────────────

const OPERATEURS: Record<TypeChamp, { code: string; libelle: string }[]> = {
  liste: [
    { code: 'parmi', libelle: 'est' },
    { code: 'hors', libelle: "n'est pas" },
    { code: 'contient', libelle: 'contient le texte' },
  ],
  texte: [
    { code: 'contient', libelle: 'contient' },
    { code: 'est', libelle: 'est exactement' },
    { code: 'commence', libelle: 'commence par' },
    { code: 'ne_contient_pas', libelle: 'ne contient pas' },
    { code: 'parmi', libelle: 'est dans ma liste (collée)' },
  ],
  nombre: [
    { code: 'sup', libelle: 'supérieur à' },
    { code: 'sup_egal', libelle: 'supérieur ou égal à' },
    { code: 'inf', libelle: 'inférieur à' },
    { code: 'inf_egal', libelle: 'inférieur ou égal à' },
    { code: 'egal', libelle: 'égal à' },
    { code: 'entre', libelle: 'entre' },
  ],
  montant: [],
  pourcent: [],
  date: [
    { code: 'periode', libelle: 'période' },
    { code: 'entre', libelle: 'entre le' },
    { code: 'depuis', libelle: 'depuis le' },
    { code: 'avant', libelle: "jusqu'au" },
    { code: 'le', libelle: 'le' },
    { code: 'vide', libelle: "n'est pas renseignée" },
    { code: 'non_vide', libelle: 'est renseignée' },
  ],
}
OPERATEURS.montant = OPERATEURS.nombre
OPERATEURS.pourcent = OPERATEURS.nombre

const PERIODES: { code: string; libelle: string }[] = [
  { code: 'mois_en_cours', libelle: 'Mois en cours' },
  { code: 'mois_dernier', libelle: 'Mois dernier' },
  { code: '3_derniers_mois', libelle: '3 derniers mois' },
  { code: 'annee_en_cours', libelle: 'Année en cours' },
  { code: 'annee_derniere', libelle: 'Année dernière' },
  { code: 'semaine_en_cours', libelle: 'Semaine en cours' },
  { code: 'semaine_derniere', libelle: 'Semaine dernière' },
  { code: '30_derniers_jours', libelle: '30 derniers jours' },
  { code: '7_derniers_jours', libelle: '7 derniers jours' },
  { code: 'aujourdhui', libelle: "Aujourd'hui" },
  { code: 'hier', libelle: 'Hier' },
]

const TOPS: { valeur: number | null; libelle: string }[] = [
  { valeur: null, libelle: 'Tout' },
  { valeur: 10, libelle: 'Top 10' },
  { valeur: 20, libelle: 'Top 20' },
  { valeur: 50, libelle: 'Top 50' },
  { valeur: 100, libelle: 'Top 100' },
]

/** Champs pilotés par les blocs dédiés (clients, période, hors statistique). */
const CHAMPS_DEDIES = new Set(['code_client', 'date_ref', 'hors_statistique'])

const fmtMontant = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })
const fmtPct = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function fmtDateIso(v: unknown) {
  if (typeof v !== 'string' || v.length < 10) return v == null ? '' : String(v)
  const [a, m, j] = v.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

function formatCellule(v: unknown, type: TypeChamp): string {
  if (v == null || v === '') return ''
  if (type === 'date') return fmtDateIso(v)
  if (type === 'montant') return fmtMontant.format(Number(v))
  if (type === 'pourcent') return `${fmtPct.format(Number(v))} %`
  if (type === 'nombre') return fmtNombre.format(Number(v))
  return String(v)
}

function estNumerique(type: TypeChamp) {
  return type === 'nombre' || type === 'montant' || type === 'pourcent'
}

function nouvelId() {
  return Math.random().toString(36).slice(2, 10)
}

function filtreParDefaut(champ: Champ): Filtre {
  const op = champ.type === 'date' ? 'periode' : champ.type === 'liste' ? 'parmi' : estNumerique(champ.type) ? 'sup' : 'contient'
  return { id: nouvelId(), champ: champ.code, operateur: op, valeur: champ.type === 'date' ? 'annee_en_cours' : '', valeur2: '', valeurs: [] }
}

function decrireFiltre(f: Filtre, champ: Champ | undefined) {
  if (!champ) return ''
  const op = OPERATEURS[champ.type].find((o) => o.code === f.operateur)?.libelle ?? f.operateur
  if (f.operateur === 'vide' || f.operateur === 'non_vide') return `${champ.libelle} ${op}`
  if (f.operateur === 'periode') return `${champ.libelle} : ${PERIODES.find((p) => p.code === f.valeur)?.libelle ?? f.valeur}`
  if (f.operateur === 'parmi' || f.operateur === 'hors') {
    const liste = f.valeurs.length ? f.valeurs : f.valeur.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean)
    return `${champ.libelle} ${op} ${liste.join(', ') || '…'}`
  }
  if (f.operateur === 'entre') {
    const a = champ.type === 'date' ? fmtDateIso(f.valeur) : f.valeur
    const b = champ.type === 'date' ? fmtDateIso(f.valeur2) : f.valeur2
    return `${champ.libelle} entre ${a || '…'} et ${b || '…'}`
  }
  return `${champ.libelle} ${op} ${champ.type === 'date' ? fmtDateIso(f.valeur) : f.valeur || '…'}`
}

function filtreComplet(f: Filtre) {
  if (f.operateur === 'vide' || f.operateur === 'non_vide') return true
  if (f.operateur === 'parmi' || f.operateur === 'hors') return f.valeurs.length > 0 || f.valeur.trim() !== ''
  if (f.operateur === 'entre') return f.valeur.trim() !== '' && f.valeur2.trim() !== ''
  return f.valeur.trim() !== ''
}

function grouper<T extends { groupe: string }>(liste: T[]) {
  const m = new Map<string, T[]>()
  for (const x of liste) {
    if (!m.has(x.groupe)) m.set(x.groupe, [])
    m.get(x.groupe)!.push(x)
  }
  return Array.from(m.entries())
}

const fmtKeuros = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

/** CA facturé 12 mois glissants, en k€ (aide à choisir le bon compte quand un client en a plusieurs). */
function libelleActivite(c: Client) {
  if (!c.ca_12m) return 'aucune facture sur 12 mois'
  const mois = c.dernier_mois ? ` · dernière facture ${c.dernier_mois.slice(5, 7)}/${c.dernier_mois.slice(0, 4)}` : ''
  return `${fmtKeuros.format(c.ca_12m / 1000)} k€ facturés sur 12 mois${mois}`
}

function cleDe(vals: unknown[]) {
  return vals.map((v) => (v == null ? '∅' : String(v))).join('¦')
}

function comparer(a: unknown, b: unknown, type: TypeChamp) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return estNumerique(type) ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'fr', { numeric: true })
}

// ── Petits composants ───────────────────────────────────────────────────────

function Etape({ numero, titre, aide, children, droite }: { numero: number; titre: string; aide?: string; children: React.ReactNode; droite?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#245A9E] text-sm font-black text-white">{numero}</span>
          <div>
            <h2 className="text-base font-black text-slate-900">{titre}</h2>
            {aide && <p className="text-xs text-slate-500">{aide}</p>}
          </div>
        </div>
        {droite}
      </div>
      {children}
    </section>
  )
}

/** Liste de valeurs à cocher, avec recherche (champs de type « liste »). */
function ChoixValeurs({ source, champ, valeurs, onChange }: { source: string; champ: string; valeurs: string[]; onChange: (v: string[]) => void }) {
  const [options, setOptions] = useState<string[] | null>(null)
  const [recherche, setRecherche] = useState('')
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let annule = false
    supabase.rpc('analyse_valeurs', { p_source: source, p_champ: champ }).then(({ data }) => {
      if (!annule) setOptions((data as string[] | null) ?? [])
    })
    return () => {
      annule = true
    }
  }, [source, champ])

  useEffect(() => {
    if (!ouvert) return
    const fermer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', fermer)
    return () => document.removeEventListener('mousedown', fermer)
  }, [ouvert])

  const visibles = (options ?? []).filter((o) => o.toLowerCase().includes(recherche.toLowerCase()))
  const basculer = (o: string) => onChange(valeurs.includes(o) ? valeurs.filter((x) => x !== o) : [...valeurs, o])

  return (
    <div className="relative min-w-[220px] flex-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOuvert((x) => !x)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm hover:border-slate-400"
      >
        <span className={valeurs.length ? 'text-slate-900' : 'text-slate-400'}>
          {valeurs.length === 0 ? 'Choisir une ou plusieurs valeurs…' : valeurs.length <= 3 ? valeurs.join(', ') : `${valeurs.length} valeurs choisies`}
        </span>
        <span className="text-slate-400">▾</span>
      </button>
      {ouvert && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <input autoFocus value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher…" className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <div className="mb-1 flex gap-3 px-1 text-xs">
            <button type="button" className="text-blue-700 hover:underline" onClick={() => onChange(Array.from(new Set([...valeurs, ...visibles])))}>
              Tout cocher
            </button>
            <button type="button" className="text-blue-700 hover:underline" onClick={() => onChange([])}>
              Tout décocher
            </button>
          </div>
          <div className="max-h-64 overflow-auto">
            {options === null && <div className="p-2 text-sm text-slate-500">Chargement…</div>}
            {options !== null && visibles.length === 0 && <div className="p-2 text-sm text-slate-500">Aucune valeur</div>}
            {visibles.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={valeurs.includes(o)} onChange={() => basculer(o)} />
                {o}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Choix de plusieurs clients : recherche par code, nom ou ville. */
function ChoixClients({ codes, onChange }: { codes: string[]; onChange: (codes: string[]) => void }) {
  const [recherche, setRecherche] = useState('')
  const [resultats, setResultats] = useState<Client[]>([])
  const [connus, setConnus] = useState<Record<string, Client>>({})
  const [ouvert, setOuvert] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Noms des clients déjà choisis (modèle rechargé, etc.)
  useEffect(() => {
    const manquants = codes.filter((c) => !connus[c])
    if (!manquants.length) return
    supabase.rpc('analyse_clients', { p_recherche: null, p_codes: manquants }).then(({ data }) => {
      const liste = (data as Client[] | null) ?? []
      setConnus((k) => ({ ...k, ...Object.fromEntries(liste.map((c) => [c.code, c])) }))
    })
  }, [codes, connus])

  useEffect(() => {
    const q = recherche.trim()
    if (q.length < 2) return
    const t = setTimeout(() => {
      supabase.rpc('analyse_clients', { p_recherche: q, p_codes: null }).then(({ data }) => {
        const liste = (data as Client[] | null) ?? []
        setResultats(liste)
        setConnus((k) => ({ ...k, ...Object.fromEntries(liste.map((c) => [c.code, c])) }))
        setOuvert(true)
      })
    }, 250)
    return () => clearTimeout(t)
  }, [recherche])

  useEffect(() => {
    if (!ouvert) return
    const fermer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false)
    }
    document.addEventListener('mousedown', fermer)
    return () => document.removeEventListener('mousedown', fermer)
  }, [ouvert])

  const basculer = (code: string) => onChange(codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code])
  const proposes = recherche.trim().length >= 2 ? resultats : []

  return (
    <div className="space-y-2" ref={ref}>
      <div className="relative">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          onFocus={() => proposes.length > 0 && setOuvert(true)}
          placeholder="🔍 Rechercher un client (code, nom ou ville)…"
          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        {ouvert && proposes.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {proposes.map((c) => (
              <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={codes.includes(c.code)} onChange={() => basculer(c.code)} />
                <span className="font-mono text-xs text-slate-500">{c.code}</span>
                <span className="font-semibold">{c.nom}</span>
                {c.ville && <span className="text-xs text-slate-400">{c.ville}</span>}
                <span className={`ml-auto whitespace-nowrap text-xs ${c.ca_12m ? 'text-emerald-700' : 'text-amber-700'}`}>{libelleActivite(c)}</span>
              </label>
            ))}
          </div>
        )}
        {ouvert && recherche.trim().length >= 2 && proposes.length === 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-500 shadow-xl">Aucun client trouvé dans votre périmètre.</div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {codes.length === 0 && <span className="text-xs text-slate-500">Tous les clients de votre périmètre.</span>}
        {codes.map((c) => (
          <span
            key={c}
            title={connus[c] ? libelleActivite(connus[c]) : undefined}
            className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1.5 text-xs ${
              connus[c] && !connus[c].ca_12m ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'
            }`}
          >
            <span className="font-mono">{c}</span>
            {connus[c] && <span className="font-semibold">{connus[c].nom}</span>}
            {connus[c] && !connus[c].ca_12m && <span>· aucune facture sur 12 mois</span>}
            <button onClick={() => basculer(c)} className="px-1 text-blue-400 hover:text-red-600" title="Retirer">
              ✕
            </button>
          </span>
        ))}
        {codes.length > 1 && (
          <button onClick={() => onChange([])} className="text-xs text-blue-700 hover:underline">
            Tout retirer
          </button>
        )}
      </div>
    </div>
  )
}

// ── Construction de l'arborescence ──────────────────────────────────────────

function construireLignes(
  res: Resultat,
  sousTotaux: boolean,
  tri: { index: number; sens: 'asc' | 'desc' } | null,
  repliees: Set<string>,
): LigneAff[] {
  const n = res.dimensions.length
  const nbMes = res.mesures.length
  const cols = [...res.dimensions, ...res.mesures]
  const detail: LigneAff[] = res.lignes.map((l) => ({
    cle: cleDe(l.slice(0, n)),
    niveau: n,
    detail: true,
    dims: l.slice(0, n),
    mes: l.slice(n, n + nbMes),
    nbEnfants: 0,
  }))

  const trier = (liste: LigneAff[]) => {
    if (!tri) return liste
    const type = cols[tri.index].type
    return [...liste].sort((a, b) => {
      const va = tri.index < n ? a.dims[tri.index] : a.mes[tri.index - n]
      const vb = tri.index < n ? b.dims[tri.index] : b.mes[tri.index - n]
      const r = comparer(va, vb, type)
      return tri.sens === 'asc' ? r : -r
    })
  }

  // Liste plate (une dimension, Top N, ou sous-totaux désactivés)
  if (!sousTotaux || n < 2 || res.sous_totaux.length === 0) return trier(detail)

  // Sous-totaux : niveau k = k premières dimensions renseignées
  const parNiveau = new Map<number, Map<string, LigneAff>>()
  for (const l of res.sous_totaux) {
    const g = Number(l[l.length - 1])
    let agreges = 0
    for (let b = 0; b < n; b++) if (g & (1 << b)) agreges++
    const k = n - agreges
    const dims = l.slice(0, k)
    if (!parNiveau.has(k)) parNiveau.set(k, new Map())
    parNiveau.get(k)!.set(cleDe(dims), { cle: cleDe(dims), niveau: k, detail: false, dims: l.slice(0, n), mes: l.slice(n, n + nbMes), nbEnfants: 0 })
  }

  const enfantsDe = (prefixe: unknown[], k: number): LigneAff[] => {
    if (k === n) return detail.filter((d) => cleDe(d.dims.slice(0, k - 1)) === cleDe(prefixe))
    const m = parNiveau.get(k)
    if (!m) return []
    return Array.from(m.values()).filter((s) => cleDe(s.dims.slice(0, k - 1)) === cleDe(prefixe))
  }

  // Index des détails par préfixe pour éviter les parcours répétés
  const detailParParent = new Map<string, LigneAff[]>()
  for (const d of detail) {
    const p = cleDe(d.dims.slice(0, n - 1))
    if (!detailParParent.has(p)) detailParParent.set(p, [])
    detailParParent.get(p)!.push(d)
  }

  const sortie: LigneAff[] = []
  const parcourir = (prefixe: unknown[], k: number) => {
    const enfants = k === n ? detailParParent.get(cleDe(prefixe)) ?? [] : enfantsDe(prefixe, k)
    for (const e of trier(enfants)) {
      if (!e.detail) {
        const pfx = e.dims.slice(0, k)
        const nb = k + 1 === n ? (detailParParent.get(cleDe(pfx)) ?? []).length : enfantsDe(pfx, k + 1).length
        sortie.push({ ...e, nbEnfants: nb })
        if (!repliees.has(e.cle)) parcourir(pfx, k + 1)
      } else {
        sortie.push(e)
      }
    }
  }
  parcourir([], 1)
  return sortie
}

// ── Export Excel ────────────────────────────────────────────────────────────

async function exporterExcel(params: {
  titre: string
  source: Source
  res: Resultat
  lignes: LigneAff[]
  partCa: boolean
  idxCa: number
  criteres: string[]
}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM — Analyse des ventes & devis'
  const ws = wb.addWorksheet('Analyse', { properties: { outlineLevelRow: params.res.dimensions.length } })
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: false }

  const { res } = params
  const n = res.dimensions.length
  const colonnes: Colonne[] = [...res.dimensions, ...res.mesures, ...(params.partCa ? [{ code: '_part', libelle: '% du CA', type: 'pourcent' as TypeChamp }] : [])]
  const totalCa = params.idxCa >= 0 && res.total ? Number(res.total[params.idxCa]) : 0

  // En-tête : titre et critères
  ws.addRow([params.titre]).font = { bold: true, size: 14 }
  ws.addRow([`${params.source.libelle} — extrait le ${new Date().toLocaleString('fr-FR')}`]).font = { italic: true, color: { argb: 'FF64748B' } }
  for (const c of params.criteres) ws.addRow([c])
  ws.addRow([])
  const ligneEntete = ws.rowCount + 1

  const entete = ws.addRow(colonnes.map((c) => c.libelle))
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  entete.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF245A9E' } }
  entete.alignment = { vertical: 'middle', wrapText: true }
  ws.views = [{ state: 'frozen', ySplit: ligneEntete }]

  const valeurs = (l: LigneAff) => {
    const dims = l.dims.map((v, i) => {
      if (!l.detail && i >= l.niveau) return i === l.niveau ? `Sous-total (${l.nbEnfants})` : null
      const t = res.dimensions[i].type
      if (v == null || v === '') return null
      if (t === 'date' && typeof v === 'string') {
        const [a, m, j] = v.slice(0, 10).split('-').map(Number)
        return new Date(Date.UTC(a, m - 1, j))
      }
      return v
    })
    const mes = l.mes.map((v) => (v == null ? null : Number(v)))
    const part = params.partCa ? [totalCa ? Number(l.mes[params.idxCa] ?? 0) / totalCa * 100 : null] : []
    return [...dims, ...mes, ...part]
  }

  for (const l of params.lignes) {
    const row = ws.addRow(valeurs(l))
    if (!l.detail) {
      row.font = { bold: true }
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: l.niveau === 1 ? 'FFDCE7F5' : 'FFEFF4FA' } }
      row.outlineLevel = Math.max(0, l.niveau - 1)
    } else {
      row.outlineLevel = Math.max(0, n - 1)
    }
  }
  if (res.total) {
    const tot = ws.addRow([
      'Total général',
      ...Array(Math.max(0, n - 1)).fill(null),
      ...res.total.map((v) => (v == null ? null : Number(v))),
      ...(params.partCa ? [100] : []),
    ])
    tot.font = { bold: true }
    tot.border = { top: { style: 'thin' } }
  }

  colonnes.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.type === 'date') col.numFmt = 'dd/mm/yyyy'
    if (c.type === 'montant') col.numFmt = '#,##0.00'
    if (c.type === 'nombre') col.numFmt = '#,##0.##'
    if (c.type === 'pourcent') col.numFmt = '0.0'
    const largeurs = params.lignes.slice(0, 300).map((l) => String(valeurs(l)[i] ?? '').length + 2)
    col.width = Math.min(50, Math.max(12, c.libelle.length + 2, ...largeurs))
  })
  if (!res.sous_totaux.length && params.lignes.length) {
    ws.autoFilter = { from: { row: ligneEntete, column: 1 }, to: { row: ligneEntete + params.lignes.length, column: colonnes.length } }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  a.href = url
  a.download = `Analyse_${params.titre.replace(/[^A-Za-z0-9À-ÿ]+/g, '_').slice(0, 60)}_${stamp}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AnalyseVentesPage() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [erreurCatalogue, setErreurCatalogue] = useState<string | null>(null)
  const [sourceCode, setSourceCode] = useState<string | null>(null)

  // Définition de l'analyse
  const [clients, setClients] = useState<string[]>([])
  const [periode, setPeriode] = useState<{ operateur: 'periode' | 'entre'; valeur: string; valeur2: string }>({ operateur: 'periode', valeur: 'annee_en_cours', valeur2: '' })
  const [horsStat, setHorsStat] = useState(true) // exclure les articles hors statistique
  const [dimensions, setDimensions] = useState<string[]>([])
  const [mesures, setMesures] = useState<string[]>([])
  const [top, setTop] = useState<number | null>(null)
  const [sousTotaux, setSousTotaux] = useState(true)
  const [partCa, setPartCa] = useState(true)
  const [filtres, setFiltres] = useState<Filtre[]>([])
  const [triServeur, setTriServeur] = useState<{ champ: string; sens: 'asc' | 'desc' }[]>([])
  const [ajoutFiltre, setAjoutFiltre] = useState('')

  // Résultat
  const [resultat, setResultat] = useState<Resultat | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [tri, setTri] = useState<{ index: number; sens: 'asc' | 'desc' } | null>(null)
  const [repliees, setRepliees] = useState<Set<string>>(new Set())
  const [defLancee, setDefLancee] = useState<string>('')
  const [sousTotauxLances, setSousTotauxLances] = useState(true)
  const [partCaLancee, setPartCaLancee] = useState(true)

  // Modèles
  const [modeles, setModeles] = useState<Modele[]>([])
  const [modeleActif, setModeleActif] = useState<Modele | null>(null)
  const [moi, setMoi] = useState('')
  const [fenetreEnregistrer, setFenetreEnregistrer] = useState(false)
  const [nomModele, setNomModele] = useState('')
  const [partageModele, setPartageModele] = useState(false)

  const source = useMemo(() => catalogue?.sources.find((s) => s.code === sourceCode) ?? null, [catalogue, sourceCode])
  const champParCode = useMemo(() => new Map((source?.champs ?? []).map((c) => [c.code, c])), [source])
  const champsDimension = useMemo(() => (source?.champs ?? []).filter((c) => c.role === 'dimension'), [source])
  const champsMesure = useMemo(() => (source?.champs ?? []).filter((c) => c.role === 'mesure'), [source])
  const champsFiltrables = useMemo(() => (source?.champs ?? []).filter((c) => c.role !== 'mesure' && !CHAMPS_DEDIES.has(c.code)), [source])

  // ── Chargements ──
  useEffect(() => {
    supabase.rpc('analyse_catalogue').then(({ data, error }) => {
      if (error) setErreurCatalogue(error.message)
      else setCatalogue(data as Catalogue)
    })
    supabase.auth.getUser().then(({ data }) => setMoi((data.user?.email ?? '').toLowerCase()))
  }, [])

  const chargerModeles = useCallback(async () => {
    const { data } = await supabase.from('analyse_modeles').select('*').order('ordre').order('nom')
    setModeles((data as Modele[]) ?? [])
  }, [])
  useEffect(() => {
    supabase
      .from('analyse_modeles')
      .select('*')
      .order('ordre')
      .order('nom')
      .then(({ data }) => setModeles((data as Modele[]) ?? []))
  }, [])

  // ── Actions ──
  const reinitialiserResultat = () => {
    setResultat(null)
    setErreur(null)
    setTri(null)
    setRepliees(new Set())
  }

  const choisirSource = (code: string) => {
    const s = catalogue?.sources.find((x) => x.code === code)
    if (!s) return
    const garder = (liste: string[]) => liste.filter((c) => s.champs.some((x) => x.code === c))
    setSourceCode(code)
    // On garde ce qui existe dans la nouvelle source, sinon des choix conseillés
    setDimensions((d) => (garder(d).length ? garder(d) : ['famille_macro']))
    setMesures((m) => {
      const g = garder(m)
      if (g.length) return g
      return s.famille === 'devis' ? ['nb_devis', 'montant_ht', 'montant_transforme', 'taux_transfo_60j'] : ['quantite', 'montant_ht']
    })
    setFiltres((fs) => fs.filter((f) => s.champs.some((x) => x.code === f.champ)))
    setTriServeur([])
    setModeleActif(null)
    reinitialiserResultat()
  }

  const basculer = (liste: string[], code: string) => (liste.includes(code) ? liste.filter((c) => c !== code) : [...liste, code])
  const deplacer = (liste: string[], code: string, delta: number) => {
    const i = liste.indexOf(code)
    const j = i + delta
    if (i < 0 || j < 0 || j >= liste.length) return liste
    const copie = [...liste]
    ;[copie[i], copie[j]] = [copie[j], copie[i]]
    return copie
  }

  const majFiltre = (id: string, patch: Partial<Filtre>) => setFiltres((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const ajouterFiltre = (code: string) => {
    const c = champParCode.get(code)
    if (!c) return
    setFiltres((fs) => [...fs, filtreParDefaut(c)])
    setAjoutFiltre('')
  }

  /** Filtres envoyés au serveur : période + clients + hors statistique + filtres complémentaires. */
  const filtresComplets = useCallback((): Omit<Filtre, 'id'>[] => {
    const liste: Omit<Filtre, 'id'>[] = []
    if (periode.operateur === 'periode' && periode.valeur) liste.push({ champ: 'date_ref', operateur: 'periode', valeur: periode.valeur, valeur2: '', valeurs: [] })
    if (periode.operateur === 'entre' && periode.valeur && periode.valeur2) liste.push({ champ: 'date_ref', operateur: 'entre', valeur: periode.valeur, valeur2: periode.valeur2, valeurs: [] })
    if (clients.length) liste.push({ champ: 'code_client', operateur: 'parmi', valeur: '', valeur2: '', valeurs: clients })
    if (horsStat) liste.push({ champ: 'hors_statistique', operateur: 'est', valeur: 'Non', valeur2: '', valeurs: [] })
    // Un filtre dont le champ n'existe plus dans le catalogue (page ouverte avant une mise à jour,
    // analyse enregistrée ancienne) est ignoré au lieu de faire échouer l'analyse.
    for (const f of filtres.filter((x) => champParCode.has(x.champ) && filtreComplet(x))) {
      const c = champParCode.get(f.champ)
      const valeurs = f.operateur === 'parmi' && c?.type === 'texte' && f.valeurs.length === 0 ? f.valeur.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean) : f.valeurs
      liste.push({ champ: f.champ, operateur: f.operateur, valeur: f.valeur, valeur2: f.valeur2, valeurs })
    }
    return liste
  }, [periode, clients, horsStat, filtres, champParCode])

  const signature = JSON.stringify({ sourceCode, dimensions, mesures, top, sousTotaux, f: filtresComplets() })

  const lancer = async (forcer = false) => {
    if (!source) return
    setEnCours(true)
    setErreur(null)
    const triEnvoye = triServeur.length ? triServeur : mesures.includes('montant_ht') ? [{ champ: 'montant_ht', sens: 'desc' as const }] : []
    const { data, error } = await supabase.rpc('analyse_executer', {
      p_source: source.code,
      p_dimensions: dimensions,
      p_mesures: mesures,
      p_filtres: filtresComplets(),
      p_tri: triEnvoye,
      p_top: top,
      p_sous_totaux: sousTotaux,
      p_forcer: forcer,
    })
    setEnCours(false)
    if (error) {
      setErreur(
        error.message.includes('statement timeout') || error.code === '57014'
          ? "L'analyse a pris trop de temps et a été arrêtée. Réduisez la période ou ajoutez un filtre (client, agence, famille…) puis relancez."
          : error.message,
      )
      return
    }
    const res = data as Resultat
    setResultat(res)
    setRepliees(new Set())
    setDefLancee(signature)
    setSousTotauxLances(sousTotaux)
    setPartCaLancee(partCa)
    // Tri d'affichage initial = tri demandé
    const t = triEnvoye[0]
    if (t && res.executee) {
      const idx = [...res.dimensions, ...res.mesures].findIndex((c) => c.code === t.champ)
      setTri(idx >= 0 ? { index: idx, sens: t.sens } : null)
    } else setTri(null)
  }

  const appliquerDefinition = (s: Source, d: Definition) => {
    const existe = (c: string) => s.champs.some((x) => x.code === c)
    setSourceCode(s.code)
    setDimensions((d.dimensions ?? []).filter(existe))
    setMesures((d.mesures ?? []).filter(existe))
    setTop(d.top ?? null)
    setSousTotaux(d.sous_totaux ?? true)
    setPartCa(d.part_ca ?? false)
    setTriServeur(d.tri ?? [])
    const fs = d.filtres ?? []
    const per = fs.find((f) => f.champ === 'date_ref')
    setPeriode(per ? { operateur: per.operateur === 'entre' ? 'entre' : 'periode', valeur: per.valeur ?? '', valeur2: per.valeur2 ?? '' } : { operateur: 'periode', valeur: '', valeur2: '' })
    const cl = fs.find((f) => f.champ === 'code_client')
    // Les modèles partagés ne fixent pas de client : on garde ceux déjà choisis
    if (cl && cl.valeurs?.length) setClients(cl.valeurs)
    setHorsStat(fs.some((f) => f.champ === 'hors_statistique' && f.valeur === 'Non'))
    setFiltres(fs.filter((f) => !CHAMPS_DEDIES.has(f.champ) && existe(f.champ)).map((f) => ({ ...f, id: nouvelId(), valeurs: f.valeurs ?? [], valeur2: f.valeur2 ?? '' })))
  }

  const chargerModele = (m: Modele) => {
    const s = catalogue?.sources.find((x) => x.code === m.source)
    if (!s) return
    appliquerDefinition(s, m.definition)
    setModeleActif(m)
    reinitialiserResultat()
  }

  const definitionCourante = (): Definition => ({
    dimensions,
    mesures,
    filtres: filtresComplets(),
    tri: triServeur,
    top,
    sous_totaux: sousTotaux,
    part_ca: partCa,
  })

  const enregistrerModele = async (commeNouveau: boolean) => {
    if (!source || !nomModele.trim()) return
    const definition = definitionCourante()
    if (modeleActif && !commeNouveau && modeleActif.created_by === moi) {
      await supabase
        .from('analyse_modeles')
        .update({ nom: nomModele.trim(), definition, partage: partageModele, updated_at: new Date().toISOString() })
        .eq('id', modeleActif.id)
    } else {
      const { data } = await supabase.from('analyse_modeles').insert({ nom: nomModele.trim(), source: source.code, definition, partage: partageModele }).select().single()
      if (data) setModeleActif(data as Modele)
    }
    setFenetreEnregistrer(false)
    void chargerModeles()
  }

  const supprimerModele = async (m: Modele) => {
    if (!window.confirm(`Supprimer l'analyse « ${m.nom} » ?`)) return
    await supabase.from('analyse_modeles').delete().eq('id', m.id)
    if (modeleActif?.id === m.id) setModeleActif(null)
    void chargerModeles()
  }

  // ── Affichage ──
  const lignes = useMemo(
    () => (resultat?.executee ? construireLignes(resultat, sousTotauxLances, tri, repliees) : []),
    [resultat, sousTotauxLances, tri, repliees],
  )
  const idxCa = resultat ? resultat.mesures.findIndex((m) => m.code === 'montant_ht') : -1
  const afficherPart = partCaLancee && idxCa >= 0
  const totalCa = resultat?.total && idxCa >= 0 ? Number(resultat.total[idxCa]) : 0
  const resultatPerime = !!resultat?.executee && defLancee !== signature

  const libellePeriode =
    periode.operateur === 'periode'
      ? PERIODES.find((p) => p.code === periode.valeur)?.libelle ?? 'Toute la période'
      : periode.valeur && periode.valeur2
        ? `du ${fmtDateIso(periode.valeur)} au ${fmtDateIso(periode.valeur2)}`
        : 'Toute la période'

  const criteres = useMemo(() => {
    if (!source) return []
    const l: string[] = [`${source.date_libelle} : ${libellePeriode}`]
    l.push(clients.length ? `Clients : ${clients.join(', ')}` : 'Clients : tous (périmètre de l’utilisateur)')
    if (horsStat) l.push('Articles hors statistique exclus')
    for (const f of filtres.filter((x) => champParCode.has(x.champ) && filtreComplet(x))) l.push(decrireFiltre(f, champParCode.get(f.champ)))
    if (top) l.push(`Top ${top}`)
    return l
  }, [source, libellePeriode, clients, horsStat, filtres, champParCode, top])

  const titreAnalyse = modeleActif?.nom ?? (source ? `${source.libelle} par ${dimensions.map((d) => champParCode.get(d)?.libelle ?? d).join(' › ') || 'total'}` : '')

  const cliquerEntete = (index: number) =>
    setTri((t) => (!t || t.index !== index ? { index, sens: estNumerique([...(resultat?.dimensions ?? []), ...(resultat?.mesures ?? [])][index]?.type ?? 'texte') ? 'desc' : 'asc' } : { index, sens: t.sens === 'asc' ? 'desc' : 'asc' }))

  const basculerGroupe = (cle: string) =>
    setRepliees((r) => {
      const s = new Set(r)
      if (s.has(cle)) s.delete(cle)
      else s.add(cle)
      return s
    })

  const toutReplier = (niveau: number | null) => {
    if (!resultat) return
    if (niveau == null) {
      setRepliees(new Set())
      return
    }
    // Replie tous les sous-totaux du niveau donné
    const s = new Set<string>()
    for (const l of resultat.sous_totaux) {
      const g = Number(l[l.length - 1])
      let agreges = 0
      for (let b = 0; b < resultat.dimensions.length; b++) if (g & (1 << b)) agreges++
      const k = resultat.dimensions.length - agreges
      if (k === niveau) s.add(cleDe(l.slice(0, k)))
    }
    setRepliees(s)
  }

  // ── Rendu ──
  if (erreurCatalogue) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <div className="font-black">Analyse des ventes indisponible</div>
          <div className="mt-1 text-sm">{erreurCatalogue}</div>
        </div>
      </main>
    )
  }

  const modelesCompagnon = modeles.filter((m) => m.created_by === 'compagnon')
  const mesModeles = modeles.filter((m) => m.created_by === moi)
  const modelesPartages = modeles.filter((m) => m.created_by !== moi && m.created_by !== 'compagnon')
  const colonnes = resultat ? [...resultat.dimensions, ...resultat.mesures] : []
  const nbDims = resultat?.dimensions.length ?? 0

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1800px] space-y-4">
        {/* En-tête */}
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-[#245A9E]">Mon activité</div>
              <h1 className="mt-1 text-3xl font-black">Analyse des ventes &amp; devis</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Choisissez ce que vous analysez (factures, BL, commandes ou devis), le ou les clients et la période, puis le niveau de lecture : famille macro, famille,
                article, mois… Le résultat se trie, se replie et s&apos;exporte sur Excel.
                {catalogue?.droits.perimetre_limite && ' Seuls les clients de votre périmètre sont pris en compte.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={modeleActif?.id ?? ''}
                onChange={(e) => {
                  const m = modeles.find((x) => x.id === e.target.value)
                  if (m) chargerModele(m)
                }}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">📂 Ouvrir une analyse enregistrée…</option>
                {mesModeles.length > 0 && (
                  <optgroup label="Mes analyses">
                    {mesModeles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom}
                        {m.partage ? ' (partagée)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelesPartages.length > 0 && (
                  <optgroup label="Partagées">
                    {modelesPartages.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelesCompagnon.length > 0 && (
                  <optgroup label="Analyses prêtes à l'emploi">
                    {modelesCompagnon.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {modeleActif && modeleActif.created_by === moi && (
                <button onClick={() => supprimerModele(modeleActif)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                  Supprimer
                </button>
              )}
              {source && (
                <button
                  onClick={() => {
                    setNomModele(modeleActif && modeleActif.created_by === moi ? modeleActif.nom : '')
                    setPartageModele(modeleActif?.created_by === moi ? modeleActif.partage : false)
                    setFenetreEnregistrer(true)
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-50"
                >
                  💾 Enregistrer l&apos;analyse
                </button>
              )}
            </div>
          </div>

          {/* Analyses prêtes à l'emploi */}
          {modelesCompagnon.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <span className="self-center text-xs font-black uppercase tracking-wide text-slate-500">Prêtes à l&apos;emploi :</span>
              {modelesCompagnon.map((m) => (
                <button
                  key={m.id}
                  onClick={() => chargerModele(m)}
                  title={m.description ?? undefined}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    modeleActif?.id === m.id ? 'border-[#245A9E] bg-[#245A9E] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-[#245A9E]'
                  }`}
                >
                  {catalogue?.sources.find((s) => s.code === m.source)?.icone} {m.nom}
                </button>
              ))}
            </div>
          )}
        </header>

        {catalogue === null && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Chargement…</div>}

        {catalogue && (
          <>
            {/* Étape 1 */}
            <Etape numero={1} titre="Qu'analysez-vous ?" aide="Le choix fixe la date de lecture : date de facture, du BL, de la commande ou du devis.">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {catalogue.sources.map((s) => (
                  <button
                    key={s.code}
                    onClick={() => choisirSource(s.code)}
                    className={`rounded-xl border p-3 text-left transition ${
                      s.code === sourceCode ? 'border-[#245A9E] bg-blue-50 ring-2 ring-[#245A9E]' : 'border-slate-200 bg-white hover:border-slate-400'
                    }`}
                  >
                    <div className="text-2xl">{s.icone}</div>
                    <div className="mt-1 text-sm font-black">{s.libelle}</div>
                    <div className="mt-1 text-xs leading-snug text-slate-500">{s.description}</div>
                  </button>
                ))}
              </div>
            </Etape>

            {source && (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  {/* Étape 2 */}
                  <Etape numero={2} titre="Pour quels clients et sur quelle période ?" aide="Sans client choisi, l'analyse porte sur tous les clients de votre périmètre.">
                    <div className="space-y-4">
                      <ChoixClients codes={clients} onChange={setClients} />
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                        <span className="text-sm font-bold">{source.date_libelle}</span>
                        <select
                          value={periode.operateur}
                          onChange={(e) =>
                            setPeriode((p) => (e.target.value === 'entre' ? { operateur: 'entre', valeur: p.operateur === 'entre' ? p.valeur : '', valeur2: p.operateur === 'entre' ? p.valeur2 : '' } : { operateur: 'periode', valeur: 'annee_en_cours', valeur2: '' }))
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        >
                          <option value="periode">période</option>
                          <option value="entre">entre le</option>
                        </select>
                        {periode.operateur === 'periode' ? (
                          <select value={periode.valeur} onChange={(e) => setPeriode({ operateur: 'periode', valeur: e.target.value, valeur2: '' })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                            <option value="">Toute la période (déconseillé)</option>
                            {PERIODES.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.libelle}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <input type="date" value={periode.valeur} onChange={(e) => setPeriode((p) => ({ ...p, valeur: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                            <span className="text-sm text-slate-500">et le</span>
                            <input type="date" value={periode.valeur2} onChange={(e) => setPeriode((p) => ({ ...p, valeur2: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                          </>
                        )}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={horsStat} onChange={(e) => setHorsStat(e.target.checked)} />
                        Exclure les articles hors statistique (port, prestations…)
                      </label>
                    </div>
                  </Etape>

                  {/* Étape 4 */}
                  <Etape numero={4} titre="Autres filtres (facultatif)" aide="Agence, famille macro, marque, autres dates (BL, CDC…), statut du devis…">
                    <div className="space-y-2">
                      {filtres.length === 0 && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucun filtre complémentaire.</div>}
                      {filtres.map((f) => {
                        const c = champParCode.get(f.champ)
                        if (!c) return null
                        const ops = OPERATEURS[c.type]
                        const sansValeur = f.operateur === 'vide' || f.operateur === 'non_vide'
                        return (
                          <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                            <span className="min-w-[140px] text-sm font-bold">{c.libelle}</span>
                            <select
                              value={f.operateur}
                              onChange={(e) => {
                                const op = e.target.value
                                majFiltre(f.id, { operateur: op, valeur: op === 'periode' ? 'annee_en_cours' : f.operateur === 'periode' ? '' : f.valeur })
                              }}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                            >
                              {ops.map((o) => (
                                <option key={o.code} value={o.code}>
                                  {o.libelle}
                                </option>
                              ))}
                            </select>
                            {!sansValeur && c.type === 'liste' && (f.operateur === 'parmi' || f.operateur === 'hors') && (
                              <ChoixValeurs key={`${source.code}-${c.code}`} source={source.code} champ={c.code} valeurs={f.valeurs} onChange={(v) => majFiltre(f.id, { valeurs: v })} />
                            )}
                            {!sansValeur && c.type === 'date' && f.operateur === 'periode' && (
                              <select value={f.valeur} onChange={(e) => majFiltre(f.id, { valeur: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm">
                                {PERIODES.map((p) => (
                                  <option key={p.code} value={p.code}>
                                    {p.libelle}
                                  </option>
                                ))}
                              </select>
                            )}
                            {!sansValeur && c.type === 'date' && f.operateur !== 'periode' && (
                              <>
                                <input type="date" value={f.valeur} onChange={(e) => majFiltre(f.id, { valeur: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                                {f.operateur === 'entre' && (
                                  <>
                                    <span className="text-sm text-slate-500">et le</span>
                                    <input type="date" value={f.valeur2} onChange={(e) => majFiltre(f.id, { valeur2: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                                  </>
                                )}
                              </>
                            )}
                            {!sansValeur && estNumerique(c.type) && (
                              <>
                                <input inputMode="decimal" value={f.valeur} onChange={(e) => majFiltre(f.id, { valeur: e.target.value })} placeholder="0" className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                                {f.operateur === 'entre' && (
                                  <>
                                    <span className="text-sm text-slate-500">et</span>
                                    <input inputMode="decimal" value={f.valeur2} onChange={(e) => majFiltre(f.id, { valeur2: e.target.value })} className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                                  </>
                                )}
                              </>
                            )}
                            {!sansValeur && (c.type === 'texte' || (c.type === 'liste' && f.operateur === 'contient')) && f.operateur !== 'parmi' && (
                              <input value={f.valeur} onChange={(e) => majFiltre(f.id, { valeur: e.target.value })} placeholder="Texte…" className="min-w-[180px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm" />
                            )}
                            {!sansValeur && c.type === 'texte' && f.operateur === 'parmi' && (
                              <textarea
                                value={f.valeur}
                                onChange={(e) => majFiltre(f.id, { valeur: e.target.value, valeurs: [] })}
                                placeholder="Collez une liste (une valeur par ligne, ou séparées par ; ou ,)"
                                rows={2}
                                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                              />
                            )}
                            <button onClick={() => setFiltres((fs) => fs.filter((x) => x.id !== f.id))} className="ml-auto px-2 text-slate-400 hover:text-red-600" title="Retirer le filtre">
                              ✕
                            </button>
                          </div>
                        )
                      })}
                      <select value={ajoutFiltre} onChange={(e) => ajouterFiltre(e.target.value)} className="w-full rounded-xl border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-600">
                        <option value="">＋ Ajouter un filtre sur…</option>
                        {grouper(champsFiltrables).map(([groupe, liste]) => (
                          <optgroup key={groupe} label={groupe}>
                            {liste.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.libelle}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </Etape>
                </div>

                {/* Étape 3 */}
                <Etape numero={3} titre="Quel niveau de lecture ?" aide="« Regrouper par » fixe le niveau de détail (dans l'ordre choisi : famille macro › famille › article…). Sans regroupement, vous obtenez le total.">
                  <div className="grid gap-4 xl:grid-cols-[2fr_1fr_1fr]">
                    <div>
                      <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Regrouper par</div>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {grouper(champsDimension).map(([groupe, liste]) => (
                          <div key={groupe}>
                            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">{groupe}</div>
                            {liste.map((c) => (
                              <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50" title={c.description ?? undefined}>
                                <input type="checkbox" checked={dimensions.includes(c.code)} onChange={() => setDimensions((d) => basculer(d, c.code))} />
                                <span>{c.libelle}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                      {dimensions.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
                          <span className="text-xs font-bold text-slate-500">Ordre :</span>
                          {dimensions.map((code, i) => (
                            <span key={code} className="inline-flex items-center gap-1 rounded-full border border-[#245A9E]/30 bg-blue-50 py-0.5 pl-1 pr-2 text-xs">
                              <button disabled={i === 0} onClick={() => setDimensions((d) => deplacer(d, code, -1))} className="px-1 text-slate-500 disabled:opacity-20" title="Monter d'un niveau">
                                ◀
                              </button>
                              <span className="font-semibold">{champParCode.get(code)?.libelle ?? code}</span>
                              <button disabled={i === dimensions.length - 1} onClick={() => setDimensions((d) => deplacer(d, code, 1))} className="px-1 text-slate-500 disabled:opacity-20" title="Descendre d'un niveau">
                                ▶
                              </button>
                              <button onClick={() => setDimensions((d) => basculer(d, code))} className="pl-1 text-slate-400 hover:text-red-600" title="Retirer">
                                ✕
                              </button>
                              {i < dimensions.length - 1 && <span className="pl-1 text-slate-400">›</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Mesures</div>
                      {champsMesure.map((c) => (
                        <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50" title={c.description ?? undefined}>
                          <input type="checkbox" checked={mesures.includes(c.code)} onChange={() => setMesures((m) => basculer(m, c.code))} />
                          <span>{c.libelle}</span>
                          {c.description && <span className="text-xs text-slate-400">ⓘ</span>}
                        </label>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <div className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Limiter à</div>
                        <div className="flex flex-wrap gap-1.5">
                          {TOPS.map((t) => (
                            <button
                              key={t.libelle}
                              onClick={() => setTop(t.valeur)}
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${top === t.valeur ? 'border-[#245A9E] bg-[#245A9E] text-white' : 'border-slate-300 bg-white hover:border-slate-500'}`}
                            >
                              {t.libelle}
                            </button>
                          ))}
                        </div>
                        {top && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                            classé sur
                            <select
                              value={triServeur[0]?.champ ?? (mesures.includes('montant_ht') ? 'montant_ht' : mesures[0] ?? '')}
                              onChange={(e) => setTriServeur([{ champ: e.target.value, sens: 'desc' }])}
                              className="rounded border border-slate-300 px-1 py-0.5"
                            >
                              {mesures.map((m) => (
                                <option key={m} value={m}>
                                  {champParCode.get(m)?.libelle ?? m}
                                </option>
                              ))}
                            </select>
                            décroissant
                          </div>
                        )}
                      </div>
                      <label className={`flex items-center gap-2 text-sm ${top || dimensions.length < 2 ? 'text-slate-400' : 'text-slate-700'}`}>
                        <input type="checkbox" checked={sousTotaux} disabled={!!top || dimensions.length < 2} onChange={(e) => setSousTotaux(e.target.checked)} />
                        Sous-totaux par niveau
                      </label>
                      <label className={`flex items-center gap-2 text-sm ${mesures.includes('montant_ht') ? 'text-slate-700' : 'text-slate-400'}`}>
                        <input type="checkbox" checked={partCa} disabled={!mesures.includes('montant_ht')} onChange={(e) => setPartCa(e.target.checked)} />
                        Afficher la part du {source.famille === 'devis' ? 'montant devisé' : 'CA'} (%)
                      </label>
                      {!catalogue.droits.voir_marge && <p className="text-xs text-slate-400">La marge n&apos;est pas ouverte pour votre compte.</p>}
                    </div>
                  </div>
                </Etape>

                {/* Lancement */}
                <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <button
                    disabled={enCours || (dimensions.length === 0 && mesures.length === 0)}
                    onClick={() => lancer(false)}
                    className="rounded-xl bg-[#245A9E] px-6 py-3 text-base font-black text-white shadow hover:bg-[#173B6C] disabled:opacity-40"
                  >
                    {enCours ? 'Analyse en cours…' : "▶ Lancer l'analyse"}
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {criteres.map((c) => (
                      <span key={c} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                        {c}
                      </span>
                    ))}
                  </div>
                </section>
              </>
            )}

            {erreur && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">⚠️ {erreur}</div>}

            {resultat?.alerte && !resultat.executee && (
              <div className={`rounded-2xl border p-4 text-sm ${resultat.alerte.niveau === 'bloquant' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                <div className="font-black">{resultat.alerte.niveau === 'bloquant' ? '⛔ Analyse trop lourde' : '⚠️ Analyse lourde'}</div>
                <div className="mt-1">{resultat.alerte.message}</div>
                {resultat.alerte.niveau === 'lourd' && (
                  <button onClick={() => lancer(true)} disabled={enCours} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                    {enCours ? 'Analyse en cours…' : 'Lancer quand même'}
                  </button>
                )}
              </div>
            )}

            {/* Résultat */}
            {resultat?.executee && source && (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
                  <div>
                    <div className="text-lg font-black">{titreAnalyse}</div>
                    <div className="text-xs text-slate-500">
                      {nbDims > 0 ? `${resultat.nb.toLocaleString('fr-FR')} ligne${resultat.nb > 1 ? 's' : ''} de détail` : 'Total'} · obtenue en{' '}
                      {(resultat.duree_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s
                    </div>
                  </div>
                  {resultat.tronque && (
                    <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      Résultat limité à {resultat.nb.toLocaleString('fr-FR')} lignes : réduisez le détail, ajoutez un filtre ou choisissez un Top.
                    </div>
                  )}
                  {resultatPerime && <div className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-800">Les choix ont changé : relancez l&apos;analyse pour mettre à jour.</div>}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {resultat.sous_totaux.length > 0 && (
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-slate-500">Afficher :</span>
                        {resultat.dimensions.slice(0, -1).map((d, i) => (
                          <button key={d.code} onClick={() => toutReplier(i + 1)} className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50">
                            {d.libelle}
                          </button>
                        ))}
                        <button onClick={() => toutReplier(null)} className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50">
                          Tout le détail
                        </button>
                      </div>
                    )}
                    <button
                      disabled={!resultat.total && lignes.length === 0}
                      onClick={() =>
                        exporterExcel({
                          titre: titreAnalyse,
                          source,
                          res: resultat,
                          lignes: construireLignes(resultat, sousTotauxLances, tri, new Set()),
                          partCa: afficherPart,
                          idxCa,
                          criteres,
                        })
                      }
                      className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40"
                    >
                      ⬇ Exporter sur Excel
                    </button>
                  </div>
                </div>

                <div className="max-h-[70vh] overflow-auto">
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead className="sticky top-0 z-10 bg-slate-100">
                      <tr>
                        {colonnes.map((c, i) => (
                          <th
                            key={c.code}
                            onClick={() => cliquerEntete(i)}
                            className={`cursor-pointer select-none whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-200 ${estNumerique(c.type) ? 'text-right' : ''}`}
                            title="Cliquer pour trier"
                          >
                            {c.libelle}
                            <span className="ml-1 text-slate-400">{tri?.index === i ? (tri.sens === 'asc' ? '▲' : '▼') : '↕'}</span>
                          </th>
                        ))}
                        {afficherPart && <th className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right text-xs font-black uppercase tracking-wide text-slate-600">% du total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {lignes.slice(0, 3000).map((l) => {
                        const replie = repliees.has(l.cle)
                        return (
                          <tr key={`${l.niveau}-${l.cle}`} className={l.detail ? 'odd:bg-white even:bg-slate-50/60 hover:bg-blue-50/50' : l.niveau === 1 ? 'bg-[#DCE7F5] font-black' : 'bg-[#EFF4FA] font-bold'}>
                            {resultat.dimensions.map((c, i) => {
                              let contenu: React.ReactNode = formatCellule(l.dims[i], c.type)
                              if (!l.detail) {
                                if (i === l.niveau - 1) {
                                  contenu = (
                                    <button onClick={() => basculerGroupe(l.cle)} className="inline-flex items-center gap-1.5 text-left">
                                      <span className="w-3 text-slate-500">{replie ? '▸' : '▾'}</span>
                                      {formatCellule(l.dims[i], c.type) || '(vide)'}
                                      <span className="text-xs font-normal text-slate-500">({l.nbEnfants})</span>
                                    </button>
                                  )
                                } else if (i >= l.niveau) contenu = ''
                              }
                              return (
                                <td
                                  key={c.code}
                                  className={`whitespace-nowrap border-b border-slate-100 px-3 py-1.5 ${estNumerique(c.type) ? 'text-right tabular-nums' : ''} ${
                                    l.detail && sousTotauxLances && nbDims > 1 && i < nbDims - 1 ? 'text-slate-300' : ''
                                  }`}
                                >
                                  {contenu}
                                </td>
                              )
                            })}
                            {resultat.mesures.map((c, i) => (
                              <td key={c.code} className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-right tabular-nums">
                                {formatCellule(l.mes[i], c.type)}
                              </td>
                            ))}
                            {afficherPart && (
                              <td className="whitespace-nowrap border-b border-slate-100 px-3 py-1.5 text-right tabular-nums text-slate-600">
                                {totalCa ? `${fmtPct.format((Number(l.mes[idxCa] ?? 0) / totalCa) * 100)} %` : ''}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                      {lignes.length === 0 && nbDims > 0 && (
                        <tr>
                          <td colSpan={colonnes.length + (afficherPart ? 1 : 0)} className="p-6 text-center text-slate-500">
                            Aucune ligne ne correspond à ces critères.
                            {clients.length > 0 && (
                              <div className="mt-1 text-xs">
                                Vérifiez le compte client choisi : un même client peut avoir plusieurs comptes (la recherche affiche le CA 12 mois de chacun).
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {resultat.total && (
                      <tfoot className="sticky bottom-0 bg-slate-200 font-black">
                        <tr>
                          {resultat.dimensions.map((c, i) => (
                            <td key={c.code} className="whitespace-nowrap border-t border-slate-300 px-3 py-2">
                              {i === 0 ? 'Total général' : ''}
                            </td>
                          ))}
                          {resultat.mesures.map((c, i) => (
                            <td key={c.code} className="whitespace-nowrap border-t border-slate-300 px-3 py-2 text-right tabular-nums">
                              {formatCellule(resultat.total![i], c.type)}
                            </td>
                          ))}
                          {afficherPart && <td className="whitespace-nowrap border-t border-slate-300 px-3 py-2 text-right">100,0 %</td>}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {lignes.length > 3000 && (
                    <div className="p-3 text-center text-xs text-slate-500">
                      Les 3 000 premières lignes sont affichées ; l&apos;export Excel contient tout ({lignes.length.toLocaleString('fr-FR')} lignes).
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Fenêtre « Enregistrer » */}
      {fenetreEnregistrer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFenetreEnregistrer(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black">Enregistrer l&apos;analyse</h3>
            <p className="mt-1 text-xs text-slate-500">
              Elle garde la source, les clients, la période, les regroupements, les mesures et les filtres. Une période (« année en cours »…) est recalculée à chaque ouverture.
            </p>
            <input autoFocus value={nomModele} onChange={(e) => setNomModele(e.target.value)} placeholder="Nom (ex. SMER — CA par famille macro)" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {catalogue?.droits.partager && (
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={partageModele} onChange={(e) => setPartageModele(e.target.checked)} />
                La partager avec tous les utilisateurs de l&apos;écran
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setFenetreEnregistrer(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                Annuler
              </button>
              {modeleActif && modeleActif.created_by === moi && (
                <button onClick={() => enregistrerModele(true)} disabled={!nomModele.trim()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">
                  Enregistrer comme nouvelle
                </button>
              )}
              <button onClick={() => enregistrerModele(false)} disabled={!nomModele.trim()} className="rounded-lg bg-[#245A9E] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
