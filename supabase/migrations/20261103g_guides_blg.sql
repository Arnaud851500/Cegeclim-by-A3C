-- ============================================================================
-- 20261103g_guides_blg.sql — Bloc « Guides BLG » du compagnon (03/11/2026)
-- ----------------------------------------------------------------------------
-- Chapitres HTML autonomes des modes opératoires BLG Cloud (ex. CHAPITRE-Clients.html),
-- déposés tels quels : au dépôt, le navigateur extrait les images / PDF intégrés
-- (data:…;base64) en fichiers séparés dans le bucket privé « guides-blg » et ne garde
-- qu'une page légère (index.html) où ils sont remplacés par __GUIDE_ASSET__/<fichier>.
-- À la lecture, la page est rechargée, les fichiers sont servis par URL signées et le
-- chapitre s'affiche dans une iframe isolée (srcdoc + sandbox).
--  - droit can_guides_blg (access_profiles / user_page_access, propagé par le trigger
--    user_page_access_droits_depuis_profils) accordé à tous les profils actifs sauf
--    « Sans accès » et « Aide Financement » (univers financement seul) ;
--  - lecture : can_guides_blg ou administration ; dépôt / suppression : administration.
-- ============================================================================

-- 1) Droit -------------------------------------------------------------------
alter table public.access_profiles  add column if not exists can_guides_blg boolean not null default false;
alter table public.user_page_access add column if not exists can_guides_blg boolean not null default false;

create or replace function public.user_page_access_droits_depuis_profils()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
begin
  select
    coalesce(bool_or(p.can_dashboard), false)         as can_dashboard,
    coalesce(bool_or(p.can_territoire), false)        as can_territoire,
    coalesce(bool_or(p.can_cartographie), false)      as can_cartographie,
    coalesce(bool_or(p.can_clients), false)           as can_clients,
    coalesce(bool_or(p.can_carte), false)             as can_carte,
    coalesce(bool_or(p.can_todo), false)              as can_todo,
    coalesce(bool_or(p.can_clients_cegeclim), false)  as can_clients_cegeclim,
    coalesce(bool_or(p.can_suivi_prospects), false)   as can_suivi_prospects,
    coalesce(bool_or(p.can_agences), false)           as can_agences,
    coalesce(bool_or(p.can_autorisation), false)      as can_autorisation,
    coalesce(bool_or(p.can_documents), false)         as can_documents,
    coalesce(bool_or(p.can_stocks), false)            as can_stocks,
    coalesce(bool_or(p.can_activites), false)         as can_activites,
    coalesce(bool_or(p.can_change_scope), false)      as can_change_scope,
    coalesce(bool_or(p.can_objectifs), false)         as can_objectifs,
    coalesce(bool_or(p.can_suivi_agences), false)     as can_suivi_agences,
    coalesce(bool_or(p.can_financement), false)       as can_financement,
    coalesce(bool_or(p.can_allocation_airh2o), false) as can_allocation_airh2o,
    coalesce(bool_or(p.can_appro), false)             as can_appro,
    coalesce(bool_or(p.can_superuser), false)         as can_superuser,
    coalesce(bool_or(p.can_projetblg), false)         as can_projetblg,
    coalesce(bool_or(p.can_paiement), false)          as can_paiement,
    coalesce(bool_or(p.can_hotline), false)           as can_hotline,
    coalesce(bool_or(p.can_hotline_expert), false)    as can_hotline_expert,
    coalesce(bool_or(p.can_guides_blg), false)        as can_guides_blg
  into r
  from public.access_profiles p
  where p.id = any (public.profils_de(new.access_profile_id, new.profils_complementaires))
    and coalesce(p.is_active, true);

  new.can_dashboard         := r.can_dashboard;
  new.can_territoire        := r.can_territoire;
  new.can_cartographie      := r.can_cartographie;
  new.can_clients           := r.can_clients;
  new.can_carte             := r.can_carte;
  new.can_todo              := r.can_todo;
  new.can_clients_cegeclim  := r.can_clients_cegeclim;
  new.can_suivi_prospects   := r.can_suivi_prospects;
  new.can_agences           := r.can_agences;
  new.can_autorisation      := r.can_autorisation;
  new.can_documents         := r.can_documents;
  new.can_stocks            := r.can_stocks;
  new.can_activites         := r.can_activites;
  new.can_change_scope      := r.can_change_scope;
  new.can_objectifs         := r.can_objectifs;
  new.can_suivi_agences     := r.can_suivi_agences;
  new.can_financement       := r.can_financement;
  new.can_allocation_airh2o := r.can_allocation_airh2o;
  new.can_appro             := r.can_appro;
  new.can_superuser         := r.can_superuser;
  new.can_projetblg         := r.can_projetblg;
  new.can_paiement          := r.can_paiement;
  new.can_hotline           := r.can_hotline;
  new.can_hotline_expert    := r.can_hotline_expert;
  new.can_guides_blg        := r.can_guides_blg;
  return new;
