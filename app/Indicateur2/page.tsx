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

type Flux = 'DEVIS' | 'CDC' | 'BL' | 'FACTURE'
type Metric = 'ca_ht' | 'quantite' | 'nb_lignes'

type FluxRow = {
  annee: number
  mois: number
  flux: Flux
  type_document: string
  depot: string
  reference_article: string
  designation: string
  famille: string
  famille_macro: string
  hors_statistique: boolean
  nb_lignes: number
  quantite: number
  ca_ht: number
  marge_valeur: number
}

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']
const FLUX_TABLE = 'indicateur_flux_articles_mensuel'
const FLUX_ORDER: Flux[] = ['DEVIS', 'CDC', 'BL', 'FACTURE']

function safeNumber(value: any) {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function safeText(value: any, fallback = 'NON RENSEIGNE') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value || 0)
}

function formatK(value: number) {
  return `${formatNumber(Math.round((value || 0) / 1000))} K€`
}

function monthLabel(month: number) {
  return MONTHS[Math.max(0, Math.min(11, month - 1))] || String(month)
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
}

async function fetchAllFluxRows(chunkSize = 1000) {
  const rows: FluxRow[] = []
  let from = 0
  while (true) {
    const to = from + chunkSize - 1
    const { data, error } = await supabase.from(FLUX_TABLE).select('*').range(from, to)
    if (error) throw error
    const chunk = data || []
    rows.push(...chunk.map((row: any) => ({
      annee: safeNumber(row.annee),
      mois: safeNumber(row.mois),
      flux: safeText(row.flux, 'DEVIS') as Flux,
      type_document: safeText(row.type_document, 'NON RENSEIGNE'),
      depot: safeText(row.depot, 'NON RENSEIGNE'),
      reference_article: safeText(row.reference_article, 'NON RENSEIGNE'),
      designation: safeText(row.designation, 'NON RENSEIGNE'),
      famille: safeText(row.famille, 'NON RENSEIGNE'),
      famille_macro: safeText(row.famille_macro, 'NON RENSEIGNE'),
      hors_statistique: row.hors_statistique === true || String(row.hors_statistique).toLowerCase() === 'true',
      nb_lignes: safeNumber(row.nb_lignes),
      quantite: safeNumber(row.quantite),
      ca_ht: safeNumber(row.ca_ht),
      marge_valeur: safeNumber(row.marge_valeur),
    })))
    if (chunk.length < chunkSize) break
    from += chunkSize
  }
  return rows.filter((r) => r.annee && r.mois)
}

