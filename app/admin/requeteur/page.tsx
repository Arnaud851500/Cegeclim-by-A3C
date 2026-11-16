'use client'

// ============================================================================
// app/admin/requeteur/page.tsx — Requêteur métier (Admin) — 16/11/2026
// ----------------------------------------------------------------------------
// Demandé par Arnaud : un écran de requête « à la volée », simple et tourné
// métier. L'utilisateur choisit :
//   1. ce qu'il cherche (une « source » : documents de vente en cours, lignes
//      de factures, clients, stock par dépôt…) ;
//   2. les colonnes à afficher (libellés métier, regroupés par thème) ;
//   3. les filtres (périodes « aujourd'hui / mois dernier… », listes de
//      valeurs à cocher, montants, textes) ;
// puis affiche la liste, la trie, la filtre et l'exporte sur Excel.
// Une alerte prévient quand la requête est lourde (estimation Postgres) ;
// l'utilisateur peut la lancer quand même, sauf si elle est bloquante.
// Les requêtes peuvent être enregistrées (personnelles ou partagées).
//
// Données : RPC requeteur_catalogue / requeteur_valeurs / requeteur_executer
// et table requeteur_modeles (migration 20261116c_requeteur_metier.sql).
// Droit : can_autorisation (contrôlé aussi en base par requeteur_autorise()).
// Test d'acceptation : Laure refait seule la liste des BL du jour.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

// ── Types ───────────────────────────────────────────────────────────────────

type TypeChamp = 'texte' | 'liste' | 'nombre' | 'montant' | 'pourcent' | 'date'

type Champ = {
  code: string
  libelle: string
  groupe: string
  type: TypeChamp
  description: string | null
  par_defaut: boolean
  a_valeurs: boolean
}

type Source = {
  code: string
  libelle: string
  description: string | null
  icone: string | null
  tri_defaut: string | null
  tri_sens: string
  champs: Champ[]
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
  colonnes: Colonne[]
  lignes: unknown[][]
  nb: number
  tronque: boolean
  limite?: number
  executee: boolean
  alerte: { niveau: 'lourd' | 'bloquant'; message: string } | null
  estimation: { lignes: number; cout: number }
  duree_ms: number
}

type Modele = {
  id: string
  nom: string
  description: string | null
  source: string
  definition: { champs: string[]; filtres: Omit<Filtre, 'id'>[]; limite?: number }
  partage: boolean
  created_by: string
}

// ── Vocabulaire métier ──────────────────────────────────────────────────────

const OPERATEURS: Record<TypeChamp, { code: string; libelle: string }[]> = {
  liste: [
    { code: 'parmi', libelle: 'est' },
    { code: 'hors', libelle: "n'est pas" },
    { code: 'contient', libelle: 'contient le texte' },
    { code: 'vide', libelle: "n'est pas renseigné" },
    { code: 'non_vide', libelle: 'est renseigné' },
  ],
  texte: [
    { code: 'contient', libelle: 'contient' },
    { code: 'est', libelle: 'est exactement' },
    { code: 'commence', libelle: 'commence par' },
    { code: 'ne_contient_pas', libelle: 'ne contient pas' },
    { code: 'parmi', libelle: 'est dans ma liste (collée)' },
    { code: 'vide', libelle: "n'est pas renseigné" },
    { code: 'non_vide', libelle: 'est renseigné' },
  ],
  nombre: [
    { code: 'sup', libelle: 'supérieur à' },
    { code: 'sup_egal', libelle: 'supérieur ou égal à' },
    { code: 'inf', libelle: 'inférieur à' },
    { code: 'inf_egal', libelle: 'inférieur ou égal à' },
    { code: 'egal', libelle: 'égal à' },
    { code: 'different', libelle: 'différent de' },
    { code: 'entre', libelle: 'entre' },
    { code: 'vide', libelle: "n'est pas renseigné" },
    { code: 'non_vide', libelle: 'est renseigné' },
  ],
  montant: [],
  pourcent: [],
  date: [
    { code: 'periode', libelle: 'période' },
    { code: 'le', libelle: 'le' },
    { code: 'depuis', libelle: 'depuis le' },
    { code: 'avant', libelle: "jusqu'au" },
    { code: 'entre', libelle: 'entre le' },
    { code: 'vide', libelle: "n'est pas renseignée" },
    { code: 'non_vide', libelle: 'est renseignée' },
  ],
}
OPERATEURS.montant = OPERATEURS.nombre
OPERATEURS.pourcent = OPERATEURS.nombre

