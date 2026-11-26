-- Inventaire V2 — saisies PAR ÉQUIPE, cumulées par ligne (26/11/2026, demandé par Arnaud)
-- ---------------------------------------------------------------------------
-- Un même article peut se trouver dans plusieurs zones du magasin et être compté par
-- plusieurs équipes. Jusqu'ici la saisie à l'écran remplaçait la quantité de la ligne
-- (l'équipe B écrasait le comptage de l'équipe A) ; seule l'intégration des feuilles
-- scannées proposait le cumul.
--
-- Nouveau modèle :
--   inventaire_saisies = une quantité (et un commentaire) par ligne, par comptage et par
--   équipe. La quantité du comptage sur la ligne (q1 / q2 / q3) est la SOMME des équipes ;
--   ini1/2/3 = équipes ayant compté la ligne (« AV/LD + PJ/YV ») ; com1/2/3 = commentaires.
--   inv_saisir_equipe(…, p_mode) : 'remplacer' (la quantité de cette équipe, correction),
--   'ajouter' (cumul pour cette équipe, intégration des feuilles), 'remplacer_tout' (efface
--   les autres équipes de la ligne) ; même contrôles que inv_saisir + verrou optionnel sur
--   le total vu par l'utilisateur.
--
-- Compatibilité avec l'écran V1 (/stock/inventaire/saisie) pendant le test de la V2 :
--   q1/2/3, ini1/2/3, com1/2/3 restent tenus à jour (pilotage, écarts, fin de comptage,
--   PDF inchangés) ; inv_saisir (V1) remplace la ligne par UNE saisie de son équipe
--   (même comportement qu'avant : la quantité saisie remplace le total).
--   inv_saisie_liste renvoie en plus « saisies » : le détail par équipe du comptage en cours.

create table if not exists public.inventaire_saisies (
  id          bigserial primary key,
  ligne_id    bigint not null references public.inventaire_lignes(id) on delete cascade,
  numero      integer not null check (numero between 1 and 3),
  equipe      text not null,
  qte         numeric,
  commentaire text,
  saisi_le    timestamptz not null default now(),
  saisi_par   text,
  unique (ligne_id, numero, equipe)
);
create index if not exists idx_inventaire_saisies_ligne on public.inventaire_saisies (ligne_id, numero);
alter table public.inventaire_saisies enable row level security;
revoke all on public.inventaire_saisies from anon, authenticated;

-- Reprise des saisies existantes : une saisie par ligne et par comptage, équipe de la ligne.
insert into public.inventaire_saisies (ligne_id, numero, equipe, qte, commentaire, saisi_le, saisi_par)
select l.id, n.numero, coalesce(nullif(n.ini, ''), '?'), n.q, n.com, coalesce(n.le, now()), n.par
from public.inventaire_lignes l
cross join lateral (values (1, l.q1, l.com1, l.ini1, l.saisi1_le, l.saisi1_par),
                           (2, l.q2, l.com2, l.ini2, l.saisi2_le, l.saisi2_par),
                           (3, l.q3, l.com3, l.ini3, l.saisi3_le, l.saisi3_par)) n(numero, q, com, ini, le, par)
where (n.q is not null or n.com is not null)
on conflict (ligne_id, numero, equipe) do nothing;

-- Total d'une ligne pour un comptage = somme des équipes.
create or replace function public.inv_recalculer_ligne(p_ligne_id bigint, p_numero integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_qte numeric; v_ini text; v_com text; v_le timestamptz; v_par text; v_nb integer;
begin
  select case when count(s.qte) = 0 then null else sum(s.qte) end,
         string_agg(s.equipe, ' + ' order by s.saisi_le, s.id),
         count(*), max(s.saisi_le)
    into v_qte, v_ini, v_nb, v_le
  from public.inventaire_saisies s where s.ligne_id = p_ligne_id and s.numero = p_numero;
  select case when v_nb > 1
              then string_agg(s.equipe || ' : ' || s.commentaire, ' · ' order by s.saisi_le, s.id) filter (where s.commentaire is not null)
              else max(s.commentaire) end
    into v_com
  from public.inventaire_saisies s where s.ligne_id = p_ligne_id and s.numero = p_numero;
  select s.saisi_par into v_par from public.inventaire_saisies s
  where s.ligne_id = p_ligne_id and s.numero = p_numero order by s.saisi_le desc, s.id desc limit 1;
  v_com := left(v_com, 500);
  if p_numero = 1 then
    update public.inventaire_lignes set q1 = v_qte, com1 = v_com, ini1 = v_ini, saisi1_le = coalesce(v_le, now()), saisi1_par = v_par where id = p_ligne_id;
  elsif p_numero = 2 then
    update public.inventaire_lignes set q2 = v_qte, com2 = v_com, ini2 = v_ini, saisi2_le = coalesce(v_le, now()), saisi2_par = v_par where id = p_ligne_id;
  else
    update public.inventaire_lignes set q3 = v_qte, com3 = v_com, ini3 = v_ini, saisi3_le = coalesce(v_le, now()), saisi3_par = v_par where id = p_ligne_id;
  end if;
end $$;
revoke all on function public.inv_recalculer_ligne(bigint, integer) from public, anon, authenticated;

create or replace function public.inv_saisies_json(p_ligne_id bigint, p_numero integer)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('equipe', s.equipe, 'qte', s.qte, 'commentaire', s.commentaire, 'saisi_le', s.saisi_le)
                            order by s.saisi_le, s.id), '[]'::jsonb)
  from public.inventaire_saisies s where s.ligne_id = p_ligne_id and s.numero = p_numero;
