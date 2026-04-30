'use client'

import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

type FactureRow = {
  source: 'facture'
  numero_piece: string | null
  date_facture: string | null
  date_bl: string | null
  numero_tiers_entete: string | null
  intitule_tiers_entete: string | null
  reference_article: string | null
  designation: string | null
  collaborateur: string | null
  quantite: number | null
  montant_ht: number | null
  marge_valeur: number | null
  marge_pourcent: number | null
}

type ActiviteRow = {
  source: 'activite'
  type_document: string | null
  numero_piece: string | null
  date_piece: string | null
  date_bl: string | null
  numero_tiers_entete: string | null
  intitule_tiers_entete: string | null
  reference_article: string | null
  designation: string | null
  collaborateur: string | null
  quantite: number | null
  montant_ht: number | null
  marge_valeur: number | null
  marge_pourcent: number | null
}

type ArticleRow = {
  reference_article: string
  famille: string | null
  hors_statistique: boolean | null
}

type CollaborateurRow = {
  nom_prenom: string | null
  nom: string
  prenom: string | null
  agence: string | null
}

type UnifiedRow = {
  source: 'facture' | 'activite'
  type_document: string | null
  numero_piece: string | null
  date_reference: string | null
  date_facture: string | null
  date_bl: string | null
  numero_tiers: string | null
  intitule_tiers: string | null
  reference_article: string | null
  designation: string | null
  collaborateur: string | null
  agence_collaborateur: string | null
  quantite: number
  montant_ht_brut: number
  ca_indicateur: number
  marge_valeur: number
  marge_pourcent: number
  hors_statistique: boolean
  included: boolean
  exclusion_reason: string
}

type Filters = {
  dateMin: string
  dateMax: string
  horsStatistique: 'non' | 'oui' | 'tous'
  collaborateurs: string[]
  agencesCollaborateurs: string[]
}

const CURRENT_YEAR = new Date().getFullYear()

