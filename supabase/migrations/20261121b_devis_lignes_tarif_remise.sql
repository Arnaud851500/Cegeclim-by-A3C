-- ============================================================================
-- 20261121b_devis_lignes_tarif_remise.sql — tarif brut, remise et prix net
-- sur public.devis_lignes (21/11/2026, validé par Arnaud)
-- ----------------------------------------------------------------------------
-- Constat : public.devis_lignes est alimentée par sync_devis_lignes_from_sage()
-- depuis sage.devis_hier_aujourdhui (export VL_*). Cet export porte le montant
-- brut (VL_CAHTBRUT) et la remise (VL_POURCENTREMISE), mais la synchro ne les
-- recopiait pas : depuis septembre 2026 (lignes « sage_realtime » seules),
-- pu_ht / remise / pu_net sont vides. Jusqu'en août, ces colonnes venaient des
-- reprises manuelles (Devis_partXXX.csv, DEVIS26….xlsx).
-- La table sage.devis_lignes_structure (fichier Devis_lignes_structure du soir)
-- porte aussi le tarif mais ne sert qu'à l'écran « Quand puis-je livrer ? ».
--
-- Corrections :
--  1. sage.v_devis_lignes_from_sage expose la remise (colonne ajoutée en fin) ;
--  2. sync_devis_lignes_from_sage() recopie pu_ht = brut / qté, remise (en %,
--     comme SAGE) et pu_net = net / qté, et met à jour les lignes où ils changent ;
--  3. reprise des lignes existantes depuis sage.devis_hier_aujourdhui ;
--  4. remise de l'historique passée de la fraction (0,55) au pourcentage (55) —
--     choix d'Arnaud : tout en %, comme SAGE ;
--  5. get_quand_livrer_devis lit désormais la remise telle quelle (déjà en %).
-- ============================================================================

-- 1. Vue source : remise ajoutée en dernière colonne
create or replace view sage.v_devis_lignes_from_sage as
 select d.vl_pk as ligne_id_sage,
    'Devis'::text as type_document,
    d.vl_docnum as numero_piece,
    d.vl_ctnum as numero_tiers_ligne,
    rt.intitule as intitule_tiers_ligne,
    d.vl_docnum as numero_piece_devis,
    d.vl_dlpiecebc as numero_piece_bc,
    d.vl_dlpiecebl as numero_piece_bl,
    coalesce(d.date_piece, d.vl_docmodification) as date_devis,
    d.vl_art_num as reference_article,
    d.vl_dldesign as designation,
    d.vl_acrefclient as reference_client,
    d.qtevendues as quantite,
    d.qtecommande as qte_commandee,
    d.qtelivre as qte_livree,
    d.vl_cahtbrut as montant_ht_brut,
    d.cahtnet as montant_ht,
    d.cattcnet as montant_ttc,
    d.prxrevientu as prix_revient_unitaire,
    d.marge as marge_valeur,
    d.vl_docmodification as date_modification_sage,
    d.vl_doctype as vl_doctype_origine,
    d.vl_ctnum as numero_tiers_entete,
    rt.intitule as intitule_tiers_entete,
    nullif(trim(both from d.vl_renom), ''::text) as collaborateur,
    nullif(trim(both from d.vl_doref), ''::text) as reference,
    d.vl_pourcentremise as remise_pct
   from sage.devis_hier_aujourdhui d
     left join ref_tiers rt on upper(trim(both from rt.numero)) = upper(trim(both from d.vl_ctnum));

-- 2. Synchro : tarif brut, remise, prix net
create or replace function public.sync_devis_lignes_from_sage()
 returns table(nb_lignes_inserees bigint, nb_lignes_mises_a_jour bigint, periode_min date, periode_max date)
 language plpgsql
 security definer
 set search_path to 'public', 'sage'
as $function$
declare
    v_min date;
    v_max date;
    v_inserted bigint;
    v_updated bigint;