$$;
revoke all on function public.inv_saisies_json(bigint, integer) from public, anon, authenticated;

-- Saisie V2 : la quantité d'UNE équipe sur une ligne.
create or replace function public.inv_saisir_equipe(
  p_ligne_id bigint, p_numero integer, p_equipe text, p_qte numeric, p_commentaire text,
  p_mode text default 'remplacer', p_verifier_avant boolean default false, p_qte_avant numeric default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  l public.inventaire_lignes%rowtype; d public.inventaire_depots%rowtype;
  v_com text := nullif(trim(p_commentaire), ''); v_ini text; v_prec text; v_actuelle numeric;
  s public.inventaire_saisies%rowtype;
begin
  if p_mode not in ('remplacer', 'ajouter', 'remplacer_tout') then raise exception 'Mode de saisie inconnu : %', p_mode; end if;
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

  v_actuelle := case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end;
  if coalesce(p_verifier_avant, false) and v_actuelle is distinct from p_qte_avant then
    raise exception 'MODIFIEE_ENTRE_TEMPS: % a été saisie entre-temps (% par %) : revue à refaire',
      l.reference, coalesce(v_actuelle::text, 'vide'),
      coalesce(case p_numero when 1 then l.ini1 when 2 then l.ini2 else l.ini3 end, '?');
  end if;

  v_ini := public.inv_valider_initiales(p_equipe);
  v_prec := case p_numero when 2 then l.ini1 when 3 then concat_ws('/', l.ini1, l.ini2) else null end;
  if v_prec is not null and public.inv_initiales_membres(v_ini) && public.inv_initiales_membres(v_prec) then
    raise exception '% : déjà comptée par % au comptage précédent, une autre équipe doit la recompter',
      l.reference, array_to_string(array(select unnest(public.inv_initiales_membres(v_ini)) intersect select unnest(public.inv_initiales_membres(v_prec))), '/');
  end if;

  if p_mode = 'remplacer_tout' then
    delete from public.inventaire_saisies where ligne_id = l.id and numero = p_numero and equipe <> v_ini;
  end if;
  select * into s from public.inventaire_saisies where ligne_id = l.id and numero = p_numero and equipe = v_ini;

  if p_mode = 'ajouter' and found then
    update public.inventaire_saisies
    set qte = case when p_qte is null then qte else coalesce(qte, 0) + p_qte end,
        commentaire = left(nullif(concat_ws(' · ', commentaire, v_com), ''), 500),
        saisi_le = now(), saisi_par = public.current_user_email()
    where id = s.id;
  elsif p_qte is null and v_com is null then
    -- Saisie vidée : l'équipe n'a plus de comptage sur cette ligne.
    delete from public.inventaire_saisies where ligne_id = l.id and numero = p_numero and equipe = v_ini;
  else
    insert into public.inventaire_saisies (ligne_id, numero, equipe, qte, commentaire, saisi_le, saisi_par)
    values (l.id, p_numero, v_ini, p_qte, v_com, now(), public.current_user_email())
    on conflict (ligne_id, numero, equipe) do update
      set qte = excluded.qte, commentaire = excluded.commentaire, saisi_le = excluded.saisi_le, saisi_par = excluded.saisi_par;
  end if;

  perform public.inv_recalculer_ligne(l.id, p_numero);
  if exists (select 1 from public.inventaire_saisies where ligne_id = l.id and numero = p_numero and equipe = v_ini) then
    perform public.inv_comptage_maj_equipes(d.id, p_numero, v_ini);
  end if;
  select * into l from public.inventaire_lignes where id = l.id;
  return jsonb_build_object(
    'id', l.id, 'equipe', v_ini,
    'qte', case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end,
    'commentaire', case p_numero when 1 then l.com1 when 2 then l.com2 else l.com3 end,
    'initiales', case p_numero when 1 then l.ini1 when 2 then l.ini2 else l.ini3 end,
    'saisies', public.inv_saisies_json(l.id, p_numero));
end $$;
revoke all on function public.inv_saisir_equipe(bigint, integer, text, numeric, text, text, boolean, numeric) from public, anon;
grant execute on function public.inv_saisir_equipe(bigint, integer, text, numeric, text, text, boolean, numeric) to authenticated;

-- V1 : la quantité saisie remplace le total de la ligne → une seule saisie, celle de l'équipe.
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
  delete from public.inventaire_saisies where ligne_id = l.id and numero = p_numero;
  if not v_vide then
    insert into public.inventaire_saisies (ligne_id, numero, equipe, qte, commentaire, saisi_le, saisi_par)
    values (l.id, p_numero, v_ini, p_qte, v_com, now(), public.current_user_email());
  end if;
  perform public.inv_recalculer_ligne(l.id, p_numero);
  if not v_vide then perform public.inv_comptage_maj_equipes(d.id, p_numero, v_ini); end if;
  return jsonb_build_object('id', l.id, 'qte', p_qte, 'commentaire', v_com, 'initiales', case when v_vide then null else v_ini end);
end $$;
revoke all on function public.inv_saisir(bigint, integer, numeric, text, text, boolean, numeric) from public, anon;
grant execute on function public.inv_saisir(bigint, integer, numeric, text, text, boolean, numeric) to authenticated;

-- Liste de saisie : + détail des saisies par équipe du comptage en cours.
create or replace function public.inv_saisie_liste(p_inv_depot_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_n integer;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found or d.statut = 'preparation' then raise exception 'Inventaire non disponible'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  v_n := greatest(d.comptage_courant, 1);
  return public.inv_depot_json(d) || jsonb_build_object(
    'numero', v_n,
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', l.id, 'reference', l.reference, 'ref_fournisseur', l.ref_fournisseur,
                 'designation', l.designation, 'famille', l.famille, 'famille_macro', l.famille_macro,
                 'qte_theorique', l.qte_theorique, 'pump', l.pump, 'hors_liste', l.hors_liste,
                 'transit', l.transit, 'depot_stock', l.depot_stock, 'depot_stock_libelle', l.depot_stock_libelle,
                 'qte', case v_n when 1 then l.q1 when 2 then l.q2 else l.q3 end,
                 'commentaire', case v_n when 1 then l.com1 when 2 then l.com2 else l.com3 end,
                 'initiales', case v_n when 1 then l.ini1 when 2 then l.ini2 else l.ini3 end,
                 'equipes_prec', case v_n when 2 then l.ini1 when 3 then concat_ws('/', l.ini1, l.ini2) else null end,
                 'saisies', (select coalesce(jsonb_agg(jsonb_build_object('equipe', s.equipe, 'qte', s.qte, 'commentaire', s.commentaire, 'saisi_le', s.saisi_le)
                                                       order by s.saisi_le, s.id), '[]'::jsonb)
                             from public.inventaire_saisies s where s.ligne_id = l.id and s.numero = v_n))
                 order by l.transit desc, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l
               where l.inv_depot_id = d.id and l.nb_comptages >= v_n));
end $$;
revoke all on function public.inv_saisie_liste(uuid) from public, anon;
grant execute on function public.inv_saisie_liste(uuid) to authenticated;

notify pgrst, 'reload schema';
