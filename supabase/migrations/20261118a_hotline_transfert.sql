-- ============================================================================
-- 20261118a_hotline_transfert.sql — Soleil : « Transférer le ticket vers »
-- ----------------------------------------------------------------------------
-- (18/11/2026, retours de Jean LABARRÈRE validés par Arnaud) La reprise du
-- traitement (date + action + tâche) est remplacée, en Soleil, par un
-- transfert facultatif du ticket à un collaborateur : étape TRANSFERT, le
-- ticket lui est assigné et il reçoit l'alerte du bandeau violet.
-- ============================================================================

alter table public.hotline_ticket_etapes drop constraint if exists hotline_ticket_etapes_type_check;
alter table public.hotline_ticket_etapes add constraint hotline_ticket_etapes_type_check
  check (type in ('OUVERTURE', 'IDENTIFICATION', 'NOTE_RAPIDE', 'QUESTION', 'DOCUMENT', 'COMMENTAIRE', 'COMMENTAIRE_INTERNE',
                  'ESCALADE', 'REDESCENTE', 'RAPPEL', 'REPRISE', 'TRANSFERT', 'PRECONISATION', 'RESOLUTION', 'CLOTURE',
                  'REOUVERTURE', 'PIECE_JOINTE', 'DEMANDE_PIECE'));

alter table public.hotline_notifications drop constraint if exists hotline_notifications_type_check;
alter table public.hotline_notifications add constraint hotline_notifications_type_check
  check (type in ('ESCALADE', 'REDESCENTE', 'RAPPEL', 'TRANSFERT'));

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
  if new.type not in ('ESCALADE', 'REDESCENTE', 'RAPPEL', 'TRANSFERT') or new.details is null then
    return new;
  end if;
  v_dest := lower(nullif(btrim(coalesce(
    case when new.type = 'RAPPEL' then new.details->>'rappel_par' else new.details->>'destinataire' end, '')), ''));
  if v_dest is null or v_dest = lower(coalesce(new.auteur, '')) then
    return new;
  end if;
  select coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)) into v_nom
  from public.user_page_access u where lower(u.email) = lower(new.auteur) limit 1;

  update public.hotline_notifications set seen_at = now()
  where ticket_id = new.ticket_id and lower(recipient_email) = v_dest and seen_at is null;

  insert into public.hotline_notifications (ticket_id, etape_id, type, niveau, recipient_email, auteur_email, auteur_nom, message)
  values (new.ticket_id, new.id, new.type, nullif(new.details->>'niveau', '')::smallint, v_dest, new.auteur,
          coalesce(v_nom, split_part(coalesce(new.auteur, ''), '@', 1)), new.libelle);
  return new;
end
$$;
