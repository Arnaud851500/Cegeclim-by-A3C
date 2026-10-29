-- ============================================================================
-- 20261029c_archive_blg_internal_tag.sql
-- Correctif du 29/10/2026 : dans BLG, une commande archivée a internal_tag =
-- 'archive' ; archive_reason_fk n'est renseigné que si un motif a été saisi
-- (28 ventes sur 5 782 archivées). La règle « archivée » devient
-- internal_tag = 'archive' OU motif renseigné, dans :
--   * v_rappro_blg_archive / get_rappro_synthese (filtre Archivée BLG de
--     l'écran Rapprochement SAGE ↔ BLG) ; motif « Sans motif » à défaut ;
--   * activite_sage_blg_docs (colonne « Archives » de l'écran Activité SAGE ↔
--     statuts BLG).
-- ============================================================================

create or replace view public.v_rappro_blg_archive as
select
  q.id,
  (q.internal_tag = 'archive' or q.archive_reason_fk is not null) as archive,
  coalesce(
    nullif(r.title::jsonb ->> 'fr_FR', ''),
    r.name,
    case when q.archive_reason_fk is not null then 'Motif ' || q.archive_reason_fk::text
         when q.internal_tag = 'archive' then 'Sans motif' end
  ) as motif
from blg.sale_quote q
left join blg.system_archive_reason r on r.id = q.archive_reason_fk;


create or replace function public.get_rappro_synthese(p_archive text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select e.*
    from rappro_ecarts e
    left join blg.sale_quote q
           on e.domaine in ('CDC', 'CDF') and q.id = e.document_blg_id
    where p_archive is null
       or (p_archive = 'oui' and (q.internal_tag = 'archive' or q.archive_reason_fk is not null))
       or (p_archive = 'non' and not coalesce(q.internal_tag = 'archive' or q.archive_reason_fk is not null, false))
  )
  select jsonb_build_object(
    'run', (select to_jsonb(r) from (select id, debut, fin, blg_synchro, sage_synchro, compteurs, erreur from rappro_runs where fin is not null order by id desc limit 1) r),
    'en_cours', exists (select 1 from rappro_runs where fin is null and debut > now() - interval '10 minutes'),
    'archive', p_archive,
    'types', coalesce((select jsonb_agg(x order by x.domaine, x.ordre) from (
        select t.code, t.domaine, t.niveau, t.libelle, t.description, t.systeme_a_corriger, t.action, t.gravite, t.nettoyage_masse, t.ordre,
               count(e.id) filter (where not e.probable_decalage) nb,
               count(e.id) filter (where e.probable_decalage) nb_decalage,
               count(distinct e.document) filter (where not e.probable_decalage) nb_documents,
               coalesce(sum(e.valeur_ht) filter (where not e.probable_decalage), 0) valeur_ht,
               count(e.id) filter (where not e.probable_decalage and coalesce(s.statut,'a_traiter') = 'a_traiter') nb_a_traiter,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'en_cours') nb_en_cours,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'corrige') nb_corrige,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'accepte') nb_accepte,
               count(e.id) filter (where not e.probable_decalage and e.age_jours > 365) nb_plus_1an
        from rappro_ecart_types t
        left join e on e.type_code = t.code
        left join rappro_ecart_suivi s on s.domaine = e.domaine and s.cle = e.cle
        group by t.code) x), '[]'::jsonb),
    'depots', coalesce((select jsonb_agg(x) from (
        select domaine, niveau, coalesce(depot,'(sans dépôt)') depot, count(*) nb, coalesce(sum(valeur_ht),0) valeur_ht
        from e where not probable_decalage group by 1,2,3) x), '[]'::jsonb),
    'historique', coalesce((select jsonb_agg(x order by x.jour) from (
        select h.jour, h.domaine, sum(h.nb) nb, sum(h.valeur_ht) valeur_ht from rappro_historique h
        join rappro_ecart_types t on t.code = h.type_code and t.niveau = 'LIGNE' and t.systeme_a_corriger <> 'AUCUN'
        where h.jour >= current_date - 90 group by 1,2) x), '[]'::jsonb)
  )
$$;

