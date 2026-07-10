// app/api/stocks-disponibilites/rebuild/route.ts
// Recalcul serveur de la projection de stock par lots.
// V2 : après la construction des semaines, la règle
// "besoins fermes inclus dans la prévision" est appliquée par lots RPC séparés.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type JsonRecord = Record<string, any>

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function adminClient() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function toPositiveInteger(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function toPositiveNumber(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return n
}

function toIsoDate(value: unknown) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return new Date().toISOString().slice(0, 10)
}

function getString(value: unknown, fallback = '') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function parseRunId(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as JsonRecord
  return typeof record.run_id === 'string' ? record.run_id : null
}

function hasAlmostReachedServerLimit(startedAt: number) {
  return Date.now() - startedAt > 275_000
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  try {
    const supabase = adminClient()

    const authorization = req.headers.get('authorization') || ''
    const token = authorization.replace(/^Bearer\s+/i, '').trim()

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Non autorisé : session utilisateur absente.' },
        { status: 401 },
      )
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return NextResponse.json(
        { success: false, error: 'Non autorisé : session utilisateur invalide.' },
        { status: 401 },
      )
    }

    const body = await req.json().catch(() => ({}))

    const dateDebut = toIsoDate(body.date_debut)
    const nbSemaines = toPositiveInteger(body.nb_semaines, 16, 1, 104)
    const scenarioPct = toPositiveNumber(body.scenario_prevision_pct, 1.2)
    const depotMode =
      getString(body.depot_mode, 'GLOBAL').toUpperCase() === 'DEPOT' ? 'DEPOT' : 'GLOBAL'
    const commentaire = getString(
      body.commentaire,
      'Projection stock depuis route serveur par lots',
    )

    const projectionBatchSize = toPositiveInteger(body.batch_size, 100, 25, 300)
    const nettingBatchSize = toPositiveInteger(body.netting_batch_size, 50, 10, 150)

    const { data: startData, error: startError } = await supabase.rpc(
      'start_stock_projection_hebdo_front',
      {
        p_date_debut: dateDebut,
        p_nb_semaines: nbSemaines,
        p_scenario_prevision_pct: scenarioPct,
        p_depot_mode: depotMode,
        p_commentaire: commentaire,
        p_batch_size: projectionBatchSize,
      },
    )

    if (startError) {
      return NextResponse.json(
        {
          success: false,
          step: 'start',
          error: startError.message || 'Erreur Supabase au démarrage de la projection.',
          details: startError,
        },
        { status: 500 },
      )
    }

    const runId = parseRunId(startData)
    if (!runId) {
      return NextResponse.json(
        {
          success: false,
          step: 'start',
          error: 'Le démarrage de projection n’a pas retourné de run_id.',
          details: startData,
        },
        { status: 500 },
      )
    }

    const totalArticles = Number((startData as JsonRecord)?.total_articles || 0)
    const projectionBatches: JsonRecord[] = []

    for (let offset = 0; offset < totalArticles; offset += projectionBatchSize) {
      if (hasAlmostReachedServerLimit(startedAt)) {
        return NextResponse.json(
          {
            success: false,
            partial: true,
            step: 'projection_batch',
            run_id: runId,
            error:
              'Temps serveur presque atteint avant la fin du calcul. Réduis temporairement l’horizon ou le batch_size.',
            completed_batches: projectionBatches.length,
            total_articles: totalArticles,
            duration_ms: Date.now() - startedAt,
          },
          { status: 504 },
        )
      }

      const { data: batchData, error: batchError } = await supabase.rpc(
        'process_stock_projection_hebdo_batch',
        {
          p_run_id: runId,
          p_offset: offset,
          p_limit: projectionBatchSize,
        },
      )

      if (batchError) {
        return NextResponse.json(
          {
            success: false,
            step: 'projection_batch',
            run_id: runId,
            offset,
            batch_size: projectionBatchSize,
            error: batchError.message || 'Erreur Supabase pendant un lot de projection.',
            details: batchError,
            completed_batches: projectionBatches.length,
          },
          { status: 500 },
        )
      }

      projectionBatches.push((batchData || {}) as JsonRecord)
    }

    const { data: countData, error: countError } = await supabase.rpc(
      'count_stock_projection_references',
      { p_run_id: runId },
    )

    if (countError) {
      return NextResponse.json(
        {
          success: false,
          step: 'netting_count',
          run_id: runId,
          error:
            countError.message ||
            'Impossible de compter les références avant la normalisation des prévisions.',
          details: countError,
        },
        { status: 500 },
      )
    }

    const totalReferences = Number(countData || 0)
    const nettingBatches: JsonRecord[] = []

    for (let offset = 0; offset < totalReferences; offset += nettingBatchSize) {
      if (hasAlmostReachedServerLimit(startedAt)) {
        return NextResponse.json(
          {
            success: false,
            partial: true,
            step: 'netting_batch',
            run_id: runId,
            error:
              'Temps serveur presque atteint pendant la déduction des besoins fermes. Relance avec un netting_batch_size plus petit.',
            completed_projection_batches: projectionBatches.length,
            completed_netting_batches: nettingBatches.length,
            total_references: totalReferences,
            duration_ms: Date.now() - startedAt,
          },
          { status: 504 },
        )
      }

      const { data: nettingData, error: nettingError } = await supabase.rpc(
        'apply_stock_projection_fermes_incluses_batch',
        {
          p_run_id: runId,
          p_offset: offset,
          p_limit: nettingBatchSize,
        },
      )

      if (nettingError) {
        return NextResponse.json(
          {
            success: false,
            step: 'netting_batch',
            run_id: runId,
            offset,
            batch_size: nettingBatchSize,
            error:
              nettingError.message ||
              'Erreur Supabase pendant la déduction des besoins fermes.',
            details: nettingError,
            completed_netting_batches: nettingBatches.length,
          },
          { status: 500 },
        )
      }

      nettingBatches.push((nettingData || {}) as JsonRecord)
    }

    const { data: finalizeData, error: finalizeError } = await supabase.rpc(
      'finalize_stock_projection_hebdo_run',
      { p_run_id: runId },
    )

    if (finalizeError) {
      return NextResponse.json(
        {
          success: false,
          step: 'finalize',
          run_id: runId,
          error: finalizeError.message || 'Erreur Supabase pendant la finalisation.',
          details: finalizeError,
          completed_projection_batches: projectionBatches.length,
          completed_netting_batches: nettingBatches.length,
        },
        { status: 500 },
      )
    }

    const { data: statsCacheData, error: statsCacheError } = await supabase.rpc(
      'refresh_stock_article_sorties_stats_cache',
      { p_cache_date: new Date().toISOString().slice(0, 10) },
    )

    return NextResponse.json(
      {
        success: !statsCacheError,
        run_id: runId,
        start: startData,
        finalize: finalizeData,
        stats_cache: statsCacheData || null,
        stats_cache_warning: statsCacheError?.message || null,
        completed_projection_batches: projectionBatches.length,
        completed_netting_batches: nettingBatches.length,
        total_articles: totalArticles,
        total_references: totalReferences,
        projection_batch_size: projectionBatchSize,
        netting_batch_size: nettingBatchSize,
        duration_ms: Date.now() - startedAt,
      },
      { status: statsCacheError ? 207 : 200 },
    )
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Erreur serveur pendant le recalcul de projection.',
      },
      { status: 500 },
    )
  }
}
