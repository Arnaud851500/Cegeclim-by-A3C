// app/api/stocks-disponibilites/rebuild/route.ts
// Recalcul serveur de la projection de stock.
// Objectif : éviter que le navigateur / Supabase client coupe la requête pendant un calcul long.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

export async function POST(req: NextRequest) {
  try {
    const supabase = adminClient()

    const authorization = req.headers.get('authorization') || ''
    const token = authorization.replace(/^Bearer\s+/i, '').trim()

    if (!token) {
      return NextResponse.json({ success: false, error: 'Non autorisé : session utilisateur absente.' }, { status: 401 })
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token)
    if (userError || !userData?.user) {
      return NextResponse.json({ success: false, error: 'Non autorisé : session utilisateur invalide.' }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))

    const dateDebut = toIsoDate(body.date_debut)
    const nbSemaines = toPositiveInteger(body.nb_semaines, 16, 1, 104)
    const scenarioPct = toPositiveNumber(body.scenario_prevision_pct, 1.2)
    const depotMode = String(body.depot_mode || 'GLOBAL').toUpperCase() === 'DEPOT' ? 'DEPOT' : 'GLOBAL'
    const commentaire = String(body.commentaire || 'Projection stock depuis route serveur')

    const startedAt = Date.now()

    const { data, error } = await supabase.rpc('rebuild_stock_projection_hebdo_front', {
      p_date_debut: dateDebut,
      p_nb_semaines: nbSemaines,
      p_scenario_prevision_pct: scenarioPct,
      p_depot_mode: depotMode,
      p_commentaire: commentaire,
    })

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: error.message || 'Erreur Supabase pendant le recalcul de projection.',
          details: error,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      run_id: data,
      duration_ms: Date.now() - startedAt,
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Erreur serveur pendant le recalcul de projection.' },
      { status: 500 }
    )
  }
}
