'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
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

type OptionRow = {
  option_type: string
  value: string
}

type KpiRow = {
  label: string
  period: string
  value: number
  value_n1: number
}

type HistogramRow = {
  annee: number
  mois: number
  source: string
  value: number
  ca_ht?: number
  marge_valeur?: number
}

type BridgeRow = {
  label: string
  value_n: number
  value_n1: number
  ecart: number
}

type CrossRow = {
  famille_macro: string
  type_document: string
  mois: number
  value_n: number
  value_n1: number
}

type DashboardPayload = {
  row_count: number
  metric: Metric
  kpis: KpiRow[]
  histogram: HistogramRow[]
  bridge: BridgeRow[]
  cross: CrossRow[]
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

function monthLabel(m: number) {
  return MONTHS[Math.max(0, Math.min(11, Number(m || 1) - 1))]
}

function n(value: any) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function fmt(value: number, metric: Metric) {
  if (metric === 'ca_ht') {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n(value))
  }
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

function deltaPct(value: number, previous: number) {
  if (!previous) return null
  return ((value - previous) / Math.abs(previous)) * 100
}

function MultiSelect({
  label,
  values,
  selected,
  onChange,
}: {
  label: string
  values: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const title = selected.length ? `${label} (${selected.length})` : label

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="h-11 min-w-[135px] rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-black shadow-sm"
      >
        <span>{title}</span>
        <span className="float-right text-slate-400">▼</span>
      </button>
      {open ? (
        <div className="absolute z-30 mt-2 max-h-72 w-72 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <button type="button" onClick={() => onChange([])} className="mb-2 w-full rounded-lg bg-slate-100 px-2 py-1 text-left text-xs font-bold">
            Tout sélectionner
          </button>
          {values.map((value) => {
            const checked = selected.includes(value)
            return (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selected.filter((x) => x !== value) : [...selected, value])}
                />
                <span>{value}</span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function KpiCard({ row, metric }: { row: KpiRow; metric: Metric }) {
  const d = deltaPct(row.value, row.value_n1)
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-slate-600">{row.label}</p>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{row.period}</span>
      </div>
      <p className="text-2xl font-black text-slate-950">{fmt(row.value, row.label.includes('Marge') ? 'quantite' : metric)}{row.label.includes('Marge') ? ' %' : ''}</p>
      <p className="mt-2 text-xs font-bold text-slate-500">N-1 : {fmt(row.value_n1, row.label.includes('Marge') ? 'quantite' : metric)}{row.label.includes('Marge') ? ' %' : ''}</p>
      {d !== null ? (
        <span className={`mt-2 inline-block rounded-full px-2 py-1 text-xs font-black ${d >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          {d >= 0 ? '+' : ''}{d.toFixed(1).replace('.', ',')} %
        </span>
      ) : null}
    </div>
  )
}

export default function AtelierAnalysePage() {
  const currentYear = new Date().getFullYear()
  const [metric, setMetric] = useState<Metric>('ca_ht')
  const [options, setOptions] = useState<Record<string, string[]>>({})
  const [sources, setSources] = useState<string[]>(['Factures'])
  const [annees, setAnnees] = useState<string[]>([String(currentYear - 1), String(currentYear)])
  const [mois, setMois] = useState<string[]>([])
  const [agences, setAgences] = useState<string[]>([])
  const [depots, setDepots] = useState<string[]>([])
  const [famillesMacro, setFamillesMacro] = useState<string[]>([])
  const [typesDocument, setTypesDocument] = useState<string[]>([])
  const [includeHors, setIncludeHors] = useState(false)
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadOptions() {
    const { data, error } = await supabase.rpc('get_atelier_filter_options_clean_v1')
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

  const filters = useMemo(() => ({
    sources,
    annees,
    mois,
    agences,
    depots,
    familles_macro: famillesMacro,
    types_document: typesDocument,
    include_hors_statistique: includeHors,
  }), [sources, annees, mois, agences, depots, famillesMacro, typesDocument, includeHors])

  async function loadDashboard() {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc('get_atelier_dashboard_clean_v1', {
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

  const histogramData = useMemo(() => {
    const map = new Map<number, Record<string, any>>()
    for (let m = 1; m <= 12; m += 1) map.set(m, { mois: m, label: monthLabel(m) })
    ;(dashboard?.histogram || []).forEach((row) => {
      const item = map.get(row.mois) || { mois: row.mois, label: monthLabel(row.mois) }
      item[`${row.source} ${row.annee}`] = n(row.value)
      map.set(row.mois, item)
    })
    return Array.from(map.values())
  }, [dashboard])

  const bridgeData = useMemo(() => (dashboard?.bridge || []).slice(0, 12).map((row) => ({
    label: row.label,
    'N-1': n(row.value_n1),
    N: n(row.value_n),
    Écart: n(row.ecart),
  })), [dashboard])

  const crossRows = dashboard?.cross || []

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black">Atelier d’analyse</h1>
            <p className="text-sm font-semibold text-slate-500">Chargement direct par RPC dédiée : KPI, histogramme, bridge et tableau déjà agrégés côté serveur.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black">
              <option value="ca_ht">CA HT</option>
              <option value="quantite">Quantité brute</option>
              <option value="quantite_pertinente">Quantité pertinente</option>
            </select>
            <button onClick={loadDashboard} disabled={loading} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">
              {loading ? 'Chargement…' : 'Actualiser'}
            </button>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-black text-red-700">{error}</div> : null}
      </section>

      <section className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <MultiSelect label="Source" values={options.source || []} selected={sources} onChange={setSources} />
        <MultiSelect label="Année" values={options.annee || []} selected={annees} onChange={setAnnees} />
        <MultiSelect label="Mois" values={options.mois || []} selected={mois} onChange={setMois} />
        <MultiSelect label="Agence" values={options.agence || []} selected={agences} onChange={setAgences} />
        <MultiSelect label="Dépôt" values={options.depot || []} selected={depots} onChange={setDepots} />
        <MultiSelect label="Famille macro" values={options.famille_macro || []} selected={famillesMacro} onChange={setFamillesMacro} />
        <MultiSelect label="Type document" values={options.type_document || []} selected={typesDocument} onChange={setTypesDocument} />
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold">
          <input type="checkbox" checked={includeHors} onChange={(e) => setIncludeHors(e.target.checked)} />
          Inclure hors statistique
        </label>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black">Vue Direction</h2>
            <p className="text-sm font-bold text-slate-500">{new Intl.NumberFormat('fr-FR').format(n(dashboard?.row_count))} lignes sources représentées · {metricLabel(metric)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {(dashboard?.kpis || []).map((row) => <KpiCard key={`${row.label}-${row.period}`} row={row} metric={metric} />)}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 text-lg font-black">Bridge CA N-1 ⇒ N par agence</h3>
          <p className="mb-4 text-xs font-bold uppercase text-slate-500">{metricLabel(metric)}</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bridgeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" angle={-25} textAnchor="end" height={80} interval={0} />
                <YAxis tickFormatter={(v) => metric === 'ca_ht' ? `${Math.round(Number(v) / 1000)}k` : String(v)} />
                <Tooltip formatter={(v: any) => fmt(Number(v), metric)} />
                <Legend />
                <Bar dataKey="N-1" />
                <Bar dataKey="N" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-1 text-lg font-black">Histogramme / courbe par mois</h3>
          <p className="mb-4 text-xs font-bold uppercase text-slate-500">{metricLabel(metric)}</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={histogramData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis tickFormatter={(v) => metric === 'ca_ht' ? `${Math.round(Number(v) / 1000)}k` : String(v)} />
                <Tooltip formatter={(v: any) => fmt(Number(v), metric)} />
                <Legend />
                {Array.from(new Set((dashboard?.histogram || []).map((r) => `${r.source} ${r.annee}`))).map((key) => (
                  <Line key={key} type="monotone" dataKey={key} dot={false} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 text-lg font-black">Tableau croisé famille macro / type document</h3>
        <p className="mb-4 text-xs font-bold uppercase text-slate-500">{metricLabel(metric)} · limité aux 500 premières lignes serveur</p>
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="p-2 text-left">Famille macro</th>
                <th className="p-2 text-left">Type document</th>
                <th className="p-2 text-right">Mois</th>
                <th className="p-2 text-right">N</th>
                <th className="p-2 text-right">N-1</th>
                <th className="p-2 text-right">Écart</th>
              </tr>
            </thead>
            <tbody>
              {crossRows.map((row, index) => (
                <tr key={`${row.famille_macro}-${row.type_document}-${row.mois}-${index}`} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="p-2 font-bold">{row.famille_macro}</td>
                  <td className="p-2">{row.type_document}</td>
                  <td className="p-2 text-right">{monthLabel(row.mois)}</td>
                  <td className="p-2 text-right font-black">{fmt(n(row.value_n), metric)}</td>
                  <td className="p-2 text-right text-slate-500">{fmt(n(row.value_n1), metric)}</td>
                  <td className="p-2 text-right">{fmt(n(row.value_n) - n(row.value_n1), metric)}</td>
                </tr>
              ))}
              {!crossRows.length ? (
                <tr><td colSpan={6} className="p-8 text-center font-bold text-slate-500">Aucune donnée avec les filtres sélectionnés.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
