-- ============================================================================
-- 20261115a_admin_flux_donnees.sql — Écran Admin « Flux de données »
-- ----------------------------------------------------------------------------
-- 15/11/2026, demandé par Arnaud : schéma en couches du compagnon (sources →
-- Supabase données de base → données calculées → Vercel) avec, sur chaque
-- brique, le volume, la dernière mise à jour et un code couleur d'état.
--
-- Objets :
--   - admin_flux_registre : une ligne par brique du schéma (couche, ordre,
--     libellé, mode, fréquence) et ses « composants mesurés » :
--       * special       : 'sage_lot' (sage.import_lots) ou 'blg'
--                         (get_blg_sync_fraicheur) ;
--       * cron_jobs     : tâches pg_cron, état exact calculé depuis leur
--                         planification (cron_prev_fire) ;
--       * scheduler_jobs: tâches du planificateur applicatif (scheduler_jobs /
--                         scheduler_runs, écran Planification des jobs) ;
--       * mesure_table  : horodatage max d'une table (+ filtre, + message) ;
--     L'état de la brique est le pire de ses composants.
--   - cron_field_match / cron_prev_fire : dernière heure de déclenchement
--     attendue d'une expression cron (UTC, comme pg_cron : cron.timezone=GMT).
--   - get_admin_flux_etat() → jsonb : état de toutes les briques, réservé
--     aux administrateurs (can_autorisation, current_user_can_manage_access).
--
-- États : ok · retard · echec · non_suivi (aucun composant mesuré).
-- Tables / spéciaux : retard au-delà du seuil, échec au-delà de 3 × seuil.
--   Le seuil change hors plage (heure_debut–heure_fin, heure de Paris) :
--   seuil_hors_plage_minutes, pour ne pas alerter la nuit.
-- Tâches pg_cron : ok si un passage réussi a démarré depuis le dernier
--   déclenchement attendu (5 min de grâce) ; échec si le dernier passage a
--   échoué ; retard sinon.
-- Planificateur applicatif : échec si le dernier passage porte une erreur
--   (status error / failed, ou partial avec message d'erreur) ; retard si
--   next_run_at est dépassé de plus de 15 min.
-- ============================================================================

-- ── Registre ────────────────────────────────────────────────────────────────

create table if not exists public.admin_flux_registre (
  code                      text primary key,
  couche                    text not null check (couche in ('source', 'base', 'calcule')),
  ordre                     integer not null default 0,
  libelle                   text not null,
  icone                     text,
  mode                      text,
  frequence                 text,
  description               text,
  lien                      text,
  blocs                     text[] not null default '{}',
  special                   text check (special in ('sage_lot', 'blg')),
  cron_jobs                 text[] not null default '{}',
  scheduler_jobs            text[] not null default '{}',
  mesure_table              text,
  mesure_colonne            text,
  mesure_filtre             text,
  mesure_message_colonne    text,
  seuil_minutes             integer,
  seuil_hors_plage_minutes  integer,
  heure_debut               integer check (heure_debut between 0 and 23),
  heure_fin                 integer check (heure_fin between 0 and 23),
  volume_tables             text[] not null default '{}',
  actif                     boolean not null default true,
  maj_le                    timestamptz not null default now()
);

comment on table public.admin_flux_registre is
  'Écran Admin « Flux de données » : briques du schéma en couches et composants mesurés (voir 20261115a_admin_flux_donnees.sql).';

alter table public.admin_flux_registre enable row level security;

drop policy if exists admin_flux_registre_admin_all on public.admin_flux_registre;
create policy admin_flux_registre_admin_all on public.admin_flux_registre
  for all to authenticated
  using (public.current_user_can_manage_access())
  with check (public.current_user_can_manage_access());

-- ── Expressions cron ────────────────────────────────────────────────────────

create or replace function public.cron_field_match(p_field text, p_val integer)
returns boolean
language plpgsql
immutable
as $function$
declare
  v_part  text;
  v_range text;
  v_step  integer;
  v_lo    integer;
  v_hi    integer;
begin
  foreach v_part in array string_to_array(p_field, ',') loop
    v_step := 1;
    v_range := v_part;
    if position('/' in v_part) > 0 then
      v_range := split_part(v_part, '/', 1);
      v_step := split_part(v_part, '/', 2)::integer;
    end if;
    if v_range = '*' then
      v_lo := 0; v_hi := 1000;
    elsif position('-' in v_range) > 0 then
      v_lo := split_part(v_range, '-', 1)::integer;
      v_hi := split_part(v_range, '-', 2)::integer;
    else
      v_lo := v_range::integer;
      v_hi := case when v_step > 1 then 1000 else v_lo end;
    end if;
    if p_val between v_lo and v_hi and (p_val - v_lo) % v_step = 0 then
      return true;
    end if;
  end loop;
  return false;
end;
$function$;

-- Dernier déclenchement attendu (<= p_at) d'une expression cron à 5 champs,
-- évaluée en UTC. Recherche sur 8 jours ; null si rien trouvé.
create or replace function public.cron_prev_fire(p_schedule text, p_at timestamptz)
returns timestamptz
language plpgsql
stable
as $function$
declare
  f        text[] := regexp_split_to_array(trim(p_schedule), '\s+');
  v_now    timestamp := date_trunc('minute', p_at at time zone 'UTC');
  v_hour   timestamp;
  v_dow    integer;
  v_min    integer;
  v_offset integer;
begin
  if array_length(f, 1) <> 5 then
    return null;
  end if;
  for v_offset in 0 .. 192 loop
    v_hour := date_trunc('hour', v_now) - make_interval(hours => v_offset);
    v_dow := extract(dow from v_hour)::integer;
    if public.cron_field_match(f[2], extract(hour from v_hour)::integer)
       and public.cron_field_match(f[3], extract(day from v_hour)::integer)
       and public.cron_field_match(f[4], extract(month from v_hour)::integer)
       and (public.cron_field_match(f[5], v_dow)
            or (v_dow = 0 and public.cron_field_match(f[5], 7))) then
      for v_min in reverse (case when v_offset = 0 then extract(minute from v_now)::integer else 59 end) .. 0 loop
        if public.cron_field_match(f[1], v_min) then
          return (v_hour + make_interval(mins => v_min)) at time zone 'UTC';
        end if;
      end loop;
    end if;
  end loop;
  return null;
end;
$function$;

-- ── État des flux ───────────────────────────────────────────────────────────

create or replace function public.get_admin_flux_etat()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage', 'cron'
set statement_timeout to '60s'
as $function$
declare
  r              public.admin_flux_registre%rowtype;
  v_out          jsonb := '[]'::jsonb;
  v_details      jsonb;
  v_comp         jsonb;
  v_statuts      text[];
  v_dates        timestamptz[];
  v_volume       numeric;
  v_nb_tables    integer;
  v_messages     text[];
  v_now_paris    timestamp := now() at time zone 'Europe/Paris';
  v_heure        integer := extract(hour from v_now_paris)::integer;
  v_seuil        integer;
  v_date         timestamptz;
  v_msg          text;
  v_statut       text;
  v_age_min      numeric;
  v_job          text;
  v_lot          jsonb;
  v_blg          record;
  v_cron         record;
  v_sched        record;
  v_run          record;
  v_spec         text;
  v_min_runid    bigint;
  v_lot_vol      numeric;
  rang           constant jsonb := '{"non_suivi":0,"ok":1,"retard":2,"echec":3}';
begin
  if not public.current_user_can_manage_access() then
    raise exception 'Accès réservé aux administrateurs.' using errcode = '42501';
  end if;

  -- Fenêtre récente de cron.job_run_details via la clé primaire (pas d'index
  -- sur start_time) : ~5 000 passages / jour, 30 000 couvrent ~5 jours.
  select coalesce(max(runid), 0) - 30000 into v_min_runid from cron.job_run_details;

  create temporary table if not exists tmp_flux_runs on commit drop as
    select jobid, runid, status, return_message, start_time, end_time
    from cron.job_run_details where false;
  truncate tmp_flux_runs;
  insert into tmp_flux_runs
    select d.jobid, d.runid, d.status, d.return_message, d.start_time, d.end_time
    from cron.job_run_details d
    where d.runid > v_min_runid;

  for r in
    select * from public.admin_flux_registre where actif order by couche, ordre, code
  loop
    v_details := '[]'::jsonb;
    v_statuts := '{}';
    v_dates := '{}';
    v_messages := '{}';

    -- Seuil applicable maintenant (plage horaire de Paris).
    v_seuil := r.seuil_minutes;
    if r.heure_debut is not null and r.heure_fin is not null
       and not (v_heure between r.heure_debut and r.heure_fin) then
      v_seuil := coalesce(r.seuil_hors_plage_minutes, r.seuil_minutes);
    end if;

    -- 1. Composant spécial ------------------------------------------------
    if r.special = 'sage_lot' then
      v_lot := public.get_sage_import_statut();
      v_date := (v_lot -> 'dernier_lot_publie' ->> 'publie_at')::timestamptz;
      select coalesce(sum(value::numeric), 0) into v_lot_vol
        from jsonb_each_text(coalesce(v_lot -> 'dernier_lot_publie' -> 'tables', '{}'::jsonb));
      v_spec := v_lot -> 'dernier_lot' ->> 'statut';
      v_age_min := extract(epoch from now() - v_date) / 60;
      if v_spec is not null and v_spec <> 'publie'
         and (v_spec ~* '(rejet|echec|erreur|annul)') then
        v_statut := 'echec';
        v_msg := format('Lot %s : %s %s', v_lot -> 'dernier_lot' ->> 'id', v_spec,
                        coalesce(v_lot -> 'dernier_lot' ->> 'message', ''));
      elsif v_date is null then
        v_statut := 'echec'; v_msg := 'Aucun lot publié';
      elsif v_seuil is not null and v_age_min > 3 * v_seuil then
        v_statut := 'echec'; v_msg := format('Lot %s publié', v_lot -> 'dernier_lot_publie' ->> 'id');
      elsif v_seuil is not null and v_age_min > v_seuil then
        v_statut := 'retard'; v_msg := format('Lot %s publié', v_lot -> 'dernier_lot_publie' ->> 'id');
      else
        v_statut := 'ok';
        v_msg := format('Lot %s publié en %s s', v_lot -> 'dernier_lot_publie' ->> 'id',
                        round((v_lot -> 'dernier_lot_publie' ->> 'duree_publication_s')::numeric));
      end if;
      if coalesce((v_lot ->> 'publication_en_attente')::boolean, false) then
        v_msg := v_msg || ' · publication en attente';
      end if;
      v_statuts := v_statuts || v_statut;
      v_dates := v_dates || v_date;
      v_details := v_details || jsonb_build_object(
        'type', 'import', 'nom', 'Import SAGE par lot', 'statut', v_statut,
        'derniere_maj', v_date, 'message', v_msg, 'lignes', v_lot_vol,
        'tables', v_lot -> 'dernier_lot_publie' -> 'tables');
    elsif r.special = 'blg' then
      select * into v_blg from public.get_blg_sync_fraicheur(coalesce(v_seuil, 1560) / 60);
      v_date := v_blg.derniere_synchro_ok;
      v_age_min := extract(epoch from now() - v_date) / 60;
      if v_blg.tables_en_erreur > 0 then
        v_statut := 'echec';
      elsif v_date is null or (v_seuil is not null and v_age_min > 3 * v_seuil) then
        v_statut := 'echec';
      elsif v_blg.etat <> 'ok' or (v_seuil is not null and v_age_min > v_seuil) then
        v_statut := 'retard';
      else
        v_statut := 'ok';
      end if;
      v_msg := format('%s / %s tables fraîches, %s en erreur',
                      v_blg.tables_fraiches, v_blg.tables_attendues, v_blg.tables_en_erreur);
      v_statuts := v_statuts || v_statut;
      v_dates := v_dates || v_date;
      v_details := v_details || jsonb_build_object(
        'type', 'import', 'nom', 'Synchronisation BLG (sync.js, sync_business.js)',
        'statut', v_statut, 'derniere_maj', v_date, 'message', v_msg);
    end if;

    -- 2. Table horodatée ---------------------------------------------------
    if r.mesure_table is not null and r.mesure_colonne is not null then
      v_date := null; v_msg := null;
      begin
        execute format('select max(%I) from %s where %s',
                       r.mesure_colonne, r.mesure_table::regclass, coalesce(r.mesure_filtre, 'true'))
          into v_date;
        if r.mesure_message_colonne is not null then
          execute format('select %I::text from %s where %s order by %I desc nulls last limit 1',
                         r.mesure_message_colonne, r.mesure_table::regclass,
                         coalesce(r.mesure_filtre, 'true'), r.mesure_colonne)
            into v_msg;
        end if;
        v_age_min := extract(epoch from now() - v_date) / 60;
        v_statut := case
          when v_seuil is null then 'non_suivi'
          when v_date is null then 'echec'
          when v_age_min > 3 * v_seuil then 'echec'
          when v_age_min > v_seuil then 'retard'
          else 'ok' end;
      exception when others then
        v_statut := 'echec'; v_msg := 'Mesure impossible : ' || sqlerrm;
      end;
      v_statuts := v_statuts || v_statut;
      v_dates := v_dates || v_date;
      v_details := v_details || jsonb_build_object(
        'type', 'table', 'nom', r.mesure_table, 'statut', v_statut,
        'derniere_maj', v_date, 'message', v_msg, 'seuil_minutes', v_seuil);
    end if;

    -- 3. Tâches pg_cron ----------------------------------------------------
    foreach v_job in array r.cron_jobs loop
      select j.jobid, j.jobname, j.schedule, j.active,
             public.cron_prev_fire(j.schedule, now() - interval '5 minutes') as prev_fire
        into v_cron
        from cron.job j where j.jobname = v_job;
      if not found then
        v_statuts := v_statuts || 'echec'::text;
        v_details := v_details || jsonb_build_object(
          'type', 'cron', 'nom', v_job, 'statut', 'echec', 'message', 'Tâche introuvable dans pg_cron');
        continue;
      end if;
      if not v_cron.active then
        v_details := v_details || jsonb_build_object(
          'type', 'cron', 'nom', v_job, 'planification', v_cron.schedule,
          'statut', 'non_suivi', 'message', 'Tâche désactivée');
        continue;
      end if;

      select
        (select t.start_time from tmp_flux_runs t where t.jobid = v_cron.jobid and t.status = 'succeeded' order by t.runid desc limit 1) as dernier_ok,
        (select t.end_time from tmp_flux_runs t where t.jobid = v_cron.jobid and t.status = 'succeeded' order by t.runid desc limit 1) as dernier_ok_fin,
        (select t.status from tmp_flux_runs t where t.jobid = v_cron.jobid order by t.runid desc limit 1) as dernier_statut,
        (select t.start_time from tmp_flux_runs t where t.jobid = v_cron.jobid order by t.runid desc limit 1) as dernier_debut,
        (select left(t.return_message, 240) from tmp_flux_runs t where t.jobid = v_cron.jobid and t.status = 'failed' order by t.runid desc limit 1) as derniere_erreur,
        (select count(*) from tmp_flux_runs t where t.jobid = v_cron.jobid and t.status = 'failed' and t.start_time > now() - interval '24 hours') as echecs_24h,
        (select count(*) from tmp_flux_runs t where t.jobid = v_cron.jobid and t.start_time > now() - interval '24 hours') as passages_24h
        into v_run;

      v_statut := case
        when v_cron.prev_fire is null then 'non_suivi'
        when v_run.dernier_ok >= v_cron.prev_fire - interval '1 minute' then 'ok'
        when v_run.dernier_statut in ('running', 'starting')
             and v_run.dernier_debut >= v_cron.prev_fire - interval '1 minute' then 'ok'
        when v_run.dernier_statut = 'failed' then 'echec'
        else 'retard' end;

      v_statuts := v_statuts || v_statut;
      v_dates := v_dates || coalesce(v_run.dernier_ok_fin, v_run.dernier_ok);
      v_details := v_details || jsonb_build_object(
        'type', 'cron', 'nom', v_job, 'planification', v_cron.schedule,
        'statut', v_statut, 'derniere_maj', coalesce(v_run.dernier_ok_fin, v_run.dernier_ok),
        'attendu_depuis', v_cron.prev_fire,
        'duree_s', round(extract(epoch from v_run.dernier_ok_fin - v_run.dernier_ok)::numeric, 1),
        'passages_24h', v_run.passages_24h, 'echecs_24h', v_run.echecs_24h,
        'message', case when v_statut = 'ok' then null else v_run.derniere_erreur end);
    end loop;

    -- 4. Planificateur applicatif -----------------------------------------
    foreach v_job in array r.scheduler_jobs loop
      select j.job_key, j.job_label, j.enabled, j.last_run_at, j.next_run_at, j.last_status,
             (select left(coalesce(sr.error_message, sr.message), 240) from public.scheduler_runs sr
               where sr.job_key = j.job_key order by sr.created_at desc limit 1) as dernier_message,
             (select sr.error_message is not null from public.scheduler_runs sr
               where sr.job_key = j.job_key order by sr.created_at desc limit 1) as dernier_en_erreur,
             (select max(sr.finished_at) from public.scheduler_runs sr
               where sr.job_key = j.job_key and sr.status = 'done') as dernier_ok
        into v_sched
        from public.scheduler_jobs j
        where j.job_key = v_job and j.deleted_at is null and j.archived_at is null;
      if not found then
        v_statuts := v_statuts || 'echec'::text;
        v_details := v_details || jsonb_build_object(
          'type', 'planificateur', 'nom', v_job, 'statut', 'echec',
          'message', 'Traitement introuvable dans la planification');
        continue;
      end if;
      v_statut := case
        when not v_sched.enabled then 'non_suivi'
        when v_sched.last_status in ('error', 'failed') then 'echec'
        when v_sched.last_status = 'partial' and coalesce(v_sched.dernier_en_erreur, false) then 'echec'
        when v_sched.next_run_at < now() - interval '15 minutes' then 'retard'
        when v_sched.last_status = 'partial' then 'retard'
        else 'ok' end;
      v_statuts := v_statuts || v_statut;
      v_dates := v_dates || coalesce(v_sched.dernier_ok, case when v_statut = 'ok' then v_sched.last_run_at end);
      v_details := v_details || jsonb_build_object(
        'type', 'planificateur', 'nom', v_sched.job_label, 'statut', v_statut,
        'derniere_maj', coalesce(v_sched.dernier_ok, case when v_statut = 'ok' then v_sched.last_run_at end),
        'dernier_passage', v_sched.last_run_at, 'prochain_passage', v_sched.next_run_at,
        'message', case when v_statut = 'ok' then null else v_sched.dernier_message end);
    end loop;

    -- 5. Volume (estimation statistique, pg_class.reltuples) ---------------
    select coalesce(sum(greatest(c.reltuples, 0)), 0), count(*)
      into v_volume, v_nb_tables
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'm')
        and exists (
          select 1 from unnest(r.volume_tables) vt
          where (vt like '%.*' and n.nspname = split_part(vt, '.', 1))
             or (vt not like '%.*' and n.nspname || '.' || c.relname = vt));

    -- Synthèse : pire état, dernière mise à jour la plus ancienne des
    -- composants suivis (une brique n'est à jour que si tout l'est).
    v_statut := null;
    select s into v_statut
      from unnest(v_statuts) s
      order by (rang ->> s)::integer desc
      limit 1;

    v_out := v_out || jsonb_build_object(
      'code', r.code, 'couche', r.couche, 'ordre', r.ordre, 'libelle', r.libelle,
      'icone', r.icone, 'mode', r.mode, 'frequence', r.frequence,
      'description', r.description, 'lien', r.lien, 'blocs', to_jsonb(r.blocs),
      'statut', coalesce(v_statut, 'non_suivi'),
      'derniere_maj', (select min(d) from unnest(v_dates) d where d is not null),
      'derniere_maj_recente', (select max(d) from unnest(v_dates) d where d is not null),
      'volume', case when v_nb_tables > 0 then round(v_volume) end,
      'nb_tables', case when v_nb_tables > 0 then v_nb_tables end,
      'details', v_details);
  end loop;

  return jsonb_build_object('genere_le', now(), 'flux', v_out);
