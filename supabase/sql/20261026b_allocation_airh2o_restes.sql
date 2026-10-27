-- ============================================================================
-- 20261026b_allocation_airh2o_restes.sql — Allocation AirH2O 600 / 800 (26/10/2026, appliqué en production)
-- ----------------------------------------------------------------------------
-- get_allocation_ro renvoie « restes » : par référence × agence, l'allocation pas encore commandée
-- (Allocation − CDC Liv − BL/PL depuis le 26/10, si > 0) et sa disponibilité :
--   - les CDC 2026 ouvertes (toutes agences) sont servies d'abord, sur le Dispo (Phy-PL) puis les CDF
--     par date de réception retenue (v_couverture_stock_receptions) ;
--   - les restes viennent ensuite, à la suite entre agences (ANGLET, SAV / JMLADEUIX, puis ordre
--     alphabétique) pour ne pas compter deux fois le même stock libre ;
--   - q_stock = part couverte par le stock actuel, q_cdf = part attendue, cdf / date_dispo = CDF qui
--     la complète et sa date ; insuffisant = stock + CDF en cours ne suffisent pas.
--   Le calcul porte sur toutes les agences ; la vue agence ne reçoit que les siennes.
-- À appliquer après 20261026_allocation_airh2o_agences.sql (patch de la fonction en place).
-- ============================================================================

do $do$
declare v text; v0 text;
begin
  v := pg_get_functiondef('public.get_allocation_ro'::regproc); v0 := v;
  if v like '%rst_d%' then return; end if;   -- déjà appliqué
  v := replace(v, $a$  blocs as (
    select b.bloc from ($a$, $a$  sup as (
    select c.ref, 0 as ord, (now() at time zone 'Europe/Paris')::date as d,
           greatest(coalesce(st.reel, 0) - coalesce(st.prepa, 0), 0) as q, null::text as cdf
    from cibles c left join st on st.ref = c.ref
    union all
    select r.reference_article, 1, r.date_reception_retenue, r.quantite_attendue, r.numero_cdf
    from v_couverture_stock_receptions r join cibles c on c.ref = r.reference_article
  ),
  sup_c as (
    select s.*, sum(s.q) over (partition by s.ref order by s.ord, s.d, s.cdf rows unbounded preceding) as cumul from sup s
  ),
  dem as (select ref, sum(q) as q_cdc from lignes_ag where nature = 'CDC' group by 1),
  rst as (
    select a.reference_article as ref, a.bloc, a.quantite as alloc, coalesce(ag.cdc, 0) as cdc, coalesce(ag.post, 0) as post,
           a.quantite - coalesce(ag.cdc, 0) - coalesce(ag.post, 0) as reste,
           coalesce(dm.q_cdc, 0) as q_cdc_tot,
           coalesce((select s.q from sup s where s.ref = a.reference_article and s.ord = 0), 0) as dispo
    from stock_alloc_ro a
    join cibles c on c.ref = a.reference_article
    left join agg ag on ag.ref = a.reference_article and ag.bloc = a.bloc
    left join dem dm on dm.ref = a.reference_article
    where a.quantite - coalesce(ag.cdc, 0) - coalesce(ag.post, 0) > 0
  ),
  rst_cum as (
    select r.*, r.q_cdc_tot + sum(r.reste) over (partition by r.ref order by case r.bloc when 'ANGLET' then 0 when 'JITHURBIDE' then 1 else 2 end, r.bloc
                                                 rows unbounded preceding) as fin_pos
    from rst r
  ),
  rst_d as (
    select r.*, greatest(0, least(r.reste, r.dispo - (r.fin_pos - r.reste))) as q_stock, f.d as date_dispo, f.cdf, f.ord
    from rst_cum r
    left join lateral (
      select sc.d, sc.cdf, sc.ord from sup_c sc
      where sc.ref = r.ref and sc.q > 0 and sc.cumul >= r.fin_pos
      order by sc.ord, sc.d, sc.cdf limit 1
    ) f on true
    where v_complet or r.bloc = any(v_blocs)
  ),
  blocs as (
    select b.bloc from ($a$);
  v := replace(v, $a$    'blocs_user', to_jsonb(v_blocs),$a$, $a$    'blocs_user', to_jsonb(v_blocs),
    'restes', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'bloc', bloc, 'alloc', alloc, 'cdc', cdc, 'post', post, 'reste', reste,
                 'q_stock', q_stock, 'q_cdf', reste - q_stock, 'date_dispo', date_dispo,
                 'cdf', case when ord = 1 then cdf end, 'insuffisant', date_dispo is null) order by ref, bloc), '[]'::jsonb) from rst_d),$a$);
  if v = v0 or v not like '%''restes''%' then raise exception 'patch non appliqué'; end if;
  execute v;
end $do$;

