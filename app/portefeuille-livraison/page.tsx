'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { accessLockedSelectClassName, lockedFilterLabel, restrictOptions, usePageFilterAccess } from '@/lib/pageAccessFilters'

type LignePortefeuille = {
  id: number | string | null
  type_document: string | null
  numero_document: string | null
  numero_tiers: string | null
  nom_tiers: string | null
  date_creation_document: string | null
  date_livraison: string | null
  mois_livraison: string | null
  reference_article: string | null
  designation_article: string | null
  reference: string | null
  famille: string | null
  famille_macro: string | null
  quantite: number | null
  montant_ht: number | null
  client_en_sommeil: boolean | null
  code_representant: string | null
  representant: string | null
  agence: string | null
}

type DocumentPortefeuille = {
  key: string
  representant: string
  agence: string
  numero_tiers: string
  nom_tiers: string
  type_document: string
  numero_document: string
  nb_lignes: number
  montant_ht: number
  date_creation_document: string | null
  date_livraison: string | null
  mois_livraison: string
  client_en_sommeil: boolean
  familles_macro: string
  references_articles: string
  references: string
}

type SyntheseRow = {
  key: string
  representant: string
  agence: string
  type_document: string
  byMonth: Record<string, { nb_documents: number; montant_ht: number }>
  total_nb_documents: number
  total_montant_ht: number
}

type DetailSelection = {
  representant?: string
  agence?: string
  type_document?: string
  mois_livraison?: string
  totalType?: 'ligne' | 'colonne' | 'general'
}

type SortConfig<T> = {
  key: keyof T
  direction: 'asc' | 'desc'
} | null

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseAnonKey)

const DEFAULT_TYPES = ['CDC']
const ALL_TYPES = ['CDC', 'PL', 'BL', 'BR']
const ACCESS_LOCKED_AGENCE_VALUE = '__ACCESS_LOCKED_AGENCE__'
const ACCESS_LOCKED_REPRESENTANT_VALUE = '__ACCESS_LOCKED_REPRESENTANT__'

