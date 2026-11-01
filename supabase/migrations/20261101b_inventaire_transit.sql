-- ============================================================================
-- 20261101b_inventaire_transit.sql — Stock en transit dans l'inventaire (01/11/2026)
-- ----------------------------------------------------------------------------
-- Les transferts FMS → agence sortent de FMS vers un dépôt SAGE « TRANSIT <agence> »
-- (stock_agence_depots.depot_transit_num) et n'entrent dans le dépôt de l'agence qu'à
-- la réception. Le jour de l'inventaire, ce stock est physiquement à l'agence (ou
-- devrait l'être) mais n'apparaît pas dans son stock SAGE.
--
-- Désormais la liste d'un dépôt inclut (option par défaut) les lignes de son dépôt
-- transit, dans une section « En transit », comptées par l'agence :
--   - inventaire_lignes.transit = true, depot_stock / depot_stock_libelle = dépôt
--     SAGE du transit (l'écart se passe sur ce dépôt dans l'export SAGE) ;
--   - une même référence peut donc figurer deux fois (agence + transit) ;
--   - « TRANSIT FMS » (n° 12) rattaché au dépôt central FMS.
-- ============================================================================

update public.stock_agence_depots set depot_transit_num = '12'
where depot_num = '3' and depot_transit_num is null
  and exists (select 1 from sage.stock_depot where sto_dep_num = '12');

alter table public.inventaire_depots
  add column if not exists inclure_transit boolean not null default true,
  add column if not exists depot_transit_num text;

alter table public.inventaire_lignes
  add column if not exists transit boolean not null default false,
  add column if not exists depot_stock text,
  add column if not exists depot_stock_libelle text;

update public.inventaire_lignes l
set depot_stock = d.depot_num, depot_stock_libelle = d.depot_libelle
from public.inventaire_depots d
where d.id = l.inv_depot_id and l.depot_stock is null;

update public.inventaire_depots d
set depot_transit_num = s.depot_transit_num
from public.stock_agence_depots s
where s.depot_num = d.depot_num and d.depot_transit_num is null;

alter table public.inventaire_lignes drop constraint if exists inventaire_lignes_inv_depot_id_reference_key;
alter table public.inventaire_lignes drop constraint if exists inventaire_lignes_depot_ref_transit_key;
alter table public.inventaire_lignes add constraint inventaire_lignes_depot_ref_transit_key unique (inv_depot_id, reference, transit);

-- Chargement : dépôt + dépôt transit (si demandé) ----------------------------------
create or replace function public.inv_charger_lignes(p_inv_depot_id uuid, p_reference text default null)
returns integer
language plpgsql security definer
set search_path to 'public', 'sage'
as $$
declare
  d public.inventaire_depots%rowtype;
  v_n integer;
  v_transit text;
  v_transit_lib text;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  v_transit := case when d.inclure_transit and p_reference is null then nullif(trim(d.depot_transit_num), '') end;
  if v_transit is not null then
    select trim(max(sd.sto_dep)) into v_transit_lib from sage.stock_depot sd where sd.sto_dep_num = v_transit;
  end if;

  with src as (
    select trim(sd.sto_art_num) as ref, coalesce(sd.sto_dep_num = v_transit, false) as transit,
           sum(sd.sto_qte) as qte, sum(sd.sto_montant) as mt
    from sage.stock_depot sd
    where (sd.sto_dep_num = d.depot_num or (v_transit is not null and sd.sto_dep_num = v_transit))
      and (p_reference is null or upper(trim(sd.sto_art_num)) = upper(trim(p_reference)))
    group by 1, 2
  ),
  cible as (
    select coalesce(s.ref, a.reference_article) as ref, coalesce(s.transit, false) as transit,
           coalesce(s.qte, 0) as qte, coalesce(s.mt, 0) as mt
    from src s
    full join (select r.reference_article from public.ref_articles r
               where p_reference is not null and upper(trim(r.reference_article)) = upper(trim(p_reference))) a
      on a.reference_article = s.ref and not s.transit
  ),
  glob as (
    select trim(sd.sto_art_num) as ref,
           sum(sd.sto_montant) filter (where sd.sto_qte > 0 and sd.sto_montant > 0) as mt,
           sum(sd.sto_qte)     filter (where sd.sto_qte > 0 and sd.sto_montant > 0) as q
    from sage.stock_depot sd
    where trim(sd.sto_art_num) in (select ref from cible)
    group by 1
  ),
  afr as (
    select distinct on (trim(af.ar_ref)) trim(af.ar_ref) as ref, af.af_reffourniss, af.af_prixach
    from sage.article_fournisseur af
    where trim(af.ar_ref) in (select ref from cible)
    order by trim(af.ar_ref), (af.af_principal = '1') desc, af.id
  ),
  lignes as (
    select c.ref, c.transit, c.qte,
           nullif(trim(afr.af_reffourniss), '') as ref_fournisseur,
           r.designation, r.famille, f.famille_macro, r.fournisseur_principal,
           (select max(t.ti_intitule) from sage.tiers t where t.ti_num = r.fournisseur_principal) as fournisseur_nom,
           case
             when c.qte > 0 and c.mt > 0 then round(c.mt / c.qte, 4)
             when g.q > 0 then round(g.mt / g.q, 4)
             when coalesce(afr.af_prixach, 0) > 0 then afr.af_prixach
             when coalesce(r.prix_achat, 0) > 0 then r.prix_achat
             else 0
           end as pump,
           case
             when c.qte > 0 and c.mt > 0 then 'depot'
             when g.q > 0 then 'tous_depots'
             when coalesce(afr.af_prixach, 0) > 0 then 'prix_fournisseur'
             when coalesce(r.prix_achat, 0) > 0 then 'prix_achat'
             else 'aucun'
           end as pump_source
    from cible c
    left join public.ref_articles r on r.reference_article = c.ref
    left join public.ref_familles f on f.famille = r.famille
    left join glob g on g.ref = c.ref
    left join afr on afr.ref = c.ref
    where p_reference is not null
       or ((c.qte <> 0 or (d.inclure_stock_nul and not c.transit))
           and (cardinality(d.familles_macro) = 0 or f.famille_macro = any (d.familles_macro))
           and (cardinality(d.familles) = 0 or r.famille = any (d.familles))
           and (cardinality(d.fournisseurs) = 0 or r.fournisseur_principal = any (d.fournisseurs)))
  ),
  ins as (
    insert into public.inventaire_lignes as il
      (inv_depot_id, reference, transit, depot_stock, depot_stock_libelle, ref_fournisseur, designation, famille, famille_macro,
       fournisseur, fournisseur_nom, qte_theorique, pump, pump_source, hors_liste)
    select p_inv_depot_id, l.ref, l.transit,
           case when l.transit then v_transit else d.depot_num end,
           case when l.transit then coalesce(v_transit_lib, 'TRANSIT') else d.depot_libelle end,
           l.ref_fournisseur, l.designation, l.famille, l.famille_macro,
           l.fournisseur_principal, l.fournisseur_nom, l.qte, l.pump, l.pump_source, p_reference is not null
    from lignes l
    on conflict (inv_depot_id, reference, transit) do update
      set qte_theorique   = excluded.qte_theorique,
          pump            = excluded.pump,
          pump_source     = excluded.pump_source,
          depot_stock     = excluded.depot_stock,
          depot_stock_libelle = excluded.depot_stock_libelle,
          ref_fournisseur = excluded.ref_fournisseur,
          designation     = excluded.designation,
          famille         = excluded.famille,
          famille_macro   = excluded.famille_macro,
          fournisseur     = excluded.fournisseur,
          fournisseur_nom = excluded.fournisseur_nom
    returning 1
  )
  select count(*) into v_n from ins;

  if p_reference is null then
    -- Lignes déjà présentes hors du périmètre chargé : stock du jour de leur dépôt (souvent 0).
    update public.inventaire_lignes il
    set qte_theorique = coalesce((select sum(sd.sto_qte) from sage.stock_depot sd
                                  where sd.sto_dep_num = il.depot_stock and trim(sd.sto_art_num) = il.reference), 0)
    where il.inv_depot_id = p_inv_depot_id
      and not exists (
        select 1 from sage.stock_depot sd
        join public.ref_articles r on r.reference_article = trim(sd.sto_art_num)
        left join public.ref_familles f on f.famille = r.famille
        where sd.sto_dep_num = il.depot_stock and trim(sd.sto_art_num) = il.reference
          and (sd.sto_qte <> 0 or (d.inclure_stock_nul and not il.transit))
          and (cardinality(d.familles_macro) = 0 or f.famille_macro = any (d.familles_macro))
          and (cardinality(d.familles) = 0 or r.famille = any (d.familles))
          and (cardinality(d.fournisseurs) = 0 or r.fournisseur_principal = any (d.fournisseurs)));

    update public.inventaire_depots
    set stock_sage_le   = (select max(sd.loaded_at) from sage.stock_depot sd where sd.sto_dep_num = d.depot_num),
        stock_charge_le = now()
    where id = p_inv_depot_id;
  end if;

  return v_n;
end $$;
revoke all on function public.inv_charger_lignes(uuid, text) from public, anon, authenticated;

-- Préparation : option « inclure le transit » ------------------------------------
drop function if exists public.inv_depots_preparer(uuid, text[], text[], text[], text[], boolean);
create or replace function public.inv_depots_preparer(
  p_campagne_id uuid, p_depots text[], p_familles_macro text[] default '{}', p_familles text[] default '{}',
  p_fournisseurs text[] default '{}', p_inclure_stock_nul boolean default false, p_inclure_transit boolean default true)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'sage'
set statement_timeout to '120s'
as $$
declare
  v_dep text; v_id uuid; v_statut text; v_n integer; v_nt integer;
  v_res jsonb := '[]'::jsonb;
begin
  perform public.inv_exiger_pilotage();
  if not exists (select 1 from public.inventaire_campagnes where id = p_campagne_id and statut = 'ouverte') then
    raise exception 'Campagne introuvable ou clôturée';
  end if;
  if coalesce(cardinality(p_depots), 0) = 0 then raise exception 'Choisir au moins un dépôt'; end if;

  foreach v_dep in array p_depots loop
    v_id := null; v_statut := null;
    select id, statut into v_id, v_statut from public.inventaire_depots where campagne_id = p_campagne_id and depot_num = v_dep;
    if v_id is not null and v_statut <> 'preparation' then
      v_res := v_res || jsonb_build_object('depot_num', v_dep, 'ok', false, 'message', 'Comptage déjà lancé : liste conservée');
      continue;
    end if;
    if v_id is null then
      insert into public.inventaire_depots (campagne_id, depot_num, depot_libelle, cree_par)
      select p_campagne_id, d.depot_num, trim(d.libelle), public.current_user_email()
      from public.stock_agence_depots d where d.depot_num = v_dep
      returning id into v_id;
      if v_id is null then raise exception 'Dépôt % inconnu', v_dep; end if;
    end if;
    update public.inventaire_depots
    set familles_macro = coalesce(p_familles_macro, '{}'), familles = coalesce(p_familles, '{}'),
        fournisseurs = coalesce(p_fournisseurs, '{}'), inclure_stock_nul = coalesce(p_inclure_stock_nul, false),
        inclure_transit = coalesce(p_inclure_transit, true),
        depot_transit_num = (select s.depot_transit_num from public.stock_agence_depots s where s.depot_num = v_dep)
    where id = v_id;
    delete from public.inventaire_lignes where inv_depot_id = v_id;
    v_n := public.inv_charger_lignes(v_id, null);
    select count(*) into v_nt from public.inventaire_lignes where inv_depot_id = v_id and transit;
    v_res := v_res || jsonb_build_object('depot_num', v_dep, 'ok', true, 'nb_lignes', v_n, 'nb_transit', v_nt);
  end loop;
  return v_res;
end $$;
revoke all on function public.inv_depots_preparer(uuid, text[], text[], text[], text[], boolean, boolean) from public, anon;
grant execute on function public.inv_depots_preparer(uuid, text[], text[], text[], text[], boolean, boolean) to authenticated;

-- JSON : champs transit ------------------------------------------------------------
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
    'q1', l.q1, 'q2', l.q2, 'q3', l.q3, 'com1', l.com1, 'com2', l.com2, 'com3', l.com3)
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

