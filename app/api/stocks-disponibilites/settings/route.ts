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
export const maxDuration = 120

type WeeklyAssumption = {
  periode_debut: string
  coefficient_prevision: number
  quantite_prevision_forcee: number | null
}

export async function POST(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-SET')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'save_settings',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)
    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '').trim()

    if (action === 'stock_security') {
      const referenceArticle = String(body?.reference_article || '').trim()
      if (!referenceArticle) {
        const error = { status: 400, code: 'REFERENCE_REQUIRED', message: 'La référence article est obligatoire.' }
        throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
      }

      const response: any = await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'save_stock_security',
          objectName: 'public.upsert_stock_article_stock_securite_fast',
          context: { reference_article: referenceArticle },
        },
        () =>
          admin.rpc('upsert_stock_article_stock_securite_fast', {
            p_reference_article: referenceArticle,
            p_designation: body?.designation ?? null,
            p_famille: body?.famille ?? null,
            p_macro_famille: body?.macro_famille ?? null,
            p_fournisseur_principal: body?.fournisseur_principal ?? null,
            p_stock_securite: Math.max(0, Number(body?.stock_securite || 0)),
          }),
      )

      return diagnosticJson(
        { success: true, result: response.data || null },
        trace.reportSuccess(),
      )
    }

    if (action === 'weekly_assumptions') {
      const referenceArticle = String(body?.reference_article || '').trim()
      const depot = String(body?.depot || 'GLOBAL').trim() || 'GLOBAL'
      const assumptions = Array.isArray(body?.assumptions)
        ? (body.assumptions as WeeklyAssumption[])
        : []

      if (!referenceArticle || !assumptions.length) {
        const error = {
          status: 400,
          code: 'ASSUMPTIONS_REQUIRED',
          message: 'La référence article et au moins une hypothèse hebdomadaire sont obligatoires.',
        }
        throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
      }

      const results: unknown[] = []
      for (const assumption of assumptions) {
        const periodeDebut = String(assumption?.periode_debut || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodeDebut)) {
          const error = {
            status: 400,
            code: 'INVALID_PERIOD',
            message: `Période hebdomadaire invalide : ${periodeDebut || 'vide'}.`,
          }
          throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
        }

        const rpcResponse: any = await trace.runStep(
          {
            layer: 'supabase_rpc',
            step: `save_week_${periodeDebut}`,
            objectName: 'public.upsert_stock_prevision_override_v2',
            context: { reference_article: referenceArticle, depot, periode_debut: periodeDebut },
          },
          () =>
            admin.rpc('upsert_stock_prevision_override_v2', {
              p_reference_article: referenceArticle,
              p_depot: depot,
              p_periode_debut: periodeDebut,
              p_coefficient_prevision: Math.max(0, Number(assumption.coefficient_prevision || 0)),
              p_quantite_prevision_forcee:
                assumption.quantite_prevision_forcee === null ||
                assumption.quantite_prevision_forcee === undefined
                  ? null
                  : Math.max(0, Number(assumption.quantite_prevision_forcee || 0)),
              p_commentaire: 'Hypothèse modifiée depuis écran Stocks & disponibilités',
            }),
        )
        results.push(rpcResponse.data || null)
      }

      return diagnosticJson(
        { success: true, updated_weeks: assumptions.length, results },
        trace.reportSuccess(),
      )
    }

    const error = { status: 400, code: 'UNKNOWN_ACTION', message: `Action inconnue : ${action || 'vide'}.` }
    throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant l’enregistrement des paramètres stock.')
  }
}
