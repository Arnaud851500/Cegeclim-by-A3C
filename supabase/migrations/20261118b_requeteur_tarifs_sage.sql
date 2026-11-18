-- ============================================================================
-- 20261118b_requeteur_tarifs_sage.sql
-- Requêteur métier : source « Tarifs articles SAGE » (demandée par Arnaud le
-- 18/11/2026, pendant de « Tarifs articles BLG » pour contrôler HITACHI).
--
-- Une ligne par article × fournisseur (fiche « Fournisseurs » de l'article SAGE,
-- F_ARTFOURNISS) avec :
--   - le prix tarif fournisseur (AF_PrixAch), la remise (AF_Remise), le prix net
--     calculé (tarif × (1 − remise)), les nouveaux prix / remise et leur date
--     d'application, la référence fournisseur, fournisseur principal oui / non ;
--   - les prix de la fiche article : prix d'achat, dernier prix d'achat,
--     coefficient, prix de vente HT / TTC, nouveaux prix et date d'application ;
--   - les dates de dernière modification (fiche article, ligne fournisseur).
-- Les articles sans ligne fournisseur sortent aussi (colonnes fournisseur vides).
--
-- Le schéma sage n'est pas lisible par les utilisateurs (RLS) : la vue s'exécute
-- avec les droits de son propriétaire et ne renvoie des lignes qu'aux
-- utilisateurs autorisés au Requêteur (requeteur_autorise()). Les listes de
-- choix lisent la vue elle-même (requeteur_valeurs est en security invoker).
-- ============================================================================

create or replace function public.sage_date_cb(p text)
returns timestamptz language sql stable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~ '^\d{2}/\d{2}/\d{4}' and right(substr(p, 7, 4), 4)::int >= 1900
      then to_timestamp(left(p, 19), 'DD/MM/YYYY HH24:MI:SS')
    else null end
$$;

create or replace view public.v_req_tarifs_articles_sage as
select
  a.art_num                                    as reference_article,
  coalesce(b.ar_design, a.art_lib)             as designation,
  a.art_facodefamille                          as famille,
  b.marque,
  a.art_fourprinc                              as code_fournisseur_principal,
  tp.ct_intitule                               as fournisseur_principal,
  a.art_sommeil                                as statut_article,
  f.ct_num                                     as code_fournisseur,
  tf.ct_intitule                               as fournisseur,
  case when f.ct_num is null then null when f.af_principal = '1' then 'Oui' else 'Non' end as fournisseur_principal_ligne,
  f.af_reffourniss                             as reference_fournisseur,
  round(f.af_prixach, 4)                       as prix_tarif_fournisseur,
  round(f.af_remise, 4)                        as remise_pct,
  round(f.af_prixach * (1 - coalesce(f.af_remise, 0) / 100), 4) as prix_net_fournisseur,
  nullif(round(f.af_prixachnouv, 4), 0)        as nouveau_prix_tarif,
  nullif(round(f.af_remisenouv, 4), 0)         as nouvelle_remise_pct,
  public.sage_date_cb(f.af_dateapplication)    as date_application_fournisseur,
  round(b.ar_prixach, 4)                       as prix_achat_fiche,
  round(a.art_derprixach, 4)                   as dernier_prix_achat,
  nullif(round(b.ar_coef, 4), 0)               as coefficient,
  round(b.ar_prixven, 4)                       as prix_vente_ht,
  round(b.ar_prixttc, 4)                       as prix_vente_ttc,
  nullif(round(b.ar_prixachnouv, 4), 0)        as nouveau_prix_achat_fiche,
  nullif(round(b.ar_prixvennouv, 4), 0)        as nouveau_prix_vente,
  public.sage_date_cb(b.ar_dateapplication)    as date_application_fiche,
  case when f.af_prixach is not null and b.ar_prixven is not null
            and abs(f.af_prixach - b.ar_prixven) < 0.01 then 'Oui' else 'Non' end as prix_vente_egal_tarif,
  public.sage_date_cb(b.cbmodification)        as date_modif_fiche,
  public.sage_date_cb(f.cbmodification)        as date_modif_fournisseur
from sage.articles a
left join sage.article_bis b on b.ar_ref = a.art_num
left join sage.fia f on f.ar_ref = a.art_num
left join sage.tiers_complet tp on tp.ct_num = a.art_fourprinc
left join sage.tiers_complet tf on tf.ct_num = f.ct_num
where public.requeteur_autorise();

revoke all on public.v_req_tarifs_articles_sage from anon;
grant select on public.v_req_tarifs_articles_sage to authenticated;

insert into public.requeteur_sources (code, libelle, description, icone, vue, ordre, tri_defaut, tri_sens) values
  ('tarifs_articles_sage', 'Tarifs articles SAGE',
   'Prix des articles SAGE : tarif fournisseur, remise et prix net de chaque fournisseur, nouveaux prix en attente, prix d''achat, coefficient et prix de vente de la fiche article, dates de modification. Filtrez sur un fournisseur principal et sur les articles actifs.',
   '🏷️', 'v_req_tarifs_articles_sage', 75, 'reference_article', 'asc')
on conflict (code) do update set libelle = excluded.libelle, description = excluded.description, icone = excluded.icone,
  vue = excluded.vue, ordre = excluded.ordre, tri_defaut = excluded.tri_defaut, tri_sens = excluded.tri_sens, actif = true;

