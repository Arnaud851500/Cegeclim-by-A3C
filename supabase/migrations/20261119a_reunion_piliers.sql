-- ============================================================================
-- 20261119a_reunion_piliers.sql — Réunion Piliers / Feuille de route (19/11/2026)
-- ----------------------------------------------------------------------------
-- Rubrique réservée aux membres de la réunion mensuelle des Piliers de
-- CEGECLIM : sujets (infos, questions, décisions, actions, projets), porteurs,
-- fil de suivi entre deux réunions, réunions (météo, revue des actions,
-- clôture) et communication aux collaborateurs.
--
-- Accès : uniquement les membres actifs de piliers_membres (contrôle par RLS,
-- fonction piliers_est_membre()). Les animateurs gèrent la liste des membres.
-- L'écran /piliers est affiché dans le menu via le droit calculé can_piliers
-- (components/AccessContext.tsx → rpc piliers_suis_membre()).
-- ============================================================================

-- ---------------------------------------------------------------- membres
create table if not exists public.piliers_membres (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  prenom text not null,
  role text not null default '',
  domaine text not null default '',
  couleur text not null default '#7A5EA8',
  ordre int not null default 100,
  actif boolean not null default true,
  est_animateur boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.piliers_email_courant()
returns text language sql stable as $$
  select lower(trim(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.piliers_est_membre()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.piliers_membres m
    where m.actif and m.email is not null and lower(m.email) = public.piliers_email_courant()
  )
$$;

create or replace function public.piliers_est_animateur()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.piliers_membres m
    where m.actif and m.est_animateur and m.email is not null and lower(m.email) = public.piliers_email_courant()
  )
$$;

-- Utilisé par le menu (AccessContext) : true si l'utilisateur connecté est membre.
create or replace function public.piliers_suis_membre()
returns boolean language sql stable security definer set search_path = public as $$
  select public.piliers_est_membre()
$$;

grant execute on function public.piliers_email_courant() to authenticated;
grant execute on function public.piliers_est_membre() to authenticated;
grant execute on function public.piliers_est_animateur() to authenticated;
grant execute on function public.piliers_suis_membre() to authenticated;

-- ---------------------------------------------------------------- réunions
create table if not exists public.piliers_reunions (
  id uuid primary key default gen_random_uuid(),
  date_reunion date not null,
  titre text not null default 'Réunion Piliers',
  lieu text not null default '',
  statut text not null default 'preparation' check (statut in ('preparation', 'en_cours', 'cloturee')),
  synthese text not null default '',
  cloturee_le timestamptz,
  created_by text default public.piliers_email_courant(),
  created_at timestamptz not null default now()
);

create table if not exists public.piliers_meteo (
  reunion_id uuid not null references public.piliers_reunions(id) on delete cascade,
  membre_id uuid not null references public.piliers_membres(id) on delete cascade,
  humeur smallint check (humeur between 1 and 5),
  mot text not null default '',
  updated_at timestamptz not null default now(),
  primary key (reunion_id, membre_id)
);

-- ---------------------------------------------------------------- sujets
create sequence if not exists public.piliers_sujets_numero_seq;

create table if not exists public.piliers_sujets (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.piliers_sujets_numero_seq'),
  titre text not null,
  contexte text not null default '',
  -- Ce que c'est
  nature text not null default 'question' check (nature in ('info', 'question', 'decision', 'action', 'projet')),
  -- Où il en est
  statut text not null default 'a_aborder' check (statut in ('a_aborder', 'a_planifier', 'en_cours', 'en_attente', 'fait', 'abandonne')),
  domaine text not null default '',
  -- Pourquoi c'est important
  ressenti text not null default 'neutre' check (ressenti in ('irritant', 'attendu', 'changement', 'neutre')),
  enjeux text[] not null default '{}',
  impacte_ca boolean not null default false,
  impact_ca_note text not null default '',
  priorite smallint check (priorite between 1 and 3),
  -- Quand
  prochain_point date,
  echeance date,
  -- Ordre du jour : à aborder à la prochaine réunion (même s'il n'est pas nouveau)
  a_l_ordre_du_jour boolean not null default false, -- mis en avant à la prochaine réunion (à creuser)
  -- Communication aux collaborateurs
  a_communiquer boolean not null default false,
  communication_statut text not null default 'a_preparer' check (communication_statut in ('a_preparer', 'pret', 'diffuse')),
  communication_cible text not null default '',
  communication_message text not null default '',
  communication_diffusee_le date,
  reunion_origine uuid references public.piliers_reunions(id) on delete set null,
  created_by text default public.piliers_email_courant(),
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  clos_le timestamptz
);

create index if not exists piliers_sujets_statut_idx on public.piliers_sujets (statut);

create table if not exists public.piliers_sujet_porteurs (
  sujet_id uuid not null references public.piliers_sujets(id) on delete cascade,
  membre_id uuid not null references public.piliers_membres(id) on delete cascade,
  role text not null default 'contributeur' check (role in ('pilote', 'contributeur')),
  primary key (sujet_id, membre_id)
);

-- Fil de suivi : mises à jour entre deux réunions, questions, décisions, changements de statut
create table if not exists public.piliers_suivis (
  id uuid primary key default gen_random_uuid(),
  sujet_id uuid not null references public.piliers_sujets(id) on delete cascade,
  reunion_id uuid references public.piliers_reunions(id) on delete set null,
  type text not null default 'update' check (type in ('update', 'question', 'decision', 'statut', 'note')),
  texte text not null,
  auteur_email text default public.piliers_email_courant(),
  created_at timestamptz not null default now()
);

create index if not exists piliers_suivis_sujet_idx on public.piliers_suivis (sujet_id, created_at desc);

-- Passage d'un sujet en réunion (revue des actions / nouveaux sujets)
create table if not exists public.piliers_reunion_sujets (
  reunion_id uuid not null references public.piliers_reunions(id) on delete cascade,
  sujet_id uuid not null references public.piliers_sujets(id) on delete cascade,
  issue text not null check (issue in ('fait', 'on_continue', 'en_attente', 'abandonne', 'qualifie', 'pour_info')),
  commentaire text not null default '',
  revu_le timestamptz not null default now(),
  primary key (reunion_id, sujet_id)
);

-- ---------------------------------------------------------------- triggers
create or replace function public.piliers_sujets_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := public.piliers_email_courant();
  if new.statut in ('fait', 'abandonne') and (tg_op = 'INSERT' or old.statut not in ('fait', 'abandonne')) then
    new.clos_le := now();
  elsif new.statut not in ('fait', 'abandonne') then
    new.clos_le := null;
  end if;
  if new.communication_statut = 'diffuse' and new.communication_diffusee_le is null then
    new.communication_diffusee_le := current_date;
  end if;
  return new;
end $$;

drop trigger if exists piliers_sujets_touch on public.piliers_sujets;
create trigger piliers_sujets_touch before insert or update on public.piliers_sujets
for each row execute function public.piliers_sujets_touch();

-- Un seul pilote par sujet
create unique index if not exists piliers_sujet_un_pilote on public.piliers_sujet_porteurs (sujet_id) where role = 'pilote';

-- ---------------------------------------------------------------- RLS
alter table public.piliers_membres enable row level security;
alter table public.piliers_reunions enable row level security;
alter table public.piliers_meteo enable row level security;
alter table public.piliers_sujets enable row level security;
alter table public.piliers_sujet_porteurs enable row level security;
alter table public.piliers_suivis enable row level security;
alter table public.piliers_reunion_sujets enable row level security;

drop policy if exists piliers_membres_select on public.piliers_membres;
create policy piliers_membres_select on public.piliers_membres for select to authenticated using (public.piliers_est_membre());
drop policy if exists piliers_membres_write on public.piliers_membres;
create policy piliers_membres_write on public.piliers_membres for all to authenticated
  using (public.piliers_est_animateur()) with check (public.piliers_est_animateur());

do $$
declare t text;
begin
  foreach t in array array['piliers_reunions', 'piliers_meteo', 'piliers_sujets', 'piliers_sujet_porteurs', 'piliers_suivis', 'piliers_reunion_sujets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_membres', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.piliers_est_membre()) with check (public.piliers_est_membre())', t || '_membres', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select, insert, update, delete on public.piliers_membres to authenticated;
grant usage, select on sequence public.piliers_sujets_numero_seq to authenticated;

-- ---------------------------------------------------------------- membres initiaux
insert into public.piliers_membres (email, prenom, role, domaine, couleur, ordre, est_animateur) values
  ('jm.ladeuix@cegeclim-energies.com',    'Jean-Marc', 'Directeur général',                         'Direction générale',      '#245A9E', 10, true),
  (null,                                   'Gracien',   'Fondateur — regard et avis',                'Direction générale',      '#8B8767', 20, false),
  ('l.carrere@cegeclim-energies.com',      'Laetitia',  'RH & Finance',                              'RH & Finance',            '#A5482A', 30, false),
  ('l.valdovinos@cegeclim-energies.com',   'Laure',     'Logistique · ADV · SI · Communication',     'Log · ADV · SI · Com',    '#2D6F86', 40, false),
  ('p.verges@cegeclim-energies.com',       'Philippe',  'SAV & Technique',                           'SAV & Technique',         '#8C5A1C', 50, false),
  ('ga.perrin@cegeclim-energies.com',      'Gilarno',   'Photovoltaïque',                            'Photovoltaïque',          '#C9A227', 60, false),
  ('s.chanteau@cegeclim-energies.com',     'Stéphane',  'Directeur — Nord Aquitaine',                'Commerce',                '#4E7A2A', 70, false),
  ('j.ithurbide@cegeclim-energies.com',    'Julien',    'Achats · Appro · Prescription',             'Achats · Appro',          '#54459F', 80, false),
  ('a.valanchauskas@cegeclim-energies.com','Arnaud',    'Compagnon · Process · Routines',            'Compagnon & process',     '#7A5EA8', 90, true)
on conflict (email) do nothing;
