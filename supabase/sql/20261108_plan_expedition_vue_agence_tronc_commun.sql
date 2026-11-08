-- ============================================================================
-- 20261108_plan_expedition_vue_agence_tronc_commun.sql
-- ----------------------------------------------------------------------------
-- Plan d'expédition – vue agence (/stock/plan-expedition-fms/agences) ajoutée
-- au tronc commun « Stocks & logistique » (droit can_stocks : profils
-- TCI/TCS, TCS, Logistique), demandé par Arnaud le 08/11/2026.
--
--  - Accès : plan_exp_vue_agence_autorise() = Arnaud (plan_exp_autorise())
--    OU utilisateur ayant can_stocks (user_page_access, alimenté par les profils).
--  - Périmètre : un utilisateur restreint (sans can_autorisation / can_change_scope,
--    avec allowed_agences ou allowed_collaborateurs renseignés) ne voit que les
--    lignes dont l'agence du commercial est dans allowed_agences OU dont le
--    représentant est dans allowed_collaborateurs (cumulatifs, comme ailleurs).
--  - Modifications (glisser-déposer, scission, lieu de livraison, « reporté
--    dans SAGE ») : ouvertes aux mêmes utilisateurs, dans leur périmètre.
--  - Inchangé : le recalcul global refresh_plan_expedition_fms() et l'écran
--    Plan d'expédition FMS restent réservés à Arnaud (plan_exp_autorise()).
-- ============================================================================

