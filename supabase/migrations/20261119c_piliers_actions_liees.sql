-- ============================================================================
-- 20261119c_piliers_actions_liees.sql — Réunion Piliers : actions à la volée (19/11/2026)
-- ----------------------------------------------------------------------------
-- Lignes d'action saisies vite (tour de météo, sujets à aborder, revue) :
--   - parent_id : action tirée d'un autre sujet (série d'actions) ;
--   - origine   : d'où vient le sujet (remonté, séance, météo, action liée).
-- Appliquée en production le 19/11/2026.
-- ============================================================================
alter table public.piliers_sujets
  add column if not exists parent_id uuid references public.piliers_sujets(id) on delete set null,
  add column if not exists origine text not null default 'remonte' check (origine in ('remonte', 'seance', 'meteo', 'action_liee'));
create index if not exists piliers_sujets_parent_idx on public.piliers_sujets (parent_id);
comment on column public.piliers_sujets.parent_id is 'Action tirée d''un autre sujet (série d''actions saisie en réunion).';
comment on column public.piliers_sujets.origine is 'remonte = remonté entre deux réunions, seance = ajouté en séance, meteo = saisi au tour de météo, action_liee = action tirée d''un sujet.';
