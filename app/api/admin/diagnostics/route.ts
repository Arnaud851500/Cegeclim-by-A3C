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
  const traceId = resolveTraceId(req, 'ADMIN-DIAG')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'admin-diagnostics',
    action: 'list_events',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)
    const url = new URL(req.url)
    const requestedTraceId = String(url.searchParams.get('target_trace_id') || '').trim()
    const status = String(url.searchParams.get('status') || '').trim().toUpperCase()
    const moduleName = String(url.searchParams.get('module') || '').trim()
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 200)))

    const response: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_diagnostic_events',
        objectName: 'public.app_diagnostic_events',
        context: { requested_trace_id: requestedTraceId || null, status: status || null, module: moduleName || null, limit },
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      async () => {
        let query = admin
          .from('app_diagnostic_events')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(limit)

        if (requestedTraceId) query = query.eq('trace_id', requestedTraceId)
        if (status) query = query.eq('status', status)
        if (moduleName) query = query.eq('module', moduleName)
        return query
      },
    )

    return diagnosticJson(
      { success: true, events: response.data || [] },
      trace.reportSuccess(),
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant la lecture des diagnostics.')
  }
}
