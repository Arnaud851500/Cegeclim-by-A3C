// app/api/reports/focus-mensuel-pdf/route.ts
// Création et lecture de statut des jobs PDF Focus Mensuel.
// La génération est faite par /api/reports/focus-mensuel-pdf/process.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SupabaseAdmin = ReturnType<typeof admin>

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function admin() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

function errMsg(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function authorize(req: NextRequest, sb: SupabaseAdmin) {
  const trustedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
  const incomingSecret =
    req.headers.get('x-report-secret') ||
    req.headers.get('x-internal-secret') ||
    req.nextUrl.searchParams.get('secret') ||
    ''

  if (trustedSecret && incomingSecret && incomingSecret === trustedSecret) {
    return { mode: 'trusted_secret' as const, email: null as string | null }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''

  if (!token) throw new Error('Unauthorized : token utilisateur manquant.')

  const { data, error } = await sb.auth.getUser(token)

  if (error || !data.user) {
    throw new Error(`Unauthorized : session invalide${error?.message ? ` (${error.message})` : ''}.`)
  }

  return { mode: 'user_session' as const, email: data.user.email || null }
}

function sanitizeJob(row: any) {
  if (!row) return null

  return {
    id: row.id,
    report_type: row.report_type,
    status: row.status,
    step: row.step,
    bucket: row.bucket,
    path: row.path,
    filename: row.filename,
    bytes: row.bytes,
    error_message: row.error_message,
    created_at: row.created_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    updated_at: row.updated_at,
    payload: row.payload,
  }
}

async function readJsonPayload(req: NextRequest) {
  try {
    const text = await req.text()
    if (!text || !text.trim()) return {}
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    const str = String(value).trim()
    if (str) return str
  }
  return ''
}

async function resolvePdfCacheRun(req: NextRequest, sb: SupabaseAdmin, payload: any) {
  const explicitCacheId = firstNonEmpty(
    payload?.pdf_cache_id,
    payload?.cache_id,
    payload?.comparison_cache_id,
    payload?.report_cache_id,
    payload?.run_cache_id,
    req.nextUrl.searchParams.get('pdf_cache_id'),
    req.nextUrl.searchParams.get('cache_id'),
    req.nextUrl.searchParams.get('comparison_cache_id'),
    req.nextUrl.searchParams.get('report_cache_id'),
    req.nextUrl.searchParams.get('run_cache_id'),
    req.headers.get('x-pdf-cache-id'),
    req.headers.get('x-cache-id')
  )

  if (explicitCacheId) {
    const { data, error } = await sb
      .from('focus_mensuel_pdf_cache_runs')
      .select('*')
      .eq('id', explicitCacheId)
      .single()

    if (error || !data) {
      throw new Error(`Cache PDF introuvable pour id=${explicitCacheId} : ${error?.message || 'aucune ligne trouvée'}`)
    }

    if (data.status !== 'ready') {
      throw new Error(
        `Cache PDF non prêt pour id=${explicitCacheId} : ${data.status} (${(data.completed_tables || []).join(', ')})`
      )
    }

    return {
      cacheId: String(data.id),
      cacheRun: data,
      resolvedFrom: 'explicit_cache_id',
    }
  }

  const { data, error } = await sb
    .from('focus_mensuel_pdf_cache_runs')
    .select('*')
    .eq('status', 'ready')
    .order('id', { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(`Recherche du dernier cache PDF prêt impossible : ${error.message}`)
  }

  const latestReadyCache = Array.isArray(data) ? data[0] : null

  if (!latestReadyCache) {
    throw new Error(
      'pdf_cache_id/cache_id manquant et aucun cache PDF prêt trouvé : le PDF doit utiliser le cache des tableaux déjà calculés.'
    )
  }

  return {
    cacheId: String(latestReadyCache.id),
    cacheRun: latestReadyCache,
    resolvedFrom: 'latest_ready_cache',
  }
}

export async function GET(req: NextRequest) {
  try {
    const sb = admin()
    await authorize(req, sb)

    const jobId = Number(req.nextUrl.searchParams.get('job_id') || req.nextUrl.searchParams.get('id') || 0)

    let query = sb
      .from('report_pdf_jobs')
      .select('*')
      .eq('report_type', 'focus_mensuel')
      .order('id', { ascending: false })
      .limit(1)

    if (jobId > 0) {
      query = sb
        .from('report_pdf_jobs')
        .select('*')
        .eq('report_type', 'focus_mensuel')
        .eq('id', jobId)
        .limit(1)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const job = Array.isArray(data) ? data[0] : null

    if (!job) {
      return NextResponse.json({ ok: false, error: 'Job PDF introuvable.' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, job: sanitizeJob(job) })
  } catch (error) {
    return NextResponse.json({ ok: false, error: errMsg(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = admin()
    const caller = await authorize(req, sb)
    const payload = await readJsonPayload(req)

    const { cacheId, cacheRun, resolvedFrom } = await resolvePdfCacheRun(req, sb, payload)

    const bucket = payload.bucket || 'commercial-imports'
    const path = payload.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'
    const filename = payload.filename || "Rapport d'activité quotidien.pdf"

    const finalPayload = {
      ...payload,
      pdf_cache_id: cacheId,
      cache_id: cacheId,
      bucket,
      path,
      filename,
      created_from: 'focus_mensuel_front_cache_tables',
      cache_resolved_from: resolvedFrom,
      cache_status: cacheRun.status,
      cache_completed_tables: cacheRun.completed_tables || [],
    }

    const now = new Date().toISOString()

    const { data, error } = await sb
      .from('report_pdf_jobs')
      .insert({
        report_type: 'focus_mensuel',
        status: 'pending',
        step: 'created',
        bucket,
        path,
        filename,
        payload: finalPayload,
        created_by_email: caller.email,
        trace: [
          {
            at: now,
            step: 'created',
            cache_id: cacheId,
            cache_resolved_from: resolvedFrom,
            cache_status: cacheRun.status,
            completed_tables: cacheRun.completed_tables || [],
          },
        ],
        updated_at: now,
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({
      ok: true,
      job_id: data.id,
      status: data.status,
      step: data.step,
      path,
      bucket,
      filename,
      cache_id: cacheId,
      cache_resolved_from: resolvedFrom,
      job: sanitizeJob(data),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: errMsg(error) }, { status: 500 })
  }
}