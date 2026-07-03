import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type StepRow = {
  id: string
  run_id: string
  step_key: string
  step_label: string
  status: string
  sort_order: number
  processed_count: number
  inserted_count: number
  updated_count: number
  rejected_count: number
  error_count: number
}

function isAuthorized(req: NextRequest) {
  const secret = process.env.CLIENT_MAINTENANCE_SECRET
  if (!secret) return true

  const headerSecret = req.headers.get('x-client-maintenance-secret')
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return headerSecret === secret || bearer === secret
}

async function addLog(supabase: any, runId: string, stepId: string | null, level: 'info' | 'warning' | 'error', message: string, payload: Record<string, any> = {}) {
  await supabase.from('client_maintenance_logs').insert({
    run_id: runId,
    step_id: stepId,
    level,
    message,
    payload_json: payload,
  })
}

async function startStep(supabase: any, step: StepRow) {
  await supabase
    .from('client_maintenance_steps')
    .update({ status: 'running', started_at: new Date().toISOString(), error_message: null })
    .eq('id', step.id)

  await supabase
    .from('client_maintenance_runs')
    .update({ status: 'running', started_at: new Date().toISOString(), current_step: step.step_label, message: `Étape en cours : ${step.step_label}` })
    .eq('id', step.run_id)
}

async function finishStep(supabase: any, step: StepRow, status: 'done' | 'error' | 'skipped', patch: Record<string, any> = {}) {
  await supabase
    .from('client_maintenance_steps')
    .update({
      status,
      finished_at: new Date().toISOString(),
      ...patch,
    })
    .eq('id', step.id)
}

function countFromResult(stepKey: string, data: any) {
  if (stepKey === 'sirene_import') {
    return {
      processed_count: Number(data?.fetched ?? data?.api_total ?? 0) || 0,
      inserted_count: Number(data?.imported ?? 0) || 0,
      updated_count: Number(data?.already_present ?? 0) || 0,
      rejected_count: Number(data?.rejected_total ?? data?.rejected_by_filter ?? 0) || 0,
      error_count: 0,
    }
  }

  if (stepKey === 'sirene_cessation') {
    return {
      processed_count: Number(data?.closed_candidates ?? data?.fetched ?? 0) || 0,
      inserted_count: 0,
      updated_count: Number(data?.deleted_from_clients ?? 0) + Number(data?.cegeclim_alerts_updated ?? 0),
      rejected_count: Number(data?.rejected_total ?? data?.rejected_by_filter ?? 0) || 0,
      error_count: 0,
    }
  }

  if (stepKey === 'rge_refresh') {
    const stats = data?.stats || {}
    return {
      processed_count: Number(stats.sourceRows ?? 0) || 0,
      inserted_count: Number(stats.cacheInserted ?? 0) || 0,
      updated_count: Number(stats.clientsUpdated ?? stats.cacheUpdated ?? 0) || 0,
      rejected_count: 0,
      error_count: 0,
    }
  }

  if (stepKey === 'capacite_refresh') {
    return {
      processed_count: Number(data?.nb_rows_source ?? 0) || 0,
      inserted_count: Number(data?.nb_rows_imported ?? 0) || 0,
      updated_count: Number(data?.nb_rows_updated ?? 0) || 0,
      rejected_count: 0,
      error_count: 0,
    }
  }

  return {
    processed_count: 0,
    inserted_count: 0,
    updated_count: 0,
    rejected_count: 0,
    error_count: 0,
  }
}

async function callInternalApi(req: NextRequest, path: string, body?: Record<string, any>) {
  const url = new URL(path, req.nextUrl.origin)
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-maintenance-secret': process.env.CLIENT_MAINTENANCE_SECRET || '',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || data?.message || text || `Erreur API ${path}`)
  }

  return data
}

async function finalizeSireneParams(supabase: any) {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('import_sirene_params')
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data?.id) return

  await supabase
    .from('import_sirene_params')
    .update({
      date_creation_min: today,
      date_creation_max: null,
      last_import_at: today,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id)
}

async function runHttpStep(req: NextRequest, supabase: any, step: StepRow, path: string, body?: Record<string, any>) {
  await addLog(supabase, step.run_id, step.id, 'info', `Appel ${path}`, body || {})
  const data = await callInternalApi(req, path, body)
  const counts = countFromResult(step.step_key, data)

  if (step.step_key === 'sirene_import' || step.step_key === 'sirene_cessation') {
    await finalizeSireneParams(supabase)
  }

  await finishStep(supabase, step, 'done', {
    ...counts,
    result_json: data || {},
  })

  await addLog(supabase, step.run_id, step.id, 'info', `Étape terminée : ${step.step_label}`, { counts, result: data })
}

