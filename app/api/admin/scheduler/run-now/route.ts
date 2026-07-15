import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import {
  computeNextRunAt,
  createSchedulerRun,
  executeSchedulerRun,
} from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type SchedulerJob = {
  id: string
  job_key: string
  job_label: string
  job_type: string
  enabled: boolean
  frequency: string
  cron_expression?: string | null
  timezone: string
  scheduled_hour?: number | null
  scheduled_minute?: number | null
  scheduled_weekdays?: number[] | null
  scheduled_month_day?: number | null
  config_json?: Record<string, any>
  max_iterations?: number | null
  max_runtime_seconds?: number | null
  allow_overlap?: boolean | null
  continue_on_error?: boolean | null
  next_run_at?: string | null
  archived_at?: string | null
}

type SchedulerRun = {
  id: string
  job_id: string
  job_key: string
  job_type: string
  status: string
  trigger_source: string
  result_json?: Record<string, any>
}

async function addSchedulerLog(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  schedulerRunId: string,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload: Record<string, any> = {}
) {
  await supabase.from('scheduler_logs').insert({
    scheduler_run_id: schedulerRunId,
    level,
    message,
    payload_json: payload,
  })
}

async function findJob(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  id?: string,
  jobKey?: string
) {
  let query = supabase
    .from('scheduler_jobs')
    .select('*')
    .is('archived_at', null)
    .limit(1)

  if (id) query = query.eq('id', id)
  else if (jobKey) query = query.eq('job_key', jobKey)
  else throw new Error('ID ou clé technique du job manquant.')

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Job introuvable ou archivé.')

  return data as SchedulerJob
}

async function findExistingActiveRun(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('scheduler_runs')
    .select('*')
    .eq('job_id', jobId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as SchedulerRun | null
}

async function updateJobAfterRun(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  job: SchedulerJob,
  status: string
) {
  const now = new Date().toISOString()
  const nextRunAt =
    job.enabled && job.frequency !== 'manual'
      ? computeNextRunAt(job)
      : job.next_run_at || null

  const { error } = await supabase
    .from('scheduler_jobs')
    .update({
      last_run_at: now,
      last_status: status,
      next_run_at: nextRunAt,
      updated_at: now,
    })
    .eq('id', job.id)

  if (error) throw error
  return nextRunAt
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseAdmin()
  let schedulerRun: SchedulerRun | null = null
  let job: SchedulerJob | null = null

  try {
    const body = await req.json().catch(() => ({}))
    const jobId = String(body.job_id || body.id || '').trim()
    const jobKey = String(body.job_key || '').trim()

    job = await findJob(supabase, jobId || undefined, jobKey || undefined)

    if (job.archived_at) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ce job est archivé et ne peut plus être lancé.',
        },
        { status: 409 }
      )
    }

    const existingActiveRun = await findExistingActiveRun(supabase, job.id)

    if (existingActiveRun?.id) {
      schedulerRun = existingActiveRun

      await addSchedulerLog(
        supabase,
        schedulerRun.id,
        'warning',
        'Run manuel demandé alors qu’un run scheduler était déjà actif : reprise du run existant.',
        {
          job_key: job.job_key,
          existing_run_id: schedulerRun.id,
        }
      )
    } else {
      schedulerRun = await createSchedulerRun(supabase, job, 'manual')
    }

    const execution = await executeSchedulerRun({
      supabase,
      job,
      schedulerRun,
    })

    const finalStatus =
      execution.schedulerRunStatus || execution.status || 'done'

    const nextRunAt = await updateJobAfterRun(
      supabase,
      job,
      finalStatus
    )

    return NextResponse.json({
      success: true,
      job_key: job.job_key,
      run_id: schedulerRun.id,
      reused_existing_scheduler_run: Boolean(existingActiveRun?.id),
      status: finalStatus,
      next_run_at: nextRunAt,
      execution,
    })
  } catch (error: any) {
    const message = error?.message || String(error)
    const now = new Date().toISOString()

    if (schedulerRun?.id) {
      await supabase
        .from('scheduler_runs')
        .update({
          status:
            job?.continue_on_error === false
              ? 'error'
              : 'partial',
          finished_at: now,
          error_message: message,
          message: 'Erreur lancement manuel scheduler.',
          updated_at: now,
        })
        .eq('id', schedulerRun.id)

      await addSchedulerLog(
        supabase,
        schedulerRun.id,
        'error',
        'Erreur lancement manuel scheduler.',
        {
          error: message,
          job_key: job?.job_key || null,
        }
      )
    }

    if (job?.id) {
      await supabase
        .from('scheduler_jobs')
        .update({
          last_run_at: now,
          last_status:
            job.continue_on_error === false
              ? 'error'
              : 'partial',
          updated_at: now,
        })
        .eq('id', job.id)
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