function getYesterdayIsoDate() {
  const date = new Date()
  date.setDate(date.getDate() - 1)

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getCurrentMonthKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function isMonthBeforeCurrent(month: string, currentMonthKey: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return false
  return month < currentMonthKey
}

function getSummaryHeaderClassName(month: string, currentMonthKey: string) {
  const base =
    'whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-3 py-2 text-right'

  if (month === 'AVANT_2026') {
    return `${base} bg-red-100 text-red-950 hover:bg-red-200`
  }

  if (isMonthBeforeCurrent(month, currentMonthKey)) {
    return `${base} bg-orange-100 text-orange-950 hover:bg-orange-200`
  }

  return `${base} hover:bg-slate-200`
}

function getSummaryCellClassName(month: string, hasValue: boolean, currentMonthKey: string) {
  const base = 'border-b border-r border-slate-200 px-3 py-2 text-right'

  if (month === 'AVANT_2026') {
    return [
      base,
      'bg-red-50',
      hasValue ? 'cursor-pointer text-red-950 hover:bg-red-100' : 'text-red-200',
    ].join(' ')
  }

  if (isMonthBeforeCurrent(month, currentMonthKey)) {
    return [
      base,
      'bg-orange-50',
      hasValue ? 'cursor-pointer text-orange-950 hover:bg-orange-100' : 'text-orange-200',
    ].join(' ')
  }

  return [
    base,
    hasValue ? 'cursor-pointer hover:bg-blue-50' : 'text-slate-300',
  ].join(' ')
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value || 0)

  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatMoneyCompact(value: number | null | undefined) {
  const amount = Number(value || 0)

  if (Math.abs(amount) >= 1000000) {
    return `${(amount / 1000000).toLocaleString('fr-FR', {
      maximumFractionDigits: 1,
    })} M€`
  }

  if (Math.abs(amount) >= 1000) {
    return `${(amount / 1000).toLocaleString('fr-FR', {
      maximumFractionDigits: 0,
    })} k€`
  }

  return formatMoney(amount)
}

function formatDate(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('fr-FR')
}

function safeText(value: string | null | undefined, fallback = 'Non renseigné') {
  const clean = String(value || '').trim()
  return clean || fallback
}

function docKey(row: LignePortefeuille) {
  return [
    safeText(row.type_document, ''),
    safeText(row.numero_document, ''),
    safeText(row.numero_tiers, ''),
  ].join('::')
}

function sortValues(a: unknown, b: unknown) {
  const va = a === null || a === undefined ? '' : a
  const vb = b === null || b === undefined ? '' : b

  if (typeof va === 'number' && typeof vb === 'number') {
    return va - vb
  }

  return String(va).localeCompare(String(vb), 'fr', {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortArray<T>(rows: T[], config: SortConfig<T>) {
  if (!config) return rows

  return [...rows].sort((a, b) => {
    const result = sortValues(a[config.key], b[config.key])
    return config.direction === 'asc' ? result : -result
  })
}

function monthLabel(month: string) {
  if (month === 'AVANT_2026') return 'Avant 2026'
  if (month === 'SANS_DATE_LIVRAISON') return 'Sans date livraison'
  return month
}

function uniqueJoined(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  )
    .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .join(', ')
}

export default function PortefeuilleLivraisonPage() {
 
  
  const currentMonthKey = useMemo(() => getCurrentMonthKey(), [])
  const access = usePageFilterAccess()

  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [lignes, setLignes] = useState<LignePortefeuille[]>([])

  const [selectedTypes, setSelectedTypes] = useState<string[]>(DEFAULT_TYPES)

  const [dateCreationDebut, setDateCreationDebut] = useState('')
  const [dateCreationFin, setDateCreationFin] = useState('')
  const [dateLivraisonDebut, setDateLivraisonDebut] = useState('')
  const [dateLivraisonFin, setDateLivraisonFin] = useState(() => getYesterdayIsoDate())

  const [selectedRepresentant, setSelectedRepresentant] = useState('')
  const [selectedAgence, setSelectedAgence] = useState('')
  const [selectedFamilleMacro, setSelectedFamilleMacro] = useState('')
  const [selectedSommeil, setSelectedSommeil] = useState<'TOUS' | 'OUI' | 'NON'>('TOUS')

  const [selection, setSelection] = useState<DetailSelection | null>(null)
  const [selectedDocumentKeyForLines, setSelectedDocumentKeyForLines] = useState<string | null>(null)

  const [documentSort, setDocumentSort] = useState<SortConfig<DocumentPortefeuille>>({
    key: 'date_livraison',
    direction: 'asc',
  })

  const [ligneSort, setLigneSort] = useState<SortConfig<LignePortefeuille>>({
    key: 'date_livraison',
    direction: 'asc',
  })

  function applyDetailSelection(nextSelection: DetailSelection | null) {
    setSelection(nextSelection)
    setSelectedDocumentKeyForLines(null)
  }

  async function loadData() {
    setLoading(true)
    setErrorMessage(null)

    try {
      let query = supabase
        .from('v_portefeuille_livraison_lignes')
        .select('*')
        .in('type_document', selectedTypes.length ? selectedTypes : DEFAULT_TYPES)
        .order('date_livraison', { ascending: true, nullsFirst: true })

      if (dateCreationDebut) {
        query = query.gte('date_creation_document', dateCreationDebut)
      }

      if (dateCreationFin) {
        query = query.lte('date_creation_document', dateCreationFin)
      }

      if (dateLivraisonDebut) {
        query = query.gte('date_livraison', dateLivraisonDebut)
      }

      if (dateLivraisonFin) {
        query = query.lte('date_livraison', dateLivraisonFin)
      }

      if (access.allowedCollaborateurs.length > 0) {
        query = query.in('representant', access.allowedCollaborateurs)
      } else if (selectedRepresentant) {
        query = query.eq('representant', selectedRepresentant)
      }

      if (access.allowedAgences.length > 0) {
        query = query.in('agence', access.allowedAgences)
      } else if (selectedAgence) {
        query = query.eq('agence', selectedAgence)
      }

      if (selectedFamilleMacro) {
        query = query.eq('famille_macro', selectedFamilleMacro)
      }

      if (selectedSommeil === 'OUI') {
        query = query.eq('client_en_sommeil', true)
      }

      if (selectedSommeil === 'NON') {
        query = query.or('client_en_sommeil.is.false,client_en_sommeil.is.null')
      }

      const { data, error } = await query.limit(50000)

      if (error) {
        throw error
      }

      setLignes((data || []) as LignePortefeuille[])
      setSelection(null)
      setSelectedDocumentKeyForLines(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Erreur inconnue lors du chargement du portefeuille.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!access.loading) loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.loading])

  const documents = useMemo<DocumentPortefeuille[]>(() => {
    const map = new Map<
      string,
      DocumentPortefeuille & {
        famillesSet: Set<string>
        referencesArticlesSet: Set<string>
        referencesSet: Set<string>
      }
    >()

    for (const ligne of lignes) {
      const key = docKey(ligne)
      const existing = map.get(key)

      const familleMacro = safeText(ligne.famille_macro, 'Sans famille macro')
      const referenceArticle = safeText(ligne.reference_article, '')
      const reference = safeText(ligne.reference, '')

      if (!existing) {
        map.set(key, {
          key,
          representant: safeText(ligne.representant, 'Sans représentant'),
          agence: safeText(ligne.agence, 'Sans agence'),
          numero_tiers: safeText(ligne.numero_tiers, ''),
          nom_tiers: safeText(ligne.nom_tiers, ''),
          type_document: safeText(ligne.type_document, ''),
          numero_document: safeText(ligne.numero_document, ''),
          nb_lignes: 1,
          montant_ht: Number(ligne.montant_ht || 0),
          date_creation_document: ligne.date_creation_document,
          date_livraison: ligne.date_livraison,
          mois_livraison: ligne.mois_livraison || 'SANS_DATE_LIVRAISON',
          client_en_sommeil: Boolean(ligne.client_en_sommeil),
          familles_macro: familleMacro,
          references_articles: referenceArticle,
          references: reference,
          famillesSet: new Set(familleMacro ? [familleMacro] : []),
          referencesArticlesSet: new Set(referenceArticle ? [referenceArticle] : []),
          referencesSet: new Set(reference ? [reference] : []),
        })
      } else {
        existing.nb_lignes += 1
        existing.montant_ht += Number(ligne.montant_ht || 0)

        if (familleMacro) existing.famillesSet.add(familleMacro)
        if (referenceArticle) existing.referencesArticlesSet.add(referenceArticle)
        if (reference) existing.referencesSet.add(reference)

        existing.familles_macro = Array.from(existing.famillesSet).sort().join(', ')
        existing.references_articles = Array.from(existing.referencesArticlesSet).sort().join(', ')
        existing.references = Array.from(existing.referencesSet).sort().join(', ')
      }
    }

    return Array.from(map.values()).map(
      ({ famillesSet, referencesArticlesSet, referencesSet, ...doc }) => doc
    )
  }, [lignes])

  const moisLivraison = useMemo(() => {
    const set = new Set<string>()

    for (const doc of documents) {
      set.add(doc.mois_livraison || 'SANS_DATE_LIVRAISON')
    }

    const values = Array.from(set)

    return values.sort((a, b) => {
      if (a === 'AVANT_2026') return -1
      if (b === 'AVANT_2026') return 1

      if (a === 'SANS_DATE_LIVRAISON') return -1
      if (b === 'SANS_DATE_LIVRAISON') return 1

      return a.localeCompare(b)
    })
  }, [documents])

  const synthese = useMemo<SyntheseRow[]>(() => {
    const map = new Map<string, SyntheseRow>()

    for (const doc of documents) {
      const key = [doc.representant, doc.agence, doc.type_document].join('::')
      const mois = doc.mois_livraison || 'SANS_DATE_LIVRAISON'

      if (!map.has(key)) {
        map.set(key, {
          key,
          representant: doc.representant,
          agence: doc.agence,
          type_document: doc.type_document,
          byMonth: {},
          total_nb_documents: 0,
          total_montant_ht: 0,
        })
      }

      const row = map.get(key)!

      if (!row.byMonth[mois]) {
        row.byMonth[mois] = {
          nb_documents: 0,
          montant_ht: 0,
        }
      }

      row.byMonth[mois].nb_documents += 1
      row.byMonth[mois].montant_ht += doc.montant_ht
      row.total_nb_documents += 1
      row.total_montant_ht += doc.montant_ht
    }

    return Array.from(map.values()).sort((a, b) => {
      return (
        a.representant.localeCompare(b.representant, 'fr') ||
        a.agence.localeCompare(b.agence, 'fr') ||
        a.type_document.localeCompare(b.type_document, 'fr')
      )
    })
  }, [documents])

  const representants = useMemo(() => {
    const values = Array.from(
      new Set(lignes.map((ligne) => safeText(ligne.representant, 'Sans représentant')))
    ).sort()

    const restricted = restrictOptions(values, access.allowedCollaborateurs)
    return Array.from(new Set([...access.allowedCollaborateurs, ...restricted])).filter(Boolean).sort()
  }, [lignes, access.allowedCollaborateurs])

  const agences = useMemo(() => {
    const values = Array.from(
      new Set(lignes.map((ligne) => safeText(ligne.agence, 'Sans agence')))
    ).sort()

    const restricted = restrictOptions(values, access.allowedAgences)
    return Array.from(new Set([...access.allowedAgences, ...restricted])).filter(Boolean).sort()
  }, [lignes, access.allowedAgences])

  const isRepresentantLocked = access.hasCollaborateurRestriction
  const isAgenceLocked = access.hasAgenceRestriction

  const representantSelectValue = isRepresentantLocked
    ? access.allowedCollaborateurs.length === 1
      ? access.allowedCollaborateurs[0]
      : ACCESS_LOCKED_REPRESENTANT_VALUE
    : selectedRepresentant

  const agenceSelectValue = isAgenceLocked
    ? access.allowedAgences.length === 1
      ? access.allowedAgences[0]
      : ACCESS_LOCKED_AGENCE_VALUE
    : selectedAgence

  const selectBaseClassName = 'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm'

  const famillesMacro = useMemo(() => {
    return Array.from(
      new Set(lignes.map((ligne) => safeText(ligne.famille_macro, 'Sans famille macro')))
    ).sort()
  }, [lignes])

  const selectedDocuments = useMemo(() => {
    if (!selection) return documents

    return documents.filter((doc) => {
      if (selection.totalType === 'general') return true

      if (selection.totalType === 'colonne') {
        return doc.mois_livraison === selection.mois_livraison
      }

      if (selection.totalType === 'ligne') {
        return (
          doc.representant === selection.representant &&
          doc.agence === selection.agence &&
          doc.type_document === selection.type_document
        )
      }

      return (
        doc.representant === selection.representant &&
        doc.agence === selection.agence &&
        doc.type_document === selection.type_document &&
        doc.mois_livraison === selection.mois_livraison
      )
    })
  }, [documents, selection])

  const selectedDocumentKeys = useMemo(() => {
    return new Set(selectedDocuments.map((doc) => doc.key))
  }, [selectedDocuments])

  const selectedDocumentForLines = useMemo(() => {
    if (!selectedDocumentKeyForLines) return null
    return selectedDocuments.find((doc) => doc.key === selectedDocumentKeyForLines) || null
  }, [selectedDocumentKeyForLines, selectedDocuments])

  const selectedLignes = useMemo(() => {
    const keys = selectedDocumentKeyForLines
      ? new Set([selectedDocumentKeyForLines])
      : selectedDocumentKeys

    return lignes.filter((ligne) => keys.has(docKey(ligne)))
  }, [lignes, selectedDocumentKeyForLines, selectedDocumentKeys])

  const sortedDocuments = useMemo(() => {
    return sortArray(selectedDocuments, documentSort)
  }, [selectedDocuments, documentSort])

  const sortedLignes = useMemo(() => {
    return sortArray(selectedLignes, ligneSort)
  }, [selectedLignes, ligneSort])

  const totalGeneral = useMemo(() => {
    return documents.reduce(
      (acc, doc) => {
        acc.nb_documents += 1
        acc.montant_ht += doc.montant_ht
        return acc
      },
      { nb_documents: 0, montant_ht: 0 }
    )
  }, [documents])

  function toggleType(type: string) {
    setSelectedTypes((current) => {
      if (current.includes(type)) {
        const next = current.filter((item) => item !== type)
        return next.length ? next : current
      }

      return [...current, type]
    })
  }

  function toggleDocumentSort(key: keyof DocumentPortefeuille) {
    setDocumentSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' }
      }

      return {
        key,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }

  function toggleLigneSort(key: keyof LignePortefeuille) {
    setLigneSort((current) => {
      if (!current || current.key !== key) {
        return { key, direction: 'asc' }
      }

      return {
        key,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }

  function exportExcel() {
    const syntheseExport: Record<string, string | number>[] = synthese.map((row) => {
      const base: Record<string, string | number> = {
        Representant: row.representant,
        Agence: row.agence,
        Type_document: row.type_document,
      }

      for (const mois of moisLivraison) {
        const cell = row.byMonth[mois]

        base[`${monthLabel(mois)} - Nb docs`] = cell?.nb_documents || 0
        base[`${monthLabel(mois)} - Montant HT`] = Number((cell?.montant_ht || 0).toFixed(2))
      }

      base['Total - Nb docs'] = row.total_nb_documents
      base['Total - Montant HT'] = Number(row.total_montant_ht.toFixed(2))

      return base
    })

    const documentsExport = sortedDocuments.map((doc) => ({
      Representant: doc.representant,
      Agence: doc.agence,
      'N° tiers': doc.numero_tiers,
      Client: doc.nom_tiers,
      'Type doc': doc.type_document,
      'N° document': doc.numero_document,
      'Nb lignes': doc.nb_lignes,
      'Montant HT': Number(doc.montant_ht.toFixed(2)),
      'Date création document': formatDate(doc.date_creation_document),
      'Date livraison': formatDate(doc.date_livraison),
      'Mois livraison': monthLabel(doc.mois_livraison),
      'Références articles': doc.references_articles,
      Référence: doc.references,
      'Client en sommeil': doc.client_en_sommeil ? 'Oui' : 'Non',
      'Familles macro': doc.familles_macro,
    }))

    const exportDocumentKeys = new Set(sortedDocuments.map((doc) => doc.key))

    const detailLignesExport = lignes.filter((ligne) => {
      return exportDocumentKeys.has(docKey(ligne))
    })

    const lignesExport = detailLignesExport.map((ligne) => ({
      Representant: safeText(ligne.representant, 'Sans représentant'),
      Agence: safeText(ligne.agence, 'Sans agence'),
      'N° tiers': safeText(ligne.numero_tiers, ''),
      Client: safeText(ligne.nom_tiers, ''),
      'Type doc': safeText(ligne.type_document, ''),
      'N° document': safeText(ligne.numero_document, ''),
      'Référence article': safeText(ligne.reference_article, ''),
      'Désignation article': safeText(ligne.designation_article, ''),
      Référence: safeText(ligne.reference, ''),
      Famille: safeText(ligne.famille, ''),
      'Famille macro': safeText(ligne.famille_macro, 'Sans famille macro'),
      Quantité: Number(ligne.quantite || 0),
      'Montant HT': Number(ligne.montant_ht || 0),
      'Date création document': formatDate(ligne.date_creation_document),
      'Date livraison': formatDate(ligne.date_livraison),
      'Mois livraison': monthLabel(ligne.mois_livraison || 'SANS_DATE_LIVRAISON'),
      'Client en sommeil': ligne.client_en_sommeil ? 'Oui' : 'Non',
    }))

    const workbook = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(syntheseExport),
      'Synthese'
    )

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(documentsExport),
      'Documents'
    )

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(lignesExport),
      'Detail lignes'
    )

    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `portefeuille_livraison_${stamp}.xlsx`)
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-[1800px] space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Portefeuille CDC / PL / BL / BR par livraison
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Vision par représentant, agence, type document et mois de livraison, avec détail document et détail ligne.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              >
                {loading ? 'Chargement...' : 'Actualiser'}
              </button>

              <button
                type="button"
                onClick={exportExcel}
                disabled={loading || lignes.length === 0}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              >
                Export Excel
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 p-3 xl:col-span-2">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Types documents
              </div>

              <div className="flex flex-wrap gap-4">
                {ALL_TYPES.map((type) => (
                  <label
                    key={type}
                    className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.includes(type)}
                      onChange={() => toggleType(type)}
                      className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Création début
              </span>
              <input
                type="date"
                value={dateCreationDebut}
                onChange={(event) => setDateCreationDebut(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Création fin
              </span>
              <input
                type="date"
                value={dateCreationFin}
                onChange={(event) => setDateCreationFin(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Livraison début
              </span>
              <input
                type="date"
                value={dateLivraisonDebut}
                onChange={(event) => setDateLivraisonDebut(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Livraison fin
              </span>
              <input
                type="date"
                value={dateLivraisonFin}
                onChange={(event) => setDateLivraisonFin(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Représentant
              </span>
              <select
                value={representantSelectValue}
                disabled={isRepresentantLocked}
                onChange={(event) => {
                  if (!isRepresentantLocked) setSelectedRepresentant(event.target.value)
                }}
                className={accessLockedSelectClassName(selectBaseClassName, isRepresentantLocked)}
              >
                {isRepresentantLocked && access.allowedCollaborateurs.length > 1 ? (
                  <option value={ACCESS_LOCKED_REPRESENTANT_VALUE}>
                    {lockedFilterLabel(access.allowedCollaborateurs, 'Tous')}
                  </option>
                ) : (
                  <option value="">Tous</option>
                )}
                {representants.map((value) => (
                  <option key={value} value={value}>
                    {isRepresentantLocked && access.allowedCollaborateurs.length === 1 ? `${value} 🔒` : value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agence
              </span>
              <select
                value={agenceSelectValue}
                disabled={isAgenceLocked}
                onChange={(event) => {
                  if (!isAgenceLocked) setSelectedAgence(event.target.value)
                }}
                className={accessLockedSelectClassName(selectBaseClassName, isAgenceLocked)}
              >
                {isAgenceLocked && access.allowedAgences.length > 1 ? (
                  <option value={ACCESS_LOCKED_AGENCE_VALUE}>
                    {lockedFilterLabel(access.allowedAgences, 'Toutes')}
                  </option>
                ) : (
                  <option value="">Toutes</option>
                )}
                {agences.map((value) => (
                  <option key={value} value={value}>
                    {isAgenceLocked && access.allowedAgences.length === 1 ? `${value} 🔒` : value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Famille macro
              </span>
              <select
                value={selectedFamilleMacro}
                onChange={(event) => setSelectedFamilleMacro(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Toutes</option>
                {famillesMacro.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Client en sommeil
              </span>
              <select
                value={selectedSommeil}
                onChange={(event) =>
                  setSelectedSommeil(event.target.value as 'TOUS' | 'OUI' | 'NON')
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="TOUS">Tous</option>
                <option value="OUI">Oui</option>
                <option value="NON">Non</option>
              </select>
            </label>
          </div>

          {errorMessage && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Documents
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {totalGeneral.nb_documents.toLocaleString('fr-FR')}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Montant HT
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {formatMoney(totalGeneral.montant_ht)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lignes
            </div>
            <div className="mt-1 text-2xl font-semibold">
              {lignes.length.toLocaleString('fr-FR')}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sélection détail
            </div>
            <div className="mt-1 text-sm font-medium text-slate-700">
              {selection ? 'Filtrée par clic tableau' : 'Toutes les données filtrées'}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold">Tableau de synthèse</h2>
              <p className="text-sm text-slate-500">
                Clique sur une cellule, une ligne, une colonne ou le total général pour afficher le détail en dessous.
              </p>
            </div>

            <button
              type="button"
              onClick={() => applyDetailSelection(null)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Réinitialiser détail
            </button>
          </div>

          <div className="max-h-[580px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="sticky left-0 z-20 whitespace-nowrap border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left">
                    Représentant
                  </th>

                  <th className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-left">
                    Agence
                  </th>

                  <th className="whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-left">
                    Type doc
                  </th>

                  {moisLivraison.map((mois) => (
                    <th
                      key={mois}
                      className={getSummaryHeaderClassName(mois, currentMonthKey)}
                      onClick={() =>
                        applyDetailSelection({
                          mois_livraison: mois,
                          totalType: 'colonne',
                        })
                      }
                    >
                      {monthLabel(mois)}
                    </th>
                  ))}

                  <th
                    className="whitespace-nowrap cursor-pointer border-b border-slate-200 px-3 py-2 text-right hover:bg-slate-200"
                    onClick={() => applyDetailSelection({ totalType: 'general' })}
                  >
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {synthese.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="sticky left-0 border-b border-r border-slate-200 bg-white px-3 py-2 font-medium">
                      {row.representant}
                    </td>

                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      {row.agence}
                    </td>

                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      {row.type_document}
                    </td>

                    {moisLivraison.map((mois) => {
                      const cell = row.byMonth[mois]
                      const hasValue = Boolean(cell && cell.nb_documents > 0)

                      return (
                        <td
                          key={`${row.key}-${mois}`}
                          onClick={() => {
                            if (!hasValue) return

                            applyDetailSelection({
                              representant: row.representant,
                              agence: row.agence,
                              type_document: row.type_document,
                              mois_livraison: mois,
                            })
                          }}
                          className={getSummaryCellClassName(mois, hasValue, currentMonthKey)}
                        >
                          {hasValue ? (
                            <div className="leading-tight">
                              <div className="whitespace-nowrap font-semibold">
                                {cell.nb_documents.toLocaleString('fr-FR')} docs
                              </div>
                              <div className="whitespace-nowrap text-xs text-slate-500">
                                {formatMoneyCompact(cell.montant_ht)}
                              </div>
                            </div>
                          ) : (
                            '-'
                          )}
                        </td>
                      )
                    })}

                    <td
                      onClick={() =>
                        applyDetailSelection({
                          representant: row.representant,
                          agence: row.agence,
                          type_document: row.type_document,
                          totalType: 'ligne',
                        })
                      }
                      className="cursor-pointer border-b border-slate-200 bg-slate-50 px-3 py-2 text-right hover:bg-blue-50"
                    >
                      <div className="leading-tight">
                        <div className="whitespace-nowrap font-semibold">
                          {row.total_nb_documents.toLocaleString('fr-FR')} docs
                        </div>
                        <div className="whitespace-nowrap text-xs text-slate-500">
                          {formatMoneyCompact(row.total_montant_ht)}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}

                {synthese.length === 0 && (
                  <tr>
                    <td
                      colSpan={4 + moisLivraison.length}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Aucune donnée trouvée avec les filtres sélectionnés.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-lg font-semibold">Liste des documents</h2>
            <p className="text-sm text-slate-500">
              {sortedDocuments.length.toLocaleString('fr-FR')} document(s) affiché(s).
              Clique sur un numéro de document pour filtrer le détail à la ligne.
            </p>
          </div>

          <div className="max-h-[480px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {[
                    ['representant', 'Représentant'],
                    ['agence', 'Agence'],
                    ['numero_tiers', 'N° tiers'],
                    ['nom_tiers', 'Client'],
                    ['type_document', 'Type doc'],
                    ['numero_document', 'N° document'],
                    ['references_articles', 'Réf. articles'],
                    ['references', 'Référence'],
                    ['nb_lignes', 'Nb lignes'],
                    ['montant_ht', 'Montant HT'],
                    ['date_creation_document', 'Date création'],
                    ['date_livraison', 'Date livraison'],
                    ['familles_macro', 'Familles macro'],
                    ['client_en_sommeil', 'Sommeil'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleDocumentSort(key as keyof DocumentPortefeuille)}
                      className="whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-3 py-2 text-left hover:bg-slate-200"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortedDocuments.map((doc) => (
                  <tr
                    key={doc.key}
                    className={[
                      'hover:bg-slate-50',
                      selectedDocumentKeyForLines === doc.key ? 'bg-blue-50' : '',
                    ].join(' ')}
                  >
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.representant}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.agence}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.numero_tiers}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.nom_tiers}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.type_document}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => setSelectedDocumentKeyForLines(doc.key)}
                        className="font-semibold text-blue-700 underline-offset-2 hover:underline"
                      >
                        {doc.numero_document}
                      </button>
                    </td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.references_articles}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.references}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-right">{doc.nb_lignes}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-right">{formatMoney(doc.montant_ht)}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(doc.date_creation_document)}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(doc.date_livraison)}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{doc.familles_macro}</td>
                    <td className="border-b border-slate-200 px-3 py-2">{doc.client_en_sommeil ? 'Oui' : 'Non'}</td>
                  </tr>
                ))}

                {sortedDocuments.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-4 py-8 text-center text-slate-500">
                      Aucun document à afficher.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold">Détail à la ligne</h2>
              <p className="text-sm text-slate-500">
                {sortedLignes.length.toLocaleString('fr-FR')} ligne(s) affichée(s).
                {selectedDocumentForLines
                  ? ` Filtré sur le document ${selectedDocumentForLines.numero_document}.`
                  : ' Détail correspondant à la liste des documents ci-dessus.'}
              </p>
            </div>

            {selectedDocumentKeyForLines && (
              <button
                type="button"
                onClick={() => setSelectedDocumentKeyForLines(null)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Réafficher toutes les lignes
              </button>
            )}
          </div>

          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-slate-100">
                <tr>
                  {[
                    ['representant', 'Représentant'],
                    ['agence', 'Agence'],
                    ['numero_tiers', 'N° tiers'],
                    ['nom_tiers', 'Client'],
                    ['type_document', 'Type doc'],
                    ['numero_document', 'N° document'],
                    ['reference_article', 'Référence article'],
                    ['designation_article', 'Désignation article'],
                    ['reference', 'Référence'],
                    ['famille', 'Famille'],
                    ['famille_macro', 'Famille macro'],
                    ['quantite', 'Quantité'],
                    ['montant_ht', 'Montant HT'],
                    ['date_creation_document', 'Date création'],
                    ['date_livraison', 'Date livraison'],
                    ['client_en_sommeil', 'Sommeil'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleLigneSort(key as keyof LignePortefeuille)}
                      className="whitespace-nowrap cursor-pointer border-b border-r border-slate-200 px-3 py-2 text-left hover:bg-slate-200"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sortedLignes.map((ligne, index) => (
                  <tr key={`${ligne.id || index}-${ligne.numero_document}`} className="hover:bg-slate-50">
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.representant, 'Sans représentant')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.agence, 'Sans agence')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.numero_tiers, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.nom_tiers, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.type_document, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-medium">{safeText(ligne.numero_document, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-medium">{safeText(ligne.reference_article, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.designation_article, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.reference, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.famille, '')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{safeText(ligne.famille_macro, 'Sans famille macro')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-right">{Number(ligne.quantite || 0).toLocaleString('fr-FR')}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-right">{formatMoney(ligne.montant_ht)}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(ligne.date_creation_document)}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2">{formatDate(ligne.date_livraison)}</td>
                    <td className="border-b border-slate-200 px-3 py-2">{ligne.client_en_sommeil ? 'Oui' : 'Non'}</td>
                  </tr>
                ))}

                {sortedLignes.length === 0 && (
                  <tr>
                    <td colSpan={16} className="px-4 py-8 text-center text-slate-500">
                      Aucune ligne à afficher.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}