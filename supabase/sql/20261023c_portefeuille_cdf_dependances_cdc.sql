-- ============================================================================
-- 20261023c_portefeuille_cdf_dependances_cdc.sql
-- ----------------------------------------------------------------------------
-- Correction (remontée par Arnaud le 23/10/2026) : la colonne « CDC » de l'écran
-- Portefeuille commandes fournisseurs comptait les commandes clients dont la
-- PROCHAINE réception après leur date était la CDF (v_portefeuille_couverture_stock
-- .prochaine_reception_cdf) — ex. les CONT 03 du 31/03/2027 affichaient 347 CDC de
-- novembre, couvertes en réalité par les containers de novembre. Faux et anxiogène.
--
-- Nouvelle règle : une CDC dépend d'une CDF quand
--   - la CDC n'est pas couverte par le stock seul (stock projeté hors réceptions < 0),
--   - la CDF arrive au plus tard à la date où la CDC doit être servie (date de
--     livraison ; date de couverture estimée pour une CDC en réception tardive),
--   - et, réceptions de la référence servies dans l'ordre des dates (FIFO), les
--     réceptions précédant cette CDF ne suffisent pas à combler le manque de la CDC.
-- ============================================================================

create or replace function public.appro_cdf_cdc_dependances()
returns table (
  numero_cdf text, numero_document text, nom_tiers text, numero_tiers text,
  representant text, agence text, reference_article text, quantite numeric,
  date_livraison date, statut_couverture text, retard_estime_jours integer
)
language sql
stable
security definer
set search_path = public, sage
as $$
  with cdc as (
    select v.*
    from v_portefeuille_couverture_stock v
    where v.statut_couverture in ('COUVERT_PAR_RECEPTION', 'RECEPTION_TARDIVE')
      and v.stock_projete_hors_receptions < 0
  ),
  rec as (
    select r.numero_cdf, r.reference_article, r.date_reception_retenue,
           coalesce(sum(r.quantite_attendue) over (
             partition by r.reference_article
             order by r.date_reception_retenue, r.numero_cdf, r.ligne_cdf_id
             rows between unbounded preceding and 1 preceding), 0) as cumul_avant
    from v_couverture_stock_receptions r
  )
  select distinct on (r.numero_cdf, c.id)
         r.numero_cdf::text, c.numero_document::text, c.nom_tiers::text, c.numero_tiers::text,
         c.representant::text, c.agence::text, c.reference_article::text, c.quantite::numeric,
         c.date_livraison::date, c.statut_couverture::text, c.retard_estime_jours::integer
  from cdc c
  join rec r on r.reference_article = c.reference_article
            and r.date_reception_retenue <= coalesce(case when c.statut_couverture = 'RECEPTION_TARDIVE' then c.date_couverture_estimee end, c.date_livraison)
            and r.cumul_avant < -c.stock_projete_hors_receptions
$$;
revoke all on function public.appro_cdf_cdc_dependances() from public, anon;
grant execute on function public.appro_cdf_cdc_dependances() to authenticated;

-- ─── 7. Liste du portefeuille ───────────────────────────────────────────────
create or replace function public.get_appro_portefeuille_cdf()
returns jsonb
language plpgsql
security definer
set search_path = public, sage
set statement_timeout = '60s'
as $$
declare
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  p_cont_jours   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_alerte_jours_avant'), 70);
  p_releve_max   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_releve_max_jours'), 7);
  p_m_intenable  integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_intenable'), 2);
  p_m_tres_juste integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_tres_juste'), 4);
  p_m_juste      integer := coalesce((select valeur from appro_parametres where cle = 'cdf_cont_marge_juste'), 7);
  p_sans_ar      integer := coalesce((select valeur from appro_parametres where cle = 'cdf_sans_ar_jours'), 7);
  p_cdc_horizon  integer := coalesce((select valeur from appro_parametres where cle = 'cdf_relance_cdc_horizon_jours'), 21);
  p_conf_valid   integer := coalesce((select valeur from appro_parametres where cle = 'cdf_confirmation_validite_jours'), 14);
  v_statut_dispo boolean := exists (select 1 from sage.cdf_statut) and exists (select 1 from appro_cdf_statuts);
  v_comm_dispo   boolean := exists (select 1 from sage.bdcf_commentaires);
  v_rows jsonb;
