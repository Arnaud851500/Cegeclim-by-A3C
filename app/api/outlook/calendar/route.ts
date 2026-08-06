// app/api/outlook/calendar/route.ts
//
// GET /api/outlook/calendar?email=...&start=YYYY-MM-DD&end=YYYY-MM-DD
//
// 1. Vérifie que l'utilisateur appelant est authentifié (Supabase).
// 2. Vérifie que l'adresse M365 demandée est présente et active dans
//    outlook_calendar_autorisations — c'est le VRAI filtre d'accès, le jeton
//    applicatif Microsoft pouvant techniquement lire n'importe quelle
//    messagerie du tenant.
// 3. Appelle Microsoft Graph (app-only) et renvoie les évènements normalisés.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCalendarEvents } from "@/lib/server/microsoftGraph";
import { fetchIcsEvents } from "@/lib/server/icsParser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
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

  const { data: userData, error: userErr } = await supabase.auth.getUser(userToken);
  if (userErr || !userData?.user) {
    return NextResponse.json({ success: false, message: "Session invalide" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const email = (searchParams.get("email") || "").trim().toLowerCase();
  const start = searchParams.get("start") || "";
  const end   = searchParams.get("end") || "";

  if (!email || !start || !end) {
    return NextResponse.json({ success: false, message: "Paramètres email, start et end requis" }, { status: 400 });
  }

  // Le filtre d'accès métier : l'adresse doit être explicitement autorisée
  // et active. On utilise le client authentifié (RLS "select" ouverte à tout
  // utilisateur connecté sur cette table) plutôt qu'un client admin, pour
  // qu'un utilisateur non connecté ne puisse jamais atteindre cette route.
  const { data: autorisation, error: autoErr } = await supabase
    .from("outlook_calendar_autorisations")
    .select("email_outlook, actif, collaborateur, couleur_defaut, ics_url")
    .eq("email_outlook", email)
    .maybeSingle();

  if (autoErr) {
    return NextResponse.json({ success: false, message: `Contrôle d'autorisation impossible : ${autoErr.message}` }, { status: 500 });
  }
  if (!autorisation || !autorisation.actif) {
    return NextResponse.json(
      { success: false, message: `L'agenda de ${email} n'est pas autorisé (ou désactivé). Ajoute-le dans le panneau d'administration de l'agenda.` },
      { status: 403 },
    );
  }

  try {
    // Source ICS (Yahoo Agenda, Google Calendar, etc. via lien de partage
    // privé) : prioritaire si configurée, ignore complètement Microsoft
    // Graph pour cette entrée. Pratique pour tester avant que l'inscription
    // Azure AD ne soit prête.
    if (autorisation.ics_url) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      const icsEvents = (await fetchIcsEvents(autorisation.ics_url)).filter((e) => {
        const evStart = new Date(e.start);
        return evStart >= startDate && evStart < endDate;
      });
      const events = icsEvents.map((e) => ({ ...e, colorHex: autorisation.couleur_defaut || null, webLink: null }));
      return NextResponse.json({
        success: true,
        collaborateur: autorisation.collaborateur,
        couleur_defaut: autorisation.couleur_defaut,
        events,
      });
    }

    const events = await getCalendarEvents(email, start, end);
    return NextResponse.json({
      success: true,
      collaborateur: autorisation.collaborateur,
      couleur_defaut: autorisation.couleur_defaut,
      events,
    });
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