create or replace function public.inv_depot_json(d public.inventaire_depots)
returns jsonb
language sql stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', d.id, 'campagne_id', d.campagne_id, 'depot_num', d.depot_num, 'depot_libelle', d.depot_libelle,
    'familles_macro', to_jsonb(d.familles_macro), 'familles', to_jsonb(d.familles),
    'fournisseurs', to_jsonb(d.fournisseurs), 'inclure_stock_nul', d.inclure_stock_nul,
    'inclure_transit', d.inclure_transit, 'depot_transit_num', d.depot_transit_num,
    'statut', d.statut, 'comptage_courant', d.comptage_courant,
    'stock_sage_le', d.stock_sage_le, 'stock_charge_le', d.stock_charge_le,
    'active_le', d.active_le, 'active_par', d.active_par, 'valide_le', d.valide_le, 'valide_par', d.valide_par,
    'campagne', (select jsonb_build_object('id', c.id, 'libelle', c.libelle, 'date_inventaire', c.date_inventaire,
                   'statut', c.statut) from public.inventaire_campagnes c where c.id = d.campagne_id),
    'comptages', (select coalesce(jsonb_agg(jsonb_build_object(
                    'numero', k.numero, 'initiales', k.initiales, 'statut', k.statut,
                    'lance_le', k.lance_le, 'lance_par', k.lance_par,
                    'termine_le', k.termine_le, 'termine_par', k.termine_par) order by k.numero), '[]'::jsonb)
                  from public.inventaire_comptages k where k.inv_depot_id = d.id)
  );
