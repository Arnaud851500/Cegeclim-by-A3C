-- ============================================================================
-- 20261026_allocation_airh2o_vue_agence_dashboard.sql — Allocation AirH2O (26/10/2026)
-- ----------------------------------------------------------------------------
-- Demande d'Arnaud :
--   • les 4 personnes de stock_alloc_ro_acces gardent la vue complète et la
--     saisie des colonnes « Allocation » (inchangé : peut_acceder_allocation_ro) ;
--   • toute personne ayant le droit can_dashboard (fiche utilisateur ou profil
--     actif) ouvre l'écran en vue agence, en lecture, sur l'agence qui lui est
--     rattachée — toutes les ventes des collaborateurs de cette agence.
-- Agence rattachée, dans cet ordre :
--   1. périmètre agences de la fiche (user_page_access.allowed_agences) ;
--   2. sinon agence objectif de la fiche (user_page_access.agence_objectif) ;
--   3. sinon agence des collaborateurs du périmètre (ref_collaborateurs).
-- Le droit de profil can_allocation_airh2o reste accepté (même vue agence).
-- SAV/JMLADEUIX est rattaché au bloc « Julien Ithurbide » (JITHURBIDE).
-- ============================================================================

create or replace function public.allocation_ro_blocs_user()
returns text[]
language sql stable security definer
set search_path to 'public'
as $$
  with u as (
    select u.*
    from public.user_page_access u
    where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (
        coalesce(u.can_dashboard, false)
        or exists (
          select 1 from public.access_profiles p
          where p.id = any(array_prepend(u.access_profile_id, coalesce(u.profils_complementaires, '{}'::uuid[])))
            and coalesce(p.is_active, true)
            and (coalesce(p.can_dashboard, false) or coalesce(p.can_allocation_airh2o, false))
        )
      )
    limit 1
  ),
  ag_perimetre as (
    select a from u cross join unnest(coalesce(u.allowed_agences, '{}'::text[])) a
    where nullif(trim(a), '') is not null
  ),
  ag_objectif as (
    select u.agence_objectif as a from u
    where nullif(trim(u.agence_objectif), '') is not null
      and not exists (select 1 from ag_perimetre)
  ),
  ag_collab as (
    select c.agence as a
    from u
    cross join unnest(coalesce(u.allowed_collaborateurs, '{}'::text[])) col
    join public.ref_collaborateurs c on c.nom = col or c.nom_prenom = col
    where nullif(trim(c.agence), '') is not null
      and not exists (select 1 from ag_perimetre)
      and not exists (select 1 from ag_objectif)
  ),
  toutes as (
    select a from ag_perimetre union select a from ag_objectif union select a from ag_collab
  )
  select coalesce(array(
    select distinct case when upper(replace(a, ' ', '')) = 'SAV/JMLADEUIX' then 'JITHURBIDE' else upper(replace(a, ' ', '')) end
    from toutes
  ), '{}'::text[])
$$;

grant execute on function public.allocation_ro_blocs_user() to authenticated;
