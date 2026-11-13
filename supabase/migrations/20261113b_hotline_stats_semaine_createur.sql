-- ============================================================================
-- 20261113b_hotline_stats_semaine_createur.sql — Statistiques hotline (13/11/2026)
-- hotline_stats renvoie aussi « par_semaine_createur » : tickets par semaine et
-- par personne qui a créé le ticket (ouvert_par ramené à l'identifiant avant
-- « @ » : même clé pour les tickets repris de l'ancien outil et ceux du
-- compagnon ; nom affiché = display_name de user_page_access s'il existe).
-- Utilisé par l'histogramme empilé de /hotline/stats.
-- ============================================================================
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_stats(date, date, text)'::regprocedure) into v_def;
  if v_def not like '%par_semaine_createur%' then
    v_def := replace(v_def, $r$'par_nature', ($r$, $r$'par_semaine_createur', (select coalesce(jsonb_agg(jsonb_build_object('semaine', semaine, 'createur', createur, 'nom', nom, 'n', n) order by semaine, n desc), '[]') from (
        select to_char(date_trunc('week', x.opened_at), 'YYYY-MM-DD') semaine, x.createur, max(coalesce(u.nom, x.createur)) nom, count(*) n
        from (select opened_at, lower(split_part(coalesce(nullif(btrim(ouvert_par), ''), 'inconnu'), '@', 1)) createur from t) x
        left join lateral (
          select nullif(btrim(p.display_name), '') nom from public.user_page_access p
          where lower(split_part(p.email, '@', 1)) = x.createur and nullif(btrim(p.display_name), '') is not null limit 1
        ) u on true
        group by 1, 2) s),
    'par_nature', ($r$);
    execute v_def;
  end if;
end
$$;
