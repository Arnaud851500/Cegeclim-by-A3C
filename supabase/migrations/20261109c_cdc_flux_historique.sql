-- 20261109c_cdc_flux_historique.sql
--
-- Reprise de l'historique du flux des CDC à partir des fichiers archivés
-- (bucket sage-imports, dossier archive/ : Activite_non_facture-AAAAMMJJ_HHMMSS.csv
-- et Entete_activite_non_fac-AAAAMMJJ_HHMMSS.csv, horodatage UTC du run d'import).
--
-- L'Edge Function « cdc-flux-historique » lit les instantanés deux à deux, du plus
-- ancien au plus récent, les compacte par (CDC, article) dans cdc_flux_hist_lignes /
-- cdc_flux_hist_entetes, puis appelle cdc_flux_hist_comparer() qui applique EXACTEMENT
-- la même classification que la capture en direct (cdc_flux_capturer).
-- Les événements repris portent source = 'historique', lot_id null,
-- periode_debut = instantané précédent, detecte_at = instantané suivant.
-- La reprise s'arrête au dernier fichier avant la mise en service de la capture en
-- direct (lot 103 du 09/11/2026, fichier 20261109_110038) pour ne rien compter deux fois.

alter table public.cdc_flux_evenements add column if not exists source text not null default 'lot';

create table if not exists public.cdc_flux_hist_lignes (
  snap         text not null,
  kind         char(1) not null,          -- 'C' = ligne de CDC, 'A' = aval (PL / BL / FA) rattaché à une CDC
  cdc          text not null,
  art          text not null,
  qte          numeric,
  nb           integer,
  mt           numeric,
  tiers        text,
  rep          text,
  designation  text,
  date_piece   date,
  pieces       text
);
create index if not exists idx_cdc_flux_hist_lignes on public.cdc_flux_hist_lignes (snap, kind, cdc, art);

create table if not exists public.cdc_flux_hist_entetes (
  snap            text not null,
  numero_piece    text not null,
  numero_tiers    text,
  date_piece      date,
  date_livraison  date
);
create index if not exists idx_cdc_flux_hist_entetes on public.cdc_flux_hist_entetes (snap, numero_piece);

create table if not exists public.cdc_flux_hist_snaps (
  snap          text primary key,
  ts            timestamptz not null,
  nb_lignes     integer,
  nb_lignes_cdc integer,
  nb_cdc        integer,
  nb_aval       integer,
  nb_aval_bc    integer,
  nb_entetes    integer,
  statut        text not null,             -- charge | traite | ignore
  motif         text,
  nb_evenements integer,
  traite_at     timestamptz default now()
);

create table if not exists public.cdc_flux_hist_progress (
  id               integer primary key default 1 check (id = 1),
  jeton            uuid not null default gen_random_uuid(),
  coupure          text not null default '20261109_110038',
  dernier_snap_ok  text,
  termine          boolean not null default false,
  message          text,
  updated_at       timestamptz not null default now()
);
insert into public.cdc_flux_hist_progress (id) values (1) on conflict (id) do nothing;

alter table public.cdc_flux_hist_lignes   enable row level security;
alter table public.cdc_flux_hist_entetes  enable row level security;
alter table public.cdc_flux_hist_snaps    enable row level security;
alter table public.cdc_flux_hist_progress enable row level security;
revoke all on public.cdc_flux_hist_lignes, public.cdc_flux_hist_entetes,
              public.cdc_flux_hist_snaps, public.cdc_flux_hist_progress from anon, authenticated;

-- Instantanés disponibles (activité + entête présents au même horodatage), triés
create or replace function public.cdc_flux_hist_paires()
returns table (snap text, ts timestamptz)
language sql
security definer
set search_path to 'public', 'storage'
as $$
  with a as (
    select substring(name from 'Activite_non_facture-(\d{8}_\d{6})\.csv$') s
      from storage.objects
     where bucket_id = 'sage-imports' and name ~ '^archive/Activite_non_facture-\d{8}_\d{6}\.csv$'),
  e as (
    select substring(name from 'Entete_activite_non_fac-(\d{8}_\d{6})\.csv$') s
      from storage.objects
     where bucket_id = 'sage-imports' and name ~ '^archive/Entete_activite_non_fac-\d{8}_\d{6}\.csv$')
  select a.s, to_timestamp(a.s, 'YYYYMMDD_HH24MISS') at time zone 'UTC'
    from a join e on e.s = a.s
   where a.s <= (select coupure from public.cdc_flux_hist_progress where id = 1)
   order by a.s;
$$;
revoke all on function public.cdc_flux_hist_paires() from public, anon, authenticated;

-- Comparaison de deux instantanés compactés : même classification que cdc_flux_capturer
create or replace function public.cdc_flux_hist_comparer(p_av text, p_ap text)
returns integer
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_debut   timestamptz := to_timestamp(p_av, 'YYYYMMDD_HH24MISS') at time zone 'UTC';
  v_detecte timestamptz := to_timestamp(p_ap, 'YYYYMMDD_HH24MISS') at time zone 'UTC';
  v_n       integer;
begin
  -- rejouable : on efface ce qui aurait déjà été repris pour cette paire
  delete from public.cdc_flux_evenements
   where source = 'historique' and detecte_at = v_detecte;

  with
  av_cdc  as (select * from public.cdc_flux_hist_lignes where snap = p_av and kind = 'C'),
  ap_cdc  as (select * from public.cdc_flux_hist_lignes where snap = p_ap and kind = 'C'),
  av_aval as (select * from public.cdc_flux_hist_lignes where snap = p_av and kind = 'A'),
  ap_aval as (select * from public.cdc_flux_hist_lignes where snap = p_ap and kind = 'A'),
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
    (source, lot_id, detecte_at, periode_debut, niveau, type_evenement, cdc, numero_tiers, representant_piece, date_piece,
     article, designation, qte_avant, qte_apres, qte_transformee, qte_non_expliquee,
     nb_lignes_avant, nb_lignes_apres, montant_ht_avant, montant_ht_apres, montant_non_explique, pieces_aval)
  select 'historique', null, v_detecte, v_debut, 'LIGNE', type_evt, cdc, tiers, rep, date_piece,
         art, designation, qa, qn,
         greatest(d_aval, 0),
         case when baisse > 0 then greatest(baisse - greatest(d_aval, 0), 0) else 0 end,
         nba, nbn, round(mta, 2), round(mtn, 2),
         case when baisse > 0 and qa > 0
              then round(mta * greatest(baisse - greatest(d_aval, 0), 0) / qa, 2) else 0 end,
         pieces
    from c
   where type_evt is not null;

  insert into public.cdc_flux_evenements
    (source, lot_id, detecte_at, periode_debut, niveau, type_evenement, cdc, numero_tiers, representant_piece, date_piece,
     qte_avant, qte_apres, qte_transformee, qte_non_expliquee,
     nb_lignes_avant, nb_lignes_apres, montant_ht_avant, montant_ht_apres, montant_non_explique,
     date_livraison_avant)
  select 'historique', null, v_detecte, v_debut, 'COMMANDE', 'COMMANDE_SUPPRIMEE', e.cdc,
         max(e.numero_tiers), max(e.representant_piece), max(e.date_piece),
         sum(e.qte_avant), 0, sum(e.qte_transformee), sum(e.qte_non_expliquee),
         sum(e.nb_lignes_avant), 0, sum(e.montant_ht_avant), 0, sum(e.montant_non_explique),
         (select h.date_livraison from public.cdc_flux_hist_entetes h
           where h.snap = p_av and h.numero_piece = e.cdc limit 1)
    from public.cdc_flux_evenements e
   where e.source = 'historique' and e.detecte_at = v_detecte and e.niveau = 'LIGNE'
     and not exists (select 1 from public.cdc_flux_hist_lignes s
                      where s.snap = p_ap and s.kind = 'C' and s.cdc = e.cdc)
     and not exists (select 1 from public.cdc_flux_hist_entetes h
                      where h.snap = p_ap and h.numero_piece = e.cdc)
   group by e.cdc
  having bool_and(e.type_evenement = 'SUPPRESSION_LIGNE');

  insert into public.cdc_flux_evenements
    (source, lot_id, detecte_at, periode_debut, niveau, type_evenement, cdc, numero_tiers, date_piece,
     date_livraison_avant, date_livraison_apres)
  select 'historique', null, v_detecte, v_debut, 'COMMANDE', 'DATE_LIVRAISON_MODIFIEE', n.numero_piece, n.numero_tiers,
         n.date_piece, a.date_livraison, n.date_livraison
    from public.cdc_flux_hist_entetes a
    join public.cdc_flux_hist_entetes n
      on n.snap = p_ap and n.numero_piece = a.numero_piece
   where a.snap = p_av
     and a.date_livraison is distinct from n.date_livraison;

  select count(*) into v_n from public.cdc_flux_evenements
   where source = 'historique' and detecte_at = v_detecte;

  -- l'instantané précédent n'est plus utile
  delete from public.cdc_flux_hist_lignes  where snap = p_av;
  delete from public.cdc_flux_hist_entetes where snap = p_av;

  update public.cdc_flux_hist_snaps set statut = 'traite', nb_evenements = v_n, traite_at = now()
   where snap = p_ap;

  return v_n;
end;
$$;
revoke all on function public.cdc_flux_hist_comparer(text, text) from public, anon, authenticated;

-- Le lien « période » des événements repris : periode_debut / detecte_at = horodatages des
-- instantanés (heure du run d'import, UTC) ; la requalification « facturée sur la période »
-- de get_cdc_flux s'applique telle quelle.