create or replace function public.activite_sage_blg_docs(
  p_date_from date default null,
  p_date_to   date default null
)
returns table (
  type_code          text,
  type_ordre         integer,
  numero_piece       text,
  cdc_reference      text,
  rattache_cdc       boolean,
  numero_tiers       text,
  intitule_tiers     text,
  agence             text,
  collaborateur      text,
  date_piece         date,
  date_livraison     date,
  depot              text,
  nb_lignes          bigint,
  quantite           numeric,
  montant_ht         numeric,
  -- BLG
  blg_id             integer,
  blg_document_id    text,
  blg_reference      text,
  blg_groupe_code    text,
  blg_groupe_libelle text,
  blg_groupe_ordre   integer
)
language sql
stable
security definer
set search_path = public, blg, sage
as $$
  with l as (
    select
      case al.type_document
        when 'Bon de commande'          then 'CDC'
        when 'Préparation de livraison' then 'PL'
        when 'Bon de livraison'         then 'BL'
        when 'Bon de retour'            then 'BR'
      end as type_code,
      al.numero_piece,
      case when al.type_document = 'Bon de commande' then al.numero_piece
           else nullif(trim(al.numero_piece_bc), '') end as cdc_reference,
      al.numero_tiers_entete,
      al.intitule_tiers_entete,
      al.collaborateur,
      al.date_piece,
      al.date_livraison,
      al.depot,
      al.quantite,
      al.montant_ht
    from public.activite_lignes al
    where al.type_document in ('Bon de commande','Préparation de livraison','Bon de livraison','Bon de retour')
      and upper(trim(coalesce(al.reference_article, ''))) not in ('REF','FEDEX')
      and (p_date_from is null or al.date_piece >= p_date_from)
      and (p_date_to   is null or al.date_piece <= p_date_to)
  ),
  d as (
    select
      l.type_code,
      l.numero_piece,
      l.cdc_reference,
      min(l.numero_tiers_entete)    as numero_tiers,
      min(l.intitule_tiers_entete)  as intitule_tiers,
      min(l.collaborateur)          as collaborateur_ligne,
      min(l.date_piece)             as date_piece,
      min(l.date_livraison)         as date_livraison,
      string_agg(distinct l.depot, ', ') as depot,
      count(*)                      as nb_lignes,
      sum(coalesce(l.quantite, 0))  as quantite,
      sum(coalesce(l.montant_ht, 0)) as montant_ht
    from l
    group by l.type_code, l.numero_piece, l.cdc_reference
  )
  select
    d.type_code,
    case d.type_code when 'CDC' then 1 when 'PL' then 2 when 'BL' then 3 else 4 end,
    d.numero_piece,
    d.cdc_reference,
    d.cdc_reference is not null,
    d.numero_tiers,
    coalesce(e.intitule_tiers, d.intitule_tiers),
    coalesce(af.agence, ap.agence, 'NON AFFECTE'),
    coalesce(nullif(nullif(rt.representant, ''), 'NON AFFECTE'), e.collaborateur, d.collaborateur_ligne),
    coalesce(e.date_piece, d.date_piece),
    coalesce(e.date_livraison, d.date_livraison),
    coalesce(e.depot_stockage, d.depot),
    d.nb_lignes,
    d.quantite,
    d.montant_ht,
    q.id,
    q.document_id,
    q.reference,
    case
      when d.cdc_reference is null and q.id is null then 'SANS_CDC'
      when q.id is null                             then 'ABSENT'
      when q.archivee                                then 'ARCHIVE'
      else 'S' || q.status_fk::text
    end,
    case
      when d.cdc_reference is null and q.id is null then 'Sans CDC (non rattaché)'
      when q.id is null                             then 'CDC absente de BLG'
      when q.archivee                                then 'Archives'
      else coalesce(sv.libelle, 'Statut ' || q.status_fk::text)
    end,
    case
      when d.cdc_reference is null and q.id is null then 999
      when q.id is null                             then 990
      when q.archivee                                then 900
      else coalesce(sv.ordre, 800)
    end
  from d
  left join public.activite_entete e on e.numero_piece = d.numero_piece
  left join public.ref_tiers rt       on rt.numero = d.numero_tiers
  left join public.collaborateur_alias af
         on af.alias_key = upper(trim(nullif(nullif(rt.representant, ''), 'NON AFFECTE')))
  left join public.collaborateur_alias ap
         on ap.alias_key = upper(trim(coalesce(e.collaborateur, d.collaborateur_ligne)))
  left join lateral (
    select sq.id, sq.document_id, sq.reference, sq.status_fk,
           (sq.internal_tag = 'archive' or sq.archive_reason_fk is not null) as archivee
    from blg.sale_quote sq
    where sq.type = 'sale'
      and sq.reference = coalesce(d.cdc_reference, d.numero_piece)
    order by (sq.internal_tag = 'archive' or sq.archive_reason_fk is not null), sq.id desc
    limit 1
  ) q on true
  left join public.blg_statut_vente sv on sv.status_fk = q.status_fk
$$;
