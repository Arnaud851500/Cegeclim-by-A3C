-- ============================================================================
-- 20261030b_portefeuille_achats_blg_sage.sql
-- Écran « Portefeuille BLG ↔ SAGE » : volet Achats (commandes fournisseurs).
--  * Cache commun portefeuille_blg_sage_cache + colonne domaine (VENTE / ACHAT).
--  * BLG : commandes d'achat CDF (blg.sale_quote type purchase) aux statuts
--    ouverts 14 / 20 / 50 / 51, archivées, et terminées (30) seulement si la CDF
--    est encore dans le portefeuille SAGE. Libellés : table blg_statut_achat
--    (déduits des données, à confirmer).
--  * SAGE : sage.bdcf = pièces d'achat ouvertes — CDF à recevoir (type 12),
--    BLF non facturés (13, rattachés par al_dlpiecebc), factures FAF récentes (16).
--    Situations : A_RECEVOIR, BLF, FAF (facturée récemment), SORTIE (plus dans
--    le portefeuille SAGE : réceptionnée et facturée, ou supprimée).
--  * Ligne « Absente de BLG » : CDF SAGE sans commande d'achat BLG ; datée du
--    jour = décalage normal, sinon à corriger.
--  * refresh_portefeuille_blg_sage() recalcule ventes puis achats ; les RPC
--    matrice / liste prennent p_domaine ('VENTE' par défaut).
-- ============================================================================

alter table public.portefeuille_blg_sage_cache add column if not exists domaine text not null default 'VENTE';
create index if not exists idx_pf_blg_sage_domaine on public.portefeuille_blg_sage_cache (domaine, statut_code, situation_code);

create table if not exists public.blg_statut_achat (
  status_fk   integer primary key,
  libelle     text    not null,
  ordre       integer not null,
  a_qualifier boolean not null default true,
  updated_at  timestamptz not null default now()
);
comment on table public.blg_statut_achat is
  'Libellé et ordre des status_fk des commandes d''achat BLG (blg.sale_quote type purchase). a_qualifier = déduit des données, à confirmer.';
insert into public.blg_statut_achat (status_fk, libelle, ordre, a_qualifier) values
  (20, 'Commande en cours',        20, true),
  (50, 'Réception partielle',      30, true),
  (14, 'Réceptionnée, à facturer', 40, true),
  (51, 'Facturée partiellement',   50, true),
  (30, 'Terminée',                 70, true)
on conflict (status_fk) do nothing;
alter table public.blg_statut_achat enable row level security;
drop policy if exists blg_statut_achat_select on public.blg_statut_achat;
create policy blg_statut_achat_select on public.blg_statut_achat for select to authenticated using (true);
grant select on public.blg_statut_achat to authenticated;

