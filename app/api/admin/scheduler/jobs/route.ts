import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { computeNextRunAt } from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SchedulerJobInput = {
  id?: string
  job_key?: string
  job_label?: string
  job_type?: string
  enabled?: boolean
  frequency?: string
  timezone?: string
  scheduled_hour?: number | null
  scheduled_minute?: number | null
  scheduled_weekdays?: number[] | null
  scheduled_month_day?: number | null
  config_json?: any
  max_iterations?: number | null
  max_runtime_seconds?: number | null
  allow_overlap?: boolean | null
  continue_on_error?: boolean | null
}

function asNumberOrNull(value: any, fallback: number | null = null) {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function cleanWeekdays(value: any) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
    )
  )
}

function normalizeConfig(value: any) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return { raw: value }
    }
  }
  return value
}

function normalizeJob(input: SchedulerJobInput) {
  const jobKey = String(input.job_key || '').trim()
  const jobLabel = String(input.job_label || '').trim()

  if (!jobKey) throw new Error('Clé technique du job obligatoire.')
  if (!jobLabel) throw new Error('Libellé du job obligatoire.')

  const job = {
    job_key: jobKey,
    job_label: jobLabel,
    job_type: String(input.job_type || 'http_route'),
    enabled: Boolean(input.enabled),
    frequency: String(input.frequency || 'manual'),
    timezone: String(input.timezone || 'Europe/Paris'),
    scheduled_hour: asNumberOrNull(input.scheduled_hour, 0),
    scheduled_minute: asNumberOrNull(input.scheduled_minute, 0),
    scheduled_weekdays: cleanWeekdays(input.scheduled_weekdays),
    scheduled_month_day: asNumberOrNull(input.scheduled_month_day, 1),
    config_json: normalizeConfig(input.config_json),
    max_iterations: asNumberOrNull(input.max_iterations, 20),
    max_runtime_seconds: asNumberOrNull(input.max_runtime_seconds, 600),
    allow_overlap: Boolean(input.allow_overlap),
    continue_on_error: input.continue_on_error !== false,
  }

  return {
    ...job,
    next_run_at: computeNextRunAt(job),
  }
}

async function addSchedulerLog(
  schedulerRunId: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload: Record<string, any> = {}
) {
  const supabase = createSupabaseAdmin()

  await supabase
    .from('scheduler_logs')
    .insert({
      scheduler_run_id: schedulerRunId,
      level,
      message,
      payload_json: payload,
    })
}

async function cancelActiveRuns(jobId: string, reason: string) {
  const supabase = createSupabaseAdmin()
  const now = new Date().toISOString()

  const { data: activeRuns, error: readError } = await supabase
    .from('scheduler_runs')
    .select('id,status')
    .eq('job_id', jobId)
    .in('status', ['queued', 'running'])

  if (readError) throw readError
  if (!activeRuns?.length) return []

  const ids = activeRuns.map((run) => run.id)

  const { error: cancelledError } = await supabase
    .from('scheduler_runs')
    .update({
      status: 'cancelled',
      finished_at: now,
      message: reason,
      updated_at: now,
    })
    .in('id', ids)

  if (!cancelledError) {
    await Promise.all(
      ids.map((id) => addSchedulerLog(id, 'warning', reason, { cancelled_by: 'scheduler_jobs_delete' }))
    )
    return ids
  }

  // Sécurité : si la contrainte SQL de status n'autorise pas encore "cancelled",
  // on bascule en "partial" pour ne pas bloquer la suppression / archivage du job.
  const { error: partialError } = await supabase
    .from('scheduler_runs')
    .update({
      status: 'partial',
      finished_at: now,
      message: reason,
      error_message: cancelledError.message,
      updated_at: now,
    })
    .in('id', ids)

  if (partialError) throw partialError

  await Promise.all(
    ids.map((id) => addSchedulerLog(id, 'warning', reason, {
      cancelled_by: 'scheduler_jobs_delete',
      fallback_status: 'partial',
      cancel_error: cancelledError.message,
    }))
  )

  return ids
}

export async function GET() {
  try {
    const supabase = createSupabaseAdmin()

    const { data: jobs, error: jobsError } = await supabase
      .from('scheduler_jobs')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })

    if (jobsError) throw jobsError

    const { data: runs, error: runsError } = await supabase
      .from('scheduler_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(80)

    if (runsError) throw runsError

    const { data: logs, error: logsError } = await supabase
      .from('scheduler_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(120)

    if (logsError && !String(logsError.message || '').includes('does not exist')) {
      throw logsError
    }

    return NextResponse.json({
      success: true,
      jobs: jobs || [],
      runs: runs || [],
      logs: logs || [],
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))
    const input = body.job || body
    const normalized = normalizeJob(input)
    const now = new Date().toISOString()

    let result

    if (input.id) {
      const { data, error } = await supabase
        .from('scheduler_jobs')
        .update({
          ...normalized,
          updated_at: now,
        })
        .eq('id', input.id)
        .is('archived_at', null)
        .select('*')
        .single()

      if (error) throw error
      result = data
    } else {
      const { data, error } = await supabase
        .from('scheduler_jobs')
        .upsert(
          {
            ...normalized,
            archived_at: null,
            archived_by: null,
            archive_reason: null,
            updated_at: now,
          },
          { onConflict: 'job_key' }
        )
        .select('*')
        .single()

      if (error) throw error
      result = data
    }

    return NextResponse.json({
      success: true,
      job: result,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  return POST(req)
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))
    const url = new URL(req.url)

    const id = String(body.id || body.job_id || url.searchParams.get('id') || url.searchParams.get('job_id') || '').trim()
    const jobKey = String(body.job_key || url.searchParams.get('job_key') || '').trim()

    if (!id && !jobKey) {
      return NextResponse.json(
        { success: false, error: 'ID ou clé technique du job manquant.' },
        { status: 400 }
      )
    }

    let jobQuery = supabase
      .from('scheduler_jobs')
      .select('id, job_key, job_label, archived_at')
      .limit(1)

    if (id) jobQuery = jobQuery.eq('id', id)
    else jobQuery = jobQuery.eq('job_key', jobKey)

    const { data: job, error: readError } = await jobQuery.maybeSingle()
    if (readError) throw readError

    if (!job) {
      return NextResponse.json({
        success: true,
        already_deleted: true,
        message: 'Job introuvable : il est probablement déjà supprimé ou archivé.',
      })
    }

    const now = new Date().toISOString()
    const reason = body.reason || 'Suppression utilisateur depuis écran planification'
    const activeRunIds = await cancelActiveRuns(job.id, 'Run annulé automatiquement car le job a été supprimé / archivé.')

    const { data, error } = await supabase
      .from('scheduler_jobs')
      .update({
        enabled: false,
        next_run_at: null,
        archived_at: now,
        archived_by: body.archived_by || null,
        archive_reason: reason,
        updated_at: now,
      })
      .eq('id', job.id)
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({
      success: true,
      job: data,
      cancelled_run_ids: activeRunIds,
      message: 'Job archivé, désactivé et retiré de la liste.',
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