function MultiSelect({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => values.filter((v) => v.toLowerCase().includes(search.toLowerCase())), [values, search])
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-left text-sm font-black">
        {label}{selected.length ? ` (${selected.length})` : ''}
      </button>
      {open && (
        <div onMouseLeave={() => setOpen(false)} className="absolute z-50 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-black">{label}</div>
            <button type="button" onClick={() => onChange([])} className="text-xs font-black text-blue-600">Tout afficher</button>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher" className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" />
          <div className="max-h-72 overflow-auto">
            {filtered.map((value) => (
              <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
                <span className="truncate">{value}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ApprovisionnementsPage() {
  const [rows, setRows] = useState<FluxRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [years, setYears] = useState<number[]>([])
  const [metric, setMetric] = useState<Metric>('ca_ht')
  const [famillesMacro, setFamillesMacro] = useState<string[]>([])
  const [familles, setFamilles] = useState<string[]>([])
  const [references, setReferences] = useState<string[]>([])
  const [depots, setDepots] = useState<string[]>([])
  const [showHorsStat, setShowHorsStat] = useState(false)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAllFluxRows()
      setRows(data)
      const availableYears = Array.from(new Set(data.map((r) => r.annee))).sort((a, b) => b - a)
      setYears((prev) => prev.length ? prev : availableYears.slice(0, 2))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const available = useMemo(() => ({
    years: Array.from(new Set(rows.map((r) => r.annee))).sort((a, b) => b - a),
    famillesMacro: uniqueSorted(rows.map((r) => r.famille_macro)),
    familles: uniqueSorted(rows.map((r) => r.famille)),
    references: uniqueSorted(rows.map((r) => `${r.reference_article} — ${r.designation}`)),
    depots: uniqueSorted(rows.map((r) => r.depot)),
  }), [rows])

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (years.length && !years.includes(row.annee)) return false
    if (famillesMacro.length && !famillesMacro.includes(row.famille_macro)) return false
    if (familles.length && !familles.includes(row.famille)) return false
    if (references.length && !references.includes(`${row.reference_article} — ${row.designation}`)) return false
    if (depots.length && !depots.includes(row.depot)) return false
    if (!showHorsStat && row.hors_statistique) return false
    return true
  }), [rows, years, famillesMacro, familles, references, depots, showHorsStat])

  const chartData = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>()
    filteredRows.forEach((row) => {
      const label = `${row.annee} ${monthLabel(row.mois)}`
      if (!map.has(label)) map.set(label, { label, sort: row.annee * 100 + row.mois })
      const item = map.get(label)!
      item[row.flux] = Number(item[row.flux] || 0) + safeNumber(row[metric])
    })
    return Array.from(map.values()).sort((a: any, b: any) => Number(a.sort) - Number(b.sort))
  }, [filteredRows, metric])

  const recapRows = useMemo(() => {
    const map = new Map<string, Record<string, any>>()
    filteredRows.forEach((row) => {
      const key = `${row.famille_macro}|${row.famille}|${row.reference_article}|${row.designation}`
      if (!map.has(key)) {
        map.set(key, {
          famille_macro: row.famille_macro,
          famille: row.famille,
          reference_article: row.reference_article,
          designation: row.designation,
          DEVIS: 0,
          CDC: 0,
          BL: 0,
          FACTURE: 0,
        })
      }
      const item = map.get(key)!
      item[row.flux] += safeNumber(row[metric])
    })
    return Array.from(map.values())
      .map((row) => ({ ...row, ecart_devis_facture: (row.DEVIS || 0) - (row.FACTURE || 0), ecart_cdc_bl: (row.CDC || 0) - (row.BL || 0) }))
      .sort((a, b) => Math.abs(b.ecart_devis_facture) - Math.abs(a.ecart_devis_facture))
      .slice(0, 200)
  }, [filteredRows, metric])

  const formatMetric = (value: number) => metric === 'ca_ht' ? formatK(value) : formatNumber(value)

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-black">Approvisionnements & flux commerciaux</h1>
          <p className="text-sm font-semibold text-slate-500">Lecture des tendances Devis → CDC → BL → Factures par famille macro, famille et référence article.</p>
        </div>
        <button type="button" onClick={loadData} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white">Actualiser</button>
      </div>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
      {loading && <div className="mb-4 rounded-xl bg-white p-4 text-sm font-bold text-slate-600">Chargement…</div>}

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <MultiSelect label="Années" values={available.years.map(String)} selected={years.map(String)} onChange={(v) => setYears(v.map(Number))} />
          <MultiSelect label="Dépôts" values={available.depots} selected={depots} onChange={setDepots} />
          <MultiSelect label="Familles macro" values={available.famillesMacro} selected={famillesMacro} onChange={setFamillesMacro} />
          <MultiSelect label="Familles" values={available.familles} selected={familles} onChange={setFamilles} />
          <MultiSelect label="Références" values={available.references} selected={references} onChange={setReferences} />
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-black">
            <option value="ca_ht">CA HT</option>
            <option value="quantite">Quantité</option>
            <option value="nb_lignes">Nb lignes</option>
          </select>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" checked={showHorsStat} onChange={(e) => setShowHorsStat(e.target.checked)} />
          Inclure les articles hors statistique
        </label>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">Courbes Devis → CDC → BL → Factures</h2>
          <div className="text-xs font-black uppercase text-slate-500">{formatNumber(filteredRows.length)} lignes agrégées</div>
        </div>
        <div className="h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => metric === 'ca_ht' ? `${Math.round(Number(v) / 1000)}k` : formatNumber(Number(v))} />
              <Tooltip formatter={(value: any) => formatMetric(Number(value || 0))} />
              <Legend />
              {FLUX_ORDER.map((flux) => (
                <Line key={flux} type="monotone" dataKey={flux} strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">Analyse par famille / référence</h2>
          <div className="text-xs font-black uppercase text-slate-500">Top 200 écarts devis vs factures</div>
        </div>
        <div className="max-h-[620px] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-900 text-white">
              <tr>
                <th className="px-3 py-2 text-left">Famille macro</th>
                <th className="px-3 py-2 text-left">Famille</th>
                <th className="px-3 py-2 text-left">Référence</th>
                <th className="px-3 py-2 text-left">Désignation</th>
                <th className="px-3 py-2 text-right">Devis</th>
                <th className="px-3 py-2 text-right">CDC</th>
                <th className="px-3 py-2 text-right">BL</th>
                <th className="px-3 py-2 text-right">Factures</th>
                <th className="px-3 py-2 text-right">Devis - Factures</th>
                <th className="px-3 py-2 text-right">CDC - BL</th>
              </tr>
            </thead>
            <tbody>
              {recapRows.map((row) => (
                <tr key={`${row.famille_macro}-${row.famille}-${row.reference_article}`} className="border-b border-slate-100 odd:bg-slate-50">
                  <td className="px-3 py-2 font-semibold">{row.famille_macro}</td>
                  <td className="px-3 py-2">{row.famille}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.reference_article}</td>
                  <td className="px-3 py-2">{row.designation}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.DEVIS)}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.CDC)}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.BL)}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.FACTURE)}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.ecart_devis_facture)}</td>
                  <td className="px-3 py-2 text-right font-black">{formatMetric(row.ecart_cdc_bl)}</td>
                </tr>
              ))}
              {!recapRows.length && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-sm font-bold text-slate-500">Aucune donnée avec les filtres sélectionnés.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
