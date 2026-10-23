-- ============================================================================
-- 20261023_export_sage_cdf_complements.sql  —  requêtes T-SQL (SQL Server SAGE)
-- ----------------------------------------------------------------------------
-- À ajouter à l'export TSE (export_sage_vers_supabase.ps1), dans le même lot
-- que l'export des CDF (sage.bdcf), pour l'écran « Portefeuille commandes
-- fournisseurs ». Deux CSV, chargés côté VPS par vidage + réinsertion, comme
-- sage.bdcf :
--
--   cdf_statut.csv         →  sage.cdf_statut         (do_piece, ct_num, do_statut)
--   bdcf_commentaires.csv  →  sage.bdcf_commentaires  (do_piece, dl_ligne, ct_num, dl_design)
--
-- Périmètre : bons de commande achat (DO_Domaine = 1, DO_Type = 12), donc les
-- mêmes CDF ouvertes que sage.bdcf.
-- ============================================================================

-- 1) Statut de chaque CDF (« AR OK » …) ---------------------------------------
SELECT
    E.DO_Piece   AS do_piece,
    E.DO_Tiers   AS ct_num,
    E.DO_Statut  AS do_statut
FROM [CEGECLIM].[dbo].[F_DOCENTETE] E
WHERE E.DO_Domaine = 1
  AND E.DO_Type    = 12;

-- 2) Lignes de commentaire des CDF (n° de container, suivi, AR…) -------------
--    Une ligne de commentaire SAGE = ligne sans article (AR_Ref vide).
SELECT
    L.DO_Piece   AS do_piece,
    L.DL_Ligne   AS dl_ligne,
    L.CT_Num     AS ct_num,
    L.DL_Design  AS dl_design
FROM [CEGECLIM].[dbo].[F_DOCLIGNE] L
WHERE L.DO_Domaine = 1
  AND L.DO_Type    = 12
  AND ISNULL(L.AR_Ref, '') = ''
  AND ISNULL(LTRIM(RTRIM(L.DL_Design)), '') <> '';

-- Après le premier chargement, renseigner les libellés de statut, par ex. :
--   select do_statut from sage.cdf_statut where do_piece = 'CDF032795';   -- = « AR OK »
--   insert into public.appro_cdf_statuts (code, libelle, ar_recu) values (<code>, 'AR OK', true), …;
