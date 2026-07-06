import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  // On garde le comportement souple pour le local,
  // mais en production la variable doit exister.
  if (!secret) return true

  const headerSecret = req.headers.get('x-client-maintenance-secret')
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  return headerSecret === secret || bearer === secret
}

async function addLog(
  supabase: any,
  runId: string,
  stepId: string | null,
  level: 'info' | 'warning' | 'error',
  message: string,
  payload: Record<string, any> = {}
) {
  await supabase.from('client_maintenance_logs').insert({
    run_id: runId,
    step_id: stepId,
    level,
    message,
    payload_json: payload,
  })
}

async function startStep(supabase: any, step: StepRow) {
  const now = new Date().toISOString()

  await supabase
    .from('client_maintenance_steps')
    .update({
      status: 'running',
      started_at: now,
      error_message: null,
    })
    .eq('id', step.id)

  await supabase
    .from('client_maintenance_runs')
    .update({
      status: 'running',
      started_at: now,
      current_step: step.step_label,
      message: `Étape en cours : ${step.step_label}`,
    })
    .eq('id', step.run_id)
}

async function finishStep(
  supabase: any,
  step: StepRow,
  status: 'done' | 'error' | 'skipped',
  patch: Record<string, any> = {}
) {
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
      rejected_count:
        Number(data?.rejected_total ?? data?.rejected_by_filter ?? 0) || 0,
      error_count: 0,
    }
  }

  if (stepKey === 'sirene_cessation') {
    return {
      processed_count:
        Number(data?.closed_candidates ?? data?.fetched ?? 0) || 0,
      inserted_count: 0,
      updated_count:
        Number(data?.deleted_from_clients ?? 0) +
        Number(data?.cegeclim_marked_closed ?? data?.cegeclim_alerts_updated ?? 0),
      rejected_count:
        Number(data?.rejected_total ?? data?.rejected_by_filter ?? 0) || 0,
      error_count: 0,
    }
  }

  // Correction importante :
  // /api/rge-refresh renvoie nb_rows_source, nb_rows_imported, nb_rows_updated
  // et non stats.sourceRows / stats.cacheInserted.
  if (stepKey === 'rge_refresh') {
    const stats = data?.stats || {}

    return {
      processed_count:
        Number(data?.nb_rows_source ?? stats.sourceRows ?? stats.source_rows ?? 0) || 0,

      inserted_count:
        Number(
          data?.nb_rows_imported ??
            stats.cacheInserted ??
            stats.cache_inserted ??
            stats.imported ??
            0
        ) || 0,

      updated_count:
        Number(
          data?.nb_rows_updated ??
            stats.clientsUpdated ??
            stats.cacheUpdated ??
            stats.clients_updated ??
            stats.cache_updated ??
            0
        ) || 0,

      rejected_count:
        Number(data?.nb_rows_rejected ?? stats.rejected ?? stats.rejectedRows ?? 0) || 0,

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

async function callInternalApi(
  req: NextRequest,
  path: string,
  body?: Record<string, any>
) {
  const url = new URL(path, req.nextUrl.origin)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-maintenance-secret': process.env.CLIENT_MAINTENANCE_SECRET || '',
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })

  const text = await res.text()

  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }

  if (!res.ok || data?.success === false) {
    throw new Error(
      data?.error || data?.message || text || `Erreur API ${path}`
    )
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
      date_modification_min: today,
      date_modification_max: null,
      last_import_at: today,
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.id)
}

async function shouldFinalizeSireneParams(supabase: any, step: StepRow) {
  if (step.step_key === 'sirene_cessation') {
    return true
  }

  if (step.step_key !== 'sirene_import') {
    return false
  }

  // Si les cessations sont dans le même run, on ne finalise pas encore les paramètres.
  // Sinon, la seconde étape repart avec les dates du jour au lieu de la fenêtre testée.
  const { data, error } = await supabase
    .from('client_maintenance_steps')
    .select('id')
    .eq('run_id', step.run_id)
    .eq('step_key', 'sirene_cessation')
    .in('status', ['queued', 'running'])
    .limit(1)
    .maybeSingle()

  if (error) throw error

  return !data?.id
}

