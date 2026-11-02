-- ============================================================================
-- 20261102_hotline_technique.sql — Hotline technique / SAV (02/11/2026)
-- ----------------------------------------------------------------------------
-- Module isolé : toutes les tables et fonctions sont préfixées hotline_ et ne
-- modifient aucune table existante, sauf l'ajout de deux droits d'écran :
--   - can_hotline         : console d'appel (niveau 1) et liste des tickets ;
--   - can_hotline_expert  : niveaux 2 / 3, éditeur des arbres de diagnostic,
--                           statistiques.
-- Les droits suivent la règle de la refonte du 27/10/2026 : cochés sur les
-- PROFILS (écran Autorisations), recopiés dans user_page_access par trigger.
--
-- Tables
--   hotline_lignes          numéros 3CX appelés → filière (PV / THERMIQUE)
--   hotline_arbres          un arbre de diagnostic par filière × motif
--   hotline_noeuds          questions, documents à afficher, réponses
--   hotline_tickets         tickets (statut, niveau, appelant, chantier, n° série)
--   hotline_ticket_etapes   chronologie horodatée de chaque ticket
-- RPC
--   hotline_identifier_appelant(tel)    SAGE tiers + contacts, BLG contacts
--   hotline_contexte(tiers, chantier, serie)  documents de vente + tickets
--   hotline_stats(debut, fin)           volumes, origines, durées
-- ============================================================================

-- 1. Droits -------------------------------------------------------------------
alter table public.access_profiles
  add column if not exists can_hotline        boolean not null default false,
  add column if not exists can_hotline_expert boolean not null default false;

alter table public.user_page_access
  add column if not exists can_hotline        boolean not null default false,
  add column if not exists can_hotline_expert boolean not null default false;

create or replace function public.user_page_access_droits_depuis_profils()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  select
    coalesce(bool_or(p.can_dashboard), false)         as can_dashboard,
    coalesce(bool_or(p.can_territoire), false)        as can_territoire,
    coalesce(bool_or(p.can_cartographie), false)      as can_cartographie,
    coalesce(bool_or(p.can_clients), false)           as can_clients,
    coalesce(bool_or(p.can_carte), false)             as can_carte,
    coalesce(bool_or(p.can_todo), false)              as can_todo,
    coalesce(bool_or(p.can_clients_cegeclim), false)  as can_clients_cegeclim,
    coalesce(bool_or(p.can_suivi_prospects), false)   as can_suivi_prospects,
    coalesce(bool_or(p.can_agences), false)           as can_agences,
    coalesce(bool_or(p.can_autorisation), false)      as can_autorisation,
    coalesce(bool_or(p.can_documents), false)         as can_documents,
    coalesce(bool_or(p.can_stocks), false)            as can_stocks,
    coalesce(bool_or(p.can_activites), false)         as can_activites,
    coalesce(bool_or(p.can_change_scope), false)      as can_change_scope,
    coalesce(bool_or(p.can_objectifs), false)         as can_objectifs,
    coalesce(bool_or(p.can_suivi_agences), false)     as can_suivi_agences,
    coalesce(bool_or(p.can_financement), false)       as can_financement,
    coalesce(bool_or(p.can_allocation_airh2o), false) as can_allocation_airh2o,
    coalesce(bool_or(p.can_appro), false)             as can_appro,
    coalesce(bool_or(p.can_superuser), false)         as can_superuser,
    coalesce(bool_or(p.can_projetblg), false)         as can_projetblg,
    coalesce(bool_or(p.can_paiement), false)          as can_paiement,
    coalesce(bool_or(p.can_hotline), false)           as can_hotline,
    coalesce(bool_or(p.can_hotline_expert), false)    as can_hotline_expert
  into r
  from public.access_profiles p
  where p.id = any (public.profils_de(new.access_profile_id, new.profils_complementaires))
    and coalesce(p.is_active, true);

  new.can_dashboard         := r.can_dashboard;
  new.can_territoire        := r.can_territoire;
  new.can_cartographie      := r.can_cartographie;
  new.can_clients           := r.can_clients;
  new.can_carte             := r.can_carte;
  new.can_todo              := r.can_todo;
  new.can_clients_cegeclim  := r.can_clients_cegeclim;
  new.can_suivi_prospects   := r.can_suivi_prospects;
  new.can_agences           := r.can_agences;
  new.can_autorisation      := r.can_autorisation;
  new.can_documents         := r.can_documents;
  new.can_stocks            := r.can_stocks;
  new.can_activites         := r.can_activites;
  new.can_change_scope      := r.can_change_scope;
  new.can_objectifs         := r.can_objectifs;
  new.can_suivi_agences     := r.can_suivi_agences;
  new.can_financement       := r.can_financement;
  new.can_allocation_airh2o := r.can_allocation_airh2o;
  new.can_appro             := r.can_appro;
  new.can_superuser         := r.can_superuser;
  new.can_projetblg         := r.can_projetblg;
  new.can_paiement          := r.can_paiement;
  new.can_hotline           := r.can_hotline;
  new.can_hotline_expert    := r.can_hotline_expert;
  return new;
