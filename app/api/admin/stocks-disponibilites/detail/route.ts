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
  const traceId = resolveTraceId(req, 'STOCK-DETAIL')
  const admin = createAdminClient(traceId)
  const trace = new DiagnosticTrace(admin, {
    traceId,
    module: 'stocks-disponibilites',
    action: 'load_article_detail',
  })

  try {
    await requireAuthenticatedUser(req, admin, trace)

    const url = new URL(req.url)
    const referenceArticle = String(url.searchParams.get('reference_article') || '').trim()
    const depot = String(url.searchParams.get('depot') || 'GLOBAL').trim() || 'GLOBAL'

    if (!referenceArticle) {
      const error = { status: 400, code: 'REFERENCE_REQUIRED', message: 'La référence article est obligatoire.' }
      throw new DiagnosticError(trace.reportFromUnknown(error, error.message), 400, error)
    }

    const projectionResponse: any = await trace.runStep(
      {
        layer: 'supabase_rest',
        step: 'read_projection',
        objectName: 'public.v_stock_projection_hebdo_latest',
        context: { reference_article: referenceArticle, depot },
        rowCount: (data) => (Array.isArray(data) ? data.length : 0),
      },
      () =>
        admin
          .from('v_stock_projection_hebdo_latest')
          .select('*')
          .eq('reference_article', referenceArticle)
          .eq('depot', depot)
          .order('periode_debut', { ascending: true }),
    )

    const warnings: Array<{ label: string; report: unknown }> = []
    let fournisseurs: unknown[] = []
    let besoinsClients: unknown[] = []

    try {
      const cfResponse: any = await trace.runStep(
        {
          layer: 'supabase_rest',
          step: 'read_commandes_fournisseurs',
          objectName: 'public.v_commandes_fournisseurs_ouvertes_enrichies',
          context: { reference_article: referenceArticle },
          rowCount: (data) => (Array.isArray(data) ? data.length : 0),
        },
        () =>
          admin
            .from('v_commandes_fournisseurs_ouvertes_enrichies')
            .select(
              'numero_piece,fournisseur_code,fournisseur_nom,date_livraison,date_livraison_calculee,reference_article,designation,depot,quantite_attendue,montant_ht',
            )
            .eq('reference_article', referenceArticle)
            .order('date_livraison_calculee', { ascending: true })
            .limit(100),
      )
      fournisseurs = cfResponse.data || []
    } catch (error) {
      if (error instanceof DiagnosticError) warnings.push({ label: 'Commandes fournisseurs', report: error.report })
      else throw error
    }

    try {
      const besoinsResponse: any = await trace.runStep(
        {
          layer: 'supabase_rest',
          step: 'read_besoins_clients',
          objectName: 'public.v_stock_besoins_clients_ouverts_source',
          context: { reference_article: referenceArticle },
          rowCount: (data) => (Array.isArray(data) ? data.length : 0),
        },
        () =>
          admin
            .from('v_stock_besoins_clients_ouverts_source')
            .select(
              'reference_article,designation,depot,date_besoin,quantite_besoin,montant_ht,nb_commandes,numeros_pieces',
            )
            .eq('reference_article', referenceArticle)
            .order('date_besoin', { ascending: true })
            .limit(100),
      )
      besoinsClients = besoinsResponse.data || []
    } catch (error) {
      if (error instanceof DiagnosticError) warnings.push({ label: 'Besoins clients', report: error.report })
      else throw error
    }

    const report = trace.reportSuccess()
    if (warnings.length) {
      report.status = 'WARNING'
      report.user_message = 'Le détail principal est chargé, mais certaines sources secondaires sont indisponibles.'
    }

    return diagnosticJson(
      {
        success: true,
        partial: warnings.length > 0,
        projection: projectionResponse.data || [],
        fournisseurs,
        besoins_clients: besoinsClients,
        warnings,
      },
      report,
      warnings.length ? 207 : 200,
    )
  } catch (error) {
    return diagnosticErrorJson(error, trace, 'Erreur pendant le chargement du détail article.')
  }
}
