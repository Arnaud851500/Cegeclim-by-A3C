-- ============================================================================
-- 20261103_contrats_objectifs.sql
-- Contrats d'objectifs individuels des commerciaux (bloc « Mes agences / Mes
-- commerciaux », écran /objectifs/contrats). Demandé par Arnaud le 03/11/2026.
--
-- Reprend les onglets Excel « un onglet par commercial » :
--   - objectif CA HT, marge N-1, avance mensuelle = marge N-1 × taux base (8 %)
--     × taux de commission (1 %), régularisation en décembre ;
--   - commission trimestrielle = marge dégagée × taux de commission ;
--   - primes annuelles : paliers CA perso, paliers CA agence, primes
--     qualitatives (libellé libre), avenant produits, primes d'avril N+1
--     (qualité / zéro impayé > 45 j, Cerfa complet).
--
-- Règles fixées par Arnaud (03/11/2026) :
--   - le commercial voit sa propre fiche, sans pouvoir la modifier ;
--   - la direction modifie et évalue : Jean-Marc L. et Stéphane C. (table
--     obj_contrat_editeurs) + administrateurs (todo_is_admin) ;
--   - la marge PV n'est pas traitée pour l'instant ;
--   - le réalisé (CA / marge par mois) n'est PAS importé : il est lu dans
--     indicateur_factures_mensuel (hors statistique exclus), même source que
--     l'écran Suivi agences – commerciaux. Le réalisé Excel est conservé dans
--     le staging d'import pour contrôle des écarts.
--
-- Lecture : direction / admins = tout ; le commercial = son code
-- (user_page_access.collaborateur_objectif, à défaut son unique
-- allowed_collaborateurs) ; les utilisateurs ouverts sur Suivi agences
-- voient les contrats de leur périmètre (suivi_perimetre()).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Éditeurs (direction)
-- ---------------------------------------------------------------------------
create table if not exists public.obj_contrat_editeurs (
  email      text primary key,
  nom        text,
  created_at timestamptz not null default now()
);

insert into public.obj_contrat_editeurs (email, nom) values
  ('jm.ladeuix@cegeclim-energies.com', 'Jean-Marc L.'),
  ('s.chanteau@cegeclim-energies.com', 'Stéphane C.')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fonctions de droits
