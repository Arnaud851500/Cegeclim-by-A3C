-- =============================================================================
-- 20261119e_tarifs_fournisseurs.sql — Écran « Tarifs fournisseurs »
-- (Stocks & logistique, /stock/tarifs-fournisseurs), demandé par Arnaud le 19/11/2026
-- -----------------------------------------------------------------------------
-- 1. Tarif d'achat actuel par fournisseur, lu dans SAGE :
--      sage.article_fournisseur (prix tarif, remise, réf. fournisseur, prix programmé)
--      sage.tarif_f_qte via v_appro_tarif_qte_fournisseur (paliers quantitatifs)
--      sage.article_bis (coef. et prix de vente, prix d'achat fiche), sage.articles
--    + volumes de l'année glissante (12 mois) :
--      ventes facturées SAGE (facture_lignes)  → base par défaut de la masse d'achat
--      achats reçus (lignes de CDF BLG v_appro_cdf_lignes, en information)
-- 2. Propositions de nouveau tarif (Excel / PDF déposés par les équipes) :
--      tarif_propositions (en-tête) + tarif_proposition_lignes (une ligne par article
--      du fichier, paliers en jsonb [{qte, prix}] triés par quantité croissante),
--      fichier d'origine conservé dans le bucket privé « tarifs-fournisseurs ».
--    Appariement ligne ↔ article SAGE (tarif_apparier) :
--      1) réf. fournisseur SAGE (af_reffourniss) du même fournisseur, normalisée ;
--      2) la même, une fois retirés les marqueurs OBS_ / _OBSOLETE posés dans SAGE ;
--      3) référence article SAGE = référence du fichier ;
--      4) code EAN (af_codebarre / ar_codebarre) ;
--      un appariement manuel (✎ dans l'écran) n'est jamais écrasé.
-- 3. Le calcul des écarts (prix à quantité égale, %, impact € sur la masse
--    annuelle, PV à coef. constant, marge à PV inchangé) est fait dans l'écran.
-- Accès : can_appro ou can_autorisation (tarif_peut_acceder), contrôlé par chaque RPC.
-- =============================================================================

-- Droits ---------------------------------------------------------------------
create or replace function public.tarif_peut_acceder()
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

-- Normalisation des références -------------------------------------------------
create or replace function public.tarif_norm_ref(p text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(upper(coalesce(p, '')), '[\s ]+', '', 'g'), '');
$$;

-- Même chose, marqueurs d'obsolescence SAGE retirés (OBS_9899-099-01, AX3007/1_OBSOLETE, B6021/OBSOLETE…)
create or replace function public.tarif_norm_ref_sans_obs(p text)
returns text
language sql immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(public.tarif_norm_ref(p), '^OBS_', ''),
      '[_/\-]?(OBSOLETE|OBSOLET|OSOLETE)$', ''),
    '');
$$;

-- Tables -----------------------------------------------------------------------
create table if not exists public.tarif_propositions (
  id              bigserial primary key,
  fournisseur     text not null,                 -- n° de tiers SAGE (ct_num)
  fournisseur_nom text,
  libelle         text,
  fichier_nom     text,
  fichier_type    text,                          -- excel | pdf | csv
  fichier_path    text,                          -- chemin dans le bucket tarifs-fournisseurs
  source_import   text,                          -- grille | ia
  date_reception  date default current_date,
  date_effet      date,
  date_fin        date,
  statut          text not null default 'a_analyser'
                  check (statut in ('a_analyser', 'en_negociation', 'acceptee', 'refusee', 'archivee')),
  commentaire     text,
  conditions      jsonb,                         -- conditions lues dans le fichier (franco, règlement…)
  mapping         jsonb,                         -- colonnes retenues à l'import
  resume          jsonb,                         -- synthèse calculée par l'écran (évolution, impact)
  nb_lignes       integer,
  cree_le         timestamptz not null default now(),
  cree_par        text,
  modifie_le      timestamptz,
  modifie_par     text
);
create index if not exists idx_tarif_propositions_fournisseur on public.tarif_propositions (fournisseur, cree_le desc);