function enrichmentPriority(row: any) {
  const status = String(row.enrichment_status || '').toLowerCase()
  if (!row.last_enrichment_at) return 10
  if (!status || status === 'a_faire') return 20
  if (status === 'erreur') return 30
  if (!row.telephone && !row.site_web && !row.google_maps_url) return 40
  return 100
}

async function buildEnrichmentQueue(supabase: any, run: any, step: StepRow) {
  const config = run.config_json || {}
  const limit = Math.max(1, Math.min(Number(config.enrichmentLimit || 1000), 10000))
  const selectionLimit = Math.min(limit * 3, 20000)

  const { data: rows, error } = await supabase
    .from('clients')
    .select('siret, enrichment_status, last_enrichment_at, telephone, email, site_web, google_maps_url, google_rating, google_user_ratings_total')
    .not('siret', 'is', null)
    .order('last_enrichment_at', { ascending: true, nullsFirst: true })
    .limit(selectionLimit)

  if (error) throw error

  const queueRows = (rows || [])
    .map((row: any) => ({ ...row, siret: String(row.siret || '').replace(/\D/g, '') }))
    .filter((row: any) => row.siret.length === 14)
    .map((row: any) => ({
      run_id: run.id,
      siret: row.siret,
      priority: enrichmentPriority(row),
      status: 'queued',
    }))
    .sort((a: any, b: any) => a.priority - b.priority)
    .slice(0, limit)

  if (queueRows.length > 0) {
    const { error: insertError } = await supabase
      .from('client_enrichment_queue')
      .upsert(queueRows, { onConflict: 'run_id,siret', ignoreDuplicates: true })

    if (insertError) throw insertError
  }

  await finishStep(supabase, step, 'done', {
    processed_count: rows?.length || 0,
    inserted_count: queueRows.length,
    result_json: { selected: queueRows.length, scanned: rows?.length || 0, limit },
  })

  await addLog(supabase, step.run_id, step.id, 'info', 'File enrichissement préparée.', { selected: queueRows.length, scanned: rows?.length || 0 })
}