const PERIODES: { code: string; libelle: string }[] = [
  { code: 'aujourdhui', libelle: "Aujourd'hui" },
  { code: 'hier', libelle: 'Hier' },
  { code: 'demain', libelle: 'Demain' },
  { code: '7_derniers_jours', libelle: '7 derniers jours' },
  { code: 'semaine_en_cours', libelle: 'Semaine en cours' },
  { code: 'semaine_derniere', libelle: 'Semaine dernière' },
  { code: '30_derniers_jours', libelle: '30 derniers jours' },
  { code: 'mois_en_cours', libelle: 'Mois en cours' },
  { code: 'mois_dernier', libelle: 'Mois dernier' },
  { code: '3_derniers_mois', libelle: '3 derniers mois' },
  { code: 'annee_en_cours', libelle: 'Année en cours' },
  { code: 'annee_derniere', libelle: 'Année dernière' },
  { code: '7_prochains_jours', libelle: '7 prochains jours' },
  { code: 'mois_prochain', libelle: 'Mois prochain' },
]

const LIMITES = [1000, 5000, 20000]

const fmtMontant = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

function fmtDateIso(v: unknown) {
  if (typeof v !== 'string' || v.length < 10) return v == null ? '' : String(v)
  const [a, m, j] = v.slice(0, 10).split('-')
  return `${j}/${m}/${a}`
}

function formatCellule(v: unknown, type: TypeChamp): string {
  if (v == null || v === '') return ''
  if (type === 'date') return fmtDateIso(v)
  if (type === 'montant') return fmtMontant.format(Number(v))
  if (type === 'pourcent') return `${fmtNombre.format(Number(v))} %`
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
  return { id: nouvelId(), champ: champ.code, operateur: op, valeur: champ.type === 'date' ? 'aujourdhui' : '', valeur2: '', valeurs: [] }
}

/** Phrase lisible décrivant un filtre (affichée et reprise dans l'export). */
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

// ── Petits composants ───────────────────────────────────────────────────────

