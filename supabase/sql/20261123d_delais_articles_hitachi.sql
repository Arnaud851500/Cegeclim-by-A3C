-- =============================================================================
-- Délais d'appro article Hitachi (23/11/2026, demandé par Arnaud)
-- -----------------------------------------------------------------------------
-- Paramétrage des délais articles de « Calcul d'appro »
-- (appro_article_stock_min.delai_appro_ref_jours, prioritaire sur les délais
-- fournisseur / constatés dans le calcul de besoin ET dans « Quand puis-je livrer ? »
-- quand un nouvel appro est nécessaire) :
--   - CONTAINER : références présentes dans une CDF BLG Hitachi « CONT… »
--     (sale_quote.supplier_reference ilike 'CONT%', fournisseur fH0001) passée
--     sur les 9 derniers mois → 180 jours (y compris en sommeil) ;
--   - autres références Hitachi actives (ref_articles.fournisseur_principal H0001,
--     non en sommeil) : tag BLG « FMS » → 90 jours, sans tag FMS → 20 jours.
-- Périmètre « Hitachi seulement » choisi par Arnaud ; les autres fournisseurs gardent
-- leur délai. Trace et valeurs précédentes : appro_delai_maj_20261123 (retour arrière :
-- update appro_article_stock_min m set delai_appro_ref_jours = t.delai_avant
-- from appro_delai_maj_20261123 t where t.reference_article = m.reference_article).
-- =============================================================================

create table if not exists public.appro_delai_maj_20261123 (
  reference_article text primary key,
  designation text,
  fournisseur text,
  categorie text not null,          -- CONTAINER | FMS | HORS_FMS
  nb_cdf_container integer,
  derniere_cdf_container date,
  sommeil boolean,
  delai_avant integer,
  delai_nouveau integer not null,
  maj_le timestamptz not null default now()
);
alter table public.appro_delai_maj_20261123 enable row level security;
drop policy if exists appro_delai_maj_20261123_select on public.appro_delai_maj_20261123;
create policy appro_delai_maj_20261123_select on public.appro_delai_maj_20261123 for select to authenticated using (true);

truncate public.appro_delai_maj_20261123;

with cont as (
  select upper(trim(x)) ref, count(distinct sq.id) nb, max(sq.order_date)::date derniere
  from blg.sale_quote sq
  join blg.sale_quote_line l on l.quote_fk = sq.id
  join blg.article_part ap on ap.id = l.article_fk,
  lateral unnest(array[ap.reference, ap.internal_reference]) x
  where sq.type = 'purchase' and sq.supplier_reference ilike 'CONT%'
    and sq.order_date >= current_date - interval '9 months'
    and sq.supplier_fk in (select supplier_id from v_appro_fournisseurs where upper(code_fournisseur) = 'FH0001')
    and nullif(trim(x), '') is not null
  group by 1),
fms as (
  select distinct upper(trim(x)) ref
  from blg.article_article_tag t
  join blg.core_tag ct on ct.id = t.tag_fk and ct.name = 'usertag_vlnkg'   -- tag « FMS »
  join blg.article_part ap on ap.id = t.article_fk,
  lateral unnest(array[ap.reference, ap.internal_reference]) x
  where nullif(trim(x), '') is not null),
cible as (
  select r.reference_article, r.designation, r.fournisseur_principal, coalesce(r.mise_en_sommeil, false) sommeil,
         c.nb, c.derniere,
         case when c.ref is not null then 'CONTAINER' when f.ref is not null then 'FMS' else 'HORS_FMS' end categorie
  from ref_articles r
  left join cont c on c.ref = r.reference_article
  left join fms f on f.ref = r.reference_article
  where c.ref is not null
     or (upper(coalesce(r.fournisseur_principal, '')) like '%H0001%' and not coalesce(r.mise_en_sommeil, false))
)
insert into public.appro_delai_maj_20261123 (reference_article, designation, fournisseur, categorie, nb_cdf_container, derniere_cdf_container, sommeil, delai_avant, delai_nouveau)
select c.reference_article, c.designation, c.fournisseur_principal, c.categorie, c.nb, c.derniere, c.sommeil,
       m.delai_appro_ref_jours,
       case c.categorie when 'CONTAINER' then 180 when 'FMS' then 90 else 20 end
from cible c
left join appro_article_stock_min m on m.reference_article = c.reference_article;

insert into public.appro_article_stock_min (reference_article, delai_appro_ref_jours)
select reference_article, delai_nouveau from public.appro_delai_maj_20261123
on conflict (reference_article) do update set delai_appro_ref_jours = excluded.delai_appro_ref_jours
where appro_article_stock_min.delai_appro_ref_jours is distinct from excluded.delai_appro_ref_jours;
