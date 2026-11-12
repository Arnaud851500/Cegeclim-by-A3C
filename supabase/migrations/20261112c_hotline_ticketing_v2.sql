-- ============================================================================
-- 20261112c_hotline_ticketing_v2.sql — Revue de l'écran de ticketing (12/11/2026)
-- ----------------------------------------------------------------------------
-- Demandes d'Arnaud :
--  1. Numérotation TICKJJMMAA + compteur du jour sur 3 chiffres (même format
--     que les tickets repris de l'ancien outil). Les tickets HT-AA-NNNNN déjà
--     créés sont renumérotés.
--  3. Historiques Contact / Chantier : tickets non résolus d'abord, puis du
--     plus récent au plus ancien (hotline_contexte).
--  4. Plus d'état « Clos » : un ticket résolu est clos. Les tickets CLOS
--     passent RESOLU (resolved_at conservé ou repris de closed_at).
--  7. Redescente N2 → N1 : nouvelle étape REDESCENTE.
--  8. / 9. Fonction hotline du collaborateur (N1, N2, N3) et départements du
--     N2 : user_page_access.hotline_niveau / hotline_departements ; RPC
--     hotline_collaborateurs(p_numero_tiers) → N2 proposé par défaut selon le
--     département du client.
-- 10. Rappel client confié à un N1 : hotline_tickets.rappel_par (+ date,
--     demandeur) ; étape RAPPEL.
-- 11. Motif de l'appel repris en tête des commentaires : étape NOTE_RAPIDE
--     (ne compte pas comme première action).
-- 12. Modèles GE / UI possibles d'après le début du n° de série :
--     hotline_modeles_par_serie(p_prefixe).
-- 13. Commentaire interne : étape COMMENTAIRE_INTERNE (exclue de la fiche
--     ticket PDF).
-- ============================================================================

-- ── 1. Numérotation ─────────────────────────────────────────────────────────
alter table public.hotline_tickets alter column numero drop default;

create or replace function public.hotline_numero_suivant(p_date timestamptz)
returns text
language plpgsql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prefixe text := 'TICK' || to_char(coalesce(p_date, now()) at time zone 'Europe/Paris', 'DDMMYY');
  v_n int;
begin
  -- Un verrou par jour : deux ouvertures simultanées n'obtiennent pas le même numéro.
  perform pg_advisory_xact_lock(hashtext('hotline_numero_' || v_prefixe));
  select coalesce(max(nullif(regexp_replace(substr(numero, 11), '\D', '', 'g'), '')::int), 0) + 1
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
  -- Numéro fourni (reprise de l'ancien outil) : conservé.
  if coalesce(btrim(new.numero), '') <> '' and new.numero not like 'HT-%' then
    return new;
  end if;
  new.numero := public.hotline_numero_suivant(coalesce(new.opened_at, now()));
  return new;
end
$$;

drop trigger if exists trg_hotline_ticket_numeroter on public.hotline_tickets;
create trigger trg_hotline_ticket_numeroter
before insert on public.hotline_tickets
for each row execute function public.hotline_ticket_numeroter();

-- Renumérotation des tickets HT-… existants, dans l'ordre de création.
do $$
declare
  r record;
  v_nouveau text;
begin
  for r in select id, numero, opened_at from public.hotline_tickets where numero like 'HT-%' order by opened_at, numero loop
    v_nouveau := public.hotline_numero_suivant(r.opened_at);
    update public.hotline_tickets set numero = v_nouveau where id = r.id;
    update public.hotline_ticket_etapes set libelle = replace(libelle, r.numero, v_nouveau) where ticket_id = r.id and libelle like '%' || r.numero || '%';
  end loop;
end
$$;

-- ── 4. Suppression de l'état « Clos » ────────────────────────────────────────
alter table public.hotline_tickets drop constraint if exists hotline_tickets_statut_check;

update public.hotline_tickets
set statut = 'RESOLU',
    resolved_at = coalesce(resolved_at, closed_at, updated_at),
    closed_at = coalesce(closed_at, resolved_at, updated_at)
where statut = 'CLOS';

alter table public.hotline_tickets
  add constraint hotline_tickets_statut_check check (statut in ('OUVERT', 'EN_COURS', 'ESCALADE', 'RESOLU'));

-- Fonctions qui citaient 'CLOS' : même code, 'CLOS' remplacé par 'RESOLU'.
do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['hotline_importer_historique', 'hotline_recherche', 'hotline_ticket_classif_controle'] loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = f;
    if v_def is not null and v_def like '%''CLOS''%' then
      execute replace(v_def, '''CLOS''', '''RESOLU''');
    end if;
  end loop;
end
$$;

-- ── Étapes : nouveaux types ──────────────────────────────────────────────────
alter table public.hotline_ticket_etapes drop constraint if exists hotline_ticket_etapes_type_check;
alter table public.hotline_ticket_etapes add constraint hotline_ticket_etapes_type_check check (type in (
  'OUVERTURE', 'IDENTIFICATION', 'NOTE_RAPIDE', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'COMMENTAIRE_INTERNE',
  'ESCALADE', 'REDESCENTE', 'RAPPEL', 'PRECONISATION', 'RESOLUTION', 'CLOTURE', 'REOUVERTURE', 'PIECE_JOINTE', 'DEMANDE_PIECE'));

create or replace function public.hotline_etape_horodater()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.hotline_tickets t set
    first_action_at = coalesce(t.first_action_at, case when new.type not in ('OUVERTURE', 'IDENTIFICATION', 'NOTE_RAPIDE') then new.at end),
    escalated_at    = case when new.type = 'ESCALADE' then new.at else t.escalated_at end,
    -- Résolu = clos (12/11/2026).
    resolved_at     = case when new.type = 'RESOLUTION' then new.at when new.type = 'REOUVERTURE' then null else t.resolved_at end,
    closed_at       = case when new.type in ('RESOLUTION', 'CLOTURE') then new.at when new.type = 'REOUVERTURE' then null else t.closed_at end,
    updated_at      = now()
  where t.id = new.ticket_id;
  return new;
end
$$;

-- ── 10. Rappel confié à un N1 ────────────────────────────────────────────────
alter table public.hotline_tickets add column if not exists rappel_par text;
alter table public.hotline_tickets add column if not exists rappel_demande_le timestamptz;
alter table public.hotline_tickets add column if not exists rappel_demande_par text;
create index if not exists hotline_tickets_rappel_idx on public.hotline_tickets(rappel_par) where rappel_par is not null;

-- ── 9. Fonction hotline des collaborateurs ───────────────────────────────────
alter table public.user_page_access add column if not exists hotline_niveau smallint;
alter table public.user_page_access add column if not exists hotline_departements text[] not null default '{}';
alter table public.user_page_access drop constraint if exists user_page_access_hotline_niveau_check;
alter table public.user_page_access add constraint user_page_access_hotline_niveau_check check (hotline_niveau is null or hotline_niveau between 1 and 3);

update public.user_page_access set hotline_niveau = 1 where email = 'hotlinethermie1@cegeclim-energies.com' and hotline_niveau is null;
update public.user_page_access set hotline_niveau = 2 where email = 'hotlinethermie2@cegeclim-energies.com' and hotline_niveau is null;

-- Département d'un code postal (2 premiers chiffres, 3 pour l'outre-mer).
create or replace function public.hotline_departement(p_code_postal text)
returns text
language sql
immutable
as $$
  select case
    when nullif(regexp_replace(coalesce(p_code_postal, ''), '\D', '', 'g'), '') is null then null
    when regexp_replace(p_code_postal, '\D', '', 'g') like '97%' then left(regexp_replace(p_code_postal, '\D', '', 'g'), 3)
    else left(lpad(regexp_replace(p_code_postal, '\D', '', 'g'), 5, '0'), 2)
  end
$$;

create or replace function public.hotline_collaborateurs(p_numero_tiers text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cp text;
  v_dep text;
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  if nullif(btrim(coalesce(p_numero_tiers, '')), '') is not null then
    select code_postal into v_cp from public.ref_tiers where numero = btrim(p_numero_tiers) limit 1;
    v_dep := public.hotline_departement(v_cp);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'email', u.email,
           'nom', coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)),
           'niveau', u.hotline_niveau,
           'departements', to_jsonb(coalesce(u.hotline_departements, '{}')),
           'par_defaut', v_dep is not null and u.hotline_niveau = 2 and (
               v_dep = any(u.hotline_departements)
               or (v_dep = '20' and (u.hotline_departements && array['2A', '2B'])))
         ) order by u.hotline_niveau, coalesce(nullif(btrim(u.display_name), ''), u.email)), '[]'::jsonb)
  into v_res
  from public.user_page_access u
  where u.hotline_niveau is not null
    and (coalesce(u.can_hotline, false) or coalesce(u.can_hotline_expert, false) or coalesce(u.can_autorisation, false));

  return jsonb_build_object('departement', v_dep, 'code_postal', v_cp, 'collaborateurs', v_res);