end
$function$;

-- Initialisation : les administrateurs reçoivent les deux droits.
update public.access_profiles
set can_hotline = true, can_hotline_expert = true
where coalesce(can_autorisation, false);

update public.user_page_access set email = email where email is not null;

-- Contrôles de droits utilisés par les policies et les RPC.
create or replace function public.hotline_peut_acceder()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.user_page_access u
    where u.email = public.current_user_email()
      and (coalesce(u.can_hotline, false) or coalesce(u.can_hotline_expert, false) or coalesce(u.can_autorisation, false))
  );
$function$;

create or replace function public.hotline_est_expert()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1 from public.user_page_access u
    where u.email = public.current_user_email()
      and (coalesce(u.can_hotline_expert, false) or coalesce(u.can_autorisation, false))
  );
$function$;

-- Téléphone → 9 derniers chiffres (0251…, +33251…, 02.51… se rejoignent).
create or replace function public.hotline_tel_cle(p_tel text)
returns text
language sql
immutable
as $function$
  select nullif(right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 9), '');
$function$;

-- 2. Tables -------------------------------------------------------------------
create table if not exists public.hotline_lignes (
  numero      text primary key,          -- numéro appelé (ligne 3CX / DID)
  filiere     text not null check (filiere in ('PV', 'THERMIQUE')),
  libelle     text not null,
  actif       boolean not null default true
);

