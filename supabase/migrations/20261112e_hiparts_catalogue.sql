-- ============================================================================
-- 20261112e_hiparts_catalogue.sql — Hotline Thermie : catalogue Hi-Parts (12/11/2026)
-- ----------------------------------------------------------------------------
-- Copie locale du catalogue de pièces Hitachi « Hi-Parts » (https://hitachi.spelog.com,
-- compte partagé communiqué par Philippe Verges) pour l'écran de ticketing Thermie :
-- à partir du modèle GE ou UI saisi, ouvrir la vue éclatée, choisir la pièce et
-- reporter sa référence et son prix HT dans le ticket.
--
-- Alimentation : /api/hiparts/sync (cron Vercel toutes les 5 min) dépile la file
-- hiparts_file : FAMILLE → PRODUITS → PRODUIT → RUBRIQUE → SCHEMA → PRIX.
-- Relance complète automatique tous les 7 jours (hiparts_relancer_si_besoin).
-- Les images des vues éclatées restent chez Hi-Parts (accessibles sans connexion) :
-- on ne stocke que leur chemin et les positions des repères (en pixels de l'image).
-- ============================================================================

create or replace function public.hiparts_cle(t text)
returns text language sql immutable parallel safe as $$
  select upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- Produits (modèles) ---------------------------------------------------------
create table if not exists public.hiparts_produits (
  idgam       int primary key,
  idfam       int not null,
  nom         text not null,
  nom_cle     text generated always as (public.hiparts_cle(nom)) stored,
  chemin      text,
  type_unite  text not null default 'AUTRE' check (type_unite in ('GE', 'UI', 'AUTRE')),
  maj_le      timestamptz not null default now()
);
create index if not exists idx_hiparts_produits_cle on public.hiparts_produits (nom_cle text_pattern_ops);

-- Vues éclatées (planches) ---------------------------------------------------
create table if not exists public.hiparts_schemas (
  idscg       int primary key,
  idgam       int not null,
  idrub       int,
  rubrique    text,
  code        text,
  libelle     text,
  image_path  text,
  ordre       int not null default 0,
  nb_pieces   int,
  maj_le      timestamptz not null default now()
);
create index if not exists idx_hiparts_schemas_gam on public.hiparts_schemas (idgam, ordre);

-- Nomenclature de chaque planche ------------------------------------------------
create table if not exists public.hiparts_schema_pieces (
  idscg            int not null,
  ligne            int not null,
  repere           text,
  reference        text,
  designation      text,
  id_nomenclature  int,
  positions        jsonb not null default '[]'::jsonb, -- [[x, y], …] en pixels de l'image
  primary key (idscg, ligne)
);
create index if not exists idx_hiparts_pieces_ref on public.hiparts_schema_pieces (upper(reference));

-- Articles (prix) -------------------------------------------------------------
create table if not exists public.hiparts_articles (
  reference        text primary key,
  designation      text,
  prix_ht          numeric,
  ref_remplacement text,
  stock_info       text,
  id_nomenclature  int,
  prix_maj_le      timestamptz,
  erreur           text
);

-- File de travail de l'aspiration -------------------------------------------------
create table if not exists public.hiparts_file (
  id            bigserial primary key,
  type          text not null check (type in ('FAMILLE', 'PRODUITS', 'PRODUIT', 'RUBRIQUE', 'SCHEMA', 'PRIX')),
  cle           text not null,
  payload       jsonb not null default '{}'::jsonb,
  priorite      int not null default 5,
  statut        text not null default 'A_FAIRE' check (statut in ('A_FAIRE', 'EN_COURS', 'FAIT', 'ERREUR')),
  essais        int not null default 0,
  verrou_jusqua timestamptz,
  erreur        text,
  cree_le       timestamptz not null default now(),
  traite_le     timestamptz,
  unique (type, cle)
);
create index if not exists idx_hiparts_file_a_faire on public.hiparts_file (priorite, id) where statut = 'A_FAIRE';

create table if not exists public.hiparts_sync_etat (
  id               int primary key default 1 check (id = 1),
  derniere_relance timestamptz,
  dernier_passage  timestamptz,
  dernier_message  text
);
insert into public.hiparts_sync_etat (id) values (1) on conflict do nothing;

-- Sécurité : lecture pour la hotline, écriture réservée au service (cron) ----------
alter table public.hiparts_produits enable row level security;
alter table public.hiparts_schemas enable row level security;
alter table public.hiparts_schema_pieces enable row level security;
alter table public.hiparts_articles enable row level security;
alter table public.hiparts_file enable row level security;
alter table public.hiparts_sync_etat enable row level security;

drop policy if exists hiparts_produits_lecture on public.hiparts_produits;
create policy hiparts_produits_lecture on public.hiparts_produits for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hiparts_schemas_lecture on public.hiparts_schemas;
create policy hiparts_schemas_lecture on public.hiparts_schemas for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hiparts_pieces_lecture on public.hiparts_schema_pieces;
create policy hiparts_pieces_lecture on public.hiparts_schema_pieces for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hiparts_articles_lecture on public.hiparts_articles;
create policy hiparts_articles_lecture on public.hiparts_articles for select to authenticated using (public.hotline_peut_acceder());
drop policy if exists hiparts_etat_lecture on public.hiparts_sync_etat;
create policy hiparts_etat_lecture on public.hiparts_sync_etat for select to authenticated using (public.hotline_peut_acceder());
grant select on public.hiparts_produits, public.hiparts_schemas, public.hiparts_schema_pieces, public.hiparts_articles, public.hiparts_sync_etat to authenticated;

-- Prise d'un lot (service uniquement) ------------------------------------------------
create or replace function public.hiparts_prendre_lot(p_n int default 40)
returns setof public.hiparts_file
language plpgsql security definer set search_path = public as $$
begin
  -- éléments restés « EN_COURS » après un passage interrompu
  update public.hiparts_file set statut = 'A_FAIRE', verrou_jusqua = null
  where statut = 'EN_COURS' and verrou_jusqua < now();

  return query
  update public.hiparts_file f set statut = 'EN_COURS', verrou_jusqua = now() + interval '10 minutes', essais = f.essais + 1
  where f.id in (
    select id from public.hiparts_file
    where statut = 'A_FAIRE'
    order by priorite, id
    limit greatest(1, least(p_n, 200))
    for update skip locked
  )
  returning f.*;
end $$;
revoke all on function public.hiparts_prendre_lot(int) from public, anon, authenticated;
grant execute on function public.hiparts_prendre_lot(int) to service_role;

-- Relance complète (tous les p_jours) -------------------------------------------------
create or replace function public.hiparts_relancer_si_besoin(p_jours int default 7, p_forcer boolean default false)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_derniere timestamptz;
  v_reste int;
begin
  select derniere_relance into v_derniere from public.hiparts_sync_etat where id = 1;
  select count(*) into v_reste from public.hiparts_file where statut in ('A_FAIRE', 'EN_COURS');
  if not p_forcer and (v_reste > 0 or (v_derniere is not null and v_derniere > now() - make_interval(days => p_jours))) then
    return 'rien';
  end if;
  update public.hiparts_file set statut = 'A_FAIRE', essais = 0, erreur = null, verrou_jusqua = null where id > 0;
  insert into public.hiparts_file (type, cle, payload, priorite)
  values ('FAMILLE', '-1', jsonb_build_object('id', -1, 'chemin', ''), 1)
  on conflict (type, cle) do update set statut = 'A_FAIRE';
  update public.hiparts_sync_etat set derniere_relance = now(), dernier_message = 'Relance complète du catalogue' where id = 1;
  return 'relance';
end $$;
revoke all on function public.hiparts_relancer_si_besoin(int, boolean) from public, anon, authenticated;
grant execute on function public.hiparts_relancer_si_besoin(int, boolean) to service_role;

-- Recherche d'un modèle (GE / UI) -----------------------------------------------------
create or replace function public.hiparts_chercher_modele(p_q text, p_limite int default 15)
returns table (idgam int, idfam int, nom text, chemin text, type_unite text, nb_schemas int, exact boolean)
language sql stable security definer set search_path = public as $$
  with q as (select public.hiparts_cle(p_q) as cle)
  select p.idgam, p.idfam, p.nom, p.chemin, p.type_unite,
         (select count(*)::int from public.hiparts_schemas s where s.idgam = p.idgam) as nb_schemas,
         p.nom_cle = q.cle as exact
  from public.hiparts_produits p, q
  where public.hotline_peut_acceder()
    and length(q.cle) >= 3
    and (p.nom_cle like q.cle || '%' or (length(q.cle) >= 5 and q.cle like p.nom_cle || '%'))
  order by (p.nom_cle = q.cle) desc, length(p.nom_cle), p.nom
  limit greatest(1, least(p_limite, 50))
$$;
grant execute on function public.hiparts_chercher_modele(text, int) to authenticated;

-- Une planche complète : nomenclature + prix ------------------------------------------
create or replace function public.hiparts_schema(p_idscg int)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.hotline_peut_acceder() then null else jsonb_build_object(
    'schema', (select to_jsonb(s) from public.hiparts_schemas s where s.idscg = p_idscg),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ligne', sp.ligne, 'repere', sp.repere, 'reference', sp.reference, 'designation', sp.designation,
        'positions', sp.positions, 'prix_ht', a.prix_ht, 'ref_remplacement', a.ref_remplacement,
        'stock_info', a.stock_info, 'prix_maj_le', a.prix_maj_le
      ) order by sp.ligne)
      from public.hiparts_schema_pieces sp
      left join public.hiparts_articles a on a.reference = sp.reference
      where sp.idscg = p_idscg), '[]'::jsonb)
  ) end