create table if not exists public.tarif_proposition_lignes (
  id                  bigserial primary key,
  proposition_id      bigint not null references public.tarif_propositions (id) on delete cascade,
  ligne_no            integer,
  ref_fournisseur     text,
  ean                 text,
  designation         text,
  marque              text,
  gamme               text,
  unite               text,
  prix_public         numeric,
  colisage            numeric,
  qte_palette         numeric,
  paliers             jsonb not null default '[]'::jsonb,  -- [{"qte": 1, "prix": 117.78}, …]
  prix_base           numeric,                              -- prix du plus petit palier
  reference_article   text,                                 -- article SAGE apparié
  appariement         text,                                 -- ref_fournisseur | ref_obsolete | reference | ean | manuel
  nb_candidats        integer,                              -- nb d'articles SAGE possibles
  appariement_manuel  boolean not null default false,
  ignoree             boolean not null default false,
  commentaire         text,
  brut                jsonb
);
create index if not exists idx_tarif_prop_lignes_prop on public.tarif_proposition_lignes (proposition_id);
create index if not exists idx_tarif_prop_lignes_article on public.tarif_proposition_lignes (reference_article);

alter table public.tarif_propositions        enable row level security;
alter table public.tarif_proposition_lignes  enable row level security;
revoke all on public.tarif_propositions, public.tarif_proposition_lignes from anon, authenticated;

-- Bucket des fichiers d'origine -------------------------------------------------
insert into storage.buckets (id, name, public)
values ('tarifs-fournisseurs', 'tarifs-fournisseurs', false)
on conflict (id) do nothing;

drop policy if exists tarifs_fournisseurs_lecture on storage.objects;
create policy tarifs_fournisseurs_lecture on storage.objects
  for select to authenticated
  using (bucket_id = 'tarifs-fournisseurs' and public.tarif_peut_acceder());
drop policy if exists tarifs_fournisseurs_depot on storage.objects;
create policy tarifs_fournisseurs_depot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tarifs-fournisseurs' and public.tarif_peut_acceder());
drop policy if exists tarifs_fournisseurs_suppression on storage.objects;
create policy tarifs_fournisseurs_suppression on storage.objects
  for delete to authenticated
  using (bucket_id = 'tarifs-fournisseurs' and public.tarif_peut_acceder());

-- Appariement ---------------------------------------------------------------------
create or replace function public.tarif_apparier(p_id bigint)
returns integer
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v_frs text;
  v_n integer;
begin
  select upper(trim(fournisseur)) into v_frs from public.tarif_propositions where id = p_id;
  if v_frs is null then
    raise exception 'Proposition % introuvable', p_id;
  end if;

  with af as (
    select upper(trim(f.ar_ref)) as ar_ref,
           public.tarif_norm_ref(f.af_reffourniss) as rf,
           public.tarif_norm_ref_sans_obs(f.af_reffourniss) as rf_obs,
           public.tarif_norm_ref(f.af_codebarre) as ean_af,
           public.tarif_norm_ref(b.ar_codebarre) as ean_ar,
           coalesce(a.art_sommeil, '') <> 'En sommeil' as actif,
           f.af_principal = '1' as principal
    from sage.article_fournisseur f
    left join sage.articles a on a.art_num = f.ar_ref
    left join sage.article_bis b on b.ar_ref = f.ar_ref
    where upper(trim(f.ct_num)) = v_frs
  ),
  l as (
    select id, public.tarif_norm_ref(ref_fournisseur) as rf, public.tarif_norm_ref(ean) as ean
    from public.tarif_proposition_lignes
    where proposition_id = p_id and not appariement_manuel
  ),
  candidats as (
    select l.id, af.ar_ref, 1 as niveau, 'ref_fournisseur' as mode, af.actif, af.principal
      from l join af on af.rf = l.rf
    union all
    select l.id, af.ar_ref, 2, 'ref_obsolete', af.actif, af.principal
      from l join af on af.rf_obs = public.tarif_norm_ref_sans_obs(l.rf) and af.rf is distinct from l.rf
    union all
    select l.id, upper(trim(a.art_num)), 3, 'reference', coalesce(a.art_sommeil, '') <> 'En sommeil', false
      from l join sage.articles a on public.tarif_norm_ref(a.art_num) = l.rf
    union all
    select l.id, af.ar_ref, 4, 'ean', af.actif, af.principal
      from l join af on l.ean is not null and length(l.ean) >= 8 and (af.ean_af = l.ean or af.ean_ar = l.ean)
  ),
  meilleur_niveau as (
    select id, min(niveau) as niveau from candidats group by id
  ),
  choix as (
    select distinct on (c.id) c.id, c.ar_ref, c.mode,
           count(*) over (partition by c.id) as nb
    from candidats c
    join meilleur_niveau m on m.id = c.id and m.niveau = c.niveau
    order by c.id, c.actif desc, c.principal desc, c.ar_ref
  )
  update public.tarif_proposition_lignes t
     set reference_article = ch.ar_ref,
         appariement       = ch.mode,
         nb_candidats      = ch.nb
    from (select l.id, ch.ar_ref, ch.mode, ch.nb from l left join choix ch on ch.id = l.id) ch
   where t.id = ch.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Enregistrement d'une proposition (en-tête + lignes) -----------------------------------
