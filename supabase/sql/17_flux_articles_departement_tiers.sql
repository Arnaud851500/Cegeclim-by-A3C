-- =========================================================
-- FLUX ARTICLES — AJOUT DU DEPARTEMENT CLIENT
--
-- Le département est calculé depuis ref_tiers.code_postal au moment du rebuild.
-- Il devient une dimension native de indicateur_flux_articles_mensuel pour :
--   - l'affichage et les exports BI ;
--   - les regroupements par département ;
--   - les filtres de périmètre utilisateur ;
--   - tous les flux DEVIS, CDC, BL et FACTURE.
--
-- Après exécution de ce patch, relancer le rebuild sur l'historique souhaité,
-- par exemple par périodes de six mois avec :
-- SELECT public.rebuild_indicateur_flux_articles_mensuel_periode_front(...);
-- =========================================================

ALTER TABLE public.indicateur_flux_articles_mensuel
  ADD COLUMN IF NOT EXISTS departement_tiers text;

UPDATE public.indicateur_flux_articles_mensuel
SET departement_tiers = 'NON RENSEIGNE'
WHERE departement_tiers IS NULL OR BTRIM(departement_tiers) = '';

ALTER TABLE public.indicateur_flux_articles_mensuel
  ALTER COLUMN departement_tiers SET DEFAULT 'NON RENSEIGNE';

ALTER TABLE public.indicateur_flux_articles_mensuel
  ALTER COLUMN departement_tiers SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flux_articles_atelier_departement
ON public.indicateur_flux_articles_mensuel (
  annee,
  hors_statistique,
  departement_tiers
);

CREATE INDEX IF NOT EXISTS idx_flux_articles_atelier_departement_flux
ON public.indicateur_flux_articles_mensuel (
  annee,
  hors_statistique,
  departement_tiers,
  flux
);

