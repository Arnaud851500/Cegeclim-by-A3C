-- ============================================================================
-- 20261119d_piliers_odj_confidentiel_redacteur.sql — Réunion Piliers (19/11/2026)
-- ----------------------------------------------------------------------------
-- - Sujet : confidentiel (pastille 🔒), propose_par (qui l'a mis à l'ODJ),
--   nouvelle nature « expose » (sujet à exposer).
-- - Réunion : rédacteur (rédige et clôture).
-- Appliquée en production le 19/11/2026.
-- ============================================================================
alter table public.piliers_sujets
  add column if not exists confidentiel boolean not null default false,
  add column if not exists propose_par uuid references public.piliers_membres(id) on delete set null;
alter table public.piliers_sujets drop constraint if exists piliers_sujets_nature_check;
alter table public.piliers_sujets add constraint piliers_sujets_nature_check check (nature in ('info', 'expose', 'question', 'decision', 'action', 'projet'));
comment on column public.piliers_sujets.confidentiel is 'Sujet confidentiel (pastille 🔒, exclu de la communication aux équipes).';
comment on column public.piliers_sujets.propose_par is 'Membre qui a mis le sujet à l''ordre du jour (pastille).';

update public.piliers_sujets s set propose_par = m.id
from public.piliers_membres m
where s.propose_par is null and s.origine <> 'meteo' and m.email is not null and lower(m.email) = lower(s.created_by);
update public.piliers_sujets s set propose_par = p.membre_id
from public.piliers_sujet_porteurs p
where s.propose_par is null and s.origine = 'meteo' and p.sujet_id = s.id and p.role = 'pilote';

alter table public.piliers_reunions add column if not exists redacteur_id uuid references public.piliers_membres(id) on delete set null;
comment on column public.piliers_reunions.redacteur_id is 'Rédacteur de la réunion : rédige et clôture.';
