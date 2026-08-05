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
//
// FIX CASCADE N-1 (2026-08) : la lecture directe de
// indicateur_flux_articles_mensuel filtrée par famille ne reflétait que
// l'historique propre à chaque référence. Pour une référence remplaçante,
// le N-1 doit inclure l'historique des références qu'elle a remplacées
// (en cascade sur plusieurs niveaux si besoin, pondéré par le pourcentage
// réellement transféré) — exactement comme la projection hebdomadaire
// (apply_stock_substitutions_to_run) et les stats YTD
// (v_stock_article_sorties_stats_cascade) le font déjà. On appelle donc la
// RPC get_stock_famille_mensuel_reel_cascade, qui fait ce travail côté base
// et renvoie les lignes déjà ré-attribuées à la référence active/finale.
// Le N (année en cours) n'est jamais cascadé : ces ventes sont déjà
// naturellement enregistrées sous la référence active.

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
        layer: 'supabase_rpc',
        step: 'read_flux_mensuel_cascade',
        objectName: 'public.get_stock_famille_mensuel_reel_cascade',
        context: { famille, annee },
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () =>
        admin.rpc('get_stock_famille_mensuel_reel_cascade', {
          p_famille: famille,
          p_annee: annee,
        }),
    )

    if (response.error) {
      throw new DiagnosticError(trace.reportFromUnknown(response.error, response.error.message), 500, response.error)
    }

    return diagnosticJson({ success: true, rows: response.data || [] }, trace.reportSuccess())
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le chargement des sorties mensuelles réelles.')
  }
}
