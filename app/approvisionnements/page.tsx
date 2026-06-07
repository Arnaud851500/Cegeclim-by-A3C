'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase } from '@/lib/supabaseClient'

type Metric = 'ca_ht' | 'quantite' | 'quantite_pertinente'

type OptionRow = { option_type: string; value: string }

type ChartRow = {
  annee: number
  mois: number
  flux: string
  value: number
}

type MatrixRow = {
  famille_macro: string
  flux: string
  mois: number
  value_n: number
  value_n1: number
  nb_lignes: number
}

type DetailRow = {
  date_document?: string
  numero_document?: string
  numero_tiers?: string
  intitule_tiers?: string
  famille_macro?: string
  famille?: string
  reference_article?: string
  designation?: string
  depot?: string
  collaborateur?: string
  type_document?: string
  nb_lignes?: number
  quantite?: number
  quantite_pertinente?: number
  ca_ht?: number
  marge_valeur?: number
  value?: number
}

type DashboardPayload = {
  row_count: number
  metric: Metric
  chart: ChartRow[]
  matrix: MatrixRow[]
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const FLUX = ['DEVIS', 'CDC', 'BL', 'FACTURE']

function monthLabel(m: number) {
  return MONTHS[Math.max(0, Math.min(11, Number(m || 1) - 1))]
}

function n(value: any) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function fmt(value: number, metric: Metric) {
  if (metric === 'ca_ht') return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n(value))
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n(value))
}

function metricLabel(metric: Metric) {
  if (metric === 'quantite') return 'Quantité brute'
  if (metric === 'quantite_pertinente') return 'Quantité pertinente'
  return 'CA HT'
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}

