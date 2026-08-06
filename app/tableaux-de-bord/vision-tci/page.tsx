"use client";

// app/tableaux-de-bord/vision-tci/page.tsx

import OutlookAgenda from "@/components/OutlookAgenda";
import VisionTciKpiPanel from "@/components/VisionTciKpiPanel";
import TodoDenseList from "@/components/TodoDenseList";

export default function VisionTciPage() {
  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      <h1 className="mb-4 text-xl font-bold text-white">Vision One page TCI</h1>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <VisionTciKpiPanel />
        {/* Agenda à 1/4 de page : environ un quart de la largeur/hauteur de
            l'écran (contrainte via max-width + hauteur fixe réduite),
            plutôt qu'en pleine hauteur comme la version précédente. */}
        <div className="mx-auto h-[360px] w-full max-w-md xl:mx-0">
          <OutlookAgenda />
        </div>
      </div>

      <div className="mt-4">
        <TodoDenseList />
      </div>
    </div>
  );
}
