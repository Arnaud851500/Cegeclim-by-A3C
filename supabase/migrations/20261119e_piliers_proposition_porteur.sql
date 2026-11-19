-- ============================================================================
-- 20261119e_piliers_proposition_porteur.sql — Réunion Piliers (19/11/2026)
-- ----------------------------------------------------------------------------
-- Revue de la réunion précédente : le porteur prépare, avant la réunion, un
-- commentaire (update) et une proposition (à suivre / à abandonner / à
-- rediscuter). Remis à vide quand le sujet est revu en réunion (la décision et
-- le commentaire sont alors versés dans le fil de suivi).
-- Appliquée en production le 19/11/2026.
-- ============================================================================
alter table public.piliers_sujets
  add column if not exists proposition_porteur text check (proposition_porteur in ('suivre', 'abandonner', 'rediscuter')),
  add column if not exists proposition_commentaire text not null default '',
  add column if not exists proposition_le timestamptz;
comment on column public.piliers_sujets.proposition_porteur is 'Proposition du porteur pour la revue de la prochaine réunion : suivre / abandonner / rediscuter (remise à vide une fois le sujet revu).';
comment on column public.piliers_sujets.proposition_commentaire is 'Commentaire du porteur (update) pour la revue de la prochaine réunion.';
