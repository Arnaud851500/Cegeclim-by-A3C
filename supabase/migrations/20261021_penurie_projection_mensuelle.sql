-- ============================================================================
-- 20261021_penurie_projection_mensuelle.sql
-- ----------------------------------------------------------------------------
-- RPC de l'écran « Pénuries — vue mensuelle » (/stock/penurie/mensuel).
-- Appliquée en base le 21/10/2026.
--
-- Une ligne par référence de get_references_penurie(false), avec un tableau
-- jsonb « mois » (mois en cours + p_nb_mois - 1) :
--   arrivages            CDF en cours (v_couverture_stock_receptions) au mois de
--                        réception retenue ; en retard / sans date = mois en cours
--   cdc                  CDC à livrer (interne.v_cdc_lignes_global, même périmètre
--                        que get_references_penurie : ancienneté max
--                        appro_parametres.cdc_a_livrer_anciennete_max_jours) ;
--                        en retard = mois en cours
--   non_tenable          quantité des lignes ouvertes INTENABLE / CREE_RETARD
--                        de v_cdc_promesses_interdites (risque de perte de commande)
--   nb_cdc_non_tenables  nombre de CDC concernées
--   prevision_n1         quantités facturées le même mois l'an dernier
--                        (mois en cours : au prorata des jours restants)
-- + libelle_famille et pert_qte (ref_familles) pour le mode « Qté pertinente ».
-- Les coefficients de prévision (R/O 121 %, R/R 191 %…) et le solde projeté
-- sont appliqués côté écran.
-- ============================================================================

drop function if exists public.get_penurie_projection_mensuelle(integer);

create function public.get_penurie_projection_mensuelle(p_nb_mois integer default 6)
returns table(
  reference_article text, designation text, famille text, libelle_famille text, famille_macro text, pert_qte boolean,
  fournisseur_principal text, nom_fournisseur text, mystock boolean, sommeil boolean,
  arret_appro boolean, en_penurie boolean, cause text, stock_reel numeric, stock_disponible numeric,
  date_prochaine_dispo date, mois jsonb)
language sql stable security definer set search_path = public, interne, sage
as $$
with p as (
  select current_date as auj,
         date_trunc('month', current_date)::date as m0,
         (date_trunc('month', current_date) + make_interval(months => p_nb_mois))::date as mfin,
         coalesce((select valeur from appro_parametres where cle = 'cdc_a_livrer_anciennete_max_jours'), 180)::int as cdc_anc
),
mois as (
  select generate_series(p.m0, p.mfin - interval '1 month', interval '1 month')::date as m from p
),
ref as materialized (select * from get_references_penurie(false)),
cdc as (
  select l.reference_article,
         greatest(date_trunc('month', coalesce(l.date_livraison, p.auj))::date, p.m0) as m,
         sum(l.quantite) q
  from interne.v_cdc_lignes_global l, p
  where coalesce(l.quantite, 0) > 0
    and (l.date_livraison is null or l.date_livraison >= p.auj - p.cdc_anc)
    and coalesce(l.date_livraison, p.auj) < p.mfin
    and l.reference_article <> ''
  group by 1, 2
),
cdf as (
  select r.reference_article,
         greatest(date_trunc('month', coalesce(r.date_reception_retenue, p.auj))::date, p.m0) as m,
         sum(r.quantite_attendue) q
  from v_couverture_stock_receptions r, p
  where coalesce(r.date_reception_retenue, p.auj) < p.mfin
  group by 1, 2
),
nt as (
  select v.reference_article,
         greatest(date_trunc('month', coalesce(v.date_livraison, p.auj))::date, p.m0) as m,
         sum(coalesce(v.quantite_ouverte, v.quantite)) q,
         count(distinct v.numero_document) n
  from v_cdc_promesses_interdites v, p
  where v.ouverte and v.verdict in ('INTENABLE','CREE_RETARD')
    and coalesce(v.date_livraison, p.auj) < p.mfin
  group by 1, 2
),
n1 as (
  select f.reference_article,
         (date_trunc('month', f.date_facture) + interval '1 year')::date as m,
         sum(f.quantite) q
  from facture_lignes f, p
  where f.date_facture >= (p.m0 - interval '1 year') and f.date_facture < (p.mfin - interval '1 year')
  group by 1, 2
),
rf as (
  select distinct on (lower(trim(famille))) lower(trim(famille)) k, libelle_famille, coalesce(pert_qte, false) pert_qte
  from ref_familles order by lower(trim(famille))
)
select r.reference_article, r.designation, r.famille, rf.libelle_famille, r.famille_macro, coalesce(rf.pert_qte, false),
       r.fournisseur_principal, r.nom_fournisseur, r.mystock, r.sommeil,
       r.arret_appro, r.en_penurie, r.cause, r.stock_reel, r.stock_disponible, r.date_prochaine_dispo,
       jsonb_agg(jsonb_build_object(
         'mois', to_char(mo.m, 'YYYY-MM'),
         'arrivages', coalesce(cdf.q, 0),
         'cdc', coalesce(cdc.q, 0),
         'non_tenable', coalesce(nt.q, 0),
         'nb_cdc_non_tenables', coalesce(nt.n, 0),
         'prevision_n1', case when mo.m = (select m0 from p)
              then round(coalesce(n1.q, 0) * (1 - (extract(day from current_date) - 1)
                   / extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))), 1)
              else coalesce(n1.q, 0) end
       ) order by mo.m) as mois
from ref r
left join rf on rf.k = lower(trim(r.famille))
cross join mois mo
left join cdc on cdc.reference_article = r.reference_article and cdc.m = mo.m
left join cdf on cdf.reference_article = r.reference_article and cdf.m = mo.m
left join nt  on nt.reference_article  = r.reference_article and nt.m  = mo.m
left join n1  on n1.reference_article  = r.reference_article and n1.m  = mo.m
group by r.reference_article, r.designation, r.famille, rf.libelle_famille, r.famille_macro, rf.pert_qte,
         r.fournisseur_principal, r.nom_fournisseur, r.mystock, r.sommeil,
         r.arret_appro, r.en_penurie, r.cause, r.stock_reel, r.stock_disponible, r.date_prochaine_dispo;
$$;

grant execute on function public.get_penurie_projection_mensuelle(integer) to authenticated;
