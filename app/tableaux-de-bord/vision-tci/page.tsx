"use client";

// app/tableaux-de-bord/vision-tci/page.tsx
//
// Page minimale pour tester le bloc Agenda dès maintenant. C'est le
// brouillon du futur écran "Vision One page TCI" complet (KPI activité,
// todo list, etc. — pas encore construits) : pour l'instant, uniquement le
// bloc agenda, en pleine largeur, pour valider la connexion ICS/Microsoft.
//
// Le chemin de ce fichier doit correspondre à OUTLOOK_RETURN_PATH dans
// app/api/outlook/oauth/callback/route.ts (déjà aligné : "/tableaux-de-bord/vision-tci").
// Si tu déplaces cette page ailleurs dans ton arborescence, mets à jour les
// deux en même temps.

import OutlookAgenda from "@/components/OutlookAgenda";

export default function VisionTciPage() {
  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      <h1 className="mb-4 text-xl font-bold text-white">Vision One page TCI — brouillon (agenda uniquement)</h1>
      <div className="h-[600px] max-w-4xl">
        <OutlookAgenda />
      </div>
    </div>
  );
}
