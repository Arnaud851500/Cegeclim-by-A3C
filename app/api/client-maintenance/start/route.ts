import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MaintenanceConfig = {
  sirene?: boolean
  cessations?: boolean
  rge?: boolean
  capacite?: boolean
  enrichment?: boolean
  enrichmentLimit?: number
  enrichmentBatchSize?: number
}

const DEFAULT_CONFIG: Required<MaintenanceConfig> = {
  sirene: true,
  cessations: true,
  rge: true,
  capacite: true,
  enrichment: true,
  enrichmentLimit: 1000,
  enrichmentBatchSize: 25,
}

const ALL_STEPS = [
  { key: 'sirene_import', label: 'SIRENE création / mise à jour', order: 10, flag: 'sirene' },
  { key: 'sirene_cessation', label: 'SIRENE cessations', order: 20, flag: 'cessations' },
  { key: 'rge_refresh', label: 'Mise à jour RGE', order: 30, flag: 'rge' },
  { key: 'capacite_refresh', label: 'Mise à jour capacité froid/clim', order: 40, flag: 'capacite' },
  { key: 'enrichment_queue_build', label: 'Préparation file enrichissement', order: 50, flag: 'enrichment' },
  { key: 'enrichment_worker', label: 'Enrichissement INPI / Google', order: 60, flag: 'enrichment' },
] as const

function isAuthorized(req: NextRequest) {
  const secret = process.env.CLIENT_MAINTENANCE_SECRET
  if (!secret) return true

  const headerSecret = req.headers.get('x-client-maintenance-secret')
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return headerSecret === secret || bearer === secret
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Non autorisé.' }, { status: 401 })
    }

    const supabase = createSupabaseAdmin()
    const body = await req.json().catch(() => ({}))
    const config: Required<MaintenanceConfig> = { ...DEFAULT_CONFIG, ...(body?.config || {}) }
    const source = body?.source === 'cron' ? 'cron' : 'manual'

    const { data: activeRun, error: activeError } = await supabase
      .from('client_maintenance_runs')
      .select('id, status, created_at')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeError) throw activeError
    if (activeRun) {
      return NextResponse.json({
        success: false,
        skipped: true,
        error: 'Une maintenance clients est déjà en cours.',
        active_run_id: activeRun.id,
      }, { status: 409 })
    }

    const { data: run, error: runError } = await supabase
      .from('client_maintenance_runs')
      .insert({
        source,
        status: 'queued',
        message: 'Maintenance clients planifiée.',
        config_json: config,
        created_by: body?.createdBy || null,
      })
      .select('*')
      .single()

    if (runError) throw runError

    const steps = ALL_STEPS
      .filter((step) => Boolean((config as any)[step.flag]))
      .map((step) => ({
        run_id: run.id,
        step_key: step.key,
        step_label: step.label,
        sort_order: step.order,
        status: 'queued',
      }))

    const { error: stepsError } = await supabase.from('client_maintenance_steps').insert(steps)
    if (stepsError) throw stepsError

    await supabase.from('client_maintenance_logs').insert({
      run_id: run.id,
      level: 'info',
      message: 'Run créé.',
      payload_json: { source, config },
    })

    return NextResponse.json({ success: true, run_id: run.id })
  } catch (error: any) {
    console.error('client-maintenance/start error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
