"use client";

// app/tableaux-de-bord/vision-tci/page.tsx
//
// Agenda = 1/4 de l'écran = 1/2 largeur × 1/2 hauteur, explicitement.
// Colonne de droite fixée à 50% de la largeur totale (xl:grid-cols-2),
// agenda à 50vh de haut dans cette colonne — donc l'agenda occupe bien
// (largeur écran / 2) × (hauteur écran / 2). La todo list vient en dessous,
// dans la même colonne (même largeur que l'agenda), hauteur libre.
//
// MOBILE — Sur téléphone (largeur < 768px), cette page bascule vers
// MobileStandaloneActivite (même écran "Mon activité" que le bouton 1 du
// menu MobileShell) plutôt que d'afficher ce gabarit 2 colonnes, illisible
// en dessous de 768px. VisionTciKpiPanel / OutlookAgenda / TodoDenseList ne
// sont même pas montés dans ce cas (le early return les court-circuite
// avant leur rendu, donc avant tout appel de données qu'ils déclenchent
// eux-mêmes).

import { useViewport } from "@/lib/useViewport";
import MobileStandaloneActivite from "@/components/mobile/MobileStandaloneActivite";
import OutlookAgenda from "@/components/OutlookAgenda";
import VisionTciKpiPanel from "@/components/VisionTciKpiPanel";
import TodoDenseList from "@/components/TodoDenseList";

export default function VisionTciPage() {
  const { isMobile } = useViewport();

  if (isMobile) {
    return <MobileStandaloneActivite />;
  }

  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <VisionTciKpiPanel />

        <div className="flex flex-col gap-4">
          <div style={{ height: "50vh" }} className="w-full">
            <OutlookAgenda />
          </div>
          <TodoDenseList />
        </div>
      </div>
    </div>
  );
}
