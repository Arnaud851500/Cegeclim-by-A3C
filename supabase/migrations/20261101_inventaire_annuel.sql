-- ============================================================================
-- 20261101_inventaire_annuel.sql — Inventaire de fin d'année par dépôt (01/11/2026)
-- ----------------------------------------------------------------------------
-- Écrans :
--   /stock/inventaire          pilotage achats (droit can_appro ou can_autorisation)
--   /stock/inventaire/saisie   saisie en agence (can_stocks, dépôt de l'agence de
--                              l'utilisateur ; périmètre vide = tous les dépôts)
--
-- Déroulé :
--   1. Les achats créent une campagne (ex. « Inventaire fin d'année 2026 », 28/11)
--      et préparent les listes dépôt par dépôt : familles macro, familles et
--      fournisseurs (ET entre les critères, OU à l'intérieur ; vide = tout).
--      La liste est une photo du stock SAGE (quantité et PUMP du dépôt).
--   2. « Activer » ouvre le 1er comptage en agence. Tant que le 1er comptage n'est
--      pas terminé, le stock théorique peut être rafraîchi (dernière synchro SAGE)
--      sans perdre les saisies.
--   3. L'agence saisit ses initiales (obligatoires, différentes d'un comptage à
--      l'autre), les quantités et un commentaire. « Fin du comptage » n'est possible
--      que quand toutes les lignes sont saisies ; la saisie est alors verrouillée.
--   4. Les achats voient les écarts (dernier comptage − stock théorique, valorisés
--      au PUMP) et, ligne par ligne : valident l'écart, le refusent (l'écart n'est
--      pas passé), ou envoient les lignes en 2e puis 3e comptage.
--   5. Quand chaque écart a une décision, le dépôt est validé ; les écarts validés
--      s'exportent en Excel pour créer le document dans SAGE.
--
-- Sécurité : tables sous RLS sans policy (aucun accès direct), tout passe par les
-- fonctions SECURITY DEFINER ci-dessous, qui contrôlent le droit et le dépôt.
-- PUMP : sto_montant / sto_qte du dépôt ; à défaut CMUP tous dépôts, puis prix
-- d'achat du fournisseur principal, puis prix d'achat article.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------
create table if not exists public.inventaire_campagnes (
  id              uuid primary key default gen_random_uuid(),
  libelle         text not null,
  date_inventaire date not null,
  statut          text not null default 'ouverte' check (statut in ('ouverte', 'cloturee')),
  commentaire     text,
  cree_le         timestamptz not null default now(),
  cree_par        text
);

create table if not exists public.inventaire_depots (
  id                uuid primary key default gen_random_uuid(),
  campagne_id       uuid not null references public.inventaire_campagnes(id) on delete cascade,
  depot_num         text not null,
  depot_libelle     text not null,
  familles_macro    text[] not null default '{}',
  familles          text[] not null default '{}',
  fournisseurs      text[] not null default '{}',
  inclure_stock_nul boolean not null default false,
  statut            text not null default 'preparation'
                    check (statut in ('preparation', 'comptage', 'analyse', 'valide')),
  comptage_courant  integer not null default 0 check (comptage_courant between 0 and 3),
  stock_sage_le     timestamptz,  -- loaded_at SAGE du stock théorique
  stock_charge_le   timestamptz,  -- moment où la photo a été prise
  cree_le           timestamptz not null default now(),
  cree_par          text,
  active_le         timestamptz,
  active_par        text,
  valide_le         timestamptz,
  valide_par        text,
  unique (campagne_id, depot_num)
);

create table if not exists public.inventaire_comptages (
  inv_depot_id uuid not null references public.inventaire_depots(id) on delete cascade,
  numero       integer not null check (numero between 1 and 3),
  initiales    text,
  statut       text not null default 'en_cours' check (statut in ('en_cours', 'termine')),
  lance_le     timestamptz not null default now(),
  lance_par    text,
  termine_le   timestamptz,
  termine_par  text,
  primary key (inv_depot_id, numero)
);

create table if not exists public.inventaire_lignes (
  id                   bigint generated always as identity primary key,
  inv_depot_id         uuid not null references public.inventaire_depots(id) on delete cascade,
  reference            text not null,
  ref_fournisseur      text,
  designation          text,
  famille              text,
  famille_macro        text,
  fournisseur          text,
  fournisseur_nom      text,
  qte_theorique        numeric not null default 0,
  pump                 numeric not null default 0,
  pump_source          text,
  hors_liste           boolean not null default false,
  nb_comptages         integer not null default 1 check (nb_comptages between 1 and 3),
  q1 numeric, q2 numeric, q3 numeric,
  com1 text, com2 text, com3 text,
  saisi1_le timestamptz, saisi1_par text,
  saisi2_le timestamptz, saisi2_par text,
  saisi3_le timestamptz, saisi3_par text,
  decision             text check (decision in ('valide', 'refuse')),
  decision_commentaire text,
  decision_le          timestamptz,
  decision_par         text,
  unique (inv_depot_id, reference)
);

create index if not exists idx_inventaire_lignes_depot on public.inventaire_lignes (inv_depot_id);
create index if not exists idx_inventaire_depots_campagne on public.inventaire_depots (campagne_id);

alter table public.inventaire_campagnes enable row level security;
alter table public.inventaire_depots    enable row level security;
alter table public.inventaire_comptages enable row level security;
alter table public.inventaire_lignes    enable row level security;
revoke all on public.inventaire_campagnes, public.inventaire_depots,
              public.inventaire_comptages, public.inventaire_lignes from anon, authenticated;

-- 2. Droits ------------------------------------------------------------------
create or replace function public.inv_peut_piloter()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_page_access u
    where u.email = public.current_user_email()
      and (coalesce(u.can_appro, false) or coalesce(u.can_autorisation, false))
  );
$$;

-- Dépôts de l'utilisateur : null = pas de restriction d'agence ; sinon les dépôts
-- (FMS compris) dont le nom correspond à une agence du périmètre (MEES → DAX).
create or replace function public.inv_depots_utilisateur()
returns text[]
language sql stable security definer
set search_path to 'public'
as $$
  with u as (
    select coalesce(u.allowed_agences, '{}'::text[]) as ag
    from public.user_page_access u
    where u.email = public.current_user_email()
    limit 1
  ),
  ag as (
    select distinct case when x = 'MEES' then 'DAX' else x end as a
    from u cross join unnest(u.ag) t
    cross join lateral (select upper(replace(trim(t), ' ', '')) as x) n
    where nullif(trim(t), '') is not null
  )
  select case
    when not exists (select 1 from ag) then null
    else coalesce(array(
      select d.depot_num from public.stock_agence_depots d
      where upper(replace(replace(d.libelle, 'CEGECLIM', ''), ' ', '')) in (select a from ag)
      order by d.ordre
    ), '{}'::text[])
  end;
$$;

create or replace function public.inv_peut_saisir(p_depot_num text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.inv_peut_piloter()
      or exists (
        select 1 from public.user_page_access u
        where u.email = public.current_user_email()
          and coalesce(u.can_stocks, false)
          and (public.inv_depots_utilisateur() is null
               or p_depot_num = any (public.inv_depots_utilisateur()))
      );
$$;

create or replace function public.inv_exiger_pilotage()
returns void
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.inv_peut_piloter() then
    raise exception 'Réservé aux achats (droit Appro)' using errcode = '42501';
  end if;
end $$;

-- 3. Calculs de ligne ----------------------------------------------------------
-- Quantité du dernier comptage demandé pour la ligne (null = pas encore saisie).
create or replace function public.inv_qte_finale(l public.inventaire_lignes)
returns numeric
language sql immutable
as $$
  select case l.nb_comptages when 3 then l.q3 when 2 then l.q2 else l.q1 end;
$$;

-- 4. Chargement des lignes (photo du stock SAGE) ---------------------------------
-- p_reference renseignée : charge cette seule référence, hors périmètre (article
-- trouvé en rayon mais absent de la liste). Sinon : upsert du périmètre complet,
-- en conservant les saisies ; les lignes sorties du stock passent à 0.
create or replace function public.inv_charger_lignes(p_inv_depot_id uuid, p_reference text default null)
returns integer
language plpgsql security definer
set search_path to 'public', 'sage'
as $$
declare
  d public.inventaire_depots%rowtype;
  v_n integer;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;

  with src as (
    select trim(sd.sto_art_num) as ref, sum(sd.sto_qte) as qte, sum(sd.sto_montant) as mt
    from sage.stock_depot sd
    where sd.sto_dep_num = d.depot_num
      and (p_reference is null or upper(trim(sd.sto_art_num)) = upper(trim(p_reference)))
    group by 1
  ),
  cible as (
    select coalesce(s.ref, a.reference_article) as ref, coalesce(s.qte, 0) as qte, coalesce(s.mt, 0) as mt
    from src s
    full join (select r.reference_article from public.ref_articles r
               where p_reference is not null and upper(trim(r.reference_article)) = upper(trim(p_reference))) a
      on a.reference_article = s.ref
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
    select c.ref, c.qte,
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
       or ((c.qte <> 0 or d.inclure_stock_nul)
           and (cardinality(d.familles_macro) = 0 or f.famille_macro = any (d.familles_macro))
           and (cardinality(d.familles) = 0 or r.famille = any (d.familles))
           and (cardinality(d.fournisseurs) = 0 or r.fournisseur_principal = any (d.fournisseurs)))
  ),
  ins as (
    insert into public.inventaire_lignes as il
      (inv_depot_id, reference, ref_fournisseur, designation, famille, famille_macro,
       fournisseur, fournisseur_nom, qte_theorique, pump, pump_source, hors_liste)
    select p_inv_depot_id, l.ref, l.ref_fournisseur, l.designation, l.famille, l.famille_macro,
           l.fournisseur_principal, l.fournisseur_nom, l.qte, l.pump, l.pump_source, p_reference is not null
    from lignes l
    on conflict (inv_depot_id, reference) do update
      set qte_theorique   = excluded.qte_theorique,
          pump            = excluded.pump,
          pump_source     = excluded.pump_source,
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
    -- Lignes déjà présentes qui ne sont plus dans le périmètre chargé : stock du jour (souvent 0).
    update public.inventaire_lignes il
    set qte_theorique = coalesce((select sum(sd.sto_qte) from sage.stock_depot sd
                                  where sd.sto_dep_num = d.depot_num and trim(sd.sto_art_num) = il.reference), 0)
    where il.inv_depot_id = p_inv_depot_id
      and not exists (
        select 1 from sage.stock_depot sd
        join public.ref_articles r on r.reference_article = trim(sd.sto_art_num)
        left join public.ref_familles f on f.famille = r.famille
        where sd.sto_dep_num = d.depot_num and trim(sd.sto_art_num) = il.reference
          and (sd.sto_qte <> 0 or d.inclure_stock_nul)
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

-- 5. Contexte et options ---------------------------------------------------------
create or replace function public.inv_contexte()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'email', public.current_user_email(),
    'peut_piloter', public.inv_peut_piloter(),
    'depots_utilisateur', to_jsonb(public.inv_depots_utilisateur()),
    'depots', (select coalesce(jsonb_agg(jsonb_build_object(
                 'depot_num', d.depot_num, 'libelle', trim(d.libelle), 'nom_court', d.nom_court,
                 'central', d.central) order by d.ordre), '[]'::jsonb)
               from public.stock_agence_depots d),
    'campagnes', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'libelle', c.libelle, 'date_inventaire', c.date_inventaire,
                    'statut', c.statut, 'commentaire', c.commentaire,
                    'nb_depots', (select count(*) from public.inventaire_depots x where x.campagne_id = c.id))
                    order by c.date_inventaire desc, c.cree_le desc), '[]'::jsonb)
                  from public.inventaire_campagnes c)
  );
