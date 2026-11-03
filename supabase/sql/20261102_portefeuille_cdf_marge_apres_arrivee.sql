-- 02/11/2026 — Portefeuille commandes fournisseurs : plus d'alerte « Marge critique » (CONT_MARGE)
-- quand le dernier relevé de suivi bateau indique que le container est arrivé au port, déchargé ou
-- livré FMS. La marge (date de livraison CDF − ETA port) ne sert qu'à anticiper un retard bateau :
-- une fois le bateau à quai, elle n'a plus de sens. Le verdict de marge reste calculé (info-bulle).
-- Patch de la définition en place (même méthode que 20261023d), logique inchangée par ailleurs.
do $$
declare
  d text := pg_get_functiondef('public.get_appro_portefeuille_cdf()'::regprocedure);
  ancien text := $a$case when c.verdict in ('RETARD', 'INTENABLE', 'TRES_JUSTE') then 'CONT_MARGE' end$a$;
  nouveau text := $n$case when c.verdict in ('RETARD', 'INTENABLE', 'TRES_JUSTE')
                       and coalesce(c.statut_suivi, '') not in ('arrive', 'decharge', 'livre') then 'CONT_MARGE' end$n$;
begin
  if position(nouveau in d) > 0 then return; end if;
  if position(ancien in d) = 0 then raise exception 'Motif CONT_MARGE introuvable dans get_appro_portefeuille_cdf'; end if;
  execute replace(d, ancien, nouveau);
end $$;
