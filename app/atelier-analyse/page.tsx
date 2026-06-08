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

type QualityStatus = {
  run_id?: number | null
  status?: string | null
  is_publishable?: boolean | null
  message?: string | null
  date_debut?: string | null
  date_fin?: string | null
  checked_months?: number | null
  ok_months?: number | null
  ko_months?: number | null
  max_abs_ecart?: number | null
  finished_at?: string | null
}

type DashboardViewSummary = {
  view_id: string
  screen: string
  name: string
  user_email?: string | null
  widget_count?: number | null
  cached_widget_count?: number | null
  last_calculated_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type CacheWidget = {
  id: string
  view_id: string
  screen: string
  widget_type: string
  title: string
  metric: string
  source_fluxes?: string[] | null
  period_start?: string | null
  period_end?: string | null
  dimensions_json?: Record<string, any> | null
  filters_json?: Record<string, any> | null
  position?: number | null
  layout_json?: Record<string, any> | null
  cache_status?: string | null
  result_json?: any
  row_count?: number | null
  error_message?: string | null
  calculated_at?: string | null
  data_quality_run_id?: number | null
}

type DashboardPayload = {
  view?: {
    id: string
    screen: string
    name: string
    user_email?: string | null
    global_filters?: Record<string, any>
    created_at?: string | null
    updated_at?: string | null
  } | null
  quality?: QualityStatus | null
  widgets?: CacheWidget[]
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

function asArray(value: any): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function n(value: any) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthLabel(mois: number) {
  return MONTHS[Math.max(0, Math.min(11, Number(mois || 1) - 1))]
}

function metricLabel(metric: string) {
  const key = String(metric || '').toLowerCase()
  if (key === 'marge_valeur') return 'Marge €'
  if (key === 'marge') return 'Marge €'
  if (key === 'quantite') return 'Quantité'
  if (key === 'quantite_pertinente') return 'Quantité pertinente'
  if (key === 'nb_lignes') return 'Nb lignes'
  return 'CA HT'
}

function fmt(value: any, metric = 'ca_ht') {
  const amount = n(value)
  if (String(metric).toLowerCase().includes('ca') || String(metric).toLowerCase().includes('marge')) {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(amount)
  }

  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function cacheBadgeClass(status?: string | null) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700 ring-emerald-200'
  if (status === 'blocked_quality') return 'bg-amber-100 text-amber-700 ring-amber-200'
  if (status === 'failed') return 'bg-rose-100 text-rose-700 ring-rose-200'
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}

function qualityBadgeClass(status?: string | null) {
  if (status === 'ok') return 'bg-emerald-100 text-emerald-800 ring-emerald-200'
  if (status === 'ko') return 'bg-rose-100 text-rose-800 ring-rose-200'
  if (status === 'failed') return 'bg-red-100 text-red-800 ring-red-200'
  return 'bg-slate-100 text-slate-700 ring-slate-200'
}

function EmptyWidget({ message = 'Aucune donnée calculée pour ce widget.' }: { message?: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-2xl bg-slate-50 text-sm font-bold text-slate-500">
      {message}
    </div>
  )
}

function WidgetHeader({ widget }: { widget: CacheWidget }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-lg font-black text-slate-950">{widget.title}</h3>
        <p className="text-xs font-bold uppercase text-slate-500">
          {metricLabel(widget.metric)}
          {widget.row_count ? ` · ${new Intl.NumberFormat('fr-FR').format(widget.row_count)} ligne(s) cache` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={`rounded-full px-2 py-1 text-xs font-black ring-1 ${cacheBadgeClass(widget.cache_status)}`}>
          {widget.cache_status || 'missing'}
        </span>
        <span className="text-[11px] font-semibold text-slate-400">{fmtDateTime(widget.calculated_at)}</span>
      </div>
    </div>
  )
}

function KpiWidget({ widget }: { widget: CacheWidget }) {
  const rows = asArray(widget.result_json)
  const total = rows.reduce((sum, row) => sum + n(row.value), 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-950">{widget.title}</h3>
          <p className="text-xs font-bold uppercase text-slate-500">{metricLabel(widget.metric)}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-black ring-1 ${cacheBadgeClass(widget.cache_status)}`}>
          {widget.cache_status || 'missing'}
        </span>
      </div>

      <p className="text-3xl font-black text-slate-950">{fmt(total, widget.metric)}</p>

      <div className="mt-4 space-y-2">
        {rows.map((row, index) => (
          <div key={`${row.flux}-${index}`} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <span className="font-bold text-slate-600">{row.flux || 'Total'}</span>
            <span className="font-black text-slate-950">{fmt(row.value, widget.metric)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthlySeriesWidget({ widget }: { widget: CacheWidget }) {
  const rows = asArray(widget.result_json)
  const chartData = useMemo(() => {
    const map = new Map<number, Record<string, any>>()
    for (let month = 1; month <= 12; month += 1) {
      map.set(month, { mois: month, label: monthLabel(month) })
    }

    rows.forEach((row) => {
      const month = n(row.mois)
      const item = map.get(month) || { mois: month, label: monthLabel(month) }
      const key = `${row.flux || 'Flux'} ${row.annee || ''}`.trim()
      item[key] = n(row.value)
      map.set(month, item)
    })

    return Array.from(map.values())
  }, [rows])

  const series = Array.from(new Set(rows.map((row) => `${row.flux || 'Flux'} ${row.annee || ''}`.trim())))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <WidgetHeader widget={widget} />
      {series.length ? (
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => (String(widget.metric).includes('ca') ? `${Math.round(Number(value) / 1000)}k` : String(value))} />
              <Tooltip formatter={(value: any) => fmt(value, widget.metric)} />
              <Legend />
              {series.map((key) => (
                <Line key={key} type="monotone" dataKey={key} dot strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyWidget />
      )}
    </div>
  )
}

function BreakdownWidget({ widget }: { widget: CacheWidget }) {
  const rows = asArray(widget.result_json).slice(0, 20)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <WidgetHeader widget={widget} />
      {rows.length ? (
        <>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ left: 110, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(value) => (String(widget.metric).includes('ca') ? `${Math.round(Number(value) / 1000)}k` : String(value))} />
                <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any) => fmt(value, widget.metric)} />
                <Bar dataKey="value" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.label}-${index}`} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 font-bold text-slate-700">{row.label || 'Non renseigné'}</td>
                    <td className="px-3 py-2 text-right font-black text-slate-950">{fmt(row.value, widget.metric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyWidget />
      )}
    </div>
  )
}

function BridgeWidget({ widget }: { widget: CacheWidget }) {
  const rows = asArray(widget.result_json).slice(0, 12).map((row) => ({
    label: row.label,
    'N-1': n(row.value_n1),
    N: n(row.value_n),
    Écart: n(row.ecart),
  }))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <WidgetHeader widget={widget} />
      {rows.length ? (
        <>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" angle={-25} textAnchor="end" height={80} interval={0} tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => (String(widget.metric).includes('ca') ? `${Math.round(Number(value) / 1000)}k` : String(value))} />
                <Tooltip formatter={(value: any) => fmt(value, widget.metric)} />
                <Legend />
                <Bar dataKey="N-1" />
                <Bar dataKey="N" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="px-3 py-2 text-left">Dimension</th>
                  <th className="px-3 py-2 text-right">N-1</th>
                  <th className="px-3 py-2 text-right">N</th>
                  <th className="px-3 py-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.label}-${index}`} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-2 font-bold text-slate-700">{row.label || 'Non renseigné'}</td>
                    <td className="px-3 py-2 text-right">{fmt(row['N-1'], widget.metric)}</td>
                    <td className="px-3 py-2 text-right font-black">{fmt(row.N, widget.metric)}</td>
                    <td className={`px-3 py-2 text-right font-black ${row.Écart >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {fmt(row.Écart, widget.metric)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyWidget />
      )}
    </div>
  )
}

function PivotMonthlyWidget({ widget }: { widget: CacheWidget }) {
  const rows = asArray(widget.result_json)
  const pivotRows = useMemo(() => {
    const map = new Map<string, Record<string, any>>()

    rows.forEach((row) => {
      const label = String(row.label || 'Non renseigné')
      const current = map.get(label) || { label, total: 0 }
      const month = n(row.mois)
      current[`m${month}`] = n(current[`m${month}`]) + n(row.value)
      current.total = n(current.total) + n(row.value)
      map.set(label, current)
    })

    return Array.from(map.values()).sort((a, b) => Math.abs(n(b.total)) - Math.abs(n(a.total)))
  }, [rows])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <WidgetHeader widget={widget} />
      <div className="overflow-auto rounded-xl border border-slate-100">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="sticky left-0 bg-slate-900 px-3 py-2 text-left">Dimension</th>
              {MONTHS.map((month) => (
                <th key={month} className="px-3 py-2 text-right">{month}</th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {pivotRows.map((row) => (
              <tr key={row.label} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="sticky left-0 bg-white px-3 py-2 font-black text-slate-800">{row.label}</td>
                {MONTHS.map((_, index) => {
                  const value = n(row[`m${index + 1}`])
                  return (
                    <td key={`${row.label}-${index}`} className="px-3 py-2 text-right">
                      {value ? fmt(value, widget.metric) : '—'}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right font-black">{fmt(row.total, widget.metric)}</td>
              </tr>
            ))}
            {!pivotRows.length ? (
              <tr>
                <td colSpan={14} className="p-8 text-center font-bold text-slate-500">Aucune donnée calculée.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WidgetRenderer({ widget }: { widget: CacheWidget }) {
  if (widget.cache_status === 'failed' || widget.cache_status === 'blocked_quality') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-white p-5 shadow-sm">
        <WidgetHeader widget={widget} />
        <div className="rounded-xl bg-rose-50 p-4 text-sm font-black text-rose-700">
          {widget.error_message || 'Widget non calculé.'}
        </div>
      </div>
    )
  }

  if (widget.widget_type === 'kpi_period') return <KpiWidget widget={widget} />
  if (widget.widget_type === 'monthly_series') return <MonthlySeriesWidget widget={widget} />
  if (widget.widget_type === 'breakdown_dim') return <BreakdownWidget widget={widget} />
  if (widget.widget_type === 'bridge_n_vs_n1') return <BridgeWidget widget={widget} />
  if (widget.widget_type === 'pivot_monthly') return <PivotMonthlyWidget widget={widget} />

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <WidgetHeader widget={widget} />
      <pre className="max-h-96 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-white">
        {JSON.stringify(widget.result_json, null, 2)}
      </pre>
    </div>
  )
}

export default function AtelierAnalysePage() {
  const [views, setViews] = useState<DashboardViewSummary[]>([])
  const [selectedViewId, setSelectedViewId] = useState<string>('')
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [loadingViews, setLoadingViews] = useState(false)
  const [loadingPayload, setLoadingPayload] = useState(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadViews(preferredViewId?: string) {
    setLoadingViews(true)
    setError(null)

    try {
      const { data: userData } = await supabase.auth.getUser()
      const userEmail = userData?.user?.email || null

      const { data, error } = await supabase.rpc('get_dashboard_views_for_screen_v1', {
        p_screen: 'atelier',
        p_user_email: userEmail,
      })

      if (error) throw error

      const nextViews = (data || []) as DashboardViewSummary[]
      setViews(nextViews)

      const preferred =
        nextViews.find((view) => view.view_id === preferredViewId) ||
        nextViews.find((view) => view.name === 'VUE DIRECTION CACHE V1') ||
        nextViews[0]

      if (preferred?.view_id) {
        setSelectedViewId(preferred.view_id)
        await loadPayload(preferred.view_id)
      } else {
        setPayload(null)
      }
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setViews([])
      setPayload(null)
    } finally {
      setLoadingViews(false)
    }
  }

  async function loadPayload(viewId: string) {
    if (!viewId) return

    setLoadingPayload(true)
    setError(null)

    try {
      const { data, error } = await supabase.rpc('get_dashboard_view_payload_v1', {
        p_view_id: viewId,
      })

      if (error) throw error
      setPayload((data || null) as DashboardPayload | null)
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setPayload(null)
    } finally {
      setLoadingPayload(false)
    }
  }

  async function refreshCurrentViewCache() {
    if (!selectedViewId) return

    setRefreshingCache(true)
    setError(null)

    try {
      const { error } = await supabase.rpc('refresh_dashboard_view_cache_v1', {
        p_view_id: selectedViewId,
      })

      if (error) throw error

      await loadPayload(selectedViewId)
      await loadViews(selectedViewId)
    } catch (exception: any) {
      setError(exception?.message || String(exception))
    } finally {
      setRefreshingCache(false)
    }
  }

  useEffect(() => {
    void loadViews()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const widgets = useMemo(() => {
    return [...(payload?.widgets || [])].sort((a, b) => n(a.position) - n(b.position))
  }, [payload])

  const kpiWidgets = widgets.filter((widget) => widget.widget_type === 'kpi_period')
  const standardWidgets = widgets.filter((widget) => widget.widget_type !== 'kpi_period')
  const quality = payload?.quality

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-950">
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">Atelier d’analyse</h1>
            <p className="text-sm font-semibold text-slate-500">
              Lecture cache-only : les widgets sont affichés depuis dashboard_widget_cache_v1, sans chargement des lignes sources dans le navigateur.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedViewId}
              onChange={(event) => {
                const nextId = event.target.value
                setSelectedViewId(nextId)
                void loadPayload(nextId)
              }}
              className="h-11 min-w-[230px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-black shadow-sm"
            >
              {views.map((view) => (
                <option key={view.view_id} value={view.view_id}>
                  {view.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void loadViews(selectedViewId)}
              disabled={loadingViews || loadingPayload}
              className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm disabled:opacity-50"
            >
              {loadingViews || loadingPayload ? 'Chargement…' : 'Actualiser'}
            </button>

            <button
              type="button"
              onClick={() => void refreshCurrentViewCache()}
              disabled={!selectedViewId || refreshingCache}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-50"
            >
              {refreshingCache ? 'Recalcul…' : 'Recalculer le cache'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm font-black text-rose-700">{error}</div>
        ) : null}

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Vue sélectionnée</p>
            <p className="mt-1 text-lg font-black">{payload?.view?.name || '—'}</p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Widgets cache</p>
            <p className="mt-1 text-lg font-black">
              {widgets.filter((widget) => widget.cache_status === 'completed').length} / {widgets.length}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Dernier calcul</p>
            <p className="mt-1 text-lg font-black">
              {fmtDateTime(
                (() => {
                  const dates = widgets
                    .map((widget) => widget.calculated_at)
                    .filter(Boolean)
                    .sort()
                  return dates.length ? dates[dates.length - 1] : null
                })()
              )}
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-black uppercase text-slate-500">Qualité données</p>
            <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-black ring-1 ${qualityBadgeClass(quality?.status)}`}>
              {quality?.status || 'inconnu'}
            </span>
          </div>
        </div>

        {quality ? (
          <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-black text-slate-800">{quality.message || 'Statut qualité indisponible'}</p>
              <p className="font-bold text-slate-500">
                Run #{quality.run_id || '—'} · {quality.ok_months ?? 0} mois OK / {quality.ko_months ?? 0} mois KO · écart max {fmt(quality.max_abs_ecart || 0)}
              </p>
            </div>
          </div>
        ) : null}
      </section>

      {!widgets.length && !loadingPayload ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <h2 className="text-xl font-black">Aucun widget cache disponible</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Vérifie que la vue VUE DIRECTION CACHE V1 existe et que refresh_dashboard_view_cache_v1 a été lancé.
          </p>
        </section>
      ) : null}

      {kpiWidgets.length ? (
        <section className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {kpiWidgets.map((widget) => (
            <KpiWidget key={widget.id} widget={widget} />
          ))}
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {standardWidgets
          .filter((widget) => widget.widget_type !== 'pivot_monthly')
          .map((widget) => (
            <WidgetRenderer key={widget.id} widget={widget} />
          ))}
      </section>

      <section className="mt-5 space-y-5">
        {standardWidgets
          .filter((widget) => widget.widget_type === 'pivot_monthly')
          .map((widget) => (
            <WidgetRenderer key={widget.id} widget={widget} />
          ))}
      </section>
    </main>
  )
}
