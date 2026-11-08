-- ============================================================================
-- 20261108_hotline_classification.sql — Hotline technique (08/11/2026)
-- ----------------------------------------------------------------------------
-- Classification des tickets thermie, issue de l'analyse des 22 370 tickets
-- historiques (doc « Hotline Thermie — proposition de classification ») :
--   - référentiel hotline_classif_valeurs (axes symptome, organe, action,
--     issue ; libellés et ordre modifiables, actif = proposé à la saisie) ;
--   - sur le ticket : symptome, organe, actions (plusieurs), issue,
--     classif_source (SAISIE = choisi par le hotliner, AUTO_2026_11 = déduit
--     des commentaires de l'ancien outil) et classif_at ;
--   - issue obligatoire pour passer un ticket thermique en Résolu ou Clos
--     (hors tickets importés) ;
--   - hotline_stats enrichie : répartitions symptôme / organe / issue et
--     codes défaut les plus fréquents, filtre de filière optionnel.
-- La nature de l'appel et la gamme restent les champs existants (nature,
-- gamme) ; l'historique non renseigné est complété par le rattachement.
-- ============================================================================

-- 1. Référentiel -------------------------------------------------------------
create table if not exists public.hotline_classif_valeurs (
  axe text not null check (axe in ('symptome', 'organe', 'action', 'issue')),
  code text not null,
  libelle text not null,
  aide text,
  ordre int not null default 100,
  actif boolean not null default true,
  primary key (axe, code)
);

insert into public.hotline_classif_valeurs (axe, code, libelle, aide, ordre, actif) values
  ('symptome', 'CODE_DEFAUT',     'Code défaut affiché',                 'Seul symptôme décrit : un code ou des clignotements', 10, true),
  ('symptome', 'NE_DEMARRE_PAS',  'Ne démarre pas / à l''arrêt',         'Aucune réaction, plus de LED, reste à l''arrêt', 20, true),
  ('symptome', 'DISJONCTION',     'Disjonction / problème électrique',   'Disjoncteur, différentiel, fusibles, court-circuit', 30, true),
  ('symptome', 'COMMUNICATION',   'Communication / bus',                 'Liaison UI-GE, H-Link, adressage', 40, true),
  ('symptome', 'TELECOMMANDE',    'Télécommande / thermostat / écran',   'Afficheur, thermostat, Wi-Fi, appli, commande centrale', 50, true),
  ('symptome', 'ECS',             'Eau chaude sanitaire',                'Ballon, ECS, anti-légionellose', 60, true),
  ('symptome', 'DEBIT_HYDRAU',    'Débit / pression hydraulique',        'Débit, pression d''eau, filtre, purge, embouage', 70, true),
  ('symptome', 'PAS_CHAUFFAGE',   'Pas ou peu de chauffage',             null, 80, true),
  ('symptome', 'PAS_FROID',       'Pas ou peu de froid',                 null, 90, true),
  ('symptome', 'GIVRAGE',         'Givrage / dégivrage',                 null, 100, true),
  ('symptome', 'FLUIDE',          'Fluide frigorigène / pressions',      'Manque de charge, fuite de gaz, HP / BP', 110, true),
  ('symptome', 'BRUIT',           'Bruit / vibration',                   null, 120, true),
  ('symptome', 'FUITE_EAU',       'Fuite d''eau / condensats',           null, 130, true),
  ('symptome', 'REGULATION',      'Régulation / confort',                'Loi d''eau, consigne, cycles courts', 140, true),
  ('symptome', 'AUTRE',           'Autre',                               null, 990, true),

  ('organe', 'CARTE_PRINCIPALE',  'Carte électronique principale',       'Carte UI / GE, PCB, platine principale', 10, true),
  ('organe', 'INVERTER',          'Électronique de puissance / inverter', 'ISPM, IPM, carte de puissance', 20, true),
  ('organe', 'COMPRESSEUR',       'Compresseur',                         null, 30, true),
  ('organe', 'MOF',               'Moteur ventilateur (MOF / MIF)',      null, 40, true),
  ('organe', 'HYDRAULIQUE',       'Circulateur / débitmètre / V3V',      null, 50, true),
  ('organe', 'DETENDEUR_V4V',     'Détendeur / vanne 4 voies',           null, 60, true),
  ('organe', 'SONDE',             'Sondes / capteurs',                   'Thermistances, pressostat, transmetteur', 70, true),
  ('organe', 'RESISTANCE',        'Résistance d''appoint / ECS',         null, 80, true),
  ('organe', 'TELECOMMANDE',      'Télécommande / thermostat / récepteur', null, 90, true),
  ('organe', 'CABLAGE',           'Fusibles / câblage / alimentation',   null, 100, true),
  ('organe', 'AUCUN',             'Aucun (réglage, installation)',       'Pas de pièce défaillante', 900, true),

  ('action', 'MESURES',           'Contrôles et mesures guidés',         'Tensions, ohms, continuité, LED', 10, true),
  ('action', 'RESET',             'Reset / coupure secteur',             null, 20, true),
  ('action', 'PARAMETRAGE',       'Paramétrage / réglage',               'DSW, loi d''eau, consigne, réglage usine', 30, true),
  ('action', 'ENVOI_DOC',         'Envoi de documentation / procédure',  null, 40, true),
  ('action', 'DEVIS_PIECE',       'Devis ou commande de pièce',          null, 50, true),
  ('action', 'GARANTIE',          'Prise en garantie',                   null, 60, true),
  ('action', 'ESCALADE',          'Escalade N2 / N3',                    null, 70, true),
  ('action', 'INTERVENTION',      'Intervention technique',              null, 80, true),

  ('issue', 'RESOLU_TEL',         'Résolu au téléphone',                 null, 10, true),
  ('issue', 'RESOLU_REGLAGE',     'Résolu par réglage / paramétrage',    null, 20, true),
  ('issue', 'PIECE',              'Pièce à remplacer (hors garantie)',   null, 30, true),
  ('issue', 'GARANTIE',           'Prise en garantie',                   null, 40, true),
  ('issue', 'INFORMATION',        'Information transmise',               'Question, documentation, procédure', 50, true),
  ('issue', 'CAUSE_INSTALLATION', 'Cause installation / mise en œuvre',  null, 60, true),
  ('issue', 'SANS_SUITE',         'Sans suite (client injoignable)',     null, 70, true),
  ('issue', 'NON_TRACEE',         'Issue non tracée (historique)',       'Valeur de l''historique : pas proposée à la saisie', 990, false)
