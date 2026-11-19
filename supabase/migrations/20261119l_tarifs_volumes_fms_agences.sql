-- =============================================================================
-- 20261119l_tarifs_volumes_fms_agences.sql — Tarifs fournisseurs (19/11/2026, 10h30)
-- -----------------------------------------------------------------------------
-- get_tarifs_fournisseur :
--  - volumes 12 mois séparés FMS / agences : ventes facturées du dépôt FMS
--    (facture_lignes.depot = 'FMS'), achats reçus livrés à FMS
--    (v_appro_cdf_entete.lieu_livraison_nom = 'FMS') ; agences = total − FMS
--    (ventes sans dépôt comptées en agences) ;
--  - une proposition est lue avec son propre fournisseur.
-- =============================================================================

create or replace function public.get_tarifs_fournisseur(p_fournisseur text, p_proposition bigint default null)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set statement_timeout to '90s'
as $$
declare
  v_frs text := upper(trim(p_fournisseur));
  v_articles jsonb;
  v_lignes jsonb;
  v_props jsonb;
  v_prop jsonb;
  v_refs text[];
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  -- Une proposition est toujours lue avec SON fournisseur (évite des prix SAGE vides si l'URL est restée sur un autre)
  if p_proposition is not null then
    select coalesce(upper(trim(fournisseur)), v_frs) into v_frs from public.tarif_propositions where id = p_proposition;
  end if;

  -- Articles concernés : ceux du fournisseur dans SAGE + ceux appariés manuellement dans la proposition
  select array_agg(distinct r) into v_refs from (
    select upper(trim(ar_ref)) as r from sage.article_fournisseur where upper(trim(ct_num)) = v_frs
    union
    select reference_article from public.tarif_proposition_lignes
     where p_proposition is not null and proposition_id = p_proposition and reference_article is not null
  ) z;

  with refs as (select unnest(coalesce(v_refs, array[]::text[])) as ref),
  ventes as (
    select upper(trim(fl.reference_article)) as ref,
           sum(case when coalesce(fl.montant_ht, 0) < 0 then -abs(coalesce(fl.quantite, 0)) else abs(coalesce(fl.quantite, 0)) end) as qte,
           sum(coalesce(fl.montant_ht, 0)) as ca,
           sum(coalesce(fl.marge_valeur, 0)) as marge,
           count(distinct fl.numero_tiers_entete) as nb_clients,
           sum(case when upper(coalesce(fl.depot, '')) <> 'FMS' then 0
                    when coalesce(fl.montant_ht, 0) < 0 then -abs(coalesce(fl.quantite, 0)) else abs(coalesce(fl.quantite, 0)) end) as qte_fms
    from public.facture_lignes fl
    where fl.date_facture >= (current_date - interval '12 months')::date
      and upper(trim(fl.reference_article)) = any (v_refs)
    group by 1
  ),
  achats as (
    select upper(trim(c.article_reference)) as ref,
           sum(coalesce(c.quantite_livree, 0))::numeric as qte,
           count(*) filter (where coalesce(c.quantite_livree, 0) > 0) as nb_lignes,
           sum(coalesce(c.quantite_livree, 0)) filter (where upper(coalesce(e.lieu_livraison_nom, '')) = 'FMS')::numeric as qte_fms,
           count(*) filter (where coalesce(c.quantite_livree, 0) > 0 and upper(coalesce(e.lieu_livraison_nom, '')) = 'FMS') as nb_lignes_fms,
           sum(coalesce(c.quantite_livree, 0) * coalesce(c.prix_unitaire, 0) * (1 - coalesce(c.remise_pourcent, 0) / 100.0))::numeric as valeur
    from public.v_appro_cdf_lignes c
    left join public.v_appro_cdf_entete e on e.id = c.cdf_id
    where upper(c.code_fournisseur) = 'F' || v_frs
      and c.date_livraison >= now() - interval '12 months'
    group by 1
  ),
  afs as (
    select distinct on (upper(trim(f.ar_ref))) upper(trim(f.ar_ref)) as ref, f.*
    from sage.article_fournisseur f
    where upper(trim(f.ct_num)) = v_frs
    order by upper(trim(f.ar_ref)), f.af_principal desc
  ),
  paliers as (
    select reference_article as ref,
           jsonb_agg(jsonb_build_object('de', borne_precedente, 'a', borne_sup, 'prix', prix_net) order by palier) as paliers
    from public.v_appro_tarif_qte_fournisseur
    where fournisseur = v_frs
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'reference', r.ref,
      'designation', coalesce(b.ar_design, a.art_lib),
      'famille', a.art_facodefamille,
      'marque', b.marque,
      'sommeil', coalesce(a.art_sommeil, '') = 'En sommeil',
      'du_fournisseur', f.ar_ref is not null,
      'principal', f.af_principal = '1',
      'fournisseur_principal', a.art_fourprinc,
      'ref_fournisseur', f.af_reffourniss,
      'ean', coalesce(nullif(f.af_codebarre, ''), nullif(b.ar_codebarre, '')),
      'prix_tarif', f.af_prixach,
      'remise', nullif(f.af_remise, 0),
      'prix_net', round(f.af_prixach * (1 - coalesce(f.af_remise, 0) / 100.0), 4),
      'prix_nouveau_sage', nullif(f.af_prixachnouv, 0),
      'date_application_sage', case when coalesce(f.af_prixachnouv, 0) > 0 then public.sage_date_cb(f.af_dateapplication) end,
      'colisage', nullif(f.af_colisage, 0),
      'qte_mini', nullif(f.af_qtemini, 0),
      'prix_achat_fiche', b.ar_prixach,
      'dernier_prix_achat', nullif(a.art_derprixach, 0),
      'coef', nullif(b.ar_coef, 0),
      'prix_vente', nullif(b.ar_prixven, 0),
      'paliers', pa.paliers,
      'qte_ventes_12m', coalesce(v.qte, 0),
      'ca_ventes_12m', round(coalesce(v.ca, 0), 2),
      'marge_ventes_12m', round(coalesce(v.marge, 0), 2),
      'nb_clients_12m', coalesce(v.nb_clients, 0),
      'qte_achats_12m', coalesce(ac.qte, 0),
      'nb_lignes_cdf_12m', coalesce(ac.nb_lignes, 0),
      'valeur_achats_12m', round(coalesce(ac.valeur, 0), 2),
      'qte_ventes_12m_fms', coalesce(v.qte_fms, 0),
      'qte_achats_12m_fms', coalesce(ac.qte_fms, 0),
      'nb_lignes_cdf_12m_fms', coalesce(ac.nb_lignes_fms, 0),
      'qte_moy_ligne_cdf', case when coalesce(ac.nb_lignes, 0) > 0 then round(ac.qte / ac.nb_lignes, 1) end
    ) order by r.ref), '[]'::jsonb)
  into v_articles
  from refs r
  left join sage.articles a on a.art_num = r.ref
  left join sage.article_bis b on b.ar_ref = r.ref
  left join afs f on f.ref = r.ref
  left join ventes v on v.ref = r.ref
  left join achats ac on ac.ref = r.ref
  left join paliers pa on pa.ref = r.ref;

  select coalesce(jsonb_agg(to_jsonb(p) - 'mapping' - 'conditions' order by p.cree_le desc), '[]'::jsonb)
    into v_props
  from public.tarif_propositions p
  where p.fournisseur = v_frs;

  if p_proposition is not null then
    select to_jsonb(p) into v_prop from public.tarif_propositions p where p.id = p_proposition;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'ligne_no', l.ligne_no, 'ref_fournisseur', l.ref_fournisseur, 'ean', l.ean,
        'designation', l.designation, 'marque', l.marque, 'gamme', l.gamme, 'unite', l.unite,
        'prix_public', l.prix_public, 'colisage', l.colisage, 'qte_palette', l.qte_palette,
        'paliers', l.paliers, 'prix_base', l.prix_base,
        'reference_article', l.reference_article, 'appariement', l.appariement,
        'nb_candidats', l.nb_candidats, 'appariement_manuel', l.appariement_manuel,
        'ignoree', l.ignoree, 'commentaire', l.commentaire,
        'conversion', l.conversion, 'conversion_auto', l.conversion_auto
      ) order by l.ligne_no, l.id), '[]'::jsonb)
      into v_lignes
    from public.tarif_proposition_lignes l
    where l.proposition_id = p_proposition;
  end if;

  return jsonb_build_object(
    'fournisseur', v_frs,
    'nom', (select ct_intitule from sage.tiers_complet where upper(trim(ct_num)) = v_frs limit 1),
    'genere_le', now(),
    'periode_volumes', jsonb_build_object('du', (current_date - interval '12 months')::date, 'au', current_date),
    'articles', coalesce(v_articles, '[]'::jsonb),
    'propositions', coalesce(v_props, '[]'::jsonb),
    'proposition', v_prop,
    'lignes', coalesce(v_lignes, '[]'::jsonb)
  );
end;
$$;