-- ---------------------------------------------------------------------------
create or replace function public.obj_peut_modifier()
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
  select public.todo_is_admin()
      or exists (
        select 1 from public.obj_contrat_editeurs e
        where lower(btrim(e.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
      );
$$;

create or replace function public.obj_mon_code()
returns text
language sql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
  select coalesce(
           nullif(upper(btrim(u.collaborateur_objectif)), ''),
           case when cardinality(u.allowed_collaborateurs) = 1
                then nullif(upper(btrim(u.allowed_collaborateurs[1])), '') end
         )
  from public.user_page_access u
  where lower(btrim(u.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
  limit 1;
$$;

create or replace function public.obj_peut_lire(p_code text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_illimite boolean;
  v_codes text[];
begin
  if auth.uid() is null then
    return false;
  end if;
  if public.obj_peut_modifier() then
    return true;
  end if;
  if v_code <> '' and v_code = coalesce(public.obj_mon_code(), '') then
    return true;
  end if;
  if public.suivi_agences_autorise() then
    select illimite, codes into v_illimite, v_codes from public.suivi_perimetre();
    return coalesce(v_illimite, false) or v_code = any (coalesce(v_codes, '{}'));
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.obj_contrat (
  id                       uuid primary key default gen_random_uuid(),
  annee                    integer not null,
  collaborateur_code       text not null,
  objectif_caht            numeric,
  marge_n1                 numeric,
  taux_base                numeric not null default 0.08,
  taux_commission          numeric not null default 0.01,
  avance_mensuelle_saisie  numeric,           -- null = calculée (marge N-1 × base × commission)
  statut                   text not null default 'valide'
                           check (statut in ('brouillon', 'valide', 'signe')),
  commentaire              text,
  source_fichier           text,
  source_onglet            text,
  created_by               text,
  updated_by               text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint obj_contrat_annee_code_uk unique (annee, collaborateur_code)
);

create table if not exists public.obj_contrat_prime (
  id                      uuid primary key default gen_random_uuid(),
  contrat_id              uuid not null references public.obj_contrat (id) on delete cascade,
  ordre                   integer not null default 0,
  section                 text not null
                          check (section in ('ca_perso', 'ca_agence', 'qualitatif', 'avenant', 'avril_n1')),
  libelle                 text not null,
  description             text,
  mode                    text not null default 'forfait' check (mode in ('paliers', 'forfait')),
  indicateur              text not null default 'manuel'
                          check (indicateur in ('ca_perso', 'ca_agence', 'zero_impaye_45j', 'cerfa_complet', 'manuel')),
  paliers                 jsonb not null default '[]'::jsonb,   -- [{ "seuil": 2900000, "montant": 1000 }, …]
  montant                 numeric not null default 0,           -- forfait
  echeance                text not null default 'avril_n1' check (echeance in ('31/12', 'avril_n1')),
  resultat                text not null default 'a_evaluer'
                          check (resultat in ('a_evaluer', 'atteint', 'partiel', 'non_atteint')),
  montant_retenu          numeric,
  evalue_par              text,
  evalue_le               timestamptz,
  commentaire_evaluation  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists obj_contrat_prime_contrat_idx on public.obj_contrat_prime (contrat_id, ordre);

create table if not exists public.obj_versement (
  id              uuid primary key default gen_random_uuid(),
  contrat_id      uuid not null references public.obj_contrat (id) on delete cascade,
  mois            integer not null check (mois between 1 and 12),
  nature          text not null default 'avance'
                  check (nature in ('avance', 'regularisation', 'prime', 'autre')),
  montant         numeric not null,
  date_versement  date,
  commentaire     text,
  created_by      text,
  created_at      timestamptz not null default now()
);
create index if not exists obj_versement_contrat_idx on public.obj_versement (contrat_id, mois);

create table if not exists public.obj_import_staging (
  id                  uuid primary key default gen_random_uuid(),
  lot                 uuid not null,
  annee               integer not null,
  fichier             text,
  onglet              text not null,
  collaborateur_code  text,
  donnees             jsonb not null,
  statut              text not null default 'a_valider' check (statut in ('a_valider', 'publie', 'ignore')),
  contrat_id          uuid references public.obj_contrat (id) on delete set null,
  created_by          text,
  created_at          timestamptz not null default now(),
  publie_le           timestamptz
);
create index if not exists obj_import_staging_lot_idx on public.obj_import_staging (lot);

-- ---------------------------------------------------------------------------
-- 4. RLS (les écrans passent par les RPC ci-dessous ; RLS en garde-fou)
-- ---------------------------------------------------------------------------
alter table public.obj_contrat_editeurs enable row level security;
alter table public.obj_contrat          enable row level security;
alter table public.obj_contrat_prime    enable row level security;
alter table public.obj_versement        enable row level security;
alter table public.obj_import_staging   enable row level security;

drop policy if exists obj_editeurs_select on public.obj_contrat_editeurs;
create policy obj_editeurs_select on public.obj_contrat_editeurs
  for select to authenticated using (public.obj_peut_modifier());
drop policy if exists obj_editeurs_admin on public.obj_contrat_editeurs;
create policy obj_editeurs_admin on public.obj_contrat_editeurs
  for all to authenticated using (public.todo_is_admin()) with check (public.todo_is_admin());

drop policy if exists obj_contrat_select on public.obj_contrat;
create policy obj_contrat_select on public.obj_contrat
  for select to authenticated using (public.obj_peut_lire(collaborateur_code));
drop policy if exists obj_contrat_write on public.obj_contrat;
create policy obj_contrat_write on public.obj_contrat
  for all to authenticated using (public.obj_peut_modifier()) with check (public.obj_peut_modifier());

drop policy if exists obj_prime_select on public.obj_contrat_prime;
create policy obj_prime_select on public.obj_contrat_prime
  for select to authenticated using (
    exists (select 1 from public.obj_contrat c where c.id = contrat_id and public.obj_peut_lire(c.collaborateur_code)));
drop policy if exists obj_prime_write on public.obj_contrat_prime;
create policy obj_prime_write on public.obj_contrat_prime
  for all to authenticated using (public.obj_peut_modifier()) with check (public.obj_peut_modifier());

drop policy if exists obj_versement_select on public.obj_versement;
create policy obj_versement_select on public.obj_versement
  for select to authenticated using (
    exists (select 1 from public.obj_contrat c where c.id = contrat_id and public.obj_peut_lire(c.collaborateur_code)));
drop policy if exists obj_versement_write on public.obj_versement;
create policy obj_versement_write on public.obj_versement
  for all to authenticated using (public.obj_peut_modifier()) with check (public.obj_peut_modifier());

drop policy if exists obj_staging_all on public.obj_import_staging;
create policy obj_staging_all on public.obj_import_staging
  for all to authenticated using (public.obj_peut_modifier()) with check (public.obj_peut_modifier());

-- ---------------------------------------------------------------------------
-- 5. Réalisé mensuel par code collaborateur (même logique que
--    get_suivi_agences_data : code = 1er mot de collaborateur, hors stat exclus)
-- ---------------------------------------------------------------------------
create or replace function public.obj_realise_mensuel(p_annee integer, p_codes text[])
returns table (code text, annee integer, mois integer, ca numeric, marge numeric)
language sql
stable security definer
set search_path to 'public'
as $$
  select upper(split_part(btrim(i.collaborateur), ' ', 1)) as code,
         i.annee, i.mois,
         round(sum(i.ca_ht), 2) as ca,
         round(sum(i.marge_valeur), 2) as marge
  from public.indicateur_factures_mensuel i
  where i.annee between p_annee - 1 and p_annee
    and coalesce(i.hors_statistique, false) = false
    and nullif(btrim(i.collaborateur), '') is not null
    and (p_codes is null or upper(split_part(btrim(i.collaborateur), ' ', 1)) = any (p_codes))
  group by 1, 2, 3;
$$;
revoke all on function public.obj_realise_mensuel(integer, text[]) from public, anon, authenticated;

-- Référentiel collaborateurs (code, nom, agence) — même règle que Suivi agences
create or replace function public.obj_ref_collaborateurs()
returns table (code text, nom text, agence text, sommeil boolean)
language sql
stable security definer
set search_path to 'public'
as $$
  select distinct on (upper(btrim(nom)))
         upper(btrim(nom)) as code,
         coalesce(nullif(btrim(nom_prenom), ''), upper(btrim(nom))) as nom,
         nullif(btrim(agence), '') as agence,
         coalesce(mise_en_sommeil, false) as sommeil
  from public.ref_collaborateurs
  where nullif(btrim(nom), '') is not null
  order by upper(btrim(nom)), coalesce(mise_en_sommeil, false), agence nulls last;
$$;
revoke all on function public.obj_ref_collaborateurs() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC lecture
-- ---------------------------------------------------------------------------
create or replace function public.get_obj_droits()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'auth'
as $$
  select jsonb_build_object(
    'modifier', public.obj_peut_modifier(),
    'mon_code', public.obj_mon_code(),
    'suivi', public.suivi_agences_autorise()
  );
$$;

create or replace function public.get_obj_contrats_liste(p_annee integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_result jsonb;
  v_mois_clos integer := case
    when p_annee < extract(year from current_date)::int then 12
    when p_annee > extract(year from current_date)::int then 0
    else extract(month from current_date)::int - 1 end;
begin
  if auth.uid() is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;

  with c as (
    select c.* from public.obj_contrat c
    where c.annee = p_annee and public.obj_peut_lire(c.collaborateur_code)
  ),
  r as (
    select x.code,
           sum(x.ca)    filter (where x.annee = p_annee and x.mois <= v_mois_clos) as ca,
           sum(x.marge) filter (where x.annee = p_annee and x.mois <= v_mois_clos) as marge,
           sum(x.ca)    filter (where x.annee = p_annee - 1 and x.mois <= greatest(v_mois_clos, 1)) as ca_n1_a_date
    from public.obj_realise_mensuel(p_annee, (select array_agg(collaborateur_code) from c)) x
    group by x.code
  ),
  p as (
    select pr.contrat_id,
           count(*) as nb_primes,
           count(*) filter (where pr.resultat = 'a_evaluer' and pr.indicateur in ('manuel', 'cerfa_complet')) as nb_a_evaluer
    from public.obj_contrat_prime pr
    where pr.contrat_id in (select id from c)
    group by pr.contrat_id
  )
  select jsonb_build_object(
    'annee', p_annee,
    'mois_clos', v_mois_clos,
    'modifier', public.obj_peut_modifier(),
    'mon_code', public.obj_mon_code(),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'code', c.collaborateur_code,
      'nom', coalesce(rc.nom, c.collaborateur_code),
      'agence', rc.agence,
      'statut', c.statut,
      'objectif_caht', c.objectif_caht,
      'marge_n1', c.marge_n1,
      'taux_base', c.taux_base,
      'taux_commission', c.taux_commission,
      'avance_mensuelle', coalesce(c.avance_mensuelle_saisie, round(coalesce(c.marge_n1, 0) * c.taux_base * c.taux_commission, 0)),
      'ca', coalesce(r.ca, 0),
      'marge', coalesce(r.marge, 0),
      'ca_n1_a_date', coalesce(r.ca_n1_a_date, 0),
      'nb_primes', coalesce(p.nb_primes, 0),
      'nb_a_evaluer', coalesce(p.nb_a_evaluer, 0),
      'updated_at', c.updated_at
    ) order by rc.agence nulls last, coalesce(rc.nom, c.collaborateur_code)), '[]'::jsonb)
  ) into v_result
  from c
  left join public.obj_ref_collaborateurs() rc on rc.code = c.collaborateur_code
  left join r on r.code = c.collaborateur_code
  left join p on p.contrat_id = c.id;

  return v_result;
end;
$$;

create or replace function public.get_obj_contrat(p_annee integer, p_code text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_contrat public.obj_contrat;
  v_ref record;
  v_agence_norm text;
  v_mois_clos integer := case
    when p_annee < extract(year from current_date)::int then 12
    when p_annee > extract(year from current_date)::int then 0
    else extract(month from current_date)::int - 1 end;
  v_mois jsonb;
  v_ca_agence numeric;
  v_ca_agence_n1 numeric;
  v_imp_date date;
  v_imp_m45 numeric;
  v_imp_n45 integer;
  v_repart jsonb;
begin
  if not public.obj_peut_lire(v_code) then
    raise exception 'Accès refusé : ce contrat d''objectifs n''est pas dans votre périmètre' using errcode = '42501';
  end if;

  select * into v_contrat from public.obj_contrat where annee = p_annee and collaborateur_code = v_code;
  select * into v_ref from public.obj_ref_collaborateurs() where code = v_code;
  v_agence_norm := public.suivi_norm_agence(v_ref.agence);

  -- Réalisé personnel N et N-1 par mois
  select jsonb_agg(jsonb_build_object(
           'mois', m,
           'ca', coalesce(n.ca, 0), 'marge', coalesce(n.marge, 0),
           'ca_n1', coalesce(n1.ca, 0), 'marge_n1', coalesce(n1.marge, 0)) order by m)
    into v_mois
  from generate_series(1, 12) m
  left join public.obj_realise_mensuel(p_annee, array[v_code]) n  on n.annee = p_annee     and n.mois = m
  left join public.obj_realise_mensuel(p_annee, array[v_code]) n1 on n1.annee = p_annee - 1 and n1.mois = m;

  -- CA de l'agence du collaborateur (agence de la fiche collaborateur) :
  -- N sur les mois clos, N-1 sur l'année complète
  if v_agence_norm is not null then
    select coalesce(sum(x.ca) filter (where x.annee = p_annee and x.mois <= v_mois_clos), 0),
           coalesce(sum(x.ca) filter (where x.annee = p_annee - 1), 0)
      into v_ca_agence, v_ca_agence_n1
    from public.obj_realise_mensuel(p_annee, null) x
    join public.obj_ref_collaborateurs() rc on rc.code = x.code
    where public.suivi_norm_agence(rc.agence) = v_agence_norm;
  end if;

  -- Impayés > 45 j au dernier instantané (même rattachement que get_suivi_impayes)
  select max(date_extraction) into v_imp_date from public.retards_paiement_clients;
  if v_imp_date is not null then
    select round(coalesce(sum(coalesce(r.retard_plus_45, 0)), 0), 2),
           count(*) filter (where coalesce(r.retard_plus_45, 0) > 0)
      into v_imp_m45, v_imp_n45
    from public.retards_paiement_clients r
    left join public.ref_tiers t on t.numero = r.numero_tiers
    left join public.synthese_multi_clients_cache c
      on c.numero_tiers = r.numero_tiers
     and c.annee = extract(year from r.date_extraction)::int
     and c.row_kind = 'client'
    where r.date_extraction = v_imp_date
      and upper(coalesce(nullif(btrim(c.collaborateur), ''), nullif(btrim(t.representant), ''),
                         nullif(btrim(r.commercial_code), ''), 'NON AFFECTE')) = v_code;
  end if;

  select jsonb_agg(jsonb_build_object('mois', mois, 'pct', pct) order by mois)
    into v_repart
  from public.objectifs_repartition_mensuelle where annee = p_annee;

  return jsonb_build_object(
    'annee', p_annee,
    'code', v_code,
    'nom', coalesce(v_ref.nom, v_code),
    'agence', v_ref.agence,
    'mois_clos', v_mois_clos,
    'modifier', public.obj_peut_modifier(),
    'contrat', case when v_contrat.id is null then null else jsonb_build_object(
        'id', v_contrat.id,
        'objectif_caht', v_contrat.objectif_caht,
        'marge_n1', v_contrat.marge_n1,
        'taux_base', v_contrat.taux_base,
        'taux_commission', v_contrat.taux_commission,
        'avance_mensuelle_saisie', v_contrat.avance_mensuelle_saisie,
        'avance_mensuelle', coalesce(v_contrat.avance_mensuelle_saisie,
                                     round(coalesce(v_contrat.marge_n1, 0) * v_contrat.taux_base * v_contrat.taux_commission, 0)),
        'statut', v_contrat.statut,
        'commentaire', v_contrat.commentaire,
        'source_fichier', v_contrat.source_fichier,
        'source_onglet', v_contrat.source_onglet,
        'updated_at', v_contrat.updated_at,
        'updated_by', v_contrat.updated_by) end,
    'primes', coalesce((
        select jsonb_agg(to_jsonb(p) - 'contrat_id' - 'created_at' order by p.ordre, p.created_at)
        from public.obj_contrat_prime p where p.contrat_id = v_contrat.id), '[]'::jsonb),
    'versements', coalesce((
        select jsonb_agg(to_jsonb(v) - 'contrat_id' order by v.mois, v.created_at)
        from public.obj_versement v where v.contrat_id = v_contrat.id), '[]'::jsonb),
    'mois', coalesce(v_mois, '[]'::jsonb),
    'ca_agence', v_ca_agence,
    'ca_agence_n1', v_ca_agence_n1,
    'impayes', jsonb_build_object('date', v_imp_date, 'm45', coalesce(v_imp_m45, 0), 'n45', coalesce(v_imp_n45, 0)),
    'repartition', coalesce(v_repart, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RPC écriture (direction / admins)
-- ---------------------------------------------------------------------------
create or replace function public.save_obj_contrat(p jsonb)
returns uuid
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_annee integer := (p ->> 'annee')::int;
  v_code text := upper(btrim(coalesce(p ->> 'collaborateur_code', '')));
  v_id uuid;
  v_ids uuid[] := '{}';
  v_pr jsonb;
  v_pid uuid;
  v_ordre integer := 0;
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé : seule la direction peut modifier les contrats d''objectifs' using errcode = '42501';
  end if;
  if v_annee is null or v_code = '' then
    raise exception 'Année et collaborateur obligatoires';
  end if;

  insert into public.obj_contrat as c (
    annee, collaborateur_code, objectif_caht, marge_n1, taux_base, taux_commission,
    avance_mensuelle_saisie, statut, commentaire, source_fichier, source_onglet, created_by, updated_by)
  values (
    v_annee, v_code,
    nullif(p ->> 'objectif_caht', '')::numeric,
    nullif(p ->> 'marge_n1', '')::numeric,
    coalesce(nullif(p ->> 'taux_base', '')::numeric, 0.08),
    coalesce(nullif(p ->> 'taux_commission', '')::numeric, 0.01),
    nullif(p ->> 'avance_mensuelle_saisie', '')::numeric,
    coalesce(nullif(p ->> 'statut', ''), 'valide'),
    nullif(p ->> 'commentaire', ''),
    nullif(p ->> 'source_fichier', ''),
    nullif(p ->> 'source_onglet', ''),
    v_email, v_email)
  on conflict (annee, collaborateur_code) do update set
    objectif_caht           = excluded.objectif_caht,
    marge_n1                = excluded.marge_n1,
    taux_base               = excluded.taux_base,
    taux_commission         = excluded.taux_commission,
    avance_mensuelle_saisie = excluded.avance_mensuelle_saisie,
    statut                  = excluded.statut,
    commentaire             = excluded.commentaire,
    source_fichier          = coalesce(excluded.source_fichier, c.source_fichier),
    source_onglet           = coalesce(excluded.source_onglet, c.source_onglet),
    updated_by              = v_email,
    updated_at              = now()
  returning id into v_id;

  if p ? 'primes' then
    for v_pr in select * from jsonb_array_elements(coalesce(p -> 'primes', '[]'::jsonb)) loop
      v_ordre := v_ordre + 1;
      v_pid := nullif(v_pr ->> 'id', '')::uuid;
      if v_pid is not null and exists (select 1 from public.obj_contrat_prime where id = v_pid and contrat_id = v_id) then
        update public.obj_contrat_prime set
          ordre       = v_ordre,
          section     = v_pr ->> 'section',
          libelle     = v_pr ->> 'libelle',
          description = nullif(v_pr ->> 'description', ''),
          mode        = coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
          indicateur  = coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
          paliers     = coalesce(v_pr -> 'paliers', '[]'::jsonb),
          montant     = coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
          echeance    = coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'),
          updated_at  = now()
        where id = v_pid;
      else
        insert into public.obj_contrat_prime (contrat_id, ordre, section, libelle, description, mode, indicateur, paliers, montant, echeance)
        values (v_id, v_ordre, v_pr ->> 'section', v_pr ->> 'libelle', nullif(v_pr ->> 'description', ''),
                coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
                coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
                coalesce(v_pr -> 'paliers', '[]'::jsonb),
                coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
                coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'))
        returning id into v_pid;
      end if;
      v_ids := v_ids || v_pid;
    end loop;
    delete from public.obj_contrat_prime where contrat_id = v_id and not (id = any (v_ids));
  end if;

  return v_id;
end;
$$;

create or replace function public.evaluer_obj_prime(
  p_id uuid, p_resultat text, p_montant_retenu numeric default null, p_commentaire text default null)
returns void
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé : seule la direction évalue les primes' using errcode = '42501';
  end if;
  update public.obj_contrat_prime set
    resultat               = p_resultat,
    montant_retenu         = case when p_resultat = 'a_evaluer' then null else p_montant_retenu end,
    commentaire_evaluation = nullif(btrim(coalesce(p_commentaire, '')), ''),
    evalue_par             = case when p_resultat = 'a_evaluer' then null else lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) end,
    evalue_le              = case when p_resultat = 'a_evaluer' then null else now() end,
    updated_at             = now()
  where id = p_id;
end;
$$;

create or replace function public.save_obj_versement(
  p_contrat_id uuid, p_mois integer, p_nature text, p_montant numeric,
  p_date date default null, p_commentaire text default null)
returns uuid
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare v_id uuid;
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  insert into public.obj_versement (contrat_id, mois, nature, montant, date_versement, commentaire, created_by)
  values (p_contrat_id, p_mois, coalesce(p_nature, 'avance'), p_montant, p_date, nullif(btrim(coalesce(p_commentaire, '')), ''),
          lower(btrim(coalesce(auth.jwt() ->> 'email', ''))))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_obj_versement(p_id uuid)
returns void
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  delete from public.obj_versement where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Import en masse (classeur « un onglet par commercial »)
--    Le navigateur lit le classeur (lib/contratsObjectifs.ts), enregistre chaque
--    onglet lu dans obj_import_staging, la direction valide puis publie.
-- ---------------------------------------------------------------------------
create or replace function public.get_obj_import_reference(p_annee integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'collaborateurs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', rc.code, 'nom', rc.nom, 'agence', rc.agence, 'sommeil', rc.sommeil,
               'ca', coalesce((select jsonb_object_agg(x.mois::text, x.ca)
                               from public.obj_realise_mensuel(p_annee, array[rc.code]) x
                               where x.annee = p_annee), '{}'::jsonb),
               'marge', coalesce((select jsonb_object_agg(x.mois::text, x.marge)
                                  from public.obj_realise_mensuel(p_annee, array[rc.code]) x
                                  where x.annee = p_annee), '{}'::jsonb))
             order by rc.nom)
      from public.obj_ref_collaborateurs() rc), '[]'::jsonb),
    'contrats', coalesce((
      select jsonb_agg(jsonb_build_object('code', collaborateur_code, 'id', id, 'updated_at', updated_at))
      from public.obj_contrat where annee = p_annee), '[]'::jsonb)
  );
end;
$$;

create or replace function public.obj_import_enregistrer(p_lot uuid, p_annee integer, p_fichier text, p_onglets jsonb)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_o jsonb;
  v_res jsonb := '[]'::jsonb;
  v_id uuid;
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  for v_o in select * from jsonb_array_elements(coalesce(p_onglets, '[]'::jsonb)) loop
    insert into public.obj_import_staging (lot, annee, fichier, onglet, collaborateur_code, donnees, created_by)
    values (p_lot, p_annee, p_fichier, coalesce(v_o ->> 'onglet', '?'),
            nullif(upper(btrim(coalesce(v_o ->> 'collaborateur_code', ''))), ''), v_o, v_email)
    returning id into v_id;
    v_res := v_res || jsonb_build_object('onglet', v_o ->> 'onglet', 'staging_id', v_id);
  end loop;
  return v_res;
end;
$$;

create or replace function public.obj_import_marquer(p_staging_id uuid, p_statut text, p_contrat_id uuid default null, p_code text default null)
returns void
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.obj_import_staging set
    statut             = p_statut,
    contrat_id         = coalesce(p_contrat_id, contrat_id),
    collaborateur_code = coalesce(nullif(upper(btrim(coalesce(p_code, ''))), ''), collaborateur_code),
    publie_le          = case when p_statut = 'publie' then now() else publie_le end
  where id = p_staging_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
grant execute on function public.obj_peut_modifier()                                   to authenticated;
grant execute on function public.obj_mon_code()                                        to authenticated;
grant execute on function public.obj_peut_lire(text)                                   to authenticated;
grant execute on function public.get_obj_droits()                                      to authenticated;
grant execute on function public.get_obj_contrats_liste(integer)                       to authenticated;
grant execute on function public.get_obj_contrat(integer, text)                        to authenticated;
grant execute on function public.save_obj_contrat(jsonb)                               to authenticated;
grant execute on function public.evaluer_obj_prime(uuid, text, numeric, text)          to authenticated;
grant execute on function public.save_obj_versement(uuid, integer, text, numeric, date, text) to authenticated;
grant execute on function public.delete_obj_versement(uuid)                            to authenticated;
grant execute on function public.get_obj_import_reference(integer)                     to authenticated;
grant execute on function public.obj_import_enregistrer(uuid, integer, text, jsonb)    to authenticated;
grant execute on function public.obj_import_marquer(uuid, text, uuid, text)            to authenticated;

grant select, insert, update, delete on public.obj_contrat, public.obj_contrat_prime,
  public.obj_versement, public.obj_import_staging, public.obj_contrat_editeurs to authenticated;
