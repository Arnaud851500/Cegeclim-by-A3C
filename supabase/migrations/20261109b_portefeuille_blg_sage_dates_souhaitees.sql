-- ============================================================================
-- 20261109b_portefeuille_blg_sage_dates_souhaitees.sql
-- Écran « Portefeuille BLG ↔ SAGE » (ventes) : dates de livraison souhaitées
-- en entête et en lignes, SAGE et BLG.
--  - Entête SAGE : activite_entete.date_livraison (déjà en cache : sage_date_livraison)
--  - Entête BLG  : blg.sale_quote.delivery_date_required
--  - Lignes SAGE : activite_lignes.date_livraison des lignes de bon de commande (reste à livrer)
--  - Lignes BLG  : blg.sale_quote_line.delivery_date_required des lignes non livrées
-- Lignes appariées par référence article (SAGE ↔ BLG reference OU internal_reference).
-- Écart = date présente des deux côtés et différente (une date absente n'est pas un écart).
-- ============================================================================

alter table public.portefeuille_blg_sage_cache
  add column if not exists blg_date_livraison_souhaitee date,
  add column if not exists ecart_date_entete boolean not null default false,
  add column if not exists sage_lignes_date_min date,
  add column if not exists sage_lignes_date_max date,
  add column if not exists blg_lignes_date_min date,
  add column if not exists blg_lignes_date_max date,
  add column if not exists nb_lignes_dates_comparees integer not null default 0,
  add column if not exists nb_lignes_ecart_date integer not null default 0;

-- ── Calcul des dates souhaitées dans le cache (appelé par refresh_portefeuille_blg_sage) ──
create or replace function public.maj_portefeuille_blg_sage_dates_livraison()
returns integer
language plpgsql
security definer
set search_path to 'public', 'blg', 'sage'
set statement_timeout to '120s'
as $function$
declare
  v_n integer;
begin
  with c as materialized (
    select reference, blg_id
    from public.portefeuille_blg_sage_cache
    where domaine = 'VENTE'
  ),
  sl as materialized (
    select al.numero_piece as cdc,
           upper(trim(al.reference_article)) as r,
           min(nullif(al.date_livraison, date '1753-01-01')) as d
    from public.activite_lignes al
    join c on c.reference = al.numero_piece
    where al.type_document = 'Bon de commande'
      and upper(trim(coalesce(al.reference_article, ''))) not in ('REF', 'FEDEX', '')
    group by 1, 2
  ),
  bl as materialized (
    select c.reference as cdc,
           upper(trim(ap.reference)) as r1,
           upper(trim(ap.internal_reference)) as r2,
           min(l.delivery_date_required) as d
    from c
    join blg.sale_quote_line l on l.quote_fk = c.blg_id
    left join blg.article_part ap on ap.id = l.article_fk
    where c.blg_id is not null
      and l.type = 'part'
      and coalesce(l.quantity_not_delivered, 0) > 0
    group by 1, 2, 3
  ),
  apparie as (
    select sl.cdc, sl.r,
           bool_or(sl.d is not null and bl.d is not null) as comparee,
           bool_or(sl.d is not null and bl.d is not null and sl.d <> bl.d) as ecart
    from sl
    join bl on bl.cdc = sl.cdc and (bl.r1 = sl.r or bl.r2 = sl.r)
    group by 1, 2
  ),
  s_agg as (select cdc, min(d) as d_min, max(d) as d_max from sl group by cdc),
  b_agg as (select cdc, min(d) as d_min, max(d) as d_max from bl group by cdc),
  a_agg as (
    select cdc, count(*) filter (where comparee) as nb_comp, count(*) filter (where ecart) as nb_ecart
    from apparie group by cdc
  ),
  agg as (
    select c.reference,
           sq.delivery_date_required as blg_ent,
           s_agg.d_min as s_min, s_agg.d_max as s_max,
           b_agg.d_min as b_min, b_agg.d_max as b_max,
           a_agg.nb_comp, a_agg.nb_ecart
    from c
    left join blg.sale_quote sq on sq.id = c.blg_id
    left join s_agg on s_agg.cdc = c.reference
    left join b_agg on b_agg.cdc = c.reference
    left join a_agg on a_agg.cdc = c.reference
  )
  update public.portefeuille_blg_sage_cache p
     set blg_date_livraison_souhaitee = a.blg_ent,
         ecart_date_entete = (a.blg_ent is not null and p.sage_date_livraison is not null and a.blg_ent <> p.sage_date_livraison),
         sage_lignes_date_min = a.s_min,
         sage_lignes_date_max = a.s_max,
         blg_lignes_date_min = a.b_min,
         blg_lignes_date_max = a.b_max,
         nb_lignes_dates_comparees = coalesce(a.nb_comp, 0),
         nb_lignes_ecart_date = coalesce(a.nb_ecart, 0)
    from agg a
   where p.domaine = 'VENTE'
     and p.reference = a.reference;

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- ── Branchement dans refresh_portefeuille_blg_sage (juste avant le volet achats) ──
do $$
declare
  v_def text := pg_get_functiondef('public.refresh_portefeuille_blg_sage()'::regprocedure);
begin
  if position('maj_portefeuille_blg_sage_dates_livraison' in v_def) = 0 then
    v_def := replace(
      v_def,
      'v_achats := public.refresh_portefeuille_blg_sage_achats();',
      'perform public.maj_portefeuille_blg_sage_dates_livraison();' || chr(10) ||
      '  v_achats := public.refresh_portefeuille_blg_sage_achats();'
    );
    execute v_def;
  end if;
end $$;

-- ── Détail des lignes d'une CDC : dates souhaitées SAGE ↔ BLG ──
create or replace function public.get_portefeuille_blg_sage_lignes_dates(p_reference text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'blg', 'sage'
as $function$
declare
  v_ref text := trim(p_reference);
  v jsonb;
begin
  with sl as (
    select coalesce(l.blg_part_id::text, 'REF:' || upper(trim(coalesce(l.reference_article, '')))) as cle,
           min(l.reference_article) as reference_article,
           min(l.designation) as designation,
           sum(coalesce(l.quantite, 0)) as qte,
           sum(coalesce(l.quantite, 0)) filter (where l.etat_code = 'A_LIVRER') as qte_a_livrer,
           string_agg(distinct l.etat_libelle, ', ') as etats,
           min(nullif(l.date_livraison, date '1753-01-01')) filter (where l.etat_code = 'A_LIVRER') as d_min,
           max(nullif(l.date_livraison, date '1753-01-01')) filter (where l.etat_code = 'A_LIVRER') as d_max,
           min(nullif(l.date_livraison, date '1753-01-01')) as d_toutes
    from public.v_cdc_sage_lignes l
    where l.cdc_reference = v_ref and not l.ligne_information
    group by 1
  ),
  bl as (
    select coalesce(l.blg_part_id::text, 'REF:' || upper(trim(coalesce(l.article_reference, '')))) as cle,
           min(l.article_reference) as reference_article,
           min(l.designation) as designation,
           sum(l.quantite) as qte,
           sum(l.qte_a_livrer) as qte_a_livrer,
           string_agg(distinct l.etat_libelle, ', ') as etats,
           min(l.date_livraison_demandee) filter (where l.qte_a_livrer > 0) as d_min,
           max(l.date_livraison_demandee) filter (where l.qte_a_livrer > 0) as d_max,
           min(l.date_livraison_demandee) as d_toutes
    from public.v_cdc_blg_lignes l
    where l.cdc_reference = v_ref
    group by 1
  ),
  x as (
    select coalesce(sl.reference_article, bl.reference_article) as reference_article,
           coalesce(sl.designation, bl.designation) as designation,
           case when sl.cle is not null and bl.cle is not null then 'LES_DEUX'
                when sl.cle is not null then 'SAGE_SEUL' else 'BLG_SEUL' end as presence,
           sl.qte as sage_qte, sl.qte_a_livrer as sage_qte_a_livrer, sl.etats as sage_etats,
           coalesce(sl.d_min, sl.d_toutes) as sage_date_souhaitee,
           (sl.d_max is not null and sl.d_max <> sl.d_min) as sage_plusieurs_dates,
           sl.d_max as sage_date_max,
           bl.qte as blg_qte, bl.qte_a_livrer as blg_qte_a_livrer, bl.etats as blg_etats,
           coalesce(bl.d_min, bl.d_toutes) as blg_date_souhaitee,
           (bl.d_max is not null and bl.d_max <> bl.d_min) as blg_plusieurs_dates,
           bl.d_max as blg_date_max
    from sl
    full outer join bl on bl.cle = sl.cle
  )
  select jsonb_build_object(
    'reference', v_ref,
    'lignes', coalesce(jsonb_agg(
      to_jsonb(x) || jsonb_build_object(
        'ecart_date', (x.sage_date_souhaitee is not null and x.blg_date_souhaitee is not null
                       and x.sage_date_souhaitee <> x.blg_date_souhaitee)
      ) order by x.reference_article), '[]'::jsonb)
  ) into v
  from x;
  return v;
end;
$function$;

grant execute on function public.get_portefeuille_blg_sage_lignes_dates(text) to authenticated;
revoke execute on function public.maj_portefeuille_blg_sage_dates_livraison() from public, anon, authenticated;

-- Premier remplissage sans attendre le passage horaire
select public.maj_portefeuille_blg_sage_dates_livraison();
