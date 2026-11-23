-- =============================================================================
-- « Quand puis-je livrer ? » — rapprochement des références lues sur une image
-- (23/11/2026, demandé par Arnaud)
-- -----------------------------------------------------------------------------
-- Sur une capture de commande SAGE, l'IA lisait mal certaines références
-- (AIRZONTHLIFB → « AIRZONTHLFIB », GRI600 → « GRID600 ») et sautait les
-- références tronquées par la grille (« AZC25BS5RAD50… »). Chaque ligne lue
-- (référence + désignation) est désormais rapprochée du catalogue ref_articles :
--   1. EXACTE             : référence identique ;
--   2. SANS_SEPARATEUR    : identique aux tirets / espaces / points près (CR20BT1412M1 → CR20-BT1412M1) ;
--   3. DESIGNATION        : désignation identique à celle de l'article (aux accents et ponctuation près),
--                           prioritaire pour une référence tronquée ;
--   4. TRONQUEE           : la référence lue est le début de la référence ; départage par la désignation ;
--   5. APPROCHANTE        : 1 à 3 caractères d'écart (selon la longueur) ; départage par la désignation,
--                           qui doit ressembler (≥ 25 % de mots communs) dès 2 caractères d'écart ;
--   6. DESIGNATION_PROCHE : désignation très proche (≥ 60 % de mots communs) ;
--   sinon NON_TROUVEE (la référence lue est gardée et sera signalée « inconnue »).
-- Extension fuzzystrmatch (levenshtein) ajoutée dans le schéma extensions.
-- =============================================================================

create extension if not exists fuzzystrmatch with schema extensions;

create or replace function public.ql_norm_ref(t text) returns text
language sql immutable as $$
  select regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g')
$$;