create or replace function public.refresh_portefeuille_blg_sage_achats()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, blg, sage
set statement_timeout = '120s'
as $$
declare
  v_n integer;
  v_m integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_portefeuille_blg_sage_achats')) then
    return jsonb_build_object('skipped', true);
  end if;

  delete from public.portefeuille_blg_sage_cache where domaine = 'ACHAT';

  drop table if exists pg_temp.tmp_pf_sa_achat;
  create temporary table tmp_pf_sa_achat on commit drop as
    select case when b.al_doctype = '12' then b.al_docnum else nullif(trim(b.al_dlpiecebc), '') end as cdf,
           bool_or(b.al_doctype = '12') as has_cdf,
           bool_or(b.al_doctype = '13') as has_blf,
           bool_or(b.al_doctype = '16') as has_faf,
           count(*) filter (where b.al_doctype in ('12', '13')) as nb,
           sum(coalesce(b.cahtnet, 0)) filter (where b.al_doctype in ('12', '13')) as mt,
           sum(coalesce(b.cahtnet, 0)) filter (where b.al_doctype = '16') as mt_fact,
           count(distinct b.al_docnum) filter (where b.al_doctype = '16') as nb_fact,
           string_agg(distinct b.al_docnum, ', ') filter (where b.al_doctype = '13') as blf,
           string_agg(distinct b.al_docnum, ', ') filter (where b.al_doctype = '16') as faf,
           min(b.al_ctnum) as tiers,
           min(b.al_deno) as depot,
           min(public.sage_date_text_to_date(b.al_dldatebc)) as d_cdf,
           min(public.sage_date_text_to_date(b.al_dodatelivr)) filter (where b.al_doctype = '12') as d_liv
    from sage.bdcf b
    where b.al_doctype in ('12', '13', '16')
      and upper(trim(coalesce(b.al_art_num, ''))) not in ('REF', 'FEDEX')
    group by 1;

  with q as materialized (
    select sq.id, sq.document_id, sq.reference, sq.status_fk, sq.supplier_fk, sq.delivery_fk,
           sq.delivery_status, sq.invoice_status, sq.order_date, sq.last_update, sq.amount,
           (sq.internal_tag = 'archive' or sq.archive_reason_fk is not null) as archivee,
           coalesce(nullif(ar.title::jsonb ->> 'fr_FR', ''), ar.name,
                    case when sq.internal_tag = 'archive' or sq.archive_reason_fk is not null then 'Sans motif' end) as archive_motif
    from blg.sale_quote sq
    left join blg.system_archive_reason ar on ar.id = sq.archive_reason_fk
    where sq.type = 'purchase'
      and sq.reference like 'CDF%'
      and (   sq.status_fk in (14, 20, 50, 51)
           or sq.internal_tag = 'archive' or sq.archive_reason_fk is not null
           or exists (select 1 from tmp_pf_sa_achat s where s.cdf = sq.reference))
  ),
  ql as materialized (
    select l.quote_fk,
           count(*) as l_nb,
           count(*) filter (where coalesce(l.quantity_not_delivered, 0) > 0) as nb_a_livrer,
           sum(coalesce(l.quantity_not_delivered, 0) * coalesce(l.purchase_price, 0)) as reste
    from blg.sale_quote_line l
    join q on q.id = l.quote_fk
    where l.type = 'part'
    group by l.quote_fk
  ),
  base as (
    select q.*, ql.l_nb, ql.nb_a_livrer, ql.reste, s.*,
           case when q.archivee then 'ARCHIVE' else 'S' || q.status_fk::text end as statut_code,
           case
             when coalesce(s.has_cdf, false) then 'A_RECEVOIR'
             when coalesce(s.has_blf, false) then 'BLF'
             when coalesce(s.has_faf, false) then 'FAF'
             else 'SORTIE'
           end as situation_code
    from q
    left join ql on ql.quote_fk = q.id
    left join tmp_pf_sa_achat s on s.cdf = q.reference
  )
  insert into public.portefeuille_blg_sage_cache (
    domaine, blg_id, blg_document_id, reference, statut_code, statut_libelle, statut_ordre, blg_status_fk, archivee, archive_motif,
    blg_delivery_status, blg_invoice_status, blg_order_date, blg_last_update, blg_montant_ht, blg_reste_ht,
    blg_nb_lignes, blg_nb_lignes_a_livrer, numero_tiers, intitule_tiers, agence, collaborateur,
    situation_code, situation_libelle, situation_ordre, verdict,
    sage_montant_en_cours, sage_nb_lignes_en_cours, sage_pieces_en_cours, sage_date_creation, sage_date_livraison,
    sage_montant_facture, sage_nb_factures, sage_factures, sage_derniere_facture, facture_recente, lien_blg, refreshed_at
  )
  select
    'ACHAT', b.id, b.document_id, b.reference, b.statut_code,
    case b.statut_code when 'ARCHIVE' then 'Archivée' else coalesce(st.libelle, 'Statut ' || b.status_fk::text) end,
    case b.statut_code when 'ARCHIVE' then 900 else coalesce(st.ordre, 800) end,
    b.status_fk, b.archivee, b.archive_motif,
    b.delivery_status, b.invoice_status, b.order_date, b.last_update, round(b.amount::numeric, 2), round(coalesce(b.reste, 0)::numeric, 2),
    coalesce(b.l_nb, 0), coalesce(b.nb_a_livrer, 0),
    coalesce(nullif(regexp_replace(f.code_fournisseur, '^[fF]', ''), ''), b.tiers),
    f.nom_fournisseur,
    coalesce(dl.company_name, b.depot),
    null,
    b.situation_code,
    case b.situation_code
      when 'A_RECEVOIR' then 'CDF à recevoir dans SAGE'
      when 'BLF'        then 'BLF non facturé'
      when 'FAF'        then 'Facturée récemment (FAF)'
      else 'Sortie du portefeuille SAGE'
    end,
    case b.situation_code when 'A_RECEVOIR' then 1 when 'BLF' then 2 when 'FAF' then 3 else 4 end,
    case b.statut_code
      when 'ARCHIVE' then case when b.situation_code in ('A_RECEVOIR', 'BLF') then 'A_CORRIGER' else 'OK' end
      when 'S20' then case b.situation_code when 'A_RECEVOIR' then 'OK' else 'A_CORRIGER' end
      when 'S50' then case b.situation_code when 'A_RECEVOIR' then 'OK' when 'BLF' then 'A_ANALYSER' else 'A_CORRIGER' end
      when 'S14' then case b.situation_code when 'BLF' then 'OK' when 'FAF' then 'DECALAGE' else 'A_ANALYSER' end
      when 'S51' then case b.situation_code when 'A_RECEVOIR' then 'OK' when 'BLF' then 'OK' when 'FAF' then 'DECALAGE' else 'A_ANALYSER' end
      when 'S30' then case b.situation_code when 'A_RECEVOIR' then 'A_CORRIGER' when 'BLF' then 'A_ANALYSER' else 'OK' end
      else 'A_ANALYSER'
    end,
    round(coalesce(b.mt, 0)::numeric, 2), coalesce(b.nb, 0), b.blf, b.d_cdf, b.d_liv,
    round(coalesce(b.mt_fact, 0)::numeric, 2), coalesce(b.nb_fact, 0), b.faf, null, coalesce(b.has_faf, false),
    case when b.document_id is not null then 'https://app.blgcloud.com/dakar-11/?app/purchase/order/edit/' || b.document_id || '#' end,
    now()
  from base b
  left join public.blg_statut_achat st on st.status_fk = b.status_fk
  left join public.v_appro_fournisseurs f on f.supplier_id = b.supplier_fk
  left join blg.partner_base_partner dl on dl.id = b.delivery_fk;

  get diagnostics v_n = row_count;

  -- CDF SAGE (à recevoir / BLF) sans commande d'achat BLG
  insert into public.portefeuille_blg_sage_cache (
    domaine, blg_id, blg_document_id, reference, statut_code, statut_libelle, statut_ordre, blg_status_fk, archivee, archive_motif,
    blg_montant_ht, blg_reste_ht, blg_nb_lignes, blg_nb_lignes_a_livrer,
    numero_tiers, intitule_tiers, agence, collaborateur,
    situation_code, situation_libelle, situation_ordre, verdict,
    sage_montant_en_cours, sage_nb_lignes_en_cours, sage_pieces_en_cours, sage_date_creation, sage_date_livraison,
    sage_montant_facture, sage_nb_factures, sage_factures, facture_recente, refreshed_at
  )
  select
    'ACHAT', null, null, s.cdf, 'ABSENT_BLG', 'Absente de BLG', 5, null, false, null,
    0, 0, 0, 0,
    s.tiers, f.nom_fournisseur, s.depot, null,
    case when s.has_cdf then 'A_RECEVOIR' when s.has_blf then 'BLF' else 'FAF' end,
    case when s.has_cdf then 'CDF à recevoir dans SAGE' when s.has_blf then 'BLF non facturé' else 'Facturée récemment (FAF)' end,
    case when s.has_cdf then 1 when s.has_blf then 2 else 3 end,
    case when s.d_cdf >= current_date then 'DECALAGE' when not (s.has_cdf or s.has_blf) then 'A_ANALYSER' else 'A_CORRIGER' end,
    round(coalesce(s.mt, 0)::numeric, 2), coalesce(s.nb, 0), s.blf, s.d_cdf, s.d_liv,
    round(coalesce(s.mt_fact, 0)::numeric, 2), coalesce(s.nb_fact, 0), s.faf, coalesce(s.has_faf, false), now()
  from tmp_pf_sa_achat s
  left join lateral (
    select v.nom_fournisseur from public.v_appro_fournisseurs v
    where upper(v.code_fournisseur) = upper('F' || s.tiers) limit 1
  ) f on true
  where s.cdf is not null
    and (s.has_cdf or s.has_blf)
    and not exists (select 1 from blg.sale_quote x where x.type = 'purchase' and x.reference = s.cdf);

  get diagnostics v_m = row_count;
  return jsonb_build_object('rows', v_n + v_m, 'refreshed_at', now());
