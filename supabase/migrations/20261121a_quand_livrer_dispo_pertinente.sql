-- ============================================================================
-- 20261121a_quand_livrer_dispo_pertinente.sql — « Quand puis-je livrer ? » v2
-- ----------------------------------------------------------------------------
-- Constat (21/11/2026, Arnaud : « on rend une copie un peu noire ») :
--  1. des petits articles largement en stock (RUBBERFOOTLARGE : 898 en stock,
--     GAINECOSOFT200 : 1 186) ressortaient « appro à passer » car TOUTES les CDC
--     du portefeuille, jusqu'à fin 2027, étaient imputées sur le stock du jour ;
--  2. la date de repli « aujourd'hui + délai » prenait le délai paramétré par
--     stratégie fournisseur (180 j pour tout Hitachi Long terme), alors que les
--     réceptions BLG montrent des délais réels de 1 à 3 semaines pour ~250 réf.
--
-- Règles appliquées (règle de dispo posée par Arnaud le 20/09/2026) :
--  - quantité promettable à une date D = point bas du stock projeté entre D et
--    D + délai d'appro : une CDC due au-delà du délai d'appro ne bloque pas le
--    stock, on a le temps de réapprovisionner ;
--  - délai d'appro retenu : délai manuel de la référence (appro_article_stock_min)
--    > délai constaté (médiane commande → réception des lignes de CDF BLG livrées
--    sur 24 mois glissants, au moins 3 réceptions) > délai paramétré
--    (v_appro_delai_article).
--
-- Objets :
--   appro_delai_constate                     cache des délais constatés par référence
--   refresh_appro_delai_constate()           recalcul (pg_cron quotidien 05:10 Paris)
--   get_quand_livrer_dispo(p_lignes jsonb)   remplace get_dispo_lignes_quantites
--                                            pour l'écran (l'ancienne reste en place)
-- ============================================================================

create table if not exists public.appro_delai_constate (
  reference_article text primary key,
  nb_receptions integer not null,
  delai_median_jours integer not null,
  delai_p75_jours integer,
  premiere_commande date,
  derniere_reception date,
  calcule_le timestamptz not null default now()
);
alter table public.appro_delai_constate enable row level security;
drop policy if exists appro_delai_constate_select on public.appro_delai_constate;
create policy appro_delai_constate_select on public.appro_delai_constate for select to authenticated using (true);

create or replace function public.refresh_appro_delai_constate()
returns integer
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '300s'
as $$
declare v_n integer;
begin
  create temp table tmp_delai on commit drop as
  select upper(trim(article_reference)) reference_article,
         count(*)::integer nb_receptions,
         ceil(percentile_cont(0.5) within group (order by (date_livraison::date - cdf_order_date::date)))::integer delai_median_jours,
         ceil(percentile_cont(0.75) within group (order by (date_livraison::date - cdf_order_date::date)))::integer delai_p75_jours,
         min(cdf_order_date::date) premiere_commande,
         max(date_livraison::date) derniere_reception
  from v_appro_cdf_lignes
  where date_livraison is not null and cdf_order_date is not null
    and coalesce(quantite_livree, 0) > 0
    and cdf_order_date >= (current_date - interval '24 months')
    and date_livraison::date >= cdf_order_date::date
    and coalesce(trim(article_reference), '') <> ''
  group by 1
  having count(*) >= 3;

  delete from appro_delai_constate where reference_article is not null;
  insert into appro_delai_constate(reference_article, nb_receptions, delai_median_jours, delai_p75_jours, premiere_commande, derniere_reception)
  select reference_article, nb_receptions, greatest(delai_median_jours, 1), delai_p75_jours, premiere_commande, derniere_reception from tmp_delai;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.get_quand_livrer_dispo(p_lignes jsonb)
