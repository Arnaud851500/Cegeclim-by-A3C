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

// Recalcul PAR PÉRIMÈTRE (famille ou famille macro), pas global.
// Contrairement à /rebuild (qui retraite tous les articles avec le même
// scénario % par défaut), cette route :
//   1) ne touche qu'aux articles de la famille/famille macro choisie
//   2) résout pour CHAQUE article son propre coefficient (référence >
//      famille > famille macro > scénario par défaut), au lieu d'écraser
//      tout le monde avec le même pourcentage
//   3) réutilise save_stock_projection_article_assumptions_fast, la même
//      primitive déjà utilisée pour l'édition d'un seul article — aucune
//      nouvelle logique de calcul, juste une orchestration par lot.

type ScopeBody = {
  run_id?: string
  scope?: 'famille' | 'famille_macro'
  cle?: string
  depot?: string
  scenario_prevision_pct?: number
}

export async function POST(req: NextRequest) {
  const traceId = resolveTraceId(req, 'STOCK-RECALC-SCOPE')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'recalculer_scope',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)
    const body = (await req.json().catch(() => ({}))) as ScopeBody

    const runId = String(body.run_id || '').trim()
    const scope = body.scope === 'famille_macro' ? 'famille_macro' : 'famille'
    const cle = String(body.cle || '').trim()
    const depot = String(body.depot || 'GLOBAL').trim() || 'GLOBAL'
    const scenarioPct = Number(body.scenario_prevision_pct) > 0 ? Number(body.scenario_prevision_pct) : 1.2

    if (!runId || !cle) {
      const error = { status: 400, code: 'PARAMS_REQUIRED', message: 'run_id et la famille/famille macro sont obligatoires.' }
      throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
    }

    // 1) Articles du périmètre + toutes leurs périodes hebdomadaires du run courant.
    const scopeColumn = scope === 'famille_macro' ? 'macro_famille' : 'famille'
    const rowsResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'list_scope_articles',
        objectName: 'public.stock_projection_articles',
        context: { scope, cle, depot },
      },
      () =>
        admin
          .from('stock_projection_articles')
          .select('reference_article,famille,macro_famille,periode_debut')
          .eq('run_id', runId)
          .eq('depot', depot)
          .eq(scopeColumn, cle),
    )
    if (rowsResponse.error) {
      throw new DiagnosticError(trace.reportFromUnknown(rowsResponse.error, rowsResponse.error.message), 500, rowsResponse.error)
    }

    const rows = (rowsResponse.data || []) as Array<{
      reference_article: string
      famille: string | null
      macro_famille: string | null
      periode_debut: string
    }>

    const byArticle = new Map<string, { famille: string | null; macro_famille: string | null; periodes: string[] }>()
    rows.forEach((r) => {
      const entry = byArticle.get(r.reference_article) || { famille: r.famille, macro_famille: r.macro_famille, periodes: [] }
      entry.periodes.push(r.periode_debut)
      byArticle.set(r.reference_article, entry)
    })

    const references = Array.from(byArticle.keys())
    if (references.length === 0) {
      return diagnosticJson(
        { success: true, articles_traites: 0, message: 'Aucun article trouvé sur ce périmètre.' },
        trace.reportSuccess(),
      )
    }

    // 2) Nettoyage : les réglages au niveau référence priment sur la famille
    // par construction (cascade référence > famille > famille macro). S'ils
    // existent déjà pour ces articles (anciens réglages, valeurs par défaut
    // historiques...), ils bloquent silencieusement le changement demandé
    // ici. Un recalcul explicite par périmètre famille/famille macro doit
    // vraiment s'appliquer : on efface donc les overrides référence en
    // conflit sur les semaines concernées avant de résoudre et recalculer.
    const clearResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'clear_conflicting_reference_overrides',
        objectName: 'public.stock_article_prevision_overrides',
        context: { scope, cle, depot, nb_articles: references.length },
      },
      () =>
        admin
          .from('stock_article_prevision_overrides')
          .delete()
          .eq('depot', depot)
          .in('reference_article', references)
          .in('periode_debut', Array.from(new Set(rows.map((r) => r.periode_debut)))),
    )
    if (clearResponse.error) {
      throw new DiagnosticError(trace.reportFromUnknown(clearResponse.error, clearResponse.error.message), 500, clearResponse.error)
    }

    // 3) Pour chaque article, résout son coefficient propre puis relance
    // son recalcul individuel — par lots pour rester dans le temps imparti.
    let traites = 0
    const erreurs: Array<{ reference_article: string; message: string }> = []
    const CONCURRENCY = 6

    for (let i = 0; i < references.length; i += CONCURRENCY) {
      const batch = references.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (reference) => {
          const info = byArticle.get(reference)!
          try {
            const assumptions = await Promise.all(
              info.periodes.map(async (periode) => {
                const coefResponse: any = await admin.rpc('resolve_forecast_coefficient', {
                  p_reference_article: reference,
                  p_famille: info.famille,
                  p_famille_macro: info.macro_famille,
                  p_depot: depot,
                  p_periode_debut: periode,
                })
                const resolved = coefResponse.data !== null && coefResponse.data !== undefined ? Number(coefResponse.data) : null
                return {
                  periode_debut: periode,
                  coefficient_prevision: resolved ?? scenarioPct,
                  quantite_prevision_forcee: null,
                }
              }),
            )

            const saveResponse: any = await admin.rpc('save_stock_projection_article_assumptions_fast', {
              p_run_id: runId,
              p_reference_article: reference,
              p_depot: depot,
              p_assumptions: assumptions,
              p_trace_id: traceId,
            })
            if (saveResponse.error) throw new Error(saveResponse.error.message)
            traites += 1
          } catch (e) {
            erreurs.push({ reference_article: reference, message: e instanceof Error ? e.message : String(e) })
          }
        }),
      )
    }

    const report = trace.reportSuccess()
    if (erreurs.length) {
      report.status = 'WARNING'
      report.user_message = `${traites} article(s) recalculé(s), ${erreurs.length} en erreur.`
    }

    return diagnosticJson(
      {
        success: true,
        articles_traites: traites,
        articles_total: references.length,
        erreurs,
      },
      report,
      erreurs.length ? 207 : 200,
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le recalcul par périmètre.')
  }
}