end
$$;

grant execute on function public.hotline_collaborateurs(text) to authenticated;

-- ── 3. Historiques : non résolus d'abord, puis du plus récent au plus ancien ──
create or replace function public.hotline_ticket_resume(t public.hotline_tickets)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('id', t.id, 'numero', t.numero, 'filiere', t.filiere, 'motif', t.motif,
           'statut', t.statut, 'niveau', t.niveau, 'opened_at', t.opened_at, 'description', t.description,
           'preconisation', t.preconisation, 'chantier', t.chantier, 'numero_serie', t.numero_serie,
           'contact_nom', t.contact_nom, 'intitule_tiers', t.intitule_tiers, 'numero_tiers', t.numero_tiers,
           'nature', t.nature, 'serie_ge', t.serie_ge, 'modele_ge', t.modele_ge, 'reference_article', t.reference_article,
           'code_defaut', t.code_defaut, 'source', t.source, 'assigne_a', t.assigne_a, 'rappel_par', t.rappel_par);
$$;

create or replace function public.hotline_contexte(
  p_numero_tiers text default null,
  p_telephone text default null,
  p_chantier text default null,
  p_numero_serie text default null,
  p_contact_nom text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tiers   text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_cle     text := public.hotline_tel_cle(p_telephone);
  v_chant   text := nullif(trim(coalesce(p_chantier, '')), '');
  v_serie   text := nullif(trim(coalesce(p_numero_serie, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_nom, '')), '');
  v_client  jsonb;
  v_contact_tickets jsonb;
  v_chantier jsonb;
  v_docs    jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  if v_cle is not null and length(v_cle) < 9 then
    v_cle := null;
  end if;

  select coalesce(jsonb_agg(x order by rang, opened_at desc), '[]'::jsonb) into v_client
  from (
    select public.hotline_ticket_resume(t) x, (t.statut = 'RESOLU')::int rang, t.opened_at
    from public.hotline_tickets t
    where v_tiers is not null and t.numero_tiers = v_tiers
    order by (t.statut = 'RESOLU'), t.opened_at desc limit 30
  ) s;

  select coalesce(jsonb_agg(x order by rang, opened_at desc), '[]'::jsonb) into v_contact_tickets
  from (
    select public.hotline_ticket_resume(t) x, (t.statut = 'RESOLU')::int rang, t.opened_at
    from public.hotline_tickets t
    where (v_cle is not null and public.hotline_tel_cle(t.telephone_appelant) = v_cle)
       or (v_contact is not null and v_tiers is not null and t.numero_tiers = v_tiers and lower(trim(t.contact_nom)) = lower(v_contact))
    order by (t.statut = 'RESOLU'), t.opened_at desc limit 30
  ) s;

  select coalesce(jsonb_agg(x order by rang, opened_at desc), '[]'::jsonb) into v_chantier
  from (
    select public.hotline_ticket_resume(t) x, (t.statut = 'RESOLU')::int rang, t.opened_at
    from public.hotline_tickets t
    where (v_chant is not null and (t.chantier ilike '%' || v_chant || '%' or t.reference_article ilike '%' || v_chant || '%' or t.modele_ge ilike '%' || v_chant || '%'))
       or (v_serie is not null and (t.numero_serie ilike '%' || v_serie || '%' or t.serie_ge ilike '%' || v_serie || '%'))
    order by (t.statut = 'RESOLU'), t.opened_at desc limit 30
  ) s;

  if v_tiers is null and v_serie is null then
    v_docs := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(d order by d->>'date' desc), '[]'::jsonb) into v_docs
    from (
      select jsonb_build_object(
               'numero_piece', f.numero_piece,
               'numero_bl', max(f.numero_piece_bl),
               'date', max(f.date_facture),
               'numero_tiers', max(f.numero_tiers_entete),
               'reference', max(f.reference),
               'projet', max(f.projet),
               'montant_ht', round(sum(f.montant_ht)::numeric, 2),
               'articles', (array_agg(distinct coalesce(nullif(f.designation_article, ''), f.designation)
                              order by coalesce(nullif(f.designation_article, ''), f.designation)))[1:6],
               'series', array_remove(array_agg(distinct nullif(f.numero_serie_lot, '')), null)
             ) d
      from public.facture_lignes f
      where (v_tiers is null or f.numero_tiers_entete = v_tiers)
        and (v_chant is null
             or f.reference ilike '%' || v_chant || '%'
             or f.projet ilike '%' || v_chant || '%'
             or (v_tiers is not null and (f.reference_article ilike v_chant || '%'
                                          or f.designation ilike '%' || v_chant || '%'
                                          or coalesce(f.designation_article, '') ilike '%' || v_chant || '%')))
        and (v_serie is null or f.numero_serie_lot ilike '%' || v_serie || '%')
        and f.date_facture >= current_date - interval '36 months'
      group by f.numero_piece
      order by max(f.date_facture) desc
      limit 25
    ) s;
  end if;

  return jsonb_build_object(
    'tickets', v_client,
    'tickets_client', v_client,
    'tickets_contact', v_contact_tickets,
    'tickets_chantier', v_chantier,
    'documents', v_docs
  );
