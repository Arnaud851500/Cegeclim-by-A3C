-- Suivi prospect (statut + commentaire) : enregistrement par les commerciaux
-- Contexte : la seule policy d'écriture sur public.clients (clients_write_admin)
-- réserve l'UPDATE aux utilisateurs can_autorisation / can_change_scope.
-- Pour les commerciaux (profils TCI/TCS), l'update était filtré à 0 ligne sans
-- erreur : l'écran affichait la valeur puis la perdait au rechargement.
-- Cette fonction n'ouvre que les deux champs de suivi, aux utilisateurs ayant
-- l'écran Prospects / Clients, et uniquement sur leur périmètre de départements.

create or replace function public.save_client_prospect_suivi(
  p_id uuid,
  p_set_status boolean default false,
  p_status text default null,
  p_set_comment boolean default false,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text := public.current_user_email();
  v_admin boolean;
  v_droit boolean;
  v_row public.clients%rowtype;
begin
  if v_email = '' then
    raise exception 'Utilisateur non identifié';
  end if;

  select coalesce(u.can_autorisation, false) or coalesce(p.can_autorisation, false) or coalesce(u.can_change_scope, false),
         coalesce(u.can_carte, p.can_carte, false)
           or coalesce(u.can_suivi_prospects, p.can_suivi_prospects, false)
           or coalesce(u.can_clients, p.can_clients, false)
    into v_admin, v_droit
  from public.user_page_access u
  left join public.access_profiles p on p.id = u.access_profile_id
  where lower(u.email) = v_email
  limit 1;

  if not coalesce(v_admin, false) and not coalesce(v_droit, false) then
    raise exception 'Droit insuffisant pour modifier le suivi prospect';
  end if;

  select * into v_row from public.clients where id = p_id;
  if not found then
    raise exception 'Entreprise introuvable';
  end if;

  if not coalesce(v_admin, false)
     and exists (select 1 from public.my_allowed_departements_set())
     and coalesce(v_row.departement, '') not in (select public.my_allowed_departements_set()) then
    raise exception 'Entreprise hors de votre périmètre';
  end if;

  update public.clients
     set prospect_status  = case when p_set_status  then nullif(trim(p_status), '') else prospect_status end,
         prospect_comment = case when p_set_comment then p_comment else prospect_comment end
   where id = p_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'prospect_status', v_row.prospect_status,
    'prospect_comment', v_row.prospect_comment
  );
end;
$$;

revoke all on function public.save_client_prospect_suivi(uuid, boolean, text, boolean, text) from public, anon;
grant execute on function public.save_client_prospect_suivi(uuid, boolean, text, boolean, text) to authenticated;
