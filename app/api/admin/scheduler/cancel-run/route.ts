import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '../../../../../lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function mergeJson(base: any, patch: Record<string, any>) {
  return {
    ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}),
    ...patch,
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))

    const schedulerRunId = body?.schedulerRunId
    const cancelAllClientRuns = body?.cancelAllClientRuns ?? true

    if (!schedulerRunId) {
      return NextResponse.json(
        { success: false, error: 'schedulerRunId manquant.' },
        { status: 400 }
      )
    }

    const { data: schedulerRun, error: schedulerRunError } = await supabase
      .from('scheduler_runs')
      .select('*')
      .eq('id', schedulerRunId)
      .maybeSingle()

    if (schedulerRunError) throw schedulerRunError
    if (!schedulerRun) {
      return NextResponse.json(
        { success: false, error: 'Run scheduler introuvable.' },
        { status: 404 }
      )
    }

    const now = new Date().toISOString()

    const { error: cancelSchedulerError } = await supabase
      .from('scheduler_runs')
      .update({
        status: 'cancelled',
        finished_at: now,
        message: 'Run annulé manuellement depuis l’écran Planification.',
        error_message: null,
        result_json: mergeJson(schedulerRun.result_json, {
          cancelled_manually: true,
          cancelled_at: now,
        }),
        updated_at: now,
      })
      .eq('id', schedulerRunId)

    if (cancelSchedulerError) throw cancelSchedulerError

    await supabase.from('scheduler_logs').insert({
      scheduler_run_id: schedulerRunId,
      level: 'warning',
      message: 'Run scheduler annulé manuellement.',
      payload_json: {
        schedulerRunId,
        job_key: schedulerRun.job_key,
        job_type: schedulerRun.job_type,
        cancelled_at: now,
      },
    })

    let cancelledClientRuns = 0

    if (cancelAllClientRuns && schedulerRun.job_type === 'client_maintenance') {
      const explicitClientRunId =
        schedulerRun?.result_json?.clientRunId ||
        schedulerRun?.result_json?.client_run_id ||
        schedulerRun?.result_json?.client_maintenance_run_id ||
        null

      let clientRunsQuery = supabase
        .from('client_maintenance_runs')
        .select('id')
        .in('status', ['queued', 'running'])

      if (explicitClientRunId) {
        clientRunsQuery = clientRunsQuery.eq('id', explicitClientRunId)
      } else {
        clientRunsQuery = clientRunsQuery
          .gte('created_at', schedulerRun.created_at)
          .or(`source.eq.scheduler:${schedulerRun.job_key},source.eq.${schedulerRun.job_key}`)
      }

      const { data: clientRuns, error: clientRunsError } = await clientRunsQuery
      if (clientRunsError) throw clientRunsError

      const clientRunIds = (clientRuns || []).map((r: any) => r.id)
      cancelledClientRuns = clientRunIds.length

      if (clientRunIds.length > 0) {
        const { error: clientRunCancelError } = await supabase
          .from('client_maintenance_runs')
          .update({
            status: 'cancelled',
            current_step: null,
            finished_at: now,
            message: 'Maintenance clients annulée depuis l’écran Planification.',
            error_message: null,
          })
          .in('id', clientRunIds)

        if (clientRunCancelError) throw clientRunCancelError

        const { error: stepCancelError } = await supabase
          .from('client_maintenance_steps')
          .update({
            status: 'skipped',
            finished_at: now,
            error_message: 'Étape annulée manuellement avec le run.',
          })
          .in('run_id', clientRunIds)
          .in('status', ['queued', 'running'])

        if (stepCancelError) throw stepCancelError

        await supabase
          .from('sirene_import_cursors')
          .update({
            status: 'cancelled',
            last_error: 'Curseur annulé manuellement depuis Planification.',
            updated_at: now,
          })
          .in('run_id', clientRunIds)
          .eq('status', 'running')

        await supabase
          .from('client_enrichment_queue')
          .update({
            status: 'error',
            processed_at: now,
            last_error: 'Enrichissement annulé manuellement depuis Planification.',
          })
          .in('run_id', clientRunIds)
          .in('status', ['queued', 'running'])
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Run annulé proprement.',
      schedulerRunId,
      cancelledClientRuns,
    })
  } catch (error: any) {
    console.error('cancel scheduler run error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}
