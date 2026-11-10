-- ============================================================================
-- 20261110a_guides_blg_formation.sql — Guides BLG : pavé « Formation » (10/11/2026)
-- ----------------------------------------------------------------------------
-- Le dossier Teams « z - Formation » (à côté des CHAPITRE-xxx.html, synchronisé par
-- OneDrive sur le Mac d'Arnaud) est publié dans le compagnon sous le nom « Formation »,
-- en respectant son arborescence de dossiers. Seuls les fichiers PDF sont synchronisés
-- (scripts/guides-blg-sync.ts, même tâche launchd que les chapitres).
--  - guides_blg_formation      : un enregistrement par PDF ; chemin relatif à la racine
--                                « z - Formation » (ex. « Séquence commerce/Séance n° 1 …/x.pdf ») ;
--                                les dossiers se déduisent des chemins ;
--  - fichiers stockés dans le bucket privé « guides-blg » sous formation/<sha256>.pdf
--    (clé neutre : les noms Teams contiennent accents et « ° », refusés par le
--    stockage ; un fichier renommé ou déplacé n'est pas renvoyé) ;
--  - guides_blg_formation_etat : dernière synchronisation (affichée dans l'écran).
-- Droits : mêmes fonctions que les chapitres (peut_lire_guides_blg / peut_gerer_guides_blg) ;
-- les policies existantes du bucket « guides-blg » couvrent déjà le préfixe formation/.
-- ============================================================================

create table if not exists public.guides_blg_formation (
  chemin       text primary key,                 -- chemin relatif complet, fichier compris
  dossier      text not null default '',         -- chemin relatif du dossier parent ('' = racine)
  nom          text not null,                    -- nom du fichier (avec .pdf)
  taille       bigint,
  hash         text not null,                    -- SHA-256 du contenu
  storage_path text not null,                    -- formation/<hash>.pdf dans le bucket guides-blg
  modifie_le   timestamptz,                      -- date de modification du fichier dans Teams
  updated_at   timestamptz not null default now()
);

create index if not exists guides_blg_formation_dossier_idx on public.guides_blg_formation (dossier);

alter table public.guides_blg_formation enable row level security;

drop policy if exists guides_blg_formation_select on public.guides_blg_formation;
create policy guides_blg_formation_select on public.guides_blg_formation
  for select to authenticated
  using (public.peut_lire_guides_blg());

drop policy if exists guides_blg_formation_write on public.guides_blg_formation;
create policy guides_blg_formation_write on public.guides_blg_formation
  for all to authenticated
  using (public.peut_gerer_guides_blg())
  with check (public.peut_gerer_guides_blg());

grant select, insert, update, delete on public.guides_blg_formation to authenticated;

create table if not exists public.guides_blg_formation_etat (
  id          integer primary key default 1 check (id = 1),
  titre       text not null default 'Formation',
  icone       text not null default '🎓',
  actif       boolean not null default true,
  verifie_at  timestamptz,
  message     text,
  nb_fichiers integer not null default 0,
  nb_dossiers integer not null default 0
);

insert into public.guides_blg_formation_etat (id) values (1) on conflict (id) do nothing;

alter table public.guides_blg_formation_etat enable row level security;

drop policy if exists guides_blg_formation_etat_select on public.guides_blg_formation_etat;
create policy guides_blg_formation_etat_select on public.guides_blg_formation_etat
  for select to authenticated
  using (public.peut_lire_guides_blg());

drop policy if exists guides_blg_formation_etat_write on public.guides_blg_formation_etat;
create policy guides_blg_formation_etat_write on public.guides_blg_formation_etat
  for all to authenticated
  using (public.peut_gerer_guides_blg())
  with check (public.peut_gerer_guides_blg());

grant select, insert, update, delete on public.guides_blg_formation_etat to authenticated;
