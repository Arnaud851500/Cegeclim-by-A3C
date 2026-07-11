import { NextRequest } from 'next/server'
import {
  createAdminClient,
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
  const traceId = resolveTraceId(req, 'STOCK-DATA')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'load_main_data',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)

    // Séquentiel volontairement : le rapport indique sans ambiguïté quelle vue échoue.
    const kpiResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_kpi',
        objectName: 'public.v_stock_projection_kpis',
        rowCount: (data) => (data ? 1 : 0),
      },
      () => admin.from('v_stock_projection_kpis').select('*').maybeSingle(),
    )

    const alertesResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_alertes',
        objectName: 'public.v_stock_projection_alertes_abc',
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () => admin.from('v_stock_projection_alertes_abc').select('*'),
    )

    const report = trace.reportSuccess()
    return diagnosticJson(
      {
        success: true,
        kpi: kpiResponse.data || null,
        alertes: alertesResponse.data || [],
      },
      report,
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le chargement des projections stock.')
  }
}