on conflict (axe, code) do update set libelle = excluded.libelle, aide = excluded.aide, ordre = excluded.ordre, actif = excluded.actif;

alter table public.hotline_classif_valeurs enable row level security;
drop policy if exists hotline_classif_lecture on public.hotline_classif_valeurs;
create policy hotline_classif_lecture on public.hotline_classif_valeurs for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hotline_classif_expert on public.hotline_classif_valeurs;
create policy hotline_classif_expert on public.hotline_classif_valeurs for all to authenticated using (public.hotline_est_expert()) with check (public.hotline_est_expert());

-- 2. Champs du ticket ---------------------------------------------------------
alter table public.hotline_tickets add column if not exists symptome text;
alter table public.hotline_tickets add column if not exists organe text;
alter table public.hotline_tickets add column if not exists actions text[];
alter table public.hotline_tickets add column if not exists issue text;
alter table public.hotline_tickets add column if not exists classif_source text;
alter table public.hotline_tickets add column if not exists classif_at timestamptz;
alter table public.hotline_tickets drop constraint if exists hotline_tickets_classif_source_check;
alter table public.hotline_tickets add constraint hotline_tickets_classif_source_check
  check (classif_source is null or classif_source in ('SAISIE', 'AUTO_2026_11'));

create index if not exists idx_hotline_tickets_symptome on public.hotline_tickets (symptome);
create index if not exists idx_hotline_tickets_organe on public.hotline_tickets (organe);
create index if not exists idx_hotline_tickets_issue on public.hotline_tickets (issue);

