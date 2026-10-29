-- ============================================================================
-- 20261029_activite_sage_blg_statuts.sql
-- Écran « Activité SAGE ↔ statuts BLG » (/controle-sage-blg/activite-sage-blg)
-- ----------------------------------------------------------------------------
-- Part de l'activité SAGE en cours (public.activite_lignes = image du jour des
-- pièces non facturées : CDC, PL, BL, BR) et range chaque pièce selon le statut
-- BLG de la commande correspondante, regroupé comme le panneau gauche de la
-- liste des ventes BLG (Devis, Devis validé, Commande validée, En cours,
-- À facturer, Terminée, Archives…).
--
-- Règles :
--  * Périmètre SAGE = activite_lignes (snapshot vidé/rechargé à chaque import).
--    activite_entete n'est utilisée que pour enrichir (client, réf., observations,
--    dates, statut SAGE) : elle cumule aussi des pièces déjà transformées.
--  * Lignes d'information REF / FEDEX exclues des comptes (même règle que
--    l'écran Commandes clients SAGE ↔ BLG).
--  * Rattachement à la CDC : CDC = la pièce elle-même ; PL / BL / BR = n° de BC
--    porté par la ligne (numero_piece_bc). Une pièce dont certaines lignes ont
--    une CDC et d'autres non apparaît dans les deux groupes (une ligne de liste
--    par couple pièce × CDC).
--  * Pendant BLG = blg.sale_quote (type sale) dont reference = n° de CDC ; à
--    défaut de CDC, on essaie reference = n° de la pièce SAGE. Groupe :
--      ARCHIVE si archive_reason_fk renseigné, sinon libellé du status_fk via
--      public.blg_statut_vente ; ABSENT si la CDC n'existe pas dans BLG ;
--      SANS_CDC si la pièce SAGE n'est rattachée à aucune CDC.
--  * BL : présence du bon de livraison BLG (movement_movement.reference = n° BL).
--  * Agence = agence du collaborateur de la fiche client (ref_tiers.representant),
--    à défaut celle du collaborateur de la pièce (règle B), sinon NON AFFECTE.
-- ============================================================================

-- ── 1. Libellés des statuts de vente BLG (éditable) ──────────────────────────
create table if not exists public.blg_statut_vente (
  status_fk   integer primary key,
  libelle     text    not null,
  ordre       integer not null,
  a_qualifier boolean not null default false,
  updated_at  timestamptz not null default now()
);

comment on table public.blg_statut_vente is
  'Libellé et ordre d''affichage des status_fk de blg.sale_quote (ventes), calqués sur le panneau gauche BLG. a_qualifier = déduit des données, à confirmer.';

insert into public.blg_statut_vente (status_fk, libelle, ordre, a_qualifier) values
  (56, 'Devis',               10, true),
  (40, 'Devis validé',        20, true),
  (48, 'Commande validée',    40, true),
  (43, 'Commande en cours',   50, false),
  (45, 'Commande à facturer', 60, false),
  (42, 'Commande terminée',   70, false),
  (21, 'Statut 21 (à qualifier)', 80, true)
on conflict (status_fk) do nothing;

alter table public.blg_statut_vente enable row level security;
drop policy if exists blg_statut_vente_select on public.blg_statut_vente;
create policy blg_statut_vente_select on public.blg_statut_vente
  for select to authenticated using (true);
grant select on public.blg_statut_vente to authenticated;

-- ── 2. Index de rapprochement ────────────────────────────────────────────────
create index if not exists idx_movement_movement_reference on blg.movement_movement (reference);

-- ── 3. Lignes SAGE normalisées + pendant BLG ─────────────────────────────────
-- Une ligne par couple (pièce SAGE, CDC de rattachement).
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
      when q.archive_reason_fk is not null          then 'ARCHIVE'
      else 'S' || q.status_fk::text
    end,
    case
      when d.cdc_reference is null and q.id is null then 'Sans CDC (non rattaché)'
      when q.id is null                             then 'CDC absente de BLG'
      when q.archive_reason_fk is not null          then 'Archives'
      else coalesce(sv.libelle, 'Statut ' || q.status_fk::text)
    end,
    case
      when d.cdc_reference is null and q.id is null then 999
      when q.id is null                             then 990
      when q.archive_reason_fk is not null          then 900
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
    select sq.id, sq.document_id, sq.reference, sq.status_fk, sq.archive_reason_fk
    from blg.sale_quote sq
    where sq.type = 'sale'
      and sq.reference = coalesce(d.cdc_reference, d.numero_piece)
    order by sq.archive_reason_fk nulls first, sq.id desc
    limit 1
  ) q on true
  left join public.blg_statut_vente sv on sv.status_fk = q.status_fk