$$;

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
      'depots', (select coalesce(jsonb_agg(jsonb_build_object('depot_num', x.sto_dep_num, 'nb_refs', x.n, 'valeur', x.v)), '[]'::jsonb)
                 from (select sto_dep_num, count(distinct ref) n, round(sum(sto_montant)) v from a group by 1) x)
    )
  );
end $$;

-- 6. Pilotage : campagnes et préparation des listes ------------------------------
create or replace function public.inv_campagne_enregistrer(
  p_id uuid, p_libelle text, p_date date, p_statut text default 'ouverte', p_commentaire text default null)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  perform public.inv_exiger_pilotage();
  if nullif(trim(p_libelle), '') is null or p_date is null then
    raise exception 'Libellé et date d''inventaire obligatoires';
  end if;
  if p_id is null then
    insert into public.inventaire_campagnes (libelle, date_inventaire, statut, commentaire, cree_par)
    values (trim(p_libelle), p_date, coalesce(p_statut, 'ouverte'), nullif(trim(p_commentaire), ''), public.current_user_email())
    returning id into v_id;
  else
    update public.inventaire_campagnes
    set libelle = trim(p_libelle), date_inventaire = p_date, statut = coalesce(p_statut, statut),
        commentaire = nullif(trim(p_commentaire), '')
    where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Campagne introuvable'; end if;
  end if;
  return v_id;
