-- =============================================================================
-- 20261125b_droit_contrats_objectifs.sql — droit dédié « Contrats d'objectifs » (25/11/2026)
-- -----------------------------------------------------------------------------
-- Demande d'Arnaud (25/11/2026, 18h30) : l'écran /objectifs/contrats sortait du droit
-- « Activité commerciale » (can_dashboard), donc visible de la logistique, de l'ADV et
-- de tous les commerciaux. Pour l'instant, seule la direction (et Arnaud) y accède.
--  - nouveau droit can_contrats_objectifs (access_profiles / user_page_access, propagé
--    par le trigger user_page_access_droits_depuis_profils) ;
--  - accordé aux profils « Direction » et « Administrateur » uniquement ;
--  - verrou côté base : obj_peut_lire(code) (seul contrôle de get_obj_contrats_liste et
--    get_obj_contrat) exige désormais ce droit, puis le périmètre habituel
--    (ancienne fonction renommée obj_peut_lire_perimetre).
-- =============================================================================

alter table public.access_profiles  add column if not exists can_contrats_objectifs boolean not null default false;
alter table public.user_page_access add column if not exists can_contrats_objectifs boolean not null default false;

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
  new.can_suivi_agences      := r.can_suivi_agences;
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
  new.can_contrats_objectifs := r.can_contrats_objectifs;
  return new;
end
$function$;

-- Direction et Administrateur uniquement (le trigger trg_access_profiles_propager_droits recalcule user_page_access)
update public.access_profiles
   set can_contrats_objectifs = (name in ('Direction', 'Administrateur'));

-- Recalcul explicite au cas où la propagation ne couvrirait pas toutes les lignes
update public.user_page_access set email = email where true;

-- Droit de la personne connectée
create or replace function public.obj_contrats_acces()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
 set row_security to 'off'
as $function$
  select exists (
    select 1 from public.user_page_access u
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and coalesce(u.can_contrats_objectifs, false)
  );
$function$;
grant execute on function public.obj_contrats_acces() to authenticated;

-- Verrou base : droit dédié + périmètre habituel
alter function public.obj_peut_lire(text) rename to obj_peut_lire_perimetre;

create or replace function public.obj_peut_lire(p_code text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'auth'
 set row_security to 'off'
as $function$
  select public.obj_contrats_acces() and public.obj_peut_lire_perimetre(p_code);
$function$;
grant execute on function public.obj_peut_lire(text) to authenticated;
