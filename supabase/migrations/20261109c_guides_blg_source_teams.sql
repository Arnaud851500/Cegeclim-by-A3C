-- 20261109c_guides_blg_source_teams.sql — Guides BLG : lien source Teams / SharePoint par chapitre
--  - source_url        : lien de partage « Toute personne disposant du lien » du fichier CHAPITRE-xxx.html
--  - source_hash       : empreinte SHA-256 du fichier publié depuis ce lien (évite de republier un fichier inchangé)
--  - source_verifie_at : dernière vérification du lien (bouton « Mettre à jour »)
--  - source_message    : résultat de la dernière vérification (inchangé, publié, erreur…)
-- Téléchargement côté serveur : app/api/admin/guides-blg/source/route.ts
alter table public.guides_blg
  add column if not exists source_url text,
  add column if not exists source_hash text,
  add column if not exists source_verifie_at timestamptz,
  add column if not exists source_message text;
