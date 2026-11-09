-- 20261109b_cdc_flux_tracabilite.sql
--
-- Traçabilité du flux des commandes clients (CDC) SAGE — 09/11/2026
-- ------------------------------------------------------------------
-- Besoin (Arnaud) : dater les suppressions de CDC (quantité diminuée, ligne
-- supprimée, commande entière supprimée) et les modifications, à partir du
-- portefeuille « activité non facturée » SAGE, pour repérer ce qui n'a pas
-- été répercuté dans BLG.
--
-- Principe : à chaque publication d'un lot d'import (sage.publier_lot_en_attente,
-- toutes les ~2 h), AVANT le remplacement des tables de production, on compare
--   état précédent = sage.activite_non_facturee / sage.entete_activite_non_fac
--   nouvel état    = sage.stg_activite_non_facturee / sage.stg_entete_activite_non_fac
-- par couple (CDC, article). Une baisse de quantité sur la CDC est d'abord
-- expliquée par la hausse des documents aval qui la référencent (PL, BL,
-- facture : vl_dlpiecebc = n° de CDC) ; seul le reste est une suppression.
-- Les événements sont horodatés à la publication : la date réelle de la
-- suppression dans SAGE est comprise entre periode_debut et detecte_at.
--
-- Un BL facturé ET comptabilisé entre deux imports quitte le portefeuille sans
-- passer par l'état « BL » : la lecture (get_cdc_flux) requalifie alors la
-- quantité en « transformée » si public.facture_lignes porte une facture de
-- cette CDC / cet article datée de la période.
--
-- Le statut BLG est calculé à la lecture (BLG est relu à la synchro de nuit) :
-- quantité commandée BLG comparée à la quantité SAGE encore justifiée
-- (reste en CDC + PL/BL non facturés + facturé).

-- ---------------------------------------------------------------------------
-- 1. Journal des événements
-- ---------------------------------------------------------------------------
create table if not exists public.cdc_flux_evenements (
  id                     bigint generated always as identity primary key,
  lot_id                 bigint,
  detecte_at             timestamptz not null default now(),
  periode_debut          timestamptz,
  niveau                 text not null check (niveau in ('COMMANDE','LIGNE')),
  type_evenement         text not null,
  cdc                    text not null,
  numero_tiers           text,
  representant_piece     text,
  date_piece             date,
  article                text,
  designation            text,
  qte_avant              numeric,
  qte_apres              numeric,
  qte_transformee        numeric,
  qte_non_expliquee      numeric,
  nb_lignes_avant        integer,
  nb_lignes_apres        integer,
  montant_ht_avant       numeric,
  montant_ht_apres       numeric,
  montant_non_explique   numeric,
  date_livraison_avant   date,
  date_livraison_apres   date,
  pieces_aval            text,
  statut_suivi           text not null default 'a_traiter'
                         check (statut_suivi in ('a_traiter','corrige_blg','sans_objet')),
  commentaire            text,
  traite_par             text,
  traite_at              timestamptz
);

create index if not exists idx_cdc_flux_detecte on public.cdc_flux_evenements (detecte_at desc);
create index if not exists idx_cdc_flux_cdc     on public.cdc_flux_evenements (cdc);
create index if not exists idx_cdc_flux_type    on public.cdc_flux_evenements (type_evenement);

alter table public.cdc_flux_evenements enable row level security;
revoke all on public.cdc_flux_evenements from anon, authenticated;

comment on table public.cdc_flux_evenements is
  'Flux des CDC SAGE : suppressions / modifications détectées à chaque publication de lot (cdc_flux_capturer). Lecture via get_cdc_flux().';

-- ---------------------------------------------------------------------------
-- 2. Catalogue des types d'événements
-- ---------------------------------------------------------------------------
create table if not exists public.cdc_flux_types (
  code         text primary key,
  niveau       text not null,
  libelle      text not null,
  description  text,
  flux_normal  boolean not null default false,  -- transformation PL/BL/facture : masqué par défaut
  sens         text not null,                   -- 'baisse' | 'hausse' | 'date' | 'neutre'
  ordre        integer not null
);

