-- ════════════════════════════════════════════════════════════════════════════
-- Plan d'expédition FMS — règles de palettisation (05/11/2026, consigne Arnaud)
--
--  • ECS (ballons : références TAW…, familles ECS)  → 1 unité par palette
--  • Groupes extérieurs R/O                           → 1 unité par palette
--  • Groupes extérieurs R/R                           → 4 unités par palette
--  • Tout le reste : volume BLG / 1,3 m³ ou poids / 600 kg (le plus contraignant)
--
-- Une règle « PREFIXE » (début de référence) l'emporte sur une règle « FAMILLE ».
-- Le calcul est fait dans refresh_plan_expedition_fms (colonnes palette_unitaire,
-- regle_palette de appro_plan_exp_lignes) ; la vue agence lit « pu ».
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.appro_plan_exp_palettisation (
  type_regle          text    not null check (type_regle in ('PREFIXE', 'FAMILLE')),
  valeur              text    not null,
  unites_par_palette  numeric not null check (unites_par_palette > 0),
  libelle             text    not null,
  updated_at          timestamptz not null default now(),
  primary key (type_regle, valeur)
);
alter table public.appro_plan_exp_palettisation enable row level security;
drop policy if exists appro_plan_exp_palettisation_sel on public.appro_plan_exp_palettisation;
create policy appro_plan_exp_palettisation_sel on public.appro_plan_exp_palettisation for select to authenticated using (true);
drop policy if exists appro_plan_exp_palettisation_all on public.appro_plan_exp_palettisation;
create policy appro_plan_exp_palettisation_all on public.appro_plan_exp_palettisation for all to authenticated
  using (public.plan_exp_autorise()) with check (public.plan_exp_autorise());
grant select, insert, update, delete on public.appro_plan_exp_palettisation to authenticated;

insert into public.appro_plan_exp_palettisation (type_regle, valeur, unites_par_palette, libelle) values
  ('PREFIXE', 'TAW',        1, 'ECS : 1 par palette'),
  ('FAMILLE', '00YUTAMPUI', 1, 'ECS : 1 par palette'),
  ('FAMILLE', '00YLAGON',   1, 'ECS : 1 par palette'),
  ('FAMILLE', '00ROECS',    1, 'ECS : 1 par palette'),
  ('FAMILLE', '00RORASUE',  1, 'GE R/O : 1 par palette'),
  ('FAMILLE', '00RORASM',   1, 'GE R/O : 1 par palette'),
  ('FAMILLE', '00ROH2OUE',  1, 'GE R/O : 1 par palette'),
  ('FAMILLE', '00RAMUE',    4, 'GE R/R : 4 par palette'),
  ('FAMILLE', '00RACUE',    4, 'GE R/R : 4 par palette'),
  ('FAMILLE', '00TRIPLCUE', 4, 'GE R/R : 4 par palette'),
  ('FAMILLE', '00DODAIRAC', 4, 'GE R/R : 4 par palette')
on conflict (type_regle, valeur) do update
  set unites_par_palette = excluded.unites_par_palette, libelle = excluded.libelle, updated_at = now();

alter table public.appro_plan_exp_lignes add column if not exists palette_unitaire numeric;  -- fraction de palette par unité
alter table public.appro_plan_exp_lignes add column if not exists regle_palette text;        -- règle appliquée (null = volume / poids)

-- Code postal / ville de livraison (planning d'expédition FMS)
alter table public.appro_plan_exp_lignes add column if not exists cp_livraison text;
alter table public.appro_plan_exp_lignes add column if not exists ville_livraison text;
alter table public.appro_plan_exp_unites add column if not exists cp_livraison text;
alter table public.appro_plan_exp_unites add column if not exists ville_livraison text;

-- Référence de la CDF SAGE (« CONT 10 FMS CN », « CONT REASS FMS CN »…) dans l'onglet Containers & RDV
alter table public.appro_plan_exp_receptions add column if not exists reference_cdf text;
