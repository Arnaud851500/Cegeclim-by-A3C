-- ============================================================================
-- 20261112f_hiparts_reserver.sql — Copie immédiate d'un modèle Hi-Parts (12/11/2026)
-- Réservation atomique d'éléments précis de la file hiparts_file, utilisée par
-- /api/hiparts/modele (copierModeleHiParts) : un élément déjà pris par le cron
-- (EN_COURS dont le verrou court encore) ou déjà FAIT n'est pas repris.
-- ============================================================================
create or replace function public.hiparts_reserver(p_ids bigint[])
returns setof public.hiparts_file
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.hiparts_file f set statut = 'EN_COURS', verrou_jusqua = now() + interval '5 minutes', essais = f.essais + 1
  where f.id in (
    select id from public.hiparts_file
    where id = any(p_ids)
      and (statut in ('A_FAIRE', 'ERREUR') or (statut = 'EN_COURS' and verrou_jusqua < now()))
    for update skip locked
  )
  returning f.*;
end $$;
revoke all on function public.hiparts_reserver(bigint[]) from public, anon, authenticated;
grant execute on function public.hiparts_reserver(bigint[]) to service_role;
