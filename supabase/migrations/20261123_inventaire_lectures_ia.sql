-- Inventaire — lectures IA des feuilles scannées en arrière-plan (23/11/2026)
-- ---------------------------------------------------------------------------
-- La lecture d'une page manuscrite par l'IA peut dépasser une minute : un appel
-- HTTP tenu ouvert aussi longtemps était coupé (« Failed to fetch »). La route
-- /api/stock/inventaire/lire-feuille crée maintenant une ligne ici, répond tout de
-- suite avec son id, lit la page en arrière-plan (after()) et y dépose le résultat ;
-- l'écran interroge la ligne toutes les 3 s.
-- Accès : service_role uniquement (route serveur), aucune policy pour les rôles API.
-- Les lectures de plus de 7 jours sont purgées à chaque nouvelle lecture.

create table if not exists public.inventaire_lectures_ia (
  id        uuid primary key default gen_random_uuid(),
  cree_par  text,
  cree_le   timestamptz not null default now(),
  statut    text not null default 'en_cours' check (statut in ('en_cours', 'ok', 'erreur')),
  resultat  jsonb,
  erreur    text,
  duree_ms  integer
);

create index if not exists idx_inventaire_lectures_ia_cree_le on public.inventaire_lectures_ia (cree_le);

alter table public.inventaire_lectures_ia enable row level security;
revoke all on public.inventaire_lectures_ia from anon, authenticated;
