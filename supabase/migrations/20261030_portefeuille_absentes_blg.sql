-- ============================================================================
-- 20261030_portefeuille_absentes_blg.sql
-- Écran « Portefeuille BLG ↔ SAGE » : nouvelle ligne « Absente de BLG » =
-- CDC du portefeuille SAGE (à livrer, PL, BL non facturé) sans commande BLG.
-- Créée aujourd'hui → décalage normal (interface SAGE → BLG de la nuit) ;
-- plus ancienne → à corriger. La clé du cache passe de blg_id à reference
-- (blg_id vide pour ces lignes).
-- ============================================================================

alter table public.portefeuille_blg_sage_cache drop constraint if exists portefeuille_blg_sage_cache_pkey;
alter table public.portefeuille_blg_sage_cache alter column blg_id drop not null;
truncate public.portefeuille_blg_sage_cache;
alter table public.portefeuille_blg_sage_cache add primary key (reference);

create or replace function public.refresh_portefeuille_blg_sage()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, blg, sage
set statement_timeout = '180s'
as $$
declare
  v_n integer;
  v_m integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_portefeuille_blg_sage')) then
    return jsonb_build_object('skipped', true);
  end if;

  truncate public.portefeuille_blg_sage_cache;

  drop table if exists pg_temp.tmp_pf_sa;
  create temporary table tmp_pf_sa on commit drop as
    select case when al.type_document = 'Bon de commande' then al.numero_piece else nullif(trim(al.numero_piece_bc), '') end as cdc,
           bool_or(al.type_document = 'Bon de commande')          as has_bc,
           bool_or(al.type_document = 'Préparation de livraison') as has_pl,
           bool_or(al.type_document = 'Bon de livraison')         as has_bl,
           count(*) as nb,
           sum(coalesce(al.montant_ht, 0)) as mt,
           string_agg(distinct al.numero_piece, ', ') filter (where al.type_document <> 'Bon de commande') as pieces,
           min(al.numero_tiers_entete) as tiers,
           min(al.intitule_tiers_entete) as intitule,
           min(al.collaborateur) as collab,
           min(al.date_piece) as d_piece,
           min(al.date_livraison) as d_liv
    from public.activite_lignes al
    where al.type_document in ('Bon de commande', 'Préparation de livraison', 'Bon de livraison')
      and upper(trim(coalesce(al.reference_article, ''))) not in ('REF', 'FEDEX')
    group by 1;

  with q as materialized (
    select sq.id, sq.document_id, sq.reference, sq.status_fk, sq.ordered_by_fk,
           sq.delivery_status, sq.invoice_status, sq.order_date, sq.last_update, sq.amount,
           (sq.internal_tag = 'archive' or sq.archive_reason_fk is not null) as archivee,
           coalesce(nullif(ar.title::jsonb ->> 'fr_FR', ''), ar.name,
                    case when sq.internal_tag = 'archive' or sq.archive_reason_fk is not null then 'Sans motif' end) as archive_motif
    from blg.sale_quote sq
    left join blg.system_archive_reason ar on ar.id = sq.archive_reason_fk
    where sq.type = 'sale'
      and coalesce(sq.document_sub_type, '') <> 'service'
      and sq.reference like 'CDC%'
      and sq.status_fk in (21, 43, 45, 48)
  ),
  ql as materialized (
    select l.quote_fk,
           count(*) as nb,
           count(*) filter (where coalesce(l.quantity_not_delivered, 0) > 0) as nb_a_livrer,
           sum(coalesce(l.quantity_not_delivered, 0) * coalesce(l.unitary_price, 0) * (1 - coalesce(l.discount, 0))) as reste
    from blg.sale_quote_line l
    join q on q.id = l.quote_fk
    where l.type = 'part'
    group by l.quote_fk
  ),
  sa as materialized (select * from tmp_pf_sa),
  fa as materialized (
    select fl.numero_piece_bc as cdc,
           count(distinct fl.numero_piece) as nb_fact,
           sum(coalesce(fl.montant_ht, 0)) as mt,
           max(fl.date_facture) as dmax,
           string_agg(distinct fl.numero_piece, ', ') as factures,
           min(fl.numero_tiers_entete) as tiers,
           min(fl.intitule_tiers_entete) as intitule
    from public.facture_lignes fl
    join q on q.reference = fl.numero_piece_bc
    group by fl.numero_piece_bc
  ),
  base as (
    select q.*,
           ql.nb, ql.nb_a_livrer, ql.reste,
           sa.has_bc, sa.has_pl, sa.has_bl, sa.nb as sa_nb, sa.mt as sa_mt, sa.pieces,
           fa.nb_fact, fa.mt as fa_mt, fa.dmax, fa.factures, fa.tiers as fa_tiers, fa.intitule as fa_intitule,
           e.numero_tiers as e_tiers, e.intitule_tiers as e_intitule, e.date_piece as e_date, e.date_livraison as e_liv,
           e.collaborateur as e_collab,
           case
             when q.archivee then 'ARCHIVE'
             else 'S' || q.status_fk::text
           end as statut_code,
           case
             when coalesce(sa.has_bc, false) then 'A_LIVRER'
             when coalesce(sa.has_pl, false) then 'PL'
             when coalesce(sa.has_bl, false) then 'BL'
             when fa.cdc is not null then 'FACTUREE'
             when e.numero_piece is not null then 'SOLDEE'
             else 'ABSENTE'
           end as situation_code
    from q
    left join ql on ql.quote_fk = q.id
    left join sa on sa.cdc = q.reference
    left join fa on fa.cdc = q.reference
    left join public.activite_entete e on e.numero_piece = q.reference
  )
  insert into public.portefeuille_blg_sage_cache (
    blg_id, blg_document_id, reference, statut_code, statut_libelle, statut_ordre, blg_status_fk, archivee, archive_motif,
    blg_delivery_status, blg_invoice_status, blg_order_date, blg_last_update, blg_montant_ht, blg_reste_ht,
    blg_nb_lignes, blg_nb_lignes_a_livrer, numero_tiers, intitule_tiers, agence, collaborateur,
    situation_code, situation_libelle, situation_ordre, verdict,
    sage_montant_en_cours, sage_nb_lignes_en_cours, sage_pieces_en_cours, sage_date_creation, sage_date_livraison,
    sage_montant_facture, sage_nb_factures, sage_factures, sage_derniere_facture, facture_recente, lien_blg, refreshed_at
  )
  select
    b.id, b.document_id, b.reference, b.statut_code,
    case b.statut_code when 'ARCHIVE' then 'Archivée (ex-ouverte)' else coalesce(sv.libelle, 'Statut ' || b.status_fk::text) end,
    case b.statut_code when 'ARCHIVE' then 900 else coalesce(sv.ordre, 800) end,
    b.status_fk, b.archivee, b.archive_motif,
    b.delivery_status, b.invoice_status, b.order_date, b.last_update, round(b.amount::numeric, 2), round(coalesce(b.reste, 0)::numeric, 2),
    coalesce(b.nb, 0), coalesce(b.nb_a_livrer, 0),
    coalesce(rt.numero, b.e_tiers, b.fa_tiers),
    coalesce(rt.intitule, b.e_intitule, b.fa_intitule),
    coalesce(af.agence, ap.agence, 'NON AFFECTE'),
    coalesce(nullif(nullif(rt.representant, ''), 'NON AFFECTE'), b.e_collab),
    b.situation_code,
    case b.situation_code
      when 'A_LIVRER' then 'CDC à livrer dans SAGE'
      when 'PL'       then 'En préparation (PL)'
      when 'BL'       then 'BL non facturé'
      when 'FACTUREE' then 'Soldée dans SAGE, facturée'
      when 'SOLDEE'   then 'Soldée dans SAGE, sans facture'
      else 'Absente de SAGE'
    end,
    case b.situation_code when 'A_LIVRER' then 1 when 'PL' then 2 when 'BL' then 3 when 'FACTUREE' then 4 when 'SOLDEE' then 5 else 6 end,
    case
      when b.statut_code = 'ARCHIVE' then
        case when b.situation_code in ('A_LIVRER', 'PL', 'BL') then 'A_CORRIGER' else 'OK' end
      when b.statut_code = 'S45' then
        case b.situation_code when 'BL' then 'OK' when 'FACTUREE' then 'A_ANALYSER' when 'A_LIVRER' then 'A_ANALYSER' when 'PL' then 'A_ANALYSER' else 'A_CORRIGER' end
      else
        case b.situation_code when 'A_LIVRER' then 'OK' when 'PL' then 'OK' when 'BL' then 'DECALAGE' else 'A_CORRIGER' end
    end,
    round(coalesce(b.sa_mt, 0)::numeric, 2), coalesce(b.sa_nb, 0), b.pieces, b.e_date, nullif(b.e_liv, date '1753-01-01'),
    round(coalesce(b.fa_mt, 0)::numeric, 2), coalesce(b.nb_fact, 0), b.factures, b.dmax,
    coalesce(b.dmax >= current_date - 2, false),
    case when b.document_id is not null then 'https://app.blgcloud.com/dakar-11/?app/sale/order/edit/' || b.document_id || '#' end,
    now()
  from base b
  left join public.blg_statut_vente sv on sv.status_fk = b.status_fk
  left join lateral (
    select t.numero, t.intitule, t.representant from public.ref_tiers t
    where b.ordered_by_fk is not null and t.blg_id_tiers = b.ordered_by_fk::text
    order by t.numero limit 1
  ) rt on true
  left join public.collaborateur_alias af on af.alias_key = upper(trim(nullif(nullif(rt.representant, ''), 'NON AFFECTE')))
  left join public.collaborateur_alias ap on ap.alias_key = upper(trim(b.e_collab));

  get diagnostics v_n = row_count;

  -- CDC présentes dans le portefeuille SAGE mais absentes de BLG (toutes
  -- ventes BLG confondues, quel que soit le statut). Créée aujourd'hui (date
  -- de pièce ≥ jour) = attend l'interface SAGE → BLG de la nuit ; sinon à
  -- corriger (interface).
  insert into public.portefeuille_blg_sage_cache (
    blg_id, blg_document_id, reference, statut_code, statut_libelle, statut_ordre, blg_status_fk, archivee, archive_motif,
    blg_montant_ht, blg_reste_ht, blg_nb_lignes, blg_nb_lignes_a_livrer,
    numero_tiers, intitule_tiers, agence, collaborateur,
    situation_code, situation_libelle, situation_ordre, verdict,
    sage_montant_en_cours, sage_nb_lignes_en_cours, sage_pieces_en_cours, sage_date_creation, sage_date_livraison,
    sage_montant_facture, sage_nb_factures, facture_recente, refreshed_at
  )
  select
    null, null, sa.cdc, 'ABSENT_BLG', 'Absente de BLG', 5, null, false, null,
    0, 0, 0, 0,
    coalesce(e.numero_tiers, sa.tiers),
    coalesce(e.intitule_tiers, sa.intitule),
    coalesce(af.agence, ap.agence, 'NON AFFECTE'),
    coalesce(nullif(nullif(rt.representant, ''), 'NON AFFECTE'), e.collaborateur, sa.collab),
    case when sa.has_bc then 'A_LIVRER' when sa.has_pl then 'PL' else 'BL' end,
    case when sa.has_bc then 'CDC à livrer dans SAGE' when sa.has_pl then 'En préparation (PL)' else 'BL non facturé' end,
    case when sa.has_bc then 1 when sa.has_pl then 2 else 3 end,
    case when coalesce(e.date_piece, sa.d_piece) >= current_date then 'DECALAGE' else 'A_CORRIGER' end,
    round(coalesce(sa.mt, 0)::numeric, 2), coalesce(sa.nb, 0), sa.pieces,
    coalesce(e.date_piece, sa.d_piece), nullif(coalesce(e.date_livraison, sa.d_liv), date '1753-01-01'),
    0, 0, false, now()
  from tmp_pf_sa sa
  left join public.activite_entete e on e.numero_piece = sa.cdc
  left join public.ref_tiers rt on rt.numero = coalesce(e.numero_tiers, sa.tiers)
  left join public.collaborateur_alias af on af.alias_key = upper(trim(nullif(nullif(rt.representant, ''), 'NON AFFECTE')))
  left join public.collaborateur_alias ap on ap.alias_key = upper(trim(coalesce(e.collaborateur, sa.collab)))
  where sa.cdc is not null
    and not exists (select 1 from blg.sale_quote x where x.type = 'sale' and x.reference = sa.cdc);

  get diagnostics v_m = row_count;
  v_n := v_n + v_m;
  return jsonb_build_object('rows', v_n, 'refreshed_at', now());
end;
$$;

select public.refresh_portefeuille_blg_sage();
