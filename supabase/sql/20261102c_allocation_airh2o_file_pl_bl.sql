-- 02/11/2026 — Allocation AirH2O 600 / 800 : « à son tour ? » pour les PL et les BL depuis le 26/10.
-- ---------------------------------------------------------------------------------------------
-- Demande d'Arnaud : une PL bloque le stock et un BL l'a déjà sorti ; on ne voyait plus si la commande
-- pouvait être servie si tôt, ni si elle aurait dû attendre une CDF future.
--
-- Rejeu de la file « à son tour », toutes agences, par référence :
--   - offre  = stock physique (sto_qte, PL comprises) + BL datés depuis le 26/10 (remis en stock,
--              ils l'ont consommé pendant la période d'allocation) aujourd'hui, puis les CDF ouvertes
--              à leur date de réception retenue (v_couverture_stock_receptions) ;
--   - demande = CDC ouvertes (année et année suivante), PL (avant et depuis le 26/10) et BL depuis le 26/10,
--              servies par date de livraison demandée puis date de création de la CDC (même règle que
--              la couverture des CDC) ;
--   - pour chaque PL / BL depuis le 26/10 : ce qui l'aurait couverte à son tour (stock actuel, ou telle CDF
--     à telle date, à l'heure ou en retard sur la date demandée, ou rien) et, si elle n'était pas couverte
--     par le stock à son tour, les CDC dues avant elle qui attendent aujourd'hui une CDF (« passée devant »).
-- Champs ajoutés aux lignes de get_allocation_ro : file_statut (COUVERT / COUVERT_PAR_RECEPTION /
-- RECEPTION_TARDIVE / RUPTURE), file_cdf, file_date, file_retard, file_doublees, file_doublees_q, file_doublees_cdc.
-- Patch de la définition en place (même méthode que 20261023d), le reste de la fonction est inchangé.
do $patch$
declare
  d text := pg_get_functiondef('public.get_allocation_ro()'::regprocedure);
  a1 text := $a$  -- 26/10/2026 : allocation pas encore commandée (Allocation − CDC Liv − BL/PL depuis le 26/10)$a$;
  n1 text := $n$  -- 02/11/2026 : file « à son tour » (toutes agences) pour juger les PL et les BL depuis le 26/10
  file_dem as (
    select x.*, sum(x.q) over (partition by x.ref order by x.k1, x.k2, x.piece, x.nature rows unbounded preceding) as fin_pos
    from (
      select la.ref, la.piece, la.nature, la.date_livraison, la.d_cdc,
             coalesce(la.date_livraison, la.d_cdc, la.date_piece) as k1, coalesce(la.d_cdc, la.date_piece) as k2, sum(la.q) as q
      from lignes_ag la
      where la.nature in ('CDC', 'CDC_ANNEE_SUIVANTE', 'PL', 'POST_PL', 'POST_BL') and coalesce(la.q, 0) > 0
      group by 1, 2, 3, 4, 5, 6, 7
    ) x
  ),
  file_sup as (
    select c.ref, 0 as ord, (now() at time zone 'Europe/Paris')::date as d,
           coalesce(st.reel, 0) + coalesce((select sum(fd.q) from file_dem fd where fd.ref = c.ref and fd.nature = 'POST_BL'), 0) as q,
           null::text as cdf
    from cibles c left join st on st.ref = c.ref
    union all
    select r.reference_article, 1, r.date_reception_retenue, r.quantite_attendue, r.numero_cdf
    from v_couverture_stock_receptions r join cibles c on c.ref = r.reference_article
  ),
  file_sup_c as (
    select s.*, sum(s.q) over (partition by s.ref order by s.ord, s.d, s.cdf rows unbounded preceding) as cumul from file_sup s
  ),
  file_res as (
    select fd.ref, fd.piece, fd.nature, fd.date_livraison, fd.d_cdc,
           case when f.ord is null then 'RUPTURE' when f.ord = 0 then 'COUVERT'
                when fd.date_livraison is null or f.d <= fd.date_livraison then 'COUVERT_PAR_RECEPTION'
                else 'RECEPTION_TARDIVE' end as statut,
           case when f.ord = 1 then f.cdf end as cdf,
           case when f.ord = 1 then f.d end as date_file,
           case when f.ord = 1 and fd.date_livraison is not null and f.d > fd.date_livraison then f.d - fd.date_livraison else 0 end as retard,
           db.nb as doublees, db.q as doublees_q, db.cdcs as doublees_cdc
    from file_dem fd
    left join lateral (
      select sc.ord, sc.d, sc.cdf from file_sup_c sc
      where sc.ref = fd.ref and sc.q > 0 and sc.cumul >= fd.fin_pos
      order by sc.ord, sc.d, sc.cdf limit 1
    ) f on true
    left join lateral (
      select count(*) as nb, sum(o.q) as q, string_agg(o.piece, ', ' order by o.k1, o.k2) as cdcs
      from file_dem o
      join couv cv2 on cv2.numero_document = o.piece and cv2.reference_article = o.ref
      where coalesce(f.ord, 1) <> 0
        and o.ref = fd.ref and o.nature = 'CDC' and cv2.statut <> 'COUVERT'
        and (o.k1, o.k2, o.piece) < (fd.k1, fd.k2, fd.piece)
    ) db on true
    where fd.nature in ('PL', 'POST_PL', 'POST_BL')
  ),
  -- 26/10/2026 : allocation pas encore commandée (Allocation − CDC Liv − BL/PL depuis le 26/10)$n$;
  a2 text := $a$'couv_statut', cv.statut, 'couv_cdf', cv.cdf, 'couv_date', cv.date_couv, 'couv_retard', cv.retard$a$;
  n2 text := $n$'couv_statut', cv.statut, 'couv_cdf', cv.cdf, 'couv_date', cv.date_couv, 'couv_retard', cv.retard,
                 'file_statut', fr.statut, 'file_cdf', fr.cdf, 'file_date', fr.date_file, 'file_retard', fr.retard,
                 'file_doublees', fr.doublees, 'file_doublees_q', fr.doublees_q, 'file_doublees_cdc', fr.doublees_cdc$n$;
  a3 text := $a$left join couv cv on lb.nature in ('CDC', 'CDC_ANNEE_SUIVANTE') and cv.numero_document = lb.piece and cv.reference_article = lb.ref)$a$;
  n3 text := $n$left join couv cv on lb.nature in ('CDC', 'CDC_ANNEE_SUIVANTE') and cv.numero_document = lb.piece and cv.reference_article = lb.ref
               left join file_res fr on fr.ref = lb.ref and fr.piece = lb.piece and fr.nature = lb.nature
                 and fr.date_livraison is not distinct from lb.date_livraison and fr.d_cdc is not distinct from lb.d_cdc)$n$;
begin
  if position('file_dem as (' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 then
    raise exception 'get_allocation_ro : motif introuvable, patch non appliqué';
  end if;
  d := replace(replace(replace(d, a1, n1), a2, n2), a3, n3);
  execute d;
end $patch$;