-- p = { fournisseur, fournisseur_nom, libelle, fichier_nom, fichier_type, fichier_path, source_import,
--       date_reception, date_effet, date_fin, commentaire, conditions, mapping,
--       lignes: [{ ligne_no, ref_fournisseur, ean, designation, marque, gamme, unite, prix_public,
--                  colisage, qte_palette, paliers: [{qte, prix}], brut }] }
create or replace function public.save_tarif_proposition(p jsonb)
returns bigint
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_id bigint;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  if coalesce(trim(p->>'fournisseur'), '') = '' then
    raise exception 'Fournisseur SAGE obligatoire';
  end if;

  insert into public.tarif_propositions (
    fournisseur, fournisseur_nom, libelle, fichier_nom, fichier_type, fichier_path, source_import,
    date_reception, date_effet, date_fin, commentaire, conditions, mapping, cree_par)
  values (
    upper(trim(p->>'fournisseur')), p->>'fournisseur_nom', p->>'libelle', p->>'fichier_nom', p->>'fichier_type',
    p->>'fichier_path', coalesce(p->>'source_import', 'grille'),
    coalesce(nullif(p->>'date_reception', '')::date, current_date),
    nullif(p->>'date_effet', '')::date, nullif(p->>'date_fin', '')::date,
    p->>'commentaire', p->'conditions', p->'mapping', public.current_user_email())
  returning id into v_id;

  insert into public.tarif_proposition_lignes (
    proposition_id, ligne_no, ref_fournisseur, ean, designation, marque, gamme, unite,
    prix_public, colisage, qte_palette, paliers, prix_base, brut)
  select v_id,
         (x->>'ligne_no')::int,
         nullif(trim(x->>'ref_fournisseur'), ''),
         nullif(trim(x->>'ean'), ''),
         nullif(trim(x->>'designation'), ''),
         nullif(trim(x->>'marque'), ''),
         nullif(trim(x->>'gamme'), ''),
         nullif(trim(x->>'unite'), ''),
         nullif(x->>'prix_public', '')::numeric,
         nullif(x->>'colisage', '')::numeric,
         nullif(x->>'qte_palette', '')::numeric,
         coalesce(pal.paliers, '[]'::jsonb),
         pal.prix_base,
         x->'brut'
  from jsonb_array_elements(coalesce(p->'lignes', '[]'::jsonb)) x
  left join lateral (
    select jsonb_agg(jsonb_build_object('qte', q, 'prix', pr) order by q) as paliers,
           (array_agg(pr order by q))[1] as prix_base
    from (
      select distinct on (coalesce(nullif(e->>'qte', '')::numeric, 1))
             greatest(coalesce(nullif(e->>'qte', '')::numeric, 1), 1) as q,
             nullif(e->>'prix', '')::numeric as pr
      from jsonb_array_elements(coalesce(x->'paliers', '[]'::jsonb)) e
      where nullif(e->>'prix', '')::numeric > 0
      order by coalesce(nullif(e->>'qte', '')::numeric, 1)
    ) z
  ) pal on true
  where nullif(trim(x->>'ref_fournisseur'), '') is not null or nullif(trim(x->>'ean'), '') is not null;

  update public.tarif_propositions
     set nb_lignes = (select count(*) from public.tarif_proposition_lignes where proposition_id = v_id)
   where id = v_id;

  perform public.tarif_apparier(v_id);
  return v_id;
end;
$$;

