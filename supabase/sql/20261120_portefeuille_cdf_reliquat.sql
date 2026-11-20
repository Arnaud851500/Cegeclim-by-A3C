-- 20/11/2026 — Portefeuille commandes fournisseurs : reliquats.
-- Une CDF partiellement réceptionnée reste dans le portefeuille avec ses seules lignes restantes
-- (SAGE sort les lignes reçues du BC vers BLF/FAF). L'écran n'indiquait pas qu'il s'agissait d'un
-- reliquat. On ajoute, par CDF :
--   reste_articles      : articles restant à livrer (6 plus gros montants), ex. « SPX-URFG1 ×200 »
--   nb_lignes_recues, qte_recue, montant_recu, derniere_reception : lignes BLF (13) / FAF (16, 17)
--     rattachées à la CDF (al_dlpiecebc) — limité à l'historique présent dans l'extraction sage.bdcf
--   est_reliquat        : au moins une réception rattachée
-- nb_lignes / qte / montant_ht restent ceux du reste à livrer.
-- Patch de la définition en place (même méthode que 20261023d / 20261102).
do $$
declare
  d text := pg_get_functiondef('public.get_appro_portefeuille_cdf()'::regprocedure);
  procedure_motifs text[][] := array[
    [$a$b.al_dldatebc, b.loaded_at,$a$,
     $n$b.al_dldatebc, b.loaded_at, b.al_art_num,$n$],
    [$a$max(l.loaded_at) as loaded_at$a$,
     $n$max(l.loaded_at) as loaded_at,
           (array_agg(coalesce(nullif(btrim(l.al_art_num), ''), '?') || ' ×' || (l.qte::float8)::text order by l.mt desc))[1:6] as reste_articles$n$],
    [$a$rel_n as (select cdf_numero$a$,
     $n$recu as (
    select r.al_dlpiecebc as numero, count(*) as nb, sum(coalesce(r.qtevendues, 0)) as qte,
           sum(coalesce(r.cahtnet, 0)) as mt, max(sage_date_text_to_date(nullif(btrim(r.al_dldatebl), ''))) as derniere
    from sage.bdcf r
    where r.al_doctype in ('13', '16', '17') and nullif(btrim(r.al_dlpiecebc), '') is not null
    group by 1
  ),
  rel_n as (select cdf_numero$n$],
    [$a$coalesce(d.nb_cdc_tardives, 0) as nb_cdc_tardives$a$,
     $n$coalesce(d.nb_cdc_tardives, 0) as nb_cdc_tardives,
           coalesce(rc.nb, 0) as nb_lignes_recues, coalesce(rc.qte, 0) as qte_recue,
           coalesce(rc.mt, 0) as montant_recu, rc.derniere as derniere_reception$n$],
    [$a$left join fam fa on fa.al_docnum = c.numero$a$,
     $n$left join fam fa on fa.al_docnum = c.numero
    left join recu rc on rc.numero = c.numero$n$],
    [$a$'premiere_livraison_cdc', c.premiere_livraison_cdc,$a$,
     $n$'premiere_livraison_cdc', c.premiere_livraison_cdc,
           'reste_articles', to_jsonb(coalesce(c.reste_articles, '{}')),
           'est_reliquat', c.nb_lignes_recues > 0,
           'nb_lignes_recues', c.nb_lignes_recues,
           'qte_recue', c.qte_recue,
           'montant_recu', round(c.montant_recu::numeric, 2),
           'derniere_reception', c.derniere_reception,$n$]
  ];
  i int;
begin
  if position('as reste_articles' in d) > 0 then return; end if;
  for i in 1 .. array_length(procedure_motifs, 1) loop
    if position(procedure_motifs[i][1] in d) = 0 then
      raise exception 'Motif % introuvable dans get_appro_portefeuille_cdf : %', i, procedure_motifs[i][1];
    end if;
    d := replace(d, procedure_motifs[i][1], procedure_motifs[i][2]);
  end loop;
  execute d;
end $$;