end;
$$;

revoke all on function public.refresh_portefeuille_blg_sage_achats() from public, anon;
grant execute on function public.refresh_portefeuille_blg_sage_achats() to authenticated;

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
  v_achats jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_portefeuille_blg_sage')) then
    return jsonb_build_object('skipped', true);
  end if;

  delete from public.portefeuille_blg_sage_cache where domaine = 'VENTE';

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

  -- Achats (commandes fournisseurs) recalculés dans la même passe
  v_achats := public.refresh_portefeuille_blg_sage_achats();

  return jsonb_build_object('rows', v_n, 'achats', v_achats -> 'rows', 'refreshed_at', now());
end;
$$;

drop function if exists public.get_portefeuille_blg_sage_matrice(text);
drop function if exists public.get_portefeuille_blg_sage_liste(text, text, text, text);

create or replace function public.get_portefeuille_blg_sage_matrice(p_agence text default null, p_domaine text default 'VENTE')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'domaine', p_domaine,
    'refreshed_at', (select max(refreshed_at) from portefeuille_blg_sage_cache where domaine = p_domaine),
    'blg_synchro', (select max(synced_at) from blg.sale_quote),
    'sage_import', case when p_domaine = 'ACHAT' then (select max(loaded_at) from sage.bdcf) else (select max(imported_at) from activite_lignes) end,
    'agences', coalesce((select jsonb_agg(distinct agence order by agence) from portefeuille_blg_sage_cache where domaine = p_domaine and agence is not null), '[]'::jsonb),
    'statuts_a_qualifier', case when p_domaine = 'ACHAT'
        then coalesce((select jsonb_agg('S' || status_fk) from blg_statut_achat where a_qualifier), '[]'::jsonb)
        else coalesce((select jsonb_agg('S' || status_fk) from blg_statut_vente where a_qualifier), '[]'::jsonb) end,
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.statut_ordre, x.situation_ordre) from (
       select statut_code, statut_libelle, statut_ordre, situation_code, situation_libelle, situation_ordre, verdict,
              count(*) as nb,
              count(*) filter (where facture_recente) as nb_recent,
              round(sum(blg_montant_ht), 2) as blg_montant_ht,
              round(sum(blg_reste_ht), 2) as blg_reste_ht,
              round(sum(sage_montant_en_cours), 2) as sage_montant_en_cours,
              round(sum(sage_montant_facture), 2) as sage_montant_facture
       from portefeuille_blg_sage_cache
       where domaine = p_domaine and (p_agence is null or agence = p_agence)
       group by 1,2,3,4,5,6,7) x), '[]'::jsonb)
  )
$$;

create or replace function public.get_portefeuille_blg_sage_liste(
  p_statut text default null, p_situation text default null, p_verdict text default null, p_agence text default null,
  p_domaine text default 'VENTE')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(c) order by c.blg_reste_ht desc nulls last, c.reference), '[]'::jsonb))
  from portefeuille_blg_sage_cache c
  where c.domaine = p_domaine
    and (p_statut is null or c.statut_code = p_statut)
    and (p_situation is null or c.situation_code = p_situation)
    and (p_verdict is null or c.verdict = p_verdict)
    and (p_agence is null or c.agence = p_agence)
$$;

revoke all on function public.get_portefeuille_blg_sage_matrice(text, text) from public, anon;
revoke all on function public.get_portefeuille_blg_sage_liste(text, text, text, text, text) from public, anon;
grant execute on function public.get_portefeuille_blg_sage_matrice(text, text) to authenticated;
grant execute on function public.get_portefeuille_blg_sage_liste(text, text, text, text, text) to authenticated;

select public.refresh_portefeuille_blg_sage();
