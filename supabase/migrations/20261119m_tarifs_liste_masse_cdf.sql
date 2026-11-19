-- =============================================================================
-- 20261119m_tarifs_liste_masse_cdf.sql — Tarifs fournisseurs : masse d'achat réelle (19/11/2026, 11h)
-- -----------------------------------------------------------------------------
-- Constat d'Arnaud sur la liste des fournisseurs : « valeurs folles » (AIRZONE 4,14 M€,
-- ASPEN 2,00 M€, APPLIMO −200 k€). Cause : la masse était estimée par
-- quantités vendues 12 mois × prix net SAGE sur TOUS les articles rattachés au
-- fournisseur, y compris les articles techniques partagés (DIVERS 131,76 € ×
-- 11 642 ventes = 1,53 M€ chez Aspen), les fournisseurs secondaires et les
-- articles de régularisation à prix négatif (REGULTARIF −442 €).
--
-- Désormais la masse d'achat est le montant HT des commandes fournisseurs BLG
-- passées sur 12 mois glissants (v_appro_cdf_entete.order_date, montant_ht,
-- fournisseur BLG = 'f' + n° SAGE), réparti par flux de destination :
-- FMS (lieu de livraison « FMS ») / agences (tous les autres lieux).
-- Contrôle Aspen : 377 k€ commandés dont 279 k€ livrés à FMS (factures BLG 12 mois : 422 k€).
-- L'estimation ventes × prix est conservée (masse_estimee_12m) mais limitée aux
-- articles actifs dont le fournisseur est principal, avec réf. fournisseur et prix > 0.
-- =============================================================================

create or replace function public.get_tarifs_fournisseurs_liste()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v jsonb;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;

  with ventes as (
    select upper(trim(reference_article)) as ref,
           sum(case when coalesce(montant_ht, 0) < 0 then -abs(coalesce(quantite, 0)) else abs(coalesce(quantite, 0)) end) as qte
    from public.facture_lignes
    where date_facture >= (current_date - interval '12 months')::date
      and reference_article is not null
    group by 1
  ),
  af as (
    select upper(trim(f.ct_num)) as ct_num,
           count(*) as nb_articles,
           count(*) filter (where coalesce(a.art_sommeil, '') <> 'En sommeil') as nb_actifs,
           count(*) filter (where f.af_principal = '1') as nb_principal,
           sum(greatest(coalesce(v.qte, 0), 0) * (f.af_prixach * (1 - coalesce(f.af_remise, 0) / 100.0)))
             filter (where f.af_principal = '1'
                       and coalesce(a.art_sommeil, '') <> 'En sommeil'
                       and coalesce(trim(f.af_reffourniss), '') <> ''
                       and coalesce(f.af_prixach, 0) > 0) as masse_estimee_12m
    from sage.article_fournisseur f
    left join sage.articles a on a.art_num = f.ar_ref
    left join ventes v on v.ref = upper(trim(f.ar_ref))
    where coalesce(f.ct_num, '') <> ''
    group by 1
  ),
  cdf as (
    select upper(substr(e.code_fournisseur, 2)) as ct_num,
           count(*) as nb_cdf,
           sum(coalesce(e.montant_ht, 0))::numeric as masse,
           sum(coalesce(e.montant_ht, 0)) filter (where upper(coalesce(e.lieu_livraison_nom, '')) = 'FMS')::numeric as masse_fms
    from public.v_appro_cdf_entete e
    where e.order_date >= (current_date - interval '12 months')::date
      and lower(left(coalesce(e.code_fournisseur, ''), 1)) = 'f'
    group by 1
  ),
  props as (
    select fournisseur, count(*) as nb_propositions, max(cree_le) as derniere_proposition
    from public.tarif_propositions group by 1
  ),
  paliers as (
    select upper(trim(tq_refcf)) as ct_num, count(distinct ar_ref) as nb_articles_paliers
    from sage.tarif_f_qte group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'fournisseur', af.ct_num,
           'nom', t.ct_intitule,
           'sommeil', t.ct_sommeil,
           'nb_articles', af.nb_articles,
           'nb_actifs', af.nb_actifs,
           'nb_principal', af.nb_principal,
           'nb_articles_paliers', coalesce(pa.nb_articles_paliers, 0),
           'masse_achat_12m', round(coalesce(c.masse, 0), 2),
           'masse_fms_12m', round(coalesce(c.masse_fms, 0), 2),
           'masse_agences_12m', round(coalesce(c.masse, 0) - coalesce(c.masse_fms, 0), 2),
           'nb_cdf_12m', coalesce(c.nb_cdf, 0),
           'masse_estimee_12m', round(coalesce(af.masse_estimee_12m, 0), 2),
           'nb_propositions', coalesce(pr.nb_propositions, 0),
           'derniere_proposition', pr.derniere_proposition
         ) order by t.ct_intitule), '[]'::jsonb)
    into v
  from af
  left join sage.tiers_complet t on upper(trim(t.ct_num)) = af.ct_num
  left join cdf c on c.ct_num = af.ct_num
  left join props pr on pr.fournisseur = af.ct_num
  left join paliers pa on pa.ct_num = af.ct_num;

  return v;
end;
$$;
