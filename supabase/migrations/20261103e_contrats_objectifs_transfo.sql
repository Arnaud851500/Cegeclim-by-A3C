-- ============================================================================
-- 20261103e_contrats_objectifs_transfo.sql
-- Contrats d'objectifs : primes sur l'évolution du taux de transformation des
-- devis, calculées automatiquement (demandé par Arnaud le 03/11/2026).
-- Taux = celui de l'écran Analyse devis / pavé « Taux transfo devis » de la
-- Vision ONE PAGE (V4.6, 16/10/2026) : devis → commande à 120 j (maturité),
-- pondéré par le CA des devis (indicateur_cycle_documents, hors statistique
-- exclus), collaborateur = collaborateur_tiers (fiche client), agence =
-- agence_collaborateur. Comparaison « à âge égal » : devis du 01/01 au dernier
-- jour où ils ont 120 j, vs devis des mêmes dates N-1.
--   - indicateur 'evol_transfo', section 'transfo' ;
--   - cible_evol et seuils de paliers en POINTS (2 = +2 pts) ;
--   - base_ca : collaborateur (perso) ou agence.
-- ============================================================================

create index if not exists idx_icd_collab_tiers_date
  on public.indicateur_cycle_documents (upper(trim(coalesce(collaborateur_tiers, ''))), date_devis)
  include (ca_devis, delai_devis_cdc, hors_statistique);
create index if not exists idx_icd_agence_collab_date
  on public.indicateur_cycle_documents (upper(trim(coalesce(agence_collaborateur, ''))), date_devis)
  include (ca_devis, delai_devis_cdc, hors_statistique);

alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_indicateur_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_indicateur_check
  check (indicateur in ('ca_perso', 'ca_agence', 'zero_impaye_45j', 'cerfa_complet', 'manuel', 'evol_familles', 'evol_transfo'));
alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_section_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_section_check
  check (section in ('ca_perso', 'ca_agence', 'qualitatif', 'familles', 'transfo', 'avenant', 'avril_n1'));

