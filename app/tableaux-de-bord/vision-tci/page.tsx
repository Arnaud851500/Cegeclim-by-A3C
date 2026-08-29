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
//
// FIX (2026-08) : en-têtes agrandis et en majuscules ("MON ACTIVITÉ" /
// "MON AGENDA" / "MA TODO"), badge d'icône plus grand, bordure de couleur
// plus épaisse -- pour que chaque section se remarque nettement, sur le
// modèle des carrés du menu mobile.
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
    <div className="flex flex-col overflow-hidden rounded-2xl border-2" style={{ borderColor: `${color}55` }}>
      <div
        className="flex items-center gap-3 px-4 py-3.5"
        style={{ background: `${color}2A`, borderBottom: `3px solid ${color}` }}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[19px]"
          style={{ background: `${color}40` }}
        >
          {icon}
        </span>
        <span className="text-[15px] font-extrabold uppercase tracking-[0.12em]" style={{ color }}>
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
      {/* FIX (2026-08) : le titre "Vision ONE PAGE" vit désormais dans le
          bandeau global du site (ClientRootShell.tsx, à la place de
          "Suivi commercial & prospect") -- il ne serait redondant de le
          répéter ici. Seul le badge de synchro reste, discret. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LastSyncBadge compact />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* FIX (2026-08) : couleurs alignées sur le menu mobile --
            "Mon activité" = bleu, "Mes rdv" = violet, "Mes tâches / alertes"
            = ambre-rouge. Réutilise des couleurs déjà en usage ailleurs
            dans l'app plutôt que d'en introduire de nouvelles : #2E5BB8 est
            déjà la couleur "RDV" dans OutlookAgenda (RDV_TYPE_COLORS.meeting),
            #7A5EA8 est déjà la couleur "Marge"/CDC ailleurs dans Vision TCI
            et focus_mensuel, #B4761A est la couleur de marque propre à la
            page Todo elle-même (HeaderStat "warn", boutons, etc.). */}
        <SectionFrame title="Mon Activité" icon="📊" color="#2E5BB8">
          <VisionTciKpiPanel />
        </SectionFrame>

        <div className="flex flex-col gap-4">
          <SectionFrame title="Mon Agenda" icon="📅" color="#7A5EA8" bodyClassName="flex-1 p-0">
            <div style={{ height: "38vh" }} className="w-full">
              <OutlookAgenda />
            </div>
          </SectionFrame>

          <SectionFrame title="Ma Todo" icon="✅" color="#B4761A">
            <TodoDenseList />
          </SectionFrame>
        </div>
      </div>
    </div>
  );
}