end
$$;

-- ── 12. Modèles possibles d'après le début du n° de série ────────────────────
-- Les n° de série de l'ancien outil sont parfois saisis dans le champ GE,
-- parfois dans le champ UI : on cherche dans les deux, en indiquant d'où vient
-- le modèle.
create or replace function public.hotline_modeles_par_serie(p_prefixe text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_p text := upper(regexp_replace(coalesce(p_prefixe, ''), '\s', '', 'g'));
  v_like text;
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if length(v_p) < 3 then
    return '[]'::jsonb;
  end if;
  v_like := replace(replace(replace(v_p, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with s as (
    select 'GE'::text as type, upper(btrim(t.modele_ge)) as modele, t.opened_at, upper(regexp_replace(t.serie_ge, '\s', '', 'g')) as serie
    from public.hotline_tickets t
    where upper(regexp_replace(coalesce(t.serie_ge, ''), '\s', '', 'g')) like v_like and coalesce(btrim(t.modele_ge), '') <> ''
    union all
    select 'UI', upper(btrim(t.reference_article)), t.opened_at, upper(regexp_replace(t.numero_serie, '\s', '', 'g'))
    from public.hotline_tickets t
    where upper(regexp_replace(coalesce(t.numero_serie, ''), '\s', '', 'g')) like v_like and coalesce(btrim(t.reference_article), '') <> ''
  ),
  g as (
    select type, modele, count(*) n, max(opened_at) dernier, (array_agg(serie order by opened_at desc))[1:3] exemples
    from s group by type, modele
  )
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'modele', modele, 'n', n, 'dernier', dernier, 'exemples', to_jsonb(exemples))
                            order by n desc, dernier desc), '[]'::jsonb)
  into v_res
  from (select * from g order by n desc, dernier desc limit 25) x;

  return v_res;
end
$$;

grant execute on function public.hotline_modeles_par_serie(text) to authenticated;
grant execute on function public.hotline_numero_suivant(timestamptz) to authenticated;
