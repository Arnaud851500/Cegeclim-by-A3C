"use client";

// app/tableaux-de-bord/vision-tci/page.tsx
//
// Agenda = 1/4 de l'écran = 1/2 largeur × 1/2 hauteur, explicitement.
// Colonne de droite fixée à 50% de la largeur totale (xl:grid-cols-2),
// agenda à 50vh de haut dans cette colonne — donc l'agenda occupe bien
// (largeur écran / 2) × (hauteur écran / 2). La todo list vient en dessous,
// dans la même colonne (même largeur que l'agenda), hauteur libre.

import OutlookAgenda from "@/components/OutlookAgenda";
import VisionTciKpiPanel from "@/components/VisionTciKpiPanel";
import TodoDenseList from "@/components/TodoDenseList";

export default function VisionTciPage() {
  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      <h1 className="mb-4 text-xl font-bold text-white">ONE PAGE</h1>

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
