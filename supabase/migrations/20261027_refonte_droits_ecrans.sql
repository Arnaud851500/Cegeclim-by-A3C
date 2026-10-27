-- ============================================================================
-- 20261027_refonte_droits_ecrans.sql — Refonte des droits can_xxx (27/10/2026)
-- ----------------------------------------------------------------------------
-- 1. Nouveaux droits d'écran : can_appro, can_superuser, can_projetblg,
--    can_paiement (access_profiles + user_page_access).
-- 2. Bug « can_todo » : l'écran /autorisation édite les PROFILS, mais la Todo,
--    les listes « Confiée à » et plusieurs contrôles en base lisent les colonnes
--    can_* de user_page_access, qui avaient divergé (16 écarts sur can_todo).
--    Désormais les colonnes can_* de user_page_access sont une COPIE CALCULÉE
--    des profils (principal + complémentaires actifs, OU logique) :
--      - trigger BEFORE sur user_page_access (toute insertion / modification),
--      - trigger AFTER STATEMENT sur access_profiles (recalcul de tous les
--        utilisateurs quand un profil change).
--    Une modification manuelle d'une colonne can_* de user_page_access est donc
--    écrasée : le profil est la seule source de vérité.
-- 3. Initialisation des nouveaux droits (aucune perte d'écran, sauf choix
--    explicites) :
--      can_appro      = can_stocks OU can_activites
--      can_stocks     = can_stocks OU can_dashboard (écrans stock ex-dashboard)
--      can_superuser  = can_projetblg = can_paiement = can_autorisation
--    puis Profil ADV : can_autorisation et can_superuser retirés (ADV ne gère
--    pas les accès), can_paiement et can_projetblg conservés.
-- 4. RPC : import_retards_paiement accepte can_paiement ;
--    peut_gerer_substitutions_stock accepte can_appro.
-- ============================================================================

-- 1. Colonnes ----------------------------------------------------------------
alter table public.access_profiles
  add column if not exists can_appro      boolean not null default false,
  add column if not exists can_superuser  boolean not null default false,
  add column if not exists can_projetblg  boolean not null default false,
  add column if not exists can_paiement   boolean not null default false;

alter table public.user_page_access
  add column if not exists can_objectifs          boolean not null default false,
  add column if not exists can_suivi_agences      boolean not null default false,
  add column if not exists can_allocation_airh2o  boolean not null default false,
  add column if not exists can_appro              boolean not null default false,
  add column if not exists can_superuser          boolean not null default false,
  add column if not exists can_projetblg          boolean not null default false,
  add column if not exists can_paiement           boolean not null default false;

-- 3. Initialisation des profils (avant les triggers) ---------------------------
update public.access_profiles
set can_appro     = coalesce(can_stocks, false) or coalesce(can_activites, false),
    can_superuser = coalesce(can_autorisation, false),
    can_projetblg = coalesce(can_autorisation, false),
    can_paiement  = coalesce(can_autorisation, false)
where id is not null;

update public.access_profiles
set can_stocks = coalesce(can_stocks, false) or coalesce(can_dashboard, false)
where id is not null;

update public.access_profiles
set can_autorisation = false,
    can_superuser    = false
where lower(trim(name)) = 'profil adv';

-- 2. Recalcul des droits utilisateur depuis les profils -----------------------
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
    coalesce(bool_or(p.can_paiement), false)          as can_paiement
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
  return new;
end
$function$;

-- Nom en « zz » : s'exécute après trg_user_page_access_normalise_profils.
drop trigger if exists trg_user_page_access_zz_droits on public.user_page_access;
create trigger trg_user_page_access_zz_droits
  before insert or update on public.user_page_access
  for each row execute function public.user_page_access_droits_depuis_profils();

create or replace function public.access_profiles_propager_droits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Ré-écriture neutre : le trigger BEFORE recalcule les can_* de chaque ligne.
  update public.user_page_access set email = email where email is not null;
  return null;
end
$function$;

drop trigger if exists trg_access_profiles_propager_droits on public.access_profiles;
create trigger trg_access_profiles_propager_droits
  after insert or update or delete on public.access_profiles
  for each statement execute function public.access_profiles_propager_droits();

-- Alignement initial de tous les utilisateurs.
update public.user_page_access set email = email where email is not null;

-- 4. RPC ----------------------------------------------------------------------
do $do$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.import_retards_paiement(date, text, jsonb)'::regprocedure);
  if v_def !~ 'can_paiement' then
    v_def := replace(v_def,
      'coalesce(u.can_autorisation, false)',
      'coalesce(u.can_autorisation, false)
        or coalesce(u.can_paiement, false)
        or coalesce(p.can_paiement, false)');
    v_def := replace(v_def,
      'réservé aux administrateurs (can_autorisation).',
      'réservé au droit MAJ retards paiement (can_paiement).');
    execute v_def;
  end if;
end
$do$;

create or replace function public.peut_gerer_substitutions_stock()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.user_page_access u
    left join public.access_profiles p on p.id = any (public.profils_de(u.access_profile_id, u.profils_complementaires))
    where u.email = public.current_user_email()
      and (
        coalesce(u.can_stocks, false)
        or coalesce(p.can_stocks, false)
        or coalesce(u.can_appro, false)
        or coalesce(p.can_appro, false)
        or coalesce(u.can_autorisation, false)
        or coalesce(p.can_autorisation, false)
      )
  );
$function$;
