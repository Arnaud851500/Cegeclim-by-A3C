-- ============================================================================
-- 20261112h_hotline_notifications.sql — Bandeau violet « ticket hotline confié »
-- (12/11/2026, demande d'Arnaud : même principe que les tâches affectées)
-- ----------------------------------------------------------------------------
-- Quand un ticket est escaladé (ou redescendu) vers un collaborateur, ou qu'un
-- rappel client est confié à un N1, le destinataire voit un bandeau violet en
-- haut de l'écran (components/HotlineAssignmentBanner.tsx), comme pour les
-- tâches (todo_assignment_notifications / TaskAssignmentBanner).
-- Alimentation : trigger sur hotline_ticket_etapes (types ESCALADE, REDESCENTE,
-- RAPPEL) dont details porte destinataire / rappel_par ; pas d'alerte quand on
-- se confie le ticket à soi-même.
-- ============================================================================

create table if not exists public.hotline_notifications (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references public.hotline_tickets(id) on delete cascade,
  etape_id         bigint,
  type             text not null check (type in ('ESCALADE', 'REDESCENTE', 'RAPPEL')),
  niveau           smallint,
  recipient_email  text not null,
  auteur_email     text,
  auteur_nom       text,
  message          text,
  created_at       timestamptz not null default now(),
  seen_at          timestamptz
);
create index if not exists hotline_notifications_dest_idx on public.hotline_notifications (lower(recipient_email)) where seen_at is null;

alter table public.hotline_notifications enable row level security;
drop policy if exists hotline_notifications_select_own on public.hotline_notifications;
create policy hotline_notifications_select_own on public.hotline_notifications
  for select to authenticated using (lower(recipient_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.hotline_etape_notifier()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_dest text;
  v_nom text;
begin
  if new.type not in ('ESCALADE', 'REDESCENTE', 'RAPPEL') or new.details is null then
    return new;
  end if;
  v_dest := lower(nullif(btrim(coalesce(
    case when new.type = 'RAPPEL' then new.details->>'rappel_par' else new.details->>'destinataire' end, '')), ''));
  if v_dest is null or v_dest = lower(coalesce(new.auteur, '')) then
    return new;
  end if;
  select coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)) into v_nom
  from public.user_page_access u where lower(u.email) = lower(new.auteur) limit 1;

  -- une seule alerte non vue par ticket et destinataire : la plus récente remplace l'ancienne
  update public.hotline_notifications set seen_at = now()
  where ticket_id = new.ticket_id and lower(recipient_email) = v_dest and seen_at is null;

  insert into public.hotline_notifications (ticket_id, etape_id, type, niveau, recipient_email, auteur_email, auteur_nom, message)
  values (new.ticket_id, new.id, new.type, nullif(new.details->>'niveau', '')::smallint, v_dest, new.auteur,
          coalesce(v_nom, split_part(coalesce(new.auteur, ''), '@', 1)), new.libelle);
  return new;
end
$$;

drop trigger if exists trg_hotline_etape_notifier on public.hotline_ticket_etapes;
create trigger trg_hotline_etape_notifier
after insert on public.hotline_ticket_etapes
for each row execute function public.hotline_etape_notifier();

create or replace function public.get_mes_alertes_hotline()
returns table (
  id uuid, ticket_id uuid, numero text, type text, niveau smallint, statut text, filiere text,
  intitule_tiers text, numero_tiers text, description text, auteur_nom text, auteur_email text,
  message text, created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.ticket_id, t.numero, n.type, coalesce(n.niveau, t.niveau), t.statut, t.filiere,
         t.intitule_tiers, t.numero_tiers, left(t.description, 300), n.auteur_nom, n.auteur_email,
         n.message, n.created_at
    from public.hotline_notifications n
    join public.hotline_tickets t on t.id = n.ticket_id
   where lower(n.recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and n.seen_at is null
     and t.statut <> 'RESOLU'
   order by n.created_at desc
   limit 30;
$$;

create or replace function public.marquer_alertes_hotline_vues(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n integer;
begin
  update public.hotline_notifications n
     set seen_at = now()
   where lower(n.recipient_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and n.seen_at is null
     and (p_ids is null or n.id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

grant execute on function public.get_mes_alertes_hotline() to authenticated;
grant execute on function public.marquer_alertes_hotline_vues(uuid[]) to authenticated;