begin
  with cdf as (
    select b.al_docnum as numero,
           max(b.al_ctnum) as fournisseur_code,
           max(b.al_doref) as reference,
           max(nullif(btrim(b.al_deno), '')) as depot,
           min(sage_date_text_to_date(b.al_dldatebc)) as date_commande,
           min(sage_date_text_to_date(b.al_dodatelivr)) as date_livraison,
           count(*) as nb_lignes,
           sum(coalesce(b.qtevendues, 0)) as qte,
           sum(coalesce(b.cahtnet, 0)) as montant_ht,
           max(b.loaded_at) as loaded_at
    from sage.bdcf b
    where b.al_doctype = '12'
    group by b.al_docnum
  ),
  comm as (
    select c.do_piece,
           array_agg(c.dl_design order by c.dl_ligne) filter (where nullif(btrim(c.dl_design), '') is not null) as lignes,
           (select coalesce(array_agg(distinct x), '{}') from unnest(array_agg(c.dl_design)) d, unnest(appro_containers_dans_texte(d)) x) as candidats
    from sage.bdcf_commentaires c
    group by c.do_piece
  ),
  rel as (
    select distinct on (r.cdf_numero) r.*
    from appro_container_releves r
    order by r.cdf_numero, r.created_at desc, r.id desc
  ),
  rel_n as (select cdf_numero, count(*) as nb from appro_container_releves group by 1),
  dep as (
    select d.numero_cdf as numero,
           count(distinct d.numero_document) as nb_cdc,
           min(d.date_livraison) as premiere_livraison_cdc,
           sum(d.quantite) as qte_cdc,
           count(distinct d.numero_document) filter (where d.statut_couverture = 'RECEPTION_TARDIVE') as nb_cdc_tardives
    from appro_cdf_cdc_dependances() d
    group by 1
  ),
  base as (
    select c.*,
           t.ti_intitule as fournisseur_nom,
           (c.reference ilike 'CONT%') as est_cont,
           (upper(coalesce(c.depot, '')) = 'FMS') as est_fms,
           (v_auj - c.date_commande) as age_jours,
           (c.date_livraison - v_auj) as jours_avant_livraison,
           s.do_statut as statut_code,
           st.libelle as statut_libelle,
           st.ar_recu,
           coalesce(cm.lignes, '{}') as commentaires,
           (select x from unnest(coalesce(cm.candidats, '{}')) x where appro_container_valide(x) limit 1) as container_sage,
           (select coalesce(array_agg(x), '{}') from unnest(coalesce(cm.candidats, '{}')) x where not appro_container_valide(x)) as containers_invalides,
           (select count(*) from unnest(coalesce(cm.candidats, '{}')) x where appro_container_valide(x)) as nb_containers_sage,
           r.container_numero as container_saisi, r.armateur, r.navire, r.port_arrivee, r.eta_port,
           r.statut as statut_suivi, r.commentaire as commentaire_suivi, r.created_at as releve_le, r.created_by as releve_par,
           coalesce(rn.nb, 0) as nb_releves,
           coalesce(d.nb_cdc, 0) as nb_cdc, d.premiere_livraison_cdc, d.qte_cdc, coalesce(d.nb_cdc_tardives, 0) as nb_cdc_tardives
    from cdf c
    left join sage.tiers t on t.ti_num = c.fournisseur_code
    left join sage.cdf_statut s on s.do_piece = c.numero
    left join appro_cdf_statuts st on st.code = s.do_statut
    left join comm cm on cm.do_piece = c.numero
    left join rel r on r.cdf_numero = c.numero
    left join rel_n rn on rn.cdf_numero = c.numero
    left join dep d on d.numero = c.numero
  ),
  calc as (
    select b.*,
           coalesce(b.container_sage, appro_container_normaliser(b.container_saisi)) as container,
           case when b.container_sage is not null then 'sage' when b.container_saisi is not null then 'saisie' end as container_source,
           (b.container_sage is not null and b.container_saisi is not null
              and b.container_sage <> appro_container_normaliser(b.container_saisi)) as container_ecart,
           (b.date_livraison - b.eta_port) as marge_jours
    from base b
  ),
  calc2 as (
    select c.*,
           appro_container_valide(c.container) as container_valide,
           (select a.code from appro_armateurs a where left(c.container, 4) = any(a.prefixes) limit 1) as armateur_suggere,
           case
             when c.eta_port is null or c.date_livraison is null then null
             when c.marge_jours < 0 then 'RETARD'
             when c.marge_jours <= p_m_intenable then 'INTENABLE'
             when c.marge_jours <= p_m_tres_juste then 'TRES_JUSTE'
             when c.marge_jours <= p_m_juste then 'JUSTE'
             else 'OK'
           end as verdict,
           (c.est_cont and c.date_livraison is not null and c.jours_avant_livraison <= p_cont_jours
              and coalesce(c.statut_suivi, '') <> 'livre') as cont_fenetre
    from calc c
  ),
  alertes as (
    select c.numero,
           array_remove(array[
             case when c.cont_fenetre and not coalesce(c.container_valide, false) and c.container is null then 'CONT_SANS_CONTAINER' end,
             case when c.est_cont and c.container is not null and not c.container_valide then 'CONT_CONTAINER_INVALIDE' end,
             case when c.est_cont and (cardinality(c.containers_invalides) > 0 and c.container_sage is null) and c.container is null then 'CONT_CONTAINER_INVALIDE' end,
             case when c.est_cont and c.container_ecart then 'CONT_CONTAINER_ECART' end,
             case when c.est_cont and c.nb_containers_sage > 1 then 'CONT_PLUSIEURS_CONTAINERS' end,
             case when c.cont_fenetre and c.container_valide and c.eta_port is null then 'CONT_SANS_SUIVI' end,
             case when c.cont_fenetre and c.eta_port is not null
                       and coalesce(c.statut_suivi, '') not in ('arrive', 'decharge', 'livre')
                       and c.releve_le < now() - make_interval(days => p_releve_max) then 'CONT_SUIVI_ANCIEN' end,
             case when c.verdict in ('RETARD', 'INTENABLE', 'TRES_JUSTE') then 'CONT_MARGE' end,
             case when v_statut_dispo and c.est_fms and c.statut_code is not null and not coalesce(c.ar_recu, false)
                       and c.age_jours >= p_sans_ar then 'SANS_AR' end,
             case when c.nb_cdc > 0 and c.date_livraison is not null and c.jours_avant_livraison between 0 and p_cdc_horizon then 'CDC_A_CONFIRMER' end,
             case when c.date_livraison is not null and c.date_livraison < v_auj then 'DATE_DEPASSEE' end,
             case when c.date_livraison is null then 'SANS_DATE' end
           ], null) as codes
    from calc2 c
  ),
  confirmations as (
    select distinct a.cdf_numero, a.alerte_code
    from appro_cdf_actions a
    join calc2 c on c.numero = a.cdf_numero
    where a.action = 'confirme'
      and a.created_at >= now() - make_interval(days => p_conf_valid)
      and a.date_livraison_ref is not distinct from c.date_livraison
  ),
  derniere_action as (
    select distinct on (a.cdf_numero) a.cdf_numero, a.action, a.alerte_code, a.commentaire, a.created_at, a.created_by
    from appro_cdf_actions a
    order by a.cdf_numero, a.created_at desc, a.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'numero', c.numero,
           'fournisseur_code', c.fournisseur_code,
           'fournisseur_nom', c.fournisseur_nom,
           'reference', c.reference,
           'depot', c.depot,
           'est_fms', c.est_fms,
           'est_cont', c.est_cont,
           'date_commande', c.date_commande,
           'date_livraison', c.date_livraison,
           'age_jours', c.age_jours,
           'jours_avant_livraison', c.jours_avant_livraison,
           'nb_lignes', c.nb_lignes,
           'qte', c.qte,
           'montant_ht', round(c.montant_ht::numeric, 2),
           'statut_code', c.statut_code,
           'statut_libelle', c.statut_libelle,
           'ar_recu', c.ar_recu,
           'commentaires', to_jsonb(c.commentaires),
           'container', c.container,
           'container_source', c.container_source,
           'container_valide', c.container_valide,
           'container_saisi', c.container_saisi,
           'containers_invalides', to_jsonb(c.containers_invalides),
           'armateur', c.armateur,
           'armateur_suggere', c.armateur_suggere,
           'navire', c.navire,
           'port_arrivee', c.port_arrivee,
           'eta_port', c.eta_port,
           'statut_suivi', c.statut_suivi,
           'commentaire_suivi', c.commentaire_suivi,
           'releve_le', c.releve_le,
           'releve_par', c.releve_par,
           'nb_releves', c.nb_releves,
           'marge_jours', c.marge_jours,
           'verdict', c.verdict,
           'nb_cdc', c.nb_cdc,
           'nb_cdc_tardives', c.nb_cdc_tardives,
           'qte_cdc', c.qte_cdc,
           'premiere_livraison_cdc', c.premiere_livraison_cdc,
           'alertes', to_jsonb(coalesce((select array_agg(x) from unnest(al.codes) x
                                         where not exists (select 1 from confirmations f where f.cdf_numero = c.numero and f.alerte_code = x)), '{}')),
           'alertes_confirmees', to_jsonb(coalesce((select array_agg(x) from unnest(al.codes) x
                                         where exists (select 1 from confirmations f where f.cdf_numero = c.numero and f.alerte_code = x)), '{}')),
           'derniere_action', case when da.cdf_numero is null then null else jsonb_build_object(
               'action', da.action, 'alerte_code', da.alerte_code, 'commentaire', da.commentaire,
               'le', da.created_at, 'par', da.created_by) end
         ) order by c.date_livraison nulls first, c.numero), '[]'::jsonb)
  into v_rows
  from calc2 c
  join alertes al on al.numero = c.numero
  left join derniere_action da on da.cdf_numero = c.numero;

  return jsonb_build_object(
    'genere_le', now(),
    'import_sage_le', (select max(loaded_at) from sage.bdcf),
    'sources', jsonb_build_object('statut_ar', v_statut_dispo, 'commentaires', v_comm_dispo),
    'parametres', jsonb_build_object(
      'cont_alerte_jours_avant', p_cont_jours, 'cont_releve_max_jours', p_releve_max,
      'marge_intenable', p_m_intenable, 'marge_tres_juste', p_m_tres_juste, 'marge_juste', p_m_juste,
      'sans_ar_jours', p_sans_ar, 'relance_cdc_horizon_jours', p_cdc_horizon, 'confirmation_validite_jours', p_conf_valid),
    'armateurs', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'nom', nom, 'url_suivi', url_suivi) order by ordre), '[]') from appro_armateurs),
    'rows', v_rows
  );
