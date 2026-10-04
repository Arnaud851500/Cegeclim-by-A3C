-- =====================================================================
-- Calcul de besoin - Appro (2026-10-04)
--
-- Écran /stock/calcul-besoin : paramètres d'appro modifiables ligne à ligne,
-- choix de la conso retenue par article, écrêtage des ventes exceptionnelles.
--
--   1. appro_article_stock_min : surcharges article (stratégie, conso retenue, coef)
--      — s'ajoutent aux surcharges existantes (méthode, couvertures, délais) ;
--      conservées par refresh_appro_calcul_besoin (non listées dans son UPDATE).
--   2. appro_fournisseur_strategie : conso retenue par défaut du fournisseur (+ coef).
--   3. appro_article_conso_ecretage : mois écrêtés (quantité retenue à la place de la sortie réelle).
--   4. v_appro_article_conso_profil : μ 12 mois, σ, μ 3 mois, μ des 3 prochains mois de N−1,
--      calculés en direct avec l'écrêtage, + surcharges conso / stratégie de l'article.
--   5. appro_article_sorties_clients(ref, mois) : clients derrière les sorties d'un mois
--      (lecture d'un pic de vente dans la fenêtre article).
--   6. refresh_appro_calcul_besoin : identique, sauf que μ / σ / stock min tiennent
--      compte des mois écrêtés.
--
-- Hiérarchie des paramètres d'appro (écran) : article > fournisseur > paramètre global.
-- =====================================================================

-- 1. Surcharges article ---------------------------------------------------
alter table public.appro_article_stock_min
  add column if not exists conso_source    text,
  add column if not exists conso_coef      numeric,
  add column if not exists strategie_appro text;

alter table public.appro_article_stock_min drop constraint if exists appro_article_stock_min_conso_source_check;
alter table public.appro_article_stock_min
  add constraint appro_article_stock_min_conso_source_check
  check (conso_source is null or conso_source in ('12m', '3m', 'fut3', 'fut3_coef'));
alter table public.appro_article_stock_min drop constraint if exists appro_article_stock_min_conso_coef_check;
alter table public.appro_article_stock_min
  add constraint appro_article_stock_min_conso_coef_check
  check (conso_coef is null or (conso_coef > 0 and conso_coef <= 10));

comment on column public.appro_article_stock_min.conso_source is
  'Conso retenue pour le calcul de besoin (surcharge article) : 12m = moyenne 12 derniers mois, 3m = 3 derniers mois, fut3 = moyenne des 3 prochains mois en N-1, fut3_coef = idem × conso_coef. Null = fournisseur, sinon paramètre global.';
comment on column public.appro_article_stock_min.strategie_appro is
  'Stratégie d''appro propre à l''article (Long terme, Au fil de l''eau, A la demande). Null = stratégie du fournisseur. "A la demande" = aucune proposition de réappro.';

-- 2. Défaut fournisseur -----------------------------------------------------
alter table public.appro_fournisseur_strategie
  add column if not exists conso_source text,
  add column if not exists conso_coef   numeric;

alter table public.appro_fournisseur_strategie drop constraint if exists appro_fournisseur_strategie_conso_source_check;
alter table public.appro_fournisseur_strategie
  add constraint appro_fournisseur_strategie_conso_source_check
  check (conso_source is null or conso_source in ('12m', '3m', 'fut3', 'fut3_coef'));
alter table public.appro_fournisseur_strategie drop constraint if exists appro_fournisseur_strategie_conso_coef_check;
alter table public.appro_fournisseur_strategie
  add constraint appro_fournisseur_strategie_conso_coef_check
  check (conso_coef is null or (conso_coef > 0 and conso_coef <= 10));

-- 3. Écrêtage des mois exceptionnels -------------------------------------------
create table if not exists public.appro_article_conso_ecretage (
  reference_article text not null,
  mois              date not null,                     -- 1er du mois
  qte_origine       numeric,                           -- sortie réelle au moment de l'écrêtage (information)
  qte_retenue       numeric not null check (qte_retenue >= 0),
  motif             text,
  cree_par          text default (auth.jwt() ->> 'email'),
  cree_le           timestamptz not null default now(),
  primary key (reference_article, mois),
  check (mois = date_trunc('month', mois)::date)
);

alter table public.appro_article_conso_ecretage enable row level security;
drop policy if exists appro_article_conso_ecretage_all_authenticated on public.appro_article_conso_ecretage;
create policy appro_article_conso_ecretage_all_authenticated on public.appro_article_conso_ecretage
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.appro_article_conso_ecretage to authenticated;

-- 4. Profil de conso par article (direct, écrêtage compris) -----------------
--    Fenêtre identique au calcul des stocks min : 12 mois complets avant le mois en cours.
--    μ 3 prochains mois N-1 = moyenne des mois M+1, M+2, M+3 de l'an dernier (M = mois en cours).
create or replace view public.v_appro_article_conso_profil
with (security_invoker = true) as
with bornes as (
  select date_trunc('month', current_date)::date as fin
),
serie as (
  select c.reference_article, c.mois, coalesce(e.qte_retenue, c.qte) as qte
  from public.appro_article_conso_mensuelle c
  left join public.appro_article_conso_ecretage e
         on e.reference_article = c.reference_article and e.mois = c.mois
),
stats as (
  select s.reference_article,
         sum(s.qte)       filter (where s.mois >= (b.fin - interval '12 months')::date and s.mois < b.fin) as tot12,
         sum(s.qte * s.qte) filter (where s.mois >= (b.fin - interval '12 months')::date and s.mois < b.fin) as sq12,
         sum(s.qte)       filter (where s.mois >= (b.fin - interval '3 months')::date  and s.mois < b.fin) as tot3,
         sum(s.qte)       filter (where s.mois >= (b.fin - interval '11 months')::date and s.mois < (b.fin - interval '8 months')::date) as totfut3
  from serie s cross join bornes b
  group by s.reference_article
),
ecretes as (
  select reference_article, count(*) as nb from public.appro_article_conso_ecretage group by 1
)
select sm.reference_article,
       round(coalesce(st.tot12, 0) / 12.0, 2)                                                         as mu12,
       round(sqrt(greatest(coalesce(st.sq12, 0) / 12.0 - power(coalesce(st.tot12, 0) / 12.0, 2), 0)), 2) as sigma12,
       round(coalesce(st.tot3, 0) / 3.0, 2)                                                           as mu3,
       round(coalesce(st.totfut3, 0) / 3.0, 2)                                                        as mu_fut3,
       (b.fin - interval '11 months')::date                                                          as fut3_debut,
       coalesce(ec.nb, 0)::int                                                                        as nb_mois_ecretes,
       sm.conso_source,
       sm.conso_coef,
       sm.strategie_appro
from public.appro_article_stock_min sm
cross join bornes b
left join stats st   on st.reference_article = sm.reference_article
left join ecretes ec on ec.reference_article = sm.reference_article;

grant select on public.v_appro_article_conso_profil to authenticated;

-- 5. Clients derrière les sorties d'un mois -------------------------------------
create or replace function public.appro_article_sorties_clients(p_reference text, p_mois date)
returns table (numero_tiers text, intitule_tiers text, nb_bl bigint, qte numeric, montant numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with bornes as (
    select date_trunc('month', p_mois)::date as debut, (date_trunc('month', p_mois) + interval '1 month')::date as fin
  ),
  lignes as (
    select coalesce(nullif(f.numero_tiers_entete, ''), f.numero_tiers_ligne)     as tiers,
           coalesce(nullif(f.intitule_tiers_entete, ''), f.intitule_tiers_ligne) as nom,
           f.numero_piece_bl                                                       as bl,
           case when upper(coalesce(f.type_document, '')) in ('FAV', 'FAR', 'AVOIR', 'AVOIR CLIENT', 'BR', 'BON DE RETOUR') then -1 else 1 end
             * abs(coalesce(nullif(f.qte_livree, 0), nullif(f.quantite, 0), 0))   as q,
           case when upper(coalesce(f.type_document, '')) in ('FAV', 'FAR', 'AVOIR', 'AVOIR CLIENT', 'BR', 'BON DE RETOUR') then -1 else 1 end
             * abs(coalesce(f.montant_ht, 0))                                      as m
    from facture_lignes f, bornes b
    where f.reference_article = p_reference
      and f.date_bl >= b.debut and f.date_bl < b.fin
      and coalesce(nullif(f.qte_livree, 0), nullif(f.quantite, 0), 0) <> 0
    union all
    select coalesce(nullif(a.numero_tiers_entete, ''), a.numero_tiers_ligne),
           coalesce(nullif(a.intitule_tiers_entete, ''), a.intitule_tiers_ligne),
           a.numero_piece,
           case when upper(coalesce(a.type_document, '')) in ('BR', 'BON DE RETOUR', 'RETOUR', 'AVOIR', 'FAV', 'FAR') then -1 else 1 end
             * abs(coalesce(nullif(a.qte_livree, 0), nullif(a.quantite, 0), 0)),
           case when upper(coalesce(a.type_document, '')) in ('BR', 'BON DE RETOUR', 'RETOUR', 'AVOIR', 'FAV', 'FAR') then -1 else 1 end
             * abs(coalesce(a.montant_ht, 0))
    from activite_lignes a, bornes b
    where a.reference_article = p_reference
      and a.date_bl >= b.debut and a.date_bl < b.fin
      and upper(coalesce(a.type_document, '')) in ('BL', 'BON DE LIVRAISON', 'BR', 'BON DE RETOUR', 'RETOUR')
      and coalesce(nullif(a.qte_livree, 0), nullif(a.quantite, 0), 0) <> 0
      and not exists (select 1 from facture_lignes f
                      where f.reference_article = a.reference_article and f.date_bl is not null
                        and f.numero_piece_bl is not null and f.numero_piece_bl = a.numero_piece)
  )
  select tiers, max(nom), count(distinct bl), round(sum(q), 2), round(sum(m), 2)
  from lignes
  group by tiers
  order by sum(q) desc
  limit 15;
$$;

revoke all on function public.appro_article_sorties_clients(text, date) from public, anon;
grant execute on function public.appro_article_sorties_clients(text, date) to authenticated;

-- 6. Calcul des stocks min : prise en compte de l'écrêtage --------------------
--    Seule différence avec la version précédente : la grille mensuelle (μ, σ, conso 3 mois)
--    lit la quantité écrêtée quand un mois a été écrêté.
CREATE OR REPLACE FUNCTION public.refresh_appro_calcul_besoin(p_horizon_mois integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'sage'
 SET statement_timeout TO '120s'
AS $function$
declare
  v_h        int;
  v_z        numeric;
  v_delai    int;
  v_secu     int;
  v_revue    int;
  v_debut    date;
  v_fin      date;
  v_nb_conso int;
  v_nb_art   int;
  v_seuil    numeric;
  v_alerte   text;
begin
  select coalesce(p_horizon_mois, (select valeur::int from appro_parametres where cle='horizon_mois'), 12) into v_h;
  select coalesce((select valeur from appro_parametres where cle='niveau_service_z'), 1.65) into v_z;
  select coalesce((select valeur::int from appro_parametres where cle='delai_appro_defaut_jours'), 30) into v_delai;
  select coalesce((select valeur::int from appro_parametres where cle='delai_securite_defaut_jours'), 7) into v_secu;
  select coalesce((select valeur::int from appro_parametres where cle='periode_revue_jours'), 30) into v_revue;
  select coalesce((select valeur::numeric from appro_parametres where cle='controle_conso_seuil_baisse'), 0.10) into v_seuil;

  v_fin   := date_trunc('month', current_date)::date;
  v_debut := (v_fin - make_interval(months => v_h))::date;

  -- Nouvelle conso mensuelle (BL reconstitués), calculée à part avant de
  -- remplacer la table : permet le contrôle ci-dessous.
  create temp table _tmp_conso_mensuelle on commit drop as
  select reference_article, date_trunc('month', date_bl)::date as mois,
         sum(quantite_sortie) as qte, sum(montant_sortie) as montant, count(distinct numero_bl) as nb_bl
  from v_stock_sorties_bl_base
  where date_bl >= (v_fin - make_interval(months => v_h + 12))::date
  group by 1, 2;

  -- GARDE-FOU (02/10/2026) : un mois clos de l'horizon dont la conso totale
  -- baisse de plus de v_seuil par rapport au calcul précédent signale des
  -- données de facturation incomplètes -> on s'arrête, valeurs conservées.
  -- (controle_conso_seuil_baisse = 1 pour désactiver ponctuellement.)
  if v_seuil < 1 then
    select string_agg(to_char(a.mois, 'MM/YYYY') || ' : ' || round(a.qte) || ' → ' || round(coalesce(n.qte, 0)), ', ' order by a.mois)
      into v_alerte
    from (select mois, sum(qte) as qte from appro_article_conso_mensuelle
          where mois >= v_debut and mois < v_fin group by 1) a
    left join (select mois, sum(qte) as qte from _tmp_conso_mensuelle group by 1) n on n.mois = a.mois
    where a.qte > 0 and coalesce(n.qte, 0) < a.qte * (1 - v_seuil);

    if v_alerte is not null then
      raise exception 'Calcul interrompu : la conso de certains mois a chuté de plus de % %% depuis le dernier calcul (%). Données de facturation probablement incomplètes — les stocks min précédents sont conservés.',
        round(v_seuil * 100), v_alerte
        using hint = 'Vérifier facture_lignes. Pour forcer : appro_parametres.controle_conso_seuil_baisse = 1, relancer, puis remettre 0.10.';
    end if;
  end if;

  truncate table appro_article_conso_mensuelle;
  insert into appro_article_conso_mensuelle (reference_article, mois, qte, montant, nb_bl)
  select reference_article, mois, qte, montant, nb_bl from _tmp_conso_mensuelle;
  get diagnostics v_nb_conso = row_count;

  with mois as (
    select generate_series(v_debut, v_fin - interval '1 month', interval '1 month')::date as mois
  ),
  arts as (select a.reference_article, a.fournisseur_principal from ref_articles a),
  grille as (
    -- 04/10/2026 : un mois écrêté (appro_article_conso_ecretage) compte pour sa quantité retenue
    select ar.reference_article, ar.fournisseur_principal, m.mois,
           coalesce(e.qte_retenue, c.qte, 0) as qte
    from arts ar cross join mois m
    left join appro_article_conso_mensuelle c on c.reference_article = ar.reference_article and c.mois = m.mois
    left join appro_article_conso_ecretage e on e.reference_article = c.reference_article and e.mois = c.mois
  ),
  stats as (
    select reference_article, fournisseur_principal,
           sum(qte) as conso_horizon, avg(qte) as mu, coalesce(stddev_pop(qte), 0) as sigma,
           sum(qte) filter (where mois >= (v_fin - interval '3 months')::date) as conso_3m,
           count(*) filter (where qte > 0) as nb_mois_avec_sortie
    from grille group by 1, 2
  ),
  bornes as (
    select reference_article,
           min(mois) filter (where qte > 0) as premiere_sortie,
           max(mois) filter (where qte > 0) as derniere_sortie,
           sum(qte) filter (where mois = v_fin) as conso_mois_en_cours
    from appro_article_conso_mensuelle group by 1
  ),
  colis as (
    select ar_ref, max(af_colisage) as colisage from sage.fia where af_principal = '1' and coalesce(af_colisage, 0) > 1 group by 1
  ),
  calc as (
    select s.reference_article, s.fournisseur_principal,
           s.conso_horizon, s.mu, s.sigma, s.conso_3m, s.nb_mois_avec_sortie,
           b.premiere_sortie, b.derniere_sortie, coalesce(b.conso_mois_en_cours, 0) as conso_mois_en_cours,
           -- délais : référence (saisie manuelle) > paramètres article > fournisseur > défaut
           coalesce(sm.delai_appro_ref_jours, sap.delai_appro_jours, fs.delai_appro_jours, v_delai) as delai,
           coalesce(sm.delai_securite_ref_jours, fs.delai_securite_jours, v_secu) as secu,
           coalesce(fs.niveau_service_z, v_z) as z,
           co.colisage
    from stats s
    left join bornes b on b.reference_article = s.reference_article
    left join appro_fournisseur_strategie fs on fs.fournisseur = s.fournisseur_principal
    left join stock_article_parametres sap on sap.reference_article = s.reference_article
    left join appro_article_stock_min sm on sm.reference_article = s.reference_article
    left join colis co on co.ar_ref = s.reference_article
  ),
  final as (
    select c.*, (c.delai + c.secu) as l_jours,
           round(c.z * c.sigma * sqrt((c.delai + c.secu)::numeric / 30), 2) as ss,
           ceil(c.mu * (c.delai + c.secu) / 30 + c.z * c.sigma * sqrt((c.delai + c.secu)::numeric / 30)) as smin_brut
    from calc c
  )
  insert into appro_article_stock_min as t (
    reference_article, fournisseur_principal, horizon_mois,
    conso_horizon, conso_moy_mensuelle, conso_ecart_type, conso_3_derniers_mois, conso_mois_en_cours,
    nb_mois_avec_sortie, premiere_sortie, derniere_sortie,
    delai_appro_jours, delai_securite_jours, niveau_service_z, colisage,
    stock_securite_calcule, stock_min_calcule, stock_max_calcule, calcule_le)
  select f.reference_article, f.fournisseur_principal, v_h,
         f.conso_horizon, round(f.mu, 2), round(f.sigma, 2), f.conso_3m, f.conso_mois_en_cours,
         f.nb_mois_avec_sortie, f.premiere_sortie, f.derniere_sortie,
         f.delai, f.secu, f.z, f.colisage, f.ss,
         case when f.conso_horizon <= 0 then 0
              when f.colisage is not null and f.colisage > 1 then ceil(f.smin_brut / f.colisage) * f.colisage
              else f.smin_brut end,
         case when f.conso_horizon <= 0 then 0
              else ceil((case when f.colisage is not null and f.colisage > 1 then ceil(f.smin_brut / f.colisage) * f.colisage else f.smin_brut end) + f.mu * v_revue / 30) end,
         now()
  from final f
  on conflict (reference_article) do update set
    fournisseur_principal = excluded.fournisseur_principal, horizon_mois = excluded.horizon_mois,
    conso_horizon = excluded.conso_horizon, conso_moy_mensuelle = excluded.conso_moy_mensuelle, conso_ecart_type = excluded.conso_ecart_type,
    conso_3_derniers_mois = excluded.conso_3_derniers_mois, conso_mois_en_cours = excluded.conso_mois_en_cours,
    nb_mois_avec_sortie = excluded.nb_mois_avec_sortie, premiere_sortie = excluded.premiere_sortie, derniere_sortie = excluded.derniere_sortie,
    delai_appro_jours = excluded.delai_appro_jours, delai_securite_jours = excluded.delai_securite_jours, niveau_service_z = excluded.niveau_service_z,
    colisage = excluded.colisage, stock_securite_calcule = excluded.stock_securite_calcule, stock_min_calcule = excluded.stock_min_calcule,
    stock_max_calcule = excluded.stock_max_calcule, calcule_le = excluded.calcule_le;
    -- stock_min_retenu, commentaire, délais de la référence, arrêts, ref remplaçante, date d'effet,
    -- stratégie / conso retenue de l'article (saisie manuelle) sont conservés
  get diagnostics v_nb_art = row_count;

  return jsonb_build_object('horizon_mois', v_h, 'periode', v_debut::text || ' → ' || (v_fin - 1)::text,
                            'lignes_conso', v_nb_conso, 'articles_calcules', v_nb_art, 'calcule_le', now());
end;
$function$;
