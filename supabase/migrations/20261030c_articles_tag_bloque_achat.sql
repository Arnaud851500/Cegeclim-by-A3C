-- ============================================================================
-- 20261030c_articles_tag_bloque_achat.sql
-- Écran « Articles SAGE / BLG » : le blocage appro SAGE (AR_InterdireCommande)
-- se compare désormais au tag BLG « Bloqué achat » (tag système
-- purchaseBlocked), posé en masse dans BLG le 30/10/2026, et non plus à la
-- nature « Classique / Parc - Achat interdit ».
--  * public.blg_article_bloque_achat(part_id) : tag présent dans
--    blg.article_article_tag ou dans le champ texte article_part.tag.
--  * v_controle_article_sage_blg : blg_achat_interdit ('Oui' / 'Non') et
--    blg_achat_interdit_bool lus sur le tag.
--  * v_blg_nomenclature_lignes / v_controle_nomenclature_sage_blg :
--    parent_/composant_(blg_)achat_interdit lus sur le tag ; vues
--    matérialisées mv_* rafraîchies.
--  Les noms de colonnes ne changent pas (écran inchangé côté données) ; la
--  colonne nature_achat_interdit de v_blg_articles_complet reste disponible.
--  Les vues sont réécrites à partir de leur définition en base (replace
--  contrôlé : la migration échoue si un motif attendu est introuvable).
-- ============================================================================

create or replace function public.blg_article_bloque_achat(p_part_id integer)
returns boolean
language sql
stable
strict
security definer
set search_path = public, blg
as $$
  select exists (
           select 1
           from blg.article_article_tag at
           join blg.core_tag t on t.id = at.tag_fk
           where at.article_fk = p_part_id
             and (t.name = 'purchaseBlocked' or blg_fr(t.title) ilike 'Bloqué achat')
         )
      or exists (
           select 1 from blg.article_part p
           where p.id = p_part_id and coalesce(p.tag, '') ilike '%|purchaseBlocked|%'
         )
$$;
grant execute on function public.blg_article_bloque_achat(integer) to authenticated;

create index if not exists idx_article_article_tag_article_fk on blg.article_article_tag (article_fk);

do $mig$
declare
  d text;
  n text;
begin
  -- 1. v_controle_article_sage_blg
  d := pg_get_viewdef('public.v_controle_article_sage_blg'::regclass);
  n := replace(d,
    $a$WHEN b.nature_achat_interdit THEN (('Oui ('::text || b.nature) || ')'::text)
            ELSE (('Non ('::text || COALESCE(b.nature, '—'::text)) || ')'::text)$a$,
    $b$WHEN public.blg_article_bloque_achat(b.part_id) THEN 'Oui'::text
            ELSE 'Non'::text$b$);
  if n = d then raise exception 'v_controle_article_sage_blg : motif CASE introuvable'; end if;
  d := n;
  n := replace(d, 'b.nature_achat_interdit AS blg_achat_interdit_bool', 'public.blg_article_bloque_achat(b.part_id) AS blg_achat_interdit_bool');
  if n = d then raise exception 'v_controle_article_sage_blg : motif bool introuvable'; end if;
  execute 'create or replace view public.v_controle_article_sage_blg as ' || n;

  -- 2. v_blg_nomenclature_lignes
  d := pg_get_viewdef('public.v_blg_nomenclature_lignes'::regclass);
  n := replace(replace(d,
         'pp.nature_achat_interdit AS parent_achat_interdit', 'public.blg_article_bloque_achat(pp.part_id) AS parent_achat_interdit'),
         'cp.nature_achat_interdit AS composant_achat_interdit', 'public.blg_article_bloque_achat(cp.part_id) AS composant_achat_interdit');
  if n = d then raise exception 'v_blg_nomenclature_lignes : motifs introuvables'; end if;
  execute 'create or replace view public.v_blg_nomenclature_lignes as ' || n;

  -- 3. v_controle_nomenclature_sage_blg
  d := pg_get_viewdef('public.v_controle_nomenclature_sage_blg'::regclass);
  n := replace(replace(d,
         'pb.nature_achat_interdit AS parent_blg_achat_interdit', 'public.blg_article_bloque_achat(pb.part_id) AS parent_blg_achat_interdit'),
         'cb.nature_achat_interdit AS composant_blg_achat_interdit', 'public.blg_article_bloque_achat(cb.part_id) AS composant_blg_achat_interdit');
  if n = d then raise exception 'v_controle_nomenclature_sage_blg : motifs introuvables'; end if;
  execute 'create or replace view public.v_controle_nomenclature_sage_blg as ' || n;
end
$mig$;

refresh materialized view public.mv_blg_nomenclature_lignes;
refresh materialized view public.mv_controle_nomenclature_sage_blg;
