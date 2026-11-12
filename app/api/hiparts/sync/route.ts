import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { passageHiParts } from '@/lib/server/hiparts'

/**
 * Aspiration du catalogue Hitachi Hi-Parts (12/11/2026) — voir lib/server/hiparts.ts
 * et supabase/migrations/20261112e_hiparts_catalogue.sql.
 *
 * Appelé par le cron Vercel toutes les 5 minutes (vercel.json) : dépile la file
 * hiparts_file pendant ~4 min. Première aspiration complète en quelques heures,
 * puis relance automatique tous les 7 jours.
 * Appel manuel : GET /api/hiparts/sync avec « Authorization: Bearer CRON_SECRET »
 * (?relancer=1 pour forcer une relance complète).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function autorise(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return process.env.NODE_ENV !== 'production'
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return bearer === cronSecret
}

export async function GET(req: NextRequest) {
  if (!autorise(req)) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })
  const db = createSupabaseAdmin()
  try {
    const resultat = await passageHiParts(db, {
      dureeMs: 230_000,
      parallelisme: 4,
      forcerRelance: req.nextUrl.searchParams.get('relancer') === '1',
    })
    return NextResponse.json({ ok: true, ...resultat })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.from('hiparts_sync_etat').update({ dernier_passage: new Date().toISOString(), dernier_message: `Erreur : ${message}` }).eq('id', 1)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