create or replace function public.ql_mots(t text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct m), '{}')
  from regexp_split_to_table(
         upper(translate(coalesce(t, ''),
           'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
           'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
         '[^A-Z0-9]+') m
  where length(m) >= 2
$$;

create or replace function public.ql_jaccard(a text[], b text[]) returns numeric
language sql immutable as $$
  select case when coalesce(cardinality(a), 0) = 0 or coalesce(cardinality(b), 0) = 0 then 0
              else (select count(*) from (select unnest(a) intersect select unnest(b)) i)::numeric
                   / (select count(*) from (select unnest(a) union select unnest(b)) u) end
$$;

create or replace function public.ql_resoudre_references(p_lignes jsonb)
returns jsonb
language plpgsql
volatile security definer   -- table temporaire du catalogue
set search_path to 'public', 'extensions'
as $function$
declare
  e jsonb;
  v_res jsonb := '[]'::jsonb;
  v_lu text;
  v_brut text;
  v_c text;
  v_des text;
  v_mots text[];
  v_tronq boolean;
  v_ref text;
  v_meth text;
  v_dist int;
  v_seuil int;
  v_score numeric;
  i int := 0;
begin
  create temp table if not exists _ql_cat (ref text, nref text, mots text[], designation text) on commit drop;
  if not exists (select 1 from _ql_cat) then
    insert into _ql_cat
    select reference_article, ql_norm_ref(reference_article), ql_mots(designation), designation
    from ref_articles where nullif(trim(reference_article), '') is not null;
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_lignes, '[]'::jsonb)) loop
    i := i + 1;
    v_brut := upper(trim(coalesce(e->>'ref', '')));
    v_tronq := v_brut ~ '(\.\.\.|…|\.\.)$' or coalesce((e->>'tronquee')::boolean, false);
    v_lu := regexp_replace(v_brut, '(\.\.\.|…|\.\.)$', '');
    v_c := ql_norm_ref(v_lu);
    v_des := nullif(trim(coalesce(e->>'designation', '')), '');
    v_mots := ql_mots(v_des);
    v_ref := null; v_meth := null; v_dist := null; v_score := null;

    -- 1. exacte (sauf référence tronquée)
    if not v_tronq then
      select c.ref into v_ref from _ql_cat c where c.ref = v_lu limit 1;
      if v_ref is not null then v_meth := 'EXACTE'; end if;
    end if;

    -- 2. aux séparateurs près
    if v_ref is null and not v_tronq and length(v_c) >= 3 then
      select c.ref into v_ref from _ql_cat c where c.nref = v_c
      order by ql_jaccard(c.mots, v_mots) desc, c.ref limit 1;
      if v_ref is not null then v_meth := 'SANS_SEPARATEUR'; end if;
    end if;

    -- 3. désignation identique (départage par le début de la référence lue)
    if v_ref is null and cardinality(v_mots) >= 2 then
      select c.ref into v_ref from _ql_cat c
      where c.mots @> v_mots and v_mots @> c.mots
      order by (v_c <> '' and c.nref like v_c || '%') desc, levenshtein(left(c.nref, 40), left(v_c, 40)), c.ref limit 1;
      if v_ref is not null then v_meth := 'DESIGNATION'; end if;
    end if;

    -- 4. référence tronquée : préfixe
    if v_ref is null and length(v_c) >= 4 then
      select c.ref, ql_jaccard(c.mots, v_mots) into v_ref, v_score from _ql_cat c
      where c.nref like v_c || '%' and (v_tronq or c.nref <> v_c)
      order by ql_jaccard(c.mots, v_mots) desc, length(c.nref), c.ref limit 1;
      if v_ref is not null then
        -- hors troncature signalée, un préfixe ne vaut que s'il est unique ou confirmé par la désignation
        if v_tronq or coalesce(v_score, 0) >= 0.4
           or (select count(*) from _ql_cat c where c.nref like v_c || '%') = 1 then
          v_meth := 'TRONQUEE';
        else
          v_ref := null;
        end if;
      end if;
    end if;

    -- 5. approchante (fautes de lecture)
    if v_ref is null and length(v_c) >= 4 then
      v_seuil := case when length(v_c) <= 6 then 1 when length(v_c) <= 12 then 2 else 3 end;
      select c.ref, levenshtein(left(c.nref, 60), left(v_c, 60)), ql_jaccard(c.mots, v_mots)
        into v_ref, v_dist, v_score
      from _ql_cat c
      where abs(length(c.nref) - length(v_c)) <= v_seuil
        and levenshtein_less_equal(left(c.nref, 60), left(v_c, 60), v_seuil) <= v_seuil
      order by levenshtein(left(c.nref, 60), left(v_c, 60)), ql_jaccard(c.mots, v_mots) desc, c.ref
      limit 1;
      if v_ref is not null then
        if v_dist >= 2 and cardinality(v_mots) >= 2 and coalesce(v_score, 0) < 0.25 then
          v_ref := null;
        else
          v_meth := 'APPROCHANTE';
        end if;
      end if;
    end if;

    -- 6. désignation proche
    if v_ref is null and cardinality(v_mots) >= 3 then
      select c.ref, ql_jaccard(c.mots, v_mots) into v_ref, v_score from _ql_cat c
      where c.mots && v_mots
      order by ql_jaccard(c.mots, v_mots) desc, c.ref limit 1;
      if v_ref is not null and coalesce(v_score, 0) >= 0.6 then v_meth := 'DESIGNATION_PROCHE'; else v_ref := null; end if;
    end if;

    v_res := v_res || jsonb_build_array(jsonb_build_object(
      'i', i, 'lu', v_brut, 'ref', coalesce(v_ref, v_lu), 'methode', coalesce(v_meth, 'NON_TROUVEE'),
      'distance', v_dist,
      'designation_article', (select c.designation from _ql_cat c where c.ref = v_ref limit 1)));
  end loop;
  return v_res;
end;
$function$;

grant execute on function public.ql_resoudre_references(jsonb) to authenticated;