-- Mise à jour de l'en-tête (statut, dates, commentaire, résumé) ------------------------------
create or replace function public.update_tarif_proposition(p_id bigint, p jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  update public.tarif_propositions set
    libelle     = case when p ? 'libelle'     then p->>'libelle'                        else libelle end,
    statut      = case when p ? 'statut'      then p->>'statut'                         else statut end,
    commentaire = case when p ? 'commentaire' then p->>'commentaire'                    else commentaire end,
    date_effet  = case when p ? 'date_effet'  then nullif(p->>'date_effet', '')::date   else date_effet end,
    date_fin    = case when p ? 'date_fin'    then nullif(p->>'date_fin', '')::date     else date_fin end,
    resume      = case when p ? 'resume'      then p->'resume'                          else resume end,
    modifie_le  = now(),
    modifie_par = public.current_user_email()
  where id = p_id;
end;
$$;

-- Appariement manuel d'une ligne (référence vide = retour à l'appariement automatique) ------------
create or replace function public.set_tarif_ligne_article(p_ligne_id bigint, p_reference text, p_ignoree boolean default null)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_prop bigint;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  select proposition_id into v_prop from public.tarif_proposition_lignes where id = p_ligne_id;
  if v_prop is null then
    raise exception 'Ligne % introuvable', p_ligne_id;
  end if;

  if p_ignoree is not null then
    update public.tarif_proposition_lignes set ignoree = p_ignoree where id = p_ligne_id;
  end if;

  if p_reference is not null then
    if trim(p_reference) = '' then
      update public.tarif_proposition_lignes
         set appariement_manuel = false, reference_article = null, appariement = null, nb_candidats = null
       where id = p_ligne_id;
      perform public.tarif_apparier(v_prop);
    else
      if not exists (select 1 from sage.articles where upper(trim(art_num)) = upper(trim(p_reference))) then
        raise exception 'Article SAGE % inconnu', p_reference;
      end if;
      update public.tarif_proposition_lignes
         set appariement_manuel = true, reference_article = upper(trim(p_reference)), appariement = 'manuel', nb_candidats = 1
       where id = p_ligne_id;
    end if;
  end if;
end;
$$;

create or replace function public.delete_tarif_proposition(p_id bigint)
returns text
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_path text;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  delete from public.tarif_propositions where id = p_id returning fichier_path into v_path;
  return v_path;
end;
$$;

-- Liste des fournisseurs (sélecteur) -----------------------------------------------------
create or replace function public.get_tarifs_fournisseurs_liste()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v jsonb;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;

  with ventes as (
    select upper(trim(reference_article)) as ref,
           sum(case when coalesce(montant_ht, 0) < 0 then -abs(coalesce(quantite, 0)) else abs(coalesce(quantite, 0)) end) as qte
    from public.facture_lignes
    where date_facture >= (current_date - interval '12 months')::date
      and reference_article is not null
    group by 1
  ),
  af as (
    select upper(trim(f.ct_num)) as ct_num,
           count(*) as nb_articles,
           count(*) filter (where coalesce(a.art_sommeil, '') <> 'En sommeil') as nb_actifs,
           count(*) filter (where f.af_principal = '1') as nb_principal,
           sum(greatest(coalesce(v.qte, 0), 0)
               * coalesce(f.af_prixach, 0) * (1 - coalesce(f.af_remise, 0) / 100.0)) as masse_achat_12m
    from sage.article_fournisseur f
    left join sage.articles a on a.art_num = f.ar_ref
    left join ventes v on v.ref = upper(trim(f.ar_ref))
    where coalesce(f.ct_num, '') <> ''
    group by 1
  ),
  props as (
    select fournisseur, count(*) as nb_propositions, max(cree_le) as derniere_proposition
    from public.tarif_propositions group by 1
  ),
  paliers as (
    select upper(trim(tq_refcf)) as ct_num, count(distinct ar_ref) as nb_articles_paliers
    from sage.tarif_f_qte group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'fournisseur', af.ct_num,
           'nom', t.ct_intitule,
           'sommeil', t.ct_sommeil,
           'nb_articles', af.nb_articles,
           'nb_actifs', af.nb_actifs,
           'nb_principal', af.nb_principal,
           'nb_articles_paliers', coalesce(pa.nb_articles_paliers, 0),
           'masse_achat_12m', round(coalesce(af.masse_achat_12m, 0), 2),
           'nb_propositions', coalesce(pr.nb_propositions, 0),
           'derniere_proposition', pr.derniere_proposition
         ) order by coalesce(pr.derniere_proposition, '1900-01-01'::timestamptz) desc, af.masse_achat_12m desc nulls last), '[]'::jsonb)
    into v
  from af
  left join sage.tiers_complet t on upper(trim(t.ct_num)) = af.ct_num
  left join props pr on pr.fournisseur = af.ct_num
  left join paliers pa on pa.ct_num = af.ct_num;

  return v;
