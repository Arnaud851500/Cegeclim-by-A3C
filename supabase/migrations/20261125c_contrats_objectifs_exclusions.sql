-- =============================================================================
-- 20261125c_contrats_objectifs_exclusions.sql — exclusions individuelles (25/11/2026, 18h40)
-- -----------------------------------------------------------------------------
-- Demande d'Arnaud : retirer l'accès aux contrats d'objectifs à Camille A. (profil
-- Administrateur), Lydia D. (Achat + Administrateur en complément) et Marine D.
-- (Aide Financement + Direction en complément), sans toucher à leurs autres droits.
-- Colonne user_page_access.sans_contrats_objectifs : le trigger de propagation des
-- droits n'accorde plus can_contrats_objectifs quand elle est cochée.
-- =============================================================================

alter table public.user_page_access add column if not exists sans_contrats_objectifs boolean not null default false;

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
  -- exclusion individuelle (25/11/2026) : profil Direction / Administrateur sans les contrats
  new.can_contrats_objectifs := r.can_contrats_objectifs and not coalesce(new.sans_contrats_objectifs, false);
  return new;
end
$function$;


update public.user_page_access
   set sans_contrats_objectifs = true
 where lower(email) in ('c.alegre@cegeclim-energies.com', 'l.duval@cegeclim-energies.com', 'm.dufour@cegeclim-energies.com');