end $$;

-- Prépare (ou re-prépare) les listes des dépôts choisis avec le périmètre donné.
-- Un dépôt dont le comptage a déjà commencé est laissé tel quel.
create or replace function public.inv_depots_preparer(
  p_campagne_id uuid, p_depots text[], p_familles_macro text[] default '{}', p_familles text[] default '{}',
  p_fournisseurs text[] default '{}', p_inclure_stock_nul boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'sage'
set statement_timeout to '120s'
as $$
declare
  v_dep text;
  v_id uuid;
  v_statut text;
  v_n integer;
  v_res jsonb := '[]'::jsonb;
begin
  perform public.inv_exiger_pilotage();
  if not exists (select 1 from public.inventaire_campagnes where id = p_campagne_id and statut = 'ouverte') then
    raise exception 'Campagne introuvable ou clôturée';
  end if;
  if coalesce(cardinality(p_depots), 0) = 0 then raise exception 'Choisir au moins un dépôt'; end if;

  foreach v_dep in array p_depots loop
    select id, statut into v_id, v_statut
    from public.inventaire_depots where campagne_id = p_campagne_id and depot_num = v_dep;

    if v_id is not null and v_statut <> 'preparation' then
      v_res := v_res || jsonb_build_object('depot_num', v_dep, 'ok', false,
                 'message', 'Comptage déjà lancé : liste conservée');
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
        fournisseurs = coalesce(p_fournisseurs, '{}'), inclure_stock_nul = coalesce(p_inclure_stock_nul, false)
    where id = v_id;

    delete from public.inventaire_lignes where inv_depot_id = v_id;
    v_n := public.inv_charger_lignes(v_id, null);
    v_res := v_res || jsonb_build_object('depot_num', v_dep, 'ok', true, 'nb_lignes', v_n);
  end loop;
  return v_res;
end $$;

create or replace function public.inv_depot_rafraichir_stock(p_inv_depot_id uuid)
returns integer
language plpgsql security definer
set search_path to 'public', 'sage'
set statement_timeout to '120s'
as $$
declare d public.inventaire_depots%rowtype;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not (d.statut = 'preparation' or (d.statut = 'comptage' and d.comptage_courant = 1)) then
    raise exception 'Le stock théorique ne peut plus être rafraîchi après la fin du 1er comptage';
  end if;
  return public.inv_charger_lignes(p_inv_depot_id, null);
end $$;

create or replace function public.inv_depots_activer(p_ids uuid[])
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare v_n integer := 0; v_id uuid;
begin
  perform public.inv_exiger_pilotage();
  foreach v_id in array coalesce(p_ids, '{}') loop
    if not exists (select 1 from public.inventaire_depots where id = v_id and statut = 'preparation') then continue; end if;
    if not exists (select 1 from public.inventaire_lignes where inv_depot_id = v_id) then
      raise exception 'Liste vide : rien à compter pour ce dépôt';
    end if;
    update public.inventaire_depots
    set statut = 'comptage', comptage_courant = 1, active_le = now(), active_par = public.current_user_email()
    where id = v_id;
    insert into public.inventaire_comptages (inv_depot_id, numero, lance_par)
    values (v_id, 1, public.current_user_email())
    on conflict (inv_depot_id, numero) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Retour en préparation (comptage 1 lancé par erreur, aucune saisie) ou suppression.
create or replace function public.inv_depot_annuler(p_inv_depot_id uuid, p_supprimer boolean default false)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if exists (select 1 from public.inventaire_lignes where inv_depot_id = p_inv_depot_id
             and (q1 is not null or q2 is not null or q3 is not null)) then
    raise exception 'Des quantités ont déjà été saisies : annulation impossible';
  end if;
  if p_supprimer then
    delete from public.inventaire_depots where id = p_inv_depot_id;
  else
    delete from public.inventaire_comptages where inv_depot_id = p_inv_depot_id;
    update public.inventaire_depots
    set statut = 'preparation', comptage_courant = 0, active_le = null, active_par = null
    where id = p_inv_depot_id;
  end if;
end $$;

-- 7. Lecture -----------------------------------------------------------------
create or replace function public.inv_ligne_json(l public.inventaire_lignes, p_pilote boolean)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'id', l.id, 'reference', l.reference, 'ref_fournisseur', l.ref_fournisseur, 'designation', l.designation,
    'famille', l.famille, 'famille_macro', l.famille_macro, 'fournisseur', l.fournisseur,
    'fournisseur_nom', l.fournisseur_nom, 'qte_theorique', l.qte_theorique, 'pump', l.pump,
    'pump_source', l.pump_source, 'hors_liste', l.hors_liste, 'nb_comptages', l.nb_comptages,
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

-- Suivi d'une campagne : une ligne par dépôt avec avancement et écarts.
create or replace function public.inv_campagne_suivi(p_campagne_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    select coalesce(jsonb_agg(public.inv_depot_json(d) || jsonb_build_object(
      'nb_lignes', s.nb_lignes, 'nb_hors_liste', s.nb_hors_liste,
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
                 order by l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l where l.inv_depot_id = d.id));
end $$;

-- Tous les écarts d'une campagne (impression et export SAGE).
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
           order by sad.ordre nulls last, d.depot_num, l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
    from public.inventaire_lignes l
    join public.inventaire_depots d on d.id = l.inv_depot_id
    left join public.stock_agence_depots sad on sad.depot_num = d.depot_num
    where d.campagne_id = p_campagne_id
      and (p_depot_ids is null or d.id = any (p_depot_ids))
      and public.inv_qte_finale(l) is not null
      and public.inv_qte_finale(l) <> l.qte_theorique
  );
end $$;

-- 8. Saisie en agence ------------------------------------------------------------
-- Inventaires visibles par l'utilisateur (dépôts de son agence, campagnes ouvertes).
create or replace function public.inv_saisie_depots()
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(public.inv_depot_json(d) || jsonb_build_object(
           'nb_a_compter', s.nb_a_compter, 'nb_saisies', s.nb_saisies)
         order by c.date_inventaire desc, sad.ordre nulls last), '[]'::jsonb)
  from public.inventaire_depots d
  join public.inventaire_campagnes c on c.id = d.campagne_id and c.statut = 'ouverte'
  left join public.stock_agence_depots sad on sad.depot_num = d.depot_num
  cross join lateral (
    select count(*) filter (where l.nb_comptages >= d.comptage_courant) as nb_a_compter,
           count(*) filter (where l.nb_comptages >= d.comptage_courant
                              and case d.comptage_courant when 1 then l.q1 when 2 then l.q2 else l.q3 end is not null) as nb_saisies
    from public.inventaire_lignes l where l.inv_depot_id = d.id
  ) s
  where d.statut <> 'preparation'
    and public.inv_peut_saisir(d.depot_num);
$$;

-- Liste à compter : lignes du comptage en cours (ou du dernier comptage terminé).
-- Les quantités des comptages précédents ne sont pas renvoyées (comptage à l'aveugle).
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
                 'qte', case v_n when 1 then l.q1 when 2 then l.q2 else l.q3 end,
                 'commentaire', case v_n when 1 then l.com1 when 2 then l.com2 else l.com3 end)
                 order by l.famille_macro nulls last, l.famille nulls last, l.reference), '[]'::jsonb)
               from public.inventaire_lignes l
               where l.inv_depot_id = d.id and l.nb_comptages >= v_n));
