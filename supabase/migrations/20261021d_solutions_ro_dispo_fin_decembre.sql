-- ============================================================================
-- 20261021d_solutions_ro_dispo_fin_decembre.sql
-- ----------------------------------------------------------------------------
-- get_solutions_ro : quantités dispo immédiatement et d'ici fin décembre, par article.
-- Appliquée en base le 21/10/2026 (migrations 20261021d puis 20261021e, version optimisée ci-dessous).
--
--   dispo_immediate = max(0, point bas du stock projeté à partir d'aujourd'hui)
--   dispo_fin_dec   = max(0, min(stock projeté au 31/12, point bas après le 31/12))
--   stock projeté   = stock dispo SAGE (réel − préparé) + CDF en cours (date de réception retenue)
--                     − CDC à livrer (même périmètre que get_references_penurie), toutes dates connues.
-- L'écran en déduit le nombre de solutions complètes réalisables (min dispo ÷ quantité).
-- ============================================================================

create or replace function public.get_solutions_ro()
returns jsonb
language sql stable security definer set search_path = public, interne, sage
as $$
with par as materialized (
  select current_date auj,
         make_date(extract(year from current_date)::int, 12, 31) fin_dec,
         coalesce((select valeur from appro_parametres where cle = 'cdc_a_livrer_anciennete_max_jours'), 180)::int cdc_anc
),
proj as materialized (
  select * from get_penurie_projection_mensuelle(6)
  where reference_article ~ '^(RAS-[0-9.]+WHV?RP2E|RASM-[0-9.]+V?TW2E)$'
),
pen as materialized (select * from get_references_penurie(false)),
ab as materialized (
  select distinct on (ar_ref) ar_ref ref, ar_design design, fa_codefamille famille, ar_prixven prix, ar_sommeil
  from sage.article_bis order by ar_ref, loaded_at desc nulls last
),
stk as materialized (
  select sto_art_num ref, sum(coalesce(sto_qte, 0) - coalesce(sto_prepa, 0)) s
  from sage.stock_depot group by sto_art_num
),
sols as (
  select s.*, coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'ref', c.ref_article, 'quantite', c.quantite, 'rang', c.rang) order by c.rang, c.created_at)
    from stock_solution_composants c where c.solution_id = s.id), '[]'::jsonb) composants
  from stock_solutions s where s.groupe = 'RO_AIRH2O'
),
pool_refs as materialized (
  select a.ref from ab a
  where (a.famille in ('00RORASUE', '00RORASM', '00ROH2OUE', '00RORWMUI', '00RORWDUI', '00RORWHUI', '00ROHUI', '00ROH2OUI', '00ROECS')
         or (a.famille = '00ACC' and a.ref ~ '^(ATW-|PC-ARFH|WEH)'))
    and coalesce(a.ar_sommeil, '0') <> '1'
),
refs as materialized (
  select ref from pool_refs
  union select c.ref_article from stock_solution_composants c join stock_solutions s on s.id = c.solution_id where s.groupe = 'RO_AIRH2O'
  union select reference_article from proj
),
flux as materialized (
  select l.reference_article ref, greatest(coalesce(l.date_livraison, p.auj), p.auj) d, -l.quantite q
  from interne.v_cdc_lignes_global l cross join par p
  join refs r on r.ref = l.reference_article
  where coalesce(l.quantite, 0) > 0
    and (l.date_livraison is null or l.date_livraison >= p.auj - p.cdc_anc)
  union all
  select rc.reference_article, greatest(coalesce(rc.date_reception_retenue, p.auj), p.auj), rc.quantite_attendue
  from v_couverture_stock_receptions rc cross join par p
  join refs r on r.ref = rc.reference_article
),
jour as materialized (select ref, d, sum(q) q from flux group by 1, 2),
cumul as materialized (
  select j.ref, j.d, coalesce(st.s, 0) + sum(j.q) over (partition by j.ref order by j.d) s
  from jour j left join stk st on st.ref = j.ref
),
agg as materialized (
  select c.ref, min(c.s) min_tout, min(c.s) filter (where c.d > p.fin_dec) min_apres_dec
  from cumul c cross join par p group by c.ref
),
avant_dec as materialized (
  select j.ref, sum(j.q) q from jour j cross join par p where j.d <= p.fin_dec group by j.ref
),
dispo as materialized (
  select r.ref,
    greatest(0, coalesce(a.min_tout, st.s, 0)) dispo_immediate,
    greatest(0, least(coalesce(st.s, 0) + coalesce(ad.q, 0), coalesce(a.min_apres_dec, 1e12))) dispo_fin_dec
  from refs r
  left join stk st on st.ref = r.ref
  left join agg a on a.ref = r.ref
  left join avant_dec ad on ad.ref = r.ref
),
cibles as (
  select p.reference_article ref, p.designation, p.famille,
         case when p.reference_article like 'RASM-%' then '800' else '600' end gamme,
         substring(p.reference_article from '^RASM?-([0-9.]+)') taille,
         case when p.reference_article ~ '^RASM-[0-9.]+VTW2E$' or p.reference_article ~ '^RAS-[0-9.]+WHVRP2E$' then '230 V mono' else '400 V' end alim,
         a.prix, p.stock_reel, p.stock_disponible, pe.qte_dispo_aujourdhui, pe.besoin_cdc_total, pe.nb_cdc,
         pe.date_prochaine_dispo, p.mois, d.dispo_immediate, d.dispo_fin_dec
  from proj p
  left join pen pe on pe.reference_article = p.reference_article
  left join ab a on a.ref = p.reference_article
  left join dispo d on d.ref = p.reference_article
),
articles as (
  select r.ref, coalesce(pe.designation, a.design) designation, coalesce(pe.famille, a.famille) famille, a.prix,
         coalesce(pe.stock_disponible, st.s, 0) stock_disponible,
         coalesce(pe.qte_dispo_aujourdhui, greatest(coalesce(st.s, 0), 0)) libre,
         d.dispo_immediate, d.dispo_fin_dec,
         coalesce(pe.besoin_cdc_total, 0) cdc, coalesce(pe.receptions_total, 0) cdf,
         pe.prochaine_reception_date, pe.date_prochaine_dispo,
         (pr.ref is not null) pool,
         coalesce(pe.sommeil, a.ar_sommeil = '1', false) sommeil
  from refs r
  left join pen pe on pe.reference_article = r.ref
  left join ab a on a.ref = r.ref
  left join stk st on st.ref = r.ref
  left join dispo d on d.ref = r.ref
  left join pool_refs pr on pr.ref = r.ref
)
select jsonb_build_object(
  'calcule_le', now(),
  'fin_dec', (select fin_dec from par),
  'cibles', coalesce((select jsonb_agg(to_jsonb(c) order by c.taille::numeric, c.gamme, c.alim) from cibles c), '[]'::jsonb),
  'solutions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'ref_cible', s.ref_cible, 'usage', s.usage, 'role', s.role,
        'libelle', s.libelle, 'rang', s.rang, 'origine', s.origine, 'commentaire', s.commentaire,
        'modifie_par', coalesce(s.updated_by_email, s.created_by_email), 'composants', s.composants)
        order by s.ref_cible, s.usage, s.role, s.rang, s.created_at) from sols s), '[]'::jsonb),
  'articles', coalesce((select jsonb_object_agg(a.ref, to_jsonb(a) - 'ref') from articles a), '{}'::jsonb)
);
$$;
