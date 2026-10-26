-- ============================================================================
-- 20261026b_allocation_airh2o_restes.sql — Allocation AirH2O 600 / 800 (26/10/2026, appliqué en production)
-- ----------------------------------------------------------------------------
-- get_allocation_ro renvoie « restes » : par référence × agence, l'allocation pas encore commandée
-- (Allocation − CDC Liv − BL/PL depuis le 26/10, si > 0) et sa disponibilité :
--   - les CDC 2026 ouvertes (toutes agences) sont servies d'abord, sur le Dispo (Phy-PL) puis les CDF
--     par date de réception retenue (v_couverture_stock_receptions) ;
--   - les restes viennent ensuite, à la suite entre agences (ANGLET, SAV / JMLADEUIX, puis ordre
--     alphabétique) pour ne pas compter deux fois le même stock libre ;
--   - q_stock = part couverte par le stock actuel, q_cdf = part attendue, cdf / date_dispo = CDF qui
--     la complète et sa date ; insuffisant = stock + CDF en cours ne suffisent pas.
--   Le calcul porte sur toutes les agences ; la vue agence ne reçoit que les siennes.
-- À appliquer après 20261026_allocation_airh2o_agences.sql (patch de la fonction en place).
-- ============================================================================

do $do$
declare v text; v0 text;
begin
  v := pg_get_functiondef('public.get_allocation_ro'::regproc); v0 := v;
  if v like '%rst_d%' then return; end if;   -- déjà appliqué
  v := replace(v, $a$  blocs as (
    select b.bloc from ($a$, $a$  sup as (
    select c.ref, 0 as ord, (now() at time zone 'Europe/Paris')::date as d,
           greatest(coalesce(st.reel, 0) - coalesce(st.prepa, 0), 0) as q, null::text as cdf
    from cibles c left join st on st.ref = c.ref
    union all
    select r.reference_article, 1, r.date_reception_retenue, r.quantite_attendue, r.numero_cdf
    from v_couverture_stock_receptions r join cibles c on c.ref = r.reference_article
  ),
  sup_c as (
    select s.*, sum(s.q) over (partition by s.ref order by s.ord, s.d, s.cdf rows unbounded preceding) as cumul from sup s
  ),
  dem as (select ref, sum(q) as q_cdc from lignes_ag where nature = 'CDC' group by 1),
  rst as (
    select a.reference_article as ref, a.bloc, a.quantite as alloc, coalesce(ag.cdc, 0) as cdc, coalesce(ag.post, 0) as post,
           a.quantite - coalesce(ag.cdc, 0) - coalesce(ag.post, 0) as reste,
           coalesce(dm.q_cdc, 0) as q_cdc_tot,
           coalesce((select s.q from sup s where s.ref = a.reference_article and s.ord = 0), 0) as dispo
    from stock_alloc_ro a
    join cibles c on c.ref = a.reference_article
    left join agg ag on ag.ref = a.reference_article and ag.bloc = a.bloc
    left join dem dm on dm.ref = a.reference_article
    where a.quantite - coalesce(ag.cdc, 0) - coalesce(ag.post, 0) > 0
  ),
  rst_cum as (
    select r.*, r.q_cdc_tot + sum(r.reste) over (partition by r.ref order by case r.bloc when 'ANGLET' then 0 when 'JITHURBIDE' then 1 else 2 end, r.bloc
                                                 rows unbounded preceding) as fin_pos
    from rst r
  ),
  rst_d as (
    select r.*, greatest(0, least(r.reste, r.dispo - (r.fin_pos - r.reste))) as q_stock, f.d as date_dispo, f.cdf, f.ord
    from rst_cum r
    left join lateral (
      select sc.d, sc.cdf, sc.ord from sup_c sc
      where sc.ref = r.ref and sc.q > 0 and sc.cumul >= r.fin_pos
      order by sc.ord, sc.d, sc.cdf limit 1
    ) f on true
    where v_complet or r.bloc = any(v_blocs)
  ),
  blocs as (
    select b.bloc from ($a$);
  v := replace(v, $a$    'blocs_user', to_jsonb(v_blocs),$a$, $a$    'blocs_user', to_jsonb(v_blocs),
    'restes', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'bloc', bloc, 'alloc', alloc, 'cdc', cdc, 'post', post, 'reste', reste,
                 'q_stock', q_stock, 'q_cdf', reste - q_stock, 'date_dispo', date_dispo,
                 'cdf', case when ord = 1 then cdf end, 'insuffisant', date_dispo is null) order by ref, bloc), '[]'::jsonb) from rst_d),$a$);
  if v = v0 or v not like '%''restes''%' then raise exception 'patch non appliqué'; end if;
  execute v;
end $do$;
