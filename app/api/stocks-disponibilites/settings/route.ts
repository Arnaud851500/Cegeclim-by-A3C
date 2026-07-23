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
      const runId = String(body?.run_id || '').trim()
      const referenceArticle = String(body?.reference_article || '').trim()
      const depot = String(body?.depot || 'GLOBAL').trim() || 'GLOBAL'
      const assumptions = Array.isArray(body?.assumptions)
        ? (body.assumptions as WeeklyAssumption[])
        : []

      if (!runId || !referenceArticle || !assumptions.length) {
        const error = {
          status: 400,
          code: 'ASSUMPTIONS_REQUIRED',
          message: 'Le run, la référence article et au moins une hypothèse hebdomadaire sont obligatoires.',
        }
        throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
      }

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
      }

      const rpcResponse: any = await trace.runStep(
        {
          layer: 'supabase_rpc',
          step: 'save_assumptions_and_recalculate_article',
          objectName: 'public.save_stock_projection_article_assumptions_fast',
          runId,
          context: {
            reference_article: referenceArticle,
            depot,
            weeks: assumptions.length,
          },
          rowCount: (data) => {
            const projection = (data as { projection?: unknown[] } | null)?.projection
            return Array.isArray(projection) ? projection.length : null
          },
        },
        () =>
          admin.rpc('save_stock_projection_article_assumptions_fast', {
            p_run_id: runId,
            p_reference_article: referenceArticle,
            p_depot: depot,
            p_assumptions: assumptions,
            p_trace_id: traceId,
          }),
      )

      const result = (rpcResponse.data || {}) as Record<string, unknown>

      return diagnosticJson(
        {
          success: true,
          mode: 'single_article',
          updated_weeks: assumptions.length,
          result,
          projection: Array.isArray(result.projection) ? result.projection : [],
          article: result.article || null,
        },
        trace.reportSuccess(),
      )
    }

    if (action === 'weekly_assumptions_famille' || action === 'weekly_assumptions_famille_macro') {
      const isMacro = action === 'weekly_assumptions_famille_macro'
      const cle = String(body?.cle || '').trim() // valeur de famille OU famille_macro
      const depot = body?.depot ? String(body.depot).trim() : 'GLOBAL'
      const assumptions = Array.isArray(body?.assumptions)
        ? (body.assumptions as WeeklyAssumption[])
        : []

      if (!cle || !assumptions.length) {
        const error = {
          status: 400,
          code: 'ASSUMPTIONS_REQUIRED',
          message: `${isMacro ? 'La famille macro' : 'La famille'} et au moins une hypothèse hebdomadaire sont obligatoires.`,
        }
        throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
      }

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
      }

      const tableName = isMacro
        ? 'stock_prevision_overrides_famille_macro'
        : 'stock_prevision_overrides_famille'
      const keyColumn = isMacro ? 'famille_macro' : 'famille'

      const rows = assumptions.map((a) => ({
        [keyColumn]: cle,
        depot,
        periode_debut: a.periode_debut,
        coefficient_prevision: a.coefficient_prevision,
        quantite_prevision_forcee: a.quantite_prevision_forcee,
        updated_at: new Date().toISOString(),
      }))

      const upsertResponse: any = await trace.runStep(
        {
          layer: 'supabase_rest',
          step: 'upsert_family_assumptions',
          objectName: `public.${tableName}`,
          context: { [keyColumn]: cle, depot, weeks: assumptions.length },
        },
        () =>
          admin
            .from(tableName)
            .upsert(rows, { onConflict: `${keyColumn},depot,periode_debut` }),
      )

      if (upsertResponse.error) {
        throw new DiagnosticError(
          trace.reportFromUnknown(upsertResponse.error, upsertResponse.error.message),
          500,
          upsertResponse.error,
        )
      }

      return diagnosticJson(
        {
          success: true,
          mode: isMacro ? 'famille_macro' : 'famille',
          updated_weeks: assumptions.length,
          // Contrairement au niveau référence, il n'y a pas de recalcul
          // instantané ici : l'hypothèse s'applique à tous les articles de
          // la famille/famille macro au prochain "Recalculer toute la
          // projection". La cascade en temps réel est un chantier séparé
          // (moteur de recalcul multi-articles), pas encore construit.
          requires_full_rebuild: true,
        },
        trace.reportSuccess(),
      )
    }

    const error = { status: 400, code: 'UNKNOWN_ACTION', message: `Action inconnue : ${action || 'vide'}.` }
    throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant l’enregistrement des paramètres stock.')
  }
}