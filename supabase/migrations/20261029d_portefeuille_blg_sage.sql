-- ============================================================================
-- 20261029d_portefeuille_blg_sage.sql  (appliquée en production le 29/10/2026 à 23:03 UTC,
-- migration « portefeuille_blg_sage »)
-- Portefeuille BLG -> SAGE : commandes BLG ouvertes (validée / en cours / à facturer) et archivées,
-- positionnées selon leur situation dans SAGE. Cache rafraîchi chaque heure (h+42) et à la demande.
-- Écran : app/controle-sage-blg/portefeuille-blg-sage/page.tsx
-- ============================================================================

create table if not exists public.portefeuille_blg_sage_cache (
  blg_id                 integer primary key,
  blg_document_id        text,
  reference              text not null,
  statut_code            text not null,
  statut_libelle         text not null,
  statut_ordre           integer not null,
  blg_status_fk          integer,
  archivee               boolean not null,
  archive_motif          text,
  blg_delivery_status    text,
  blg_invoice_status     text,
  blg_order_date         date,
  blg_last_update        timestamptz,
  blg_montant_ht         numeric,
  blg_reste_ht           numeric,
  blg_nb_lignes          integer,
  blg_nb_lignes_a_livrer integer,
  numero_tiers           text,
  intitule_tiers         text,
  agence                 text,
  collaborateur          text,
  situation_code         text not null,
  situation_libelle      text not null,
  situation_ordre        integer not null,
  verdict                text not null,
  sage_montant_en_cours  numeric,
  sage_nb_lignes_en_cours integer,
  sage_pieces_en_cours   text,
  sage_date_creation     date,
  sage_date_livraison    date,
  sage_montant_facture   numeric,
  sage_nb_factures       integer,
  sage_factures          text,
  sage_derniere_facture  date,
  facture_recente        boolean not null default false,
  lien_blg               text,
  refreshed_at           timestamptz not null default now()
);

create index if not exists idx_pf_blg_sage_cell on public.portefeuille_blg_sage_cache (statut_code, situation_code);

alter table public.portefeuille_blg_sage_cache enable row level security;
drop policy if exists portefeuille_blg_sage_cache_read on public.portefeuille_blg_sage_cache;
create policy portefeuille_blg_sage_cache_read on public.portefeuille_blg_sage_cache for select to authenticated using (true);
revoke all on public.portefeuille_blg_sage_cache from anon;
grant select on public.portefeuille_blg_sage_cache to authenticated;

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
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_portefeuille_blg_sage')) then
    return jsonb_build_object('skipped', true);
  end if;

  truncate public.portefeuille_blg_sage_cache;

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
  sa as materialized (
    select case when al.type_document = 'Bon de commande' then al.numero_piece else nullif(trim(al.numero_piece_bc), '') end as cdc,
           bool_or(al.type_document = 'Bon de commande')          as has_bc,
           bool_or(al.type_document = 'Préparation de livraison') as has_pl,
           bool_or(al.type_document = 'Bon de livraison')         as has_bl,
           count(*) as nb,
           sum(coalesce(al.montant_ht, 0)) as mt,
           string_agg(distinct al.numero_piece, ', ') filter (where al.type_document <> 'Bon de commande') as pieces
    from public.activite_lignes al
    where al.type_document in ('Bon de commande', 'Préparation de livraison', 'Bon de livraison')
      and upper(trim(coalesce(al.reference_article, ''))) not in ('REF', 'FEDEX')
    group by 1
  ),
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
  return jsonb_build_object('rows', v_n, 'refreshed_at', now());
end;
$$;

revoke all on function public.refresh_portefeuille_blg_sage() from public, anon;
grant execute on function public.refresh_portefeuille_blg_sage() to authenticated;

-- Matrice : lignes = statut BLG, colonnes = situation SAGE
create or replace function public.get_portefeuille_blg_sage_matrice(p_agence text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'refreshed_at', (select max(refreshed_at) from portefeuille_blg_sage_cache),
    'blg_synchro', (select max(synced_at) from blg.sale_quote),
    'sage_import', (select max(imported_at) from activite_lignes),
    'agences', coalesce((select jsonb_agg(distinct agence order by agence) from portefeuille_blg_sage_cache), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.statut_ordre, x.situation_ordre) from (
       select statut_code, statut_libelle, statut_ordre, situation_code, situation_libelle, situation_ordre, verdict,
              count(*) as nb,
              count(*) filter (where facture_recente) as nb_recent,
              round(sum(blg_montant_ht), 2) as blg_montant_ht,
              round(sum(blg_reste_ht), 2) as blg_reste_ht,
              round(sum(sage_montant_en_cours), 2) as sage_montant_en_cours,
              round(sum(sage_montant_facture), 2) as sage_montant_facture
       from portefeuille_blg_sage_cache
       where p_agence is null or agence = p_agence
       group by 1,2,3,4,5,6,7) x), '[]'::jsonb)
  )
$$;

create or replace function public.get_portefeuille_blg_sage_liste(
  p_statut text default null, p_situation text default null, p_verdict text default null, p_agence text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('rows', coalesce(jsonb_agg(to_jsonb(c) order by c.blg_reste_ht desc nulls last, c.reference), '[]'::jsonb))
  from portefeuille_blg_sage_cache c
  where (p_statut is null or c.statut_code = p_statut)
    and (p_situation is null or c.situation_code = p_situation)
    and (p_verdict is null or c.verdict = p_verdict)
    and (p_agence is null or c.agence = p_agence)
$$;

revoke all on function public.get_portefeuille_blg_sage_matrice(text) from public, anon;
revoke all on function public.get_portefeuille_blg_sage_liste(text, text, text, text) from public, anon;
grant execute on function public.get_portefeuille_blg_sage_matrice(text) to authenticated;
grant execute on function public.get_portefeuille_blg_sage_liste(text, text, text, text) to authenticated;

select cron.schedule('portefeuille-blg-sage-hourly', '42 * * * *', 'select public.refresh_portefeuille_blg_sage()');
