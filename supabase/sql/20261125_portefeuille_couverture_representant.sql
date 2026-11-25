-- 2026-11-25 : la couverture stock reprend la même règle représentant / agence
-- que v_portefeuille_livraison_lignes (migration appliquée :
-- couverture_global_representant_piece).
--
-- Avant : la couverture prenait le représentant du tiers (ref_tiers) ; pour un
-- tiers « NON AFFECTE », le portefeuille, lui, prend le collaborateur de la
-- pièce (ex. BRPAROUTOT / BRIVE). Le filtre agence/représentant de l'écran
-- excluait donc la couverture et les lignes s'affichaient « Hors contrôle »
-- (196 CDC / 1 657 lignes concernées au 25/11/2026, ex. CDC176528).
--
-- La règle est posée dans le CTE « lignes » de interne.v_couverture_stock_global
-- (et pas dans la vue publique) pour que le filtre agence reste poussé au cœur
-- du calcul (~2 s au lieu de ~10 s). Effet induit voulu : les alertes
-- couverture (refresh_alerte_couverture_stock_cache) et v_couverture_stock_besoins
-- suivent la même règle que le portefeuille.

do $mig$
declare d text; n text;
begin
  d := pg_get_viewdef('interne.v_couverture_stock_global'::regclass, true);
  n := replace(d,
'            l.representant,
            l.agence,
            COALESCE(l.date_livraison, CURRENT_DATE) AS date_besoin,',
'            CASE WHEN rt0.numero IS NOT NULL AND tiers_non_affecte(rt0.representant) THEN COALESCE(collab_piece_code(al0.collaborateur), NULLIF(btrim(al0.collaborateur), ''''::text), ''NON AFFECTE''::text) ELSE l.representant END AS representant,
            CASE WHEN rt0.numero IS NOT NULL AND tiers_non_affecte(rt0.representant) THEN COALESCE(collab_piece_agence(al0.collaborateur), ''Sans agence''::text) ELSE l.agence END AS agence,
            COALESCE(l.date_livraison, CURRENT_DATE) AS date_besoin,');
  if n = d then raise exception 'bloc representant non trouvé'; end if;
  d := n;
  n := replace(d,
'           FROM interne.v_cdc_lignes_global l
             CROSS JOIN p',
'           FROM interne.v_cdc_lignes_global l
             JOIN activite_lignes al0 ON al0.id = l.id
             LEFT JOIN ref_tiers rt0 ON rt0.numero = al0.numero_tiers_entete
             CROSS JOIN p');
  if n = d then raise exception 'bloc FROM non trouvé'; end if;
  execute 'create or replace view interne.v_couverture_stock_global as ' || n;
end $mig$;

create or replace view public.v_portefeuille_couverture_stock as
select g.id, g.type_document, g.numero_document, g.numero_tiers, g.nom_tiers,
  g.date_creation_document, g.date_livraison, g.mois_livraison, g.reference_article,
  g.designation_article, g.famille, g.famille_macro, g.quantite, g.montant_ht,
  g.client_en_sommeil, g.representant, g.agence,
  g.rang_service, g.stock_disponible, g.stock_reel, g.stock_reserve,
  g.besoin_cumule_avant, g.besoin_cumule, g.receptions_avant_livraison, g.receptions_totales,
  g.stock_projete_hors_receptions, g.stock_projete_a_date, g.stock_projete_toutes_receptions,
  g.manque_a_date, g.manque_definitif, g.statut_couverture, g.date_couverture_estimee,
  g.retard_estime_jours, g.prochaine_reception_date, g.prochaine_reception_quantite,
  g.prochaine_reception_cdf, g.prochaine_reception_fournisseur, g.prochaine_reception_hypothese,
  g.receptions_avec_hypothese, g.statut_base, g.delai_appro_jours, g.date_appro_au_plus_tot,
  g.arret_appro, g.en_periode_figee, g.couverture_cdf, g.couverture_quantite
from interne.v_couverture_stock_global g
where exists (select 1 from interne.v_activite_lignes_visibles v where v.id = g.id);