create table if not exists public.hotline_arbres (
  id          uuid primary key default gen_random_uuid(),
  filiere     text not null check (filiere in ('PV', 'THERMIQUE')),
  motif       text not null check (motif in ('MISE_EN_SERVICE', 'EXPLOITATION')),
  nom         text not null,
  famille     text,                       -- type de produit (PAC, onduleur…)
  actif       boolean not null default true,
  publie_extranet boolean not null default false,
  noeud_racine uuid,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.hotline_noeuds (
  id          uuid primary key default gen_random_uuid(),
  arbre_id    uuid not null references public.hotline_arbres(id) on delete cascade,
  question    text not null,
  aide        text,                       -- consigne pour le niveau 1
  -- [{ "titre": "...", "type": "PDF", "url": "https://..." }]
  documents   jsonb not null default '[]'::jsonb,
  -- [{ "libelle": "Oui", "suivant": "<uuid>" | null, "preconisation": "...", "escalade": false }]
  choix       jsonb not null default '[]'::jsonb,
  ordre       integer not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists hotline_noeuds_arbre_idx on public.hotline_noeuds(arbre_id);

alter table public.hotline_arbres drop constraint if exists hotline_arbres_racine_fk;
alter table public.hotline_arbres
  add constraint hotline_arbres_racine_fk foreign key (noeud_racine)
  references public.hotline_noeuds(id) on delete set null deferrable initially deferred;

create sequence if not exists public.hotline_ticket_seq;

create table if not exists public.hotline_tickets (
  id                 uuid primary key default gen_random_uuid(),
  numero             text not null unique default ('HT-' || to_char(now(), 'YY') || '-' || lpad(nextval('public.hotline_ticket_seq')::text, 5, '0')),
  filiere            text not null check (filiere in ('PV', 'THERMIQUE')),
  motif              text check (motif in ('MISE_EN_SERVICE', 'EXPLOITATION')),
  statut             text not null default 'OUVERT' check (statut in ('OUVERT', 'EN_COURS', 'ESCALADE', 'RESOLU', 'CLOS')),
  niveau             smallint not null default 1 check (niveau between 1 and 3),
  source             text not null default 'TELEPHONE' check (source in ('TELEPHONE', 'MANUEL', 'EXTRANET')),
  telephone_appelant text,
  ligne_appelee      text,
  numero_tiers       text,
  intitule_tiers     text,
  contact_nom        text,
  chantier           text,
  numero_serie       text,
  reference_article  text,
  description        text,
  preconisation      text,
  arbre_id           uuid references public.hotline_arbres(id) on delete set null,
  ouvert_par         text not null default public.current_user_email(),
  assigne_a          text,
  opened_at          timestamptz not null default now(),
  first_action_at    timestamptz,
  escalated_at       timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  updated_at         timestamptz not null default now()
);
create index if not exists hotline_tickets_tiers_idx on public.hotline_tickets(numero_tiers, opened_at desc);
create index if not exists hotline_tickets_tel_idx on public.hotline_tickets(public.hotline_tel_cle(telephone_appelant));
create index if not exists hotline_tickets_statut_idx on public.hotline_tickets(statut, niveau);

create table if not exists public.hotline_ticket_etapes (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.hotline_tickets(id) on delete cascade,
  at          timestamptz not null default now(),
  auteur      text not null default public.current_user_email(),
  type        text not null check (type in ('OUVERTURE', 'IDENTIFICATION', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'ESCALADE', 'PRECONISATION', 'RESOLUTION', 'CLOTURE', 'REOUVERTURE')),
  libelle     text not null,
  noeud_id    uuid,
  details     jsonb
);
create index if not exists hotline_ticket_etapes_ticket_idx on public.hotline_ticket_etapes(ticket_id, at);

-- Horodatages du ticket tenus à jour par les étapes (pas de calcul côté écran).
create or replace function public.hotline_etape_horodater()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.hotline_tickets t set
    first_action_at = coalesce(t.first_action_at, case when new.type not in ('OUVERTURE', 'IDENTIFICATION') then new.at end),
    escalated_at    = case when new.type = 'ESCALADE' then new.at else t.escalated_at end,
    resolved_at     = case when new.type = 'RESOLUTION' then new.at when new.type = 'REOUVERTURE' then null else t.resolved_at end,
    closed_at       = case when new.type = 'CLOTURE' then new.at when new.type = 'REOUVERTURE' then null else t.closed_at end,
    updated_at      = now()
  where t.id = new.ticket_id;
  return new;
end
$function$;

drop trigger if exists trg_hotline_etape_horodater on public.hotline_ticket_etapes;
create trigger trg_hotline_etape_horodater
  after insert on public.hotline_ticket_etapes
  for each row execute function public.hotline_etape_horodater();

-- 3. RLS ----------------------------------------------------------------------
alter table public.hotline_lignes        enable row level security;
alter table public.hotline_arbres        enable row level security;
alter table public.hotline_noeuds        enable row level security;
alter table public.hotline_tickets       enable row level security;
alter table public.hotline_ticket_etapes enable row level security;

drop policy if exists hotline_lignes_lecture on public.hotline_lignes;
create policy hotline_lignes_lecture on public.hotline_lignes for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_lignes_expert on public.hotline_lignes;
create policy hotline_lignes_expert on public.hotline_lignes for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());

drop policy if exists hotline_arbres_lecture on public.hotline_arbres;
create policy hotline_arbres_lecture on public.hotline_arbres for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_arbres_expert on public.hotline_arbres;
create policy hotline_arbres_expert on public.hotline_arbres for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());

drop policy if exists hotline_noeuds_lecture on public.hotline_noeuds;
create policy hotline_noeuds_lecture on public.hotline_noeuds for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_noeuds_expert on public.hotline_noeuds;
create policy hotline_noeuds_expert on public.hotline_noeuds for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());

drop policy if exists hotline_tickets_acces on public.hotline_tickets;
create policy hotline_tickets_acces on public.hotline_tickets for all to authenticated using (public.hotline_peut_acceder()) with check (public.hotline_peut_acceder());

drop policy if exists hotline_etapes_lecture on public.hotline_ticket_etapes;
create policy hotline_etapes_lecture on public.hotline_ticket_etapes for select to authenticated using (public.hotline_peut_acceder());
-- Chronologie en ajout seul : pas de modification ni de suppression d'étape.
drop policy if exists hotline_etapes_ajout on public.hotline_ticket_etapes;
create policy hotline_etapes_ajout on public.hotline_ticket_etapes for insert to authenticated with check (public.hotline_peut_acceder());

grant select, insert, update, delete on public.hotline_lignes, public.hotline_arbres, public.hotline_noeuds, public.hotline_tickets to authenticated;
grant select, insert on public.hotline_ticket_etapes to authenticated;
grant usage on sequence public.hotline_ticket_seq to authenticated;

