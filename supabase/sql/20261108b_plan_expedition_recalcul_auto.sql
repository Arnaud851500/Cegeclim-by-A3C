-- ============================================================================
-- 20261108b_plan_expedition_recalcul_auto.sql
-- ----------------------------------------------------------------------------
-- Recalcul automatique du Plan d'expédition FMS (refresh_plan_expedition_fms)
-- chaque jour à 8h40 Paris, après la synchro SAGE de 8h10 — demandé par Arnaud
-- le 08/11/2026, la vue agence étant ouverte au tronc commun Stocks & logistique.
--  - Paramètres par défaut (appro_parametres : horizon plan_exp_horizon_jours,
--    RDV containers manquants simulés) ; tourne sans JWT donc plan_exp_autorise() = vrai.
--  - Heure d'été / d'hiver : le job est ajouté à adjust_sage_sync_cron_schedule()
--    (job 70, 01h10 UTC chaque nuit), qui recale l'heure UTC sur 8h40 Paris.
--  - Correctif : cette fonction échouait chaque nuit depuis le passage à l'heure
--    d'hiver (« column reference jobname is ambiguous » dans cron.alter_job, la
--    colonne de sortie jobname masquant cron.job.jobname) ; les synchros 8h10 /
--    14h10 Paris tournaient donc à 7h10 / 13h10, avant l'export TSE. Sous-requête aliasée.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'plan-expedition-fms-recalcul-0840-paris';
select cron.schedule(
  'plan-expedition-fms-recalcul-0840-paris',
  '40 7 * * *',   -- 8h40 Paris en heure d'hiver ; recalé ensuite par adjust_sage_sync_cron_schedule()
  $$SET statement_timeout = '600s'; select public.refresh_plan_expedition_fms(null, null, true);$$
);

CREATE OR REPLACE FUNCTION public.adjust_sage_sync_cron_schedule()
 RETURNS TABLE(jobname text, ancien_schedule text, nouveau_schedule text, offset_minutes integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
DECLARE
    v_offset_minutes integer;
    v_new_hour integer;
    v_new_minute integer;
    v_total_minutes integer;
    v_new_schedule text;
    v_paris_targets integer[][] := ARRAY[
        ARRAY[8,10],  -- 8h10 Paris (TSE 8h00 + 10 min)
        ARRAY[10,10], -- 10h10 Paris (TSE 10h00 + 10 min)
        ARRAY[12,10], -- 12h10 Paris (TSE 12h00 + 10 min)
        ARRAY[14,10], -- 14h10 Paris (TSE 14h00 + 10 min)
        ARRAY[16,10], -- 16h10 Paris (TSE 16h00 + 10 min)
        ARRAY[18,10], -- 18h10 Paris (TSE 18h00 + 10 min)
        ARRAY[23,10], -- 23h10 Paris (TSE 23h00 + 10 min) — déplacé de 21h10 le 16/10/2026
        ARRAY[8,40]   -- 8h40 Paris : recalcul du Plan d'expédition FMS (08/11/2026)
    ];
    v_jobnames text[] := ARRAY[
        'sync-sage-vers-activite-0810-paris',
        'sync-sage-vers-activite-1010-paris',
        'sync-sage-vers-activite-1210-paris',
        'sync-sage-vers-activite-1410-paris',
        'sync-sage-vers-activite-1610-paris',
        'sync-sage-vers-activite-1810-paris',
        'sync-sage-vers-activite-2310-paris',
        'plan-expedition-fms-recalcul-0840-paris'
    ];
    i integer;
BEGIN
    SELECT EXTRACT(EPOCH FROM (
        (now() AT TIME ZONE 'Europe/Paris') - (now() AT TIME ZONE 'UTC')
    )) / 60 INTO v_offset_minutes;

    FOR i IN 1..array_length(v_jobnames, 1) LOOP
        v_total_minutes := ((v_paris_targets[i][1] * 60 + v_paris_targets[i][2] - v_offset_minutes) % 1440 + 1440) % 1440;
        v_new_hour := v_total_minutes / 60;
        v_new_minute := v_total_minutes % 60;
        v_new_schedule := v_new_minute || ' ' || v_new_hour || ' * * *';

        SELECT c.schedule INTO ancien_schedule FROM cron.job c WHERE c.jobname = v_jobnames[i];
        IF ancien_schedule IS NULL THEN CONTINUE; END IF;

        IF ancien_schedule IS DISTINCT FROM v_new_schedule THEN
            PERFORM cron.alter_job(
                (SELECT j.jobid FROM cron.job j WHERE j.jobname = v_jobnames[i]),
                schedule := v_new_schedule
            );
        END IF;

        jobname := v_jobnames[i];
        nouveau_schedule := v_new_schedule;
        offset_minutes := v_offset_minutes;
        RETURN NEXT;
    END LOOP;
END;
$function$;
