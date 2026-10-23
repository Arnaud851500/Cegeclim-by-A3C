-- ============================================================================
-- 20261023c_blg_rattrapage_receptions_cdf.sql
-- ----------------------------------------------------------------------------
-- Copie BLG du compagnon : rattrapage des quantités reçues sur les lignes de commandes
-- fournisseurs. Appliquée en base le 23/10/2026.
--
-- Constat (CDF033774, Airzone, réception BLF041076 du 16/10) : la synchro BLG ne relit une
-- ligne de commande (blg.sale_quote_line) que si sa date de dernière modification a changé.
-- BLG ne met pas cette date à jour quand une réception passe sur la ligne : la réception et
-- l'entête « Livrée » arrivent bien dans le compagnon, mais la ligne garde reçu 0 / reste à
-- recevoir plein. Faux écarts dans le rapprochement SAGE ↔ BLG, couverture de stock et
-- écrans appro faussés. 8 lignes / 7 commandes concernées au 23/10 (réceptions du 15 au 21/10).
--
-- En attendant la correction de la synchro (relire les lignes des commandes réceptionnées),
-- refresh_blg_rattrapage_receptions() recopie sur ces lignes la quantité réellement reçue
-- (somme des lignes de réception BLF « complete » rattachées à la ligne) :
--   quantity_delivered   = quantité reçue
--   quantity_to_deliver  = max(quantité − reçu, 0)
--   delivery_date_actual = date de la dernière réception (si vide)
-- Seules les lignes où BLG est en retard sont touchées (jamais de baisse) ; chaque
-- correction est tracée dans blg.rattrapage_receptions_log. Si la synchro relit plus tard
-- la ligne, elle réécrit les valeurs BLG, qui sont alors les bonnes.
-- Planifiée à :25 et :50 (avant les contrôles CDC de :35 et le rapprochement de :57).
-- ============================================================================

create table if not exists blg.rattrapage_receptions_log (
  id bigserial primary key,
  line_id bigint not null,
  cdf text,
  ancien_livre double precision,
  ancien_reste double precision,
  nouveau_livre double precision,
  nouveau_reste double precision,
  date_reception timestamptz,
  corrige_le timestamptz not null default now()
);
create index if not exists rattrapage_receptions_log_line_idx on blg.rattrapage_receptions_log (line_id);

create or replace function public.refresh_blg_rattrapage_receptions(p_jours integer default 180)
returns integer
language plpgsql security definer set search_path = public, blg
as $$
declare
  n integer;
begin
  with candidates as (
    -- lignes de commande touchées par une réception fournisseur récente
    select distinct ml.line_fk
    from blg.movement_movement_line ml
    join blg.movement_movement m on m.id = ml.movement_fk
    where ml.line_fk is not null and ml.status = 'complete' and m.reference like 'BLF%'
      and coalesce(ml.forced_date, ml.delivery_date, m.created_at) >= now() - make_interval(days => p_jours)
  ),
  recu as (
    select ml.line_fk, sum(ml.quantity) q, max(coalesce(ml.forced_date, ml.delivery_date, m.created_at)) d
    from blg.movement_movement_line ml
    join blg.movement_movement m on m.id = ml.movement_fk
    where ml.line_fk in (select line_fk from candidates) and ml.status = 'complete' and m.reference like 'BLF%'
    group by ml.line_fk
  ),
  a_corriger as (
    select l.id, q.reference cdf, l.quantity_delivered ancien_livre, l.quantity_to_deliver ancien_reste,
           r.q nouveau_livre, greatest(coalesce(l.quantity, 0) - r.q, 0) nouveau_reste, r.d
    from recu r
    join blg.sale_quote_line l on l.id = r.line_fk
    left join blg.sale_quote q on q.id = l.quote_fk
    where coalesce(l.quantity_delivered, 0) + 0.001 < r.q
  ),
  maj as (
    update blg.sale_quote_line l
       set quantity_delivered = c.nouveau_livre,
           quantity_to_deliver = c.nouveau_reste,
           delivery_date_actual = coalesce(l.delivery_date_actual, c.d)
      from a_corriger c
     where l.id = c.id
    returning l.id
  )
  insert into blg.rattrapage_receptions_log (line_id, cdf, ancien_livre, ancien_reste, nouveau_livre, nouveau_reste, date_reception)
  select c.id, c.cdf, c.ancien_livre, c.ancien_reste, c.nouveau_livre, c.nouveau_reste, c.d
  from a_corriger c where c.id in (select id from maj);
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.refresh_blg_rattrapage_receptions(integer) from public, anon, authenticated;

select cron.schedule('blg-rattrapage-receptions-cdf', '25,50 * * * *',
  $c$select public.refresh_blg_rattrapage_receptions(180)$c$);

select public.refresh_blg_rattrapage_receptions(180);
