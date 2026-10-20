-- ============================================================================
-- 20/10/2026 — Alerte « Cde non complète à la date liv client » à 0 après
-- chaque synchro SAGE.
-- Cause : la synchro recharge activite_lignes avec de nouveaux identifiants.
-- Le cache alerte_couverture_stock_cache (recalculé toutes les 10 min) garde
-- les anciens id jusqu'au recalcul suivant ; or sa règle de visibilité
-- comparait l'id de ligne → plus aucune ligne visible (compteur « OK 0 »)
-- pendant jusqu'à 10 minutes après chaque synchro.
-- Correctif : visibilité par n° de document (stable d'une synchro à
-- l'autre), avec le même périmètre utilisateur (droits d'activite_lignes).
-- À exécuter en entier dans l'éditeur SQL Supabase (instantané).
-- ============================================================================

drop policy if exists alerte_couverture_stock_cache_select_scoped on public.alerte_couverture_stock_cache;
create policy alerte_couverture_stock_cache_select_scoped
  on public.alerte_couverture_stock_cache
  for select to authenticated
  using (exists (
    select 1 from public.activite_lignes a
    where a.numero_piece = alerte_couverture_stock_cache.numero_document
  ));

create index if not exists idx_alerte_couverture_stock_cache_doc
  on public.alerte_couverture_stock_cache (numero_document);

-- Contrôle (vue administrateur, sans filtre de périmètre)
select count(*) lignes, count(distinct numero_document) cdc
from public.alerte_couverture_stock_cache
where statut_couverture in ('RUPTURE', 'RECEPTION_TARDIVE')
  and date_livraison <= (current_date + interval '2 months')::date;
