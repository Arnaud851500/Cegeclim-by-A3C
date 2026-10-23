-- 23/10/2026 — Calcul de besoin : transferts avec protection de l'agence cédante et échéances datées par dépôt.
-- À exécuter en une fois dans l'éditeur SQL Supabase.

-- 1. Sorties BL des 12 derniers mois complets par référence et par dépôt (rafraîchi chaque nuit ; la requête directe prend ~6 s)
create table if not exists public.appro_article_conso_depot (
  reference_article text not null,
  dep text not null,
  qte_12m numeric not null default 0,
  mu_mois numeric not null default 0,
  maj_le timestamptz not null default now(),
  primary key (reference_article, dep)
);
alter table public.appro_article_conso_depot enable row level security;
drop policy if exists appro_article_conso_depot_select on public.appro_article_conso_depot;
create policy appro_article_conso_depot_select on public.appro_article_conso_depot for select to authenticated using (true);
grant select on public.appro_article_conso_depot to authenticated;

create or replace function public.refresh_appro_conso_depot()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  n integer;
  d_fin date := date_trunc('month', current_date)::date;
  d_debut date := (date_trunc('month', current_date) - interval '12 months')::date;
begin
  truncate public.appro_article_conso_depot;
  insert into public.appro_article_conso_depot (reference_article, dep, qte_12m, mu_mois, maj_le)
  select upper(trim(reference_article)),
         upper(trim(regexp_replace(depot, '\s+CEGECLIM\s*$', '', 'i'))),
         sum(quantite_sortie), round(sum(quantite_sortie) / 12.0, 2), now()
  from public.v_stock_sorties_bl_base
  where date_bl >= d_debut and date_bl < d_fin
    and depot is not null and upper(trim(depot)) not in ('GLOBAL', 'NULL', '')
  group by 1, 2
  having sum(quantite_sortie) <> 0;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.refresh_appro_conso_depot() from public, anon;

select public.refresh_appro_conso_depot();

