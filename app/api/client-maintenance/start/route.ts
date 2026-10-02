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
  enrichmentMaxBatchesPerWorker?: number
  enrichmentBatchSize?: number
  enrichmentMaxRuntimeMs:number
}

const DEFAULT_CONFIG: Required<MaintenanceConfig> = {
  "sirene": true,
  "cessations": true,
  "rge": true,
  "capacite": true,
  "enrichment": true,
  "enrichmentLimit": 1000,
  "enrichmentBatchSize": 50,
  "enrichmentMaxBatchesPerWorker": 20,
  "enrichmentMaxRuntimeMs": 240000
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
    const requestedSource = String(body?.source || '')

    const source =
    requestedSource === 'cron' || requestedSource.startsWith('scheduler:')
    ? 'cron'
    : 'manual'

    // ÉVOLUTION (2026-10-02) : un run resté « en cours » ne bloque plus
    // indéfiniment les suivants. Constat : le run du 22/09 04:31 est resté
    // en « running » (étape SIRENE) après l'arrêt brutal de son worker, et
    // toutes les exécutions suivantes ont été refusées pendant 10 jours.
    // Règle :
    //   - lancement par le planificateur (cron ou bouton « Lancer » de
    //     l'écran des traitements, source scheduler:*) ou demande explicite
    //     (body.force = true) : le run actif est annulé puis un nouveau run
    //     est créé ;
    //   - lancement manuel depuis l'écran Clients : le run actif n'est annulé
    //     que s'il n'a plus bougé depuis STALE_MINUTES (bloqué), sinon refus
    //     comme avant.
    const STALE_MINUTES = 15
    const forceKill = source === 'cron' || body?.force === true

    const { data: activeRuns, error: activeError } = await supabase
      .from('client_maintenance_runs')
      .select('id, status, created_at, updated_at')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })

    if (activeError) throw activeError

    const killedRunIds: string[] = []

    for (const activeRun of activeRuns || []) {
      // Dernière activité = run OU l'une de ses étapes (l'enrichissement
      // avance par lots en mettant à jour l'étape, pas le run).
      const { data: lastStep } = await supabase
        .from('client_maintenance_steps')
        .select('updated_at')
        .eq('run_id', activeRun.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const lastActivity = Math.max(
        new Date(activeRun.updated_at || activeRun.created_at).getTime(),
        lastStep?.updated_at ? new Date(lastStep.updated_at).getTime() : 0
      )
      const isStale = Date.now() - lastActivity > STALE_MINUTES * 60 * 1000

      if (!forceKill && !isStale) {
        return NextResponse.json({
          success: false,
          skipped: true,
          error: 'Une maintenance clients est déjà en cours.',
          active_run_id: activeRun.id,
        }, { status: 409 })
      }

      const reason = isStale
        ? `Run annulé : aucune activité depuis plus de ${STALE_MINUTES} min (bloqué).`
        : 'Run annulé : relancé par une nouvelle exécution planifiée.'
      const nowIso = new Date().toISOString()

      const { error: stepsCancelError } = await supabase
        .from('client_maintenance_steps')
        .update({ status: 'cancelled', finished_at: nowIso, error_message: reason })
        .eq('run_id', activeRun.id)
        .in('status', ['queued', 'running'])
      if (stepsCancelError) throw stepsCancelError

      const { error: runCancelError } = await supabase
        .from('client_maintenance_runs')
        .update({ status: 'cancelled', finished_at: nowIso, current_step: null, message: reason })
        .eq('id', activeRun.id)
        .in('status', ['queued', 'running'])
      if (runCancelError) throw runCancelError

      await supabase.from('client_maintenance_logs').insert({
        run_id: activeRun.id,
        level: 'warning',
        message: reason,
        payload_json: { cancelled_by: requestedSource || 'manual', stale: isStale },
      })

      killedRunIds.push(activeRun.id)
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
      payload_json: { source, config, killed_run_ids: killedRunIds },
    })

    return NextResponse.json({ success: true, run_id: run.id, killed_run_ids: killedRunIds })
  } catch (error: any) {
    console.error('client-maintenance/start error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
