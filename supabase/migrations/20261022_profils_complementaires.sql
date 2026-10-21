-- ============================================================================
-- 20261022_profils_complementaires.sql
-- Plusieurs profils d'accès par utilisateur (demandé par Arnaud le 22/10/2026)
-- ----------------------------------------------------------------------------
-- Principe :
--   * user_page_access.access_profile_id reste le PROFIL PRINCIPAL : il donne
--     la page d'accueil, la disposition Vision One Page par défaut et le nom
--     affiché du profil.
--   * user_page_access.profils_complementaires (uuid[]) porte des profils
--     ajoutés : leurs écrans et pastilles d'alerte s'ADDITIONNENT à ceux du
--     profil principal (OU logique, profils inactifs ignorés là où le contrôle
--     l'était déjà).
--   * Le périmètre personnel (agences, collaborateurs, départements, CP,
--     scopes) reste propre à la personne, comme avant.
-- Sans profil complémentaire, le comportement est strictement identique.
-- ============================================================================

-- 1. Colonne ------------------------------------------------------------------
alter table public.user_page_access
  add column if not exists profils_complementaires uuid[] not null default '{}'::uuid[];

comment on column public.user_page_access.profils_complementaires is
  'Profils d''accès ajoutés au profil principal (access_profile_id) : droits cumulés (OU).';

-- 2. Helper : tous les profils d'une personne -------------------------------
create or replace function public.profils_de(p_principal uuid, p_complementaires uuid[])
returns uuid[]
language sql
immutable
parallel safe
as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[])
  from unnest(array_append(coalesce(p_complementaires, '{}'::uuid[]), p_principal)) x
  where x is not null
$$;

-- 3. Nettoyage à l'écriture : pas de doublon, pas de principal en complément --
create or replace function public.user_page_access_normalise_profils()
returns trigger
language plpgsql
as $$
begin
  new.profils_complementaires := coalesce((
    select array_agg(distinct x)
    from unnest(coalesce(new.profils_complementaires, '{}'::uuid[])) x
    where x is not null
      and x is distinct from new.access_profile_id
  ), '{}'::uuid[]);
  return new;
end
$$;

drop trigger if exists trg_user_page_access_normalise_profils on public.user_page_access;
create trigger trg_user_page_access_normalise_profils
  before insert or update of access_profile_id, profils_complementaires
  on public.user_page_access
  for each row execute function public.user_page_access_normalise_profils();

-- 4. Fonctions de type exists(... left join access_profiles p on p.id = u.access_profile_id ...)
--    Un simple changement de jointure suffit : il suffit qu'UN des profils
--    remplisse la condition.
do $mig$
declare
  f text;
  def text;
  nb int;
begin
  foreach f in array array[
    'peut_acceder_financement',
    'peut_gerer_outlook_calendrier',
    'peut_gerer_substitutions_stock',
    'suivi_agences_autorise',
    'todo_is_admin',
    'import_retards_paiement'
  ] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f;

    if def is null then
      raise exception 'Fonction public.% introuvable', f;
    end if;

    nb := (length(def) - length(replace(def, 'p.id = u.access_profile_id', ''))) / length('p.id = u.access_profile_id');
    if nb <> 1 then
      raise exception 'public.% : % occurrence(s) de la jointure profil, 1 attendue', f, nb;
    end if;

    execute replace(def,
      'p.id = u.access_profile_id',
      'p.id = any (public.profils_de(u.access_profile_id, u.profils_complementaires))');
  end loop;
end
$mig$;

-- 5. Fonctions qui lisaient « le » profil avec limit 1 -----------------------
create or replace function public.current_user_can_manage_access()
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $function$
  select exists (
    select 1
    from public.user_page_access u
    join public.access_profiles p
      on p.id = any (public.profils_de(u.access_profile_id, u.profils_complementaires))
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and p.is_active
      and coalesce(p.can_autorisation, false)
  );
$function$;

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $function$
  select exists (
    select 1
    from public.user_page_access u
    join public.access_profiles p
      on p.id = any (public.profils_de(u.access_profile_id, u.profils_complementaires))
    where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
      and p.is_active
      and p.name = 'Administrateur'
  );
$function$;

