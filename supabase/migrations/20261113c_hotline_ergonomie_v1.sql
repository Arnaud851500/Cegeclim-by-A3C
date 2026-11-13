-- ============================================================================
-- 20261113c_hotline_ergonomie_v1.sql — Retours d'ergonomie V1 (Philippe VERGES,
-- 13/11/2026, transmis par Arnaud)
-- ----------------------------------------------------------------------------
--  - statut « En attente client » (ligne orange dans la liste des tickets) ;
--  - présence : ticket ouvert dans la console par un hotliner (consulte_par /
--    consulte_le, rafraîchi chaque minute) → n° en rouge gras pour les autres ;
--  - tickets de test : est_test, numérotés TEST… au lieu de TICK…, exclus des
--    statistiques, supprimables d'un coup (hotline_supprimer_tickets_test) ;
--  - verrou des tickets résolus : plus aucune modification ni commentaire
--    (sauf horodatages) ; on duplique le ticket pour reprendre le dossier ;
--  - paramètres hotline (hotline_parametres) : clôture automatique après N
--    jours sans activité (« pas de suite donnée par le client »), export CSV
--    automatique tous les N jours, affichage du diagnostic guidé et de la
--    classification détaillée (masqués en V1) ;
--  - clôture automatique quotidienne (pg_cron) ;
--  - exports CSV automatiques : bucket privé « hotline-exports » + table
--    hotline_exports (fichiers générés par /api/hotline/export-auto).
-- ============================================================================

-- ── Statut « En attente client » ─────────────────────────────────────────────
alter table public.hotline_tickets drop constraint if exists hotline_tickets_statut_check;
alter table public.hotline_tickets add constraint hotline_tickets_statut_check
  check (statut in ('OUVERT', 'EN_COURS', 'ATTENTE_CLIENT', 'ESCALADE', 'RESOLU'));

do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['hotline_recherche', 'hotline_stats'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f;
    if v_def is not null and v_def not like '%ATTENTE_CLIENT%' then
      execute replace(v_def, $r$('OUVERT', 'EN_COURS', 'ESCALADE')$r$, $r$('OUVERT', 'EN_COURS', 'ATTENTE_CLIENT', 'ESCALADE')$r$);
    end if;
  end loop;
end
$$;

-- ── Présence et tickets de test ──────────────────────────────────────────────
alter table public.hotline_tickets add column if not exists consulte_par text;
alter table public.hotline_tickets add column if not exists consulte_le timestamptz;
alter table public.hotline_tickets add column if not exists est_test boolean not null default false;

drop function if exists public.hotline_numero_suivant(timestamptz);
create or replace function public.hotline_numero_suivant(p_date timestamptz, p_prefixe text default 'TICK')
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prefixe text := coalesce(nullif(p_prefixe, ''), 'TICK') || to_char(coalesce(p_date, now()) at time zone 'Europe/Paris', 'DDMMYY');
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('hotline_numero_' || v_prefixe));
  select coalesce(max(nullif(regexp_replace(substr(numero, length(v_prefixe) + 1), '\D', '', 'g'), '')::int), 0) + 1
    into v_n
  from public.hotline_tickets
  where numero like v_prefixe || '%';
  return v_prefixe || lpad(v_n::text, 3, '0');
end
$$;

create or replace function public.hotline_ticket_numeroter()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(btrim(new.numero), '') <> '' and new.numero not like 'HT-%' then
    return new;
  end if;
  new.numero := public.hotline_numero_suivant(coalesce(new.opened_at, now()), case when new.est_test then 'TEST' else 'TICK' end);
  return new;
end
$$;

-- Statistiques : tickets de test exclus.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_stats(date, date, text)'::regprocedure) into v_def;
  if v_def not like '%est_test%' then
    execute replace(v_def, 'where opened_at >= p_debut and opened_at < p_fin + 1', 'where opened_at >= p_debut and opened_at < p_fin + 1 and not est_test');
  end if;
end
$$;

create or replace function public.hotline_supprimer_tickets_test()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer;
begin
  if not public.hotline_est_expert() then
    raise exception 'Suppression des tickets de test réservée aux experts hotline.';
  end if;
  perform set_config('hotline.deverrouille', 'on', true);
  delete from public.hotline_tickets where est_test;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
grant execute on function public.hotline_supprimer_tickets_test() to authenticated;