async function runHttpStep(
  req: NextRequest,
  supabase: any,
  step: StepRow,
  path: string,
  body?: Record<string, any>
) {
  await addLog(supabase, step.run_id, step.id, 'info', `Appel ${path}`, body || {})

  const data = await callInternalApi(req, path, body)
  const counts = countFromResult(step.step_key, data)

  const accumulatedCounts = {
    processed_count: Number(step.processed_count || 0) + Number(counts.processed_count || 0),
    inserted_count: Number(step.inserted_count || 0) + Number(counts.inserted_count || 0),
    updated_count: Number(step.updated_count || 0) + Number(counts.updated_count || 0),
    rejected_count: Number(step.rejected_count || 0) + Number(counts.rejected_count || 0),
    error_count: Number(step.error_count || 0) + Number(counts.error_count || 0),
  }

  // SIRENE peut répondre partial=true quand le lot est volontairement interrompu
  // pour éviter un timeout Vercel. Dans ce cas, on garde l'étape en running.
  // Le prochain appel worker reprendra la même étape avec le curseur Supabase.
  if (data?.partial === true && data?.done !== true) {
    await supabase
      .from('client_maintenance_steps')
      .update({
        ...accumulatedCounts,
        status: 'running',
        result_json: data || {},
        error_message: null,
      })
      .eq('id', step.id)

    await supabase
      .from('client_maintenance_runs')
      .update({
        status: 'running',
        current_step: step.step_label,
        message: `Étape partielle : ${step.step_label}. Reprise au prochain appel worker.`,
        error_message: null,
      })
      .eq('id', step.run_id)

    await addLog(
      supabase,
      step.run_id,
      step.id,
      'info',
      `Étape partielle : ${step.step_label}`,
      { counts, accumulatedCounts, result: data }
    )

    return {
      partial: true,
      counts: accumulatedCounts,
      result: data,
    }
  }

  if (await shouldFinalizeSireneParams(supabase, step)) {
    await finalizeSireneParams(supabase)
  }

  await finishStep(supabase, step, 'done', {
    ...accumulatedCounts,
    result_json: data || {},
  })

  await addLog(
    supabase,
    step.run_id,
    step.id,
    'info',
    `Étape terminée : ${step.step_label}`,
    { counts, accumulatedCounts, result: data }
  )

  return {
    partial: false,
    counts: accumulatedCounts,
    result: data,
  }
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
    .select(
      'siret, enrichment_status, last_enrichment_at, telephone, email, site_web, google_maps_url, google_rating, google_user_ratings_total'
    )
    .not('siret', 'is', null)
    .order('last_enrichment_at', { ascending: true, nullsFirst: true })
    .limit(selectionLimit)

  if (error) throw error

  const queueRows = (rows || [])
    .map((row: any) => ({
      ...row,
      siret: String(row.siret || '').replace(/\D/g, ''),
    }))
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
      .upsert(queueRows, {
        onConflict: 'run_id,siret',
        ignoreDuplicates: true,
      })

    if (insertError) throw insertError
  }

  await finishStep(supabase, step, 'done', {
    processed_count: rows?.length || 0,
    inserted_count: queueRows.length,
    result_json: {
      selected: queueRows.length,
      scanned: rows?.length || 0,
      limit,
    },
  })

  await addLog(
    supabase,
    step.run_id,
    step.id,
    'info',
    'File enrichissement préparée.',
    {
      selected: queueRows.length,
      scanned: rows?.length || 0,
    }
  )
}