$$;
grant execute on function public.hiparts_schema(int) to authenticated;

-- Recherche d'une pièce par référence ou désignation (tous modèles) ---------------------
create or replace function public.hiparts_chercher_piece(p_q text, p_limite int default 30)
returns table (reference text, designation text, prix_ht numeric, ref_remplacement text, modeles text)
language sql stable security definer set search_path = public as $$
  select sp.reference, max(sp.designation), max(a.prix_ht), max(a.ref_remplacement),
         string_agg(distinct p.nom, ', ') as modeles
  from public.hiparts_schema_pieces sp
  join public.hiparts_schemas s on s.idscg = sp.idscg
  join public.hiparts_produits p on p.idgam = s.idgam
  left join public.hiparts_articles a on a.reference = sp.reference
  where public.hotline_peut_acceder()
    and length(trim(p_q)) >= 3
    and (upper(sp.reference) like upper(trim(p_q)) || '%' or sp.designation ilike '%' || trim(p_q) || '%')
  group by sp.reference
  order by sp.reference
  limit greatest(1, least(p_limite, 100))
$$;
grant execute on function public.hiparts_chercher_piece(text, int) to authenticated;

-- Avancement (affiché dans la fenêtre Hi-Parts) ------------------------------------------
create or replace function public.hiparts_avancement()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.hotline_peut_acceder() then null else jsonb_build_object(
    'produits', (select count(*) from public.hiparts_produits),
    'schemas', (select count(*) from public.hiparts_schemas),
    'pieces', (select count(*) from public.hiparts_schema_pieces),
    'prix', (select count(*) from public.hiparts_articles where prix_ht is not null),
    'a_faire', (select count(*) from public.hiparts_file where statut in ('A_FAIRE', 'EN_COURS')),
    'erreurs', (select count(*) from public.hiparts_file where statut = 'ERREUR'),
    'derniere_relance', (select derniere_relance from public.hiparts_sync_etat where id = 1),
    'dernier_passage', (select dernier_passage from public.hiparts_sync_etat where id = 1),
    'dernier_message', (select dernier_message from public.hiparts_sync_etat where id = 1)
  ) end
$$;
grant execute on function public.hiparts_avancement() to authenticated;