function Etape({ numero, titre, aide, children, droite }: { numero: number; titre: string; aide?: string; children: React.ReactNode; droite?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0B1220] text-sm font-black text-white">{numero}</span>
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
    supabase.rpc('requeteur_valeurs', { p_source: source, p_champ: champ }).then(({ data }) => {
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
    <div className="relative min-w-[240px] flex-1" ref={ref}>
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
          <input
            autoFocus
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher…"
            className="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
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

// ── Export Excel ────────────────────────────────────────────────────────────

async function exporterExcel(params: {
  source: Source
  colonnes: Colonne[]
  lignes: unknown[][]
  criteres: string[]
  tronque: boolean
}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Compagnon CEGECLIM — Requêteur'
  const ws = wb.addWorksheet('Résultat', { views: [{ state: 'frozen', ySplit: 1 }] })

  ws.columns = params.colonnes.map((c) => ({
    header: c.libelle,
    key: c.code,
    width: Math.min(45, Math.max(12, c.libelle.length + 2, ...params.lignes.slice(0, 200).map((l) => String(l[params.colonnes.indexOf(c)] ?? '').length + 2))),
  }))
  const entete = ws.getRow(1)
  entete.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  entete.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1220' } }
  entete.alignment = { vertical: 'middle', wrapText: true }

  for (const l of params.lignes) {
    ws.addRow(
      params.colonnes.map((c, i) => {
        const v = l[i]
        if (v == null || v === '') return null
        if (c.type === 'date' && typeof v === 'string') {
          const [a, m, j] = v.slice(0, 10).split('-').map(Number)
          return new Date(Date.UTC(a, m - 1, j))
        }
        if (estNumerique(c.type)) return Number(v)
        return v
      }),
    )
  }
  params.colonnes.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.type === 'date') col.numFmt = 'dd/mm/yyyy'
    if (c.type === 'montant') col.numFmt = '#,##0.00'
    if (c.type === 'nombre') col.numFmt = '#,##0.##'
    if (c.type === 'pourcent') col.numFmt = '0.00'
  })
  const n = params.lignes.length
  if (n > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: n + 1, column: params.colonnes.length } }
    const total = ws.addRow(
      params.colonnes.map((c, i) => {
        if (i === 0) return `Total (${n} lignes)`
        if (c.type === 'montant' || c.type === 'nombre') {
          const lettre = ws.getColumn(i + 1).letter
          return { formula: `SUBTOTAL(9,${lettre}2:${lettre}${n + 1})` }
        }
        return null
      }),
    )
    total.font = { bold: true }
  }

  const wc = wb.addWorksheet('Critères')
  wc.columns = [{ width: 28 }, { width: 90 }]
  wc.addRow(['Requête', params.source.libelle]).font = { bold: true }
  wc.addRow(['Extraite le', new Date().toLocaleString('fr-FR')])
  wc.addRow(['Nombre de lignes', n + (params.tronque ? ' (liste limitée — affiner les filtres)' : '')])
  wc.addRow([])
  wc.addRow(['Filtres']).font = { bold: true }
  if (params.criteres.length === 0) wc.addRow(['', 'Aucun filtre'])
  for (const c of params.criteres) wc.addRow(['', c])
  wc.addRow([])
  wc.addRow(['Colonnes', params.colonnes.map((c) => c.libelle).join(', ')])

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  a.href = url
  a.download = `Requete_${params.source.libelle.replace(/[^A-Za-z0-9À-ÿ]+/g, '_')}_${stamp}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function RequeteurPage() {
  const [sources, setSources] = useState<Source[] | null>(null)
  const [erreurCatalogue, setErreurCatalogue] = useState<string | null>(null)
  const [sourceCode, setSourceCode] = useState<string | null>(null)
  const [champs, setChamps] = useState<string[]>([])
  const [filtres, setFiltres] = useState<Filtre[]>([])
  const [limite, setLimite] = useState(5000)
  const [ajoutFiltre, setAjoutFiltre] = useState('')

  const [resultat, setResultat] = useState<Resultat | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  // Liste affichée : tri et filtres « dans la liste » côté navigateur
  const [tri, setTri] = useState<{ index: number; sens: 'asc' | 'desc' } | null>(null)
  const [rechercheGlobale, setRechercheGlobale] = useState('')
  const [filtresColonnes, setFiltresColonnes] = useState<Record<number, string>>({})

  // Requêtes enregistrées
  const [modeles, setModeles] = useState<Modele[]>([])
  const [modeleActif, setModeleActif] = useState<Modele | null>(null)
  const [moi, setMoi] = useState<string>('')
  const [fenetreEnregistrer, setFenetreEnregistrer] = useState(false)
  const [nomModele, setNomModele] = useState('')
  const [partageModele, setPartageModele] = useState(false)

  const source = useMemo(() => sources?.find((s) => s.code === sourceCode) ?? null, [sources, sourceCode])
  const champParCode = useMemo(() => new Map((source?.champs ?? []).map((c) => [c.code, c])), [source])

  // ── Chargements ──
  useEffect(() => {
    supabase.rpc('requeteur_catalogue').then(({ data, error }) => {
      if (error) setErreurCatalogue(error.message)
      else setSources((data as Source[]) ?? [])
    })
    supabase.auth.getUser().then(({ data }) => setMoi((data.user?.email ?? '').toLowerCase()))
  }, [])

  const chargerModeles = useCallback(() => {
    return supabase
      .from('requeteur_modeles')
      .select('*')
      .order('nom')
      .then(({ data }) => setModeles((data as Modele[]) ?? []))
  }, [])
  useEffect(() => {
    void supabase
      .from('requeteur_modeles')
      .select('*')
      .order('nom')
      .then(({ data }) => setModeles((data as Modele[]) ?? []))
  }, [])

  // ── Actions ──
  const choisirSource = (code: string) => {
    const s = sources?.find((x) => x.code === code)
    if (!s) return
    setSourceCode(code)
    setChamps(s.champs.filter((c) => c.par_defaut).map((c) => c.code))
    setFiltres([])
    setResultat(null)
    setErreur(null)
    setModeleActif(null)
    setTri(null)
    setFiltresColonnes({})
    setRechercheGlobale('')
  }

  const basculerChamp = (code: string) => setChamps((cs) => (cs.includes(code) ? cs.filter((c) => c !== code) : [...cs, code]))

  const deplacerChamp = (code: string, delta: number) =>
    setChamps((cs) => {
      const i = cs.indexOf(code)
      const j = i + delta
      if (i < 0 || j < 0 || j >= cs.length) return cs
      const copie = [...cs]
      ;[copie[i], copie[j]] = [copie[j], copie[i]]
      return copie
    })

  const majFiltre = (id: string, patch: Partial<Filtre>) => setFiltres((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const ajouterFiltre = (code: string) => {
    const c = champParCode.get(code)
    if (!c) return
    setFiltres((fs) => [...fs, filtreParDefaut(c)])
    setAjoutFiltre('')
  }

  const lancer = async (forcer = false) => {
    if (!source) return
    setEnCours(true)
    setErreur(null)
    const filtresEnvoyes = filtres
      .filter(filtreComplet)
      .map((f) => {
        // « est dans ma liste (collée) » sur un champ texte : valeurs séparées par retour à la ligne, ; ou ,
        if (f.operateur === 'parmi' && champParCode.get(f.champ)?.type === 'texte' && f.valeurs.length === 0) {
          return { ...f, valeurs: f.valeur.split(/[\n;,]+/).map((x) => x.trim()).filter(Boolean) }
        }
        return f
      })
      .map(({ champ, operateur, valeur, valeur2, valeurs }) => ({ champ, operateur, valeur, valeur2, valeurs }))
    const { data, error } = await supabase.rpc('requeteur_executer', {
      p_source: source.code,
      p_champs: champs,
      p_filtres: filtresEnvoyes,
      p_tri: [],
      p_limite: limite,
      p_forcer: forcer,
    })
    setEnCours(false)
    if (error) {
      setErreur(
        error.message.includes('statement timeout') || error.code === '57014'
          ? 'La requête a pris trop de temps et a été arrêtée. Ajoutez un filtre (une période sur une date, une agence, un client…) puis relancez.'
          : error.message,
      )
      return
    }
    setResultat(data as Resultat)
    setTri(null)
    setFiltresColonnes({})
    setRechercheGlobale('')
  }

  const chargerModele = (m: Modele) => {
    const s = sources?.find((x) => x.code === m.source)
    if (!s) return
    setSourceCode(m.source)
    setChamps(m.definition.champs.filter((c) => s.champs.some((x) => x.code === c)))
    setFiltres((m.definition.filtres ?? []).map((f) => ({ ...f, id: nouvelId(), valeurs: f.valeurs ?? [], valeur2: f.valeur2 ?? '' })))
    setLimite(m.definition.limite ?? 5000)
    setModeleActif(m)
    setResultat(null)
    setErreur(null)
  }

  const enregistrerModele = async (commeNouveau: boolean) => {
    if (!source || !nomModele.trim()) return
    const definition = { champs, filtres: filtres.map((f) => ({ champ: f.champ, operateur: f.operateur, valeur: f.valeur, valeur2: f.valeur2, valeurs: f.valeurs })), limite }
    if (modeleActif && !commeNouveau && modeleActif.created_by === moi) {
      await supabase
        .from('requeteur_modeles')
        .update({ nom: nomModele.trim(), definition, partage: partageModele, updated_at: new Date().toISOString() })
        .eq('id', modeleActif.id)
    } else {
      const { data } = await supabase
        .from('requeteur_modeles')
        .insert({ nom: nomModele.trim(), source: source.code, definition, partage: partageModele })
        .select()
        .single()
      if (data) setModeleActif(data as Modele)
    }
    setFenetreEnregistrer(false)
    chargerModeles()
  }

  const supprimerModele = async (m: Modele) => {
    if (!window.confirm(`Supprimer la requête « ${m.nom} » ?`)) return
    await supabase.from('requeteur_modeles').delete().eq('id', m.id)
    if (modeleActif?.id === m.id) setModeleActif(null)
    chargerModeles()
  }

  // ── Liste affichée ──
  const lignesAffichees = useMemo(() => {
    if (!resultat) return []
    let lignes = resultat.lignes
    const rg = rechercheGlobale.trim().toLowerCase()
    if (rg) {
      lignes = lignes.filter((l) => l.some((v, i) => formatCellule(v, resultat.colonnes[i].type).toLowerCase().includes(rg)))
    }
    const fc = Object.entries(filtresColonnes).filter(([, v]) => v.trim() !== '')
    if (fc.length) {
      lignes = lignes.filter((l) =>
        fc.every(([i, v]) => {
          const idx = Number(i)
          const col = resultat.colonnes[idx]
          const brut = l[idx]
          const s = v.trim()
          if (estNumerique(col.type)) {
            const m = s.match(/^(>=|<=|>|<|=)?\s*(-?[\d\s]+(?:[.,]\d+)?)$/)
            if (m) {
              const n = Number(m[2].replace(/\s/g, '').replace(',', '.'))
              const x = Number(brut)
              if (brut == null) return false
              switch (m[1]) {
                case '>': return x > n
                case '<': return x < n
                case '>=': return x >= n
                case '<=': return x <= n
                default: return x === n
              }
            }
          }
          return formatCellule(brut, col.type).toLowerCase().includes(s.toLowerCase())
        }),
      )
    }
    if (tri) {
      const { index, sens } = tri
      const type = resultat.colonnes[index].type
      lignes = [...lignes].sort((a, b) => {
        const va = a[index]
        const vb = b[index]
        if (va == null && vb == null) return 0
        if (va == null) return 1
        if (vb == null) return -1
        const r = estNumerique(type) ? Number(va) - Number(vb) : String(va).localeCompare(String(vb), 'fr', { numeric: true })
        return sens === 'asc' ? r : -r
      })
    }
    return lignes
  }, [resultat, rechercheGlobale, filtresColonnes, tri])

  const totaux = useMemo(() => {
    if (!resultat) return []
    return resultat.colonnes.map((c, i) =>
      c.type === 'montant' || c.type === 'nombre' ? lignesAffichees.reduce((s, l) => s + (Number(l[i]) || 0), 0) : null,
    )
  }, [resultat, lignesAffichees])

  const criteresTexte = useMemo(() => {
    const listes = filtres.filter(filtreComplet).map((f) => decrireFiltre(f, champParCode.get(f.champ)))
    if (rechercheGlobale.trim()) listes.push(`Recherche dans la liste : « ${rechercheGlobale.trim()} »`)
    if (resultat) {
      for (const [i, v] of Object.entries(filtresColonnes)) {
        if (v.trim()) listes.push(`Filtre de colonne ${resultat.colonnes[Number(i)].libelle} : « ${v.trim()} »`)
      }
    }
    return listes
  }, [filtres, champParCode, rechercheGlobale, filtresColonnes, resultat])

  const cliquerEntete = (index: number) =>
    setTri((t) => (!t || t.index !== index ? { index, sens: 'asc' } : t.sens === 'asc' ? { index, sens: 'desc' } : null))

  const resultatPerime = resultat && resultat.executee && (resultat.colonnes.map((c) => c.code).join('|') !== champs.join('|'))

  // ── Rendu ──
  if (erreurCatalogue) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <div className="font-black">Requêteur indisponible</div>
          <div className="mt-1 text-sm">{erreurCatalogue}</div>
        </div>
      </main>
    )
  }

  const champsChoisis = champs.map((c) => champParCode.get(c)).filter(Boolean) as Champ[]
  const mesModeles = modeles.filter((m) => m.created_by === moi)
  const modelesPartages = modeles.filter((m) => m.created_by !== moi)

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1800px] space-y-4">
        {/* En-tête */}
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-blue-700">Administration</div>
              <h1 className="mt-1 text-3xl font-black">Requêteur</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Construisez votre liste en trois étapes : ce que vous cherchez, les colonnes, les filtres. Affichez-la, triez-la, filtrez-la puis exportez-la sur Excel.
                Les données sont celles du compagnon (synchronisées avec SAGE plusieurs fois par jour).
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
                <option value="">📂 Ouvrir une requête enregistrée…</option>
                {mesModeles.length > 0 && (
                  <optgroup label="Mes requêtes">
                    {mesModeles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom}
                        {m.partage ? ' (partagée)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
                {modelesPartages.length > 0 && (
                  <optgroup label="Partagées par les collègues">
                    {modelesPartages.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nom} — {m.created_by.split('@')[0]}
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
                    setNomModele(modeleActif?.nom ?? '')
                    setPartageModele(modeleActif?.partage ?? false)
                    setFenetreEnregistrer(true)
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-50"
                >
                  💾 Enregistrer la requête
                </button>
              )}
            </div>
          </div>
        </header>

        {sources === null && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Chargement…</div>}

        {sources && (
          <>
            {/* Étape 1 */}
            <Etape numero={1} titre="Que cherchez-vous ?" aide="Choisissez le type d'information. Le reste de l'écran s'adapte à ce choix.">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                {sources.map((s) => (
                  <button
                    key={s.code}
                    onClick={() => choisirSource(s.code)}
                    className={`rounded-xl border p-3 text-left transition ${
                      s.code === sourceCode ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-400'
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
              <div className="grid gap-4 xl:grid-cols-2">
                {/* Étape 2 */}
                <Etape
                  numero={2}
                  titre="Quelles colonnes ?"
                  aide="Cochez les informations à afficher. L'ordre des colonnes se règle avec les flèches."
                  droite={
                    <div className="flex gap-2 text-xs">
                      <button className="text-blue-700 hover:underline" onClick={() => setChamps(source.champs.filter((c) => c.par_defaut).map((c) => c.code))}>
                        Colonnes conseillées
                      </button>
                      <button className="text-blue-700 hover:underline" onClick={() => setChamps(source.champs.map((c) => c.code))}>
                        Toutes
                      </button>
                      <button className="text-blue-700 hover:underline" onClick={() => setChamps([])}>
                        Aucune
                      </button>
                    </div>
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {grouper(source.champs).map(([groupe, liste]) => (
                      <div key={groupe}>
                        <div className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">{groupe}</div>
                        {liste.map((c) => (
                          <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50" title={c.description ?? undefined}>
                            <input type="checkbox" checked={champs.includes(c.code)} onChange={() => basculerChamp(c.code)} />
                            <span>{c.libelle}</span>
                            {c.description && <span className="text-xs text-slate-400">ⓘ</span>}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  {champsChoisis.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="mb-1 text-xs font-bold text-slate-500">Ordre des colonnes ({champsChoisis.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {champsChoisis.map((c, i) => (
                          <span key={c.code} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-1 pr-2 text-xs">
                            <button disabled={i === 0} onClick={() => deplacerChamp(c.code, -1)} className="px-1 text-slate-500 disabled:opacity-20" title="Vers la gauche">
                              ◀
                            </button>
                            <span className="font-semibold">{c.libelle}</span>
                            <button
                              disabled={i === champsChoisis.length - 1}
                              onClick={() => deplacerChamp(c.code, 1)}
                              className="px-1 text-slate-500 disabled:opacity-20"
                              title="Vers la droite"
                            >
                              ▶
                            </button>
                            <button onClick={() => basculerChamp(c.code)} className="pl-1 text-slate-400 hover:text-red-600" title="Retirer">
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </Etape>

                {/* Étape 3 */}
                <Etape numero={3} titre="Quels filtres ?" aide="Sans filtre, toute la base est lue : sur les factures et les devis, commencez par une période.">
                  <div className="space-y-2">
                    {filtres.length === 0 && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Aucun filtre pour l&apos;instant.</div>}
                    {filtres.map((f) => {
                      const c = champParCode.get(f.champ)
                      if (!c) return null
                      const ops = OPERATEURS[c.type]
                      const sansValeur = f.operateur === 'vide' || f.operateur === 'non_vide'
                      return (
                        <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                          <span className="min-w-[150px] text-sm font-bold">{c.libelle}</span>
                          <select
                            value={f.operateur}
                            onChange={(e) => {
                              const op = e.target.value
                              majFiltre(f.id, {
                                operateur: op,
                                valeur: op === 'periode' ? 'aujourdhui' : f.operateur === 'periode' ? '' : f.valeur,
                              })
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
                              <input
                                inputMode="decimal"
                                value={f.valeur}
                                onChange={(e) => majFiltre(f.id, { valeur: e.target.value })}
                                placeholder="0"
                                className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                              />
                              {f.operateur === 'entre' && (
                                <>
                                  <span className="text-sm text-slate-500">et</span>
                                  <input
                                    inputMode="decimal"
                                    value={f.valeur2}
                                    onChange={(e) => majFiltre(f.id, { valeur2: e.target.value })}
                                    className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                                  />
                                </>
                              )}
                            </>
                          )}

                          {!sansValeur && (c.type === 'texte' || (c.type === 'liste' && f.operateur === 'contient')) && f.operateur !== 'parmi' && (
                            <input
                              value={f.valeur}
                              onChange={(e) => majFiltre(f.id, { valeur: e.target.value })}
                              placeholder="Texte…"
                              className="min-w-[200px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                            />
                          )}

                          {!sansValeur && c.type === 'texte' && f.operateur === 'parmi' && (
                            <textarea
                              value={f.valeur}
                              onChange={(e) => majFiltre(f.id, { valeur: e.target.value, valeurs: [] })}
                              placeholder="Collez une liste (une valeur par ligne, ou séparées par ; ou ,)"
                              rows={2}
                              className="min-w-[240px] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                            />
                          )}

                          <button onClick={() => setFiltres((fs) => fs.filter((x) => x.id !== f.id))} className="ml-auto px-2 text-slate-400 hover:text-red-600" title="Retirer le filtre">
                            ✕
                          </button>
                        </div>
                      )
                    })}

                    <select
                      value={ajoutFiltre}
                      onChange={(e) => ajouterFiltre(e.target.value)}
                      className="w-full rounded-xl border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-600"
                    >
                      <option value="">＋ Ajouter un filtre sur…</option>
                      {grouper(source.champs).map(([groupe, liste]) => (
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
            )}

            {/* Lancement */}
            {source && (
              <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button
                  disabled={enCours || champs.length === 0}
                  onClick={() => lancer(false)}
                  className="rounded-xl bg-[#0B1220] px-6 py-3 text-base font-black text-white shadow hover:bg-slate-800 disabled:opacity-40"
                >
                  {enCours ? 'Recherche en cours…' : '▶ Afficher la liste'}
                </button>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Afficher au plus
                  <select value={limite} onChange={(e) => setLimite(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                    {LIMITES.map((l) => (
                      <option key={l} value={l}>
                        {l.toLocaleString('fr-FR')} lignes
                      </option>
                    ))}
                  </select>
                </label>
                {champs.length === 0 && <span className="text-sm text-amber-700">Choisissez au moins une colonne.</span>}
                {criteresTexte.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {filtres.filter(filtreComplet).map((f) => (
                      <span key={f.id} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                        {decrireFiltre(f, champParCode.get(f.champ))}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Erreurs et alertes */}
            {erreur && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">⚠️ {erreur}</div>}

            {resultat?.alerte && !resultat.executee && (
              <div
                className={`rounded-2xl border p-4 text-sm ${
                  resultat.alerte.niveau === 'bloquant' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="font-black">{resultat.alerte.niveau === 'bloquant' ? '⛔ Requête trop lourde' : '⚠️ Requête lourde'}</div>
                <div className="mt-1">{resultat.alerte.message}</div>
                {resultat.alerte.niveau === 'lourd' && (
                  <button onClick={() => lancer(true)} disabled={enCours} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
                    {enCours ? 'Recherche en cours…' : 'Lancer quand même'}
                  </button>
                )}
              </div>
            )}

            {/* Résultat */}
            {resultat?.executee && source && (
              <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
                  <div>
                    <div className="text-lg font-black">
                      {lignesAffichees.length.toLocaleString('fr-FR')} ligne{lignesAffichees.length > 1 ? 's' : ''}
                      {lignesAffichees.length !== resultat.nb && (
                        <span className="text-sm font-normal text-slate-500"> sur {resultat.nb.toLocaleString('fr-FR')}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {source.libelle} · obtenue en {(resultat.duree_ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s
                    </div>
                  </div>
                  {resultat.tronque && (
                    <div className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                      Liste limitée à {resultat.nb.toLocaleString('fr-FR')} lignes : d&apos;autres lignes correspondent. Ajoutez un filtre ou augmentez le maximum.
                    </div>
                  )}
                  {resultatPerime && <div className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs text-blue-800">Les colonnes ont changé : cliquez sur « Afficher la liste » pour mettre à jour.</div>}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <input
                      value={rechercheGlobale}
                      onChange={(e) => setRechercheGlobale(e.target.value)}
                      placeholder="🔍 Rechercher dans la liste…"
                      className="w-64 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    {(rechercheGlobale || Object.values(filtresColonnes).some((v) => v) || tri) && (
                      <button
                        onClick={() => {
                          setRechercheGlobale('')
                          setFiltresColonnes({})
                          setTri(null)
                        }}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
                      >
                        Effacer tri et filtres
                      </button>
                    )}
                    <button
                      disabled={lignesAffichees.length === 0}
                      onClick={() =>
                        exporterExcel({ source, colonnes: resultat.colonnes, lignes: lignesAffichees, criteres: criteresTexte, tronque: resultat.tronque })
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
                        {resultat.colonnes.map((c, i) => (
                          <th
                            key={c.code}
                            onClick={() => cliquerEntete(i)}
                            className={`cursor-pointer select-none whitespace-nowrap border-b border-slate-200 px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-600 hover:bg-slate-200 ${
                              estNumerique(c.type) ? 'text-right' : ''
                            }`}
                            title="Cliquer pour trier"
                          >
                            {c.libelle}
                            <span className="ml-1 text-slate-400">{tri?.index === i ? (tri.sens === 'asc' ? '▲' : '▼') : '↕'}</span>
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {resultat.colonnes.map((c, i) => (
                          <th key={c.code} className="border-b border-slate-200 bg-slate-50 px-2 py-1">
                            <input
                              value={filtresColonnes[i] ?? ''}
                              onChange={(e) => setFiltresColonnes((fc) => ({ ...fc, [i]: e.target.value }))}
                              placeholder={estNumerique(c.type) ? '> 1000' : 'filtrer…'}
                              className={`w-full min-w-[70px] rounded border border-slate-200 px-1.5 py-0.5 text-xs font-normal ${estNumerique(c.type) ? 'text-right' : ''}`}
                            />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lignesAffichees.slice(0, 2000).map((l, r) => (
                        <tr key={r} className="odd:bg-white even:bg-slate-50/60 hover:bg-blue-50/50">
                          {resultat.colonnes.map((c, i) => (
                            <td key={c.code} className={`whitespace-nowrap border-b border-slate-100 px-3 py-1.5 ${estNumerique(c.type) ? 'text-right tabular-nums' : ''}`}>
                              {formatCellule(l[i], c.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {lignesAffichees.length === 0 && (
                        <tr>
                          <td colSpan={resultat.colonnes.length} className="p-6 text-center text-slate-500">
                            Aucune ligne ne correspond.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {lignesAffichees.length > 0 && totaux.some((t) => t != null) && (
                      <tfoot className="sticky bottom-0 bg-slate-100 font-black">
                        <tr>
                          {resultat.colonnes.map((c, i) => (
                            <td key={c.code} className={`whitespace-nowrap border-t border-slate-300 px-3 py-2 ${estNumerique(c.type) ? 'text-right tabular-nums' : ''}`}>
                              {i === 0 && totaux[0] == null ? 'Total' : totaux[i] != null ? formatCellule(totaux[i], c.type) : ''}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                  {lignesAffichees.length > 2000 && (
                    <div className="p-3 text-center text-xs text-slate-500">
                      Les 2 000 premières lignes sont affichées à l&apos;écran ; l&apos;export Excel contient les {lignesAffichees.length.toLocaleString('fr-FR')} lignes.
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
            <h3 className="text-lg font-black">Enregistrer la requête</h3>
            <p className="mt-1 text-xs text-slate-500">Elle gardera la source, les colonnes et les filtres. Une période (« aujourd&apos;hui », « mois dernier »…) est recalculée à chaque ouverture.</p>
            <input
              autoFocus
              value={nomModele}
              onChange={(e) => setNomModele(e.target.value)}
              placeholder="Nom (ex. BL du jour par agence)"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={partageModele} onChange={(e) => setPartageModele(e.target.checked)} />
              La partager avec les autres utilisateurs du requêteur
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setFenetreEnregistrer(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                Annuler
              </button>
              {modeleActif && modeleActif.created_by === moi && (
                <button onClick={() => enregistrerModele(true)} disabled={!nomModele.trim()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">
                  Enregistrer comme nouvelle
                </button>
              )}
              <button onClick={() => enregistrerModele(false)} disabled={!nomModele.trim()} className="rounded-lg bg-[#0B1220] px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
