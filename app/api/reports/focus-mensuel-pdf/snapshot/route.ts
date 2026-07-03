import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

type SnapshotRequest = {
  payload?: any
  ttl_minutes?: number
}

type AuthorizedCaller = {
  mode: 'trusted_secret' | 'user_session'
  email?: string | null
}

function getRequiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function buildSupabaseAdmin() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL')
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

async function authorizeRequest(req: NextRequest, supabaseAdmin: SupabaseClient): Promise<AuthorizedCaller> {
  const trustedSecret = process.env.REPORT_PDF_RENDER_SECRET || process.env.INTERNAL_API_SECRET || ''
  const incomingSecret = req.headers.get('x-report-secret') || req.headers.get('x-internal-secret') || ''

  if (trustedSecret && incomingSecret && incomingSecret === trustedSecret) {
    return { mode: 'trusted_secret' }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (!token) {
    throw new Error('Unauthorized : token utilisateur absent.')
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    throw new Error(`Unauthorized : session utilisateur invalide${error?.message ? ` (${error.message})` : ''}.`)
  }

  return { mode: 'user_session', email: data.user.email }
}

function validateSnapshotPayload(payload: any) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload snapshot manquant ou invalide.')
  }

  if (payload.type !== 'focus_mensuel_comparison_snapshot') {
    throw new Error('Payload snapshot invalide : type inattendu.')
  }

  const requiredArrays = ['ytdRowsN', 'ytdRowsN1', 'rollingRowsN', 'rollingRowsN1']
  for (const key of requiredArrays) {
    if (!Array.isArray(payload[key])) {
      throw new Error(`Payload snapshot invalide : ${key} doit être un tableau.`)
    }
  }
}

export async function GET(req: NextRequest) {
  try {
    const debugSecret = req.nextUrl.searchParams.get('debug_secret') || req.nextUrl.searchParams.get('render_secret') || ''
    const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || ''

    if (!expectedSecret || debugSecret !== expectedSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized debug request.' }, { status: 401 })
    }

    return NextResponse.json({
      ok: true,
      route: '/api/reports/focus-mensuel-pdf/snapshot',
      role: 'create_focus_mensuel_pdf_snapshot_server_side',
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = buildSupabaseAdmin()
    const caller = await authorizeRequest(req, supabaseAdmin)
    const body = (await req.json()) as SnapshotRequest
    const payload = body.payload
    const ttlMinutes = Math.max(15, Math.min(Number(body.ttl_minutes || 240), 1440))

    validateSnapshotPayload(payload)

    const approxBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')

    const { data, error } = await supabaseAdmin
      .from('focus_mensuel_pdf_snapshots')
      .insert({
        payload,
        created_by_email: caller.email || null,
        expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      })
      .select('id, created_at, expires_at')
      .single()

    if (error) throw new Error(`Insertion snapshot PDF impossible : ${error.message}`)

    return NextResponse.json({
      ok: true,
      snapshot_id: data.id,
      created_at: data.created_at,
      expires_at: data.expires_at,
      approx_bytes: approxBytes,
      caller,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 })
  }
}
