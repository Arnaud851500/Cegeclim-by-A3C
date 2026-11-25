-- Filtres par défaut (partagés) de l'onglet Comparaison des écrans de contrôle SAGE/BLG.
-- Appliquée en production le 25/11/2026.
create table if not exists public.controle_filtres_defaut (
  domaine text primary key,
  filtres jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.controle_filtres_defaut enable row level security;
create policy controle_filtres_defaut_select on public.controle_filtres_defaut for select to authenticated using (true);
create policy controle_filtres_defaut_write on public.controle_filtres_defaut for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.controle_filtres_defaut to authenticated;
