-- =============================================================================
-- 20261126a_ecrans_reserves_suivi_contrats.sql — accès nominatif (26/11/2026, 20h25)
-- -----------------------------------------------------------------------------
-- Demande d'Arnaud : « Suivi agences – commerciaux » (/suivi-agences) et
-- « Contrats d'objectifs » (/objectifs/contrats) réservés à Stéphane C., Jean-Marc L.,
-- Laetitia C. et Arnaud (ses deux comptes), quels que soient les profils.
--  - table ecrans_reserves (ecran, email) : liste nominative par écran ; un écran
--    présent dans la table n'est ouvert qu'aux emails listés (en plus du droit de profil) ;
--  - trigger user_page_access_droits_depuis_profils : can_suivi_agences et
--    can_contrats_objectifs filtrés par cette liste ;
--  - suivi_agences_autorise() (garde des RPC Suivi agences et du périmètre des
--    contrats) lit désormais user_page_access.can_suivi_agences au lieu des profils ;
--  - côté écran, AccessContext reprend ces deux droits calculés en base.
-- Personnes qui perdent l'accès : Gil Arnaud P., Philippe V., Julien I. (Direction),
-- Camille A., Lydia D. (Administrateur), Laure V. (Piliers et visu large).
-- =============================================================================

create table if not exists public.ecrans_reserves (
  ecran text not null,
  email text not null,
  ajoute_le timestamptz not null default now(),
  primary key (ecran, email)
);
alter table public.ecrans_reserves enable row level security;
revoke all on public.ecrans_reserves from anon, authenticated;

insert into public.ecrans_reserves (ecran, email)
select e, m from unnest(array['suivi_agences', 'contrats_objectifs']) e
cross join unnest(array[
  's.chanteau@cegeclim-energies.com',
  'jm.ladeuix@cegeclim-energies.com',
  'l.carrere@cegeclim-energies.com',
  'a.valanchauskas@cegeclim-energies.com',
  'valanchauskas_arnaud@yahoo.fr'
]) m
on conflict do nothing;

-- Écran absent de la table = pas de restriction nominative
create or replace function public.ecran_reserve_autorise(p_ecran text, p_email text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select not exists (select 1 from public.ecrans_reserves where ecran = p_ecran)
      or exists (select 1 from public.ecrans_reserves
                 where ecran = p_ecran and lower(btrim(email)) = lower(btrim(coalesce(p_email, ''))));
$function$;

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
    coalesce(bool_or(p.can_hotline_editeur), false)   as can_hotline_editeur,
    coalesce(bool_or(p.can_guides_blg), false)        as can_guides_blg,
    coalesce(bool_or(p.can_contrats_objectifs), false) as can_contrats_objectifs
  into r
  from public.access_profiles p
  where p.id = any (public.profils_de(new.access_profile_id, new.profils_complementaires))
    and coalesce(p.is_active, true);

  new.can_dashboard          := r.can_dashboard;
  new.can_territoire         := r.can_territoire;
  new.can_cartographie       := r.can_cartographie;
  new.can_clients            := r.can_clients;
  new.can_carte              := r.can_carte;
  new.can_todo               := r.can_todo;
  new.can_clients_cegeclim   := r.can_clients_cegeclim;
  new.can_suivi_prospects    := r.can_suivi_prospects;
  new.can_agences            := r.can_agences;
  new.can_autorisation       := r.can_autorisation;
  new.can_documents          := r.can_documents;
  new.can_stocks             := r.can_stocks;
  new.can_activites          := r.can_activites;
  new.can_change_scope       := r.can_change_scope;
  new.can_objectifs          := r.can_objectifs;
  -- écran réservé à une liste nominative (ecrans_reserves, 26/11/2026)
  new.can_suivi_agences      := r.can_suivi_agences and public.ecran_reserve_autorise('suivi_agences', new.email);
  new.can_financement        := r.can_financement;
  new.can_allocation_airh2o  := r.can_allocation_airh2o;
  new.can_appro              := r.can_appro;
  new.can_superuser          := r.can_superuser;
  new.can_projetblg          := r.can_projetblg;
  new.can_paiement           := r.can_paiement;
  new.can_hotline            := r.can_hotline;
  new.can_hotline_expert     := r.can_hotline_expert;
  new.can_hotline_editeur    := r.can_hotline_editeur;
  new.can_guides_blg         := r.can_guides_blg;
  -- exclusion individuelle (25/11/2026) : profil Direction / Administrateur sans les contrats
  new.can_contrats_objectifs := r.can_contrats_objectifs and not coalesce(new.sans_contrats_objectifs, false)
                                and public.ecran_reserve_autorise('contrats_objectifs', new.email);
  return new;
end
$function$;



-- Garde des RPC Suivi agences : droit calculé (profil + liste nominative)
create or replace function public.suivi_agences_autorise()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.suivi_appel_technique() or exists (
    select 1 from public.user_page_access u
    where lower(btrim(u.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
      and coalesce(u.can_suivi_agences, false)
  )
$function$;

-- Recalcul des droits de tous les utilisateurs
update public.user_page_access set email = email where true;

-- Modification des contrats (saisie, évaluation des primes, versements, import) :
-- réservée elle aussi aux personnes ayant l'écran (sinon Administrateurs / éditeurs exclus
-- gardaient « modifier » via todo_is_admin) — appliqué en production comme migration
-- 20261126b_obj_peut_modifier_reserve.
alter function public.obj_peut_modifier() rename to obj_peut_modifier_base;

create or replace function public.obj_peut_modifier()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
 set row_security to 'off'
as $function$
  select public.obj_contrats_acces() and public.obj_peut_modifier_base();
$function$;
grant execute on function public.obj_peut_modifier() to authenticated;
