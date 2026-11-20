-- Inventaire — plusieurs équipes de comptage par dépôt (20/11/2026, demandé par Arnaud)
-- ---------------------------------------------------------------------------
-- Une liste par dépôt peut compter des centaines de références et être comptée par
-- plusieurs équipes en même temps (tablettes) ou sur papier puis saisie feuille par feuille.
--
--  1. Les initiales sont portées PAR LIGNE et PAR COMPTAGE (ini1 / ini2 / ini3) : chaque
--     saisie enregistre les initiales de l'équipe qui a compté la ligne. L'écran de saisie
--     garde les initiales de l'équipe sur chaque tablette (elles ne sont plus partagées) et
--     on peut les changer à tout moment (saisie de feuilles papier d'équipes différentes).
--  2. Une équipe = 1 à 3 inventoristes, séparés par « / » (ex. PJC/AV), 2 à 5 lettres
--     chacun. Saisies « PJC AV », « PJC+AV », « pjc-av » normalisées en « PJC/AV ».
--  3. Règle « initiales différentes d'un comptage à l'autre » appliquée PAR LIGNE : pour
--     recompter une ligne, aucun inventoriste ne doit l'avoir déjà comptée à un comptage
--     précédent (le 2e comptage peut donc être fait par l'équipe B sur les lignes de A).
--  4. inventaire_comptages.initiales = liste des équipes ayant saisi le comptage
--     (« RD, PJC/AV »), tenue à jour automatiquement, pour l'affichage pilotage.
--  5. inv_saisir prend un 5e paramètre p_initiales (défaut null = initiales du comptage
--     si une seule équipe, pour les écrans encore ouverts sur l'ancienne version).
-- ---------------------------------------------------------------------------

alter table public.inventaire_lignes
  add column if not exists ini1 text,
  add column if not exists ini2 text,
  add column if not exists ini3 text;

-- Normalisation : membres séparés par tout caractère non alphabétique, joints par « / ».
create or replace function public.inv_normaliser_initiales(p text)
returns text
language sql immutable
as $$
  select nullif(array_to_string(array(
    select upper(m) from regexp_split_to_table(coalesce(p, ''), '[^A-Za-zÀ-ÿ]+') with ordinality t(m, o)
    where m <> '' order by o), '/'), '');
$$;

create or replace function public.inv_initiales_membres(p text)
returns text[]
language sql immutable
as $$ select coalesce(string_to_array(public.inv_normaliser_initiales(p), '/'), '{}'::text[]); $$;

-- Contrôle du format ; renvoie les initiales normalisées.
create or replace function public.inv_valider_initiales(p text)
returns text
language plpgsql immutable
as $$
declare v text := public.inv_normaliser_initiales(p); m text[] := public.inv_initiales_membres(p); x text;
begin
  if v is null then raise exception 'Saisir d''abord les initiales de l''équipe de comptage'; end if;
  if array_length(m, 1) > 3 then raise exception 'Équipe de comptage : 3 inventoristes au maximum (ex. PJC/AV)'; end if;
  foreach x in array m loop
    if length(x) < 2 or length(x) > 5 then
      raise exception 'Initiales « % » : 2 à 5 lettres par inventoriste, séparer deux inventoristes par « / » (ex. PJC/AV)', x;
    end if;
  end loop;
  return v;
end $$;

-- Reprise : les lignes déjà saisies prennent les initiales de leur comptage.
update public.inventaire_lignes l set ini1 = public.inv_normaliser_initiales(k.initiales)
from public.inventaire_comptages k
where k.inv_depot_id = l.inv_depot_id and k.numero = 1 and l.q1 is not null and l.ini1 is null and k.initiales is not null;
update public.inventaire_lignes l set ini2 = public.inv_normaliser_initiales(k.initiales)
from public.inventaire_comptages k
where k.inv_depot_id = l.inv_depot_id and k.numero = 2 and l.q2 is not null and l.ini2 is null and k.initiales is not null;
update public.inventaire_lignes l set ini3 = public.inv_normaliser_initiales(k.initiales)
from public.inventaire_comptages k
where k.inv_depot_id = l.inv_depot_id and k.numero = 3 and l.q3 is not null and l.ini3 is null and k.initiales is not null;

-- Liste des équipes d'un comptage, dans l'ordre de première saisie (inventaire_comptages.initiales).
create or replace function public.inv_comptage_maj_equipes(p_inv_depot_id uuid, p_numero integer, p_ajout text default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v text;
begin
  select initiales into v from public.inventaire_comptages where inv_depot_id = p_inv_depot_id and numero = p_numero;
  if p_ajout is null then return; end if;
  if v is null or v = '' then v := p_ajout;
  elsif not (p_ajout = any (string_to_array(v, ', '))) then v := v || ', ' || p_ajout;
  else return;
  end if;
  update public.inventaire_comptages set initiales = v where inv_depot_id = p_inv_depot_id and numero = p_numero;
end $$;
revoke all on function public.inv_comptage_maj_equipes(uuid, integer, text) from public, anon, authenticated;

-- Déclaration d'une équipe sur une tablette : contrôle du format, enregistrement dans la
-- liste des équipes du comptage. Plus de contrôle global entre comptages (fait par ligne).
create or replace function public.inv_comptage_initiales(p_inv_depot_id uuid, p_numero integer, p_initiales text)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_ini text;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> p_numero then
    raise exception 'Ce comptage n''est pas ouvert à la saisie';
  end if;
  v_ini := public.inv_valider_initiales(p_initiales);
  return v_ini;
end $$;

-- Saisie d'une ligne par une équipe.
drop function if exists public.inv_saisir(bigint, integer, numeric, text);
create or replace function public.inv_saisir(p_ligne_id bigint, p_numero integer, p_qte numeric, p_commentaire text, p_initiales text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  l public.inventaire_lignes%rowtype; d public.inventaire_depots%rowtype;
  v_com text := nullif(trim(p_commentaire), ''); v_ini text; v_k text; v_prec text; v_vide boolean;
begin
  select * into l from public.inventaire_lignes where id = p_ligne_id;
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

  -- Équipe : celle de la tablette ; à défaut (ancien écran), l'équipe unique du comptage.
  if nullif(trim(coalesce(p_initiales, '')), '') is null then
    select k.initiales into v_k from public.inventaire_comptages k where k.inv_depot_id = d.id and k.numero = p_numero;
    if v_k is not null and position(',' in v_k) = 0 then p_initiales := v_k; end if;
  end if;
  v_ini := public.inv_valider_initiales(p_initiales);

  -- Initiales différentes d'un comptage à l'autre, ligne par ligne.
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

-- Fin du comptage : toutes les lignes saisies, chacune avec son équipe.
create or replace function public.inv_comptage_terminer(p_inv_depot_id uuid, p_numero integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_manque integer; v_sans_ini integer;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> p_numero then
    raise exception 'Ce comptage n''est pas en cours';
  end if;
  select count(*) filter (where case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end is null),
         count(*) filter (where case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end is not null
                            and case p_numero when 1 then l.ini1 when 2 then l.ini2 else l.ini3 end is null)
    into v_manque, v_sans_ini
  from public.inventaire_lignes l
  where l.inv_depot_id = d.id and l.nb_comptages >= p_numero;
  if v_manque > 0 then
    raise exception '% ligne(s) sans quantité : toutes les lignes doivent être saisies', v_manque;
  end if;
  if v_sans_ini > 0 then
    raise exception '% ligne(s) saisie(s) sans initiales d''équipe : les ressaisir', v_sans_ini;
  end if;
  update public.inventaire_comptages
  set statut = 'termine', termine_le = now(), termine_par = public.current_user_email()
  where inv_depot_id = d.id and numero = p_numero;
  update public.inventaire_depots set statut = 'analyse' where id = d.id;
end $$;

-- JSON pilotage : équipes par comptage.
create or replace function public.inv_ligne_json(l public.inventaire_lignes, p_pilote boolean)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'id', l.id, 'reference', l.reference, 'ref_fournisseur', l.ref_fournisseur, 'designation', l.designation,
    'famille', l.famille, 'famille_macro', l.famille_macro, 'fournisseur', l.fournisseur,
    'fournisseur_nom', l.fournisseur_nom, 'qte_theorique', l.qte_theorique, 'pump', l.pump,
    'pump_source', l.pump_source, 'hors_liste', l.hors_liste, 'nb_comptages', l.nb_comptages,
    'transit', l.transit, 'depot_stock', l.depot_stock, 'depot_stock_libelle', l.depot_stock_libelle,
    'q1', l.q1, 'q2', l.q2, 'q3', l.q3, 'com1', l.com1, 'com2', l.com2, 'com3', l.com3,
    'ini1', l.ini1, 'ini2', l.ini2, 'ini3', l.ini3)
  || case when p_pilote then jsonb_build_object(
    'saisi1_par', l.saisi1_par, 'saisi1_le', l.saisi1_le, 'saisi2_par', l.saisi2_par, 'saisi2_le', l.saisi2_le,
    'saisi3_par', l.saisi3_par, 'saisi3_le', l.saisi3_le,
    'qte_finale', public.inv_qte_finale(l),
    'ecart', public.inv_qte_finale(l) - l.qte_theorique,
    'valeur_ecart', round((public.inv_qte_finale(l) - l.qte_theorique) * l.pump, 2),
    'decision', l.decision, 'decision_commentaire', l.decision_commentaire,
    'decision_le', l.decision_le, 'decision_par', l.decision_par)
  else '{}'::jsonb end;
$$;

-- Liste de saisie : équipe de la ligne pour le comptage en cours + équipes des comptages
-- précédents (sans leurs quantités : le comptage reste à l'aveugle).
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
                 'equipes_prec', case v_n when 2 then l.ini1 when 3 then concat_ws('/', l.ini1, l.ini2) else null end)
                 order by l.transit desc, l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l
               where l.inv_depot_id = d.id and l.nb_comptages >= v_n));
end $$;

revoke all on function public.inv_saisir(bigint, integer, numeric, text, text) from public, anon;
grant execute on function public.inv_saisir(bigint, integer, numeric, text, text) to authenticated;
revoke all on function public.inv_comptage_initiales(uuid, integer, text) from public, anon;
grant execute on function public.inv_comptage_initiales(uuid, integer, text) to authenticated;
revoke all on function public.inv_comptage_terminer(uuid, integer) from public, anon;
grant execute on function public.inv_comptage_terminer(uuid, integer) to authenticated;
revoke all on function public.inv_saisie_liste(uuid) from public, anon;
grant execute on function public.inv_saisie_liste(uuid) to authenticated;

notify pgrst, 'reload schema';
