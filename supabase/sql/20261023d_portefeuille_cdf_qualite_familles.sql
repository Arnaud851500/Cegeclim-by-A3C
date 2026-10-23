-- ============================================================================
-- 20261023d_portefeuille_cdf_qualite_familles.sql  (appliquée en production le 23/10/2026)
-- ----------------------------------------------------------------------------
-- get_appro_portefeuille_cdf : chaque CDF expose
--   - fournisseur_qualite : qualité du fournisseur (sage.tiers.ti_ctqualite :
--     MARCHANDISE, PV, STATION TECHNIQUE, GROUPE CEGECLIM, FRAIS GENERAUX) ;
--   - familles : { <famille macro> : { nb_lignes, qte, montant_ht } } calculé sur
--     les lignes de la CDF (ref_articles.famille -> ref_familles.famille_macro),
--     pour le filtre « Famille macro » de l'écran.
-- Modification appliquée par remplacement dans la définition existante.
-- ============================================================================
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.get_appro_portefeuille_cdf()'::regprocedure);
  if position('fam fa' in d) > 0 then return; end if;   -- déjà appliquée
  n := d;
  n := replace(n, '  base as (', '  fam as (
    select x.al_docnum,
           jsonb_object_agg(x.famille_macro, jsonb_build_object(''nb_lignes'', x.nb, ''qte'', x.qte, ''montant_ht'', round(x.mt::numeric, 2))) as familles
    from (
      select b.al_docnum, coalesce(f.famille_macro, ''Sans famille macro'') as famille_macro,
             count(*) as nb, sum(coalesce(b.qtevendues, 0)) as qte, sum(coalesce(b.cahtnet, 0)) as mt
      from sage.bdcf b
      left join public.ref_articles a on a.reference_article = b.al_art_num
      left join public.ref_familles f on f.famille = a.famille
      where b.al_doctype = ''12''
      group by 1, 2
    ) x
    group by x.al_docnum
  ),
  base as (');
  n := replace(n, 't.ti_intitule as fournisseur_nom,', 't.ti_intitule as fournisseur_nom, t.ti_ctqualite as fournisseur_qualite, fa.familles,');
  n := replace(n, 'left join dep d on d.numero = c.numero', 'left join dep d on d.numero = c.numero
    left join fam fa on fa.al_docnum = c.numero');
  n := replace(n, '''fournisseur_nom'', c.fournisseur_nom,', '''fournisseur_nom'', c.fournisseur_nom,
           ''fournisseur_qualite'', c.fournisseur_qualite,
           ''familles'', coalesce(c.familles, ''{}''::jsonb),');
  if n = d or position('fam fa' in n) = 0 or position('fournisseur_qualite'', c.' in n) = 0 then
    raise exception 'remplacement incomplet';
  end if;
  execute n;
end $do$;