async function runEnrichmentBatch(req: NextRequest, supabase: any, run: any, step: StepRow) {
  const config = run.config_json || {}
  const batchSize = Math.max(1, Math.min(Number(config.enrichmentBatchSize || 25), 100))

  const { data: queuedRows, error: queueError } = await supabase
    .from('client_enrichment_queue')
    .select('*')
    .eq('run_id', run.id)
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (queueError) throw queueError

  if (!queuedRows || queuedRows.length === 0) {
    const { count: errorCount } = await supabase
      .from('client_enrichment_queue')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .eq('status', 'error')

    const { count: doneCount } = await supabase
      .from('client_enrichment_queue')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run.id)
      .eq('status', 'done')

    await finishStep(supabase, step, errorCount && errorCount > 0 ? 'done' : 'done', {
      processed_count: Number(doneCount || 0) + Number(errorCount || 0),
      updated_count: Number(doneCount || 0),
      error_count: Number(errorCount || 0),
      result_json: { done: doneCount || 0, errors: errorCount || 0 },
    })

    await addLog(supabase, step.run_id, step.id, 'info', 'Enrichissement terminé.', { done: doneCount || 0, errors: errorCount || 0 })
    return
  }

  const ids = queuedRows.map((row: any) => row.id)
  await supabase
    .from('client_enrichment_queue')
    .update({ status: 'running', locked_at: new Date().toISOString() })
    .in('id', ids)

  let ok = 0
  let errors = 0

  for (const item of queuedRows) {
    try {
      const data = await callInternalApi(req, '/api/enrich-client', { siret: item.siret })
      await supabase
        .from('client_enrichment_queue')
        .update({
          status: 'done',
          attempts: Number(item.attempts || 0) + 1,
          processed_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', item.id)

      ok += 1
      await addLog(supabase, step.run_id, step.id, 'info', `Enrichissement OK ${item.siret}`, { result: data })
    } catch (error: any) {
      errors += 1
      await supabase
        .from('client_enrichment_queue')
        .update({
          status: 'error',
          attempts: Number(item.attempts || 0) + 1,
          processed_at: new Date().toISOString(),
          last_error: error?.message || String(error),
        })
        .eq('id', item.id)

      await addLog(supabase, step.run_id, step.id, 'error', `Enrichissement erreur ${item.siret}`, { error: error?.message || String(error) })
    }
  }

  await supabase
    .from('client_maintenance_steps')
    .update({
      processed_count: Number(step.processed_count || 0) + queuedRows.length,
      updated_count: Number(step.updated_count || 0) + ok,
      error_count: Number(step.error_count || 0) + errors,
      result_json: { last_batch_ok: ok, last_batch_errors: errors, batch_size: queuedRows.length },
    })
    .eq('id', step.id)

  await addLog(supabase, step.run_id, step.id, 'info', `Batch enrichissement traité : ${ok} OK / ${errors} erreurs.`, { ok, errors })
}

async function finalizeRunIfNeeded(supabase: any, run: any) {
  const { data: steps, error } = await supabase
    .from('client_maintenance_steps')
    .select('*')
    .eq('run_id', run.id)

  if (error) throw error

  const hasError = (steps || []).some((step: any) => step.status === 'error')
  const hasStepErrors = (steps || []).some((step: any) => Number(step.error_count || 0) > 0)
  const totalProcessed = (steps || []).reduce((sum: number, step: any) => sum + Number(step.processed_count || 0), 0)
  const totalErrors = (steps || []).reduce((sum: number, step: any) => sum + Number(step.error_count || 0), 0)

  await supabase
    .from('client_maintenance_runs')
    .update({
      status: hasError ? 'error' : hasStepErrors ? 'partial' : 'done',
      current_step: null,
      finished_at: new Date().toISOString(),
      message: hasError ? 'Maintenance terminée en erreur.' : hasStepErrors ? 'Maintenance terminée avec erreurs partielles.' : 'Maintenance clients terminée.',
      result_json: { totalProcessed, totalErrors },
    })
    .eq('id', run.id)

  await addLog(supabase, run.id, null, hasError ? 'error' : hasStepErrors ? 'warning' : 'info', 'Run finalisé.', { totalProcessed, totalErrors })
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ success: false, error: 'Non autorisé.' }, { status: 401 })
    }

    const supabase = createSupabaseAdmin()

    const { data: run, error: runError } = await supabase
      .from('client_maintenance_runs')
      .select('*')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return NextResponse.json({ success: true, message: 'Aucun run actif.' })

    if (run.status === 'queued') {
      await supabase
        .from('client_maintenance_runs')
        .update({ status: 'running', started_at: new Date().toISOString(), message: 'Maintenance clients démarrée.' })
        .eq('id', run.id)
      await addLog(supabase, run.id, null, 'info', 'Run démarré.')
    }

    const { data: runningStep, error: runningError } = await supabase
      .from('client_maintenance_steps')
      .select('*')
      .eq('run_id', run.id)
      .eq('status', 'running')
      .order('sort_order', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (runningError) throw runningError

    let step = runningStep as StepRow | null

    if (!step) {
      const { data: queuedStep, error: queuedError } = await supabase
        .from('client_maintenance_steps')
        .select('*')
        .eq('run_id', run.id)
        .eq('status', 'queued')
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (queuedError) throw queuedError

      step = queuedStep as StepRow | null
      if (!step) {
        await finalizeRunIfNeeded(supabase, run)
        return NextResponse.json({ success: true, run_id: run.id, finalized: true })
      }

      await startStep(supabase, step)
    }

    try {
      if (step.step_key === 'sirene_import') await runHttpStep(req, supabase, step, '/api/import-sirene')
      else if (step.step_key === 'sirene_cessation') await runHttpStep(req, supabase, step, '/api/import-sirene', { mode: 'cessation' })
      else if (step.step_key === 'rge_refresh') await runHttpStep(req, supabase, step, '/api/rge-refresh')
      else if (step.step_key === 'capacite_refresh') await runHttpStep(req, supabase, step, '/api/capacite')
      else if (step.step_key === 'enrichment_queue_build') await buildEnrichmentQueue(supabase, run, step)
      else if (step.step_key === 'enrichment_worker') await runEnrichmentBatch(req, supabase, run, step)
      else await finishStep(supabase, step, 'skipped', { error_message: `Étape inconnue : ${step.step_key}` })
    } catch (error: any) {
      await finishStep(supabase, step, 'error', {
        error_count: Number(step.error_count || 0) + 1,
        error_message: error?.message || String(error),
      })

      await supabase
        .from('client_maintenance_runs')
        .update({ status: 'error', error_message: error?.message || String(error), message: `Erreur étape : ${step.step_label}` })
        .eq('id', run.id)

      await addLog(supabase, run.id, step.id, 'error', `Erreur étape ${step.step_label}`, { error: error?.message || String(error) })
      throw error
    }

    return NextResponse.json({ success: true, run_id: run.id, step_key: step.step_key })
  } catch (error: any) {
    console.error('client-maintenance/worker error:', error)
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    )
  }
}
