-- ============================================================================
-- 20261108b_hotline_recherche_mobile.sql — Hotline (08/11/2026)
-- ----------------------------------------------------------------------------
-- Recherche de tickets pour le bloc mobile « Hotline - Ticketing »
-- (components/mobile/MobileHotline.tsx) : critères d'identification
-- (téléphone, n° de série UI / GE, modèle GE / UI, code défaut, client,
-- chantier, texte libre) + filtres de la classification (filière, gamme,
-- nature, symptôme, organe, action, issue) + statut et période.
-- Renvoie le nombre total, une page de tickets et les compteurs par valeur
-- de chaque axe de filtre (sur l'ensemble des tickets trouvés).
-- SECURITY INVOKER : la RLS de hotline_tickets (hotline_peut_acceder) s'applique.
--
-- p_filtres (jsonb, toutes les clés facultatives) :
--   q, tel, serie, modele, code, client, chantier : texte
--   filiere, gamme, nature, symptome, organe, action, issue : code, ou '-' = non renseigné
--   statut : 'ACTIFS' (ouvert / en cours / escaladé), 'TERMINES' (résolu / clos) ou un statut
--   du, au : dates AAAA-MM-JJ (création, bornes incluses)
-- ============================================================================

create index if not exists idx_hotline_tickets_code_norme on public.hotline_tickets (public.hotline_code_defaut_norme(code_defaut));
create index if not exists idx_hotline_tickets_opened on public.hotline_tickets (opened_at desc);

create or replace function public.hotline_recherche(p_filtres jsonb default '{}'::jsonb, p_limite int default 40, p_offset int default 0)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  f jsonb := coalesce(p_filtres, '{}'::jsonb);
  v_q text := nullif(btrim(f->>'q'), '');
  v_tel text := public.hotline_tel_cle(nullif(btrim(f->>'tel'), ''));
  v_tel_brut text := regexp_replace(coalesce(f->>'tel', ''), '\D', '', 'g');
  v_serie text := nullif(btrim(f->>'serie'), '');
  v_modele text := nullif(btrim(f->>'modele'), '');
  v_code text := public.hotline_code_defaut_norme(nullif(btrim(f->>'code'), ''));
  v_client text := nullif(btrim(f->>'client'), '');
  v_chantier text := nullif(btrim(f->>'chantier'), '');
  v_statut text := nullif(f->>'statut', '');
  v_du date := nullif(f->>'du', '')::date;
  v_au date := nullif(f->>'au', '')::date;
  v jsonb;
begin
  with t as (
    select h.*
    from public.hotline_tickets h
    where (v_q is null or concat_ws(' ', h.numero, h.intitule_tiers, h.numero_tiers, h.contact_nom, h.chantier,
                                    h.description, h.preconisation, h.modele_ge, h.reference_article, h.numero_serie, h.serie_ge)
                          ilike '%' || v_q || '%')
      and (length(v_tel_brut) < 4
           or (v_tel is not null and public.hotline_tel_cle(h.telephone_appelant) = v_tel)
           or (v_tel is null and regexp_replace(coalesce(h.telephone_appelant, ''), '\D', '', 'g') like '%' || v_tel_brut || '%'))
      and (v_serie is null or h.numero_serie ilike '%' || v_serie || '%' or h.serie_ge ilike '%' || v_serie || '%')
      and (v_modele is null or h.modele_ge ilike '%' || v_modele || '%' or h.reference_article ilike '%' || v_modele || '%')
      and (f->>'code' is null or btrim(f->>'code') = ''
           or public.hotline_code_defaut_norme(h.code_defaut) = v_code
           or h.code_defaut ilike '%' || btrim(f->>'code') || '%')
      and (v_client is null or h.intitule_tiers ilike '%' || v_client || '%' or h.numero_tiers ilike v_client || '%' or h.contact_nom ilike '%' || v_client || '%')
      and (v_chantier is null or h.chantier ilike '%' || v_chantier || '%')
      and (coalesce(f->>'filiere', '') = '' or h.filiere = f->>'filiere')
      and (coalesce(f->>'gamme', '') = '' or (f->>'gamme' = '-' and h.gamme is null) or h.gamme = f->>'gamme')
      and (coalesce(f->>'nature', '') = '' or (f->>'nature' = '-' and h.nature is null) or h.nature = f->>'nature')
      and (coalesce(f->>'symptome', '') = '' or (f->>'symptome' = '-' and h.symptome is null) or h.symptome = f->>'symptome')
      and (coalesce(f->>'organe', '') = '' or (f->>'organe' = '-' and h.organe is null) or h.organe = f->>'organe')
      and (coalesce(f->>'issue', '') = '' or (f->>'issue' = '-' and h.issue is null) or h.issue = f->>'issue')
      and (coalesce(f->>'action', '') = '' or (f->>'action' = '-' and coalesce(cardinality(h.actions), 0) = 0) or h.actions @> array[f->>'action'])
      and (v_statut is null
           or (v_statut = 'ACTIFS' and h.statut in ('OUVERT', 'EN_COURS', 'ESCALADE'))
           or (v_statut = 'TERMINES' and h.statut in ('RESOLU', 'CLOS'))
           or h.statut = v_statut)
      and (v_du is null or h.opened_at >= v_du)
      and (v_au is null or h.opened_at < v_au + 1)
  ),
  page as (
    select * from t order by opened_at desc, id limit greatest(1, least(coalesce(p_limite, 40), 200)) offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select count(*) from t),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'numero', numero, 'filiere', filiere, 'gamme', gamme, 'nature', nature, 'motif', motif,
        'statut', statut, 'niveau', niveau, 'opened_at', opened_at, 'resolved_at', resolved_at,
        'telephone_appelant', telephone_appelant, 'numero_tiers', numero_tiers, 'intitule_tiers', intitule_tiers,
        'contact_nom', contact_nom, 'chantier', chantier, 'modele_ge', modele_ge, 'serie_ge', serie_ge,
        'reference_article', reference_article, 'numero_serie', numero_serie, 'code_defaut', code_defaut,
        'symptome', symptome, 'organe', organe, 'actions', actions, 'issue', issue, 'classif_source', classif_source,
        'description', left(description, 300)) order by opened_at desc, id), '[]'::jsonb) from page),
    'facettes', jsonb_build_object(
      'filiere',  (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(filiere, '-') k, count(*) n from t group by 1) x),
      'gamme',    (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(gamme, '-') k, count(*) n from t group by 1) x),
      'nature',   (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(nature, '-') k, count(*) n from t group by 1) x),
      'symptome', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(symptome, '-') k, count(*) n from t group by 1) x),
      'organe',   (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(organe, '-') k, count(*) n from t group by 1) x),
      'issue',    (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(issue, '-') k, count(*) n from t group by 1) x),
      'action',   (select coalesce(jsonb_object_agg(k, n), '{}') from (
                     select coalesce(a, '-') k, count(*) n from t left join lateral unnest(t.actions) a on true group by 1) x),
      'statut',   (select coalesce(jsonb_object_agg(k, n), '{}') from (select statut k, count(*) n from t group by 1) x)
    )
  ) into v;
  return v;
end
$function$;

grant execute on function public.hotline_recherche(jsonb, int, int) to authenticated;
