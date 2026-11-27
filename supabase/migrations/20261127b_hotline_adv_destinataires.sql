-- ============================================================================
-- 20261127b_hotline_adv_destinataires.sql — (27/11/2026, demande d'Arnaud)
-- L'entrée « ADV » de « Client à rappeler par » est reliée à Pauline A. et
-- Lucie N. : elles reçoivent l'alerte (bandeau violet) et retrouvent ces
-- tickets dans « rappels pour moi ». Liste modifiable dans hotline_parametres
-- (clé adv_destinataires).
-- ============================================================================

insert into public.hotline_parametres (cle, valeur, libelle)
values ('adv_destinataires', '["p.apel@cegeclim-energies.com", "l.nicod@cegeclim-energies.com"]'::jsonb,
        'Collaborateurs ADV qui reçoivent les demandes de rappel « ADV »')
on conflict (cle) do update set valeur = excluded.valeur, libelle = excluded.libelle;

create or replace function public.hotline_adv_destinataires()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(lower(btrim(x))), '{}')
  from public.hotline_parametres p, jsonb_array_elements_text(coalesce(p.valeur, '[]'::jsonb)) x
  where p.cle = 'adv_destinataires' and jsonb_typeof(p.valeur) = 'array';
$$;
grant execute on function public.hotline_adv_destinataires() to authenticated;

create or replace function public.hotline_etape_notifier()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_dest text;
  v_nom text;
  v_liste text[];
  d text;
begin
  if new.type not in ('ESCALADE', 'REDESCENTE', 'RAPPEL', 'TRANSFERT') or new.details is null then
    return new;
  end if;
  v_dest := lower(nullif(btrim(coalesce(
    case when new.type = 'RAPPEL' then new.details->>'rappel_par' else new.details->>'destinataire' end, '')), ''));
  if v_dest is null then
    return new;
  end if;
  -- « ADV » : service, l'alerte va à chacun des collaborateurs ADV paramétrés.
  v_liste := case when v_dest = 'adv' then public.hotline_adv_destinataires() else array[v_dest] end;

  select coalesce(nullif(btrim(u.display_name), ''), split_part(u.email, '@', 1)) into v_nom
  from public.user_page_access u where lower(u.email) = lower(new.auteur) limit 1;

  foreach d in array v_liste loop
    continue when d not like '%@%' or d = lower(coalesce(new.auteur, ''));
    update public.hotline_notifications set seen_at = now()
    where ticket_id = new.ticket_id and lower(recipient_email) = d and seen_at is null;
    insert into public.hotline_notifications (ticket_id, etape_id, type, niveau, recipient_email, auteur_email, auteur_nom, message)
    values (new.ticket_id, new.id, new.type, nullif(new.details->>'niveau', '')::smallint, d, new.auteur,
            coalesce(v_nom, split_part(coalesce(new.auteur, ''), '@', 1)), new.libelle);
  end loop;
  return new;
end
$$;