insert into public.cdc_flux_types (code, niveau, libelle, description, flux_normal, sens, ordre) values
  ('COMMANDE_SUPPRIMEE',      'COMMANDE', 'Commande supprimée',
   'Toutes les lignes et l''entête de la CDC ont disparu sans PL, BL ni facture.', false, 'baisse', 10),
  ('SUPPRESSION_LIGNE',       'LIGNE', 'Ligne supprimée',
   'L''article a disparu de la CDC sans aucune quantité transformée en PL / BL / facture.', false, 'baisse', 20),
  ('SOLDE_RELIQUAT',          'LIGNE', 'Reliquat soldé',
   'Une partie a été livrée, le reste a été supprimé / soldé dans SAGE.', false, 'baisse', 30),
  ('DIMINUTION_QTE',          'LIGNE', 'Quantité diminuée',
   'La quantité restant en commande a baissé plus que ce qui a été préparé / livré / facturé.', false, 'baisse', 40),
  ('AUGMENTATION_QTE',        'LIGNE', 'Quantité augmentée',
   'La quantité de l''article a augmenté sur la CDC.', false, 'hausse', 50),
  ('AJOUT_LIGNE',             'LIGNE', 'Ligne ajoutée',
   'Nouvel article sur une CDC déjà existante.', false, 'hausse', 60),
  ('DATE_LIVRAISON_MODIFIEE', 'COMMANDE', 'Date de livraison modifiée',
   'La date de livraison de l''entête de la CDC a changé.', false, 'date', 70),
  ('TRANSFORMATION',          'LIGNE', 'Transformée (PL / BL / facture)',
   'Baisse entièrement expliquée par une préparation, une livraison ou une facture : flux normal.', true, 'neutre', 80),
  ('RETOUR_EN_COMMANDE',      'LIGNE', 'Retour en commande',
   'Quantité revenue sur la CDC après suppression d''un PL / BL : flux normal.', true, 'neutre', 90)
on conflict (code) do update
  set niveau = excluded.niveau, libelle = excluded.libelle, description = excluded.description,
      flux_normal = excluded.flux_normal, sens = excluded.sens, ordre = excluded.ordre;

