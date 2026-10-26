-- ============================================================================
-- 20261026_allocation_airh2o_agences.sql — Allocation AirH2O 600 / 800 (26/10/2026)
-- ----------------------------------------------------------------------------
-- 1. Nouveau droit de profil « can_allocation_airh2o » (coché dans Autorisations) :
--    la personne voit l'écran limité aux agences de son périmètre
--    (user_page_access.allowed_agences), sans les colonnes de stock,
--    et sans pouvoir modifier les allocations.
--    Les personnes de stock_alloc_ro_acces gardent la vue complète et la saisie.
-- 2. Colonnes BL figées sur la période d'allocation :
--    BL sept. = 01/09 → 30/09 ; BL oct. = 01/10 → 25/10 ;
--    nouvelle colonne « BL et PL créés depuis le 26/10 » (BL datés ≥ 26/10
--    + PL créées ≥ 26/10) ; « PL encours » = PL créées avant le 26/10
--    (pas de double compte). Contrôle : depuis 26/10 + CDC Liv 2026 ≤ Allocation 2026.
-- ============================================================================

alter table public.access_profiles add column if not exists can_allocation_airh2o boolean not null default false;

-- Blocs (agences) visibles par la personne connectée au titre du droit de profil.
-- Tableau vide = pas de droit ou pas d'agence dans son périmètre.
create or replace function public.allocation_ro_blocs_user()
returns text[]
language sql stable security definer
set search_path to 'public'
as $$
  select coalesce(array(
    select distinct case when upper(replace(a, ' ', '')) = 'SAV/JMLADEUIX' then 'JITHURBIDE' else upper(replace(a, ' ', '')) end
    from public.user_page_access u
    cross join unnest(coalesce(u.allowed_agences, '{}'::text[])) a
    where u.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and nullif(trim(a), '') is not null
      and exists (
        select 1 from public.access_profiles p
        where p.id = any(array_prepend(u.access_profile_id, coalesce(u.profils_complementaires, '{}'::uuid[])))
          and coalesce(p.is_active, true)
          and p.can_allocation_airh2o
      )
  ), '{}'::text[])
$$;

grant execute on function public.allocation_ro_blocs_user() to authenticated;

create or replace function public.get_allocation_ro()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'sage'
set statement_timeout to '60s'
as $function$
declare
  v_fin    date := make_date(extract(year from (now() at time zone 'Europe/Paris'))::int, 12, 31);
  -- Période d'allocation 2026 : colonnes figées (BL sept., BL oct. jusqu'au 25/10, puis « depuis le 26/10»).
  v_m1     date := date '2026-09-01';
  v_m      date := date '2026-10-01';
  v_debut  date := date '2026-10-26';
  v_complet boolean := public.peut_acceder_allocation_ro();
  v_blocs  text[] := '{}';
  v_res    jsonb;