-- ── Verrou des tickets résolus ───────────────────────────────────────────────
-- Contournement réservé aux traitements serveur : set_config('hotline.deverrouille', 'on', true).
create or replace function public.hotline_ticket_verrou()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_libres text[] := array['updated_at', 'resolved_at', 'closed_at', 'first_action_at', 'escalated_at', 'consulte_par', 'consulte_le', 'classif_at'];
begin
  if old.statut = 'RESOLU' and coalesce(current_setting('hotline.deverrouille', true), '') <> 'on'
     and (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'Ticket % résolu : il est verrouillé. Dupliquer le ticket pour reprendre le dossier.', old.numero;
  end if;
  return new;
end
$$;

drop trigger if exists trg_hotline_ticket_verrou on public.hotline_tickets;
create trigger trg_hotline_ticket_verrou
before update on public.hotline_tickets
for each row execute function public.hotline_ticket_verrou();

create or replace function public.hotline_etape_verrou()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.type not in ('RESOLUTION', 'CLOTURE')
     and coalesce(current_setting('hotline.deverrouille', true), '') <> 'on'
     and exists (select 1 from public.hotline_tickets t where t.id = new.ticket_id and t.statut = 'RESOLU') then
    raise exception 'Ticket résolu : il est verrouillé. Dupliquer le ticket pour reprendre le dossier.';
  end if;
  return new;
end
$$;

drop trigger if exists trg_hotline_etape_verrou on public.hotline_ticket_etapes;
create trigger trg_hotline_etape_verrou
before insert on public.hotline_ticket_etapes
for each row execute function public.hotline_etape_verrou();

-- La reprise de l'historique (ré-import) peut mettre à jour des tickets résolus.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'hotline_importer_historique';
  if v_def is not null and v_def not like '%hotline.deverrouille%' then
    execute regexp_replace(v_def, E'\nbegin\n', E'\nbegin\n  perform set_config(''hotline.deverrouille'', ''on'', true);\n');
  end if;
end
$$;

-- ── Paramètres hotline ───────────────────────────────────────────────────────
create table if not exists public.hotline_parametres (
  cle text primary key,
  valeur jsonb,
  libelle text,
  updated_at timestamptz not null default now(),
  updated_by text default public.current_user_email()
);

insert into public.hotline_parametres (cle, valeur, libelle) values
  ('cloture_auto_jours', 'null', 'Clôture automatique après N jours sans activité (vide = désactivée)'),
  ('export_auto_jours', 'null', 'Export CSV automatique tous les N jours (vide = désactivé)'),
  ('diagnostic_guide_actif', 'false', 'Afficher le diagnostic guidé dans la console'),
  ('classification_detaillee_active', 'false', 'Afficher la classification détaillée (symptôme, organe, actions)')
on conflict (cle) do nothing;

alter table public.hotline_parametres enable row level security;
drop policy if exists hotline_parametres_lecture on public.hotline_parametres;
create policy hotline_parametres_lecture on public.hotline_parametres for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_parametres_ecriture on public.hotline_parametres;
create policy hotline_parametres_ecriture on public.hotline_parametres for update to authenticated
  using (public.hotline_est_expert()) with check (public.hotline_est_expert());
grant select, update on public.hotline_parametres to authenticated;

-- ── Clôture automatique ──────────────────────────────────────────────────────
create or replace function public.hotline_cloture_auto()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_jours int;
  v_n int := 0;
  r record;
begin
  select nullif(valeur #>> '{}', '')::int into v_jours from public.hotline_parametres where cle = 'cloture_auto_jours';
  if v_jours is null or v_jours <= 0 then
    return 0;
  end if;
  for r in
    select t.id,
           greatest(t.updated_at, coalesce((select max(e.at) from public.hotline_ticket_etapes e where e.ticket_id = t.id), t.opened_at)) as derniere
    from public.hotline_tickets t
    where t.statut <> 'RESOLU' and not t.est_test
  loop
    if r.derniere < now() - make_interval(days => v_jours) then
      update public.hotline_tickets
      set statut = 'RESOLU',
          issue = case when filiere = 'THERMIQUE' then coalesce(issue, 'SANS_SUITE') else issue end,
          rappel_par = null
      where id = r.id;
      insert into public.hotline_ticket_etapes (ticket_id, type, libelle, auteur, details)
      values (r.id, 'RESOLUTION', format('Clôture automatique : pas de suite donnée par le client (%s jours sans activité)', v_jours), 'cloture-auto', jsonb_build_object('auto', true));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hotline-cloture-auto') then
    perform cron.unschedule('hotline-cloture-auto');
  end if;
  perform cron.schedule('hotline-cloture-auto', '10 2 * * *', 'select public.hotline_cloture_auto();');
end
$$;

-- ── Exports CSV automatiques ─────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('hotline-exports', 'hotline-exports', false)
on conflict (id) do nothing;

drop policy if exists hotline_exports_lecture on storage.objects;
create policy hotline_exports_lecture on storage.objects for select to authenticated
  using (bucket_id = 'hotline-exports' and public.hotline_est_expert());

create table if not exists public.hotline_exports (
  id uuid primary key default gen_random_uuid(),
  chemin text not null,
  nb_tickets integer not null default 0,
  mode text not null default 'AUTO',
  cree_le timestamptz not null default now()
);
alter table public.hotline_exports enable row level security;
drop policy if exists hotline_exports_select on public.hotline_exports;
create policy hotline_exports_select on public.hotline_exports for select to authenticated using (public.hotline_est_expert());
grant select on public.hotline_exports to authenticated;

-- ── Droits (appliqués en 20261113d / 20261113e) ──────────────────────────────
revoke execute on function public.hotline_cloture_auto() from public, anon, authenticated;
revoke execute on function public.hotline_supprimer_tickets_test() from public, anon;
-- Appelée par le trigger de numérotation (exécuté avec les droits de l'utilisateur).
grant execute on function public.hotline_numero_suivant(timestamptz, text) to authenticated;