-- ─── 26/10/2026, 17h (appliqué en production) ───────────────────────────────
-- Correctif : en vue agence, lignes_bloc / agg ne contiennent que l'agence de la personne ;
-- le calcul des restes (qui sert les agences à la suite) doit lire les CDC et BL/PL de TOUTES
-- les agences → nouvel agrégat agg_all (sur lignes_ag) utilisé par rst.
-- Ajout : restes[].sources = détail de ce qui couvre chaque reste (stock actuel, puis chaque CDF
-- avec sa date de réception retenue et la quantité prise dessus).
do $do$
declare v text; v0 text;
begin
  v := pg_get_functiondef('public.get_allocation_ro'::regproc); v0 := v;
  if v like '%agg_all%' then return; end if;   -- déjà appliqué
  v := replace(v, $a$  sup as (
    select c.ref, 0 as ord,$a$, $a$  agg_all as (
    select ref, case when representant = 'AAITHURBIDE' or agence = 'SAV/JMLADEUIX' then 'JITHURBIDE' else agence end as bloc,
           sum(q) filter (where nature = 'CDC') as cdc,
           sum(q) filter (where nature in ('POST_BL', 'POST_PL')) as post
    from lignes_ag where nature is not null group by 1, 2
  ),
  sup as (
    select c.ref, 0 as ord,$a$);
  v := replace(v, $a$    left join agg ag on ag.ref = a.reference_article and ag.bloc = a.bloc
    left join dem dm$a$, $a$    left join agg_all ag on ag.ref = a.reference_article and ag.bloc = a.bloc
    left join dem dm$a$);
  v := replace(v, $a$    select r.*, greatest(0, least(r.reste, r.dispo - (r.fin_pos - r.reste))) as q_stock, f.d as date_dispo, f.cdf, f.ord
    from rst_cum r$a$, $a$    select r.*, greatest(0, least(r.reste, r.dispo - (r.fin_pos - r.reste))) as q_stock, f.d as date_dispo, f.cdf, f.ord,
           (select coalesce(jsonb_agg(jsonb_build_object('cdf', sc.cdf, 'date', sc.d,
                      'q', least(sc.cumul, r.fin_pos) - greatest(sc.cumul - sc.q, r.fin_pos - r.reste)) order by sc.ord, sc.d, sc.cdf), '[]'::jsonb)
              from sup_c sc
              where sc.ref = r.ref and sc.q > 0 and sc.cumul > r.fin_pos - r.reste and sc.cumul - sc.q < r.fin_pos) as sources
    from rst_cum r$a$);
  v := replace(v, $a$'cdf', case when ord = 1 then cdf end, 'insuffisant', date_dispo is null)$a$,
                  $a$'cdf', case when ord = 1 then cdf end, 'insuffisant', date_dispo is null, 'sources', sources)$a$);
  if v = v0 or v not like '%agg_all%' or v not like '%''sources'', sources%' then raise exception 'patch non appliqué'; end if;
  execute v;
end $do$;

-- ─── 26/10/2026, 19h30 (appliqué en production) ─────────────────────────────
-- Vue agence limitée à l'AirH2O 600 : l'AirH2O 800 n'est visible que des 4 personnes
-- de stock_alloc_ro_acces (les autres la retrouvent dans les équivalences R/O).
do $do$
declare v text; v0 text;
begin
  v := pg_get_functiondef('public.get_allocation_ro'::regproc); v0 := v;
  if v like '%c->>''gamme'' = ''600''%' then return; end if;
  v := replace(v, $a$    where (c->>'taille')::numeric >= 3.5
  ),$a$, $a$    where (c->>'taille')::numeric >= 3.5
      and (v_complet or c->>'gamme' = '600')   -- 26/10/2026 : vue agence limitée à l'AirH2O 600 (800 dans les équivalences)
  ),$a$);
  if v = v0 then raise exception 'patch non appliqué'; end if;
  execute v;
end $do$;

-- ─── 27/10/2026 (appliqué en production) ────────────────────────────────────
-- Référence chantier (champ SAGE « Référence » de la pièce) ajoutée aux lignes : lignes[].chantier.
do $do$
declare v text; p text;
begin
  v := pg_get_functiondef('public.get_allocation_ro'::regproc);
  if v like '%''chantier'', lb.chantier%' then return; end if;
  p := v; v := replace(v, $a$a.numero_tiers_entete as tiers, a.intitule_tiers_entete as client, a.collaborateur
    from activite_lignes a$a$, $a$a.numero_tiers_entete as tiers, a.intitule_tiers_entete as client, a.collaborateur,
           nullif(trim(a.reference), '') as chantier
    from activite_lignes a$a$);
  if v = p then raise exception 'étape 1'; end if;
  p := v; v := replace(v, $a$f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur
    from facture_lignes f$a$, $a$f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur,
           nullif(trim(f.reference), '')
    from facture_lignes f$a$);
  if v = p then raise exception 'étape 2'; end if;
  p := v; v := replace(v, $a$'tiers', lb.tiers, 'client', lb.client,$a$, $a$'tiers', lb.tiers, 'client', lb.client, 'chantier', lb.chantier,$a$);
  if v = p then raise exception 'étape 3'; end if;
  execute v;
end $do$;