end;
$$;

-- Données d'un fournisseur : tarif actuel SAGE + volumes + propositions (+ lignes d'une proposition) ---
create or replace function public.get_tarifs_fournisseur(p_fournisseur text, p_proposition bigint default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set statement_timeout to '90s'
as $$
declare
  v_frs text := upper(trim(p_fournisseur));
  v_articles jsonb;
  v_lignes jsonb;
  v_props jsonb;
  v_prop jsonb;
  v_refs text[];
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;

  -- Articles concernés : ceux du fournisseur dans SAGE + ceux appariés manuellement dans la proposition
  select array_agg(distinct r) into v_refs from (
    select upper(trim(ar_ref)) as r from sage.article_fournisseur where upper(trim(ct_num)) = v_frs
    union
    select reference_article from public.tarif_proposition_lignes
     where p_proposition is not null and proposition_id = p_proposition and reference_article is not null
  ) z;

  with refs as (select unnest(coalesce(v_refs, array[]::text[])) as ref),
  ventes as (
    select upper(trim(fl.reference_article)) as ref,
           sum(case when coalesce(fl.montant_ht, 0) < 0 then -abs(coalesce(fl.quantite, 0)) else abs(coalesce(fl.quantite, 0)) end) as qte,
           sum(coalesce(fl.montant_ht, 0)) as ca,
           sum(coalesce(fl.marge_valeur, 0)) as marge,
           count(distinct fl.numero_tiers_entete) as nb_clients
    from public.facture_lignes fl
    where fl.date_facture >= (current_date - interval '12 months')::date
      and upper(trim(fl.reference_article)) = any (v_refs)
    group by 1
  ),
  achats as (
    select upper(trim(c.article_reference)) as ref,
           sum(coalesce(c.quantite_livree, 0))::numeric as qte,
           count(*) filter (where coalesce(c.quantite_livree, 0) > 0) as nb_lignes,
           sum(coalesce(c.quantite_livree, 0) * coalesce(c.prix_unitaire, 0) * (1 - coalesce(c.remise_pourcent, 0) / 100.0))::numeric as valeur
    from public.v_appro_cdf_lignes c
    where upper(c.code_fournisseur) = 'F' || v_frs
      and c.date_livraison >= now() - interval '12 months'
    group by 1
  ),
  afs as (
    select distinct on (upper(trim(f.ar_ref))) upper(trim(f.ar_ref)) as ref, f.*
    from sage.article_fournisseur f
    where upper(trim(f.ct_num)) = v_frs
    order by upper(trim(f.ar_ref)), f.af_principal desc
  ),
  paliers as (
    select reference_article as ref,
           jsonb_agg(jsonb_build_object('de', borne_precedente, 'a', borne_sup, 'prix', prix_net) order by palier) as paliers
    from public.v_appro_tarif_qte_fournisseur
    where fournisseur = v_frs
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference', r.ref,
      'designation', coalesce(b.ar_design, a.art_lib),
      'famille', a.art_facodefamille,
      'marque', b.marque,
      'sommeil', coalesce(a.art_sommeil, '') = 'En sommeil',
      'du_fournisseur', f.ar_ref is not null,
      'principal', f.af_principal = '1',
      'fournisseur_principal', a.art_fourprinc,
      'ref_fournisseur', f.af_reffourniss,
      'ean', coalesce(nullif(f.af_codebarre, ''), nullif(b.ar_codebarre, '')),
      'prix_tarif', f.af_prixach,
      'remise', nullif(f.af_remise, 0),
      'prix_net', round(f.af_prixach * (1 - coalesce(f.af_remise, 0) / 100.0), 4),
      'prix_nouveau_sage', nullif(f.af_prixachnouv, 0),
      'date_application_sage', case when coalesce(f.af_prixachnouv, 0) > 0 then public.sage_date_cb(f.af_dateapplication) end,
      'colisage', nullif(f.af_colisage, 0),
      'qte_mini', nullif(f.af_qtemini, 0),
      'prix_achat_fiche', b.ar_prixach,
      'dernier_prix_achat', nullif(a.art_derprixach, 0),
      'coef', nullif(b.ar_coef, 0),
      'prix_vente', nullif(b.ar_prixven, 0),
      'paliers', pa.paliers,
      'qte_ventes_12m', coalesce(v.qte, 0),
      'ca_ventes_12m', round(coalesce(v.ca, 0), 2),
      'marge_ventes_12m', round(coalesce(v.marge, 0), 2),
      'nb_clients_12m', coalesce(v.nb_clients, 0),
      'qte_achats_12m', coalesce(ac.qte, 0),
      'nb_lignes_cdf_12m', coalesce(ac.nb_lignes, 0),
      'valeur_achats_12m', round(coalesce(ac.valeur, 0), 2),
      'qte_moy_ligne_cdf', case when coalesce(ac.nb_lignes, 0) > 0 then round(ac.qte / ac.nb_lignes, 1) end
    ) order by r.ref), '[]'::jsonb)
  into v_articles
  from refs r
  left join sage.articles a on a.art_num = r.ref
  left join sage.article_bis b on b.ar_ref = r.ref
  left join afs f on f.ref = r.ref
  left join ventes v on v.ref = r.ref
  left join achats ac on ac.ref = r.ref
  left join paliers pa on pa.ref = r.ref;

  select coalesce(jsonb_agg(to_jsonb(p) - 'mapping' - 'conditions' order by p.cree_le desc), '[]'::jsonb)
    into v_props
  from public.tarif_propositions p
  where p.fournisseur = v_frs;

  if p_proposition is not null then
    select to_jsonb(p) into v_prop from public.tarif_propositions p where p.id = p_proposition;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'ligne_no', l.ligne_no, 'ref_fournisseur', l.ref_fournisseur, 'ean', l.ean,
        'designation', l.designation, 'marque', l.marque, 'gamme', l.gamme, 'unite', l.unite,
        'prix_public', l.prix_public, 'colisage', l.colisage, 'qte_palette', l.qte_palette,
        'paliers', l.paliers, 'prix_base', l.prix_base,
        'reference_article', l.reference_article, 'appariement', l.appariement,
        'nb_candidats', l.nb_candidats, 'appariement_manuel', l.appariement_manuel,
        'ignoree', l.ignoree, 'commentaire', l.commentaire
      ) order by l.ligne_no, l.id), '[]'::jsonb)
      into v_lignes
    from public.tarif_proposition_lignes l
    where l.proposition_id = p_proposition;
  end if;

  return jsonb_build_object(
    'fournisseur', v_frs,
    'nom', (select ct_intitule from sage.tiers_complet where upper(trim(ct_num)) = v_frs limit 1),
    'genere_le', now(),
    'periode_volumes', jsonb_build_object('du', (current_date - interval '12 months')::date, 'au', current_date),
    'articles', coalesce(v_articles, '[]'::jsonb),
    'propositions', coalesce(v_props, '[]'::jsonb),
    'proposition', v_prop,
    'lignes', coalesce(v_lignes, '[]'::jsonb)
  );