end
$function$;

-- Accordé à tous les profils, sauf « Sans accès » et « Aide Financement ».
-- (le trigger trg_access_profiles_propager_droits recalcule user_page_access)
update public.access_profiles
   set can_guides_blg = true
 where coalesce(is_active, true)
   and name not in ('Sans accès', 'Aide Financement');

-- 2) Fonctions d'accès --------------------------------------------------------
create or replace function public.peut_lire_guides_blg()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
 set row_security to 'off'
as $function$
  select exists (
    select 1
    from public.user_page_access u
    left join public.access_profiles p on p.id = any (public.profils_de(u.access_profile_id, u.profils_complementaires))
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and (
        coalesce(u.can_guides_blg, false) or coalesce(p.can_guides_blg, false)
        or coalesce(u.can_autorisation, false) or coalesce(p.can_autorisation, false)
      )
  );
$function$;

create or replace function public.peut_gerer_guides_blg()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
 set row_security to 'off'
as $function$
  select public.todo_is_admin();
$function$;

grant execute on function public.peut_lire_guides_blg() to authenticated;
grant execute on function public.peut_gerer_guides_blg() to authenticated;

-- 3) Catalogue des chapitres --------------------------------------------------
create table if not exists public.guides_blg (
  slug            text primary key,
  titre           text not null,
  sous_titre      text,
  fichier_origine text,
  ordre           integer not null default 100,
  version         integer not null default 1,
  prefixe         text not null,               -- dossier du bucket : <slug>/v<version>
  sommaire        jsonb not null default '[]'::jsonb,  -- [{id, titre, numero, nb_etapes}]
  nb_modop        integer not null default 0,
  nb_etapes       integer not null default 0,
  nb_images       integer not null default 0,
  nb_pdf          integer not null default 0,
  taille_origine  bigint,
  taille_page     bigint,
  actif           boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

alter table public.guides_blg enable row level security;

drop policy if exists guides_blg_select on public.guides_blg;
create policy guides_blg_select on public.guides_blg
  for select to authenticated
  using (public.peut_lire_guides_blg());

drop policy if exists guides_blg_write on public.guides_blg;
create policy guides_blg_write on public.guides_blg
  for all to authenticated
  using (public.peut_gerer_guides_blg())
  with check (public.peut_gerer_guides_blg());

grant select, insert, update, delete on public.guides_blg to authenticated;

-- 4) Stockage privé -------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('guides-blg', 'guides-blg', false)
on conflict (id) do nothing;

drop policy if exists guides_blg_objets_lecture on storage.objects;
create policy guides_blg_objets_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'guides-blg' and public.peut_lire_guides_blg());

drop policy if exists guides_blg_objets_ajout on storage.objects;
create policy guides_blg_objets_ajout on storage.objects
  for insert to authenticated
  with check (bucket_id = 'guides-blg' and public.peut_gerer_guides_blg());

drop policy if exists guides_blg_objets_maj on storage.objects;
create policy guides_blg_objets_maj on storage.objects
  for update to authenticated
  using (bucket_id = 'guides-blg' and public.peut_gerer_guides_blg())
  with check (bucket_id = 'guides-blg' and public.peut_gerer_guides_blg());

drop policy if exists guides_blg_objets_suppression on storage.objects;
create policy guides_blg_objets_suppression on storage.objects
  for delete to authenticated
  using (bucket_id = 'guides-blg' and public.peut_gerer_guides_blg());
