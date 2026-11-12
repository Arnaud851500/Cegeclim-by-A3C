import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { copierModeleHiParts } from '@/lib/server/hiparts'

/**
 * Copie immédiate d'un modèle Hi-Parts (12/11/2026) — appelée par la vue
 * éclatée de la console hotline (components/hotline/VueHiParts.tsx) quand le
 * modèle choisi n'est pas encore entièrement copié : ses vues éclatées et les
 * prix de ses pièces sont copiés tout de suite, sans attendre le cron.
 * POST /api/hiparts/modele { idgam } — session compagnon exigée (proxy.ts) et
 * droit hotline vérifié ici.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const db = createSupabaseAdmin()
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || ''
  const { data: u } = token ? await db.auth.getUser(token) : { data: { user: null } }
  const email = u.user?.email?.toLowerCase()
  if (!email) return NextResponse.json({ ok: false, error: 'Session requise' }, { status: 401 })
  const { data: acces } = await db.from('user_page_access').select('can_hotline, can_hotline_expert, can_autorisation').eq('email', email).maybeSingle()
  if (!acces || !(acces.can_hotline || acces.can_hotline_expert || acces.can_autorisation)) {
    return NextResponse.json({ ok: false, error: 'Accès hotline requis' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { idgam?: number }
  const idgam = Number(body.idgam)
  if (!Number.isInteger(idgam) || idgam <= 0) return NextResponse.json({ ok: false, error: 'idgam invalide' }, { status: 400 })

  try {
    const r = await copierModeleHiParts(db, idgam, { dureeMs: 45_000, parallelisme: 4 })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