create or replace function public.get_obj_contrat(p_annee integer, p_code text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_contrat public.obj_contrat;
  v_ref record;
  v_agence_norm text;
  v_mois_clos integer := case
    when p_annee < extract(year from current_date)::int then 12
    when p_annee > extract(year from current_date)::int then 0
    else extract(month from current_date)::int - 1 end;
  v_mois jsonb;
  v_ca_agence numeric;
  v_ca_agence_n1 numeric;
  v_imp_date date;
  v_imp_m45 numeric;
  v_imp_n45 integer;
  v_repart jsonb;
  v_mois_calc integer;
  v_lim date;
  v_transfo jsonb := '{}'::jsonb;
begin
  if not public.obj_peut_lire(v_code) then
    raise exception 'Accès refusé : ce contrat d''objectifs n''est pas dans votre périmètre' using errcode = '42501';
  end if;

  select * into v_contrat from public.obj_contrat where annee = p_annee and collaborateur_code = v_code;
  select * into v_ref from public.obj_ref_collaborateurs() where code = v_code;
  v_agence_norm := public.suivi_norm_agence(v_ref.agence);
  -- Date de fin de contrat : le calcul s'arrête au mois de la date de fin
  v_mois_calc := least(v_mois_clos, public.obj_mois_fin(v_contrat.date_fin, p_annee));

  -- Réalisé personnel N et N-1 par mois
  select jsonb_agg(jsonb_build_object(
           'mois', m,
           'ca', coalesce(n.ca, 0), 'marge', coalesce(n.marge, 0),
           'ca_n1', coalesce(n1.ca, 0), 'marge_n1', coalesce(n1.marge, 0)) order by m)
    into v_mois
  from generate_series(1, 12) m
  left join public.obj_realise_mensuel(p_annee, array[v_code]) n  on n.annee = p_annee     and n.mois = m
  left join public.obj_realise_mensuel(p_annee, array[v_code]) n1 on n1.annee = p_annee - 1 and n1.mois = m;

  -- CA de l'agence du collaborateur (agence de la fiche collaborateur) :
  -- N sur les mois clos, N-1 sur l'année complète
  if v_agence_norm is not null then
    select coalesce(sum(x.ca) filter (where x.annee = p_annee and x.mois <= v_mois_calc), 0),
           coalesce(sum(x.ca) filter (where x.annee = p_annee - 1), 0)
      into v_ca_agence, v_ca_agence_n1
    from public.obj_realise_mensuel(p_annee, null) x
    join public.obj_ref_collaborateurs() rc on rc.code = x.code
    where public.suivi_norm_agence(rc.agence) = v_agence_norm;
  end if;

  -- Impayés > 45 j au dernier instantané (même rattachement que get_suivi_impayes)
  select max(date_extraction) into v_imp_date from public.retards_paiement_clients;
  if v_imp_date is not null then
    select round(coalesce(sum(coalesce(r.retard_plus_45, 0)), 0), 2),
           count(*) filter (where coalesce(r.retard_plus_45, 0) > 0)
      into v_imp_m45, v_imp_n45
    from public.retards_paiement_clients r
    left join public.ref_tiers t on t.numero = r.numero_tiers
    left join public.synthese_multi_clients_cache c
      on c.numero_tiers = r.numero_tiers
     and c.annee = extract(year from r.date_extraction)::int
     and c.row_kind = 'client'
    where r.date_extraction = v_imp_date
      and upper(coalesce(nullif(btrim(c.collaborateur), ''), nullif(btrim(t.representant), ''),
                         nullif(btrim(r.commercial_code), ''), 'NON AFFECTE')) = v_code;
  end if;

  -- Taux de transformation devis → commande à 120 j, en CA (même lecture « à âge
  -- égal » que l'écran Analyse devis) : devis du 1er janvier jusqu'au dernier jour
  -- où ils ont 120 j (borné par la fin d'année / la date de fin de contrat),
  -- comparés aux devis des mêmes dates N-1. Calculé seulement si une prime l'utilise.
  if exists (select 1 from public.obj_contrat_prime p where p.contrat_id = v_contrat.id and p.indicateur = 'evol_transfo') then
    v_lim := least(current_date - 120, make_date(p_annee, 12, 31), coalesce(v_contrat.date_fin, make_date(p_annee, 12, 31)));
    if v_lim >= make_date(p_annee, 1, 1) then
      select jsonb_object_agg(b.base, jsonb_build_object(
               'taux', t.taux, 'taux_n1', t.taux_n1, 'ca_devis', t.ca_n, 'ca_devis_n1', t.ca_n1,
               'date_debut', make_date(p_annee, 1, 1), 'date_limite', v_lim))
        into v_transfo
      from (select distinct p.base_ca as base from public.obj_contrat_prime p
            where p.contrat_id = v_contrat.id and p.indicateur = 'evol_transfo') b
      cross join lateral (
        select round(100.0 * sum(x.ca) filter (where x.n and x.d <= 120) / nullif(sum(x.ca) filter (where x.n), 0), 1) as taux,
               round(100.0 * sum(x.ca) filter (where not x.n and x.d <= 120) / nullif(sum(x.ca) filter (where not x.n), 0), 1) as taux_n1,
               round(coalesce(sum(x.ca) filter (where x.n), 0), 2) as ca_n,
               round(coalesce(sum(x.ca) filter (where not x.n), 0), 2) as ca_n1
        from (
          -- deux branches séparées pour que chacune utilise son index
          select (icd.date_devis >= make_date(p_annee, 1, 1)) as n, coalesce(icd.ca_devis, 0) as ca, icd.delai_devis_cdc as d
          from public.indicateur_cycle_documents icd
          where b.base = 'perso'
            and upper(trim(coalesce(icd.collaborateur_tiers, ''))) = v_code
            and coalesce(icd.hors_statistique, false) = false
            and ((icd.date_devis between make_date(p_annee, 1, 1) and v_lim)
                 or (icd.date_devis between make_date(p_annee - 1, 1, 1) and (v_lim - interval '1 year')::date))
          union all
          select (icd.date_devis >= make_date(p_annee, 1, 1)), coalesce(icd.ca_devis, 0), icd.delai_devis_cdc
          from public.indicateur_cycle_documents icd
          where b.base = 'agence'
            and upper(trim(coalesce(icd.agence_collaborateur, ''))) = upper(trim(coalesce(v_ref.agence, '')))
            and coalesce(icd.hors_statistique, false) = false
            and ((icd.date_devis between make_date(p_annee, 1, 1) and v_lim)
                 or (icd.date_devis between make_date(p_annee - 1, 1, 1) and (v_lim - interval '1 year')::date))
        ) x
      ) t;
    end if;
  end if;

  select jsonb_agg(jsonb_build_object('mois', mois, 'pct', pct) order by mois)
    into v_repart
  from public.objectifs_repartition_mensuelle where annee = p_annee;

  return jsonb_build_object(
    'annee', p_annee,
    'code', v_code,
    'nom', coalesce(v_ref.nom, v_code),
    'agence', v_ref.agence,
    'mois_clos', v_mois_clos,
    'modifier', public.obj_peut_modifier(),
    'contrat', case when v_contrat.id is null then null else jsonb_build_object(
        'id', v_contrat.id,
        'objectif_caht', v_contrat.objectif_caht,
        'marge_n1', v_contrat.marge_n1,
        'taux_base', v_contrat.taux_base,
        'taux_commission', v_contrat.taux_commission,
        'avance_mensuelle_saisie', v_contrat.avance_mensuelle_saisie,
        'avance_mensuelle', coalesce(v_contrat.avance_mensuelle_saisie,
                                     round(coalesce(v_contrat.marge_n1, 0) * v_contrat.taux_base * v_contrat.taux_commission, 0)),
        'perimetre_objectif', v_contrat.perimetre_objectif,
        'date_fin', v_contrat.date_fin,
        'statut', v_contrat.statut,
        'commentaire', v_contrat.commentaire,
        'source_fichier', v_contrat.source_fichier,
        'source_onglet', v_contrat.source_onglet,
        'updated_at', v_contrat.updated_at,
        'updated_by', v_contrat.updated_by) end,
    'primes', coalesce((
        select jsonb_agg(to_jsonb(p) - 'contrat_id' - 'created_at' order by p.ordre, p.created_at)
        from public.obj_contrat_prime p where p.contrat_id = v_contrat.id), '[]'::jsonb),
    'versements', coalesce((
        select jsonb_agg(to_jsonb(v) - 'contrat_id' order by v.mois, v.created_at)
        from public.obj_versement v where v.contrat_id = v_contrat.id), '[]'::jsonb),
    'mois', coalesce(v_mois, '[]'::jsonb),
    'ca_agence', v_ca_agence,
    'ca_agence_n1', v_ca_agence_n1,
    'impayes', jsonb_build_object('date', v_imp_date, 'm45', coalesce(v_imp_m45, 0), 'n45', coalesce(v_imp_n45, 0)),
    'repartition', coalesce(v_repart, '[]'::jsonb),
    -- Primes « évolution du CA sur des familles » : CA N et N-1 sur les mêmes mois
    -- (janvier → dernier mois de calcul), perso ou agence selon base_ca
    'transfo', coalesce(v_transfo, '{}'::jsonb),
    'familles_resultats', coalesce((
        select jsonb_object_agg(p.id::text, jsonb_build_object('ca', fr.ca, 'ca_n1', fr.ca_n1, 'mois', v_mois_calc))
        from public.obj_contrat_prime p
        cross join lateral (
          select coalesce(round(sum(i.ca_ht) filter (where i.annee = p_annee), 2), 0) as ca,
                 coalesce(round(sum(i.ca_ht) filter (where i.annee = p_annee - 1), 2), 0) as ca_n1
          from public.indicateur_factures_mensuel i
          left join public.obj_ref_collaborateurs() rc
            on p.base_ca = 'agence' and rc.code = upper(split_part(btrim(i.collaborateur), ' ', 1))
          where i.annee between p_annee - 1 and p_annee
            and i.mois <= v_mois_calc
            and coalesce(i.hors_statistique, false) = false
            and nullif(btrim(i.collaborateur), '') is not null
            and case when p.base_ca = 'agence'
                     then public.suivi_norm_agence(rc.agence) = v_agence_norm
                     else upper(split_part(btrim(i.collaborateur), ' ', 1)) = v_code end
            and (btrim(coalesce(i.famille_macro, '')) = any (coalesce(p.familles_macro, '{}'))
                 or btrim(coalesce(i.famille, '')) = any (coalesce(p.familles, '{}')))
        ) fr
        where p.contrat_id = v_contrat.id and p.indicateur = 'evol_familles'), '{}'::jsonb)
  );
end;
$$;
