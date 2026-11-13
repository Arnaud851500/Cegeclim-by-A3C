import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/server/supabaseAdmin'
import { SELECT_EXPORT, construireCsv, nomFichierExport, regrouperCommentaires } from '@/lib/hotlineCsv'

/**
 * Export CSV automatique des tickets hotline (13/11/2026, retours d'ergonomie).
 *
 * Appelé chaque jour par le cron Vercel (vercel.json). La périodicité est
 * réglée dans la console d'administration (/hotline/diagnostic › Paramètres,
 * hotline_parametres.export_auto_jours) : l'export n'est produit que si le
 * dernier date d'au moins N jours. Fichier déposé dans le bucket privé
 * « hotline-exports », listé dans hotline_exports (téléchargeable depuis les
 * paramètres). ?forcer=1 : export immédiat.
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
    const forcer = req.nextUrl.searchParams.get('forcer') === '1'
    const { data: param } = await db.from('hotline_parametres').select('valeur').eq('cle', 'export_auto_jours').maybeSingle()
    const jours = Number(param?.valeur) || 0
    if (!forcer && jours <= 0) return NextResponse.json({ ok: true, export: false, raison: 'Export automatique désactivé' })

    if (!forcer) {
      const { data: dernier } = await db.from('hotline_exports').select('cree_le').eq('mode', 'AUTO').order('cree_le', { ascending: false }).limit(1).maybeSingle()
      // Marge d'une heure : le cron quotidien ne glisse pas d'un jour à l'autre.
      if (dernier && Date.now() - new Date(dernier.cree_le).getTime() < jours * 86_400_000 - 3_600_000) {
        return NextResponse.json({ ok: true, export: false, raison: `Dernier export le ${dernier.cree_le}` })
      }
    }

    const tickets: Record<string, unknown>[] = []
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await db.from('hotline_tickets').select(SELECT_EXPORT).order('opened_at').range(debut, debut + 999)
      if (error) throw error
      tickets.push(...((data || []) as unknown as Record<string, unknown>[]))
      if (!data || data.length < 1000) break
    }
    const etapes: Array<{ ticket_id: string; at: string; auteur: string; type: string; libelle: string }> = []
    for (let debut = 0; ; debut += 1000) {
      const { data, error } = await db
        .from('hotline_ticket_etapes')
        .select('ticket_id, at, auteur, type, libelle')
        .in('type', ['NOTE_RAPIDE', 'COMMENTAIRE', 'RESOLUTION'])
        .order('at')
        .order('id')
        .range(debut, debut + 999)
      if (error) throw error
      etapes.push(...((data || []) as typeof etapes))
      if (!data || data.length < 1000) break
    }

    const csv = construireCsv(tickets, regrouperCommentaires(etapes))
    const chemin = `${new Date().getFullYear()}/${nomFichierExport()}`
    const { error: errUpload } = await db.storage.from('hotline-exports').upload(chemin, new Blob([csv], { type: 'text/csv;charset=utf-8' }), { upsert: true, contentType: 'text/csv; charset=utf-8' })
    if (errUpload) throw errUpload
    await db.from('hotline_exports').insert({ chemin, nb_tickets: tickets.length, mode: forcer ? 'MANUEL' : 'AUTO' })
    return NextResponse.json({ ok: true, export: true, chemin, tickets: tickets.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