end $$;

create or replace function public.inv_normaliser_initiales(p text)
returns text
language sql immutable
as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-zÀ-ÿ]', '', 'g')), ''); $$;

create or replace function public.inv_comptage_initiales(p_inv_depot_id uuid, p_numero integer, p_initiales text)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_ini text; v_autre text;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> p_numero then
    raise exception 'Ce comptage n''est pas ouvert à la saisie';
  end if;
  v_ini := public.inv_normaliser_initiales(p_initiales);
  if v_ini is null or length(v_ini) < 2 or length(v_ini) > 5 then
    raise exception 'Initiales de l''inventoriste : 2 à 5 lettres';
  end if;
  select k.initiales into v_autre from public.inventaire_comptages k
  where k.inv_depot_id = p_inv_depot_id and k.numero <> p_numero
    and public.inv_normaliser_initiales(k.initiales) = v_ini
  limit 1;
  if v_autre is not null then
    raise exception 'Les initiales % ont déjà servi à un autre comptage de ce dépôt : un autre inventoriste doit compter', v_ini;
  end if;
  update public.inventaire_comptages set initiales = v_ini
  where inv_depot_id = p_inv_depot_id and numero = p_numero and statut = 'en_cours';
  return v_ini;
end $$;

create or replace function public.inv_saisir(p_ligne_id bigint, p_numero integer, p_qte numeric, p_commentaire text)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare l public.inventaire_lignes%rowtype; d public.inventaire_depots%rowtype; v_com text := nullif(trim(p_commentaire), '');
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
  if not exists (select 1 from public.inventaire_comptages k where k.inv_depot_id = d.id
                 and k.numero = p_numero and k.initiales is not null) then
    raise exception 'Saisir d''abord les initiales de l''inventoriste';
  end if;
  if l.nb_comptages < p_numero then raise exception 'Cette ligne n''est pas à recompter'; end if;
  if p_qte is not null and p_qte < 0 then raise exception 'Quantité négative impossible'; end if;

  if p_numero = 1 then
    update public.inventaire_lignes set q1 = p_qte, com1 = v_com, saisi1_le = now(), saisi1_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  elsif p_numero = 2 then
    update public.inventaire_lignes set q2 = p_qte, com2 = v_com, saisi2_le = now(), saisi2_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  else
    update public.inventaire_lignes set q3 = p_qte, com3 = v_com, saisi3_le = now(), saisi3_par = public.current_user_email()
    where id = p_ligne_id returning * into l;
  end if;
  return jsonb_build_object('id', l.id, 'qte', p_qte, 'commentaire', v_com);