-- 05:20 heure de Paris (03:20 UTC en heure d'été)
select cron.schedule('appro-conso-depot-nightly', '20 3 * * *', 'select public.refresh_appro_conso_depot();');

-- 2. Paramètre : mois de sorties propres conservés par l'agence cédante
insert into public.appro_parametres (cle, valeur, description)
values ('transfert_protection_agence_mois', 3,
        'Transferts depuis une agence (vers FMS ou une autre agence) : quantité laissée à l''agence cédante = N mois de ses propres sorties BL (12 derniers mois)')
on conflict (cle) do nothing;

-- 3. Vue besoin par dépôt : ajoute au détail de chaque dépôt la conso mensuelle et les échéances datées (réservé CDC, encours CDF)
create or replace view public.v_appro_article_besoin_depot as
with sd as (
  select upper(trim(sto_art_num)) as ref,
         upper(trim(regexp_replace(regexp_replace(sto_dep, '^\s*TRANSIT\s+', '', 'i'), '\s+CEGECLIM\s*$', '', 'i'))) as dep,
         (sto_dep ~* '^\s*TRANSIT') as transit,
         coalesce(sto_dispo, 0) as dispo, coalesce(sto_qte, 0) as qte, coalesce(sto_res, 0) as res
  from sage.stock_depot
  where sto_art_num is not null
), enc_l as (
  select upper(trim(article_reference)) as ref,
         upper(trim(regexp_replace(lieu_livraison_nom, '\s+CEGECLIM\s*$', '', 'i'))) as dep,
         date_livraison_estimee as d, sum(quantite_ral) as q
  from public.v_appro_cdf_encours_sage
  where coalesce(quantite_ral, 0) > 0 and article_reference is not null
  group by 1, 2, 3
), enc as (
  select ref, dep, sum(q) as q,
         jsonb_agg(jsonb_build_object('d', d, 'q', q) order by d) as ech
  from enc_l group by 1, 2
), res_l as (
  select upper(trim(reference_article)) as ref,
         upper(trim(regexp_replace(depot, '\s+CEGECLIM\s*$', '', 'i'))) as dep,
         date_livraison as d, sum(quantite) as q
  from public.activite_lignes
  where type_document = 'Bon de commande' and coalesce(quantite, 0) <> 0
    and reference_article is not null and depot is not null
  group by 1, 2, 3
), res_e as (
  select ref, dep, jsonb_agg(jsonb_build_object('d', d, 'q', q) order by d nulls first) as ech
  from res_l group by 1, 2
), s as (
  select ref, dep,
         coalesce(sum(dispo) filter (where not transit), 0) as dispo,
         coalesce(sum(qte) filter (where transit), 0) as transit,
         coalesce(sum(res), 0) as res
  from sd group by 1, 2
), d as (
  select coalesce(s.ref, e.ref) as ref, coalesce(s.dep, e.dep) as dep,
         coalesce(s.dispo, 0) as dispo, coalesce(s.transit, 0) as transit, coalesce(s.res, 0) as res,
         coalesce(e.q, 0) as encours, e.ech as enc_ech
  from s full join enc e on e.ref = s.ref and e.dep = s.dep
), d2 as (
  select d.*,
         (d.dep = 'FMS') as fms,
         greatest(d.res - d.dispo - d.transit, 0) as manque_stock,
         greatest(d.res - d.dispo - d.transit - d.encours, 0) as manque,
         greatest(d.dispo - d.res, 0) as surplus,
         coalesce(c.mu_mois, 0) as conso_mois,
         r.ech as res_ech
  from d
  left join public.appro_article_conso_depot c on c.reference_article = d.ref and c.dep = d.dep
  left join res_e r on r.ref = d.ref and r.dep = d.dep
), agg as (
  select ref,
         sum(manque_stock) filter (where fms) as manque_stock_fms,
         sum(manque) filter (where fms) as manque_fms,
         sum(surplus) filter (where fms) as surplus_fms,
         sum(manque_stock) filter (where not fms) as manque_stock_agences,
         sum(manque) filter (where not fms) as manque_agences,
         sum(surplus) filter (where not fms) as surplus_agences,
         sum(encours) as encours_total,
         jsonb_agg(jsonb_build_object('dep', dep, 'fms', fms, 'res', res, 'dispo', dispo, 'transit', transit, 'encours', encours,
                                      'manque', manque, 'surplus', surplus, 'conso_mois', conso_mois,
                                      'res_ech', coalesce(res_ech, '[]'::jsonb), 'enc_ech', coalesce(enc_ech, '[]'::jsonb))
                   order by fms desc, manque desc, surplus desc, dep)
           filter (where res <> 0 or dispo <> 0 or transit <> 0 or encours <> 0) as detail_depots
  from d2 group by ref
), t as (
  select a.*,
         least(coalesce(a.manque_fms, 0), coalesce(a.surplus_agences, 0)) as transfert_agences_vers_fms,
         least(coalesce(a.manque_agences, 0), coalesce(a.surplus_fms, 0)) as transfert_fms_vers_agences
  from agg a
), t2 as (
  select t.*,
         least(coalesce(t.manque_agences, 0) - t.transfert_fms_vers_agences,
               greatest(coalesce(t.surplus_agences, 0) - t.transfert_agences_vers_fms, 0)) as transfert_inter_agences
  from t
)
select ref as reference_article,
       coalesce(manque_stock_fms, 0) as manque_stock_fms,
       coalesce(manque_fms, 0) as manque_fms,
       coalesce(surplus_fms, 0) as surplus_fms,
       coalesce(manque_stock_agences, 0) as manque_stock_agences,
       coalesce(manque_agences, 0) as manque_agences,
       coalesce(surplus_agences, 0) as surplus_agences,
       coalesce(encours_total, 0) as encours_total,
       transfert_agences_vers_fms,
       transfert_fms_vers_agences,
       transfert_inter_agences,
       greatest(coalesce(manque_fms, 0) + coalesce(manque_agences, 0)
                - transfert_agences_vers_fms - transfert_fms_vers_agences - transfert_inter_agences, 0) as manque_net,
       detail_depots
from t2
where coalesce(manque_stock_fms, 0) + coalesce(manque_stock_agences, 0) > 0;

grant select on public.v_appro_article_besoin_depot to authenticated;
comment on view public.v_appro_article_besoin_depot is
  'Calcul de besoin : par référence et par dépôt, réservé SAGE vs dispo / transit / encours, conso mensuelle du dépôt et échéances datées (res_ech, enc_ech). Les colonnes transfert_* sont brutes (sans date ni protection) : l''écran recalcule les transferts (date de réception, protection de l''agence cédante).';
