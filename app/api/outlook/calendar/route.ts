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
import { fetchIcsRaw, parseIcs } from "@/lib/server/icsParser";

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
      const { text: rawText, contentType } = await fetchIcsRaw(autorisation.ics_url);
      const tousLesEvenements = parseIcs(rawText);
      // Comparaison en chaînes "YYYY-MM-DD" plutôt qu'avec des objets Date :
      // évite tout piège de fuseau horaire entre une chaîne date-only
      // ("2026-08-03", toujours interprétée en UTC par `new Date()`) et une
      // chaîne date-heure locale sans "Z" issue du parseur ICS (interprétée,
      // elle, dans le fuseau du serveur) — les deux pouvaient diverger de
      // plusieurs heures et faire disparaître des évènements du filtre.
      const icsEvents = tousLesEvenements.filter((e) => {
        const jour = e.start.slice(0, 10);
        return jour >= start && jour < end;
      });
      const events = icsEvents.map((e) => ({ ...e, colorHex: autorisation.couleur_defaut || null, webLink: null }));
      return NextResponse.json({
        success: true,
        collaborateur: autorisation.collaborateur,
        couleur_defaut: autorisation.couleur_defaut,
        events,
        debug: {
          source: "ics",
          evenements_bruts_total: tousLesEvenements.length,
          evenements_apres_filtre: events.length,
          plage_demandee: { start, end },
          premiers_evenements_bruts: tousLesEvenements.slice(0, 3).map((e) => ({ subject: e.subject, start: e.start, end: e.end })),
          content_type_recu: contentType,
          taille_reponse_octets: rawText.length,
          apercu_reponse_brute: rawText.slice(0, 400),
        },
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