$$;

-- ── 4. Matrice type SAGE × statut BLG ────────────────────────────────────────
create or replace function public.get_activite_sage_blg_matrice(
  p_date_from date default null,
  p_date_to   date default null,
  p_agence    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, blg, sage
set statement_timeout = '60s'
as $$
declare
  v_rows jsonb;
  v_agences jsonb;
  v_totaux jsonb;
  v_import timestamptz;
begin
  select max(imported_at) into v_import from public.activite_lignes;

  -- CTE matérialisée : la fonction de base est évaluée une seule fois, sans
  -- que les filtres soient poussés dedans (plan dégradé constaté sinon).
  with base as materialized (
    select * from public.activite_sage_blg_docs(p_date_from, p_date_to)
  )
  select
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.type_ordre, x.rattache_cdc desc, x.blg_groupe_ordre), '[]'::jsonb)
     from (
       select
         d.type_code,
         d.type_ordre,
         d.rattache_cdc,
         d.blg_groupe_code,
         d.blg_groupe_libelle,
         d.blg_groupe_ordre,
         count(distinct d.numero_piece) as nb_docs,
         sum(d.nb_lignes)               as nb_lignes,
         round(sum(d.montant_ht), 2)    as montant_ht
       from base d
       where p_agence is null or d.agence = p_agence
       group by 1,2,3,4,5,6
     ) x),
    (select coalesce(jsonb_agg(distinct b.agence order by b.agence), '[]'::jsonb) from base b),
    -- Sous-totaux en pièces distinctes : une pièce mixte (lignes avec et
    -- sans CDC, ou plusieurs CDC) ne compte qu'une fois par sous-total.
    (select coalesce(jsonb_agg(jsonb_build_object(
              'cle', coalesce(t.type_code, '*') || '|' ||
                     case when t.g_rat = 1 then '*' when t.rattache_cdc then '1' else '0' end || '|' ||
                     coalesce(t.blg_groupe_code, '*'),
              'nb_docs', t.nb_docs)), '[]'::jsonb)
     from (
       select d.type_code, d.rattache_cdc, d.blg_groupe_code,
              grouping(d.rattache_cdc) as g_rat,
              count(distinct d.type_code || '|' || d.numero_piece) as nb_docs
       from base d
       where p_agence is null or d.agence = p_agence
       group by grouping sets ((d.type_code), (d.type_code, d.rattache_cdc), (d.type_code, d.blg_groupe_code), (d.blg_groupe_code), ())
     ) t)
  into v_rows, v_agences, v_totaux;

  return jsonb_build_object(
    'imported_at', v_import,
    'rows', v_rows,
    'agences', v_agences,
    'totaux', v_totaux,
    'statuts', (
      select coalesce(jsonb_agg(jsonb_build_object('status_fk', status_fk, 'libelle', libelle, 'ordre', ordre, 'a_qualifier', a_qualifier) order by ordre), '[]'::jsonb)
      from public.blg_statut_vente
    )
  );
end;
$$;

