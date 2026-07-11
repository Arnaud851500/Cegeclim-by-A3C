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

export async function GET(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-CHECK')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'connection_diagnostic',
  })

  try {
    await trace.recordManual({
      layer: 'browser_to_vercel',
      step: 'route_reached',
      objectName: '/api/stocks-disponibilites/diagnostics',
      status: 'SUCCESS',
      context: { method: req.method },
    })

    await requireAuthenticatedUser(req, admin, trace)

    const tests: Record<string, unknown> = {}

    const pingResponse: any = await trace.runStep(
      {
        layer: 'supabase_rpc',
        step: 'postgres_ping',
        objectName: 'public.diagnostic_ping()',
      },
      () => admin.rpc('diagnostic_ping'),
    )
    tests.postgres_ping = pingResponse.data || null

    const kpiResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_kpi_probe',
        objectName: 'public.v_stock_projection_kpis',
        rowCount: (data) => (data ? 1 : 0),
      },
      () => admin.from('v_stock_projection_kpis').select('run_id,run_status,run_completed_at').maybeSingle(),
    )
    tests.kpi_probe = kpiResponse.data || null

    const alertResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_alertes_probe',
        objectName: 'public.v_stock_projection_alertes_abc',
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () => admin.from('v_stock_projection_alertes_abc').select('run_id,reference_article').limit(1),
    )
    tests.alertes_probe = alertResponse.data || []

    const report = trace.reportSuccess()
    return diagnosticJson({ success: true, tests }, report)
  } catch (error) {
    if (error instanceof DiagnosticError) {
      return diagnosticJson(
        {
          success: false,
          error: error.report.user_message,
          conclusion: diagnosticConclusion(error.report.category || ''),
        },
        error.report,
        error.httpStatus,
      )
    }
    return diagnosticErrorJson(error, trace, 'Le diagnostic de connexion n’a pas pu être terminé.')
  }
}

function diagnosticConclusion(category: string) {
  if (category === 'supabase_gateway_ssl' || category === 'network_transport') {
    return 'Infrastructure/réseau : ne pas modifier le SQL avant rétablissement du transport.'
  }
  if (category === 'postgres_timeout') {
    return 'PostgreSQL : analyser uniquement l’objet et l’étape indiqués dans le rapport.'
  }
  if (category === 'authentication' || category === 'authorization') {
    return 'Sécurité : corriger la session, les droits ou les politiques RLS.'
  }
  if (category === 'schema_object_missing') {
    return 'Schéma : vérifier la migration, le nom de l’objet et le cache PostgREST.'
  }
  return 'Erreur applicative : utiliser le trace_id et l’étape exacte avant toute correction.'
}