-- 4. RPC ----------------------------------------------------------------------
-- Appelant : tiers SAGE (fiche), contacts SAGE, contacts BLG. Toujours une liste :
-- un même numéro peut être partagé (standard d'une entreprise multi-comptes).
create or replace function public.hotline_identifier_appelant(p_telephone text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cle text := public.hotline_tel_cle(p_telephone);
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if v_cle is null or length(v_cle) < 9 then
    return '[]'::jsonb;
  end if;

  with m as (
    select 'SAGE fiche tiers'::text as source, t.numero as numero_tiers, t.intitule, coalesce(nullif(t.contact, ''), null) as contact,
           t.telephone, t.ville, t.agence_rattachement as agence, t.representant
    from public.ref_tiers t
    where public.hotline_tel_cle(t.telephone) = v_cle
    union all
    select 'SAGE contact', c.ct_ctnum, t.intitule, trim(concat_ws(' ', c.ct_ctprenom, c.ct_ctnom)),
           coalesce(nullif(c.ct_cttelportable, ''), c.ct_cttelephone), t.ville, t.agence_rattachement, t.representant
    from sage.contact c
    left join public.ref_tiers t on t.numero = c.ct_ctnum
    where public.hotline_tel_cle(c.ct_cttelephone) = v_cle or public.hotline_tel_cle(c.ct_cttelportable) = v_cle
    union all
    select 'BLG contact', b.numero_tiers, t.intitule, b.nom_complet, b.telephones, t.ville, t.agence_rattachement, t.representant
    from blg.contacts_tiers_blg b
    left join public.ref_tiers t on t.numero = b.numero_tiers
    where exists (
      select 1 from regexp_split_to_table(coalesce(b.telephones, ''), '[,;/|]') x
      where public.hotline_tel_cle(x) = v_cle
    )
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'source', source, 'numero_tiers', numero_tiers, 'intitule', intitule, 'contact', contact,
           'telephone', telephone, 'ville', ville, 'agence', agence, 'representant', representant)), '[]'::jsonb)
  into v_res
  from (select * from m limit 20) m;

  return v_res;
end
$function$;

