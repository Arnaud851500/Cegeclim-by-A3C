-- ============================================================================
-- 20261024_allocation_airh2o.sql
-- ----------------------------------------------------------------------------
-- Écran « Allocation AirH2O 600 / 800 » (/stock/allocation-airh2o), bloc Stocks &
-- logistique — demandé par Arnaud le 24/10/2026, reprise du tableau Excel :
--   groupes extérieurs AirH2O 600 / 800 du catalogue 2026, tailles ≥ 3,5 ;
--   STOCK : Dispo (Phy-PL), Arrivage année en cours, A attribuer, Attribué ;
--   TOTAL VENTES puis un bloc par agence (ANGLET hors Julien Ithurbide, Julien
--   Ithurbide, puis chaque agence) : BL mois précédent, BL mois en cours,
--   PL en cours, CDC à livrer d'ici le 31/12 (retards compris), allocation saisie.
--   A attribuer = Dispo − CDC Liv + Arrivages ; Attribué = somme des allocations.
--
-- Accès réservé (pour l'instant) : Julien Ithurbide, Stéphane Chanteau,
-- Jean-Marc Ladeuix, Arnaud Valanchauskas — table stock_alloc_ro_acces,
-- vérifiée par chaque fonction (security definer : toutes agences visibles).
--
-- Règles reprises du fichier du 24/10/2026 :
--   - Dispo (Phy-PL) = somme sto_qte − somme sto_prepa, tous dépôts (sage.stock_depot) ;
--   - Arrivages = v_couverture_stock_receptions à leur date retenue (CDF en
--     retard / sans date = demain), jusqu'au 31/12 de l'année en cours ;
--   - CDC Liv = lignes « Bon de commande » d'activite_lignes dont la date de
--     livraison est ≤ 31/12 ou absente ; PL = lignes « Préparation de livraison » ;
--   - BL = lignes « Bon de livraison » non facturées + lignes de factures, datées
--     par la date de BL (hors bons de retour) ;
--   - agence = agence du représentant de la fiche client (ref_tiers →
--     ref_collaborateurs) ; client NON AFFECTE : agence du collaborateur de la
--     pièce (règle B) ; bloc Julien = clients dont AAITHURBIDE est le représentant.
-- ============================================================================

create table if not exists public.stock_alloc_ro_acces (
  email text primary key,
  nom   text
);
alter table public.stock_alloc_ro_acces enable row level security;
insert into public.stock_alloc_ro_acces (email, nom) values
  ('j.ithurbide@cegeclim-energies.com', 'Julien Ithurbide'),
  ('s.chanteau@cegeclim-energies.com', 'Stéphane Chanteau'),
  ('jm.ladeuix@cegeclim-energies.com', 'Jean-Marc Ladeuix'),
  ('a.valanchauskas@cegeclim-energies.com', 'Arnaud Valanchauskas')
on conflict (email) do nothing;

create or replace function public.peut_acceder_allocation_ro()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.stock_alloc_ro_acces
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
grant execute on function public.peut_acceder_allocation_ro() to authenticated;

create table if not exists public.stock_alloc_ro (
  reference_article text not null,
  bloc              text not null,
  quantite          numeric not null default 0,
  commentaire       text,
  updated_at        timestamptz not null default now(),
  updated_by        text default (auth.jwt() ->> 'email'),
  primary key (reference_article, bloc)
);
alter table public.stock_alloc_ro enable row level security;
drop policy if exists stock_alloc_ro_select on public.stock_alloc_ro;
create policy stock_alloc_ro_select on public.stock_alloc_ro for select to authenticated using (public.peut_acceder_allocation_ro());
grant select on public.stock_alloc_ro to authenticated;

-- ─── Saisie d'une allocation ────────────────────────────────────────────────
create or replace function public.set_allocation_ro(p_reference text, p_bloc text, p_quantite numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.peut_acceder_allocation_ro() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;
  if coalesce(p_quantite, 0) = 0 then
    delete from public.stock_alloc_ro where reference_article = p_reference and bloc = p_bloc;
  else
    insert into public.stock_alloc_ro (reference_article, bloc, quantite, updated_at, updated_by)
    values (p_reference, p_bloc, p_quantite, now(), auth.jwt() ->> 'email')
    on conflict (reference_article, bloc) do update
      set quantite = excluded.quantite, updated_at = now(), updated_by = excluded.updated_by;
  end if;
end $$;
revoke all on function public.set_allocation_ro(text, text, numeric) from public, anon;
grant execute on function public.set_allocation_ro(text, text, numeric) to authenticated;

-- ─── Données de l'écran ─────────────────────────────────────────────────────
create or replace function public.get_allocation_ro()
returns jsonb
language plpgsql
security definer
set search_path = public, sage
set statement_timeout = '60s'
as $$
declare
  v_auj   date := (now() at time zone 'Europe/Paris')::date;
  v_fin   date := make_date(extract(year from (now() at time zone 'Europe/Paris'))::int, 12, 31);
  v_m     date := date_trunc('month', (now() at time zone 'Europe/Paris'))::date;   -- 1er du mois en cours
  v_m1    date := (date_trunc('month', (now() at time zone 'Europe/Paris')) - interval '1 month')::date;
  v_res   jsonb;
begin
  if not public.peut_acceder_allocation_ro() then
    raise exception 'Accès réservé' using errcode = '42501';
  end if;

  with cibles as (
    select c->>'ref' as ref, c->>'designation' as designation, c->>'gamme' as gamme,
           (c->>'taille')::numeric as taille, c->>'alim' as alim, (c->>'prix')::numeric as prix,
           (c->>'dispo_fin_dec')::numeric as dispo_fin_dec_ecran
    from jsonb_array_elements(public.get_solutions_ro() -> 'cibles') c
    where (c->>'taille')::numeric >= 3.5
  ),
  st as (
    select s.sto_art_num as ref, sum(coalesce(s.sto_qte, 0)) as reel, sum(coalesce(s.sto_prepa, 0)) as prepa
    from sage.stock_depot s join cibles c on c.ref = s.sto_art_num
    group by 1
  ),
  arr_m as (
    select r.reference_article as ref, to_char(r.date_reception_retenue, 'YYYY-MM') as mois, sum(r.quantite_attendue) as q,
           string_agg(distinct r.numero_cdf, ', ') as cdf
    from v_couverture_stock_receptions r join cibles c on c.ref = r.reference_article
    group by 1, 2
  ),
  lignes as (
    select 'ACT' as src, a.type_document as t, a.numero_piece as piece, a.numero_piece_bc as bc,
           coalesce(a.date_bc, a.date_piece) as d_cdc, a.date_piece, a.date_livraison, a.date_bl,
           a.reference_article as ref, a.quantite as q, a.montant_ht as mt,
           a.numero_tiers_entete as tiers, a.intitule_tiers_entete as client, a.collaborateur
    from activite_lignes a join cibles c on c.ref = a.reference_article
    where a.type_document in ('Bon de commande', 'Préparation de livraison', 'Bon de livraison')
    union all
    select 'FAC', f.type_document, f.numero_piece, f.numero_piece_bc, f.date_bc, f.date_facture, f.date_livraison, f.date_bl,
           f.reference_article, f.quantite, f.montant_ht, f.numero_tiers_entete, f.intitule_tiers_entete, f.collaborateur
    from facture_lignes f join cibles c on c.ref = f.reference_article
    where f.date_bl >= v_m1
  ),
  lignes_ag as (
    select l.*, t.representant,
           coalesce(nullif(case when coalesce(c.agence, 'NON AFFECTE') = 'NON AFFECTE' then cp.agence end, ''), c.agence, 'NON AFFECTE') as agence,
           case
             when l.t = 'Bon de commande' and (l.date_livraison is null or l.date_livraison <= v_fin) then 'CDC'
             when l.t = 'Bon de commande' then 'CDC_ANNEE_SUIVANTE'
             when l.t = 'Préparation de livraison' then 'PL'
             when l.date_bl >= v_m then 'BL_M'
             when l.date_bl >= v_m1 then 'BL_M1'
           end as nature
    from lignes l
    left join ref_tiers t on t.numero = l.tiers
    left join ref_collaborateurs c on c.nom = t.representant
    left join lateral (
      select c2.agence from ref_collaborateurs c2
      where c2.nom_prenom = l.collaborateur or c2.nom = split_part(l.collaborateur, ' ', 1)
      limit 1
    ) cp on true
  ),
  lignes_bloc as (
    select la.*,
           case when la.representant = 'AAITHURBIDE' then 'JITHURBIDE' else la.agence end as bloc
    from lignes_ag la
    where la.nature is not null
  ),
  agg as (
    select ref, bloc,
           sum(q) filter (where nature = 'BL_M1') as bl_m1,
           sum(q) filter (where nature = 'BL_M') as bl_m,
           sum(q) filter (where nature = 'PL') as pl,
           sum(q) filter (where nature = 'CDC') as cdc,
           sum(q) filter (where nature = 'CDC_ANNEE_SUIVANTE') as cdc_suiv
    from lignes_bloc group by 1, 2
  ),
  blocs as (
    select distinct bloc from lignes_bloc
    union select 'JITHURBIDE' union select 'ANGLET'
  )
  select jsonb_build_object(
    'genere_le', now(),
    'import_sage_le', (select max(loaded_at) from sage.stock_depot),
    'fin_annee', v_fin,
    'mois_m1', v_m1, 'mois_m', v_m,
    'refs', (select coalesce(jsonb_agg(jsonb_build_object(
               'ref', c.ref, 'designation', c.designation, 'gamme', c.gamme, 'taille', c.taille, 'alim', c.alim, 'prix', c.prix,
               'reel', coalesce(st.reel, 0), 'prepa', coalesce(st.prepa, 0), 'dispo', coalesce(st.reel, 0) - coalesce(st.prepa, 0),
               'arrivage_annee', coalesce((select sum(q) from arr_m where arr_m.ref = c.ref and arr_m.mois <= to_char(v_fin, 'YYYY-MM')), 0),
               'arrivages', coalesce((select jsonb_agg(jsonb_build_object('mois', mois, 'q', q, 'cdf', cdf) order by mois) from arr_m where arr_m.ref = c.ref), '[]'::jsonb),
               'dispo_fin_dec_ecran', c.dispo_fin_dec_ecran
             ) order by c.taille, c.gamme, c.alim desc), '[]'::jsonb) from cibles c left join st on st.ref = c.ref),
    'blocs', (select coalesce(jsonb_agg(bloc order by case bloc when 'ANGLET' then 0 when 'JITHURBIDE' then 1 else 2 end, bloc), '[]'::jsonb) from blocs),
    'valeurs', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'bloc', bloc,
                 'bl_m1', coalesce(bl_m1, 0), 'bl_m', coalesce(bl_m, 0), 'pl', coalesce(pl, 0), 'cdc', coalesce(cdc, 0),
                 'cdc_suiv', coalesce(cdc_suiv, 0))), '[]'::jsonb) from agg),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('ref', a.reference_article, 'bloc', a.bloc, 'quantite', a.quantite,
                      'updated_at', a.updated_at, 'updated_by', a.updated_by)), '[]'::jsonb) from stock_alloc_ro a),
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'ref', lb.ref, 'bloc', lb.bloc, 'nature', lb.nature, 'piece', lb.piece,
                 'cdc', case when lb.t = 'Bon de commande' then lb.piece else lb.bc end,
                 'date_cdc', case when lb.t = 'Bon de commande' then lb.date_piece else lb.d_cdc end,
                 'date_livraison', lb.date_livraison, 'date_bl', lb.date_bl, 'q', lb.q, 'montant_ht', round(lb.mt::numeric, 0),
                 'tiers', lb.tiers, 'client', lb.client, 'representant', lb.representant, 'agence', lb.agence
               ) order by lb.ref, lb.nature, coalesce(lb.date_bl, lb.date_livraison)), '[]'::jsonb) from lignes_bloc lb)
  ) into v_res;

  return v_res;
end $$;
revoke all on function public.get_allocation_ro() from public, anon;
grant execute on function public.get_allocation_ro() to authenticated;

-- ─── 24/10/2026 (appliqué en production) ────────────────────────────────────
-- Les agences qui ont une allocation sans aucune vente (ex. DAX, sans
-- collaborateur rattaché) apparaissent aussi comme bloc : dans get_allocation_ro,
-- le CTE « blocs » reçoit en plus
--     union select distinct a.bloc from stock_alloc_ro a
-- Allocations initiales saisies d'après le tableau d'Arnaud du 24/10/2026
-- (updated_by = 'tableau Arnaud 24/10').

-- ─── 25/10/2026 (appliqué en production) ────────────────────────────────────
-- Bloc « Julien. Ith » cumulé avec SAV/JMLADEUIX : dans get_allocation_ro,
--   case when la.representant = 'AAITHURBIDE' or la.agence = 'SAV/JMLADEUIX' then 'JITHURBIDE' else la.agence end as bloc
-- et allocations SAV/JMLADEUIX ajoutées à celles du bloc JITHURBIDE puis supprimées.
