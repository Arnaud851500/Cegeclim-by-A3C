-- Assistant BI CEGECLIM : exécution SQL readonly étendue.
-- À exécuter une fois dans l'éditeur SQL Supabase avant d'utiliser les analyses
-- Référence × Agence, nouveaux clients ou classes ABC.

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
    'v_stock_projection_alertes_abc'
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

  -- Protège Supabase d'une requête analytique anormalement longue.
  PERFORM set_config('statement_timeout', '120000', true);

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
'Exécute les SELECT readonly validés de l Assistant BI sur les agrégats, lignes détaillées et référentiels autorisés.';