async function runEnrichmentBatch(
  req: NextRequest,
  supabase: any,
  run: any,
  step: StepRow
) {
  const config = run.config_json || {}

  const batchSize = Math.max(
    1,
    Math.min(Number(config.enrichmentBatchSize || 50), 100)
  )

  // Nombre maximum de batchs traités dans UN appel worker.
  // Exemple : 10 batchs x 25 clients = 250 clients par appel worker.
  const maxBatchesPerWorker = Math.max(
    1,
    Math.min(Number(config.enrichmentMaxBatchesPerWorker || 50), 50)
  )

  // Garde-fou temps pour éviter les timeouts Vercel.
  // 240s = 4 min, compatible avec maxDuration 300.
  const maxRuntimeMs = Math.max(
    30_000,
    Math.min(Number(config.enrichmentMaxRuntimeMs || 240_000), 280_000)
  )

  const startedAt = Date.now()

  let totalOk = 0
  let totalErrors = 0
  let totalProcessed = 0
  let batchesDone = 0

  while (batchesDone < maxBatchesPerWorker) {
    if (Date.now() - startedAt > maxRuntimeMs) {
      await addLog(
        supabase,
        step.run_id,
        step.id,
        'warning',
        'Arrêt temporaire enrichissement : limite de temps worker atteinte.',
        {
          batchesDone,
          totalOk,
          totalErrors,
          totalProcessed,
          maxRuntimeMs,
        }
      )
      break
    }

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

      await finishStep(supabase, step, 'done', {
        processed_count: Number(doneCount || 0) + Number(errorCount || 0),
        updated_count: Number(doneCount || 0),
        error_count: Number(errorCount || 0),
        result_json: {
          done: doneCount || 0,
          errors: errorCount || 0,
          batches_done_last_worker: batchesDone,
          completed: true,
        },
      })

      await addLog(
        supabase,
        step.run_id,
        step.id,
        'info',
        'Enrichissement terminé.',
        {
          done: doneCount || 0,
          errors: errorCount || 0,
          batchesDone,
        }
      )

      return
    }

    const ids = queuedRows.map((row: any) => row.id)

    await supabase
      .from('client_enrichment_queue')
      .update({
        status: 'running',
        locked_at: new Date().toISOString(),
      })
      .in('id', ids)

    let ok = 0
    let errors = 0

    for (const item of queuedRows) {
      try {
        const data = await callInternalApi(req, '/api/enrich-client', {
          siret: item.siret,
        })

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

        await addLog(
          supabase,
          step.run_id,
          step.id,
          'info',
          `Enrichissement OK ${item.siret}`,
          { result: data }
        )
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

        await addLog(
          supabase,
          step.run_id,
          step.id,
          'error',
          `Enrichissement erreur ${item.siret}`,
          { error: error?.message || String(error) }
        )
      }
    }

    batchesDone += 1
    totalOk += ok
    totalErrors += errors
    totalProcessed += queuedRows.length

    await supabase
      .from('client_maintenance_steps')
      .update({
        processed_count: Number(step.processed_count || 0) + totalProcessed,
        updated_count: Number(step.updated_count || 0) + totalOk,
        error_count: Number(step.error_count || 0) + totalErrors,
        result_json: {
          last_batch_ok: ok,
          last_batch_errors: errors,
          last_batch_size: queuedRows.length,
          batches_done_last_worker: batchesDone,
          total_ok_last_worker: totalOk,
          total_errors_last_worker: totalErrors,
          total_processed_last_worker: totalProcessed,
          completed: false,
        },
      })
      .eq('id', step.id)

    await addLog(
      supabase,
      step.run_id,
      step.id,
      'info',
      `Batch enrichissement traité : ${ok} OK / ${errors} erreurs.`,
      {
        batchNumber: batchesDone,
        batchSize: queuedRows.length,
        ok,
        errors,
        totalOk,
        totalErrors,
        totalProcessed,
      }
    )
  }

  await addLog(
    supabase,
    step.run_id,
    step.id,
    'info',
    'Enrichissement partiel : reprise au prochain appel worker.',
    {
      batchesDone,
      totalOk,
      totalErrors,
      totalProcessed,
    }
  )
}

