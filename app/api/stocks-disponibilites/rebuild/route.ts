// app/api/stocks-disponibilites/rebuild/route.ts
// Recalcul global découpé en plusieurs requêtes courtes et reprenables.
// Une requête ne tente plus de traiter l'intégralité des références avant
// la limite Vercel : elle exécute quelques lots, retourne l'état d'avancement,
// puis la page rappelle automatiquement la route avec la continuation reçue.

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
export const maxDuration = 280

type JsonRecord = Record<string, any>
type RebuildPhase = 'projection' | 'netting' | 'finalize' | 'done'

type Continuation = {
  run_id: string
  phase: RebuildPhase
  projection_offset: number
  netting_offset: number
  total_articles: number
  total_references: number
  projection_batch_size: number
  netting_batch_size: number
  netting_concurrency: number
}

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

function progressPercent(state: Continuation) {
  if (state.phase === 'done') return 100
  if (state.phase === 'finalize') return 98

  if (state.phase === 'projection') {
    if (state.total_articles <= 0) return 45
    return Math.max(
      1,
      Math.min(45, Math.round((state.projection_offset / state.total_articles) * 45)),
    )
  }

  if (state.total_references <= 0) return 95
  return Math.max(
    46,
    Math.min(
      95,
      45 + Math.round((state.netting_offset / state.total_references) * 50),
    ),
  )
}

function progressMessage(state: Continuation) {
  if (state.phase === 'projection') {
    return `Construction des projections : ${Math.min(
      state.projection_offset,
      state.total_articles,
    )} / ${state.total_articles} articles`
  }
  if (state.phase === 'netting') {
    return `Calcul des stocks : ${Math.min(
      state.netting_offset,
      state.total_references,
    )} / ${state.total_references} références`
  }
  if (state.phase === 'finalize') return 'Finalisation de la projection'
  return 'Projection terminée'
}

function continuationPayload(state: Continuation) {
  return {
    success: true,
    done: state.phase === 'done',
    continuation: state.phase === 'done' ? null : state,
    progress: {
      phase: state.phase,
      percent: progressPercent(state),
      message: progressMessage(state),
      projection_offset: state.projection_offset,
      netting_offset: state.netting_offset,
      total_articles: state.total_articles,
      total_references: state.total_references,
    },
  }
}

async function runNettingWave(options: {
  offsets: number[]
  state: Continuation
  trace: DiagnosticTrace
  admin: ReturnType<typeof createAdminClient>
}) {
  const { offsets, state, trace, admin } = options

  await Promise.all(
    offsets.map((offset, index) =>
      trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'netting_batch',
          objectName: 'public.apply_stock_projection_fermes_incluses_batch',
          runId: state.run_id,
          batchOffset: offset,
          batchLimit: state.netting_batch_size,
          context: {
            total_references: state.total_references,
            netting_concurrency: state.netting_concurrency,
            worker_index: index + 1,
          },
        },
        () =>
          admin.rpc('apply_stock_projection_fermes_incluses_batch', {
            p_run_id: state.run_id,
            p_offset: offset,
            p_limit: state.netting_batch_size,
          }),
      ),
    ),
  )
}

