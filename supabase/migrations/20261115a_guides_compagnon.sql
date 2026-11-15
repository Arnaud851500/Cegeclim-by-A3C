-- ============================================================================
-- 20261115a_guides_compagnon.sql — Guide utilisateur « Mon Compagnon » (15/11/2026)
-- ----------------------------------------------------------------------------
-- Le bloc d'accueil « Guides BLG » devient « Guide utilisateur Compagnon & BLG » :
-- une fenêtre propose le guide BLG (/guides-blg, inchangé) ou le guide du
-- compagnon (/guides-compagnon).
--
-- Les chapitres du guide du compagnon sont des fichiers HTML autonomes rangés
-- dans le dépôt GitHub, un dossier par pavé de la page d'accueil :
--     guides-compagnon/<id du pavé>/CHAPITRE-xxx.html   (ex. hotline/CHAPITRE-Hotline.html)
-- (id du pavé = NAV_BLOCS[].id de lib/navigation.ts). Ils sont publiés comme les
-- chapitres BLG : images extraites en fichiers séparés dans le bucket privé
-- « guides-blg » sous compagnon/<slug>/v<version>/, page légère index.html.
-- La publication est faite par le navigateur d'un administrateur à l'ouverture de
-- /guides-compagnon : la route /api/admin/guides-compagnon liste les fichiers du
-- dépôt avec leur empreinte, seuls les fichiers modifiés sont republiés, un
-- fichier retiré du dépôt est retiré du guide.
--
-- Droits : mêmes que le guide BLG (lecture can_guides_blg ou administration,
-- publication réservée aux administrateurs) ; les policies du bucket
-- « guides-blg » couvrent déjà le préfixe compagnon/.
-- ============================================================================

create table if not exists public.guides_compagnon (
  slug            text primary key,                  -- <bloc>--<fichier> (ex. hotline--hotline)
  bloc            text not null,                     -- id du pavé d'accueil (dossier du dépôt)
  chemin_source   text not null unique,              -- chemin dans le dépôt, relatif à guides-compagnon/
  titre           text not null,
  sous_titre      text,
  fichier_origine text,
  ordre           integer not null default 100,
  version         integer not null default 1,
  prefixe         text not null,                     -- compagnon/<slug>/v<version> dans le bucket guides-blg
  sommaire        jsonb not null default '[]'::jsonb,
  nb_modop        integer not null default 0,
  nb_etapes       integer not null default 0,
  nb_images       integer not null default 0,
  nb_pdf          integer not null default 0,
  taille_origine  bigint,
  taille_page     bigint,
  actif           boolean not null default true,
  icone           text,
  source_hash     text,                              -- SHA-256 du fichier publié
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create index if not exists guides_compagnon_bloc_idx on public.guides_compagnon (bloc, ordre);

alter table public.guides_compagnon enable row level security;

drop policy if exists guides_compagnon_select on public.guides_compagnon;
create policy guides_compagnon_select on public.guides_compagnon
  for select to authenticated
  using (public.peut_lire_guides_blg());

drop policy if exists guides_compagnon_write on public.guides_compagnon;
create policy guides_compagnon_write on public.guides_compagnon
  for all to authenticated
  using (public.peut_gerer_guides_blg())
  with check (public.peut_gerer_guides_blg());

grant select, insert, update, delete on public.guides_compagnon to authenticated;
