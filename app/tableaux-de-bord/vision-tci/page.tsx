"use client";

// app/tableaux-de-bord/vision-tci/page.tsx
//
// FIX (2026-08) :
//  - Le titre "Vision ONE PAGE" et le badge de dernière synchro SAGE sont
//    remontés ici, dans un bandeau de page dédié -- ils vivaient jusque-là
//    à l'intérieur de VisionTciKpiPanel, noyés dans la section "Activité"
//    alors qu'ils concernent toute la page.
//  - Les 3 zones (Activité / Agenda / Todo) sont désormais entourées d'un
//    cadre avec en-tête coloré + icône, sur le principe des carrés du menu
//    mobile -- pour qu'on distingue clairement chaque partie de l'écran
//    d'un coup d'œil, plutôt que des blocs qui se fondent les uns dans les
//    autres.
//  - Agenda réduit de 50vh à 38vh (au profit de la todo list, qui gagne en
//    hauteur visible sans scroll) -- toujours dans la même colonne que la
//    todo, sous "Activité" en largeur (grid xl:grid-cols-2).
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
import LastSyncBadge from "@/components/LastSyncBadge";

// Section colorée type "carré du menu mobile" : icône + libellé sur un
// bandeau teinté, pour distinguer visuellement Activité / Agenda / Todo.
// Le contenu (children) garde sa propre mise en forme interne inchangée --
// cette coquille ne fait qu'ajouter l'en-tête et le cadre englobant.
function SectionFrame({
  title, icon, color, children, bodyClassName,
}: {
  title: string;
  icon: string;
  color: string;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10">
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: `${color}1F`, borderBottom: `2px solid ${color}` }}
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[13px]"
          style={{ background: `${color}33` }}
        >
          {icon}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color }}>
          {title}
        </span>
      </div>
      <div className={bodyClassName || "flex-1 bg-[#0B1220] p-3"}>{children}</div>
    </div>
  );
}

export default function VisionTciPage() {
  const { isMobile } = useViewport();

  if (isMobile) {
    return <MobileStandaloneActivite />;
  }

  return (
    <div className="min-h-screen w-full bg-[#0B1220] p-6">
      {/* ---- Bandeau de page : titre + synchro, communs à toute la page ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-white">Vision ONE PAGE</h1>
        <LastSyncBadge compact />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionFrame title="Activité" icon="📊" color="#4B92AC">
          <VisionTciKpiPanel />
        </SectionFrame>

        <div className="flex flex-col gap-4">
          <SectionFrame title="Agenda" icon="📅" color="#3F9142" bodyClassName="flex-1 p-0">
            <div style={{ height: "38vh" }} className="w-full">
              <OutlookAgenda />
            </div>
          </SectionFrame>

          <SectionFrame title="Todo" icon="✅" color="#7A5EA8">
            <TodoDenseList />
          </SectionFrame>
        </div>
      </div>
    </div>
  );
}