returns table(
  reference_article text, qte_demandee numeric, stock_dispo numeric, qte_immediate numeric,
  date_premiere_dispo date, qte_premiere_dispo numeric, date_dispo_complete date, date_complete_source text,
  statut text, blocage_appro boolean, blocage_source text,
  delai_appro_jours integer, delai_source text, delai_parametre_jours integer, delai_constate_jours integer,
  nb_receptions integer, besoins_hors_horizon numeric
)
language sql stable security definer
set search_path to 'public'
as $$
with auj as (select (now() at time zone 'Europe/Paris')::date d),
lg as (
  select upper(trim(x->>'ref')) ref, sum(coalesce(nullif(x->>'qte','')::numeric,1)) qte
  from jsonb_array_elements(coalesce(p_lignes,'[]'::jsonb)) x
  where coalesce(trim(x->>'ref'),'')<>'' group by 1
),
dl as (
  select l.ref,
    coalesce(m.delai_appro_ref_jours, c.delai_median_jours, da.delai_appro_jours,
             (select valeur from appro_parametres where cle='delai_appro_defaut_jours')::integer, 30)::integer h,
    case when m.delai_appro_ref_jours is not null then 'REFERENCE'
         when c.delai_median_jours is not null then 'CONSTATE'
         else 'PARAMETRE' end src,
    da.delai_appro_jours dparam, c.delai_median_jours dconst, c.nb_receptions nrec,
    coalesce(da.arret_appro,false) bl,
    case when da.blocage_appro_sage then 'SAGE' when da.arret_appro_manuel then 'MANUEL' end bls
  from lg l
  left join appro_article_stock_min m on m.reference_article = l.ref
  left join appro_delai_constate c on c.reference_article = l.ref
  left join v_appro_delai_article da on da.reference_article = l.ref
),
besoins as materialized (
  select b.reference_article, b.date_livraison, b.quantite, b.stock_disponible
  from public.get_couverture_stock_besoins(array(select ref from lg)) b
),
s0 as (
  select l.ref, coalesce((select max(b.stock_disponible) from besoins b where b.reference_article=l.ref),
    (select v.stock_disponible from v_stock_articles_latest v where v.reference_article=l.ref),0)::numeric s
  from lg l
),
ev as (
  select l.ref, a.d, 0::numeric q from lg l cross join auj a
  union all
  select c.reference_article, greatest(c.date_reception_retenue::date,a.d), c.quantite_attendue::numeric
  from v_couverture_stock_receptions c join lg l on l.ref=c.reference_article cross join auj a
  where c.quantite_attendue>0
  union all
  select b.reference_article, greatest(coalesce(b.date_livraison::date,a.d),a.d), -b.quantite::numeric
  from besoins b cross join auj a
),
jour as (select ref,d,sum(q) q from ev group by 1,2),
fin_jour as materialized (
  select j.ref, j.d, s0.s + sum(j.q) over (partition by j.ref order by j.d) solde
  from jour j join s0 on s0.ref=j.ref
),
-- Point bas du stock projeté entre d et d + délai d'appro (règle du 20/09/2026).
atp as materialized (
  select f.ref, f.d,
    greatest(0, floor((select min(f2.solde) from fin_jour f2
                        where f2.ref = f.ref and f2.d >= f.d and f2.d <= f.d + dl.h))) atp
  from fin_jour f join dl on dl.ref = f.ref
),
calc as (
  select l.ref, l.qte, s0.s, dl.h, dl.src, dl.dparam, dl.dconst, dl.nrec, dl.bl, dl.bls,
    coalesce((select a.atp from atp a, auj where a.ref=l.ref and a.d=auj.d),0) qi,
    (select min(a.d) from atp a where a.ref=l.ref and a.atp>=1) d1,
    (select a.atp from atp a where a.ref=l.ref and a.atp>=1 order by a.d limit 1) q1,
    (select min(a.d) from atp a where a.ref=l.ref and a.atp>=l.qte) dc,
    (select coalesce(sum(b.quantite),0) from besoins b, auj
      where b.reference_article=l.ref and coalesce(b.date_livraison, auj.d) > auj.d + dl.h) hors
  from lg l join s0 on s0.ref=l.ref join dl on dl.ref=l.ref
)
select c.ref, c.qte, c.s, c.qi, c.d1, c.q1,
  coalesce(c.dc, case when not c.bl then (select d from auj)+c.h end),
  case when c.dc is not null then 'PROJECTION' when not c.bl then 'DELAI_APPRO' else 'AUCUNE' end,
  case when c.qi>=c.qte then 'DISPO'
       when c.dc is not null then 'DATE_FUTURE'
       when c.bl then 'BLOQUE_APPRO'
       else 'SUR_DELAI_APPRO' end,
  c.bl, c.bls, c.h, c.src, c.dparam, c.dconst, c.nrec, c.hors
from calc c;
$$;

revoke all on function public.refresh_appro_delai_constate() from public, anon, authenticated;
revoke all on function public.get_quand_livrer_dispo(jsonb) from public, anon;
grant execute on function public.get_quand_livrer_dispo(jsonb) to authenticated;
grant select on public.appro_delai_constate to authenticated;

select public.refresh_appro_delai_constate();

select cron.unschedule(jobid) from cron.job where jobname = 'appro-delai-constate-refresh';
select cron.schedule('appro-delai-constate-refresh', '10 4 * * *', 'select public.refresh_appro_delai_constate();');
