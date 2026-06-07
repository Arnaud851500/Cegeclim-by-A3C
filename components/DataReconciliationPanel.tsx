'use client'

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabaseClient'

type ReconciliationRow = {
  annee: number
  mois: number
  factures_lignes: number | null
  factures_cache: number | null
  factures_indicateur: number | null
  factures_flux: number | null
  ecart_factures_lignes_vs_flux: number | null
  devis_lignes: number | null
  devis_cache: number | null
  devis_indicateur: number | null
  devis_flux: number | null
  ecart_devis_lignes_vs_flux: number | null
  cdc_source_activite_plus_factures: number | null
  cdc_indicateur_activite: number | null
  cdc_flux: number | null
  ecart_cdc_source_vs_flux: number | null
  bl_source_activite_plus_factures: number | null
  bl_indicateur_activite: number | null
  bl_flux: number | null
  ecart_bl_source_vs_flux: number | null
}

const TOLERANCE = 0.01

function toNumber(value: any) {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function absEcart(value: any) {
  return Math.abs(toNumber(value))
}

function formatMoney(value: any) {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value))
}

function formatSigned(value: any) {
  const n = toNumber(value)
  const sign = n > 0 ? '+' : ''
  return `${sign}${formatMoney(n)}`
}

function monthLabel(row: ReconciliationRow) {
  return `${String(row.mois).padStart(2, '0')}/${row.annee}`
}

function getEcartClass(value: any) {
  return absEcart(value) > TOLERANCE
    ? 'bg-red-50 text-red-700 font-black'
    : 'bg-emerald-50 text-emerald-700 font-bold'
}

function getValueClass(reference: any, compared: any) {
  const ecart = toNumber(compared) - toNumber(reference)
  return absEcart(ecart) > TOLERANCE ? 'text-red-700 font-black' : 'text-slate-800'
}

function computeRowIssues(row: ReconciliationRow) {
  const issues: string[] = []

  const facturesLignes = toNumber(row.factures_lignes)
  const devisLignes = toNumber(row.devis_lignes)

  // Factures : les 4 montants doivent être alignés.
  if (absEcart(toNumber(row.factures_cache) - facturesLignes) > TOLERANCE) issues.push('Factures cache')
  if (absEcart(toNumber(row.factures_indicateur) - facturesLignes) > TOLERANCE) issues.push('Factures indicateur')
  if (absEcart(toNumber(row.factures_flux) - facturesLignes) > TOLERANCE) issues.push('Factures flux')

  // Devis : les 4 montants doivent être alignés.
  if (absEcart(toNumber(row.devis_cache) - devisLignes) > TOLERANCE) issues.push('Devis cache')
  if (absEcart(toNumber(row.devis_indicateur) - devisLignes) > TOLERANCE) issues.push('Devis indicateur')
  if (absEcart(toNumber(row.devis_flux) - devisLignes) > TOLERANCE) issues.push('Devis flux')

  // CDC / BL : on contrôle uniquement l'écart final calculé par la RPC :
  // CDC flux = CDC depuis factures + CDC depuis activité
  // BL flux  = BL depuis factures + BL depuis activité
  if (absEcart(row.ecart_cdc_source_vs_flux) > TOLERANCE) issues.push('CDC flux')
  if (absEcart(row.ecart_bl_source_vs_flux) > TOLERANCE) issues.push('BL flux')

  return issues
}