alter table public.cdc_flux_types enable row level security;
drop policy if exists cdc_flux_types_select on public.cdc_flux_types;
create policy cdc_flux_types_select on public.cdc_flux_types for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 3. Capture : état précédent (production) vs nouvel état (staging)
--    Appelée par sage.publier_lot_en_attente avant le remplacement des tables.
-- ---------------------------------------------------------------------------
create or replace function public.cdc_flux_capturer(p_lot_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public', 'sage'
as $$
declare
  v_debut timestamptz;
  v_n     integer;
begin
  select max(publie_at) into v_debut
    from sage.import_lots
   where statut = 'publie' and id < p_lot_id;

  with
  av_cdc as (
    select vl_docnum as cdc, upper(trim(vl_art_num)) as art,
           max(vl_dldesign) as designation, sum(coalesce(qtevendues,0)) as qte,
           count(*)::int as nb, sum(coalesce(cahtnet,0)) as mt,
           max(vl_ctnum) as tiers, max(vl_renom) as rep,
           max(public.sage_date_text_to_date(date_piece)) as date_piece
      from sage.activite_non_facturee
     where vl_doctype = '1' and coalesce(trim(vl_art_num),'') <> ''
     group by 1, 2),
  ap_cdc as (
    select vl_docnum as cdc, upper(trim(vl_art_num)) as art,
           max(vl_dldesign) as designation, sum(coalesce(qtevendues,0)) as qte,
           count(*)::int as nb, sum(coalesce(cahtnet,0)) as mt,
           max(vl_ctnum) as tiers, max(vl_renom) as rep,
           max(public.sage_date_text_to_date(date_piece)) as date_piece
      from sage.stg_activite_non_facturee
     where vl_doctype = '1' and coalesce(trim(vl_art_num),'') <> ''
     group by 1, 2),
  av_aval as (
    select vl_dlpiecebc as cdc, upper(trim(vl_art_num)) as art, sum(coalesce(qtevendues,0)) as qte
      from sage.activite_non_facturee
     where vl_doctype in ('2','3','6','7') and coalesce(vl_dlpiecebc,'') like 'CDC%'
     group by 1, 2),
  ap_aval as (
    select vl_dlpiecebc as cdc, upper(trim(vl_art_num)) as art, sum(coalesce(qtevendues,0)) as qte,
           string_agg(distinct vl_docnum, ', ') as pieces
      from sage.stg_activite_non_facturee
     where vl_doctype in ('2','3','6','7') and coalesce(vl_dlpiecebc,'') like 'CDC%'
     group by 1, 2),
  cdc_avant as (select distinct cdc from av_cdc),
  cles as (
    select cdc, art from av_cdc
    union
    select a.cdc, a.art from ap_cdc a where a.cdc in (select cdc from cdc_avant)),
  l as (
    select k.cdc, k.art,
           coalesce(a.designation, n.designation) as designation,
           coalesce(a.tiers, n.tiers) as tiers,
           coalesce(n.rep, a.rep) as rep,
           coalesce(a.date_piece, n.date_piece) as date_piece,
           coalesce(a.qte, 0) as qa, coalesce(n.qte, 0) as qn,
           coalesce(a.nb, 0) as nba, coalesce(n.nb, 0) as nbn,
           coalesce(a.mt, 0) as mta, coalesce(n.mt, 0) as mtn,
           coalesce(x2.qte, 0) - coalesce(x1.qte, 0) as d_aval,
           x2.pieces
      from cles k
      left join av_cdc  a  on a.cdc  = k.cdc and a.art  = k.art
      left join ap_cdc  n  on n.cdc  = k.cdc and n.art  = k.art
      left join av_aval x1 on x1.cdc = k.cdc and x1.art = k.art
      left join ap_aval x2 on x2.cdc = k.cdc and x2.art = k.art),
  c as (
    select l.*,
           qa - qn as baisse,
           case
             when qa > 0 and qn = 0 and d_aval <= 0          then 'SUPPRESSION_LIGNE'
             when qa > 0 and qn = 0 and d_aval < qa          then 'SOLDE_RELIQUAT'
             when qa > 0 and qn = 0                          then 'TRANSFORMATION'
             when qn > 0 and qa > qn and d_aval >= qa - qn   then 'TRANSFORMATION'
             when qn > 0 and qa > qn                         then 'DIMINUTION_QTE'
             when qa = 0 and qn > 0 and d_aval < 0           then 'RETOUR_EN_COMMANDE'
             when qa = 0 and qn > 0                          then 'AJOUT_LIGNE'
             when qn > qa and d_aval < 0 and -d_aval >= qn - qa then 'RETOUR_EN_COMMANDE'
             when qn > qa                                    then 'AUGMENTATION_QTE'
           end as type_evt
      from l)
  insert into public.cdc_flux_evenements
    (lot_id, periode_debut, niveau, type_evenement, cdc, numero_tiers, representant_piece, date_piece,
     article, designation, qte_avant, qte_apres, qte_transformee, qte_non_expliquee,
     nb_lignes_avant, nb_lignes_apres, montant_ht_avant, montant_ht_apres, montant_non_explique, pieces_aval)
  select p_lot_id, v_debut, 'LIGNE', type_evt, cdc, tiers, rep, date_piece,
         art, designation, qa, qn,
         greatest(d_aval, 0),
         case when baisse > 0 then greatest(baisse - greatest(d_aval, 0), 0) else 0 end,
         nba, nbn, round(mta, 2), round(mtn, 2),
         case when baisse > 0 and qa > 0
              then round(mta * greatest(baisse - greatest(d_aval, 0), 0) / qa, 2) else 0 end,
         pieces
    from c
   where type_evt is not null;

  get diagnostics v_n = row_count;

  -- Commande entière supprimée : plus aucune ligne ni entête, rien en aval
  insert into public.cdc_flux_evenements
    (lot_id, periode_debut, niveau, type_evenement, cdc, numero_tiers, representant_piece, date_piece,
     qte_avant, qte_apres, qte_transformee, qte_non_expliquee,
     nb_lignes_avant, nb_lignes_apres, montant_ht_avant, montant_ht_apres, montant_non_explique,
     date_livraison_avant)
  select p_lot_id, v_debut, 'COMMANDE', 'COMMANDE_SUPPRIMEE', e.cdc,
         max(e.numero_tiers), max(e.representant_piece), max(e.date_piece),
         sum(e.qte_avant), 0, sum(e.qte_transformee), sum(e.qte_non_expliquee),
         sum(e.nb_lignes_avant), 0, sum(e.montant_ht_avant), 0, sum(e.montant_non_explique),
         (select public.sage_date_text_to_date(h.date_livraison)
            from sage.entete_activite_non_fac h
           where h.numero_piece = e.cdc and h.type_doc_code = '1' limit 1)
    from public.cdc_flux_evenements e
   where e.lot_id = p_lot_id and e.niveau = 'LIGNE'
     and not exists (select 1 from sage.stg_activite_non_facturee s
                      where s.vl_docnum = e.cdc and s.vl_doctype = '1')
     and not exists (select 1 from sage.stg_entete_activite_non_fac h
                      where h.numero_piece = e.cdc and h.type_doc_code = '1')
   group by e.cdc
  having bool_and(e.type_evenement = 'SUPPRESSION_LIGNE');

  -- Date de livraison d'entête modifiée
  insert into public.cdc_flux_evenements
    (lot_id, periode_debut, niveau, type_evenement, cdc, numero_tiers, date_piece,
     date_livraison_avant, date_livraison_apres)
  select p_lot_id, v_debut, 'COMMANDE', 'DATE_LIVRAISON_MODIFIEE', n.numero_piece, n.numero_tiers,
         public.sage_date_text_to_date(n.date_piece),
         public.sage_date_text_to_date(a.date_livraison), public.sage_date_text_to_date(n.date_livraison)
    from sage.entete_activite_non_fac a
    join sage.stg_entete_activite_non_fac n
      on n.numero_piece = a.numero_piece and n.type_doc_code = '1'
   where a.type_doc_code = '1'
     and public.sage_date_text_to_date(a.date_livraison) is distinct from public.sage_date_text_to_date(n.date_livraison);

  select count(*) into v_n from public.cdc_flux_evenements where lot_id = p_lot_id;
  return v_n;
end;
$$;

revoke all on function public.cdc_flux_capturer(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Lecture pour l'écran : événements + requalification facture + statut BLG
-- ---------------------------------------------------------------------------
create or replace function public.get_cdc_flux(p_depuis date default (current_date - 7), p_jusqu date default current_date)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage', 'blg'
set statement_timeout to '60s'
as $$
declare
  v_res jsonb;
begin
  if auth.uid() is null and current_user not in ('postgres','service_role') then
    raise exception 'Non authentifié';
  end if;

  with
  e as (
    select * from public.cdc_flux_evenements
     where detecte_at >= p_depuis::timestamptz
       and detecte_at <  (p_jusqu + 1)::timestamptz),
  cdcs as (select distinct cdc from e),
  -- SAGE maintenant
  s_cdc as (
    select vl_docnum cdc, upper(trim(vl_art_num)) art, sum(coalesce(qtevendues,0)) qte
      from sage.activite_non_facturee
     where vl_doctype = '1' and vl_docnum in (select cdc from cdcs)
     group by 1, 2),
  s_aval as (
    select vl_dlpiecebc cdc, upper(trim(vl_art_num)) art, sum(coalesce(qtevendues,0)) qte
      from sage.activite_non_facturee
     where vl_doctype in ('2','3') and vl_dlpiecebc in (select cdc from cdcs)
     group by 1, 2),
  s_fact as (
    select f.numero_piece_bc cdc, upper(trim(f.reference_article)) art,
           sum(abs(coalesce(f.quantite,0))) qte,
           string_agg(distinct f.numero_piece, ', ') pieces
      from public.facture_lignes f
     where f.numero_piece_bc in (select cdc from cdcs)
     group by 1, 2),
  s_fact_periode as (
    select e.id, sum(abs(coalesce(f.quantite,0))) qte
      from e
      join public.facture_lignes f
        on f.numero_piece_bc = e.cdc and upper(trim(f.reference_article)) = e.article
       and f.date_facture >= (coalesce(e.periode_debut, e.detecte_at - interval '1 day'))::date - 1
     where e.niveau = 'LIGNE' and e.qte_non_expliquee > 0
     group by e.id),
  s_ent as (
    select numero_piece cdc, public.sage_date_text_to_date(date_livraison) dliv
      from sage.entete_activite_non_fac
     where type_doc_code = '1' and numero_piece in (select cdc from cdcs)),
  -- BLG (relu à la synchro de nuit)
  b_ent as (
    select q.reference cdc, min(q.id) id,
           min('https://app.blgcloud.com/dakar-11/?app/sale/quote/edit/' || q.document_id || '#') lien,
           bool_or(q.archive_reason_fk is not null) archivee,
           min(q.delivery_date_required) dliv, max(q.synced_at) synced_at
      from blg.sale_quote q
     where q.type = 'sale' and q.reference in (select cdc from cdcs)
     group by 1),
  b_lig as (
    select cdc_reference cdc, upper(trim(article_reference)) a1, upper(trim(article_reference_interne)) a2,
           quantite, qte_a_livrer
      from public.v_cdc_blg_lignes
     where cdc_reference in (select cdc from cdcs)),
  r as (
    select e.*,
           t.libelle as type_libelle, t.flux_normal, t.sens, t.ordre as type_ordre,
           coalesce(fp.qte, 0) as qte_facturee_periode,
           (coalesce(sc.qte,0) + coalesce(sa.qte,0) + coalesce(sf.qte,0)) as sage_qte_justifiee,
           sf.pieces as pieces_facture,
           se.dliv as sage_date_livraison,
           be.id as blg_id, be.lien as blg_lien, be.archivee as blg_archivee, be.dliv as blg_date_livraison,
           be.synced_at as blg_synced_at,
           (select sum(bl.quantite) from b_lig bl
             where bl.cdc = e.cdc and (e.article is null or bl.a1 = e.article or bl.a2 = e.article)) as blg_qte,
           (select sum(bl.qte_a_livrer) from b_lig bl
             where bl.cdc = e.cdc and (e.article is null or bl.a1 = e.article or bl.a2 = e.article)) as blg_qte_a_livrer
      from e
      join public.cdc_flux_types t on t.code = e.type_evenement
      left join s_fact_periode fp on fp.id = e.id
      left join s_cdc  sc on sc.cdc = e.cdc and sc.art = e.article
      left join s_aval sa on sa.cdc = e.cdc and sa.art = e.article
      left join s_fact sf on sf.cdc = e.cdc and sf.art = e.article
      left join s_ent  se on se.cdc = e.cdc
      left join b_ent  be on be.cdc = e.cdc),
  -- totaux SAGE au niveau commande (pour COMMANDE_SUPPRIMEE)
  r2 as (
    select r.*,
           case when r.niveau = 'COMMANDE' then
             (select coalesce(sum(qte),0) from s_cdc  x where x.cdc = r.cdc)
           + (select coalesce(sum(qte),0) from s_aval x where x.cdc = r.cdc)
           + (select coalesce(sum(qte),0) from s_fact x where x.cdc = r.cdc)
           else r.sage_qte_justifiee end as sage_qte_justifiee_cmd
      from r),
  f as (
    select r2.*,
           -- requalification : quantité retrouvée sur une facture de la période
           case when r2.niveau = 'LIGNE' and r2.qte_non_expliquee > 0
                     and r2.qte_facturee_periode >= r2.qte_non_expliquee
                     and r2.type_evenement in ('SUPPRESSION_LIGNE','SOLDE_RELIQUAT','DIMINUTION_QTE')
                then 'TRANSFORMATION' else r2.type_evenement end as type_final,
           greatest(r2.qte_non_expliquee - case when r2.niveau = 'LIGNE' then r2.qte_facturee_periode else 0 end, 0)
             as qte_non_expliquee_finale
      from r2),
  g as (
    select f.*,
           case
             when f.type_final = 'TRANSFORMATION' or f.type_final = 'RETOUR_EN_COMMANDE' then 'SANS_OBJET'
             when f.blg_id is null then 'ABSENTE_BLG'
             when f.blg_archivee then 'ARCHIVEE_BLG'
             when f.type_final = 'DATE_LIVRAISON_MODIFIEE' then
               case when f.blg_date_livraison is not distinct from f.sage_date_livraison then 'ALIGNE_BLG' else 'A_CORRIGER_BLG' end
             when f.sens = 'baisse' then
               case when coalesce(f.blg_qte,0) > f.sage_qte_justifiee_cmd + 0.0001 then 'A_CORRIGER_BLG' else 'ALIGNE_BLG' end
             when f.sens = 'hausse' then
               case when coalesce(f.blg_qte,0) + 0.0001 < f.sage_qte_justifiee_cmd then 'A_CORRIGER_BLG' else 'ALIGNE_BLG' end
             else 'SANS_OBJET'
           end as statut_blg,
           case
             when f.sens in ('baisse','hausse') then coalesce(f.blg_qte,0) - f.sage_qte_justifiee_cmd
           end as ecart_blg_qte
      from f)
  select jsonb_build_object(
    'depuis', p_depuis,
    'jusqu', p_jusqu,
    'genere_at', now(),
    'types', (select jsonb_agg(to_jsonb(t) order by t.ordre) from public.cdc_flux_types t),
    'lots', (select coalesce(jsonb_agg(jsonb_build_object(
                'lot_id', il.id, 'publie_at', il.publie_at,
                'nb', (select count(*) from public.cdc_flux_evenements x where x.lot_id = il.id))
              order by il.publie_at desc), '[]'::jsonb)
               from sage.import_lots il
              where il.statut = 'publie'
                and il.publie_at >= p_depuis::timestamptz and il.publie_at < (p_jusqu + 1)::timestamptz),
    'premier_suivi', (select min(detecte_at) from public.cdc_flux_evenements),
    'evenements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'lot_id', g.lot_id, 'detecte_at', g.detecte_at, 'periode_debut', g.periode_debut,
        'niveau', g.niveau, 'type', g.type_final, 'type_origine', g.type_evenement,
        'cdc', g.cdc, 'numero_tiers', g.numero_tiers,
        'intitule_tiers', (select rt.intitule from public.ref_tiers rt where rt.numero = g.numero_tiers limit 1),
        'representant', coalesce((select rt.representant from public.ref_tiers rt where rt.numero = g.numero_tiers limit 1), g.representant_piece),
        'date_piece', g.date_piece,
        'article', g.article, 'designation', g.designation,
        'qte_avant', g.qte_avant, 'qte_apres', g.qte_apres, 'qte_transformee', g.qte_transformee,
        'qte_facturee_periode', g.qte_facturee_periode,
        'qte_non_expliquee', g.qte_non_expliquee_finale,
        'montant_ht_avant', g.montant_ht_avant, 'montant_ht_apres', g.montant_ht_apres,
        'montant_non_explique', case when g.qte_non_expliquee > 0
                                     then round(g.montant_non_explique * g.qte_non_expliquee_finale / g.qte_non_expliquee, 2)
                                     else 0 end,
        'nb_lignes_avant', g.nb_lignes_avant, 'nb_lignes_apres', g.nb_lignes_apres,
        'date_livraison_avant', g.date_livraison_avant, 'date_livraison_apres', g.date_livraison_apres,
        'pieces_aval', g.pieces_aval, 'pieces_facture', g.pieces_facture,
        'sage_qte_justifiee', g.sage_qte_justifiee_cmd, 'sage_date_livraison', g.sage_date_livraison,
        'blg_lien', g.blg_lien, 'blg_qte', g.blg_qte, 'blg_qte_a_livrer', g.blg_qte_a_livrer,
        'blg_date_livraison', g.blg_date_livraison, 'blg_synced_at', g.blg_synced_at,
        'statut_blg', g.statut_blg, 'ecart_blg_qte', g.ecart_blg_qte,
        'statut_suivi', g.statut_suivi, 'commentaire', g.commentaire,
        'traite_par', g.traite_par, 'traite_at', g.traite_at)
        order by g.detecte_at desc, g.cdc, g.niveau, g.article)
      from g), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;