function MultiSelect({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="h-11 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-black shadow-sm">
        {selected.length ? `${label} (${selected.length})` : label}
        <span className="float-right text-slate-400">▼</span>
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 max-h-72 w-80 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <button type="button" onClick={() => onChange([])} className="mb-2 w-full rounded-lg bg-slate-100 px-2 py-1 text-left text-xs font-bold">Tout sélectionner</button>
          {values.map((value) => {
            const checked = selected.includes(value)
            return (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-50">
                <input type="checkbox" checked={checked} onChange={() => onChange(checked ? selected.filter((x) => x !== value) : [...selected, value])} />
                <span>{value}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default function ApprovisionnementsPage() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [metric, setMetric] = useState<Metric>('quantite_pertinente')
  const [options, setOptions] = useState<Record<string, string[]>>({})
  const [depots, setDepots] = useState<string[]>([])
  const [collaborateursTiers, setCollaborateursTiers] = useState<string[]>([])
  const [famillesMacro, setFamillesMacro] = useState<string[]>([])
  const [familles, setFamilles] = useState<string[]>([])
  const [referenceInput, setReferenceInput] = useState('')
  const [includeHors, setIncludeHors] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [selectedScope, setSelectedScope] = useState<{ famille_macro?: string; flux?: string; mois?: number; label: string } | null>(null)
  const [detailRows, setDetailRows] = useState<DetailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const references = useMemo(() => referenceInput.split(',').map((x) => x.trim()).filter(Boolean), [referenceInput])

  const filters = useMemo(() => ({
    year,
    depots,
    collaborateurs_tiers: collaborateursTiers,
    familles_macro: famillesMacro,
    familles,
    references,
    include_hors_statistique: includeHors,
  }), [year, depots, collaborateursTiers, famillesMacro, familles, references, includeHors])

  async function loadOptions() {
    const { data, error } = await supabase.rpc('get_appro_filter_options_clean_v1')
    if (error) throw error
    const next: Record<string, string[]> = {}
    ;((data || []) as OptionRow[]).forEach((row) => {
      const key = String(row.option_type || '')
      const value = String(row.value || '').trim()
      if (!key || !value) return
      next[key] = next[key] || []
      next[key].push(value)
    })
    Object.keys(next).forEach((key) => {
      next[key] = uniqueSorted(next[key])
    })
    setOptions(next)
  }

  async function loadDashboard() {
    setLoading(true)
    setError(null)
    setSelectedScope(null)
    setDetailRows([])
    try {
      const { data, error } = await supabase.rpc('get_appro_dashboard_clean_v1', {
        p_filters: filters,
        p_metric: metric,
      })
      if (error) throw error
      setDashboard((data || {}) as DashboardPayload)
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setDashboard(null)
    } finally {
      setLoading(false)
    }
  }

  async function loadDetail(scope: { famille_macro?: string; flux?: string; mois?: number; label: string }) {
    setSelectedScope(scope)
    setLoadingDetail(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc('get_appro_reference_detail_clean_v1', {
        p_filters: filters,
        p_metric: metric,
        p_scope: scope,
        p_limit: 700,
      })
      if (error) throw error
      setDetailRows((data || []) as DetailRow[])
    } catch (exception: any) {
      setError(`Chargement du détail impossible : ${exception?.message || exception}`)
      setDetailRows([])
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    loadOptions().catch((exception) => setError(`Filtres indisponibles : ${exception?.message || exception}`))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadDashboard()
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters), metric])

  const chartData = useMemo(() => {
    const map = new Map<number, Record<string, any>>()
    for (let m = 1; m <= 12; m += 1) map.set(m, { mois: m, label: monthLabel(m) })
    ;(dashboard?.chart || []).forEach((row) => {
      const item = map.get(row.mois) || { mois: row.mois, label: monthLabel(row.mois) }
      item[`${row.flux} ${row.annee}`] = n(row.value)
      map.set(row.mois, item)
    })
    return Array.from(map.values())
  }, [dashboard])

  const matrix = dashboard?.matrix || []

  const years = uniqueSorted(options.annee || [String(currentYear), String(currentYear - 1)]).map(Number).sort((a, b) => b - a)

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <section className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black">Approvisionnements & flux commerciaux</h1>
          <p className="text-sm font-bold text-slate-500">Devis → CDC → BL → Factures, avec détail devis_lignes au clic sur les devis.</p>
        </div>
        <button onClick={loadDashboard} disabled={loading} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </section>

      {error ? <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-black text-red-700">{error}</div> : null}

      <section className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-11 min-w-[160px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-black">
          {years.map((y) => <option key={y} value={y}>Année : {y}</option>)}
        </select>
        <MultiSelect label="Dépôts" values={options.depot || []} selected={depots} onChange={setDepots} />
        <MultiSelect label="Collaborateur client" values={options.collaborateur_tiers || []} selected={collaborateursTiers} onChange={setCollaborateursTiers} />
        <MultiSelect label="Familles macro" values={options.famille_macro || []} selected={famillesMacro} onChange={setFamillesMacro} />
        <MultiSelect label="Familles" values={options.famille || []} selected={familles} onChange={setFamilles} />
        <input value={referenceInput} onChange={(e) => setReferenceInput(e.target.value)} placeholder="Références séparées par virgule" className="h-11 min-w-[260px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold" />
        <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="h-11 min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-black">
          <option value="ca_ht">CA HT</option>
          <option value="quantite">Quantité brute</option>
          <option value="quantite_pertinente">Quantité pertinente</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
          <input type="checkbox" checked={includeHors} onChange={(e) => setIncludeHors(e.target.checked)} />
          Inclure les articles hors statistique
        </label>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black">Courbes Devis → CDC → BL → Factures</h2>
            <p className="text-xs font-black uppercase text-slate-500">{year} en trait plein · {year - 1} en pointillé · lecture en {metricLabel(metric)}</p>
          </div>
          <p className="text-right text-xs font-black uppercase text-slate-500">
            {new Intl.NumberFormat('fr-FR').format(n(dashboard?.row_count))} lignes sources représentées
          </p>
        </div>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(v) => metric === 'ca_ht' ? `${Math.round(Number(v) / 1000)}k€` : String(v)} />
              <Tooltip formatter={(v: any) => fmt(Number(v), metric)} />
              <Legend />
              {FLUX.flatMap((flux) => [year - 1, year].map((y) => (
                <Line key={`${flux} ${y}`} type="monotone" dataKey={`${flux} ${y}`} dot={false} strokeWidth={y === year ? 2 : 1} strokeDasharray={y === year ? undefined : '5 5'} />
              )))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-black">Synthèse par famille macro / type de document</h2>
        <p className="mb-4 text-xs font-black uppercase text-slate-500">Clique sur une ligne, un mois ou une famille pour charger le détail. Lecture en {metricLabel(metric)}.</p>
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2 text-left">Famille macro</th>
                <th className="p-2 text-left">Type document</th>
                {MONTHS.map((m) => <th key={m} className="p-2 text-right">{m}</th>)}
                <th className="p-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(matrix.map((r) => `${r.famille_macro}|${r.flux}`))).map((key) => {
                const [familleMacro, flux] = key.split('|')
                const rows = matrix.filter((r) => r.famille_macro === familleMacro && r.flux === flux)
                const total = rows.reduce((s, r) => s + n(r.value_n), 0)
                return (
                  <tr key={key} className="border-b border-slate-100 hover:bg-blue-50">
                    <td className="p-2 font-black">
                      <button type="button" className="text-left hover:underline" onClick={() => loadDetail({ famille_macro: familleMacro, flux, label: `${familleMacro} / ${flux}` })}>
                        {familleMacro}
                      </button>
                    </td>
                    <td className="p-2">{flux}</td>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                      const row = rows.find((r) => r.mois === m)
                      return (
                        <td key={m} className="p-2 text-right">
                          <button type="button" onClick={() => loadDetail({ famille_macro: familleMacro, flux, mois: m, label: `${familleMacro} / ${flux} / ${monthLabel(m)}` })} className="font-bold hover:text-blue-700 hover:underline">
                            {row ? fmt(n(row.value_n), metric) : '—'}
                          </button>
                        </td>
                      )
                    })}
                    <td className="p-2 text-right font-black">{fmt(total, metric)}</td>
                  </tr>
                )
              })}
              {!matrix.length ? <tr><td colSpan={15} className="p-8 text-center font-bold text-slate-500">Aucune donnée avec les filtres sélectionnés.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">Détail par référence / lignes de devis</h2>
            <p className="text-xs font-black uppercase text-slate-500">
              {selectedScope ? selectedScope.label : 'Clique sur une ligne du tableau de synthèse.'}
              {selectedScope?.flux === 'DEVIS' ? ' · source : devis_lignes' : ''}
            </p>
          </div>
          {loadingDetail ? <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">Chargement…</span> : null}
        </div>
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700">
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Document</th>
                <th className="p-2 text-left">Tiers</th>
                <th className="p-2 text-left">Référence</th>
                <th className="p-2 text-left">Désignation</th>
                <th className="p-2 text-left">Dépôt</th>
                <th className="p-2 text-right">Qté</th>
                <th className="p-2 text-right">Qté pert.</th>
                <th className="p-2 text-right">CA HT</th>
                <th className="p-2 text-right">Marge</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row, index) => (
                <tr key={`${row.numero_document || row.reference_article}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2">{row.date_document || '—'}</td>
                  <td className="p-2 font-black">{row.numero_document || row.type_document || '—'}</td>
                  <td className="p-2">{row.numero_tiers ? `${row.numero_tiers} - ${row.intitule_tiers || ''}` : '—'}</td>
                  <td className="p-2 font-black">{row.reference_article || '—'}</td>
                  <td className="p-2">{row.designation || '—'}</td>
                  <td className="p-2">{row.depot || '—'}</td>
                  <td className="p-2 text-right">{fmt(n(row.quantite), 'quantite')}</td>
                  <td className="p-2 text-right">{fmt(n(row.quantite_pertinente), 'quantite')}</td>
                  <td className="p-2 text-right font-black">{fmt(n(row.ca_ht), 'ca_ht')}</td>
                  <td className="p-2 text-right">{fmt(n(row.marge_valeur), 'ca_ht')}</td>
                </tr>
              ))}
              {!detailRows.length ? <tr><td colSpan={10} className="p-8 text-center font-bold text-slate-500">Aucun détail chargé.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