function exportRows(rows: ReconciliationRow[]) {
  if (!rows.length) return

  const exportData = rows.map((row) => {
    const facturesLignes = toNumber(row.factures_lignes)
    const devisLignes = toNumber(row.devis_lignes)
    const cdcDepuisFact = toNumber(row.cdc_source_activite_plus_factures)
    const cdcAttendu = cdcDepuisFact + toNumber(row.cdc_indicateur_activite)
    const blDepuisFact = toNumber(row.bl_source_activite_plus_factures)
    const blAttendu = blDepuisFact + toNumber(row.bl_indicateur_activite)

    return {
      Année: row.annee,
      Mois: row.mois,
      Statut: computeRowIssues(row).length ? 'KO' : 'OK',
      'Anomalies': computeRowIssues(row).join(', '),

      'Factures lignes': facturesLignes,
      'Factures cache': toNumber(row.factures_cache),
      'Écart factures cache vs lignes': toNumber(row.factures_cache) - facturesLignes,
      'Factures indicateur': toNumber(row.factures_indicateur),
      'Écart factures indicateur vs lignes': toNumber(row.factures_indicateur) - facturesLignes,
      'Factures flux': toNumber(row.factures_flux),
      'Écart factures flux vs lignes': toNumber(row.factures_flux) - facturesLignes,

      'Devis lignes': devisLignes,
      'Devis cache': toNumber(row.devis_cache),
      'Écart devis cache vs lignes': toNumber(row.devis_cache) - devisLignes,
      'Devis indicateur': toNumber(row.devis_indicateur),
      'Écart devis indicateur vs lignes': toNumber(row.devis_indicateur) - devisLignes,
      'Devis flux': toNumber(row.devis_flux),
      'Écart devis flux vs lignes': toNumber(row.devis_flux) - devisLignes,

      'CDC depuis fact': cdcDepuisFact,
      'CDC depuis activité': toNumber(row.cdc_indicateur_activite),
      'CDC attendu': cdcAttendu,
      'CDC flux': toNumber(row.cdc_flux),
      'Écart CDC attendu vs flux': cdcAttendu - toNumber(row.cdc_flux),

      'BL depuis fact': blDepuisFact,
      'BL depuis activité': toNumber(row.bl_indicateur_activite),
      'BL attendu': blAttendu,
      'BL flux': toNumber(row.bl_flux),
      'Écart BL attendu vs flux': blAttendu - toNumber(row.bl_flux),
    }
  })

  const ws = XLSX.utils.json_to_sheet(exportData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contrôle agrégats')
  XLSX.writeFile(wb, `controle_agregats_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export default function DataReconciliationPanel() {
  const [startDate, setStartDate] = useState('2025-01-01')
  const [endDate, setEndDate] = useState('2026-07-01')
  const [rows, setRows] = useState<ReconciliationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)

  const summary = useMemo(() => {
    const koRows = rows.filter((row) => computeRowIssues(row).length > 0)
    const facturesKo = rows.filter((row) => {
      const ref = toNumber(row.factures_lignes)
      return (
        absEcart(toNumber(row.factures_cache) - ref) > TOLERANCE ||
        absEcart(toNumber(row.factures_indicateur) - ref) > TOLERANCE ||
        absEcart(toNumber(row.factures_flux) - ref) > TOLERANCE
      )
    }).length

    const devisKo = rows.filter((row) => {
      const ref = toNumber(row.devis_lignes)
      return (
        absEcart(toNumber(row.devis_cache) - ref) > TOLERANCE ||
        absEcart(toNumber(row.devis_indicateur) - ref) > TOLERANCE ||
        absEcart(toNumber(row.devis_flux) - ref) > TOLERANCE
      )
    }).length

    return {
      total: rows.length,
      ko: koRows.length,
      ok: rows.length - koRows.length,
      facturesKo,
      devisKo,
    }
  }, [rows])

  async function loadReconciliation() {
    setLoading(true)
    setError(null)
    setHasRun(true)

    try {
      const { data, error } = await supabase.rpc('get_monthly_data_reconciliation', {
        p_date_debut: startDate,
        p_date_fin: endDate,
      })

      if (error) throw error
      setRows((data || []) as ReconciliationRow[])
    } catch (exception: any) {
      setError(exception?.message || String(exception))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-700">Contrôle cohérence agrégats</h2>
          <p className="mt-1 text-xs font-semibold text-slate-500">
            Compare les lignes sources, les caches, les indicateurs et le flux articles mois par mois.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold uppercase text-slate-500">
            Du
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
            />
          </label>
          <label className="text-xs font-bold uppercase text-slate-500">
            Au
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 block h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={loadReconciliation}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Contrôle…' : 'Contrôler'}
          </button>
          <button
            type="button"
            onClick={() => exportRows(rows)}
            disabled={!rows.length || loading}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export Excel
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
          Contrôle impossible : {error}
        </div>
      ) : null}

      {hasRun && !error ? (
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-bold uppercase text-slate-500">Périodes contrôlées</div>
            <div className="mt-1 text-xl font-black text-slate-900">{summary.total}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-bold uppercase text-emerald-700">Mois OK</div>
            <div className="mt-1 text-xl font-black text-emerald-800">{summary.ok}</div>
          </div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <div className="text-xs font-bold uppercase text-red-700">Mois KO</div>
            <div className="mt-1 text-xl font-black text-red-800">{summary.ko}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold uppercase text-amber-700">Factures KO</div>
            <div className="mt-1 text-xl font-black text-amber-800">{summary.facturesKo}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-bold uppercase text-amber-700">Devis KO</div>
            <div className="mt-1 text-xl font-black text-amber-800">{summary.devisKo}</div>
          </div>
        </div>
      ) : null}

      {rows.length ? (
        <div className="mt-4 max-h-[560px] overflow-auto rounded-xl border border-slate-200">
          <table className="min-w-[1900px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-900 text-white">
              <tr>
                <th className="px-2 py-2 text-left">Période</th>
                <th className="px-2 py-2 text-left">Statut</th>
                <th className="px-2 py-2 text-right">Fact. lignes</th>
                <th className="px-2 py-2 text-right">Fact. cache</th>
                <th className="px-2 py-2 text-right">Fact. indic.</th>
                <th className="px-2 py-2 text-right">Fact. flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
                <th className="px-2 py-2 text-right">Devis lignes</th>
                <th className="px-2 py-2 text-right">Devis cache</th>
                <th className="px-2 py-2 text-right">Devis indic.</th>
                <th className="px-2 py-2 text-right">Devis flux</th>
                <th className="px-2 py-2 text-right">Écart flux</th>
                <th className="px-2 py-2 text-right">CDC depuis fact</th>
                <th className="px-2 py-2 text-right">CDC depuis activité</th>
                <th className="px-2 py-2 text-right">CDC flux</th>
                <th className="px-2 py-2 text-right">Écart CDC</th>
                <th className="px-2 py-2 text-right">BL depuis fact</th>
                <th className="px-2 py-2 text-right">BL depuis activité</th>
                <th className="px-2 py-2 text-right">BL flux</th>
                <th className="px-2 py-2 text-right">Écart BL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const issues = computeRowIssues(row)
                const facturesLignes = toNumber(row.factures_lignes)
                const devisLignes = toNumber(row.devis_lignes)
                const cdcDepuisFact = toNumber(row.cdc_source_activite_plus_factures)
                const cdcAttendu = cdcDepuisFact + toNumber(row.cdc_indicateur_activite)
                const blDepuisFact = toNumber(row.bl_source_activite_plus_factures)
                const blAttendu = blDepuisFact + toNumber(row.bl_indicateur_activite)

                return (
                  <tr key={`${row.annee}-${row.mois}`} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="whitespace-nowrap px-2 py-2 font-black">{monthLabel(row)}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-black ${
                          issues.length ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                        title={issues.join(', ') || 'Tous les contrôles sont alignés'}
                      >
                        {issues.length ? `KO (${issues.length})` : 'OK'}
                      </span>
                    </td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(facturesLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_cache)}`}>{formatMoney(row.factures_cache)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_indicateur)}`}>{formatMoney(row.factures_indicateur)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(facturesLignes, row.factures_flux)}`}>{formatMoney(row.factures_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(toNumber(row.factures_flux) - facturesLignes)}`}>{formatSigned(toNumber(row.factures_flux) - facturesLignes)}</td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(devisLignes)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_cache)}`}>{formatMoney(row.devis_cache)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_indicateur)}`}>{formatMoney(row.devis_indicateur)}</td>
                    <td className={`px-2 py-2 text-right ${getValueClass(devisLignes, row.devis_flux)}`}>{formatMoney(row.devis_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(toNumber(row.devis_flux) - devisLignes)}`}>{formatSigned(toNumber(row.devis_flux) - devisLignes)}</td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(cdcDepuisFact)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatMoney(row.cdc_indicateur_activite)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_cdc_source_vs_flux)}`}>{formatMoney(row.cdc_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_cdc_source_vs_flux)}`}>{formatSigned(row.ecart_cdc_source_vs_flux)}</td>

                    <td className="px-2 py-2 text-right font-bold">{formatMoney(blDepuisFact)}</td>
                    <td className="px-2 py-2 text-right font-bold">{formatMoney(row.bl_indicateur_activite)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_bl_source_vs_flux)}`}>{formatMoney(row.bl_flux)}</td>
                    <td className={`px-2 py-2 text-right ${getEcartClass(row.ecart_bl_source_vs_flux)}`}>{formatSigned(row.ecart_bl_source_vs_flux)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : hasRun && !loading && !error ? (
        <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm font-bold text-slate-500">
          Aucun résultat retourné pour cette période.
        </div>
      ) : null}
    </div>
  )
}
