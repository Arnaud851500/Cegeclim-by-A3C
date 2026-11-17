-- ============================================================================
-- 20261117c_requeteur_tarifs_blg.sql
-- Requêteur métier : nouvelle source « Tarifs articles BLG » (demandé par Arnaud
-- le 17/11/2026, contrôle des tarifs HITACHI).
--
-- Une ligne par prix présent sur la fiche article BLG :
--   - prix fournisseur (article_supplier_price) : prix tarif, remise, prix
--     d'achat, liste de tarif importée (titre, période de validité), date de
--     création, date de dernière vérification, et « Dernier prix du fournisseur »
--     (Oui = la ligne la plus récente de ce fournisseur sur l'article) ;
--   - prix de vente (article_sale_price) : type (Prix public Cegeclim…),
--     politique (prix fixe / prix tarif × coefficient), prix fixe, coefficient,
--     remise, période de validité, date de dernière modification.
-- Filtrable par fournisseur principal, statut de l'article (Actif / Archivé),
-- type de prix, liste de tarif. Source = miroir BLG (schéma blg, synchronisé).
--
-- 18/11/2026 : lecture via les vues miroir public.article_* (les tables blg.*
-- sont sous RLS réservée au rôle de synchronisation : la vue en security_invoker
-- renvoyait 0 ligne aux utilisateurs).
--
-- Limite connue : le type de commande d'appro éventuellement rattaché à un prix
-- fournisseur dans BLG n'est pas présent dans le miroir.
-- ============================================================================

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

insert into public.requeteur_sources (code, libelle, description, icone, vue, ordre, tri_defaut, tri_sens) values
  ('tarifs_articles_blg', 'Tarifs articles BLG',
   'Tous les prix des fiches articles BLG : prix fournisseurs (tarif, remise, achat, liste importée, dates) et prix de vente (Prix public Cegeclim : prix fixe ou tarif × coefficient). Filtrez sur un fournisseur principal et sur les articles actifs.',
   '🏷️', 'v_req_tarifs_articles_blg', 70, 'reference_interne', 'asc')
on conflict (code) do update set libelle = excluded.libelle, description = excluded.description, icone = excluded.icone,
  vue = excluded.vue, ordre = excluded.ordre, tri_defaut = excluded.tri_defaut, tri_sens = excluded.tri_sens, actif = true;

delete from public.requeteur_champs where source = 'tarifs_articles_blg';
insert into public.requeteur_champs (source, code, libelle, groupe, type, ordre, par_defaut, description, valeurs_requete) values
  ('tarifs_articles_blg', 'blg_id', 'BLG ID', 'Article', 'nombre', 10, true, null, null),
  ('tarifs_articles_blg', 'reference_interne', 'Référence interne', 'Article', 'texte', 20, true, null, null),
  ('tarifs_articles_blg', 'reference_fournisseur_principal', 'Référence fournisseur principal', 'Article', 'texte', 30, false, null, null),
  ('tarifs_articles_blg', 'designation', 'Désignation', 'Article', 'texte', 40, true, null, null),
  ('tarifs_articles_blg', 'fournisseur_principal', 'Fournisseur principal', 'Article', 'liste', 50, true, null,
   $L$select distinct title from public.article_supplier where title is not null$L$),
  ('tarifs_articles_blg', 'statut_article', 'Statut article', 'Article', 'liste', 60, true, 'Actif ou Archivé dans BLG.',
   $L$select unnest(array['Actif','Archivé'])$L$),
  ('tarifs_articles_blg', 'type_prix', 'Type de prix', 'Prix', 'liste', 70, true, 'Prix fournisseur (achat), Prix public Cegeclim, Prix promo…',
   $L$select distinct type_prix from public.v_req_tarifs_articles_blg$L$),
  ('tarifs_articles_blg', 'fournisseur_du_prix', 'Fournisseur du prix', 'Prix', 'liste', 80, true, null,
   $L$select distinct title from public.article_supplier where title is not null$L$),
  ('tarifs_articles_blg', 'dernier_prix_fournisseur', 'Dernier prix du fournisseur', 'Prix', 'liste', 90, true,
   'Oui = ligne de prix la plus récente de ce fournisseur sur l''article.', $L$select unnest(array['Oui','Non'])$L$),
  ('tarifs_articles_blg', 'liste_tarif', 'Liste de tarif importée', 'Prix', 'liste', 100, true, null,
   $L$select distinct title from public.article_supplier_price_list where title is not null$L$),
  ('tarifs_articles_blg', 'debut_validite', 'Début de validité', 'Prix', 'date', 110, true, null, null),
  ('tarifs_articles_blg', 'fin_validite', 'Fin de validité', 'Prix', 'date', 120, true, null, null),
  ('tarifs_articles_blg', 'prix_tarif', 'Prix tarif', 'Achat', 'montant', 130, true, null, null),
  ('tarifs_articles_blg', 'remise_pct', 'Remise %', 'Achat', 'nombre', 140, true, null, null),
  ('tarifs_articles_blg', 'prix_achat', 'Prix d''achat', 'Achat', 'montant', 150, true, null, null),
  ('tarifs_articles_blg', 'politique_vente', 'Politique de prix de vente', 'Vente', 'liste', 160, true, null,
   $L$select unnest(array['Prix fixe','Prix tarif × coefficient'])$L$),
  ('tarifs_articles_blg', 'prix_vente_fixe', 'Prix de vente fixé', 'Vente', 'montant', 170, true, null, null),
  ('tarifs_articles_blg', 'coefficient', 'Coefficient', 'Vente', 'nombre', 180, true, 'Coefficient enregistré (appliqué seulement si la politique est « Prix tarif × coefficient »).', null),
  ('tarifs_articles_blg', 'quantite_minimum', 'Quantité minimum', 'Prix', 'nombre', 190, false, null, null),
  ('tarifs_articles_blg', 'date_creation', 'Date de création du prix', 'Dates', 'date', 200, true, null, null),
  ('tarifs_articles_blg', 'date_mise_a_jour', 'Date de mise à jour', 'Dates', 'date', 210, true, 'Prix fournisseur : dernière vérification ; prix de vente : dernière modification.', null),
  ('tarifs_articles_blg', 'origine', 'Origine', 'Dates', 'liste', 220, false, null,
   $L$select unnest(array['Import / ajout manuel','Reprise / saisie','Tous clients','Restreint (client / tag)'])$L$);
