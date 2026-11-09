-- 20261109d_cdc_flux_historique_sql.sql
--
-- Reprise de l'historique du flux des CDC — analyse des CSV archivés EN SQL.
-- Les Edge Functions n'ont pas assez de calcul pour analyser des CSV de 18 Mo
-- (WORKER_RESOURCE_LIMIT) : l'Edge Function « cdc-flux-historique » se contente
-- de générer des liens signés (public.cdc_flux_hist_urls) ; Postgres télécharge
-- lui-même les fichiers par pg_net et les analyse ici.
--
-- Pilotage : job pg_cron « cdc-flux-historique » (chaque minute) → cdc_flux_hist_tick() :
--   1. traite, dans l'ordre chronologique, les instantanés dont les deux fichiers sont arrivés ;
--   2. demande les fichiers des 5 instantanés suivants ;
--   3. se désactive quand tout est traité.
--
-- Format des fichiers : champs entre guillemets, séparateur « ; », fin de ligne CRLF,
-- virgule décimale. Fichiers d'entête d'août (ancien format DP_VENTES, colonnes V_*) :
-- n° de pièce / type / tiers repris, pas de date de livraison. Fichiers sans ligne
-- d'en-tête (export de mi-septembre) : instantané ignoré.

-- Découpe d'une ligne CSV « "a";"b";"c" » en tableau
create or replace function public.cdc_flux_csv_champs(p_ligne text)
returns text[]
language sql
immutable
as $$
  select string_to_array(
           regexp_replace(regexp_replace(rtrim(p_ligne, E'\r'), '^"', ''), '"$', ''),
           '";"');
$$;

