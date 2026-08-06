"use client";

// app/tableaux-de-bord/vision-tci/page.tsx
//
// Écran "Vision One page TCI" — brouillon en cours de remplissage. Suit la
// disposition du mockup papier : pavés KPI configurables en haut/gauche,
// agenda en haut/droite. Les blocs "À définir plus tard" et "Todo list" ne
// sont pas encore construits.
//
// Chemin à garder synchronisé avec OUTLOOK_RETURN_PATH dans
// app/api/outlook/oauth/callback/route.ts si tu déplaces ce fichier.

import OutlookAgenda from "@/components/OutlookAgenda";
import VisionTciKpiPanel from "@/components/VisionTciKpiPanel";

export default function VisionTciPage() {
  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      <h1 className="mb-4 text-xl font-bold text-white">Vision One page TCI</h1>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <VisionTciKpiPanel />
        <div className="h-[900px]">
          <OutlookAgenda />
        </div>
      </div>
    </div>
  );
}
