-- ============================================================================
-- 20261108c_hotline_stats_classification.sql — Hotline (08/11/2026)
-- ----------------------------------------------------------------------------
-- Statistiques de classification des tickets thermie (écran /hotline/stats,
-- section « Classification thermie », composant StatsClassification) :
--   - symptômes avec la part finie en pièce / garantie, réglée au téléphone,
--     restée sans suite et sans issue tracée ;
--   - organes défaillants par gamme ;
--   - codes défaut les plus fréquents avec gamme dominante, organe le plus
--     souvent en cause et issue ;
--   - issues, actions, natures ;
--   - évolution mensuelle (tickets, part pièce / garantie, part réglée au tél.).
-- Filtres : période (date d'ouverture) et gamme ('RO', 'RR', 'GAINABLE',
-- '-' = non renseignée). Réservé au droit can_hotline_expert.
-- ============================================================================

create or replace function public.hotline_stats_classification(p_debut date, p_fin date, p_gamme text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb;
begin
  if not public.hotline_est_expert() then
    raise exception 'Statistiques hotline réservées au droit can_hotline_expert.';
  end if;

  with t as (
    select h.*,
           (h.issue in ('PIECE', 'GARANTIE')) as fin_piece,
           (h.issue in ('RESOLU_TEL', 'RESOLU_REGLAGE')) as fin_tel,
           (h.issue = 'SANS_SUITE') as fin_sans_suite,
           (h.issue is null or h.issue = 'NON_TRACEE') as fin_non_tracee,
           public.hotline_code_defaut_norme(h.code_defaut) as code_norme
    from public.hotline_tickets h
    where h.filiere = 'THERMIQUE'
      and h.opened_at >= p_debut and h.opened_at < p_fin + 1
      and (p_gamme is null or p_gamme = '' or (p_gamme = '-' and h.gamme is null) or h.gamme = p_gamme)
  )
  select jsonb_build_object(
    'total', (select count(*) from t),
    'classes', (select count(*) from t where symptome is not null or organe is not null or (issue is not null and issue <> 'NON_TRACEE')),
    'auto', (select count(*) from t where classif_source = 'AUTO_2026_11'),
    'saisie', (select count(*) from t where classif_source = 'SAISIE'),
    'piece', (select count(*) from t where fin_piece),
    'tel', (select count(*) from t where fin_tel),
    'symptomes', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('code', coalesce(symptome, '-'), 'n', count(*),
               'piece', count(*) filter (where fin_piece), 'tel', count(*) filter (where fin_tel),
               'sans_suite', count(*) filter (where fin_sans_suite), 'non_tracee', count(*) filter (where fin_non_tracee)) x
        from t group by coalesce(symptome, '-')) s),
    'organes', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object('code', organe, 'n', count(*),
               'RO', count(*) filter (where gamme = 'RO'), 'RR', count(*) filter (where gamme = 'RR'),
               'GAINABLE', count(*) filter (where gamme = 'GAINABLE'), 'ND', count(*) filter (where gamme is null)) x
        from t where organe is not null and organe <> 'AUCUN' group by organe) s),
    'codes', (select coalesce(jsonb_agg(x order by (x->>'n')::int desc), '[]') from (
        select jsonb_build_object(
                 'code', c.code_norme, 'n', c.n, 'piece', c.piece, 'tel', c.tel,
                 'gamme', (select g.gamme from t g where g.code_norme = c.code_norme and g.gamme is not null group by g.gamme order by count(*) desc limit 1),
                 'gamme_n', (select count(*) from t g where g.code_norme = c.code_norme and g.gamme = (
                               select g2.gamme from t g2 where g2.code_norme = c.code_norme and g2.gamme is not null group by g2.gamme order by count(*) desc limit 1)),
                 'organe', (select o.organe from t o where o.code_norme = c.code_norme and o.organe is not null and o.organe <> 'AUCUN' group by o.organe order by count(*) desc limit 1),
                 'organe_n', (select count(*) from t o where o.code_norme = c.code_norme and o.organe = (
                               select o2.organe from t o2 where o2.code_norme = c.code_norme and o2.organe is not null and o2.organe <> 'AUCUN' group by o2.organe order by count(*) desc limit 1))
               ) x
        from (select code_norme, count(*) n, count(*) filter (where fin_piece) piece, count(*) filter (where fin_tel) tel
              from t where code_norme is not null group by code_norme order by count(*) desc limit 20) c) s),
    'issues', (select coalesce(jsonb_agg(jsonb_build_object('code', k, 'n', n) order by n desc), '[]') from (
        select coalesce(issue, '-') k, count(*) n from t group by 1) s),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('code', k, 'n', n) order by n desc), '[]') from (
        select a k, count(*) n from t, unnest(t.actions) a group by 1) s),
    'natures', (select coalesce(jsonb_agg(jsonb_build_object('code', k, 'n', n) order by n desc), '[]') from (
        select coalesce(nature, '-') k, count(*) n from t group by 1) s),
    'gammes', (select coalesce(jsonb_agg(jsonb_build_object('code', k, 'n', n) order by n desc), '[]') from (
        select coalesce(gamme, '-') k, count(*) n from t group by 1) s),
    'mois', (select coalesce(jsonb_agg(jsonb_build_object('mois', m, 'n', n, 'piece', piece, 'tel', tel, 'sans_suite', ss) order by m), '[]') from (
        select to_char(date_trunc('month', opened_at), 'YYYY-MM') m, count(*) n,
               count(*) filter (where fin_piece) piece, count(*) filter (where fin_tel) tel, count(*) filter (where fin_sans_suite) ss
        from t group by 1) s)
  ) into v;
  return v;
end
$function$;

grant execute on function public.hotline_stats_classification(date, date, text) to authenticated;
