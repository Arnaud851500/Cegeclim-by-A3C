// app/api/stocks-disponibilites/rebuild/route.ts
// Recalcul de projection instrumenté : chaque RPC, lot, durée et erreur est corrélé par trace_id.

import { NextRequest } from 'next/server'
import {
  createAdminClient,
  DiagnosticError,
  DiagnosticTrace,
  diagnosticErrorJson,
  diagnosticJson,
  requireAuthenticatedUser,
  resolveTraceId,
} from '@/lib/server/diagnostics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type JsonRecord = Record<string, any>

function toPositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function toPositiveNumber(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

function toIsoDate(value: unknown) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return new Date().toISOString().slice(0, 10)
}

function getString(value: unknown, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function parseRunId(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as JsonRecord
  return typeof record.run_id === 'string' ? record.run_id : null
}

function serverBudgetExceeded(startedAt: number) {
  return Date.now() - startedAt > 275_000
}

async function throwServerBudgetError(
  trace: DiagnosticTrace,
  step: string,
  runId: string | null,
  context: Record<string, unknown>,
) {
  const error = {
    status: 504,
    code: 'VERCEL_TIME_BUDGET',
    message: 'La route approche de la limite Vercel de 300 secondes avant la fin du traitement.',
    details: context,
  }
  await trace.recordManual({
    layer: 'vercel_function',
    step,
    objectName: '/api/stocks-disponibilites/rebuild',
    runId,
    status: 'ERROR',
    httpStatus: 504,
    errorCode: 'VERCEL_TIME_BUDGET',
    errorMessage: error.message,
    context,
    rawError: error,
  })
  throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 504, error)
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const traceId = resolveTraceId(req, 'STOCK-REBUILD')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'rebuild_projection',
  })

  let runId: string | null = null

  try {
    const user = await requireAuthenticatedUser(req, admin, trace)
    const body = await req.json().catch(() => ({}))

    const dateDebut = toIsoDate(body.date_debut)
    const nbSemaines = toPositiveInteger(body.nb_semaines, 16, 1, 104)
    const scenarioPct = toPositiveNumber(body.scenario_prevision_pct, 1.2)
    const depotMode = getString(body.depot_mode, 'GLOBAL').toUpperCase() === 'DEPOT' ? 'DEPOT' : 'GLOBAL'
    const commentaire = getString(body.commentaire, 'Projection stock depuis route serveur instrumentée')
    const projectionBatchSize = toPositiveInteger(body.batch_size, 100, 25, 300)
    const nettingBatchSize = toPositiveInteger(body.netting_batch_size, 50, 10, 150)

    const startResponse: any = await trace.runStep(
      {
        layer: 'supabase_rpc',
        step: 'start_run',
        objectName: 'public.start_stock_projection_hebdo_front',
        context: {
          user_id: user.id,
          date_debut: dateDebut,
          nb_semaines: nbSemaines,
          scenario_prevision_pct: scenarioPct,
          depot_mode: depotMode,
          projection_batch_size: projectionBatchSize,
          netting_batch_size: nettingBatchSize,
        },
      },
      () =>
        admin.rpc('start_stock_projection_hebdo_front', {
          p_date_debut: dateDebut,
          p_nb_semaines: nbSemaines,
          p_scenario_prevision_pct: scenarioPct,
          p_depot_mode: depotMode,
          p_commentaire: `${commentaire} | trace_id=${traceId}`,
          p_batch_size: projectionBatchSize,
        }),
    )

    const startData = (startResponse.data || {}) as JsonRecord
    runId = parseRunId(startData)
    if (!runId) {
      const error = {
        status: 500,
        code: 'RUN_ID_MISSING',
        message: 'Le démarrage de projection n’a pas retourné de run_id.',
        details: startData,
      }
      throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 500, error)
    }

    const totalArticles = Number(startData.total_articles || 0)
    let completedProjectionBatches = 0

    for (let offset = 0; offset < totalArticles; offset += projectionBatchSize) {
      if (serverBudgetExceeded(startedAt)) {
        await throwServerBudgetError(trace, 'projection_route_time_budget', runId, {
          offset,
          completed_projection_batches: completedProjectionBatches,
          total_articles: totalArticles,
          duration_ms: Date.now() - startedAt,
        })
      }

      await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'projection_batch',
          objectName: 'public.process_stock_projection_hebdo_batch',
          runId,
          batchOffset: offset,
          batchLimit: projectionBatchSize,
          context: { total_articles: totalArticles },
        },
        () =>
          admin.rpc('process_stock_projection_hebdo_batch', {
            p_run_id: runId,
            p_offset: offset,
            p_limit: projectionBatchSize,
          }),
      )
      completedProjectionBatches += 1
    }

    const countResponse: any = await trace.runStep(
      {
        layer: 'supabase_rpc',
        step: 'count_netting_references',
        objectName: 'public.count_stock_projection_references',
        runId,
      },
      () => admin.rpc('count_stock_projection_references', { p_run_id: runId }),
    )

    const totalReferences = Number(countResponse.data || 0)
    let completedNettingBatches = 0

    for (let offset = 0; offset < totalReferences; offset += nettingBatchSize) {
      if (serverBudgetExceeded(startedAt)) {
        await throwServerBudgetError(trace, 'netting_route_time_budget', runId, {
          offset,
          completed_projection_batches: completedProjectionBatches,
          completed_netting_batches: completedNettingBatches,
          total_references: totalReferences,
          duration_ms: Date.now() - startedAt,
        })
      }

      await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'netting_batch',
          objectName: 'public.apply_stock_projection_fermes_incluses_batch',
          runId,
          batchOffset: offset,
          batchLimit: nettingBatchSize,
          context: { total_references: totalReferences },
        },
        () =>
          admin.rpc('apply_stock_projection_fermes_incluses_batch', {
            p_run_id: runId,
            p_offset: offset,
            p_limit: nettingBatchSize,
          }),
      )
      completedNettingBatches += 1
    }

    const finalizeResponse: any = await trace.runStep(
      {
        layer: 'supabase_rpc',
        step: 'finalize_run',
        objectName: 'public.finalize_stock_projection_hebdo_run',
        runId,
      },
      () => admin.rpc('finalize_stock_projection_hebdo_run', { p_run_id: runId }),
    )

    let statsCache: unknown = null
    let statsCacheWarning: unknown = null
    try {
      const statsResponse: any = await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'refresh_stats_cache',
          objectName: 'public.refresh_stock_article_sorties_stats_cache',
          runId,
        },
        () =>
          admin.rpc('refresh_stock_article_sorties_stats_cache', {
            p_cache_date: new Date().toISOString().slice(0, 10),
          }),
      )
      statsCache = statsResponse.data || null
    } catch (error) {
      if (error instanceof DiagnosticError) statsCacheWarning = error.report
      else throw error
    }

    const report = trace.reportSuccess()
    if (statsCacheWarning) {
      report.status = 'WARNING'
      report.user_message = 'La projection est terminée, mais le cache statistique n’a pas été rafraîchi.'
    }

    return diagnosticJson(
      {
        success: true,
        run_id: runId,
        start: startData,
        finalize: finalizeResponse.data || null,
        stats_cache: statsCache,
        stats_cache_warning: statsCacheWarning,
        completed_projection_batches: completedProjectionBatches,
        completed_netting_batches: completedNettingBatches,
        total_articles: totalArticles,
        total_references: totalReferences,
        projection_batch_size: projectionBatchSize,
        netting_batch_size: nettingBatchSize,
        duration_ms: Date.now() - startedAt,
      },
      report,
      statsCacheWarning ? 207 : 200,
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur serveur pendant le recalcul de projection.')
  }
}