$$;

-- Ordre : section transit en tête, puis familles ------------------------------------
create or replace function public.inv_depot_pilotage(p_inv_depot_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  return public.inv_depot_json(d) || jsonb_build_object(
    'lignes', (select coalesce(jsonb_agg(public.inv_ligne_json(l, true)
                 order by l.transit desc, l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l where l.inv_depot_id = d.id));
end $$;

create or replace function public.inv_campagne_ecarts(p_campagne_id uuid, p_depot_ids uuid[] default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    select coalesce(jsonb_agg(public.inv_ligne_json(l, true) || jsonb_build_object(
             'inv_depot_id', d.id, 'depot_num', d.depot_num, 'depot_libelle', d.depot_libelle,
             'depot_statut', d.statut)
           order by sad.ordre nulls last, d.depot_num, l.transit desc, l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
    from public.inventaire_lignes l
    join public.inventaire_depots d on d.id = l.inv_depot_id
    left join public.stock_agence_depots sad on sad.depot_num = d.depot_num
    where d.campagne_id = p_campagne_id
      and (p_depot_ids is null or d.id = any (p_depot_ids))
      and public.inv_qte_finale(l) is not null
      and public.inv_qte_finale(l) <> l.qte_theorique
  );
end $$;

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
                 'commentaire', case v_n when 1 then l.com1 when 2 then l.com2 else l.com3 end)
                 order by l.transit desc, l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l
               where l.inv_depot_id = d.id and l.nb_comptages >= v_n));
end $$;

-- Hors liste : toujours sur le dépôt de l'agence ----------------------------------
create or replace function public.inv_ajouter_hors_liste(p_inv_depot_id uuid, p_reference text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'sage'
as $$
declare d public.inventaire_depots%rowtype; v_ref text; l public.inventaire_lignes%rowtype;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> 1 then
    raise exception 'Ajout possible uniquement pendant le 1er comptage';
  end if;
  select r.reference_article into v_ref from public.ref_articles r
  where upper(trim(r.reference_article)) = upper(trim(p_reference)) limit 1;
  if v_ref is null then raise exception 'Référence % inconnue dans SAGE', upper(trim(p_reference)); end if;
  if exists (select 1 from public.inventaire_lignes where inv_depot_id = d.id and reference = v_ref and not transit) then
    raise exception 'La référence % est déjà dans la liste', v_ref;
  end if;
  perform public.inv_charger_lignes(d.id, v_ref);
  select * into l from public.inventaire_lignes where inv_depot_id = d.id and reference = v_ref and not transit;
  return jsonb_build_object(
    'id', l.id, 'reference', l.reference, 'ref_fournisseur', l.ref_fournisseur, 'designation', l.designation,
    'famille', l.famille, 'famille_macro', l.famille_macro, 'qte_theorique', l.qte_theorique, 'pump', l.pump,
    'hors_liste', true, 'transit', false, 'depot_stock', l.depot_stock, 'depot_stock_libelle', l.depot_stock_libelle,
    'qte', null, 'commentaire', null);
end $$;

-- Options de préparation : stock en transit par dépôt --------------------------------
create or replace function public.inv_options_perimetre()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'sage'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    with s as (
      select trim(sd.sto_art_num) as ref, sd.sto_dep_num, sd.sto_qte, sd.sto_montant
      from sage.stock_depot sd
      join public.stock_agence_depots d on d.depot_num = sd.sto_dep_num
      where sd.sto_qte <> 0
    ),
    a as (
      select s.*, r.famille, coalesce(f.famille_macro, 'Sans famille macro') as macro, f.libelle_famille,
             r.fournisseur_principal
      from s
      left join public.ref_articles r on r.reference_article = s.ref
      left join public.ref_familles f on f.famille = r.famille
    ),
    tr as (
      select d.depot_num, trim(max(sd.sto_dep)) as libelle, count(distinct trim(sd.sto_art_num)) as n, round(sum(sd.sto_montant)) as v
      from public.stock_agence_depots d
      join sage.stock_depot sd on sd.sto_dep_num = d.depot_transit_num and sd.sto_qte <> 0
      group by 1
    )
    select jsonb_build_object(
      'familles_macro', (select coalesce(jsonb_agg(jsonb_build_object('code', m.macro, 'nb_refs', m.n, 'valeur', m.v)
                           order by m.macro), '[]'::jsonb)
                         from (select macro, count(distinct ref) n, round(sum(sto_montant)) v from a group by 1) m),
      'familles', (select coalesce(jsonb_agg(jsonb_build_object('code', x.famille, 'libelle', x.lib, 'macro', x.macro,
                     'nb_refs', x.n, 'valeur', x.v) order by x.macro, x.famille), '[]'::jsonb)
                   from (select famille, max(libelle_famille) lib, max(macro) macro, count(distinct ref) n,
                                round(sum(sto_montant)) v
                         from a where famille is not null group by 1) x),
      'fournisseurs', (select coalesce(jsonb_agg(jsonb_build_object('code', x.fournisseur_principal, 'nom', x.nom,
                         'nb_refs', x.n, 'valeur', x.v) order by x.v desc nulls last), '[]'::jsonb)
                       from (select a.fournisseur_principal,
                                    (select max(t.ti_intitule) from sage.tiers t where t.ti_num = a.fournisseur_principal) nom,
                                    count(distinct ref) n, round(sum(sto_montant)) v
                             from a where a.fournisseur_principal is not null group by 1) x),
      'depots', (select coalesce(jsonb_agg(jsonb_build_object('depot_num', x.sto_dep_num, 'nb_refs', x.n, 'valeur', x.v,
                   'transit_libelle', tr.libelle, 'transit_nb_refs', tr.n, 'transit_valeur', tr.v)), '[]'::jsonb)
                 from (select sto_dep_num, count(distinct ref) n, round(sum(sto_montant)) v from a group by 1) x
                 left join tr on tr.depot_num = x.sto_dep_num)
    )
  );
end $$;

-- Suivi : nombre de lignes transit ---------------------------------------------------
create or replace function public.inv_campagne_suivi(p_campagne_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    select coalesce(jsonb_agg(public.inv_depot_json(d) || jsonb_build_object(
      'nb_lignes', s.nb_lignes, 'nb_hors_liste', s.nb_hors_liste, 'nb_transit', s.nb_transit,
      'valeur_transit', s.valeur_transit,
      'nb_a_compter', s.nb_a_compter, 'nb_saisies', s.nb_saisies,
      'valeur_theorique', s.valeur_theorique,
      'nb_ecarts', s.nb_ecarts, 'nb_ecarts_a_decider', s.nb_ecarts_a_decider,
      'nb_valides', s.nb_valides, 'nb_refuses', s.nb_refuses,
      'valeur_ecart_plus', s.v_plus, 'valeur_ecart_moins', s.v_moins,
      'valeur_ecart_net', s.v_net, 'valeur_validee_net', s.v_valide)
      order by sad.ordre nulls last, d.depot_num), '[]'::jsonb)
    from public.inventaire_depots d
    left join public.stock_agence_depots sad on sad.depot_num = d.depot_num
    cross join lateral (
      select count(*) as nb_lignes,
             count(*) filter (where l.hors_liste) as nb_hors_liste,
             count(*) filter (where l.transit) as nb_transit,
             round(coalesce(sum(l.qte_theorique * l.pump) filter (where l.transit), 0), 2) as valeur_transit,
             count(*) filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant) as nb_a_compter,
             count(*) filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant
                                and case d.comptage_courant when 1 then l.q1 when 2 then l.q2 else l.q3 end is not null) as nb_saisies,
             round(coalesce(sum(l.qte_theorique * l.pump), 0), 2) as valeur_theorique,
             count(*) filter (where f.q is not null and f.q <> l.qte_theorique) as nb_ecarts,
             count(*) filter (where f.q is not null and f.q <> l.qte_theorique and l.decision is null
                                and not (d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant)) as nb_ecarts_a_decider,
             count(*) filter (where l.decision = 'valide' and f.q <> l.qte_theorique) as nb_valides,
             count(*) filter (where l.decision = 'refuse' and f.q <> l.qte_theorique) as nb_refuses,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q > l.qte_theorique), 0), 2) as v_plus,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q < l.qte_theorique), 0), 2) as v_moins,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q is not null), 0), 2) as v_net,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where l.decision = 'valide'), 0), 2) as v_valide
      from public.inventaire_lignes l
      cross join lateral (select public.inv_qte_finale(l) as q) f
      where l.inv_depot_id = d.id
    ) s
    where d.campagne_id = p_campagne_id
  );
end $$;