end;
$$;

-- Recherche d'un article SAGE pour l'appariement manuel ----------------------------------------
create or replace function public.search_tarif_articles(p_q text)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select case when not public.tarif_peut_acceder() then '[]'::jsonb else coalesce((
    select jsonb_agg(x) from (
      select a.art_num as reference, coalesce(b.ar_design, a.art_lib) as designation,
             a.art_fourprinc as fournisseur_principal, coalesce(a.art_sommeil, '') = 'En sommeil' as sommeil
      from sage.articles a
      left join sage.article_bis b on b.ar_ref = a.art_num
      where length(trim(coalesce(p_q, ''))) >= 2
        and (a.art_num ilike '%' || trim(p_q) || '%' or coalesce(b.ar_design, a.art_lib) ilike '%' || trim(p_q) || '%')
      order by (a.art_num ilike trim(p_q) || '%') desc, a.art_num
      limit 25
    ) x), '[]'::jsonb) end;
$$;

revoke all on function public.tarif_apparier(bigint) from public, anon, authenticated;
grant execute on function public.tarif_peut_acceder() to authenticated;
grant execute on function public.save_tarif_proposition(jsonb) to authenticated;
grant execute on function public.update_tarif_proposition(bigint, jsonb) to authenticated;
grant execute on function public.set_tarif_ligne_article(bigint, text, boolean) to authenticated;
grant execute on function public.delete_tarif_proposition(bigint) to authenticated;
grant execute on function public.get_tarifs_fournisseurs_liste() to authenticated;
grant execute on function public.get_tarifs_fournisseur(text, bigint) to authenticated;
grant execute on function public.search_tarif_articles(text) to authenticated;
