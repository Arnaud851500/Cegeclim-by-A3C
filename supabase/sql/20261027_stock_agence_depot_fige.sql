-- ============================================================================
-- 20261027_stock_agence_depot_fige.sql — Analyse Stock Dépôt (27/10/2026, appliqué en production)
-- ----------------------------------------------------------------------------
-- Demande d'Arnaud : l'écran /stock/analyse-agence est figé sur l'agence du collaborateur.
--   - L'agence vient du périmètre de la personne (user_page_access.allowed_agences,
--     onglet Utilisateurs d'Autorisations). Périmètre vide (direction, administrateurs) =
--     tous les dépôts, comme avant.
--   - Agence → dépôt : libellé du dépôt sans « CEGECLIM » ni espaces (LA ROCHELLE = LAROCHELLE) ;
--     MEES = dépôt DAX (7). Une agence sans dépôt suivi (ex. PERIGUEUX) n'ouvre aucun dépôt.
--   - Contrôle dans get_stock_agence_analyse et get_stock_agence_article (pas seulement à l'écran).
-- ============================================================================

-- null = pas de restriction ; sinon les dépôts autorisés (éventuellement vide)
create or replace function public.stock_agence_depots_user()
returns text[]
language sql stable security definer
set search_path to 'public'
as $$
  with u as (
    select coalesce(u.allowed_agences, '{}'::text[]) as ag
    from public.user_page_access u
    where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1
  ),
  ag as (
    select distinct case when x = 'MEES' then 'DAX' else x end as a
    from u cross join unnest(u.ag) t
    cross join lateral (select upper(replace(trim(t), ' ', '')) as x) n
    where nullif(trim(t), '') is not null
  )
  select case
    when not exists (select 1 from ag) then null
    else coalesce(array(
      select d.depot_num from public.stock_agence_depots d
      where not d.central
        and upper(replace(replace(d.libelle, 'CEGECLIM', ''), ' ', '')) in (select a from ag)
      order by d.ordre
    ), '{}'::text[])
  end
$$;

grant execute on function public.stock_agence_depots_user() to authenticated;

do $do$
declare f text; v text; v0 text;
begin
  foreach f in array array['public.get_stock_agence_analyse(text,date)', 'public.get_stock_agence_article(text,text,date)'] loop
    v := pg_get_functiondef(f::regprocedure); v0 := v;
    if v like '%stock_agence_depots_user%' then continue; end if;
    v := replace(v, $a$begin
  select * into d from stock_agence_depots where depot_num = p_depot_num;$a$, $a$begin
  -- 27/10/2026 : analyse figée sur le dépôt de l'agence du collaborateur
  if public.stock_agence_depots_user() is not null and not (p_depot_num = any(public.stock_agence_depots_user())) then
    raise exception 'Dépôt non autorisé : l''analyse est limitée au dépôt de votre agence' using errcode = '42501';
  end if;
  select * into d from stock_agence_depots where depot_num = p_depot_num;$a$);
    if v = v0 then raise exception 'patch non appliqué sur %', f; end if;
    execute v;
  end loop;
end $do$;
