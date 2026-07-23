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
export const maxDuration = 60

// Variante de /detail à l'échelle d'une famille (ou famille macro) entière :
// retourne les lignes hebdomadaires brutes de v_stock_projection_hebdo_latest
// pour tous les articles concernés. L'agrégation (sommes par semaine) est
// faite côté client, pas ici — même logique de calcul que le reste de
// l'écran, pas de nouveau moteur.

export async function GET(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-FAMILLE-DETAIL')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'load_famille_detail',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)

    const url = new URL(req.url)
    const famille = String(url.searchParams.get('famille') || '').trim()
    const macroFamille = String(url.searchParams.get('macro_famille') || '').trim()
    const depot = String(url.searchParams.get('depot') || 'GLOBAL').trim() || 'GLOBAL'

    if (!famille && !macroFamille) {
      const error = {
        status: 400,
        code: 'FAMILLE_REQUIRED',
        message: 'La famille ou la famille macro est obligatoire.',
      }
      throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
    }

    let query = admin
      .from('v_stock_projection_hebdo_latest')
      .select(
        'run_id,reference_article,famille,macro_famille,depot,periode_debut,periode_fin,' +
          'stock_projete,stock_disponible_projete,quantite_manquante,niveau_alerte,' +
          'prevision_ventes,prevision_base_n1,besoins_clients_fermes,commandes_fournisseurs_attendues,' +
          'ca_client_risque',
      )
      .eq('depot', depot)
      .order('periode_debut', { ascending: true })

    query = famille ? query.eq('famille', famille) : query.eq('macro_famille', macroFamille)

    const response: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_famille_projection',
        objectName: 'public.v_stock_projection_hebdo_latest',
        context: { famille, macro_famille: macroFamille, depot },
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () => query,
    )

    if (response.error) {
      throw new DiagnosticError(trace.reportFromUnknown(response.error, response.error.message), 500, response.error)
    }

    return diagnosticJson(
      { success: true, rows: response.data || [] },
      trace.reportSuccess(),
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le chargement du détail famille.')
  }
}
