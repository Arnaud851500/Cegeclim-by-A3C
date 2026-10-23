-- ============================================================================
-- 20261023f_actualites_refs_alerte_dispo.sql  (appliquée en production le 23/10/2026)
-- Pastille « ⚠ Alerte dispo » : une publication du fil d'actu signale des
-- références (refs_alerte) ; tant qu'elle est publiée, l'écran Stock (Compagnon
-- mobile) affiche une pastille sur ces références qui ouvre la publication.
-- Visibilité = RLS du lecteur sur actualites (publiée, diffusée, ciblage).
-- ============================================================================
alter table public.actualites add column if not exists refs_alerte text[] not null default '{}';
create index if not exists idx_actualites_refs_alerte on public.actualites using gin (refs_alerte);
comment on column public.actualites.refs_alerte is 'Références qui portent une pastille « Alerte dispo » (écran Stock, PC et Compagnon) pointant vers cette publication, tant qu''elle est publiée.';

create or replace function public.get_alertes_dispo_refs(p_refs text[], p_plateforme text default null)
returns table (reference_article text, actualite_id uuid, titre text, resume text, date_diffusion timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (r.ref) r.ref, a.id, a.titre, a.resume, a.date_diffusion
  from unnest(p_refs) as r(ref)
  join public.actualites a on r.ref = any(a.refs_alerte)
  where a.statut = 'publie'
    and a.date_diffusion <= now()
    and (p_plateforme is null or a.plateformes is null or p_plateforme = any(a.plateformes))
  order by r.ref, a.date_diffusion desc
$$;
grant execute on function public.get_alertes_dispo_refs(text[], text) to authenticated;