end $$;

revoke all on function public.get_appro_portefeuille_cdf() from public, anon;
grant execute on function public.get_appro_portefeuille_cdf() to authenticated;

-- ─── 8. Détail d'une CDF (lignes, CDC en attente, historique) ───────────────
create or replace function public.get_appro_cdf_detail(p_numero text)
returns jsonb
language plpgsql
security definer
set search_path = public, sage
set statement_timeout = '60s'
as $$
begin
  return jsonb_build_object(
    'lignes', (select coalesce(jsonb_agg(jsonb_build_object(
                 'ligne', b.al_dlno, 'reference_article', b.al_art_num, 'designation', b.al_dldesign,
                 'quantite', b.qtevendues, 'montant_ht', b.cahtnet,
                 'date_livraison', sage_date_text_to_date(b.al_dodatelivr)) order by b.al_dlno), '[]')
               from sage.bdcf b where b.al_doctype = '12' and b.al_docnum = p_numero),
    'commentaires', (select coalesce(jsonb_agg(c.dl_design order by c.dl_ligne), '[]')
               from sage.bdcf_commentaires c where c.do_piece = p_numero and nullif(btrim(c.dl_design), '') is not null),
    'cdc', (select coalesce(jsonb_agg(jsonb_build_object(
                 'numero_document', d.numero_document, 'nom_tiers', d.nom_tiers, 'numero_tiers', d.numero_tiers,
                 'representant', d.representant, 'agence', d.agence,
                 'reference_article', d.reference_article, 'quantite', d.quantite,
                 'date_livraison', d.date_livraison, 'statut_couverture', d.statut_couverture,
                 'retard_estime_jours', d.retard_estime_jours) order by d.date_livraison, d.numero_document), '[]')
            from appro_cdf_cdc_dependances() d
            where d.numero_cdf = p_numero),
    'releves', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]')
                from appro_container_releves r where r.cdf_numero = p_numero),
    'actions', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]')
                from appro_cdf_actions a where a.cdf_numero = p_numero)
  );
end $$;

revoke all on function public.get_appro_cdf_detail(text) from public, anon;
grant execute on function public.get_appro_cdf_detail(text) to authenticated;