CREATE OR REPLACE FUNCTION public.rebuild_indicateur_flux_articles_mensuel_periode(
  p_date_debut date,
  p_date_fin date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '5min'
AS $function$
BEGIN

  IF p_date_debut IS NULL OR p_date_fin IS NULL OR p_date_fin <= p_date_debut THEN
    RAISE EXCEPTION 'Période invalide : p_date_debut=%, p_date_fin=%', p_date_debut, p_date_fin;
  END IF;

  DELETE FROM public.indicateur_flux_articles_mensuel
  WHERE make_date(annee, mois, 1) >= date_trunc('month', p_date_debut)::date
    AND make_date(annee, mois, 1) <  date_trunc('month', p_date_fin)::date;

  INSERT INTO public.indicateur_flux_articles_mensuel (
    annee,
    mois,
    flux,
    type_document,
    depot,
    collaborateur_tiers,
    departement_tiers,
    famille_macro,
    famille,
    reference_article,
    designation,
    hors_statistique,
    nb_lignes,
    quantite,
    quantite_pertinente,
    ca_ht,
    marge_valeur,
    updated_at
  )
  WITH tiers_base AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(TRIM(rt.numero::text)))
      UPPER(TRIM(rt.numero::text)) AS tiers_key,
      COALESCE(NULLIF(TRIM(rt.representant::text), ''), 'NON AFFECTE') AS collaborateur_tiers,
      REGEXP_REPLACE(COALESCE(rt.code_postal::text, ''), '[^0-9]', '', 'g') AS postal_digits
    FROM public.ref_tiers rt
    WHERE NULLIF(TRIM(rt.numero::text), '') IS NOT NULL
    ORDER BY UPPER(TRIM(rt.numero::text))
  ),
  tiers AS MATERIALIZED (
    SELECT
      tiers_key,
      collaborateur_tiers,
      CASE
        WHEN postal_digits = '' THEN 'NON RENSEIGNE'
        WHEN postal_digits ~ '^(971|972|973|974|975|976|977|978|984|986|987|988)'
          THEN LEFT(postal_digits, 3)
        ELSE LEFT(LPAD(postal_digits, 5, '0'), 2)
      END AS departement_tiers
    FROM tiers_base
  ),
  activite_norm AS MATERIALIZED (
    SELECT
      al.*,
      UPPER(REPLACE(REPLACE(TRIM(COALESCE(al.type_document::text, '')), '–', '-'), '—', '-')) AS type_document_norm,
      COALESCE(
        NULLIF(al.quantite, 0),
        NULLIF(al.qte_livree, 0),
        NULLIF(al.qte_preparee, 0),
        0
      )::numeric AS qte_activite_generique,
      COALESCE(
        NULLIF(al.qte_livree, 0),
        NULLIF(al.quantite, 0),
        NULLIF(al.qte_preparee, 0),
        0
      )::numeric AS qte_activite_bl,
      COALESCE(
        NULLIF(al.qte_preparee, 0),
        NULLIF(al.quantite, 0),
        NULLIF(al.qte_livree, 0),
        0
      )::numeric AS qte_activite_pl
    FROM public.activite_lignes al
  ),
  flux_lignes AS (
    -- DEVIS
    SELECT
      'DEVIS'::text AS flux,
      dl.date_devis::date AS date_flux,
      COALESCE(NULLIF(TRIM(dl.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(dl.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(dl.designation::text), ''), 'NON RENSEIGNE') AS designation,
      COALESCE(dl.qte_devis, dl.quantite, 0)::numeric AS quantite,
      COALESCE(dl.montant_ht, 0)::numeric AS ca_ht,
      COALESCE(dl.marge_valeur, 0)::numeric AS marge_valeur
    FROM public.devis_lignes dl
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(dl.numero_tiers_entete::text, '')))
    WHERE dl.date_devis >= p_date_debut
      AND dl.date_devis < p_date_fin
      AND dl.date_devis IS NOT NULL

    UNION ALL

    -- CDC depuis activité : Bon de commande / CDC
    SELECT
      'CDC'::text AS flux,
      al.date_piece::date AS date_flux,
      COALESCE(NULLIF(TRIM(al.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(al.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(al.designation::text), ''), 'NON RENSEIGNE') AS designation,
      al.qte_activite_generique AS quantite,
      COALESCE(al.montant_ht, 0)::numeric AS ca_ht,
      COALESCE(al.marge_valeur, 0)::numeric AS marge_valeur
    FROM activite_norm al
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(al.numero_tiers_entete::text, '')))
    WHERE al.date_piece >= p_date_debut
      AND al.date_piece < p_date_fin
      AND al.date_piece IS NOT NULL
      AND al.type_document_norm IN ('BON DE COMMANDE', 'CDC')

    UNION ALL

    -- CDC depuis activité : Bon de retour / BR, daté par date_bc et négatif
    SELECT
      'CDC'::text AS flux,
      al.date_bc::date AS date_flux,
      COALESCE(NULLIF(TRIM(al.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(al.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(al.designation::text), ''), 'NON RENSEIGNE') AS designation,
      -al.qte_activite_generique AS quantite,
      -COALESCE(al.montant_ht, 0)::numeric AS ca_ht,
      -COALESCE(al.marge_valeur, 0)::numeric AS marge_valeur
    FROM activite_norm al
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(al.numero_tiers_entete::text, '')))
    WHERE al.date_bc >= p_date_debut
      AND al.date_bc < p_date_fin
      AND al.date_bc IS NOT NULL
      AND al.type_document_norm IN ('BON DE RETOUR', 'BR')

    UNION ALL

    -- CDC depuis activité : BL et PL rattachés à leur date_bc
    SELECT
      'CDC'::text AS flux,
      al.date_bc::date AS date_flux,
      COALESCE(NULLIF(TRIM(al.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(al.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(al.designation::text), ''), 'NON RENSEIGNE') AS designation,
      CASE
        WHEN al.type_document_norm IN ('PRÉPARATION DE LIVRAISON', 'PREPARATION DE LIVRAISON', 'PL')
          THEN al.qte_activite_pl
        ELSE al.qte_activite_bl
      END AS quantite,
      COALESCE(al.montant_ht, 0)::numeric AS ca_ht,
      COALESCE(al.marge_valeur, 0)::numeric AS marge_valeur
    FROM activite_norm al
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(al.numero_tiers_entete::text, '')))
    WHERE al.date_bc >= p_date_debut
      AND al.date_bc < p_date_fin
      AND al.date_bc IS NOT NULL
      AND al.type_document_norm IN (
        'BON DE LIVRAISON', 'BL', 'BL M-X', 'BL MX',
        'PRÉPARATION DE LIVRAISON', 'PREPARATION DE LIVRAISON', 'PL'
      )

    UNION ALL

    -- CDC depuis factures
    SELECT
      'CDC'::text AS flux,
      fl.date_bc::date AS date_flux,
      COALESCE(NULLIF(TRIM(fl.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(fl.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(fl.designation::text), ''), 'NON RENSEIGNE') AS designation,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.qte_commandee, fl.quantite, 0)
        ELSE -COALESCE(fl.qte_commandee, fl.quantite, 0)
      END::numeric AS quantite,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.montant_ht, 0)
        ELSE -COALESCE(fl.montant_ht, 0)
      END::numeric AS ca_ht,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.marge_valeur, 0)
        ELSE -COALESCE(fl.marge_valeur, 0)
      END::numeric AS marge_valeur
    FROM public.facture_lignes fl
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(fl.numero_tiers_entete::text, '')))
    WHERE fl.date_bc >= p_date_debut
      AND fl.date_bc < p_date_fin
      AND fl.date_bc IS NOT NULL

    UNION ALL

    -- BL depuis activité : Bon de livraison / BL
    SELECT
      'BL'::text AS flux,
      al.date_piece::date AS date_flux,
      COALESCE(NULLIF(TRIM(al.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(al.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(al.designation::text), ''), 'NON RENSEIGNE') AS designation,
      al.qte_activite_bl AS quantite,
      COALESCE(al.montant_ht, 0)::numeric AS ca_ht,
      COALESCE(al.marge_valeur, 0)::numeric AS marge_valeur
    FROM activite_norm al
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(al.numero_tiers_entete::text, '')))
    WHERE al.date_piece >= p_date_debut
      AND al.date_piece < p_date_fin
      AND al.date_piece IS NOT NULL
      AND al.type_document_norm IN ('BON DE LIVRAISON', 'BL', 'BL M-X', 'BL MX')

    UNION ALL

    -- BL depuis activité : Bon de retour / BR, négatif
    SELECT
      'BL'::text AS flux,
      al.date_piece::date AS date_flux,
      COALESCE(NULLIF(TRIM(al.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(al.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(al.designation::text), ''), 'NON RENSEIGNE') AS designation,
      -al.qte_activite_bl AS quantite,
      -COALESCE(al.montant_ht, 0)::numeric AS ca_ht,
      -COALESCE(al.marge_valeur, 0)::numeric AS marge_valeur
    FROM activite_norm al
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(al.numero_tiers_entete::text, '')))
    WHERE al.date_piece >= p_date_debut
      AND al.date_piece < p_date_fin
      AND al.date_piece IS NOT NULL
      AND al.type_document_norm IN ('BON DE RETOUR', 'BR')

    UNION ALL

    -- BL depuis factures, daté par date_bl
    SELECT
      'BL'::text AS flux,
      fl.date_bl::date AS date_flux,
      COALESCE(NULLIF(TRIM(fl.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(fl.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(fl.designation::text), ''), 'NON RENSEIGNE') AS designation,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.qte_livree, fl.quantite, 0)
        ELSE -COALESCE(fl.qte_livree, fl.quantite, 0)
      END::numeric AS quantite,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.montant_ht, 0)
        ELSE -COALESCE(fl.montant_ht, 0)
      END::numeric AS ca_ht,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.marge_valeur, 0)
        ELSE -COALESCE(fl.marge_valeur, 0)
      END::numeric AS marge_valeur
    FROM public.facture_lignes fl
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(fl.numero_tiers_entete::text, '')))
    WHERE fl.date_bl >= p_date_debut
      AND fl.date_bl < p_date_fin
      AND fl.date_bl IS NOT NULL

    UNION ALL

    -- FACTURE
    SELECT
      'FACTURE'::text AS flux,
      fl.date_facture::date AS date_flux,
      COALESCE(NULLIF(TRIM(fl.depot::text), ''), 'NON RENSEIGNE') AS depot,
      COALESCE(ti.collaborateur_tiers, 'NON AFFECTE') AS collaborateur_tiers,
      COALESCE(ti.departement_tiers, 'NON RENSEIGNE') AS departement_tiers,
      NULLIF(TRIM(fl.reference_article::text), '') AS reference_article,
      COALESCE(NULLIF(TRIM(fl.designation::text), ''), 'NON RENSEIGNE') AS designation,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.quantite, 0)
        ELSE -COALESCE(fl.quantite, 0)
      END::numeric AS quantite,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.montant_ht, 0)
        ELSE -COALESCE(fl.montant_ht, 0)
      END::numeric AS ca_ht,
      CASE
        WHEN fl.numero_piece::text ILIKE 'FA0%' THEN COALESCE(fl.marge_valeur, 0)
        ELSE -COALESCE(fl.marge_valeur, 0)
      END::numeric AS marge_valeur
    FROM public.facture_lignes fl
    LEFT JOIN tiers ti ON ti.tiers_key = UPPER(TRIM(COALESCE(fl.numero_tiers_entete::text, '')))
    WHERE fl.date_facture >= p_date_debut
      AND fl.date_facture < p_date_fin
      AND fl.date_facture IS NOT NULL
  ),
  articles AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(TRIM(ra.reference_article::text)))
      UPPER(TRIM(ra.reference_article::text)) AS reference_key,
      COALESCE(NULLIF(TRIM(ra.famille::text), ''), 'NON RENSEIGNE') AS famille,
      COALESCE(ra.hors_statistique, false) AS hors_statistique
    FROM public.ref_articles ra
    WHERE NULLIF(TRIM(ra.reference_article::text), '') IS NOT NULL
    ORDER BY UPPER(TRIM(ra.reference_article::text))
  ),
  familles AS MATERIALIZED (
    SELECT DISTINCT ON (UPPER(TRIM(rf.famille::text)))
      UPPER(TRIM(rf.famille::text)) AS famille_key,
      COALESCE(NULLIF(TRIM(rf.famille_macro::text), ''), 'NON RENSEIGNE') AS famille_macro,
      COALESCE(NULLIF(TRIM(rf.quantite_pertinente::text), ''), 'Oui') AS quantite_pertinente_flag
    FROM public.ref_familles rf
    WHERE NULLIF(TRIM(rf.famille::text), '') IS NOT NULL
    ORDER BY UPPER(TRIM(rf.famille::text))
  ),
  enrichie AS (
    SELECT
      flx.flux,
      flx.date_flux,
      flx.depot,
      flx.collaborateur_tiers,
      flx.departement_tiers,
      COALESCE(NULLIF(TRIM(flx.reference_article::text), ''), 'NON RENSEIGNE') AS reference_article,
      flx.designation,
      COALESCE(a.famille, 'NON RENSEIGNE') AS famille,
      COALESCE(f.famille_macro, 'NON RENSEIGNE') AS famille_macro,
      COALESCE(a.hors_statistique, false) AS hors_statistique,
      COALESCE(f.quantite_pertinente_flag, 'Oui') AS quantite_pertinente_flag,
      flx.quantite,
      flx.ca_ht,
      flx.marge_valeur
    FROM flux_lignes flx
    LEFT JOIN articles a ON a.reference_key = UPPER(TRIM(flx.reference_article::text))
    LEFT JOIN familles f ON f.famille_key = UPPER(TRIM(COALESCE(a.famille, 'NON RENSEIGNE')))
    WHERE flx.date_flux IS NOT NULL
  )
  SELECT
    EXTRACT(YEAR FROM e.date_flux)::int AS annee,
    EXTRACT(MONTH FROM e.date_flux)::int AS mois,
    e.flux,
    e.flux AS type_document,
    e.depot,
    e.collaborateur_tiers,
    e.departement_tiers,
    e.famille_macro,
    e.famille,
    e.reference_article,
    e.designation,
    e.hors_statistique,
    COUNT(*)::int AS nb_lignes,
    ROUND(SUM(e.quantite)::numeric, 2) AS quantite,
    ROUND(SUM(
      CASE
        WHEN UPPER(TRIM(COALESCE(e.quantite_pertinente_flag, 'Oui'))) = 'NON' THEN 0
        ELSE e.quantite
      END
    )::numeric, 2) AS quantite_pertinente,
    ROUND(SUM(e.ca_ht)::numeric, 2) AS ca_ht,
    ROUND(SUM(e.marge_valeur)::numeric, 2) AS marge_valeur,
    NOW() AS updated_at
  FROM enrichie e
  GROUP BY
    EXTRACT(YEAR FROM e.date_flux)::int,
    EXTRACT(MONTH FROM e.date_flux)::int,
    e.flux,
    e.depot,
    e.collaborateur_tiers,
    e.departement_tiers,
    e.famille_macro,
    e.famille,
    e.reference_article,
    e.designation,
    e.hors_statistique;

END;
$function$;

GRANT EXECUTE ON FUNCTION public.rebuild_indicateur_flux_articles_mensuel_periode(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_indicateur_flux_articles_mensuel_periode(date, date) TO anon;
GRANT EXECUTE ON FUNCTION public.rebuild_indicateur_flux_articles_mensuel_periode(date, date) TO service_role;

ANALYZE public.indicateur_flux_articles_mensuel;

NOTIFY pgrst, 'reload schema';

-- Rebuild historique à lancer après application du patch, idéalement par tranches :
-- SELECT public.rebuild_indicateur_flux_articles_mensuel_periode_front(date '2023-01-01', date '2023-07-01');
-- SELECT public.rebuild_indicateur_flux_articles_mensuel_periode_front(date '2023-07-01', date '2024-01-01');
-- ... jusqu'au premier jour du mois suivant la date courante.