begin
    create temp table _tmp_devis_sync on commit drop as
    select
        md5('sage:' || s.ligne_id_sage) as ligne_hash,
        s.type_document, s.numero_piece,
        s.numero_tiers_entete, s.intitule_tiers_entete,
        s.numero_tiers_ligne, s.intitule_tiers_ligne,
        s.collaborateur,
        s.numero_piece_devis, s.numero_piece_bc, s.numero_piece_bl,
        public.parse_date_sage(s.date_devis) as date_devis,
        s.reference_article, s.designation, s.reference_client,
        s.reference,
        s.quantite, s.qte_commandee, s.qte_livree,
        s.montant_ht, s.montant_ttc, s.prix_revient_unitaire, s.marge_valeur,
        case when coalesce(s.quantite, 0) <> 0 then round(s.montant_ht_brut / s.quantite, 4) end as pu_ht,
        s.remise_pct as remise,
        case when coalesce(s.quantite, 0) <> 0 then round(s.montant_ht / s.quantite, 4) end as pu_net
    from sage.v_devis_lignes_from_sage s;

    with upsert as (
        insert into public.devis_lignes (
            ligne_hash, type_document, numero_piece,
            numero_tiers_entete, intitule_tiers_entete,
            numero_tiers_ligne, intitule_tiers_ligne,
            collaborateur,
            numero_piece_devis, numero_piece_bc, numero_piece_bl,
            date_devis, reference_article, designation, reference_client,
            reference,
            quantite, qte_commandee, qte_livree,
            montant_ht, montant_ttc, prix_revient_unitaire, marge_valeur,
            pu_ht, remise, pu_net,
            source_import, imported_at
        )
        select
            ligne_hash, type_document, numero_piece,
            numero_tiers_entete, intitule_tiers_entete,
            numero_tiers_ligne, intitule_tiers_ligne,
            collaborateur,
            numero_piece_devis, numero_piece_bc, numero_piece_bl,
            date_devis, reference_article, designation, reference_client,
            reference,
            quantite, qte_commandee, qte_livree,
            montant_ht, montant_ttc, prix_revient_unitaire, marge_valeur,
            pu_ht, remise, pu_net,
            'sage_realtime', now()
        from _tmp_devis_sync
        on conflict (ligne_hash) do update set
            date_devis             = excluded.date_devis,
            numero_tiers_entete    = excluded.numero_tiers_entete,
            intitule_tiers_entete  = excluded.intitule_tiers_entete,
            numero_tiers_ligne     = excluded.numero_tiers_ligne,
            intitule_tiers_ligne   = excluded.intitule_tiers_ligne,
            collaborateur          = excluded.collaborateur,
            reference_client       = excluded.reference_client,
            reference              = excluded.reference,
            quantite               = excluded.quantite,
            qte_commandee          = excluded.qte_commandee,
            qte_livree             = excluded.qte_livree,
            montant_ht             = excluded.montant_ht,
            montant_ttc            = excluded.montant_ttc,
            prix_revient_unitaire  = excluded.prix_revient_unitaire,
            marge_valeur           = excluded.marge_valeur,
            pu_ht                  = excluded.pu_ht,
            remise                 = excluded.remise,
            pu_net                 = excluded.pu_net,
            imported_at            = now()
        where
            devis_lignes.date_devis is distinct from excluded.date_devis
            or devis_lignes.quantite is distinct from excluded.quantite
            or devis_lignes.qte_commandee is distinct from excluded.qte_commandee
            or devis_lignes.qte_livree is distinct from excluded.qte_livree
            or devis_lignes.montant_ht is distinct from excluded.montant_ht
            or devis_lignes.montant_ttc is distinct from excluded.montant_ttc
            or devis_lignes.marge_valeur is distinct from excluded.marge_valeur
            or devis_lignes.numero_tiers_entete is distinct from excluded.numero_tiers_entete
            or devis_lignes.intitule_tiers_entete is distinct from excluded.intitule_tiers_entete
            or devis_lignes.numero_tiers_ligne is distinct from excluded.numero_tiers_ligne
            or devis_lignes.intitule_tiers_ligne is distinct from excluded.intitule_tiers_ligne
            or devis_lignes.collaborateur is distinct from excluded.collaborateur
            or devis_lignes.reference_client is distinct from excluded.reference_client
            or devis_lignes.reference is distinct from excluded.reference
            or devis_lignes.pu_ht is distinct from excluded.pu_ht
            or devis_lignes.remise is distinct from excluded.remise
            or devis_lignes.pu_net is distinct from excluded.pu_net
        returning (xmax = 0) as was_insert
    )
    select
        count(*) filter (where was_insert),
        count(*) filter (where not was_insert)
    into v_inserted, v_updated
    from upsert;

    v_inserted := coalesce(v_inserted, 0);
    v_updated := coalesce(v_updated, 0);

    select min(date_devis), max(date_devis) into v_min, v_max from _tmp_devis_sync;

    if v_min is not null and (v_inserted > 0 or v_updated > 0) then
        perform public.rebuild_indicateur_devis_mensuel_periode(
            date_trunc('month', v_min)::date,
            (date_trunc('month', v_max) + interval '1 month')::date
        );
    end if;

    return query select v_inserted, v_updated, v_min, v_max;
end;
$function$;

-- 3. Reprise des lignes existantes depuis l'export du jour (sans relancer les indicateurs)
update public.devis_lignes d
   set pu_ht  = case when coalesce(s.qtevendues, 0) <> 0 then round(s.vl_cahtbrut / s.qtevendues, 4) end,
       remise = s.vl_pourcentremise,
       pu_net = case when coalesce(s.qtevendues, 0) <> 0 then round(s.cahtnet / s.qtevendues, 4) end
  from sage.devis_hier_aujourdhui s
 where d.ligne_hash = md5('sage:' || s.vl_pk)
   and d.source_import = 'sage_realtime';

-- 4. Historique (reprises manuelles) : remise fraction → pourcentage
update public.devis_lignes
   set remise = round(remise * 100, 4)
 where source_import <> 'sage_realtime'
   and remise > 0 and remise <= 1;
-- (appliqué en production par tranches de date_devis : un seul UPDATE dépassait le délai)

-- 5. « Quand puis-je livrer ? » : la remise de devis_lignes est désormais en %
do $$
declare s text;
begin
  s := pg_get_functiondef('public.get_quand_livrer_devis(text)'::regprocedure);
  s := replace(s, 'case when d.remise is not null and d.remise <= 1 then d.remise * 100 else d.remise end', 'd.remise');
  execute s;
end $$;
