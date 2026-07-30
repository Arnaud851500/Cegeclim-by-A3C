/**
 * POST /api/stocks-disponibilites/lancer-projection
 *
 * Lance une nouvelle projection complète en réutilisant les paramètres
 * (horizon, scénario, dépôt) du dernier run enregistré en base.
 * Les substitutions sont appliquées automatiquement.
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

  // Vérification des droits via la fonction SQL qui consulte profil ET ligne
  // utilisateur (même logique que la politique RLS des substitutions)
  const { data: autorise, error: authErr } = await supabase
    .rpc("peut_gerer_substitutions_stock");

  if (authErr) {
    console.error("[lancer-projection] auth check:", authErr.message);
    return NextResponse.json({ success: false, message: authErr.message }, { status: 500 });
  }

  if (!autorise) {
    return NextResponse.json({ success: false, message: "Droits insuffisants" }, { status: 403 });
  }

  // Appel de la fonction SQL — elle tourne côté Supabase sans limite de temps
  const { data, error } = await supabase.rpc("lancer_projection_depuis_front");

  if (error) {
    console.error("[lancer-projection]", error.message);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
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
