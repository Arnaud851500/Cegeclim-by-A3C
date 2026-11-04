-- ============================================================================
-- 20261104b_hotline_suppression_ticket.sql — Hotline technique (04/11/2026)
-- Suppression définitive d'un ticket (tests), réservée au compte d'Arnaud
-- (valancha@gmail.com, a.valanchauskas@cegeclim-energies.com). Supprime le ticket, sa chronologie et ses pièces
-- jointes (cascade) et les demandes de pièces rattachées. Renvoie les chemins
-- des fichiers du bucket hotline-pieces, que l'écran retire ensuite du stockage.
-- ============================================================================

create or replace function public.hotline_supprimer_ticket(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_numero text;
  v_chemins jsonb;
begin
  if lower(coalesce(public.current_user_email(), '')) not in ('valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com') then
    raise exception 'Suppression de ticket réservée à l''administrateur de la hotline.';
  end if;
  select numero into v_numero from public.hotline_tickets where id = p_ticket;
  if v_numero is null then
    raise exception 'Ticket introuvable.';
  end if;
  select coalesce(jsonb_agg(chemin), '[]'::jsonb) into v_chemins from public.hotline_ticket_pieces where ticket_id = p_ticket;
  delete from public.hotline_demandes_pieces where ticket_id = p_ticket;
  delete from public.hotline_tickets where id = p_ticket;
  return jsonb_build_object('numero', v_numero, 'chemins', v_chemins);
end
$function$;

revoke all on function public.hotline_supprimer_ticket(uuid) from public, anon;
grant execute on function public.hotline_supprimer_ticket(uuid) to authenticated;

notify pgrst, 'reload schema';
