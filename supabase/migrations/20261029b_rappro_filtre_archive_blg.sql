-- ============================================================================
-- 20261029b_rappro_filtre_archive_blg.sql
-- Écran « Rapprochement SAGE ↔ BLG » : filtre « Archivée dans BLG » oui / non / tous
-- ----------------------------------------------------------------------------
-- Les commandes BLG (clients et fournisseurs = blg.sale_quote) archivées ont
-- archive_reason_fk renseigné. L'information est lue en direct (pas de
-- recalcul de rappro_ecarts nécessaire) : elle suit la synchro BLG.
--   * v_rappro_blg_archive : id de la commande BLG → archivée ?, motif. Vue
--     exécutée avec les droits de son propriétaire (blg.sale_quote est sous RLS
--     réservée à blg_sync) ; elle n'expose que ces trois colonnes.
--   * v_rappro_ecarts : + blg_archive (null pour les stocks / sans pièce BLG)
--     et blg_archive_motif, colonnes ajoutées en fin de vue.
--   * get_rappro_synthese(p_archive) : 'oui' = seulement les écarts sur pièces
--     archivées, 'non' = hors pièces archivées, null = tous (comportement
--     inchangé quand l'écran appelle la fonction sans paramètre).
-- ============================================================================

-- ── 1. Archive BLG par commande ─────────────────────────────────────────────
create or replace view public.v_rappro_blg_archive as
select
  q.id,
  (q.archive_reason_fk is not null) as archive,
  coalesce(
    nullif(r.title::jsonb ->> 'fr_FR', ''),
    r.name,
    case when q.archive_reason_fk is not null then 'Motif ' || q.archive_reason_fk::text end
  ) as motif
from blg.sale_quote q
left join blg.system_archive_reason r on r.id = q.archive_reason_fk;

comment on view public.v_rappro_blg_archive is
  'Commande BLG (sale_quote) archivée ou non, avec le motif — utilisé par v_rappro_ecarts (filtre Archive de l''écran Rapprochement SAGE ↔ BLG).';

revoke all on public.v_rappro_blg_archive from anon, public;
grant select on public.v_rappro_blg_archive to authenticated;

-- ── 2. Écarts + archive BLG ─────────────────────────────────────────────────
create or replace view public.v_rappro_ecarts
with (security_invoker = true) as
select
  e.id,
  e.domaine,
  e.type_code,
  e.cle,
  e.document,
  e.document_blg_id,
  e.reference_article,
  e.designation,
  e.depot,
  e.tiers_code,
  e.tiers_nom,
  e.date_document,
  e.age_jours,
  e.qte_sage,
  e.qte_blg,
  e.ecart_qte,
  e.valeur_ht,
  e.statut_sage,
  e.statut_blg,
  e.lien_blg,
  e.probable_decalage,
  e.detail,
  e.calcule_le,
  e.niveau,
  t.libelle as type_libelle,
  t.systeme_a_corriger,
  t.action,
  t.gravite,
  t.nettoyage_masse,
  t.ordre as type_ordre,
  coalesce(s.statut, 'a_traiter'::text) as suivi_statut,
  s.commentaire as suivi_commentaire,
  s.updated_by as suivi_par,
  s.updated_at as suivi_le,
  a.archive as blg_archive,
  a.motif   as blg_archive_motif
from rappro_ecarts e
join rappro_ecart_types t on t.code = e.type_code
left join rappro_ecart_suivi s on s.domaine = e.domaine and s.cle = e.cle
left join public.v_rappro_blg_archive a
       on e.domaine in ('CDC', 'CDF') and a.id = e.document_blg_id;

-- ── 3. Synthèse filtrable ───────────────────────────────────────────────────
drop function if exists public.get_rappro_synthese();

create or replace function public.get_rappro_synthese(p_archive text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select e.*
    from rappro_ecarts e
    left join blg.sale_quote q
           on e.domaine in ('CDC', 'CDF') and q.id = e.document_blg_id
    where p_archive is null
       or (p_archive = 'oui' and q.archive_reason_fk is not null)
       or (p_archive = 'non' and q.archive_reason_fk is null)
  )
  select jsonb_build_object(
    'run', (select to_jsonb(r) from (select id, debut, fin, blg_synchro, sage_synchro, compteurs, erreur from rappro_runs where fin is not null order by id desc limit 1) r),
    'en_cours', exists (select 1 from rappro_runs where fin is null and debut > now() - interval '10 minutes'),
    'archive', p_archive,
    'types', coalesce((select jsonb_agg(x order by x.domaine, x.ordre) from (
        select t.code, t.domaine, t.niveau, t.libelle, t.description, t.systeme_a_corriger, t.action, t.gravite, t.nettoyage_masse, t.ordre,
               count(e.id) filter (where not e.probable_decalage) nb,
               count(e.id) filter (where e.probable_decalage) nb_decalage,
               count(distinct e.document) filter (where not e.probable_decalage) nb_documents,
               coalesce(sum(e.valeur_ht) filter (where not e.probable_decalage), 0) valeur_ht,
               count(e.id) filter (where not e.probable_decalage and coalesce(s.statut,'a_traiter') = 'a_traiter') nb_a_traiter,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'en_cours') nb_en_cours,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'corrige') nb_corrige,
               count(e.id) filter (where not e.probable_decalage and s.statut = 'accepte') nb_accepte,
               count(e.id) filter (where not e.probable_decalage and e.age_jours > 365) nb_plus_1an
        from rappro_ecart_types t
        left join e on e.type_code = t.code
        left join rappro_ecart_suivi s on s.domaine = e.domaine and s.cle = e.cle
        group by t.code) x), '[]'::jsonb),
    'depots', coalesce((select jsonb_agg(x) from (
        select domaine, niveau, coalesce(depot,'(sans dépôt)') depot, count(*) nb, coalesce(sum(valeur_ht),0) valeur_ht
        from e where not probable_decalage group by 1,2,3) x), '[]'::jsonb),
    'historique', coalesce((select jsonb_agg(x order by x.jour) from (
        select h.jour, h.domaine, sum(h.nb) nb, sum(h.valeur_ht) valeur_ht from rappro_historique h
        join rappro_ecart_types t on t.code = h.type_code and t.niveau = 'LIGNE' and t.systeme_a_corriger <> 'AUCUN'
        where h.jour >= current_date - 90 group by 1,2) x), '[]'::jsonb)
  )
$$;

revoke all on function public.get_rappro_synthese(text) from public, anon;
grant execute on function public.get_rappro_synthese(text) to authenticated, service_role;
