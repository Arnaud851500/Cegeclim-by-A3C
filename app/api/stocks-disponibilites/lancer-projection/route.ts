/**
 * POST /api/stocks-disponibilites/lancer-projection
 *
 * Lance une nouvelle projection complète en réutilisant EXACTEMENT les
 * paramètres (horizon, scénario, dépôt) du dernier run enregistré en base.
 * Les substitutions de références sont appliquées automatiquement à la fin.
 *
 * Aucun paramètre en entrée — c'est voulu : ce bouton ne change rien
 * aux hypothèses déjà saisies par les utilisateurs.
 *
 * La fonction SQL tourne dans Supabase sans limite de temps (statement_timeout
 * à 0 dans rebuild_stock_projection_hebdo_pipeline). La route attend jusqu'à
 * 9 minutes (Vercel Pro) ou délègue via pg_cron si besoin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const userToken  = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!userToken) {
    return NextResponse.json({ success: false, message: "Non authentifié" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${userToken}` } } },
  );

  // Vérifier que l'utilisateur a le droit can_stocks ou can_autorisation
  const { data: acces } = await supabase
    .from("user_page_access")
    .select("can_stocks, can_autorisation")
    .single();

  if (!acces?.can_stocks && !acces?.can_autorisation) {
    return NextResponse.json({ success: false, message: "Droits insuffisants" }, { status: 403 });
  }

  // Appel de la fonction SQL — elle tourne côté Supabase sans limite de temps
  const { data, error } = await supabase.rpc("lancer_projection_depuis_front");

  if (error) {
    console.error("[lancer-projection]", error.message);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }

  const result = data as {
    run_id: string;
    date_debut: string;
    nb_semaines: number;
    scenario_prevision_pct: number;
    depot_mode: string;
  };

  return NextResponse.json({
    success: true,
    run_id: result.run_id,
    nb_semaines: result.nb_semaines,
    scenario_prevision_pct: result.scenario_prevision_pct,
    depot_mode: result.depot_mode,
    message: `Projection terminée — ${result.nb_semaines} semaines · ×${(result.scenario_prevision_pct * 100).toFixed(0)}% · substitutions appliquées`,
  });
}
