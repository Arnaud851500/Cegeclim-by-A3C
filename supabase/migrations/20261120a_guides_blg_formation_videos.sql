-- ============================================================================
-- 20261120a_guides_blg_formation_videos.sql — Guides BLG › Formation : vidéos (20/11/2026)
-- ----------------------------------------------------------------------------
-- Enregistrements Teams (MP4, jusqu'à plusieurs centaines de Mo) déposés à la main par
-- l'administration dans les dossiers de « Formation » et lus dans le compagnon.
-- Pas de synchronisation OneDrive : la synchro des PDF (scripts/guides-blg-sync.ts)
-- n'utilise que guides_blg_formation et le préfixe formation/ du bucket ; les vidéos
-- sont dans leur propre table et sous formation-videos/<uuid>.<ext>, elle n'y touche pas.
-- Envoi depuis le navigateur en téléversement reprenable (TUS, morceaux de 6 Mo) :
-- la taille maximale est celle réglée dans Supabase › Storage › Settings
-- (« Upload file size limit », 50 Mo par défaut sur le plan Pro).
-- Droits : lecture peut_lire_guides_blg, dépôt / modification / suppression
-- peut_gerer_guides_blg (policies existantes du bucket « guides-blg »).
-- ============================================================================

create table if not exists public.guides_blg_formation_videos (
  id           uuid primary key default gen_random_uuid(),
  dossier      text not null default '',     -- chemin relatif du dossier Formation ('' = racine)
  titre        text not null,                -- titre affiché (modifiable)
  nom          text not null,                -- nom du fichier d'origine
  taille       bigint,
  duree_s      integer,                      -- durée en secondes (lue par le navigateur au dépôt)
  mime         text not null default 'video/mp4',
  storage_path text not null unique,         -- formation-videos/<uuid>.mp4 dans le bucket guides-blg
  ordre        integer,
  created_at   timestamptz not null default now(),
  created_by   text,
  updated_at   timestamptz not null default now()
);

create index if not exists guides_blg_formation_videos_dossier_idx on public.guides_blg_formation_videos (dossier);

alter table public.guides_blg_formation_videos enable row level security;

drop policy if exists guides_blg_formation_videos_select on public.guides_blg_formation_videos;
create policy guides_blg_formation_videos_select on public.guides_blg_formation_videos
  for select to authenticated
  using (public.peut_lire_guides_blg());

drop policy if exists guides_blg_formation_videos_write on public.guides_blg_formation_videos;
create policy guides_blg_formation_videos_write on public.guides_blg_formation_videos
  for all to authenticated
  using (public.peut_gerer_guides_blg())
  with check (public.peut_gerer_guides_blg());

grant select, insert, update, delete on public.guides_blg_formation_videos to authenticated;
