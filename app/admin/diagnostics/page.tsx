'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type EventRow = {
  id: string
  trace_id: string
  module: string
  action: string
  layer: string
  step: string
  object_name: string | null
  run_id: string | null
  batch_offset: number | null
  batch_limit: number | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  status: 'STARTED' | 'SUCCESS' | 'WARNING' | 'ERROR'
  http_status: number | null
  error_code: string | null
  error_message: string | null
  error_details: string | null
  error_hint: string | null
  error_context: string | null
  row_count: number | null
  context: Record<string, unknown> | null
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
}

function statusClass(status: EventRow['status']) {
  if (status === 'ERROR') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'WARNING') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'SUCCESS') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-blue-200 bg-blue-50 text-blue-800'
}

export default function AdminDiagnosticsPage() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [traceFilter, setTraceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null)

  async function loadEvents() {
    setLoading(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const params = new URLSearchParams({ limit: '300' })
      if (traceFilter.trim()) params.set('target_trace_id', traceFilter.trim())
      if (statusFilter) params.set('status', statusFilter)
      if (moduleFilter.trim()) params.set('module', moduleFilter.trim())

      const response = await fetch(`/api/admin/diagnostics?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || `Erreur HTTP ${response.status}`)
      setEvents(payload?.events || [])
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEvents()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const modules = useMemo(
    () => Array.from(new Set(events.map((row) => row.module).filter(Boolean))).sort(),
    [events],
  )

  const displayedEvents = useMemo(() => {
    if (!selectedTrace) return events
    return events.filter((row) => row.trace_id === selectedTrace)
  }, [events, selectedTrace])

  async function copyTrace(row: EventRow) {
    const rows = events.filter((event) => event.trace_id === row.trace_id)
    await navigator.clipboard.writeText(JSON.stringify(rows, null, 2))
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto max-w-[1900px] space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-blue-700">Administration</div>
              <h1 className="mt-1 text-3xl font-black">Diagnostics techniques</h1>
              <p className="mt-2 text-sm text-slate-600">
                Historique corrélé des appels navigateur, Vercel, Supabase REST/RPC et PostgreSQL.
              </p>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-4 xl:max-w-5xl">
              <input
                value={traceFilter}
                onChange={(event) => setTraceFilter(event.target.value)}
                placeholder="Trace ID"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Tous statuts</option>
                <option value="ERROR">Erreur</option>
                <option value="WARNING">Avertissement</option>
                <option value="SUCCESS">Succès</option>
                <option value="STARTED">En cours</option>
              </select>
              <select
                value={moduleFilter}
                onChange={(event) => setModuleFilter(event.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Tous modules</option>
                {modules.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>{moduleName}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={loadEvents}
                disabled={loading}
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
              >
                {loading ? 'Chargement…' : 'Actualiser'}
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{error}</div>
        ) : null}

        {selectedTrace ? (
          <div className="flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
            <span>Trace affichée : <strong>{selectedTrace}</strong></span>
            <button type="button" onClick={() => setSelectedTrace(null)} className="rounded-lg border border-blue-300 bg-white px-3 py-1 font-bold">Toutes les traces</button>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-auto">
            <table className="min-w-[1700px] w-full text-xs">
              <thead className="sticky top-0 bg-slate-100 uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">Statut</th>
                  <th className="px-3 py-3 text-left">Trace</th>
                  <th className="px-3 py-3 text-left">Module / action</th>
                  <th className="px-3 py-3 text-left">Couche / étape</th>
                  <th className="px-3 py-3 text-left">Objet</th>
                  <th className="px-3 py-3 text-right">Durée</th>
                  <th className="px-3 py-3 text-right">Lot</th>
                  <th className="px-3 py-3 text-left">Code</th>
                  <th className="px-3 py-3 text-left">Message technique</th>
                  <th className="px-3 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedEvents.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-3">{formatDateTime(row.started_at)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 font-black ${statusClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td className="max-w-[220px] break-all px-3 py-3 font-mono text-[11px]">{row.trace_id}</td>
                    <td className="px-3 py-3"><div className="font-black">{row.module}</div><div className="text-slate-500">{row.action}</div></td>
                    <td className="px-3 py-3"><div className="font-black">{row.layer}</div><div className="text-slate-500">{row.step}</div></td>
                    <td className="max-w-[260px] break-words px-3 py-3">{row.object_name || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-black">{row.duration_ms == null ? '—' : `${row.duration_ms} ms`}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">{row.batch_offset == null ? '—' : `${row.batch_offset} / ${row.batch_limit ?? '—'}`}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono">{row.error_code || row.http_status || '—'}</td>
                    <td className="max-w-[520px] break-words px-3 py-3">
                      <div className="font-semibold text-red-800">{row.error_message || '—'}</div>
                      {row.error_details ? <div className="mt-1 text-slate-600">{row.error_details}</div> : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1">
                        <button type="button" onClick={() => setSelectedTrace(row.trace_id)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-bold">Voir la trace</button>
                        <button type="button" onClick={() => copyTrace(row)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-bold">Copier</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!displayedEvents.length && !loading ? (
                  <tr><td colSpan={11} className="p-8 text-center text-sm text-slate-500">Aucun événement trouvé.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
