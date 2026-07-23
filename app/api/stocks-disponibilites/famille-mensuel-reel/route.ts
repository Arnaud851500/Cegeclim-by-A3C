import { NextRequest } from 'next/server'
import {
  createAdminClient,
  DiagnosticError,
  DiagnosticTrace,
  diagnosticErrorJson,
  diagnosticJson,
  requireAuthenticatedUser,
  resolveTraceId,
} from '@/lib/server/diagnostics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Quantités BL réelles mois par mois (N et N-1), pour construire la partie
// "réel" du graphique de sorties mensuelles — la vue de projection ne
// couvre que les semaines futures, elle ne contient pas l'historique.

export async function GET(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-FAMILLE-MENSUEL-REEL')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'load_famille_mensuel_reel',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)

    const url = new URL(req.url)
    const famille = String(url.searchParams.get('famille') || '').trim()
    const annee = Number(url.searchParams.get('annee')) || new Date().getFullYear()

    if (!famille) {
      const error = { status: 400, code: 'FAMILLE_REQUIRED', message: 'La famille est obligatoire.' }
      throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
    }

    const response: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_flux_mensuel',
        objectName: 'public.indicateur_flux_articles_mensuel',
        context: { famille, annee },
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () =>
        admin
          .from('indicateur_flux_articles_mensuel')
          .select('annee,mois,reference_article,quantite,quantite_pertinente,hors_statistique')
          .eq('famille', famille)
          .eq('flux', 'BL')
          .in('annee', [annee, annee - 1])
          .eq('hors_statistique', false),
    )

    if (response.error) {
      throw new DiagnosticError(trace.reportFromUnknown(response.error, response.error.message), 500, response.error)
    }

    return diagnosticJson({ success: true, rows: response.data || [] }, trace.reportSuccess())
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le chargement des sorties mensuelles réelles.')
  }
}