end $$;

-- Article trouvé en rayon mais absent de la liste (1er comptage uniquement).
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
  if exists (select 1 from public.inventaire_lignes where inv_depot_id = d.id and reference = v_ref) then
    raise exception 'La référence % est déjà dans la liste', v_ref;
  end if;
  perform public.inv_charger_lignes(d.id, v_ref);
  select * into l from public.inventaire_lignes where inv_depot_id = d.id and reference = v_ref;
  return jsonb_build_object(
    'id', l.id, 'reference', l.reference, 'ref_fournisseur', l.ref_fournisseur, 'designation', l.designation,
    'famille', l.famille, 'famille_macro', l.famille_macro, 'qte_theorique', l.qte_theorique, 'pump', l.pump,
    'hors_liste', true, 'qte', null, 'commentaire', null);
end $$;

create or replace function public.inv_comptage_terminer(p_inv_depot_id uuid, p_numero integer)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_manque integer;
begin
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not public.inv_peut_saisir(d.depot_num) then
    raise exception 'Dépôt hors de votre périmètre' using errcode = '42501';
  end if;
  if d.statut <> 'comptage' or d.comptage_courant <> p_numero then
    raise exception 'Ce comptage n''est pas en cours';
  end if;
  if not exists (select 1 from public.inventaire_comptages k where k.inv_depot_id = d.id
                 and k.numero = p_numero and k.initiales is not null) then
    raise exception 'Initiales de l''inventoriste manquantes';
  end if;
  select count(*) into v_manque from public.inventaire_lignes l
  where l.inv_depot_id = d.id and l.nb_comptages >= p_numero
    and case p_numero when 1 then l.q1 when 2 then l.q2 else l.q3 end is null;
  if v_manque > 0 then
    raise exception '% ligne(s) sans quantité : toutes les lignes doivent être saisies', v_manque;
  end if;
  update public.inventaire_comptages
  set statut = 'termine', termine_le = now(), termine_par = public.current_user_email()
  where inv_depot_id = d.id and numero = p_numero;
  update public.inventaire_depots set statut = 'analyse' where id = d.id;