begin
  if not v_complet then
    v_blocs := public.allocation_ro_blocs_user();
    if coalesce(array_length(v_blocs, 1), 0) = 0 then
      raise exception 'Accès réservé' using errcode = '42501';
    end if;
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
             when l.t = 'Préparation de livraison' and l.date_piece >= v_debut then 'POST_PL'
             when l.t = 'Préparation de livraison' then 'PL'
             when l.date_bl >= v_debut then 'POST_BL'
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
    select * from (
      select la.*,
             case when la.representant = 'AAITHURBIDE' or la.agence = 'SAV/JMLADEUIX' then 'JITHURBIDE' else la.agence end as bloc
      from lignes_ag la
      where la.nature is not null
    ) x
    where v_complet or x.bloc = any(v_blocs)
  ),
  agg as (
    select ref, bloc,
           sum(q) filter (where nature = 'BL_M1') as bl_m1,
           sum(q) filter (where nature = 'BL_M') as bl_m,
           sum(q) filter (where nature = 'PL') as pl,
           sum(q) filter (where nature in ('POST_BL', 'POST_PL')) as post,
           sum(q) filter (where nature = 'CDC') as cdc,
           sum(q) filter (where nature = 'CDC_ANNEE_SUIVANTE') as cdc_suiv
    from lignes_bloc group by 1, 2
  ),
  couv as (
    select v.numero_document, v.reference_article,
           (array_agg(v.statut_couverture order by case v.statut_couverture when 'RUPTURE' then 0 when 'RECEPTION_TARDIVE' then 1 when 'A_COUVRIR_PAR_APPRO' then 2 when 'COUVERT_PAR_RECEPTION' then 3 else 4 end))[1] as statut,
           max(v.date_couverture_estimee) as date_couv,
           max(v.retard_estime_jours) as retard,
           string_agg(distinct v.prochaine_reception_cdf, ', ') as cdf
    from v_portefeuille_couverture_stock v
    join cibles c on c.ref = v.reference_article
    group by 1, 2
  ),
  blocs as (
    select b.bloc from (
      select distinct bloc from lignes_bloc
      union select 'JITHURBIDE' union select 'ANGLET'
      union select distinct a.bloc from stock_alloc_ro a
      union select unnest(v_blocs)
    ) b
    where v_complet or b.bloc = any(v_blocs)
  )
  select jsonb_build_object(
    'genere_le', now(),
    'import_sage_le', (select max(loaded_at) from sage.stock_depot),
    'fin_annee', v_fin,
    'mois_m1', v_m1, 'mois_m', v_m, 'debut_alloc', v_debut,
    'mode', case when v_complet then 'complet' else 'agence' end,
    'blocs_user', to_jsonb(v_blocs),
    'refs', (select coalesce(jsonb_agg(jsonb_build_object(
               'ref', c.ref, 'designation', c.designation, 'gamme', c.gamme, 'taille', c.taille, 'alim', c.alim, 'prix', c.prix,
               'reel', case when v_complet then coalesce(st.reel, 0) end,
               'prepa', case when v_complet then coalesce(st.prepa, 0) end,
               'dispo', case when v_complet then coalesce(st.reel, 0) - coalesce(st.prepa, 0) end,
               'arrivage_annee', case when v_complet then coalesce((select sum(q) from arr_m where arr_m.ref = c.ref and arr_m.mois <= to_char(v_fin, 'YYYY-MM')), 0) end,
               'arrivages', case when v_complet then coalesce((select jsonb_agg(jsonb_build_object('mois', mois, 'q', q, 'cdf', cdf) order by mois) from arr_m where arr_m.ref = c.ref), '[]'::jsonb) else '[]'::jsonb end,
               'dispo_fin_dec_ecran', case when v_complet then c.dispo_fin_dec_ecran end
             ) order by c.taille, c.gamme, c.alim desc), '[]'::jsonb) from cibles c left join st on st.ref = c.ref),
    'blocs', (select coalesce(jsonb_agg(bloc order by case bloc when 'ANGLET' then 0 when 'JITHURBIDE' then 1 else 2 end, bloc), '[]'::jsonb) from blocs),
    'valeurs', (select coalesce(jsonb_agg(jsonb_build_object('ref', ref, 'bloc', bloc,
                 'bl_m1', coalesce(bl_m1, 0), 'bl_m', coalesce(bl_m, 0), 'pl', coalesce(pl, 0), 'post', coalesce(post, 0),
                 'cdc', coalesce(cdc, 0), 'cdc_suiv', coalesce(cdc_suiv, 0))), '[]'::jsonb) from agg),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('ref', a.reference_article, 'bloc', a.bloc, 'quantite', a.quantite,
                      'updated_at', a.updated_at, 'updated_by', a.updated_by)), '[]'::jsonb)
                    from stock_alloc_ro a where v_complet or a.bloc = any(v_blocs)),
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'ref', lb.ref, 'bloc', lb.bloc, 'nature', lb.nature, 'piece', lb.piece,
                 'cdc', case when lb.t = 'Bon de commande' then lb.piece else lb.bc end,
                 'date_cdc', case when lb.t = 'Bon de commande' then lb.date_piece else lb.d_cdc end,
                 'date_piece', lb.date_piece,
                 'date_livraison', lb.date_livraison, 'date_bl', lb.date_bl, 'q', lb.q, 'montant_ht', round(lb.mt::numeric, 0),
                 'tiers', lb.tiers, 'client', lb.client, 'representant', lb.representant, 'agence', lb.agence
               ) || jsonb_build_object(
                 'couv_statut', cv.statut, 'couv_cdf', cv.cdf, 'couv_date', cv.date_couv, 'couv_retard', cv.retard
               ) order by lb.ref, lb.nature, coalesce(lb.date_bl, lb.date_livraison)), '[]'::jsonb) from lignes_bloc lb
               left join couv cv on lb.nature in ('CDC', 'CDC_ANNEE_SUIVANTE') and cv.numero_document = lb.piece and cv.reference_article = lb.ref)
  ) into v_res;

  return v_res;
end $function$;
