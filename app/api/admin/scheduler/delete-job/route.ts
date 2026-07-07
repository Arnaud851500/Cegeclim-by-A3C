import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '../../../../../lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))
    const jobId = body?.jobId

    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'jobId manquant.' },
        { status: 400 }
      )
    }

    const { count: activeRuns, error: countError } = await supabase
      .from('scheduler_runs')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .in('status', ['queued', 'running'])

    if (countError) throw countError

    if ((activeRuns || 0) > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Impossible de supprimer ce job : un run est encore en cours. Arrête le run avant suppression.',
        },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()

    const { error } = await supabase
      .from('scheduler_jobs')
      .update({
        enabled: false,
        deleted_at: now,
        updated_at: now,
      })
      .eq('id', jobId)

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'Job supprimé / archivé.',
    })
  } catch (error: any) {
    console.error('delete scheduler job error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}