-- Contexte affiché à droite de la console : tickets récents (tiers ou même
-- numéro), documents de vente du tiers filtrés par chantier / n° de série.
-- Le chantier est recherché dans la référence et le projet des lignes
-- (c'est là que les agences le saisissent dans SAGE).
create or replace function public.hotline_contexte(
  p_numero_tiers text default null,
  p_telephone    text default null,
  p_chantier     text default null,
  p_numero_serie text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tiers   text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_cle     text := public.hotline_tel_cle(p_telephone);
  v_chant   text := nullif(trim(coalesce(p_chantier, '')), '');
  v_serie   text := nullif(trim(coalesce(p_numero_serie, '')), '');
  v_tickets jsonb;
  v_docs    jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_tickets
  from (
    select jsonb_build_object('id', t.id, 'numero', t.numero, 'filiere', t.filiere, 'motif', t.motif,
             'statut', t.statut, 'niveau', t.niveau, 'opened_at', t.opened_at, 'description', t.description,
             'preconisation', t.preconisation, 'chantier', t.chantier, 'numero_serie', t.numero_serie) x
    from public.hotline_tickets t
    where (v_tiers is not null and t.numero_tiers = v_tiers)
       or (v_cle is not null and public.hotline_tel_cle(t.telephone_appelant) = v_cle)
       or (v_serie is not null and t.numero_serie ilike v_serie)
    order by t.opened_at desc
    limit 15
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
        and (v_chant is null or f.reference ilike '%' || v_chant || '%' or f.projet ilike '%' || v_chant || '%')
        and (v_serie is null or f.numero_serie_lot ilike '%' || v_serie || '%')
        and f.date_facture >= current_date - interval '36 months'
      group by f.numero_piece
      order by max(f.date_facture) desc
      limit 25
    ) s;
  end if;

  return jsonb_build_object('tickets', v_tickets, 'documents', v_docs);
end
$function$;

-- Statistiques : volumes par filière / motif / statut / niveau, durées médianes
-- et moyennes (heures) jusqu'à la première action et jusqu'à la résolution,
-- top des préconisations, évolution hebdomadaire.
create or replace function public.hotline_stats(p_debut date, p_fin date)
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
    select * from public.hotline_tickets
    where opened_at >= p_debut and opened_at < p_fin + 1
  )
  select jsonb_build_object(
    'total', (select count(*) from t),
    'ouverts', (select count(*) from t where statut in ('OUVERT', 'EN_COURS', 'ESCALADE')),
    'par_filiere', (select coalesce(jsonb_object_agg(filiere, n), '{}') from (select filiere, count(*) n from t group by 1) x),
    'par_motif', (select coalesce(jsonb_object_agg(coalesce(motif, 'NON_RENSEIGNE'), n), '{}') from (select motif, count(*) n from t group by 1) x),
    'par_statut', (select coalesce(jsonb_object_agg(statut, n), '{}') from (select statut, count(*) n from t group by 1) x),
    'par_niveau', (select coalesce(jsonb_object_agg(niveau::text, n), '{}') from (select niveau, count(*) n from t group by 1) x),
    'delai_premiere_action_h', (select jsonb_build_object(
        'moyenne', round((avg(extract(epoch from first_action_at - opened_at)) / 3600)::numeric, 2),
        'mediane', round((percentile_cont(0.5) within group (order by extract(epoch from first_action_at - opened_at)) / 3600)::numeric, 2))
      from t where first_action_at is not null),
    'delai_resolution_h', (select jsonb_build_object(
        'moyenne', round((avg(extract(epoch from resolved_at - opened_at)) / 3600)::numeric, 2),
        'mediane', round((percentile_cont(0.5) within group (order by extract(epoch from resolved_at - opened_at)) / 3600)::numeric, 2))
      from t where resolved_at is not null),
    'taux_resolution_n1', (select round(100.0 * count(*) filter (where niveau = 1 and resolved_at is not null) / nullif(count(*) filter (where resolved_at is not null), 0), 1) from t),
    'top_preconisations', (select coalesce(jsonb_agg(jsonb_build_object('libelle', preconisation, 'n', n) order by n desc), '[]') from (
        select preconisation, count(*) n from t where coalesce(preconisation, '') <> '' group by 1 order by 2 desc limit 8) x),
    'top_clients', (select coalesce(jsonb_agg(jsonb_build_object('numero_tiers', numero_tiers, 'intitule', intitule, 'n', n) order by n desc), '[]') from (
        select numero_tiers, max(intitule_tiers) intitule, count(*) n from t where numero_tiers is not null group by 1 order by 3 desc limit 8) x),
    'par_semaine', (select coalesce(jsonb_agg(jsonb_build_object('semaine', semaine, 'PV', pv, 'THERMIQUE', th) order by semaine), '[]') from (
        select to_char(date_trunc('week', opened_at), 'YYYY-MM-DD') semaine,
               count(*) filter (where filiere = 'PV') pv, count(*) filter (where filiere = 'THERMIQUE') th
        from t group by 1) x)
  ) into v;

  return v;
end
$function$;

grant execute on function public.hotline_identifier_appelant(text) to authenticated;
grant execute on function public.hotline_contexte(text, text, text, text) to authenticated;
grant execute on function public.hotline_stats(date, date) to authenticated;
grant execute on function public.hotline_peut_acceder() to authenticated;
grant execute on function public.hotline_est_expert() to authenticated;

-- 5. Données de départ ----------------------------------------------------------
-- Numéros à remplacer par les vraies lignes 3CX (écran Éditeur › Lignes).
insert into public.hotline_lignes (numero, filiere, libelle) values
  ('HOTLINE-PV', 'PV', 'Hotline photovoltaïque (numéro à renseigner)'),
  ('HOTLINE-TH', 'THERMIQUE', 'Hotline thermique (numéro à renseigner)')
on conflict (numero) do nothing;

-- Arbres de démonstration (à ajuster par un expert dans l'éditeur).
do $seed$
declare
  a_th_mes uuid; a_th_run uuid; a_pv_mes uuid;
  n1 uuid; n2 uuid; n3 uuid; n4 uuid;
begin
  if exists (select 1 from public.hotline_arbres) then
    return;
  end if;

  -- Thermique · mise en service PAC
  insert into public.hotline_arbres (filiere, motif, nom, famille) values ('THERMIQUE', 'MISE_EN_SERVICE', 'Mise en service PAC air/eau', 'PAC') returning id into a_th_mes;
  n1 := gen_random_uuid(); n2 := gen_random_uuid(); n3 := gen_random_uuid();
  insert into public.hotline_noeuds (id, arbre_id, ordre, question, aide, documents, choix) values
    (n1, a_th_mes, 1, 'La PAC affiche-t-elle un code défaut ?', 'Demander au technicien de lire l''afficheur de la télécommande.',
     '[{"titre":"Procédure de mise en service PAC","type":"PDF","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',n3), jsonb_build_object('libelle','Non, elle ne démarre pas','suivant',n2))),
    (n2, a_th_mes, 2, 'L''unité extérieure est-elle bien alimentée (disjoncteur, tension) ?', null,
     '[{"titre":"Schéma de raccordement électrique","type":"PDF","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',null,'preconisation','Vérifier le câblage du bus de communication entre unité intérieure et extérieure','escalade',false),
                       jsonb_build_object('libelle','Non','suivant',null,'preconisation','Rétablir l''alimentation puis relancer la mise en service','escalade',false))),
    (n3, a_th_mes, 3, 'Quel code défaut ?', 'Saisir le code en commentaire du ticket.',
     '[{"titre":"Table des codes défaut","type":"PDF","url":""},{"titre":"Schéma de principe hydraulique","type":"PDF","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Défaut pression / débit hydraulique','suivant',null,'preconisation','Contrôler la pression du circuit, purger et vérifier le filtre','escalade',false),
                       jsonb_build_object('libelle','Autre code','suivant',null,'preconisation','Escalade niveau 2 avec le code relevé','escalade',true)));
  update public.hotline_arbres set noeud_racine = n1 where id = a_th_mes;

  -- Thermique · panne en exploitation
  insert into public.hotline_arbres (filiere, motif, nom, famille) values ('THERMIQUE', 'EXPLOITATION', 'Panne PAC en exploitation', 'PAC') returning id into a_th_run;
  n1 := gen_random_uuid(); n2 := gen_random_uuid();
  insert into public.hotline_noeuds (id, arbre_id, ordre, question, aide, documents, choix) values
    (n1, a_th_run, 1, 'Le firmware de la carte est-il à jour ?', null,
     '[{"titre":"Liste des firmwares à jour","type":"XLS","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',n2), jsonb_build_object('libelle','Non / ne sait pas','suivant',null,'preconisation','Mettre à jour le firmware puis relancer','escalade',false))),
    (n2, a_th_run, 2, 'Le défaut est-il permanent ou intermittent ?', null, '[]',
     jsonb_build_array(jsonb_build_object('libelle','Permanent','suivant',null,'preconisation','Escalade niveau 2 : diagnostic approfondi','escalade',true),
                       jsonb_build_object('libelle','Intermittent','suivant',null,'preconisation','Relever l''historique des défauts et rappeler sous 48 h','escalade',false)));
  update public.hotline_arbres set noeud_racine = n1 where id = a_th_run;

  -- Photovoltaïque · mise en service onduleur
  insert into public.hotline_arbres (filiere, motif, nom, famille) values ('PV', 'MISE_EN_SERVICE', 'Mise en service onduleur', 'Onduleur') returning id into a_pv_mes;
  n1 := gen_random_uuid(); n2 := gen_random_uuid(); n4 := gen_random_uuid();
  insert into public.hotline_noeuds (id, arbre_id, ordre, question, aide, documents, choix) values
    (n1, a_pv_mes, 1, 'L''onduleur est-il visible dans l''application de supervision ?', null,
     '[{"titre":"Guide d''appairage de la supervision","type":"PDF","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',n2), jsonb_build_object('libelle','Non','suivant',n4))),
    (n2, a_pv_mes, 2, 'La production remonte-t-elle ?', null, '[]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',null,'preconisation','Mise en service validée, clore le ticket','escalade',false),
                       jsonb_build_object('libelle','Non','suivant',null,'preconisation','Vérifier les tensions de chaînes DC et la configuration réseau','escalade',false))),
    (n4, a_pv_mes, 3, 'Le module de communication (Wi-Fi / Ethernet) est-il connecté ?', null,
     '[{"titre":"Configuration réseau onduleur","type":"PDF","url":""}]',
     jsonb_build_array(jsonb_build_object('libelle','Oui','suivant',null,'preconisation','Escalade niveau 2 : contrôle du compte de supervision','escalade',true),
                       jsonb_build_object('libelle','Non','suivant',null,'preconisation','Refaire l''appairage réseau en suivant le guide','escalade',false)));
  update public.hotline_arbres set noeud_racine = n1 where id = a_pv_mes;
end
$seed$;
