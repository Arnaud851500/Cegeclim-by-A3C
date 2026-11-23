-- =============================================================================
-- « Quand puis-je livrer ? » — blocage appro lu dans BLG (23/11/2026, demandé par Arnaud)
-- -----------------------------------------------------------------------------
-- Arnaud a mis à jour les références « bloquées appro » dans BLG ; SAGE n'est pas
-- encore à jour. Pour ce contrôle, une référence est non promettable (BLOQUE_APPRO)
-- si :
--   - elle porte dans BLG le tag « Bloqué achat » (core_tag.name = 'purchaseBlocked',
--     table blg.article_article_tag ; appariement article par v_appro_article_blg_cles) ;
--   - ou elle est en arrêt appro manuel (appro_article_stock_min.arret_appro,
--     écran « Calcul d'appro »).
-- Le blocage SAGE (appro_article_blocage) n'est plus lu ici.
--
-- Délai d'un nouvel appro (inchangé, rappel) : délai article saisi dans « Calcul
-- d'appro » (appro_article_stock_min.delai_appro_ref_jours) en priorité, sinon délai
-- constaté (médiane des réceptions), sinon délai du calcul de besoin / fournisseur /
-- défaut (v_appro_delai_article).
--
-- Les dates rendues sont des dates de MISE À DISPOSITION AU DÉPÔT ; l'écran ajoute
-- 7 jours calendaires de logistique pour la date de livraison client.
-- =============================================================================

create or replace function public.get_quand_livrer_dispo(p_lignes jsonb)
returns table(reference_article text, qte_demandee numeric, stock_dispo numeric, qte_immediate numeric,
              date_premiere_dispo date, qte_premiere_dispo numeric, date_dispo_complete date, date_complete_source text,
              statut text, blocage_appro boolean, blocage_source text, delai_appro_jours integer, delai_source text,
              delai_parametre_jours integer, delai_constate_jours integer, nb_receptions integer, besoins_hors_horizon numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
with auj as (select (now() at time zone 'Europe/Paris')::date d),
lg as (
  select upper(trim(x->>'ref')) ref, sum(coalesce(nullif(x->>'qte','')::numeric,1)) qte
  from jsonb_array_elements(coalesce(p_lignes,'[]'::jsonb)) x
  where coalesce(trim(x->>'ref'),'')<>'' group by 1
),
blg_bloque as (
  select distinct k.cle ref
  from blg.article_article_tag t
  join blg.core_tag ct on ct.id = t.tag_fk and ct.name = 'purchaseBlocked'
  join v_appro_article_blg_cles k on k.part_id = t.article_fk
  where k.cle in (select ref from lg)
),
dl as (
  select l.ref,
    coalesce(m.delai_appro_ref_jours, c.delai_median_jours, da.delai_appro_jours,
             (select valeur from appro_parametres where cle='delai_appro_defaut_jours')::integer, 30)::integer h,
    case when m.delai_appro_ref_jours is not null then 'REFERENCE'
         when c.delai_median_jours is not null then 'CONSTATE'
         else 'PARAMETRE' end src,
    da.delai_appro_jours dparam, c.delai_median_jours dconst, c.nb_receptions nrec,
    (b.ref is not null or coalesce(m.arret_appro, false)) bl,
    case when b.ref is not null and coalesce(m.arret_appro, false) then 'BLG+MANUEL'
         when b.ref is not null then 'BLG'
         when coalesce(m.arret_appro, false) then 'MANUEL' end bls
  from lg l
  left join appro_article_stock_min m on m.reference_article = l.ref
  left join appro_delai_constate c on c.reference_article = l.ref
  left join v_appro_delai_article da on da.reference_article = l.ref
  left join blg_bloque b on b.ref = l.ref
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
$function$;
