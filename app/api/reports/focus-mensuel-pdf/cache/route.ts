
// app/api/reports/focus-mensuel-pdf/cache/route.ts
// Route serveur unique pour créer un cache PDF et sauvegarder les tableaux un par un.
// Avantage : pas de gros snapshot monolithique, pas de recalcul PDF, pas de requête > 60s.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

function supabaseAdmin() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function authorize(req: NextRequest, admin: ReturnType<typeof supabaseAdmin>) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) throw new Error('Unauthorized : token utilisateur manquant.')

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new Error(`Unauthorized : session invalide${error?.message ? ` (${error.message})` : ''}.`)
  return data.user.email || null
}

export async function POST(req: NextRequest) {
  try {
    const admin = supabaseAdmin()
    const email = await authorize(req, admin)
    const body = await req.json()

    // action=create : crée un cache run vide
    if (body.action === 'create') {
      const { data, error } = await admin
        .from('focus_mensuel_pdf_cache_runs')
        .insert({
          report_type: 'focus_mensuel',
          status: 'open',
          month: body.month || null,
          focus_date: body.focus_date || body.focusDate || null,
          view_mode: body.view || body.view_mode || 'montant_ht',
          agence: body.agence || null,
          famille_macro: body.famille_macro || body.familleMacro || null,
          collaborateur: body.collaborateur || null,
          include_hors_statistiques: body.include_hors_statistiques ?? body.includeHorsStatistiques ?? true,
          ca_projete_factures: body.ca_projete_factures ?? body.caProjeteFactures ?? true,
          expected_tables: body.expected_tables || ['activity_agency_ytd', 'activity_family_ytd', 'activity_rolling_12'],
          created_by_email: email,
          expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        })
        .select('*')
        .single()

      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, cache_id: data.id, cache: data })
    }

    // action=table : sauvegarde une table déjà calculée côté front
    if (body.action === 'table') {
      if (!body.cache_id) throw new Error('cache_id manquant.')
      if (!body.table_key) throw new Error('table_key manquant.')
      const rows = Array.isArray(body.rows) ? body.rows : []

      const { data, error } = await admin.rpc('mark_focus_mensuel_pdf_cache_table', {
        p_cache_id: body.cache_id,
        p_table_key: body.table_key,
        p_rows: rows,
        p_meta: body.meta || {},
      })

      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, cache: data })
    }

    throw new Error(`Action inconnue : ${body.action || '—'}`)
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const admin = supabaseAdmin()
    const cacheId = req.nextUrl.searchParams.get('cache_id')
    const renderSecret = req.nextUrl.searchParams.get('render_secret') || ''
    const expectedSecret = process.env.REPORT_PDF_RENDER_SECRET || ''

    // Le GET sert surtout à /focus_mensuel_print ; il est sécurisé par render_secret.
    if (!cacheId) throw new Error('cache_id manquant.')
    if (!expectedSecret || renderSecret !== expectedSecret) {
      throw new Error('Unauthorized : render_secret invalide.')
    }

    const { data, error } = await admin.rpc('get_focus_mensuel_pdf_cache_payload', {
      p_cache_id: cacheId,
    })

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, payload: data })
  } catch (error) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 })
  }
}