-- 3. Contrôles : valeurs connues, issue obligatoire à la résolution ------------
create or replace function public.hotline_ticket_classif_controle()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_code text;
begin
  if new.symptome is not null and not exists (select 1 from public.hotline_classif_valeurs where axe = 'symptome' and code = new.symptome) then
    raise exception 'Symptôme inconnu : %', new.symptome;
  end if;
  if new.organe is not null and not exists (select 1 from public.hotline_classif_valeurs where axe = 'organe' and code = new.organe) then
    raise exception 'Organe inconnu : %', new.organe;
  end if;
  if new.issue is not null and not exists (select 1 from public.hotline_classif_valeurs where axe = 'issue' and code = new.issue) then
    raise exception 'Issue inconnue : %', new.issue;
  end if;
  if new.actions is not null then
    foreach v_code in array new.actions loop
      if not exists (select 1 from public.hotline_classif_valeurs where axe = 'action' and code = v_code) then
        raise exception 'Action inconnue : %', v_code;
      end if;
    end loop;
  end if;

  -- Toute modification de la classification par un utilisateur = saisie.
  if tg_op = 'UPDATE' and new.classif_source is not distinct from old.classif_source
     and (new.symptome is distinct from old.symptome or new.organe is distinct from old.organe
          or new.actions is distinct from old.actions or new.issue is distinct from old.issue) then
    new.classif_source := 'SAISIE';
    new.classif_at := now();
  elsif tg_op = 'INSERT' and new.classif_source is null
     and (new.symptome is not null or new.organe is not null or new.actions is not null or new.issue is not null) then
    new.classif_source := 'SAISIE';
    new.classif_at := now();
  end if;

  -- Ticket thermique : l'issue est obligatoire pour le passer en Résolu / Clos.
  if new.filiere = 'THERMIQUE' and coalesce(new.source, '') <> 'IMPORT'
     and new.statut in ('RESOLU', 'CLOS')
     and (tg_op = 'INSERT' or old.statut not in ('RESOLU', 'CLOS'))
     and new.issue is null then
    raise exception 'Choisir l''issue du ticket avant de le marquer résolu ou clos.';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_hotline_ticket_classif_controle on public.hotline_tickets;
create trigger trg_hotline_ticket_classif_controle
  before insert or update on public.hotline_tickets
  for each row execute function public.hotline_ticket_classif_controle();

-- 4. Statistiques ---------------------------------------------------------------
-- Code défaut ramené à une forme comparable : « 03 », « code 003 », « defaut 3 »
-- → « 3 » ; « 12 clignotements », « 12 fois », « x12 » → « 12 clign. » ;
-- « aucun », « pas de code » → null.
create or replace function public.hotline_code_defaut_norme(p text)
returns text
language sql
immutable
as $function$
  select case
    when p is null or btrim(p) = '' then null
    when lower(p) ~ '(clign|fois|\yx\s*[0-9])' and lower(p) ~ '[0-9]'
      then coalesce(nullif(ltrim((regexp_match(lower(p), '([0-9]{1,2})'))[1], '0'), ''), '0') || ' clign.'
    when lower(p) ~ '[0-9]'
      then coalesce(nullif(ltrim((regexp_match(lower(p), '([0-9]{1,3})'))[1], '0'), ''), '0')
    else null
  end
$function$;

drop function if exists public.hotline_stats(date, date);
create or replace function public.hotline_stats(p_debut date, p_fin date, p_filiere text default null)
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
      and (p_filiere is null or filiere = p_filiere)
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
        from t group by 1) x),
    -- Classification (08/11/2026)
    'par_nature', (select coalesce(jsonb_object_agg(coalesce(nature, 'NON_RENSEIGNE'), n), '{}') from (select nature, count(*) n from t group by 1) x),
    'par_gamme', (select coalesce(jsonb_object_agg(coalesce(gamme, 'NON_RENSEIGNE'), n), '{}') from (select gamme, count(*) n from t where filiere = 'THERMIQUE' group by 1) x),
    'par_symptome', (select coalesce(jsonb_object_agg(coalesce(symptome, 'NON_RENSEIGNE'), n), '{}') from (select symptome, count(*) n from t where filiere = 'THERMIQUE' group by 1) x),
    'par_organe', (select coalesce(jsonb_object_agg(organe, n), '{}') from (select organe, count(*) n from t where organe is not null and organe <> 'AUCUN' group by 1) x),
    'par_issue', (select coalesce(jsonb_object_agg(coalesce(issue, 'NON_RENSEIGNE'), n), '{}') from (select issue, count(*) n from t where filiere = 'THERMIQUE' group by 1) x),
    'par_action', (select coalesce(jsonb_object_agg(a, n), '{}') from (select a, count(*) n from t, unnest(t.actions) a group by 1) x),
    'top_codes', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'n', n, 'piece', piece, 'tel', tel) order by n desc), '[]') from (
        select public.hotline_code_defaut_norme(code_defaut) code, count(*) n,
               count(*) filter (where issue in ('PIECE', 'GARANTIE')) piece,
               count(*) filter (where issue in ('RESOLU_TEL', 'RESOLU_REGLAGE')) tel
        from t where public.hotline_code_defaut_norme(code_defaut) is not null group by 1 order by 2 desc limit 15) x),
    'classifies', (select count(*) from t where symptome is not null or organe is not null or issue is not null),
    'classifies_auto', (select count(*) from t where classif_source = 'AUTO_2026_11')
  ) into v;

  return v;
end
$function$;

grant execute on function public.hotline_stats(date, date, text) to authenticated;