-- ── 5. Liste détaillée d'une cellule (ou d'un sous-total) ────────────────────
-- p_type        : CDC | PL | BL | BR (null = tous)
-- p_rattache    : true = rattachées à une CDC, false = non rattachées, null = toutes
-- p_groupe_code : SANS_CDC | ABSENT | ARCHIVE | S<status_fk> (null = tous)
create or replace function public.get_activite_sage_blg_liste(
  p_type        text    default null,
  p_rattache    boolean default null,
  p_groupe_code text    default null,
  p_date_from   date    default null,
  p_date_to     date    default null,
  p_agence      text    default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, blg, sage
set statement_timeout = '60s'
as $$
declare
  v_rows jsonb;
begin
  with base as materialized (
    select * from public.activite_sage_blg_docs(p_date_from, p_date_to)
  ),
  d as materialized (
    select *
    from base d
    where (p_type is null or d.type_code = p_type)
      and (p_rattache is null or d.rattache_cdc = p_rattache)
      and (p_groupe_code is null or d.blg_groupe_code = p_groupe_code)
      and (p_agence is null or d.agence = p_agence)
  ),
  ids as materialized (
    select distinct blg_id from d where blg_id is not null
  ),
  blg_l as materialized (
    select
      ql.quote_fk,
      count(*) filter (where ql.type = 'part')                                         as nb_lignes,
      count(*) filter (where ql.type = 'part' and coalesce(ql.quantity_not_delivered,0) > 0) as nb_lignes_a_livrer,
      sum(coalesce(ql.quantity, 0)) filter (where ql.type = 'part')                    as quantite
    from blg.sale_quote_line ql
    join ids on ids.blg_id = ql.quote_fk
    group by ql.quote_fk
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.date_piece desc nulls last, r.numero_piece), '[]'::jsonb)
    into v_rows
  from (
    select
      d.type_code,
      d.numero_piece,
      d.cdc_reference,
      d.rattache_cdc,
      d.numero_tiers,
      d.intitule_tiers,
      d.agence,
      d.collaborateur,
      d.date_piece,
      d.date_livraison,
      d.depot,
      d.nb_lignes,
      d.quantite,
      round(d.montant_ht, 2) as montant_ht,
      e.etat                 as etat_sage,
      case e.etat
        when '0' then 'Saisi'
        when '1' then 'Confirmé'
        when '2' then case when d.type_code in ('BL','BR') then 'À facturer' else 'Accepté' end
        else e.etat
      end                    as etat_sage_libelle,
      e.reference            as reference_client,
      nullif(trim(concat_ws(' · ', nullif(trim(e.observations), ''), nullif(trim(e.notes), ''))), '') as commentaire,
      e.expedition,
      e.lieu_livraison,
      -- Pendant BLG
      d.blg_id,
      d.blg_document_id,
      d.blg_reference,
      d.blg_groupe_code,
      d.blg_groupe_libelle,
      q.delivery_status      as blg_delivery_status,
      q.invoice_status       as blg_invoice_status,
      q.order_date           as blg_order_date,
      q.created_at           as blg_created_at,
      q.delivery_date_required as blg_date_livraison,
      round(q.amount::numeric, 2) as blg_montant_ht,
      bl.nb_lignes           as blg_nb_lignes,
      bl.nb_lignes_a_livrer  as blg_nb_lignes_a_livrer,
      bl.quantite            as blg_quantite,
      (q.ordered_by_fk is not null and rt.blg_id_tiers is not null
        and q.ordered_by_fk::text = rt.blg_id_tiers::text) as blg_client_ok,
      mv.reference           as blg_bl_reference,
      mv.created_at          as blg_bl_date
    from d
    left join public.activite_entete e on e.numero_piece = d.numero_piece
    left join public.ref_tiers rt       on rt.numero = d.numero_tiers
    left join blg.sale_quote q          on q.id = d.blg_id
    left join blg_l bl                  on bl.quote_fk = d.blg_id
    left join lateral (
      select m.reference, m.created_at
      from blg.movement_movement m
      where d.type_code in ('BL','BR') and m.reference = d.numero_piece
      order by m.id desc
      limit 1
    ) mv on true
  ) r;

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke all on function public.activite_sage_blg_docs(date, date) from public, anon;
revoke all on function public.get_activite_sage_blg_matrice(date, date, text) from public, anon;
revoke all on function public.get_activite_sage_blg_liste(text, boolean, text, date, date, text) from public, anon;
grant execute on function public.activite_sage_blg_docs(date, date) to authenticated;
grant execute on function public.get_activite_sage_blg_matrice(date, date, text) to authenticated;
grant execute on function public.get_activite_sage_blg_liste(text, boolean, text, date, date, text) to authenticated;