revoke all on function public.get_cdc_flux(date, date) from public, anon;
grant execute on function public.get_cdc_flux(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Suivi du traitement (corrigé dans BLG / sans objet)
-- ---------------------------------------------------------------------------
create or replace function public.cdc_flux_set_suivi(p_ids bigint[], p_statut text, p_commentaire text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Non authentifié'; end if;
  if p_statut not in ('a_traiter','corrige_blg','sans_objet') then
    raise exception 'Statut inconnu : %', p_statut;
  end if;
  update public.cdc_flux_evenements
     set statut_suivi = p_statut,
         commentaire  = coalesce(p_commentaire, commentaire),
         traite_par   = case when p_statut = 'a_traiter' then null else coalesce(auth.jwt() ->> 'email', auth.uid()::text) end,
         traite_at    = case when p_statut = 'a_traiter' then null else now() end
   where id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.cdc_flux_set_suivi(bigint[], text, text) from public, anon;
grant execute on function public.cdc_flux_set_suivi(bigint[], text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Branchement dans la publication des lots (étape 6.a bis)
--    Seul ajout à la fonction : le bloc « 6.a bis ». Un échec de la capture
--    est consigné dans controle._cdc_flux et ne bloque jamais la publication.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sage.publier_lot_en_attente(p_forcer boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'sage', 'public'
AS $function$
declare
  v_lot        sage.import_lots%rowtype;
  v_t          text;
  v_attendu    bigint;
  v_stg        bigint;
  v_prod       bigint;
  v_cle        text;
  v_n          bigint;
  v_cols       text;
  v_controle   jsonb := '{}'::jsonb;
  v_sync       jsonb;
  v_debut      timestamptz := clock_timestamp();
  c_baisse_max constant numeric := 0.30;   -- baisse de volume tolérée vs production
  -- 20/10/2026 : le portefeuille non facturé fond légitimement lors de la
  -- facturation en masse de fin de mois -> seuil de baisse relevé à 90 %
  -- pour ces deux tables (garde-fou contre un fichier quasi vide seulement ;
  -- un chargement tronqué reste détecté par le contrôle lignes CSV = lignes chargées)
  c_baisse_max_portefeuille constant numeric := 0.90;
  -- 20/10/2026 : ces 4 tables forment le « monde » stock / CDF / CDC ; elles
  -- doivent arriver ensemble, sinon on publierait un portefeuille neuf face à
  -- un stock ancien (ou l'inverse)
  c_groupe constant text[] := array['stock_depot','bdcf','activite_non_facturee','entete_activite_non_fac'];
  v_seuil      numeric;
  v_manquantes text[];
begin
  select * into v_lot
    from sage.import_lots
   where statut = 'soumis'
   order by id desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('publie', false, 'raison', 'aucun lot soumis');
  end if;

  update sage.import_lots
     set statut = 'remplace', message = 'Remplacé par le lot ' || v_lot.id
   where statut = 'soumis' and id < v_lot.id;

  begin
    -- même verrou que sync_sage_to_activite_tables : attend la fin d'une
    -- synchro planifiée en cours, et empêche qu'une autre démarre pendant
    -- la publication (verrou réentrant dans la même session).
    perform pg_advisory_xact_lock(78412039981);

    -- 6.0 Groupe stock / CDF / portefeuille : tout ou rien
    if exists (select 1 from jsonb_object_keys(v_lot.attendus) k where k = any (c_groupe)) then
      select array_agg(g) into v_manquantes
        from unnest(c_groupe) g
       where not (v_lot.attendus ? g);
      if v_manquantes is not null then
        v_controle := v_controle || jsonb_build_object('_groupe_incomplet', to_jsonb(v_manquantes));
        raise exception 'Groupe stock / CDF / portefeuille incomplet : fichier(s) % absent(s) du lot - rien n''est publié pour ne pas mélanger deux instants',
          array_to_string(v_manquantes, ', ');
      end if;
    end if;

    -- 6.a Contrôles, table par table, avant de toucher à la production
    for v_t, v_attendu in
      select key, value::bigint from jsonb_each_text(v_lot.attendus)
    loop
      if not v_t = any (sage.import_tables_stagees()) then
        raise exception '%: table non gérée', v_t;
      end if;

      execute format('select count(*) from sage.%I', 'stg_' || v_t) into v_stg;
      execute format('select count(*) from sage.%I', v_t) into v_prod;

      v_controle := v_controle || jsonb_build_object(
        v_t, jsonb_build_object('attendu', v_attendu, 'charge', v_stg, 'actuel', v_prod));

      if v_stg = 0 then
        raise exception '%: aucune ligne chargée', v_t;
      end if;

      if v_stg <> v_attendu then
        raise exception '%: % ligne(s) chargée(s) pour % ligne(s) dans le CSV', v_t, v_stg, v_attendu;
      end if;

      v_seuil := case when v_t in ('activite_non_facturee','entete_activite_non_fac')
                      then c_baisse_max_portefeuille else c_baisse_max end;
      if not p_forcer and v_prod >= 100 and v_stg < v_prod * (1 - v_seuil) then
        raise exception '%: % ligne(s) contre % en production (baisse de plus de % %%) - lot bloqué par sécurité',
          v_t, v_stg, v_prod, round(v_seuil * 100);
      end if;

      -- clé métier : clé primaire de la table de production (hors id technique)
      for v_cle in
        select a.attname::text
          from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
         where k.conrelid = format('sage.%I', v_t)::regclass
           and k.contype = 'p'
           and a.attname <> 'id'
      loop
        execute format('select count(*) filter (where %1$I is null) + (count(%1$I) - count(distinct %1$I)) from sage.%2$I',
                       v_cle, 'stg_' || v_t)
           into v_n;
        if v_n > 0 then
          raise exception '%: % ligne(s) avec clé % vide ou en double', v_t, v_n, v_cle;
        end if;
      end loop;

      if v_t = 'stock_depot' then
        select count(*) into v_n from sage.stg_stock_depot
         where coalesce(trim(sto_art_num), '') = '' or coalesce(trim(sto_dep_num), '') = '';
        if v_n > 0 then
          raise exception 'stock_depot: % ligne(s) sans référence article ou sans dépôt', v_n;
        end if;
      end if;
    end loop;

    -- 6.a bis (09/11/2026) Traçabilité du flux des CDC : compare la production
    --     (état précédent) et le staging (nouvel état) AVANT remplacement.
    --     Un échec ici ne bloque jamais la publication.
    if v_lot.attendus ? 'activite_non_facturee' and v_lot.attendus ? 'entete_activite_non_fac' then
      begin
        v_n := public.cdc_flux_capturer(v_lot.id);
        v_controle := v_controle || jsonb_build_object('_cdc_flux_evenements', v_n);
      exception when others then
        v_controle := v_controle || jsonb_build_object('_cdc_flux', 'erreur : ' || sqlerrm);
      end;
    end if;

    -- 6.b Remplacement des tables de production (DELETE : les lecteurs
    --     continuent de voir l'ancienne version jusqu'au COMMIT)
    for v_t in select jsonb_object_keys(v_lot.attendus) loop
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
        into v_cols
        from pg_attribute a
       where a.attrelid = format('sage.%I', v_t)::regclass
         and a.attnum > 0 and not a.attisdropped
         and exists (
           select 1 from pg_attribute s
            where s.attrelid = format('sage.%I', 'stg_' || v_t)::regclass
              and s.attname = a.attname and not s.attisdropped);

      execute format('delete from sage.%I where true', v_t);
      execute format('insert into sage.%I (%s) select %s from sage.%I', v_t, v_cols, v_cols, 'stg_' || v_t);
    end loop;

    -- 6.c Synchro vers les tables d'activité DANS la même transaction :
    --     stock, CDF et portefeuille CDC deviennent visibles ensemble.
    v_sync := public.sync_sage_to_activite_tables();
    if v_sync ? 'skipped' or coalesce((v_sync ->> 'success')::boolean, true) = false then
      raise exception 'Synchro SAGE -> activité non exécutée : %', v_sync::text;
    end if;

    -- 6.d Cache des alertes de couverture recalculé sur le nouvel état
    --     (un échec ici ne bloque pas la publication)
    begin
      perform public.refresh_alerte_couverture_stock_cache();
    exception when others then
      v_controle := v_controle || jsonb_build_object('_cache_alerte_couverture', 'erreur : ' || sqlerrm);
    end;

    update sage.import_lots
       set statut = 'publie',
           -- heure réelle de fin (now() = début de transaction, ~5 min plus tôt)
           publie_at = clock_timestamp(),
           duree_publication_s = round(extract(epoch from clock_timestamp() - v_debut)::numeric, 1),
           controle = v_controle,
           sync_resultat = v_sync,
           message = null
     where id = v_lot.id;

    return jsonb_build_object('publie', true, 'lot', v_lot.id, 'controle', v_controle);

  exception when others then
    -- tout ce qui précède est annulé : la production garde le lot précédent
    update sage.import_lots
       set statut = 'rejete',
           controle = v_controle,
           duree_publication_s = round(extract(epoch from clock_timestamp() - v_debut)::numeric, 1),
           message = left(sqlerrm, 2000)
     where id = v_lot.id;
    return jsonb_build_object('publie', false, 'lot', v_lot.id, 'raison', sqlerrm, 'controle', v_controle);
  end;
end;
$function$;