-- Analyse d'un instantané : alimente cdc_flux_hist_lignes / cdc_flux_hist_entetes et renvoie ses statistiques
create or replace function public.cdc_flux_hist_analyser(p_snap text, p_act text, p_ent text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage'
set statement_timeout to '120s'
as $$
declare
  h        text[];
  i_doc int; i_type int; i_art int; i_qte int; i_mt int; i_bc int; i_tiers int; i_rep int; i_des int; i_dp int;
  he       text[];
  e_piece int; e_type int; e_tiers int; e_dp int; e_dl int;
  v_stats  jsonb;
begin
  delete from public.cdc_flux_hist_lignes  where snap = p_snap;
  delete from public.cdc_flux_hist_entetes where snap = p_snap;

  -- en-tête du fichier d'activité
  h := (select array_agg(upper(trim(x))) from unnest(public.cdc_flux_csv_champs(split_part(p_act, E'\n', 1))) x);
  i_doc   := array_position(h, 'VL_DOCNUM');
  i_type  := array_position(h, 'VL_DOCTYPE');
  i_art   := array_position(h, 'VL_ART_NUM');
  i_qte   := array_position(h, 'QTEVENDUES');
  i_mt    := array_position(h, 'CAHTNET');
  i_bc    := array_position(h, 'VL_DLPIECEBC');
  i_tiers := array_position(h, 'VL_CTNUM');
  i_rep   := array_position(h, 'VL_RENOM');
  i_des   := array_position(h, 'VL_DLDESIGN');
  i_dp    := array_position(h, 'DATE_PIECE');

  if i_doc is null or i_type is null or i_art is null or i_qte is null then
    return jsonb_build_object('format_ok', false, 'nb_lignes', 0, 'nb_lignes_cdc', 0, 'nb_aval', 0, 'nb_aval_bc', 0, 'nb_entetes', 0);
  end if;

  create temporary table if not exists tmp_cdc_flux_l (
    type text, doc text, art text, qte numeric, mt numeric, bc text, tiers text, rep text, des text, dp date
  ) on commit drop;
  delete from tmp_cdc_flux_l where true;

  insert into tmp_cdc_flux_l
  select f[i_type], nullif(trim(f[i_doc]), ''), upper(nullif(trim(f[i_art]), '')),
         coalesce(sage.to_numeric_safe(f[i_qte]), 0),
         coalesce(sage.to_numeric_safe(f[i_mt]), 0),
         nullif(trim(f[i_bc]), ''),
         nullif(trim(f[i_tiers]), ''),
         nullif(trim(f[i_rep]), ''),
         nullif(trim(replace(f[i_des], '""', '"')), ''),
         case when i_dp is not null then public.sage_date_text_to_date(f[i_dp]) end
    from (
      select public.cdc_flux_csv_champs(l) f
        from unnest(string_to_array(p_act, E'\n')) with ordinality t(l, n)
       where n > 1 and length(l) > 2
    ) x
   where cardinality(f) >= array_length(h, 1) - 1;

  insert into public.cdc_flux_hist_lignes (snap, kind, cdc, art, qte, nb, mt, tiers, rep, designation, date_piece, pieces)
  select p_snap, 'C', doc, art, sum(qte), count(*), round(sum(mt), 2), max(tiers), max(rep), max(des), max(dp), null
    from tmp_cdc_flux_l
   where type = '1' and doc is not null and art is not null
   group by doc, art;

  insert into public.cdc_flux_hist_lignes (snap, kind, cdc, art, qte, nb, mt, pieces)
  select p_snap, 'A', bc, art, sum(qte), count(*), 0, string_agg(distinct doc, ', ' order by doc)
    from tmp_cdc_flux_l
   where type in ('2','3','6','7') and upper(coalesce(bc, '')) like 'CDC%' and art is not null
   group by bc, art;

  -- entêtes (nouveau format F_DOCENTETE, ou ancien format DP_VENTES d'août)
  if coalesce(p_ent, '') <> '' then
    he := (select array_agg(upper(trim(x))) from unnest(public.cdc_flux_csv_champs(split_part(p_ent, E'\n', 1))) x);
    e_piece := coalesce(array_position(he, 'NUMERO_PIECE'), array_position(he, 'V_DOCNUM'));
    e_type  := coalesce(array_position(he, 'TYPE_DOC_CODE'), array_position(he, 'V_DOCTYPE'));
    e_tiers := coalesce(array_position(he, 'NUMERO_TIERS'), array_position(he, 'V_CLINUM'));
    e_dp    := coalesce(array_position(he, 'DATE_PIECE'), array_position(he, 'V_DOCDATE'));
    e_dl    := array_position(he, 'DATE_LIVRAISON');
    if e_piece is not null and e_type is not null then
      insert into public.cdc_flux_hist_entetes (snap, numero_piece, numero_tiers, date_piece, date_livraison)
      select distinct on (trim(f[e_piece]))
             p_snap, trim(f[e_piece]),
             case when e_tiers is not null then nullif(trim(f[e_tiers]), '') end,
             case when e_dp is not null then public.sage_date_text_to_date(f[e_dp]) end,
             case when e_dl is not null then public.sage_date_text_to_date(f[e_dl]) end
        from (
          select public.cdc_flux_csv_champs(l) f
            from unnest(string_to_array(p_ent, E'\n')) with ordinality t(l, n)
           where n > 1 and length(l) > 2
        ) x
       where trim(f[e_type]) = '1' and coalesce(trim(f[e_piece]), '') <> '';
    end if;
  end if;

  select jsonb_build_object(
           'format_ok', true,
           'nb_lignes', (select count(*) from tmp_cdc_flux_l),
           'nb_lignes_cdc', (select count(*) from tmp_cdc_flux_l where type = '1' and art is not null),
           'nb_cdc', (select count(distinct doc) from tmp_cdc_flux_l where type = '1'),
           'nb_aval', (select count(*) from tmp_cdc_flux_l where type in ('2','3','6','7')),
           'nb_aval_bc', (select count(*) from tmp_cdc_flux_l where type in ('2','3','6','7') and upper(coalesce(bc,'')) like 'CDC%'),
           'nb_entetes', (select count(*) from public.cdc_flux_hist_entetes where snap = p_snap))
    into v_stats;
  return v_stats;
end;
$$;
revoke all on function public.cdc_flux_hist_analyser(text, text, text) from public, anon, authenticated;

-- Une date de livraison n'est comparée que si les deux instantanés la portent
-- (les entêtes d'août n'en ont pas) : sinon le changement de format créerait de faux événements.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.cdc_flux_hist_comparer(text,text)'::regprocedure);
  d := replace(d,
    'and a.date_livraison is distinct from n.date_livraison;',
    'and a.date_livraison is not null and n.date_livraison is not null
     and a.date_livraison <> n.date_livraison;');
  if position('a.date_livraison is not null' in d) = 0 then raise exception 'remplacement non effectué'; end if;
  execute d;
end $$;

-- Pas de pilotage : chaque minute
create or replace function public.cdc_flux_hist_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage', 'net'
set statement_timeout to '170s'
as $$
declare
  c_avance constant int := 5;
  c_ratio  constant numeric := 0.7;
  t0       timestamptz := clock_timestamp();
  u        public.cdc_flux_hist_urls%rowtype;
  ra       record;
  re       record;
  v_stats  jsonb;
  v_ref    int;
  v_motif  text;
  v_dernier text;
  v_traites int := 0;
  v_n      int;
begin
  if not pg_try_advisory_xact_lock(hashtext('cdc_flux_hist_tick')) then
    return jsonb_build_object('occupe', true);
  end if;

  -- 1. traitement dans l'ordre chronologique
  loop
    exit when clock_timestamp() - t0 > interval '100 seconds';
    select * into u from public.cdc_flux_hist_urls
     where statut in ('a_telecharger', 'demande') order by snap limit 1;
    exit when not found or u.statut <> 'demande';

    select status_code, content, error_msg into ra from net._http_response where id = u.req_activite;
    exit when not found;
    select status_code, content, error_msg into re from net._http_response where id = u.req_entete;
    exit when not found;

    if coalesce(ra.status_code, 0) <> 200 or coalesce(re.status_code, 0) <> 200 then
      -- échec de téléchargement : nouvelle tentative au prochain passage (lien régénéré si expiré)
      update public.cdc_flux_hist_urls
         set statut = 'a_telecharger', message = left(coalesce(ra.error_msg, re.error_msg, 'HTTP ' || ra.status_code || '/' || re.status_code), 300)
       where snap = u.snap;
      exit;
    end if;

    v_stats := public.cdc_flux_hist_analyser(u.snap, ra.content, re.content);
    delete from net._http_response where id in (u.req_activite, u.req_entete);

    select dernier_snap_ok into v_dernier from public.cdc_flux_hist_progress where id = 1;
    select nb_lignes_cdc into v_ref from public.cdc_flux_hist_snaps where snap = v_dernier;

    v_motif := case
      when not (v_stats->>'format_ok')::boolean then 'format de fichier inattendu (pas de ligne d''en-tête VL_DOCNUM / VL_DOCTYPE / QTEVENDUES)'
      when (v_stats->>'nb_lignes_cdc')::int = 0 then 'aucune ligne de CDC'
      when (v_stats->>'nb_aval')::int > 0 and (v_stats->>'nb_aval_bc')::int = 0 then 'PL / BL sans n° de CDC d''origine'
      when v_ref > 0 and (v_stats->>'nb_lignes_cdc')::int < v_ref * c_ratio
        then 'baisse anormale des lignes de CDC (' || (v_stats->>'nb_lignes_cdc') || ' contre ' || v_ref || ')'
    end;

    insert into public.cdc_flux_hist_snaps (snap, ts, nb_lignes, nb_lignes_cdc, nb_cdc, nb_aval, nb_aval_bc, nb_entetes, statut, motif)
    values (u.snap, to_timestamp(u.snap, 'YYYYMMDD_HH24MISS') at time zone 'UTC',
            (v_stats->>'nb_lignes')::int, (v_stats->>'nb_lignes_cdc')::int, (v_stats->>'nb_cdc')::int,
            (v_stats->>'nb_aval')::int, (v_stats->>'nb_aval_bc')::int, (v_stats->>'nb_entetes')::int,
            case when v_motif is null then 'charge' else 'ignore' end, v_motif)
    on conflict (snap) do update
      set nb_lignes = excluded.nb_lignes, nb_lignes_cdc = excluded.nb_lignes_cdc, nb_cdc = excluded.nb_cdc,
          nb_aval = excluded.nb_aval, nb_aval_bc = excluded.nb_aval_bc, nb_entetes = excluded.nb_entetes,
          statut = excluded.statut, motif = excluded.motif, traite_at = now();

    if v_motif is not null then
      delete from public.cdc_flux_hist_lignes  where snap = u.snap;
      delete from public.cdc_flux_hist_entetes where snap = u.snap;
      update public.cdc_flux_hist_urls set statut = 'ignore', message = v_motif where snap = u.snap;
    else
      if v_dernier is not null then
        v_n := public.cdc_flux_hist_comparer(v_dernier, u.snap);
      else
        update public.cdc_flux_hist_snaps set statut = 'traite', nb_evenements = 0 where snap = u.snap;
        v_n := 0;
      end if;
      update public.cdc_flux_hist_urls set statut = 'traite', message = v_n || ' événement(s)' where snap = u.snap;
      update public.cdc_flux_hist_progress
         set dernier_snap_ok = u.snap, message = u.snap || ' traité (' || v_n || ' événements)', updated_at = now()
       where id = 1;
    end if;
    v_traites := v_traites + 1;
  end loop;

  -- 2. demandes de téléchargement d'avance
  for u in
    select * from public.cdc_flux_hist_urls
     where statut = 'a_telecharger'
     order by snap
     limit greatest(0, c_avance - (select count(*) from public.cdc_flux_hist_urls where statut = 'demande'))
  loop
    update public.cdc_flux_hist_urls
       set statut = 'demande', demande_at = now(),
           req_activite = net.http_get(url := u.url_activite, timeout_milliseconds := 120000),
           req_entete   = net.http_get(url := u.url_entete,   timeout_milliseconds := 120000)
     where snap = u.snap;
  end loop;

  -- 3. fin
  if not exists (select 1 from public.cdc_flux_hist_urls where statut in ('a_telecharger', 'demande')) then
    select dernier_snap_ok into v_dernier from public.cdc_flux_hist_progress where id = 1;
    delete from public.cdc_flux_hist_lignes  where snap = v_dernier;
    delete from public.cdc_flux_hist_entetes where snap = v_dernier;
    update public.cdc_flux_hist_progress
       set termine = true, message = 'Reprise terminée (dernier instantané ' || coalesce(v_dernier, '—') || ')', updated_at = now()
     where id = 1;
    perform cron.unschedule('cdc-flux-historique');
  end if;

  return jsonb_build_object('traites', v_traites, 'duree_s', round(extract(epoch from clock_timestamp() - t0)::numeric, 1));
end;
$$;
revoke all on function public.cdc_flux_hist_tick() from public, anon, authenticated;
