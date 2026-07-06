import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { createSchedulerRun, executeSchedulerRun } from '@/lib/server/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))
    const jobId = body?.job_id || body?.id || null
    const jobKey = body?.job_key || null

    let query = supabase.from('scheduler_jobs').select('*')

    if (jobId) query = query.eq('id', jobId)
    else if (jobKey) query = query.eq('job_key', jobKey)
    else throw new Error('job_id ou job_key obligatoire.')

    const { data: job, error: jobError } = await query.limit(1).maybeSingle()

    if (jobError) throw jobError
    if (!job?.id) throw new Error('Traitement planifié introuvable.')

    if (!job.allow_overlap) {
      const { data: activeRun, error: activeError } = await supabase
        .from('scheduler_runs')
        .select('id,status')
        .eq('job_id', job.id)
        .eq('status', 'running')
        .limit(1)
        .maybeSingle()

      if (activeError) throw activeError
      if (activeRun?.id) {
        return NextResponse.json(
          {
            success: false,
            error: 'Un run est déjà en cours pour ce traitement.',
            active_run: activeRun,
          },
          { status: 409 }
        )
      }
    }

    const schedulerRun = await createSchedulerRun(supabase, job, 'manual')

    const execution = await executeSchedulerRun({
      supabase,
      job,
      schedulerRun,
      origin: req.nextUrl.origin,
    })

    await supabase
      .from('scheduler_jobs')
      .update({
        last_run_at: new Date().toISOString(),
        last_status: execution.schedulerRunStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({
      success: true,
      run: schedulerRun,
      execution,
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