-- Disposition One Page : celle du profil principal, à défaut celle du premier
-- profil complémentaire (ordre alphabétique) qui en porte une.
create or replace function public.get_vision_tci_effective_layout(p_email text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_perso record;
  v_principal uuid;
  v_compl uuid[];
  v_layout jsonb;
begin
  select personnalise, kpi_cards into v_perso
  from public.vision_tci_preferences
  where user_email = lower(trim(p_email));

  if v_perso.personnalise then
    return coalesce(v_perso.kpi_cards, '[]'::jsonb);
  end if;

  select access_profile_id, profils_complementaires into v_principal, v_compl
  from public.user_page_access
  where email = lower(trim(p_email));

  if v_principal is not null then
    select l.kpi_cards into v_layout
    from public.access_profiles ap
    join public.vision_tci_layouts l on l.id = ap.default_vision_tci_layout_id
    where ap.id = v_principal;
  end if;

  if v_layout is null and coalesce(cardinality(v_compl), 0) > 0 then
    select l.kpi_cards into v_layout
    from public.access_profiles ap
    join public.vision_tci_layouts l on l.id = ap.default_vision_tci_layout_id
    where ap.id = any (v_compl)
      and coalesce(ap.is_active, false)
    order by ap.name
    limit 1;
  end if;

  return coalesce(v_layout, '[]'::jsonb);
end;
$function$;

create or replace function public.suivi_perimetre(out illimite boolean, out agences text[], out collaborateurs text[], out codes text[])
returns record
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_admin boolean;
  v_ag text[];
  v_co text[];
  v_principal uuid;
  v_compl uuid[];
begin
  if public.suivi_appel_technique() then
    illimite := true; agences := '{}'; collaborateurs := '{}'; codes := null;
    return;
  end if;

  select coalesce(u.can_autorisation, false) or coalesce(u.can_change_scope, false),
         coalesce(u.allowed_agences::text[], '{}'),
         coalesce(u.allowed_collaborateurs::text[], '{}'),
         u.access_profile_id,
         u.profils_complementaires
    into v_admin, v_ag, v_co, v_principal, v_compl
  from public.user_page_access u
  where lower(btrim(u.email)) = v_email
  limit 1;

  if not found then
    illimite := false; agences := '{}'; collaborateurs := '{}'; codes := '{}';
    return;
  end if;

  v_admin := coalesce(v_admin, false) or exists (
    select 1
    from public.access_profiles p
    where p.id = any (public.profils_de(v_principal, v_compl))
      and coalesce(p.is_active, false)
      and (
        coalesce(p.can_autorisation, false)
        or coalesce(p.can_change_scope, false)
        or lower(btrim(coalesce(p.name, ''))) = 'administrateur'
      )
  );

  select coalesce(array_agg(distinct a), '{}') into agences
  from (select public.suivi_norm_agence(x) as a from unnest(v_ag) x) s
  where a is not null;

  select coalesce(array_agg(distinct c), '{}') into collaborateurs
  from (select nullif(upper(btrim(x)), '') as c from unnest(v_co) x) s
  where c is not null;

  illimite := v_admin or (cardinality(agences) = 0 and cardinality(collaborateurs) = 0);

  if illimite then
    codes := null;
  elsif cardinality(collaborateurs) > 0 then
    codes := collaborateurs;
  else
    select coalesce(array_agg(distinct upper(btrim(rc.nom))), '{}') into codes
    from public.ref_collaborateurs rc
    where nullif(btrim(rc.nom), '') is not null
      and public.suivi_norm_agence(rc.agence) = any (agences);
  end if;
end
$function$;

-- 6. Policies qui joignaient le profil principal ----------------------------
drop policy if exists objectifs_commerciaux_write on public.objectifs_commerciaux;
create policy objectifs_commerciaux_write on public.objectifs_commerciaux
  for all
  using (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true))
  with check (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true));

drop policy if exists objectifs_commerciaux_select on public.objectifs_commerciaux;
create policy objectifs_commerciaux_select on public.objectifs_commerciaux
  for select
  using (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true));

drop policy if exists objectifs_repartition_write on public.objectifs_repartition_mensuelle;
create policy objectifs_repartition_write on public.objectifs_repartition_mensuelle
  for all to authenticated
  using (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true))
  with check (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true));

drop policy if exists creations_comptes_admin on public.creations_comptes_clients;
create policy creations_comptes_admin on public.creations_comptes_clients
  for all to authenticated
  using (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true))
  with check (exists (
    select 1 from public.user_page_access upa
    join public.access_profiles ap
      on ap.id = any (public.profils_de(upa.access_profile_id, upa.profils_complementaires))
    where lower(upa.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and ap.can_objectifs = true));
