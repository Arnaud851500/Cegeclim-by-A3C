-- Analyse des ventes & devis — source « devis » (27/11/2026)
-- Le 27/11 à 11h50, une analyse devis lancée en même temps que la salve de
-- jobs de h+50 a tourné 40 s puis la base a redémarré. analyse_executer
-- reconstruisait la table de transformation (TRUNCATE + 280 000 lignes) dans la
-- requête de l'utilisateur dès qu'elle avait plus d'une heure.
-- Désormais :
--   - rafraîchissement par pg_cron toutes les heures à h+20 (hors salve h+50) ;
--   - analyse_executer ne la reconstruit elle-même qu'en secours (> 6 h).

do $mig$
declare v_def text;
begin
  select pg_get_functiondef('public.analyse_executer(text,text[],text[],jsonb,jsonb,integer,boolean,boolean)'::regprocedure)
    into v_def;
  if position('interval ''1 hour''' in v_def) = 0 then
    raise notice 'analyse_executer déjà modifiée';
  else
    execute replace(v_def, 'refreshed_at > now() - interval ''1 hour''', 'refreshed_at > now() - interval ''6 hours''');
  end if;
end
$mig$;

select cron.unschedule(jobid) from cron.job where jobname = 'analyse-devis-transfo-refresh';
select cron.schedule('analyse-devis-transfo-refresh', '20 * * * *',
  $$SET statement_timeout = '300s'; select public.refresh_analyse_devis_transfo();$$);