end $$;

-- 9. Décisions des achats --------------------------------------------------------
create or replace function public.inv_comptage_rouvrir(p_inv_depot_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found or d.statut <> 'analyse' then raise exception 'Seul un comptage terminé, en analyse, peut être rouvert'; end if;
  update public.inventaire_comptages set statut = 'en_cours', termine_le = null, termine_par = null
  where inv_depot_id = d.id and numero = d.comptage_courant;
  update public.inventaire_depots set statut = 'comptage' where id = d.id;
end $$;

create or replace function public.inv_recomptage_lancer(p_inv_depot_id uuid, p_lignes bigint[])
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_n integer; v_nb integer;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found or d.statut <> 'analyse' then
    raise exception 'Un recomptage se lance après la fin du comptage en cours';
  end if;
  v_n := d.comptage_courant + 1;
  if v_n > 3 then raise exception 'Le 3e comptage est le dernier : valider ou refuser les écarts'; end if;

  update public.inventaire_lignes
  set nb_comptages = v_n, decision = null, decision_commentaire = null, decision_le = null, decision_par = null
  where inv_depot_id = d.id and id = any (coalesce(p_lignes, '{}')) and nb_comptages = d.comptage_courant;
  get diagnostics v_nb = row_count;
  if v_nb = 0 then raise exception 'Aucune ligne du dernier comptage sélectionnée'; end if;

  insert into public.inventaire_comptages (inv_depot_id, numero, lance_par)
  values (d.id, v_n, public.current_user_email());
  update public.inventaire_depots set statut = 'comptage', comptage_courant = v_n where id = d.id;
  return v_nb;
end $$;

-- p_decision : 'valide' (l'écart sera passé dans SAGE), 'refuse' (non passé), null (annule).
create or replace function public.inv_decider(p_lignes bigint[], p_decision text, p_commentaire text default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare v_nb integer;
begin
  perform public.inv_exiger_pilotage();
  if p_decision is not null and p_decision not in ('valide', 'refuse') then raise exception 'Décision inconnue'; end if;
  if exists (
    select 1 from public.inventaire_lignes l join public.inventaire_depots d on d.id = l.inv_depot_id
    where l.id = any (coalesce(p_lignes, '{}'))
      and (d.statut = 'valide' or (d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant))
  ) then
    raise exception 'Certaines lignes sont en cours de recomptage ou dans un dépôt déjà validé';
  end if;
  update public.inventaire_lignes l
  set decision = p_decision,
      decision_commentaire = case when p_decision is null then null else coalesce(nullif(trim(p_commentaire), ''), l.decision_commentaire) end,
      decision_le = case when p_decision is null then null else now() end,
      decision_par = case when p_decision is null then null else public.current_user_email() end
  where l.id = any (coalesce(p_lignes, '{}')) and public.inv_qte_finale(l) is not null;
  get diagnostics v_nb = row_count;
  return v_nb;
end $$;

create or replace function public.inv_depot_valider(p_inv_depot_id uuid, p_valider boolean default true)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare d public.inventaire_depots%rowtype; v_reste integer;
begin
  perform public.inv_exiger_pilotage();
  select * into d from public.inventaire_depots where id = p_inv_depot_id;
  if not found then raise exception 'Inventaire de dépôt introuvable'; end if;
  if not p_valider then
    if d.statut <> 'valide' then raise exception 'Ce dépôt n''est pas validé'; end if;
    update public.inventaire_depots set statut = 'analyse', valide_le = null, valide_par = null where id = d.id;
    return;
  end if;
  if d.statut <> 'analyse' then raise exception 'Le dépôt doit avoir un comptage terminé, sans recomptage en cours'; end if;
  select count(*) into v_reste from public.inventaire_lignes l
  where l.inv_depot_id = d.id and public.inv_qte_finale(l) <> l.qte_theorique and l.decision is null;
  if v_reste > 0 then raise exception '% écart(s) sans décision', v_reste; end if;
  update public.inventaire_depots set statut = 'valide', valide_le = now(), valide_par = public.current_user_email()
  where id = d.id;
end $$;

-- 10. Droits d'exécution -------------------------------------------------------
revoke all on function public.inv_charger_lignes(uuid, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'inv_peut_piloter()', 'inv_depots_utilisateur()', 'inv_peut_saisir(text)', 'inv_contexte()',
    'inv_options_perimetre()', 'inv_campagne_enregistrer(uuid, text, date, text, text)',
    'inv_depots_preparer(uuid, text[], text[], text[], text[], boolean)', 'inv_depot_rafraichir_stock(uuid)',
    'inv_depots_activer(uuid[])', 'inv_depot_annuler(uuid, boolean)', 'inv_campagne_suivi(uuid)',
    'inv_depot_pilotage(uuid)', 'inv_campagne_ecarts(uuid, uuid[])', 'inv_saisie_depots()',
    'inv_saisie_liste(uuid)', 'inv_comptage_initiales(uuid, integer, text)',
    'inv_saisir(bigint, integer, numeric, text)', 'inv_ajouter_hors_liste(uuid, text)',
    'inv_comptage_terminer(uuid, integer)', 'inv_comptage_rouvrir(uuid)',
    'inv_recomptage_lancer(uuid, bigint[])', 'inv_decider(bigint[], text, text)',
    'inv_depot_valider(uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