delete from public.requeteur_champs where source = 'tarifs_articles_sage';
insert into public.requeteur_champs (source, code, libelle, groupe, type, ordre, par_defaut, description, valeurs_requete) values
  ('tarifs_articles_sage', 'reference_article', 'Référence article', 'Article', 'texte', 10, true, null, null),
  ('tarifs_articles_sage', 'designation', 'Désignation', 'Article', 'texte', 20, true, null, null),
  ('tarifs_articles_sage', 'famille', 'Famille', 'Article', 'liste', 30, false, null,
   $L$select distinct famille from public.v_req_tarifs_articles_sage where famille is not null$L$),
  ('tarifs_articles_sage', 'marque', 'Marque', 'Article', 'liste', 40, false, null,
   $L$select distinct marque from public.v_req_tarifs_articles_sage where marque is not null$L$),
  ('tarifs_articles_sage', 'code_fournisseur_principal', 'Code fournisseur principal', 'Article', 'texte', 50, false, 'Ex. H0001 pour HITACHI.', null),
  ('tarifs_articles_sage', 'fournisseur_principal', 'Fournisseur principal', 'Article', 'liste', 60, true, null,
   $L$select distinct fournisseur_principal from public.v_req_tarifs_articles_sage where fournisseur_principal is not null$L$),
  ('tarifs_articles_sage', 'statut_article', 'Statut article', 'Article', 'liste', 70, true, 'Actif ou En sommeil.',
   $L$select distinct statut_article from public.v_req_tarifs_articles_sage where statut_article is not null$L$),
  ('tarifs_articles_sage', 'code_fournisseur', 'Code fournisseur (ligne)', 'Fournisseur', 'texte', 80, false, null, null),
  ('tarifs_articles_sage', 'fournisseur', 'Fournisseur (ligne)', 'Fournisseur', 'liste', 90, true, null,
   $L$select distinct fournisseur from public.v_req_tarifs_articles_sage where fournisseur is not null$L$),
  ('tarifs_articles_sage', 'fournisseur_principal_ligne', 'Fournisseur principal (ligne)', 'Fournisseur', 'liste', 100, true, null,
   $L$select unnest(array['Oui','Non'])$L$),
  ('tarifs_articles_sage', 'reference_fournisseur', 'Référence fournisseur', 'Fournisseur', 'texte', 110, false, null, null),
  ('tarifs_articles_sage', 'prix_tarif_fournisseur', 'Prix tarif fournisseur', 'Achat', 'montant', 120, true, 'Prix d''achat de la ligne fournisseur avant remise.', null),
  ('tarifs_articles_sage', 'remise_pct', 'Remise %', 'Achat', 'nombre', 130, true, null, null),
  ('tarifs_articles_sage', 'prix_net_fournisseur', 'Prix net fournisseur', 'Achat', 'montant', 140, true, 'Prix tarif × (1 − remise).', null),
  ('tarifs_articles_sage', 'nouveau_prix_tarif', 'Nouveau prix tarif', 'Achat', 'montant', 150, false, null, null),
  ('tarifs_articles_sage', 'nouvelle_remise_pct', 'Nouvelle remise %', 'Achat', 'nombre', 160, false, null, null),
  ('tarifs_articles_sage', 'date_application_fournisseur', 'Date d''application (fournisseur)', 'Achat', 'date', 170, false, null, null),
  ('tarifs_articles_sage', 'prix_achat_fiche', 'Prix d''achat (fiche article)', 'Fiche article', 'montant', 180, true, null, null),
  ('tarifs_articles_sage', 'dernier_prix_achat', 'Dernier prix d''achat', 'Fiche article', 'montant', 190, false, null, null),
  ('tarifs_articles_sage', 'coefficient', 'Coefficient', 'Fiche article', 'nombre', 200, true, null, null),
  ('tarifs_articles_sage', 'prix_vente_ht', 'Prix de vente HT', 'Fiche article', 'montant', 210, true, null, null),
  ('tarifs_articles_sage', 'prix_vente_ttc', 'Prix de vente TTC', 'Fiche article', 'montant', 220, false, null, null),
  ('tarifs_articles_sage', 'nouveau_prix_achat_fiche', 'Nouveau prix d''achat (fiche)', 'Fiche article', 'montant', 230, false, null, null),
  ('tarifs_articles_sage', 'nouveau_prix_vente', 'Nouveau prix de vente', 'Fiche article', 'montant', 240, false, null, null),
  ('tarifs_articles_sage', 'date_application_fiche', 'Date d''application (fiche)', 'Fiche article', 'date', 250, false, null, null),
  ('tarifs_articles_sage', 'prix_vente_egal_tarif', 'Prix de vente = prix tarif', 'Fiche article', 'liste', 260, true,
   'Oui quand le prix de vente HT est égal au prix tarif du fournisseur de la ligne.', $L$select unnest(array['Oui','Non'])$L$),
  ('tarifs_articles_sage', 'date_modif_fiche', 'Date de modification (fiche article)', 'Dates', 'date', 270, true, null, null),
  ('tarifs_articles_sage', 'date_modif_fournisseur', 'Date de modification (ligne fournisseur)', 'Dates', 'date', 280, true, null, null);
