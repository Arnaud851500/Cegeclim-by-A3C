import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdmin()
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 10), 50)

    const { data: runs, error: runsError } = await supabase
      .from('client_maintenance_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (runsError) throw runsError

    const runIds = (runs || []).map((run: any) => run.id)

    let steps: any[] = []
    let logs: any[] = []

    if (runIds.length > 0) {
      const [stepsRes, logsRes] = await Promise.all([
        supabase
          .from('client_maintenance_steps')
          .select('*')
          .in('run_id', runIds)
          .order('sort_order', { ascending: true }),
        supabase
          .from('client_maintenance_logs')
          .select('*')
          .in('run_id', runIds)
          .order('created_at', { ascending: false })
          .limit(500),
      ])

      if (stepsRes.error) throw stepsRes.error
      if (logsRes.error) throw logsRes.error
      steps = stepsRes.data || []
      logs = logsRes.data || []
    }

    return NextResponse.json({ success: true, runs: runs || [], steps, logs })
  } catch (error: any) {
    console.error('client-maintenance/status error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