function safeNumber(value: number | null | undefined) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function getYearMonth(date: string | null) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value || 0)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(1).replace('.', ',')} %`
}

function getUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, 'fr')
  )
}

function isNegativeCaDocument(row: UnifiedRow) {
  const piece = String(row.numero_piece || '').toUpperCase()
  const type = String(row.type_document || '').toUpperCase()

  if (row.source === 'facture') {
    return piece.startsWith('FAR') || piece.startsWith('FAV')
  }

  return piece.startsWith('BR') || piece.startsWith('BAF') || type.includes('RETOUR') || type.includes('AVOIR')
}

async function fetchAllRows<T>(
  table: string,
  selectQuery: string,
  dateColumn: string,
  dateMin: string,
  dateMax: string,
  chunkSize = 1000
) {
  const allRows: T[] = []
  let from = 0

  while (true) {
    const to = from + chunkSize - 1
    const { data, error } = await supabase
      .from(table)
      .select(selectQuery)
      .gte(dateColumn, dateMin)
      .lte(dateColumn, dateMax)
      .range(from, to)

    if (error) throw error

    const rows = (data || []) as T[]
    allRows.push(...rows)

    if (rows.length < chunkSize) break
    from += chunkSize
  }

  return allRows
}

function MultiSelectFilter({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: string[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filteredValues = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return values
    return values.filter((v) => v.toLowerCase().includes(s))
  }, [values, search])

  function toggleValue(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
      >
        <span className="truncate">
          {label} {selected.length ? `(${selected.length})` : ''}
        </span>
        <span>▼</span>
      </button>

      {open && (
        <div className="absolute left-0 top-12 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-bold text-slate-700">{label}</div>
            <button type="button" onClick={() => onChange([])} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
              Tout afficher
            </button>
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer les résultats"
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />

          <div className="max-h-72 space-y-1 overflow-auto pr-1">
            {filteredValues.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(value)} onChange={() => toggleValue(value)} />
                <span className="truncate">{value}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ControleIndicateursCollaborateursPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [factures, setFactures] = useState<FactureRow[]>([])
  const [activites, setActivites] = useState<ActiviteRow[]>([])
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [collaborateurs, setCollaborateurs] = useState<CollaborateurRow[]>([])
  const [detailFilter, setDetailFilter] = useState('')
  const [detailMode, setDetailMode] = useState<'exclus' | 'inclus' | 'tous'>('exclus')
  const [filters, setFilters] = useState<Filters>({
    dateMin: `${CURRENT_YEAR}-01-01`,
    dateMax: `${CURRENT_YEAR}-12-31`,
    horsStatistique: 'non',
    collaborateurs: [],
    agencesCollaborateurs: [],
  })

  async function loadData() {
    setLoading(true)
    setError(null)

    try {
      const [facturesRows, activitesRows, articlesRes, collaborateursRes] = await Promise.all([
        fetchAllRows<FactureRow>(
          'facture_lignes',
          'numero_piece,date_facture,date_bl,numero_tiers_entete,intitule_tiers_entete,reference_article,designation,collaborateur,quantite,montant_ht,marge_valeur,marge_pourcent',
          'date_facture',
          filters.dateMin,
          filters.dateMax
        ),
        fetchAllRows<ActiviteRow>(
          'activite_lignes',
          'type_document,numero_piece,date_piece,date_bl,numero_tiers_entete,intitule_tiers_entete,reference_article,designation,collaborateur,quantite,montant_ht,marge_valeur,marge_pourcent',
          'date_bl',
          filters.dateMin,
          filters.dateMax
        ),
        supabase.from('ref_articles').select('reference_article,famille,hors_statistique'),
        supabase.from('ref_collaborateurs').select('nom_prenom,nom,prenom,agence'),
      ])

      if (articlesRes.error) throw articlesRes.error
      if (collaborateursRes.error) throw collaborateursRes.error

      setFactures(((facturesRows || []) as any[]).map((row) => ({ ...row, source: 'facture' })))
      setActivites(((activitesRows || []) as any[]).map((row) => ({ ...row, source: 'activite' })))
      setArticles((articlesRes.data || []) as ArticleRow[])
      setCollaborateurs((collaborateursRes.data || []) as CollaborateurRow[])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const articleByRef = useMemo(() => {
    const map = new Map<string, ArticleRow>()
    articles.forEach((a) => map.set(a.reference_article, a))
    return map
  }, [articles])

  const collaborateurByName = useMemo(() => {
    const map = new Map<string, CollaborateurRow>()
    collaborateurs.forEach((c) => {
      if (c.nom_prenom) map.set(c.nom_prenom, c)
      map.set([c.nom, c.prenom].filter(Boolean).join(' '), c)
    })
    return map
  }, [collaborateurs])

  const rows = useMemo<UnifiedRow[]>(() => {
    const all: UnifiedRow[] = [
      ...factures.map((row) => {
        const article = row.reference_article ? articleByRef.get(row.reference_article) : undefined
        const collab = row.collaborateur ? collaborateurByName.get(row.collaborateur) : undefined
        const raw: UnifiedRow = {
          source: 'facture',
          type_document: null,
          numero_piece: row.numero_piece,
          date_reference: row.date_facture,
          date_facture: row.date_facture,
          date_bl: row.date_bl,
          numero_tiers: row.numero_tiers_entete,
          intitule_tiers: row.intitule_tiers_entete,
          reference_article: row.reference_article,
          designation: row.designation,
          collaborateur: row.collaborateur,
          agence_collaborateur: collab?.agence || null,
          quantite: safeNumber(row.quantite),
          montant_ht_brut: safeNumber(row.montant_ht),
          ca_indicateur: safeNumber(row.montant_ht),
          marge_valeur: safeNumber(row.marge_valeur),
          marge_pourcent: safeNumber(row.marge_pourcent),
          hors_statistique: Boolean(article?.hors_statistique),
          included: true,
          exclusion_reason: '',
        }

        raw.ca_indicateur = isNegativeCaDocument(raw) ? -Math.abs(raw.montant_ht_brut) : raw.montant_ht_brut
        return raw
      }),
      ...activites.map((row) => {
        const article = row.reference_article ? articleByRef.get(row.reference_article) : undefined
        const collab = row.collaborateur ? collaborateurByName.get(row.collaborateur) : undefined
        const raw: UnifiedRow = {
          source: 'activite',
          type_document: row.type_document,
          numero_piece: row.numero_piece,
          date_reference: row.date_bl,
          date_facture: row.date_piece,
          date_bl: row.date_bl,
          numero_tiers: row.numero_tiers_entete,
          intitule_tiers: row.intitule_tiers_entete,
          reference_article: row.reference_article,
          designation: row.designation,
          collaborateur: row.collaborateur,
          agence_collaborateur: collab?.agence || null,
          quantite: safeNumber(row.quantite),
          montant_ht_brut: safeNumber(row.montant_ht),
          ca_indicateur: safeNumber(row.montant_ht),
          marge_valeur: safeNumber(row.marge_valeur),
          marge_pourcent: safeNumber(row.marge_pourcent),
          hors_statistique: Boolean(article?.hors_statistique),
          included: true,
          exclusion_reason: '',
        }

        raw.ca_indicateur = isNegativeCaDocument(raw) ? -Math.abs(raw.montant_ht_brut) : raw.montant_ht_brut
        return raw
      }),
    ]

    return all.map((row) => {
      const reasons: string[] = []
      const yearMonth = getYearMonth(row.date_reference)

      if (!row.date_reference) reasons.push(row.source === 'facture' ? 'Date facture manquante' : 'Date BL manquante')
      if (!yearMonth) reasons.push('Date non exploitable')
      if (!row.collaborateur) reasons.push('Collaborateur manquant')
      if (row.collaborateur && !collaborateurByName.get(row.collaborateur)) reasons.push('Collaborateur absent du référentiel')
      if (filters.horsStatistique === 'non' && row.hors_statistique) reasons.push('Article hors statistique')
      if (filters.horsStatistique === 'oui' && !row.hors_statistique) reasons.push('Article non hors statistique')
      if (filters.collaborateurs.length && !filters.collaborateurs.includes(row.collaborateur || '')) reasons.push('Collaborateur hors filtre')
      if (filters.agencesCollaborateurs.length && !filters.agencesCollaborateurs.includes(row.agence_collaborateur || '')) reasons.push('Agence collaborateur hors filtre')

      return {
        ...row,
        included: reasons.length === 0,
        exclusion_reason: reasons.join(' | '),
      }
    })
  }, [factures, activites, articleByRef, collaborateurByName, filters])

  const availableFilters = useMemo(() => {
    return {
      collaborateurs: getUnique(rows.map((r) => r.collaborateur)),
      agencesCollaborateurs: getUnique(rows.map((r) => r.agence_collaborateur)),
    }
  }, [rows])

  const includedRows = useMemo(() => rows.filter((r) => r.included), [rows])
  const excludedRows = useMemo(() => rows.filter((r) => !r.included), [rows])

  const summaryRows = useMemo(() => {
    const map = new Map<string, {
      periode: string
      agence: string
      collaborateur: string
      nbLignes: number
      quantite: number
      ca: number
      marge: number
      margePct: number
      factures: number
      activite: number
    }>()

    includedRows.forEach((row) => {
      const periode = getYearMonth(row.date_reference) || 'Date inconnue'
      const collaborateur = row.collaborateur || 'Collaborateur non renseigné'
      const agence = row.agence_collaborateur || 'Agence non renseignée'
      const key = `${periode}|${agence}|${collaborateur}`

      if (!map.has(key)) {
        map.set(key, {
          periode,
          agence,
          collaborateur,
          nbLignes: 0,
          quantite: 0,
          ca: 0,
          marge: 0,
          margePct: 0,
          factures: 0,
          activite: 0,
        })
      }

      const item = map.get(key)!
      item.nbLignes += 1
      item.quantite += row.quantite
      item.ca += row.ca_indicateur
      item.marge += row.marge_valeur
      if (row.source === 'facture') item.factures += row.ca_indicateur
      if (row.source === 'activite') item.activite += row.ca_indicateur
    })

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        margePct: item.ca ? (item.marge / item.ca) * 100 : 0,
      }))
      .sort((a, b) => `${a.periode}|${a.agence}|${a.collaborateur}`.localeCompare(`${b.periode}|${b.agence}|${b.collaborateur}`))
  }, [includedRows])

  const visibleDetails = useMemo(() => {
    const base =
      detailMode === 'exclus' ? excludedRows : detailMode === 'inclus' ? includedRows : rows

    const f = detailFilter.trim().toLowerCase()
    if (!f) return base

    return base.filter((row) =>
      [
        row.source,
        row.numero_piece,
        row.date_reference,
        row.date_facture,
        row.date_bl,
        row.numero_tiers,
        row.intitule_tiers,
        row.reference_article,
        row.designation,
        row.collaborateur,
        row.agence_collaborateur,
        row.exclusion_reason,
      ]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(f))
    )
  }, [detailMode, excludedRows, includedRows, rows, detailFilter])

  const totals = useMemo(() => {
    return {
      lignesChargees: rows.length,
      lignesIncluses: includedRows.length,
      lignesExclues: excludedRows.length,
      caInclus: includedRows.reduce((s, r) => s + r.ca_indicateur, 0),
      margeIncluse: includedRows.reduce((s, r) => s + r.marge_valeur, 0),
      caExclu: excludedRows.reduce((s, r) => s + r.ca_indicateur, 0),
      margeExclue: excludedRows.reduce((s, r) => s + r.marge_valeur, 0),
    }
  }, [rows, includedRows, excludedRows])

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new()

    const synthese = summaryRows.map((row) => ({
      Periode: row.periode,
      Agence: row.agence,
      Collaborateur: row.collaborateur,
      'Nb lignes': row.nbLignes,
      'Quantité totale': row.quantite,
      'CA HT': row.ca,
      'Marge valeur': row.marge,
      'Marge %': row.margePct,
      'CA factures': row.factures,
      'CA activité': row.activite,
    }))

    const details = visibleDetails.map((row) => ({
      Inclus: row.included ? 'Oui' : 'Non',
      Raison: row.exclusion_reason,
      Source: row.source,
      'N° pièce': row.numero_piece,
      'Date référence': row.date_reference,
      'Date facture': row.date_facture,
      'Date BL': row.date_bl,
      'Code tiers': row.numero_tiers,
      Tiers: row.intitule_tiers,
      Collaborateur: row.collaborateur,
      Agence: row.agence_collaborateur,
      Article: row.reference_article,
      Désignation: row.designation,
      'Hors statistique': row.hors_statistique ? 'Oui' : 'Non',
      Quantité: row.quantite,
      'CA HT brut': row.montant_ht_brut,
      'CA indicateur': row.ca_indicateur,
      'Marge valeur': row.marge_valeur,
      'Marge %': row.marge_pourcent,
    }))

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(synthese), 'Synthese')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(details), 'Details')
    XLSX.writeFile(wb, `controle_indicateurs_${filters.dateMin}_${filters.dateMax}.xlsx`)
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1900px] space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Contrôle indicateurs collaborateurs</h1>
              <p className="mt-2 text-sm text-slate-600">
                Synthèse CA / marge par collaborateur et par mois, avec détail des lignes non reprises et raison d'exclusion.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadData}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-100"
              >
                Actualiser
              </button>
              <button
                type="button"
                onClick={exportExcel}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
              >
                Export Excel
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Filtres de contrôle</h2>
              <p className="text-sm text-slate-500">
                Les factures sont chargées par date de facture. L'activité est chargée par date de BL.
              </p>
            </div>
            {loading && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">Chargement…</span>}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <MultiSelectFilter
              label="Collaborateur"
              values={availableFilters.collaborateurs}
              selected={filters.collaborateurs}
              onChange={(v) => updateFilter('collaborateurs', v)}
            />
            <MultiSelectFilter
              label="Agence collaborateur"
              values={availableFilters.agencesCollaborateurs}
              selected={filters.agencesCollaborateurs}
              onChange={(v) => updateFilter('agencesCollaborateurs', v)}
            />
            <select
              value={filters.horsStatistique}
              onChange={(e) => updateFilter('horsStatistique', e.target.value as Filters['horsStatistique'])}
              className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
            >
              <option value="non">Hors statistique : NON</option>
              <option value="oui">Hors statistique : OUI</option>
              <option value="tous">Hors statistique : Tous</option>
            </select>
            <input
              type="date"
              value={filters.dateMin}
              onChange={(e) => updateFilter('dateMin', e.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <input
              type="date"
              value={filters.dateMax}
              onChange={(e) => updateFilter('dateMax', e.target.value)}
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
          </div>

          {error && <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Lignes chargées</div>
            <div className="mt-2 text-2xl font-black">{formatNumber(totals.lignesChargees)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Lignes incluses</div>
            <div className="mt-2 text-2xl font-black text-emerald-700">{formatNumber(totals.lignesIncluses)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Lignes exclues</div>
            <div className="mt-2 text-2xl font-black text-red-700">{formatNumber(totals.lignesExclues)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">CA inclus</div>
            <div className="mt-2 text-2xl font-black">{formatCurrency(totals.caInclus)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Marge incluse</div>
            <div className="mt-2 text-2xl font-black">{formatCurrency(totals.margeIncluse)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">CA exclu</div>
            <div className="mt-2 text-2xl font-black text-red-700">{formatCurrency(totals.caExclu)}</div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-bold">Synthèse par collaborateur et par mois</h2>
            <p className="text-sm text-slate-500">Période = Année-mois. CA retraité selon les règles FAV/FAR/BR/BAF.</p>
          </div>

          <div className="max-h-[520px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {['Période', 'Agence', 'Collaborateur', 'Nb lignes', 'Qté totale', 'CA HT', 'Marge valeur', 'Marge %', 'CA factures', 'CA activité'].map((h) => (
                    <th key={h} className="border border-slate-200 px-3 py-2 text-left font-black">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryRows.map((row) => (
                  <tr key={`${row.periode}-${row.agence}-${row.collaborateur}`} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-2 font-bold">{row.periode}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.agence}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.collaborateur}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.nbLignes)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.quantite)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-bold">{formatNumber(row.ca)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-bold">{formatNumber(row.marge)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(row.margePct)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.factures)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.activite)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-bold">Détail de contrôle</h2>
              <p className="text-sm text-slate-500">Permet d'identifier ce qui n'est pas affiché dans le tableau indicateurs et pourquoi.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={detailMode}
                onChange={(e) => setDetailMode(e.target.value as typeof detailMode)}
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold"
              >
                <option value="exclus">Afficher les exclus</option>
                <option value="inclus">Afficher les inclus</option>
                <option value="tous">Afficher tout</option>
              </select>
              <input
                value={detailFilter}
                onChange={(e) => setDetailFilter(e.target.value)}
                placeholder="Filtrer le détail..."
                className="h-10 w-80 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div className="max-h-[650px] overflow-auto rounded-xl border border-slate-200">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {[
                    'Inclus',
                    'Raison',
                    'Source',
                    'N° pièce',
                    'Date référence',
                    'Date facture',
                    'Date BL',
                    'Code tiers',
                    'Tiers',
                    'Collaborateur',
                    'Agence',
                    'Article',
                    'Désignation',
                    'Hors stat',
                    'Qté',
                    'CA brut',
                    'CA indicateur',
                    'Marge',
                    'Marge %',
                  ].map((h) => (
                    <th key={h} className="border border-slate-200 px-3 py-2 text-left font-black">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleDetails.map((row, index) => (
                  <tr key={`${row.source}-${row.numero_piece}-${row.reference_article}-${index}`} className="hover:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-2 font-bold">{row.included ? 'Oui' : 'Non'}</td>
                    <td className="border border-slate-200 px-3 py-2 text-red-700">{row.exclusion_reason}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.source}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.numero_piece}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.date_reference}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.date_facture}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.date_bl}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.numero_tiers}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.intitule_tiers}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.collaborateur}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.agence_collaborateur}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.reference_article}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.designation}</td>
                    <td className="border border-slate-200 px-3 py-2">{row.hors_statistique ? 'Oui' : 'Non'}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.quantite)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.montant_ht_brut)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-bold">{formatNumber(row.ca_indicateur)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatNumber(row.marge_valeur)}</td>
                    <td className="border border-slate-200 px-3 py-2 text-right">{formatRate(row.marge_pourcent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
