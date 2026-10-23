-- ============================================================================
-- 20261023b_portefeuille_cdf_import_par_lot.sql
-- ----------------------------------------------------------------------------
-- Branche les deux nouveaux exports SAGE de l'écran « Portefeuille commandes
-- fournisseurs » sur la publication atomique par lot (20261020f) :
--   CDF_statut.csv        -> sage.stg_cdf_statut        -> sage.cdf_statut
--   BDCF_commentaires.csv -> sage.stg_bdcf_commentaires -> sage.bdcf_commentaires
--
-- À appliquer AVANT de déployer la nouvelle version de
-- import-sage-from-storage.ts (sinon soumettre_lot refuse ces tables).
--
-- Les deux tables ne font PAS partie du groupe obligatoire stock / CDF /
-- portefeuille : si l'un des fichiers manque ou est vide, la table garde
-- simplement sa version précédente, sans bloquer le lot.
-- ============================================================================

-- bdcf_commentaires : le contrôle de publication vérifie chaque colonne de la
-- clé primaire séparément (unicité par colonne) -> une clé composite
-- (do_piece, dl_ligne) ferait rejeter tous les lots. Clé technique id à la
-- place (ignorée par le contrôle, comme pour stock_depot), simple index sur
-- (do_piece, dl_ligne) : jamais d'échec de publication sur un doublon SAGE.
alter table sage.bdcf_commentaires drop constraint if exists bdcf_commentaires_pkey;
alter table sage.bdcf_commentaires add column if not exists id bigserial;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'sage.bdcf_commentaires'::regclass and contype = 'p') then
    alter table sage.bdcf_commentaires add primary key (id);
  end if;
end $$;
create index if not exists idx_bdcf_commentaires_piece on sage.bdcf_commentaires (do_piece, dl_ligne);

-- Tables de staging (même structure et mêmes valeurs par défaut que la production)
create table if not exists sage.stg_cdf_statut        (like sage.cdf_statut        including defaults);
create table if not exists sage.stg_bdcf_commentaires (like sage.bdcf_commentaires including defaults);
alter table sage.stg_cdf_statut        enable row level security;
alter table sage.stg_bdcf_commentaires enable row level security;
grant all on sage.stg_cdf_statut, sage.stg_bdcf_commentaires to service_role;
grant usage, select on sequence sage.bdcf_commentaires_id_seq to service_role;

-- Liste des tables gérées par la publication par lot
create or replace function sage.import_tables_stagees()
 returns text[]
 language sql
 immutable
as $function$
  select array[
    'tiers','adresse_livraison','articles','bdcf','contact',
    'entete_activite_non_fac','activite_non_facturee','fia','stock_depot',
    'stock','tiers_complet','nomenclature','article_bis','article_fournisseur',
    -- AJOUT 2026-10-23 : portefeuille commandes fournisseurs
    'cdf_statut','bdcf_commentaires'
  ]::text[];
$function$;

notify pgrst, 'reload schema';
