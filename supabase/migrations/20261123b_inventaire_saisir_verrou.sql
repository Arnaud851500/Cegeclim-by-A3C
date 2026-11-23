-- Inventaire — verrou de concurrence sur inv_saisir (23/11/2026, demandé par Arnaud)
-- ---------------------------------------------------------------------------
-- Cas constaté : ligne 16222 comptée 17 par AV/LD (1re intégration de feuilles), puis
-- 1 par PL/XV (2e intégration dans la même fenêtre, image de liste périmée) : le 1 a
-- écrasé le 17 sans alerte au lieu d'être proposé en cumul.
-- inv_saisir accepte désormais p_verifier_avant / p_qte_avant : quand p_verifier_avant
-- est vrai, l'écriture est refusée si la quantité en base pour ce comptage n'est plus
-- p_qte_avant (null = « ligne vide »). L'intégration des feuilles scannées l'utilise
-- systématiquement ; la saisie à l'écran reste inchangée (paramètres absents).

drop function if exists public.inv_saisir(bigint, integer, numeric, text, text);
create or replace function public.inv_saisir(
  p_ligne_id bigint, p_numero integer, p_qte numeric, p_commentaire text,
  p_initiales text default null, p_verifier_avant boolean default false, p_qte_avant numeric default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  l public.inventaire_lignes%rowtype; d public.inventaire_depots%rowtype;
  v_com text := nullif(trim(p_commentaire), ''); v_ini text; v_k text; v_prec text; v_vide boolean; v_actuelle numeric;
begin
  select * into l from public.inventaire_lignes where id = p_ligne_id for update;
  if not found then raise exception 'Ligne introuvable'; end if;
  select * into d from public.inventaire_depots where id = l.inv_depot_id;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> p_numero
     or not exists (select 1 from public.inventaire_comptages k where k.inv_depot_id = d.id
                    and k.numero = p_numero and k.statut = 'en_cours') then
    raise exception 'Ce comptage est clôturé : la saisie n''est plus modifiable';
  end if;
  if l.nb_comptages < p_numero then raise exception 'Cette ligne n''est pas à recompter'; end if;
  if p_qte is not null and p_qte < 0 then raise exception 'Quantité négative impossible'; end if;

  -- Verrou : la ligne doit être dans l'état vu par l'utilisateur au moment de sa validation.
  v_actuelle := case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end;
  if coalesce(p_verifier_avant, false) and v_actuelle is distinct from p_qte_avant then
    raise exception 'MODIFIEE_ENTRE_TEMPS: % a été saisie entre-temps (% par %) : revue à refaire',
      l.reference, coalesce(v_actuelle::text, 'vide'),
      coalesce(case p_numero when 1 then l.ini1 when 2 then l.ini2 else l.ini3 end, '?');
  end if;

  if nullif(trim(coalesce(p_initiales, '')), '') is null then
    select k.initiales into v_k from public.inventaire_comptages k where k.inv_depot_id = d.id and k.numero = p_numero;
    if v_k is not null and position(',' in v_k) = 0 then p_initiales := v_k; end if;
  end if;
  v_ini := public.inv_valider_initiales(p_initiales);

  v_prec := case p_numero when 2 then l.ini1 when 3 then concat_ws('/', l.ini1, l.ini2) else null end;
  if v_prec is not null and public.inv_initiales_membres(v_ini) && public.inv_initiales_membres(v_prec) then
    raise exception '% : déjà comptée par % au comptage précédent, une autre équipe doit la recompter',
      l.reference, array_to_string(array(select unnest(public.inv_initiales_membres(v_ini)) intersect select unnest(public.inv_initiales_membres(v_prec))), '/');
  end if;

  v_vide := p_qte is null and v_com is null;
  if p_numero = 1 then
    update public.inventaire_lignes set q1 = p_qte, com1 = v_com, ini1 = case when v_vide then null else v_ini end,
      saisi1_le = now(), saisi1_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  elsif p_numero = 2 then
    update public.inventaire_lignes set q2 = p_qte, com2 = v_com, ini2 = case when v_vide then null else v_ini end,
      saisi2_le = now(), saisi2_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  else
    update public.inventaire_lignes set q3 = p_qte, com3 = v_com, ini3 = case when v_vide then null else v_ini end,
      saisi3_le = now(), saisi3_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  end if;
  if not v_vide then perform public.inv_comptage_maj_equipes(d.id, p_numero, v_ini); end if;
  return jsonb_build_object('id', l.id, 'qte', p_qte, 'commentaire', v_com, 'initiales', case when v_vide then null else v_ini end);
end $$;

revoke all on function public.inv_saisir(bigint, integer, numeric, text, text, boolean, numeric) from public, anon;
grant execute on function public.inv_saisir(bigint, integer, numeric, text, text, boolean, numeric) to authenticated;

notify pgrst, 'reload schema';
