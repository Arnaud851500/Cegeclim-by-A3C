-- ============================================================================
-- 20261120a_hotline_compteur_rappels_client.sql — (20/11/2026, demande d'Arnaud)
-- Compteur « le client rappelle » : chaque clic ajoute une étape RAPPEL
-- (details.relance = true) ; le trigger incrémente nb_rappels_client, affiché
-- en pastille sous le statut dans la liste des tickets.
-- ============================================================================

alter table public.hotline_tickets add column if not exists nb_rappels_client integer not null default 0;

-- Reprise des clics déjà faits.
update public.hotline_tickets t
set nb_rappels_client = x.n
from (
  select e.ticket_id, count(*)::int as n
  from public.hotline_ticket_etapes e
  where e.type = 'RAPPEL' and coalesce((e.details ->> 'relance')::boolean, false)
  group by e.ticket_id
) x
where x.ticket_id = t.id and t.nb_rappels_client <> x.n;

create or replace function public.hotline_etape_compter_rappel_client()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.type = 'RAPPEL' and coalesce((new.details ->> 'relance')::boolean, false) then
    update public.hotline_tickets set nb_rappels_client = nb_rappels_client + 1 where id = new.ticket_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_hotline_etape_compter_rappel_client on public.hotline_ticket_etapes;
create trigger trg_hotline_etape_compter_rappel_client
after insert on public.hotline_ticket_etapes
for each row execute function public.hotline_etape_compter_rappel_client();