export async function POST(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-REBUILD')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'rebuild_projection_resumable',
  })

  try {
    const user = await requireAuthenticatedUser(req, admin, trace)
    const body = await req.json().catch(() => ({}))

    const projectionBatchSize = toPositiveInteger(
      body.projection_batch_size ?? body.batch_size,
      100,
      25,
      300,
    )
    const nettingBatchSize = toPositiveInteger(body.netting_batch_size, 50, 10, 150)
    const nettingConcurrency = toPositiveInteger(body.netting_concurrency, 4, 1, 6)

    // Nombre maximal de lots exécutés par requête. Ces limites gardent chaque
    // appel sous 60 secondes même lorsque PostgreSQL est plus lent.
    const projectionBatchesPerRequest = toPositiveInteger(
      body.projection_batches_per_request,
      3,
      1,
      6,
    )
    const nettingBatchesPerRequest = toPositiveInteger(
      body.netting_batches_per_request,
      8,
      1,
      24,
    )

    let state: Continuation

    const incomingRunId = getString(body.run_id)
    const incomingPhase = getString(body.phase) as RebuildPhase

    if (!incomingRunId) {
      const dateDebut = toIsoDate(body.date_debut)
      const nbSemaines = toPositiveInteger(body.nb_semaines, 26, 1, 104)
      const scenarioPct = toPositiveNumber(body.scenario_prevision_pct, 1.2)
      const depotMode =
        getString(body.depot_mode, 'GLOBAL').toUpperCase() === 'DEPOT'
          ? 'DEPOT'
          : 'GLOBAL'
      const commentaire = getString(
        body.commentaire,
        'Projection stock depuis route serveur reprenable',
      )

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
            netting_concurrency: nettingConcurrency,
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
      const runId = parseRunId(startData)

      if (!runId) {
        const error = {
          status: 500,
          code: 'RUN_ID_MISSING',
          message: 'Le démarrage de projection n’a pas retourné de run_id.',
          details: startData,
        }
        throw new DiagnosticError(
          trace.reportFromUnknown(error, error.message),
          500,
          error,
        )
      }

      state = {
        run_id: runId,
        phase: 'projection',
        projection_offset: 0,
        netting_offset: 0,
        total_articles: Number(startData.total_articles || 0),
        total_references: 0,
        projection_batch_size: projectionBatchSize,
        netting_batch_size: nettingBatchSize,
        netting_concurrency: nettingConcurrency,
      }
    } else {
      if (!['projection', 'netting', 'finalize'].includes(incomingPhase)) {
        const error = {
          status: 400,
          code: 'INVALID_CONTINUATION_PHASE',
          message: `Phase de continuation invalide : ${incomingPhase || 'vide'}.`,
        }
        throw new DiagnosticError(
          trace.reportFromUnknown(error, error.message),
          400,
          error,
        )
      }

      state = {
        run_id: incomingRunId,
        phase: incomingPhase,
        projection_offset: toPositiveInteger(body.projection_offset, 0, 0, 10_000_000),
        netting_offset: toPositiveInteger(body.netting_offset, 0, 0, 10_000_000),
        total_articles: toPositiveInteger(body.total_articles, 0, 0, 10_000_000),
        total_references: toPositiveInteger(body.total_references, 0, 0, 10_000_000),
        projection_batch_size: projectionBatchSize,
        netting_batch_size: nettingBatchSize,
        netting_concurrency: nettingConcurrency,
      }
    }

    if (state.phase === 'projection') {
      let processedBatches = 0

      while (
        state.projection_offset < state.total_articles &&
        processedBatches < projectionBatchesPerRequest
      ) {
        const offset = state.projection_offset

        await trace.runStep(
          {
            layer: 'supabase_rpc',
            step: 'projection_batch',
            objectName: 'public.process_stock_projection_hebdo_batch',
            runId: state.run_id,
            batchOffset: offset,
            batchLimit: state.projection_batch_size,
            context: {
              total_articles: state.total_articles,
              projection_batches_per_request: projectionBatchesPerRequest,
            },
          },
          () =>
            admin.rpc('process_stock_projection_hebdo_batch', {
              p_run_id: state.run_id,
              p_offset: offset,
              p_limit: state.projection_batch_size,
            }),
        )

        state.projection_offset += state.projection_batch_size
        processedBatches += 1
      }

      if (state.projection_offset >= state.total_articles) {
        const countResponse: any = await trace.runStep(
          {
            layer: 'supabase_rpc',
            step: 'count_netting_references',
            objectName: 'public.count_stock_projection_references',
            runId: state.run_id,
          },
          () =>
            admin.rpc('count_stock_projection_references', {
              p_run_id: state.run_id,
            }),
        )

        state.total_references = Number(countResponse.data || 0)
        state.netting_offset = 0
        state.phase = state.total_references > 0 ? 'netting' : 'finalize'
      }

      const report = trace.reportSuccess()
      return diagnosticJson(
        continuationPayload(state),
        report,
        state.phase === 'finalize' ? 202 : 202,
      )
    }

    if (state.phase === 'netting') {
      let remainingForRequest = nettingBatchesPerRequest

      while (
        state.netting_offset < state.total_references &&
        remainingForRequest > 0
      ) {
        const waveSize = Math.min(
          state.netting_concurrency,
          remainingForRequest,
          Math.ceil(
            (state.total_references - state.netting_offset) /
              state.netting_batch_size,
          ),
        )

        const offsets = Array.from(
          { length: waveSize },
          (_, index) =>
            state.netting_offset + index * state.netting_batch_size,
        )

        await runNettingWave({ offsets, state, trace, admin })

        state.netting_offset += offsets.length * state.netting_batch_size
        remainingForRequest -= offsets.length
      }

      if (state.netting_offset >= state.total_references) {
        state.phase = 'finalize'
      }

      return diagnosticJson(
        continuationPayload(state),
        trace.reportSuccess(),
        202,
      )
    }

    let statsCache: unknown = null
    let statsCacheWarning: unknown = null

    const finalizeResponse: any = await trace.runStep(
      {
        layer: 'supabase_rpc',
        step: 'finalize_run',
        objectName: 'public.finalize_stock_projection_hebdo_run',
        runId: state.run_id,
      },
      () =>
        admin.rpc('finalize_stock_projection_hebdo_run', {
          p_run_id: state.run_id,
        }),
    )

    try {
      const statsResponse: any = await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'refresh_stats_cache',
          objectName: 'public.refresh_stock_article_sorties_stats_cache',
          runId: state.run_id,
        },
        () =>
          admin.rpc('refresh_stock_article_sorties_stats_cache', {
            p_cache_date: new Date().toISOString().slice(0, 10),
          }),
      )
      statsCache = statsResponse.data || null
    } catch (error) {
      if (error instanceof DiagnosticError) {
        statsCacheWarning = error.report
      } else {
        throw error
      }
    }

    state.phase = 'done'
    const report = trace.reportSuccess()

    if (statsCacheWarning) {
      report.status = 'WARNING'
      report.user_message =
        'La projection est terminée, mais le cache statistique n’a pas été rafraîchi.'
    }

    return diagnosticJson(
      {
        ...continuationPayload(state),
        run_id: state.run_id,
        finalize: finalizeResponse.data || null,
        stats_cache: statsCache,
        stats_cache_warning: statsCacheWarning,
      },
      report,
      statsCacheWarning ? 207 : 200,
    )
  } catch (error) {
    return diagnosticErrorJson(
      error,
      trace,
      'Erreur serveur pendant le recalcul de projection.',
    )
  }
}
