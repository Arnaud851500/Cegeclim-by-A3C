-- 20261118_requeteur_tarifs_blg_vues_public.sql
-- Correctif de 20261117c : la vue v_req_tarifs_articles_blg (security_invoker)
-- lisait les tables blg.* protégées par RLS (rôle blg_sync uniquement) et
-- renvoyait 0 ligne aux utilisateurs du Requêteur. Elle lit désormais les vues
-- miroir public.article_* (même contenu). Le fichier 20261117c a été corrigé
-- dans le même sens ; cette migration réapplique la vue et les listes de choix.
-- Appliquée le 18/11/2026.
create or replace view public.v_req_tarifs_articles_blg with (security_invoker = true) as
with art as (
  select ap.id,
         ap.internal_reference,
         ap.reference,
         case when ap.label like '{%' then (ap.label::jsonb ->> 'fr_FR') else ap.label end as designation,
         case ap.status_fk when 70 then 'Actif' when 7 then 'Archivé' else coalesce(ap.status_fk::text, '—') end as statut_article,
         fp.title as fournisseur_principal
  from public.article_part ap
  left join public.article_supplier fp on fp.id = ap.supplier_fk
),
prix_four as (
  select sp.*,
         row_number() over (partition by sp.article_fk, sp.supplier_fk
                            order by sp.created_at desc nulls last, sp.id desc) as rang
  from public.article_supplier_price sp
)
select
  a.id                                   as blg_id,
  a.internal_reference                   as reference_interne,
  a.reference                            as reference_fournisseur_principal,
  a.designation,
  a.fournisseur_principal,
  a.statut_article,
  'Prix fournisseur (achat)'::text       as type_prix,
  sf.title                               as fournisseur_du_prix,
  case when p.rang = 1 then 'Oui' else 'Non' end as dernier_prix_fournisseur,
  l.title                                as liste_tarif,
  coalesce(l.effective_start_date, p.promotion_start_date::date) as debut_validite,
  coalesce(l.effective_end_date, p.promotion_end_date::date)     as fin_validite,
  round(p.catalogue_price::numeric, 4)   as prix_tarif,
  round(p.catalogue_price_discount::numeric, 4) as remise_pct,
  round(p.purchase_price::numeric, 4)    as prix_achat,
  null::text                             as politique_vente,
  null::numeric                          as prix_vente_fixe,
  null::numeric                          as coefficient,
  p.minimum_quantity::numeric            as quantite_minimum,
  p.created_at                           as date_creation,
  coalesce(p.last_check_date, p.created_at) as date_mise_a_jour,
  case when p.manual_add_date is not null then 'Import / ajout manuel' else 'Reprise / saisie' end as origine
from prix_four p
join art a on a.id = p.article_fk
left join public.article_supplier sf on sf.id = p.supplier_fk
left join public.article_supplier_price_list l on l.id = p.supplier_price_list_fk
union all
select
  a.id,
  a.internal_reference,
  a.reference,
  a.designation,
  a.fournisseur_principal,
  a.statut_article,
  coalesce(t.title::jsonb ->> 'fr_FR', t.name)  as type_prix,
  sf.title,
  null,
  null,
  s.start_date::date,
  nullif(s.end_date::date, date '9999-12-31'),
  null,
  round(s.discount_percentage::numeric, 4),
  null,
  case s.policy
    when 'fixedSalePrice' then 'Prix fixe'
    when 'cataloguePriceXCoefficient' then 'Prix tarif × coefficient'
    else s.policy end,
  round(s.fixed_price::numeric, 4),
  round(s.coefficient::numeric, 4),
  s.minimum_quantity::numeric,
  null,
  s.last_update,
  case when s.global then 'Tous clients' else 'Restreint (client / tag)' end
from public.article_sale_price s
join art a on a.id = s.part_fk
left join public.article_sale_price_type t on t.id = s.sale_price_type_fk
left join public.article_supplier sf on sf.id = s.supplier_fk;

grant select on public.v_req_tarifs_articles_blg to authenticated;

update public.requeteur_champs
   set valeurs_requete = replace(valeurs_requete, 'blg.article', 'public.article')
 where source = 'tarifs_articles_blg' and valeurs_requete like '%blg.article%';
