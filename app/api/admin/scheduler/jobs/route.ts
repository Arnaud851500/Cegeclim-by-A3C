import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { computeNextRunAt } from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function normalizeJobPayload(body: any) {
  const job = body?.job || body || {}
  const frequency = job.frequency || 'daily'

  const nextRunAt = frequency === 'manual' ? null : computeNextRunAt(job)

  return {
    id: job.id || undefined,
    job_key: String(job.job_key || '').trim(),
    job_label: String(job.job_label || '').trim(),
    job_type: String(job.job_type || 'client_maintenance').trim(),
    enabled: Boolean(job.enabled),
    frequency,
    cron_expression: job.cron_expression || null,
    timezone: job.timezone || 'Europe/Paris',
    scheduled_hour: job.scheduled_hour === null || job.scheduled_hour === '' ? null : Number(job.scheduled_hour),
    scheduled_minute: job.scheduled_minute === null || job.scheduled_minute === '' ? null : Number(job.scheduled_minute),
    scheduled_weekdays: Array.isArray(job.scheduled_weekdays) ? job.scheduled_weekdays.map(Number) : [],
    scheduled_month_day:
      job.scheduled_month_day === null || job.scheduled_month_day === '' ? null : Number(job.scheduled_month_day),
    config_json: job.config_json || {},
    max_iterations: Number(job.max_iterations || 8),
    max_runtime_seconds: Number(job.max_runtime_seconds || 600),
    allow_overlap: Boolean(job.allow_overlap),
    continue_on_error: job.continue_on_error !== false,
    next_run_at: nextRunAt,
    updated_at: new Date().toISOString(),
  }
}

export async function GET() {
  try {
    const supabase = createSupabaseAdmin()

    const { data: jobs, error: jobsError } = await supabase
      .from('scheduler_jobs')
      .select('*')
      .order('enabled', { ascending: false })
      .order('job_label', { ascending: true })

    if (jobsError) throw jobsError

    const { data: runs, error: runsError } = await supabase
      .from('scheduler_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (runsError) throw runsError

    const { data: logs, error: logsError } = await supabase
      .from('scheduler_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (logsError) throw logsError

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
    const payload = normalizeJobPayload(body)

    if (!payload.job_key) throw new Error('job_key est obligatoire.')
    if (!payload.job_label) throw new Error('job_label est obligatoire.')

    if (payload.id) {
      const { data, error } = await supabase
        .from('scheduler_jobs')
        .update(payload)
        .eq('id', payload.id)
        .select('*')
        .single()

      if (error) throw error
      return NextResponse.json({ success: true, job: data })
    }

    const { data, error } = await supabase
      .from('scheduler_jobs')
      .upsert(payload, { onConflict: 'job_key' })
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, job: data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
