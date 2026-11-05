-- ============================================================================
-- 20261105_plan_expedition_fms_vue_agence.sql
-- ----------------------------------------------------------------------------
-- Plan d'expédition FMS — vue « frise » par agence (/stock/plan-expedition-fms/agences),
-- demandée par Arnaud le 05/11/2026.
--
--  - Agence = agence du commercial rattaché à la commande (agence_commerciale du calcul).
--  - Lecture : get_plan_exp_agences() (liste des agences et compteurs) et
--    get_plan_exp_agence(p_agence) (lignes de CDC de l'agence tirées du calcul
--    matérialisé appro_plan_exp_lignes + modifications en cours).
--  - Modifications décidées à l'écran (glisser-déposer) : appro_plan_exp_actions.
--    Elles ne touchent pas SAGE : elles sont simulées dans la frise et listées
--    « à reporter dans SAGE » jusqu'à ce qu'on les marque reportées (ou annulées).
--      DEPOT : changement de dépôt de départ de la commande (ex. LA ROCHELLE → FMS)
--      DATE  : nouvelle date de livraison de la commande
--      SPLIT : expédition en deux temps (envoi 1 = dispo, depuis split_depot, le
--              split_date_1 ; envoi 2 = reliquat à complétude, le split_date_2)
--  - Accès réservé à Arnaud (plan_exp_autorise()), comme le plan d'expédition FMS.
-- ============================================================================

create table if not exists public.appro_plan_exp_actions (
  id               bigserial primary key,
  type_action      text not null check (type_action in ('DEPOT', 'DATE', 'SPLIT')),
  numero_document  text not null,
  numero_tiers     text,
  nom_tiers        text,
  agence           text,
  depot_avant      text,
  depot_apres      text,
  date_avant       date,
  date_apres       date,
  split_depot      text,
  split_date_1     date,
  split_date_2     date,
  commentaire      text,
  statut           text not null default 'A_REPORTER' check (statut in ('A_REPORTER', 'REPORTE', 'ANNULE')),
  created_at       timestamptz not null default now(),
  created_by       text default (auth.jwt() ->> 'email'),
  traite_le        timestamptz,
  traite_par       text
);
create index if not exists appro_plan_exp_actions_doc_idx on public.appro_plan_exp_actions (numero_document, type_action, created_at desc);
create index if not exists appro_plan_exp_actions_agence_idx on public.appro_plan_exp_actions (agence, statut);

alter table public.appro_plan_exp_actions enable row level security;
drop policy if exists appro_plan_exp_actions_all on public.appro_plan_exp_actions;
create policy appro_plan_exp_actions_all on public.appro_plan_exp_actions for all to authenticated
  using (public.plan_exp_autorise()) with check (public.plan_exp_autorise());
grant select, insert, update on public.appro_plan_exp_actions to authenticated;
grant usage, select on sequence public.appro_plan_exp_actions_id_seq to authenticated;

-- ─── Liste des agences ──────────────────────────────────────────────────────
create or replace function public.get_plan_exp_agences()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return jsonb_build_object(
    'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
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
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return jsonb_build_object(
    'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.ligne_id, 'doc', l.numero_document, 'chantier', nullif(btrim(e.reference), ''), 'tiers', l.numero_tiers, 'client', l.nom_tiers, 'rep', l.representant,
        'depot', upper(btrim(l.depot_expedition)), 'liv', l.date_livraison, 'crea', l.date_creation,
        'ref', l.reference_article, 'des', l.designation, 'fam', l.famille, 'macro', l.famille_macro, 'role', l.role_famille,
        'qte', l.quantite, 'mt', l.montant_ht, 'q_ag', l.qte_agence, 'q_fms', l.qte_fms_dispo, 'q_att', l.qte_attente,
        'cdf', l.numero_cdf, 'cont', l.container, 'dispo', l.date_dispo, 'sim', l.rdv_simule, 'sans_rec', l.sans_reception,
        'vol', l.vol_unitaire, 'p_d', round(l.palettes_dispo, 3), 'p_a', round(l.palettes_attente, 3), 'statut', l.statut
      ) order by l.nom_tiers, l.numero_document, l.reference_article)
      from appro_plan_exp_lignes l
      left join activite_entete e on e.numero_piece = l.numero_document   -- référence de la pièce = nom du chantier
      where coalesce(l.agence_commerciale, 'NON AFFECTE') = p_agence), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at)
      from appro_plan_exp_actions a
      where a.statut = 'A_REPORTER'
        and (a.agence = p_agence or a.numero_document in (
              select l.numero_document from appro_plan_exp_lignes l where coalesce(l.agence_commerciale, 'NON AFFECTE') = p_agence))), '[]'::jsonb)
  );
end $$;

revoke all on function public.get_plan_exp_agences() from public, anon;
revoke all on function public.get_plan_exp_agence(text) from public, anon;
grant execute on function public.get_plan_exp_agences() to authenticated;
grant execute on function public.get_plan_exp_agence(text) to authenticated;
