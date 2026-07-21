-- Assistant BI CEGECLIM : exécution SQL readonly étendue et optimisée.
-- À exécuter une fois dans l'éditeur SQL Supabase.
--
-- Cette version :
--   - porte le timeout analytique à 5 minutes ;
--   - ajoute les index principaux de lecture de Flux Articles ;
--   - met en cache la classe ABC courante par référence ;
--   - remplace transparentement la vue ABC historique par ce cache dans les
--     requêtes de l'Assistant BI.

CREATE TABLE IF NOT EXISTS public.assistant_bi_abc_current_cache (
  reference_article text PRIMARY KEY,
  classe_abc_ca text,
  classe_abc_lignes text,
  run_created_at timestamptz,
  run_completed_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assistant_bi_abc_current_ca
ON public.assistant_bi_abc_current_cache (classe_abc_ca, reference_article);

CREATE INDEX IF NOT EXISTS idx_assistant_bi_abc_current_lignes
ON public.assistant_bi_abc_current_cache (classe_abc_lignes, reference_article);

CREATE INDEX IF NOT EXISTS idx_flux_articles_bi_periode_flux
ON public.indicateur_flux_articles_mensuel (
  flux,
  annee,
  mois,
  hors_statistique
);

CREATE INDEX IF NOT EXISTS idx_flux_articles_bi_reference
ON public.indicateur_flux_articles_mensuel (reference_article);

CREATE INDEX IF NOT EXISTS idx_ref_collaborateurs_nom_trim
ON public.ref_collaborateurs ((BTRIM(nom::text)));

CREATE OR REPLACE FUNCTION public.refresh_assistant_bi_abc_current_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  INSERT INTO public.assistant_bi_abc_current_cache (
    reference_article,
    classe_abc_ca,
    classe_abc_lignes,
    run_created_at,
    run_completed_at,
    refreshed_at
  )
  SELECT DISTINCT ON (BTRIM(reference_article::text))
    BTRIM(reference_article::text) AS reference_article,
    classe_abc_ca,
    classe_abc_lignes,
    run_created_at,
    run_completed_at,
    now()
  FROM public.v_stock_projection_alertes_abc
  WHERE NULLIF(BTRIM(reference_article::text), '') IS NOT NULL
  ORDER BY
    BTRIM(reference_article::text),
    run_completed_at DESC NULLS LAST,
    run_created_at DESC NULLS LAST
  ON CONFLICT (reference_article) DO UPDATE
  SET classe_abc_ca = EXCLUDED.classe_abc_ca,
      classe_abc_lignes = EXCLUDED.classe_abc_lignes,
      run_created_at = EXCLUDED.run_created_at,
      run_completed_at = EXCLUDED.run_completed_at,
      refreshed_at = EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_assistant_bi_abc_current_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_assistant_bi_abc_current_cache() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_assistant_bi_abc_current_cache() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_assistant_bi_abc_current_cache() TO service_role;

COMMENT ON FUNCTION public.refresh_assistant_bi_abc_current_cache() IS
'Actualise la classe ABC courante utilisée par l Assistant BI, une ligne par référence article.';

-- Premier chargement. Les appels suivants peuvent être effectués après chaque
-- recalcul complet de la projection stock.
SELECT public.refresh_assistant_bi_abc_current_cache();

CREATE OR REPLACE FUNCTION public.atelier_ai_run_readonly_sql_v2(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text := btrim(COALESCE(p_sql, ''));
  v_sql_relations text;
  v_result jsonb;
  v_match text[];
  v_relation text;
  v_ctes text[] := ARRAY[]::text[];
  v_allowed_relations constant text[] := ARRAY[
    'indicateur_factures_mensuel',
    'indicateur_activite_mensuel',
    'indicateur_devis_mensuel',
    'indicateur_flux_articles_mensuel',
    'facture_lignes',
    'devis_lignes',
    'activite_lignes',
    'ref_tiers',
    'ref_collaborateurs',
    'ref_articles',
    'ref_familles',
    'v_stock_projection_alertes_abc',
    'assistant_bi_abc_current_cache'
  ];
BEGIN
  IF v_sql = '' THEN
    RAISE EXCEPTION 'Requête SQL vide.';
  END IF;

  IF length(v_sql) > 100000 THEN
    RAISE EXCEPTION 'Requête SQL trop volumineuse.';
  END IF;

  IF v_sql !~* '^\s*(select|with)\M' THEN
    RAISE EXCEPTION 'Seules les requêtes SELECT ou WITH sont autorisées.';
  END IF;

  IF v_sql ~ ';' OR v_sql ~ '--' OR v_sql ~ '/\*' THEN
    RAISE EXCEPTION 'Commentaires et instructions multiples interdits.';
  END IF;

  IF v_sql ~* '\m(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do|execute|merge|vacuum|refresh)\M' THEN
    RAISE EXCEPTION 'Instruction SQL non autorisée.';
  END IF;

  -- Recense les alias de CTE afin de ne pas les confondre avec des tables.
  FOR v_match IN
    SELECT regexp_matches(v_sql, '(\mwith\M|,)\s*([a-z_][a-z0-9_]*)\s+\mas\M\s*\(', 'gi')
  LOOP
    v_ctes := array_append(v_ctes, lower(v_match[2]));
  END LOOP;

  -- EXTRACT(YEAR FROM date) contient le mot FROM mais ne référence aucune table.
  v_sql_relations := regexp_replace(
    v_sql,
    'EXTRACT\s*\(\s*(YEAR|MONTH|DAY|QUARTER)\s+FROM\s+',
    'EXTRACT(\1 __DATE_FROM__ ',
    'gi'
  );

  FOR v_match IN
    SELECT regexp_matches(
      v_sql_relations,
      '\m(from|join)\M\s+((public\.)?[a-zA-Z_][a-zA-Z0-9_]*)',
      'gi'
    )
  LOOP
    v_relation := lower(regexp_replace(v_match[2], '^public\.', '', 'i'));

    IF NOT (v_relation = ANY(v_allowed_relations))
       AND NOT (v_relation = ANY(v_ctes)) THEN
      RAISE EXCEPTION 'Table non autorisée : %', v_relation;
    END IF;
  END LOOP;

  -- Les requêtes générées utilisent historiquement la vue complète ABC et
  -- exécutent un DISTINCT ON à chaque analyse. Le cache possède déjà une ligne
  -- courante par référence et remplace donc cette source de façon transparente.
  v_sql := regexp_replace(
    v_sql,
    'public\.v_stock_projection_alertes_abc',
    'public.assistant_bi_abc_current_cache',
    'gi'
  );

  -- Protège Supabase tout en laissant aux analyses détaillées suffisamment de
  -- temps pour agréger plusieurs dimensions.
  PERFORM set_config('statement_timeout', '300000', true);

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(to_jsonb(result_row)), ''[]''::jsonb) FROM (%s) AS result_row',
    v_sql
  ) INTO v_result;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql_v2(text) FROM anon;
REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql_v2(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atelier_ai_run_readonly_sql_v2(text) TO service_role;

COMMENT ON FUNCTION public.atelier_ai_run_readonly_sql_v2(text) IS
'Exécute les SELECT readonly validés de l Assistant BI sur les agrégats, lignes détaillées et référentiels autorisés, avec cache ABC courant.';

-- Compatibilité avec la route actuelle : le RPC historique délègue au moteur v2.
CREATE OR REPLACE FUNCTION public.atelier_ai_run_readonly_sql(p_sql text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.atelier_ai_run_readonly_sql_v2(p_sql);
$$;

REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql(text) FROM anon;
REVOKE ALL ON FUNCTION public.atelier_ai_run_readonly_sql(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.atelier_ai_run_readonly_sql(text) TO service_role;

COMMENT ON FUNCTION public.atelier_ai_run_readonly_sql(text) IS
'Point d entrée compatible de l Assistant BI, délégué au moteur readonly étendu v2.';