end;
$function$;

revoke all on function public.get_admin_flux_etat() from public, anon;
grant execute on function public.get_admin_flux_etat() to authenticated;

-- ── Contenu initial du registre ─────────────────────────────────────────────

insert into public.admin_flux_registre
  (code, couche, ordre, libelle, icone, mode, frequence, description, lien, blocs,
   special, cron_jobs, scheduler_jobs, mesure_table, mesure_colonne, mesure_filtre, mesure_message_colonne,
   seuil_minutes, seuil_hors_plage_minutes, heure_debut, heure_fin, volume_tables)
values
  -- Sources
  ('src_sage', 'source', 10, 'SAGE 100', '🗄️', 'Export CSV TSE → Storage → import VPS par lot',
   'Lots 10h10 · 12h10 · 16h10 · 18h10 · 23h10',
   'Export PowerShell sur le TSE, dépôt dans le bucket sage-imports, import VPS en publication atomique par lot.',
   '/admin/performance-extraction', '{}',
   'sage_lot', '{}', '{}', null, null, null, null,
   300, 720, 11, 23, '{}'),
  ('src_blg', 'source', 20, 'BLG Cloud', '☁️', 'sync.js / sync_business.js sur le VPS (rôle blg_sync)',
   'Quotidien 03h00 · 03h30', 'Copie des tables BLG dans le schéma blg.', null, '{}',
   'blg', '{}', '{}', null, null, null, null,
   1560, null, null, null, '{}'),
  ('src_sirene', 'source', 30, 'Sirene (INSEE)', '🏢', 'API INSEE, maintenance base clients',
   'Créations et cessations J-1, mar. au sam. 04h30', null, '/admin/planification', '{territoire,clients}',
   null, '{}', '{job_1784540028911}', null, null, null, null,
   null, null, null, null, '{public.sirene_import_cursors}'),
  ('src_rge', 'source', 40, 'RGE (ADEME)', '🏅', 'API ADEME RGE',
   'Hebdomadaire, samedi 06h30', null, '/admin/planification', '{territoire,clients}',
   null, '{}', '{job_1784540135678}', 'public.rge_import_logs', 'imported_at', 'status = ''ok''', 'nb_rows_imported',
   10080, null, null, null, '{public.rge_cache}'),
  ('src_capacite', 'source', 50, 'Capacité gaz / froid', '🔥', 'Maintenance base clients',
   'Hebdomadaire, samedi 06h00', null, '/admin/planification', '{territoire,clients}',
   null, '{}', '{job_1784540170324}', null, null, null, null,
   null, null, null, null, '{}'),
  ('src_hiparts', 'source', 60, 'Hitachi Hi-Parts', '🔧', 'Aspiration du catalogue (cron Vercel)',
   'Toutes les 5 min, relance complète tous les 7 jours', null, null, '{hotline}',
   null, '{}', '{}', 'public.hiparts_sync_etat', 'dernier_passage', null, 'dernier_message',
   20, null, null, null, '{public.hiparts_articles,public.hiparts_produits,public.hiparts_schemas}'),
  ('src_maritime', 'source', 70, 'Compagnies maritimes', '🚢', 'Relevé Claude MSC / CMA CGM',
   '1 fois par jour, le matin', 'Suivi des containers CONT Hitachi.', '/stock/portefeuille-cdf', '{logistique}',
   null, '{}', '{}', 'public.appro_container_releves', 'created_at', null, null,
   1560, 4320, 9, 20, '{public.appro_container_releves}'),
  ('src_mystock', 'source', 80, 'MyStock FMS', '🏭', 'Fichier daté importé dans le compagnon',
   'À la réception d''un fichier', null, null, '{logistique}',
   null, '{}', '{}', 'public.mystock_controles', 'cree_le', null, 'fichier_nom',
   null, null, null, null, '{public.mystock_controle_lignes}'),
  ('src_saisies', 'source', 90, 'Saisies et imports', '⌨️', 'Écrans du compagnon, fichier compta « Qui vous doit quoi »',
   'Temps réel / manuel', null, '/retards-paiement', '{}',
   null, '{}', '{}', 'public.retards_paiement_clients', 'imported_at', null, 'source_fichier',
   null, null, null, null, '{public.retards_paiement_clients}'),

  -- Supabase · données de base
  ('base_sage', 'base', 10, 'sage.*', '🗃️', 'Miroir SAGE', 'Avec chaque lot', null, null, '{}',
   'sage_lot', '{}', '{}', null, null, null, null,
   300, 720, 11, 23, '{sage.*}'),
  ('base_blg', 'base', 20, 'blg.*', '🗃️', 'Miroir BLG', 'Quotidien', null, null, '{}',
   'blg', '{}', '{}', null, null, null, null,
   1560, null, null, null, '{blg.*}'),
  ('base_ref', 'base', 30, 'Référentiels', '📇', 'Tiers, articles, collaborateurs',
   '08h10 · 14h10', 'Rafraîchis par sync_sage_to_activite_tables.', null, '{}',
   null, '{sync-sage-vers-activite-0810-paris,sync-sage-vers-activite-1410-paris}', '{}', null, null, null, null,
   null, null, null, null, '{public.ref_tiers,public.ref_articles,public.ref_collaborateurs}'),
  ('base_externes', 'base', 40, 'Données externes', '🌐', 'Sirene, RGE, Hi-Parts', 'Quotidien à hebdomadaire',
   null, null, '{}',
   null, '{}', '{job_1784540028911,job_1784540135678}', 'public.hiparts_sync_etat', 'dernier_passage', null, null,
   20, null, null, null, '{public.rge_cache,public.hiparts_articles,public.hiparts_produits}'),
  ('base_containers', 'base', 50, 'Containers', '📦', 'Relevés et RDV FMS', 'Quotidien', null, '/stock/portefeuille-cdf', '{}',
   null, '{}', '{}', 'public.appro_container_releves', 'created_at', null, null,
   1560, 4320, 9, 20, '{public.appro_container_releves}'),
  ('base_saisies', 'base', 60, 'Saisies', '✏️', 'Tâches, RDV, CEE, hotline', 'Temps réel', null, null, '{}',
   null, '{}', '{}', null, null, null, null,
   null, null, null, null, '{public.todo_actions,public.rdv_compagnon,public.client_comptes_rendus,public.cee_dossiers,public.hotline_tickets}'),

  -- Supabase · données calculées
  ('calc_ventes', 'calcule', 10, 'Ventes', '🧾', 'Activité, devis, factures', '08h10 · 14h10',
   'sync_sage_to_activite_tables : activite_*, devis_lignes, facture_lignes.', '/cycle-synchronisation', '{activite,clients,agences-commerciaux}',
   null, '{sync-sage-vers-activite-0810-paris,sync-sage-vers-activite-1410-paris}', '{}', null, null, null, null,
   null, null, null, null, '{public.activite_lignes,public.activite_entete,public.devis_lignes,public.facture_lignes}'),
  ('calc_stock', 'calcule', 20, 'Stock projeté', '📈', 'run_stock_projection_recalcul_auto', '7 fois par jour (xxh25)',
   null, null, '{logistique}',
   null, '{stock-projection-recalcul-auto-0825-paris,stock-projection-recalcul-auto-1025-paris,stock-projection-recalcul-auto-1225-paris,stock-projection-recalcul-auto-1425-paris,stock-projection-recalcul-auto-1625-paris,stock-projection-recalcul-auto-1825-paris,stock-projection-recalcul-auto-2125-paris}', '{}',
   null, null, null, null, null, null, null, null, '{}'),
  ('calc_indicateurs', 'calcule', 30, 'Indicateurs', '📊', 'Focus mensuel, Vision ONE PAGE, SMC',
   'Chaque minute à quotidien', null, null, '{activite,clients,agences-commerciaux}',
   null, '{focus-mensuel-cache-worker-v7,focus-mensuel-agency-control-worker-v7,focus-mensuel-cache-watchdog-v7,focus-mensuel-dimensions-refresh-v8,focus-mensuel-agency-control-refresh-v7,focus-mensuel-cache-live-v7,vision_bis_portefeuille_refresh_midi,vision_bis_portefeuille_refresh}',
   '{refresh_smc_daily}', null, null, null, null, null, null, null, null,
   '{public.synthese_multi_clients_cache}'),
  ('calc_alertes', 'calcule', 40, 'Alertes', '🔔', 'Centre d''alertes, pastilles du bandeau',
   '10 min à quotidien', null, null, '{activite,clients,logistique}',
   null, '{alerte-couverture-stock-cache-10min,client-certification-alert-cache-refresh-v1,data-coherence-alert-hourly,cdc-promesses-controle-hourly,client-alertes-controle-quotidien}', '{}',
   null, null, null, null, null, null, null, null, '{}'),
  ('calc_sage_blg', 'calcule', 50, 'SAGE ↔ BLG', '🔀', 'Rapprochements et comparaisons',
   'Horaire, 5h–20h', null, null, '{blg}',
   null, '{refresh_controle_articles,portefeuille-blg-sage-hourly,cdc-comparaison-refresh-hourly,rappro-sage-blg-hourly,blg-rattrapage-receptions-cdf}', '{}',
   null, null, null, null, null, null, null, null, '{}'),
  ('calc_appro', 'calcule', 60, 'Appro, FMS', '🚚', 'Plan d''expédition, conso, RDV FMS',
   '08h40 · horaire · nuit', null, null, '{logistique}',
   null, '{plan-expedition-fms-recalcul-0840-paris,appro-rdv-fms-sync-sage,appro-conso-depot-nightly,appro_purger_propositions_manuelles,stock-depot-snapshot-journalier,rapport-stock-snapshot-fin-mois}', '{}',
   null, null, null, null, null, null, null, null, '{}'),
  ('calc_technique', 'calcule', 70, 'Maintenance', '🛠️', 'Jobs admin, purges, clôtures',
   'Chaque minute à quotidien', null, '/admin/planification', '{admin,hotline}',
   null, '{admin-background-jobs-worker,adjust-sage-sync-dst-daily,hotline-cloture-auto,purge-assistant-conversation-memory-daily,stock-projection-purge-runs-v1}', '{}',
   null, null, null, null, null, null, null, null, '{}')
on conflict (code) do nothing;