async function finalizeRunIfNeeded(supabase: any, run: any) {
  const { data: steps, error } = await supabase
    .from('client_maintenance_steps')
    .select('*')
    .eq('run_id', run.id)

  if (error) throw error

  const hasError = (steps || []).some((step: any) => step.status === 'error')
  const hasStepErrors = (steps || []).some(
    (step: any) => Number(step.error_count || 0) > 0
  )

  const totalProcessed = (steps || []).reduce(
    (sum: number, step: any) => sum + Number(step.processed_count || 0),
    0
  )

  const totalErrors = (steps || []).reduce(
    (sum: number, step: any) => sum + Number(step.error_count || 0),
    0
  )

  // Une étape en erreur ne doit plus faire tomber tout le run en "error".
  // Le pipeline continue, puis le run est finalisé en "partial".
  const finalStatus = hasError || hasStepErrors ? 'partial' : 'done'

  await supabase
    .from('client_maintenance_runs')
    .update({
      status: finalStatus,
      current_step: null,
      finished_at: new Date().toISOString(),
      message:
        hasError || hasStepErrors
          ? 'Maintenance terminée avec erreurs partielles.'
          : 'Maintenance clients terminée.',
      result_json: {
        totalProcessed,
        totalErrors,
      },
    })
    .eq('id', run.id)

  await addLog(
    supabase,
    run.id,
    null,
    hasError || hasStepErrors ? 'warning' : 'info',
    'Run finalisé.',
    {
      totalProcessed,
      totalErrors,
      finalStatus,
    }
  )
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Non autorisé.',
        },
        { status: 401 }
      )
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

    if (!run) {
      return NextResponse.json({
        success: true,
        message: 'Aucun run actif.',
        nothing_to_do: true,
      })
    }

    if (run.status === 'queued') {
      await supabase
        .from('client_maintenance_runs')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          message: 'Maintenance clients démarrée.',
        })
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

        return NextResponse.json({
          success: true,
          run_id: run.id,
          finalized: true,
          message: 'Run finalisé.',
        })
      }

      await startStep(supabase, step)
    }

    try {
      if (step.step_key === 'sirene_import') {
        await runHttpStep(req, supabase, step, '/api/import-sirene', {
          run_id: run.id,
        })
      } else if (step.step_key === 'sirene_cessation') {
        await runHttpStep(req, supabase, step, '/api/import-sirene', {
          mode: 'cessation',
          run_id: run.id,
        })
      } else if (step.step_key === 'rge_refresh') {
        await runHttpStep(req, supabase, step, '/api/rge-refresh')
      } else if (step.step_key === 'capacite_refresh') {
        await runHttpStep(req, supabase, step, '/api/capacite')
      } else if (step.step_key === 'enrichment_queue_build') {
        await buildEnrichmentQueue(supabase, run, step)
      } else if (step.step_key === 'enrichment_worker') {
        await runEnrichmentBatch(req, supabase, run, step)
      } else {
        await finishStep(supabase, step, 'skipped', {
          error_message: `Étape inconnue : ${step.step_key}`,
        })

        await addLog(
          supabase,
          run.id,
          step.id,
          'warning',
          `Étape inconnue ignorée : ${step.step_key}`
        )
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error)

      // Important : une erreur sur une étape ne bloque plus le pipeline complet.
      // L'étape est marquée en erreur, mais le run reste "running" pour permettre
      // au prochain appel worker de passer à l'étape suivante.
      await finishStep(supabase, step, 'error', {
        error_count: Number(step.error_count || 0) + 1,
        error_message: errorMessage,
        result_json: {
          success: false,
          error: errorMessage,
          continued: true,
        },
      })

      await supabase
        .from('client_maintenance_runs')
        .update({
          status: 'running',
          error_message: null,
          message: `Erreur non bloquante étape : ${step.step_label}. Passage à l'étape suivante.`,
          current_step: null,
        })
        .eq('id', run.id)

      await addLog(
        supabase,
        run.id,
        step.id,
        'error',
        `Erreur non bloquante étape ${step.step_label}`,
        {
          error: errorMessage,
          continued: true,
        }
      )

      return NextResponse.json({
        success: true,
        run_id: run.id,
        step_key: step.step_key,
        step_label: step.step_label,
        step_error: true,
        continued: true,
        error: errorMessage,
      })
    }

    return NextResponse.json({
      success: true,
      run_id: run.id,
      step_key: step.step_key,
      step_label: step.step_label,
    })
  } catch (error: any) {
    console.error('client-maintenance/worker error:', error)

    return NextResponse.json(
      {
        success: false,
        error: error?.message || String(error),
      },
      { status: 500 }
    )
  }
}