-- ─── Accès à la vue agence ──────────────────────────────────────────────────
create or replace function public.plan_exp_vue_agence_autorise()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.plan_exp_autorise()
      or exists (
        select 1 from public.user_page_access u
        where lower(btrim(u.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
          and coalesce(u.can_stocks, false)
      )
$$;
revoke all on function public.plan_exp_vue_agence_autorise() from public, anon;
grant execute on function public.plan_exp_vue_agence_autorise() to authenticated;

-- ─── Périmètre de l'utilisateur courant ─────────────────────────────────────
-- complet = Arnaud, can_autorisation / can_change_scope, ou aucune restriction saisie.
create or replace function public.plan_exp_perimetre()
returns table (complet boolean, agences text[], collabs text[])
language sql
stable
security definer
set search_path = public
as $$
  with u as (
    select
      coalesce(upa.can_autorisation, false) or coalesce(upa.can_change_scope, false) as full_scope,
      coalesce((select array_agg(distinct upper(btrim(x))) from unnest(upa.allowed_agences) x where nullif(btrim(x), '') is not null), '{}'::text[]) as ag,
      coalesce((select array_agg(distinct upper(btrim(x))) from unnest(upa.allowed_collaborateurs) x where nullif(btrim(x), '') is not null), '{}'::text[]) as co
    from public.user_page_access upa
    where lower(btrim(upa.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
    limit 1
  )
  select
    public.plan_exp_autorise()
      or coalesce((select full_scope from u), false)
      or coalesce((select cardinality(ag) = 0 and cardinality(co) = 0 from u), false),
    coalesce((select ag from u), '{}'::text[]),
    coalesce((select co from u), '{}'::text[])
$$;
revoke all on function public.plan_exp_perimetre() from public, anon;
grant execute on function public.plan_exp_perimetre() to authenticated;

-- Une agence est « dans le périmètre » (pour les actions saisies à l'écran).
create or replace function public.plan_exp_agence_dans_perimetre(p_agence text, p_numero_document text default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.plan_exp_perimetre() p
    where p.complet
       or upper(btrim(coalesce(p_agence, ''))) = any (p.agences)
       or exists (
            select 1 from public.appro_plan_exp_lignes l
            where l.numero_document = p_numero_document
              and upper(btrim(coalesce(l.representant, ''))) = any (p.collabs))
  )
$$;
revoke all on function public.plan_exp_agence_dans_perimetre(text, text) from public, anon;
grant execute on function public.plan_exp_agence_dans_perimetre(text, text) to authenticated;

-- ─── Actions (à reporter dans SAGE) ─────────────────────────────────────────
drop policy if exists appro_plan_exp_actions_all on public.appro_plan_exp_actions;
create policy appro_plan_exp_actions_all on public.appro_plan_exp_actions for all to authenticated
  using (
    public.plan_exp_autorise()
    or (public.plan_exp_vue_agence_autorise() and public.plan_exp_agence_dans_perimetre(agence, numero_document))
  )
  with check (
    public.plan_exp_autorise()
    or (public.plan_exp_vue_agence_autorise() and public.plan_exp_agence_dans_perimetre(agence, numero_document))
  );

-- ─── Liste des agences ──────────────────────────────────────────────────────
create or replace function public.get_plan_exp_agences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_complet boolean;
  v_agences text[];
  v_collabs text[];
begin
  if not plan_exp_vue_agence_autorise() then raise exception 'Accès réservé'; end if;
  select p.complet, p.agences, p.collabs into v_complet, v_agences, v_collabs from plan_exp_perimetre() p;

  return jsonb_build_object(
    'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
    'perimetre_complet', v_complet,
    'agences', coalesce((
      select jsonb_agg(x order by x->>'agence')
      from (
        select jsonb_build_object(
          'agence', l.agence,
          'nb_clients', count(distinct l.numero_tiers),
          'nb_cdc', count(distinct l.numero_document),
          'nb_cdc_fms', count(distinct l.numero_document) filter (where upper(btrim(l.depot_expedition)) = 'FMS'),
          'nb_cdc_depot', count(distinct l.numero_document) filter (where upper(btrim(l.depot_expedition)) <> 'FMS'),
          'nb_cdc_incompletes', count(distinct l.numero_document) filter (where l.qte_attente > 0),
          'nb_ge', coalesce(sum(l.quantite) filter (where l.role_famille = 'GROUPE_EXT'), 0),
          'palettes', round(sum(l.palettes_dispo + l.palettes_attente), 1),
          'nb_actions', (select count(*) from appro_plan_exp_actions a where a.agence = l.agence and a.statut = 'A_REPORTER')
        ) as x
        from (select *, coalesce(agence_commerciale, 'NON AFFECTE') as agence from appro_plan_exp_lignes) l
        where v_complet
           or upper(btrim(l.agence)) = any (v_agences)
           or upper(btrim(coalesce(l.representant, ''))) = any (v_collabs)
        group by l.agence
      ) q), '[]'::jsonb)
  );
end $$;

-- ─── Lignes d'une agence ────────────────────────────────────────────────────
create or replace function public.get_plan_exp_agence(p_agence text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_complet boolean;
  v_agences text[];
  v_collabs text[];
begin
  if not plan_exp_vue_agence_autorise() then raise exception 'Accès réservé'; end if;
  select p.complet, p.agences, p.collabs into v_complet, v_agences, v_collabs from plan_exp_perimetre() p;

  return (
    with vis as (
      select l.*
      from appro_plan_exp_lignes l
      where coalesce(l.agence_commerciale, 'NON AFFECTE') = p_agence
        and (v_complet
             or upper(btrim(coalesce(l.agence_commerciale, 'NON AFFECTE'))) = any (v_agences)
             or upper(btrim(coalesce(l.representant, ''))) = any (v_collabs))
    )
    select jsonb_build_object(
      'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
      'perimetre_complet', v_complet,
      'lignes', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', l.ligne_id, 'doc', l.numero_document, 'chantier', coalesce(l.chantier, nullif(btrim(e.reference), '')), 'tiers', l.numero_tiers, 'client', l.nom_tiers, 'rep', l.representant,
          'depot', upper(btrim(l.depot_expedition)), 'liv', l.date_livraison, 'crea', l.date_creation,
          'ref', l.reference_article, 'des', l.designation, 'fam', l.famille, 'macro', l.famille_macro, 'role', l.role_famille,
          'qte', l.quantite, 'mt', l.montant_ht, 'q_ag', l.qte_agence, 'q_fms', l.qte_fms_dispo, 'q_att', l.qte_attente,
          'cdf', l.numero_cdf, 'cont', l.container, 'dispo', l.date_dispo, 'sim', l.rdv_simule, 'sans_rec', l.sans_reception,
          'vol', l.vol_unitaire, 'pu', round(l.palette_unitaire, 4), 'rp', l.regle_palette, 'p_d', round(l.palettes_dispo, 3), 'p_a', round(l.palettes_attente, 3), 'statut', l.statut,
          'lieu_type', l.lieu_type, 'lieu_sage', l.lieu_sage, 'lieu_cle', l.lieu_cle, 'lieu_lib', l.lieu_libelle
        ) order by l.nom_tiers, l.numero_document, l.reference_article)
        from vis l
        left join activite_entete e on e.numero_piece = l.numero_document), '[]'::jsonb),
      'actions', coalesce((
        select jsonb_agg(to_jsonb(a) order by a.created_at)
        from appro_plan_exp_actions a
        where a.statut = 'A_REPORTER'
          and ((a.agence = p_agence and (v_complet or upper(btrim(a.agence)) = any (v_agences)))
               or a.numero_document in (select v.numero_document from vis v))), '[]'::jsonb)
    )
  );
end $$;

revoke all on function public.get_plan_exp_agences() from public, anon;
revoke all on function public.get_plan_exp_agence(text) from public, anon;
grant execute on function public.get_plan_exp_agences() to authenticated;
grant execute on function public.get_plan_exp_agence(text) to authenticated;
