
// app/api/reports/focus-mensuel-pdf/route.ts
// Crée un job PDF uniquement. Le worker /process fera le rendu.
// Le payload doit contenir pdf_cache_id ou cache_id.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

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

async function authorize(req: NextRequest, sb: ReturnType<typeof admin>) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) throw new Error('Unauthorized : token utilisateur manquant.')

  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user) throw new Error(`Unauthorized : session invalide${error?.message ? ` (${error.message})` : ''}.`)
  return data.user.email || null
}

export async function POST(req: NextRequest) {
  try {
    const sb = admin()
    const email = await authorize(req, sb)
    const payload = await req.json()

    const cacheId = payload.pdf_cache_id || payload.cache_id || payload.comparison_cache_id
    if (!cacheId) throw new Error('pdf_cache_id/cache_id manquant : le PDF doit utiliser le cache des tableaux déjà calculés.')

    const { data: cacheRun, error: cacheError } = await sb
      .from('focus_mensuel_pdf_cache_runs')
      .select('*')
      .eq('id', cacheId)
      .single()
    if (cacheError) throw new Error(`Cache PDF introuvable : ${cacheError.message}`)

    if (cacheRun.status !== 'ready') {
      throw new Error(`Cache PDF non prêt : ${cacheRun.status} (${(cacheRun.completed_tables || []).join(', ')})`)
    }

    const bucket = payload.bucket || 'commercial-imports'
    const path = payload.path || 'reports/focus-mensuel/Rapport_activite_quotidien.pdf'

    const finalPayload = {
      ...payload,
      pdf_cache_id: cacheId,
      cache_id: cacheId,
      bucket,
      path,
    }

    const { data, error } = await sb
      .from('report_pdf_jobs')
      .insert({
        report_type: 'focus_mensuel',
        status: 'pending',
        step: 'pending',
        bucket,
        path,
        payload: finalPayload,
        created_by_email: email,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true, job_id: data.id, job: data })
  } catch (error) {
    return NextResponse.json({ ok: false, error: errMsg(error) }, { status: 500 })
  }
}
