-- ============================================================================
-- 20261103f_contrats_objectifs_clients_suivi.sql
-- 1. Contrats d'objectifs : primes « nombre de clients par tranche de CA
--    12 mois glissants » (t400 / t200 / t100 / t50 / t20), base perso ou agence,
--    calcul automatique (même segmentation que le profil clients du suivi).
-- 2. Suivi agences / commerciaux : get_suivi_objectifs lit désormais les
--    contrats d'objectifs et non plus l'écran Objectifs ; objectif d'une agence
--    = somme des objectifs de ses collaborateurs (décisions d'Arnaud, 03/11/2026).
-- ============================================================================

alter table public.obj_contrat_prime
  add column if not exists tranche text,
  add column if not exists cible_nb numeric;

alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_indicateur_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_indicateur_check
  check (indicateur in ('ca_perso', 'ca_agence', 'zero_impaye_45j', 'cerfa_complet', 'manuel', 'evol_familles', 'evol_transfo', 'nb_clients'));
alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_section_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_section_check
  check (section in ('ca_perso', 'ca_agence', 'qualitatif', 'familles', 'transfo', 'clients', 'avenant', 'avril_n1'));
alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_tranche_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_tranche_check
  check (tranche is null or tranche in ('t400', 't200', 't100', 't50', 't20'));

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
    -- Primes « nombre de clients par tranche de CA 12 mois glissants » (fin du
    -- dernier mois de calcul), même segmentation que le profil clients du suivi
    'clients_resultats', coalesce((
        select jsonb_object_agg(p.id::text, jsonb_build_object('nb', cr.nb, 'nb_n1', cr.nb_n1, 'mois', v_mois_calc))
        from public.obj_contrat_prime p
        cross join lateral (
          with tr as (
            select case p.tranche when 't400' then 400000 when 't200' then 200000 when 't100' then 100000
                                  when 't50' then 50000 when 't20' then 20000 else 0.01 end::numeric as mini,
                   case p.tranche when 't400' then null when 't200' then 400000 when 't100' then 200000
                                  when 't50' then 100000 when 't20' then 50000 else 20000 end::numeric as maxi
          ),
          codes as (
            select array[v_code] as l where p.base_ca <> 'agence'
            union all
            select coalesce(array_agg(rc.code), '{}') from public.obj_ref_collaborateurs() rc
            where p.base_ca = 'agence' and public.suivi_norm_agence(rc.agence) = v_agence_norm
          ),
          cli as (
            select i.numero_tiers,
                   sum(i.ca_ht) filter (where (i.annee = p_annee and i.mois <= v_mois_calc) or (i.annee = p_annee - 1 and i.mois > v_mois_calc)) as g12,
                   sum(i.ca_ht) filter (where (i.annee = p_annee - 1 and i.mois <= v_mois_calc) or (i.annee = p_annee - 2 and i.mois > v_mois_calc)) as g12n1
            from public.indicateur_factures_mensuel i
            where i.annee between p_annee - 2 and p_annee
              and coalesce(i.hors_statistique, false) = false
              and upper(split_part(btrim(i.collaborateur), ' ', 1)) in (select unnest(codes.l) from codes)
            group by i.numero_tiers
          )
          select count(*) filter (where cli.g12 >= tr.mini and (tr.maxi is null or cli.g12 < tr.maxi)) as nb,
                 count(*) filter (where cli.g12n1 >= tr.mini and (tr.maxi is null or cli.g12n1 < tr.maxi)) as nb_n1
          from cli cross join tr
        ) cr
        where p.contrat_id = v_contrat.id and p.indicateur = 'nb_clients'), '{}'::jsonb),
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

create or replace function public.save_obj_contrat(p jsonb)
returns uuid
language plpgsql
volatile security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_annee integer := (p ->> 'annee')::int;
  v_code text := upper(btrim(coalesce(p ->> 'collaborateur_code', '')));
  v_id uuid;
  v_ids uuid[] := '{}';
  v_pr jsonb;
  v_pid uuid;
  v_ordre integer := 0;
begin
  if not public.obj_peut_modifier() then
    raise exception 'Accès refusé : seule la direction peut modifier les contrats d''objectifs' using errcode = '42501';
  end if;
  if v_annee is null or v_code = '' then
    raise exception 'Année et collaborateur obligatoires';
  end if;

  insert into public.obj_contrat as c (
    annee, collaborateur_code, objectif_caht, marge_n1, taux_base, taux_commission,
    avance_mensuelle_saisie, perimetre_objectif, date_fin, statut, commentaire, source_fichier, source_onglet, created_by, updated_by)
  values (
    v_annee, v_code,
    nullif(p ->> 'objectif_caht', '')::numeric,
    nullif(p ->> 'marge_n1', '')::numeric,
    coalesce(nullif(p ->> 'taux_base', '')::numeric, 0.08),
    coalesce(nullif(p ->> 'taux_commission', '')::numeric, 0.01),
    nullif(p ->> 'avance_mensuelle_saisie', '')::numeric,
    case when p ->> 'perimetre_objectif' = 'agence' then 'agence' else 'perso' end,
    nullif(p ->> 'date_fin', '')::date,
    coalesce(nullif(p ->> 'statut', ''), 'valide'),
    nullif(p ->> 'commentaire', ''),
    nullif(p ->> 'source_fichier', ''),
    nullif(p ->> 'source_onglet', ''),
    v_email, v_email)
  on conflict (annee, collaborateur_code) do update set
    objectif_caht           = excluded.objectif_caht,
    marge_n1                = excluded.marge_n1,
    taux_base               = excluded.taux_base,
    taux_commission         = excluded.taux_commission,
    avance_mensuelle_saisie = excluded.avance_mensuelle_saisie,
    perimetre_objectif      = case when p ? 'perimetre_objectif' then excluded.perimetre_objectif else c.perimetre_objectif end,
    date_fin                = case when p ? 'date_fin' then excluded.date_fin else c.date_fin end,
    statut                  = excluded.statut,
    commentaire             = excluded.commentaire,
    source_fichier          = coalesce(excluded.source_fichier, c.source_fichier),
    source_onglet           = coalesce(excluded.source_onglet, c.source_onglet),
    updated_by              = v_email,
    updated_at              = now()
  returning id into v_id;

  if p ? 'primes' then
    for v_pr in select * from jsonb_array_elements(coalesce(p -> 'primes', '[]'::jsonb)) loop
      v_ordre := v_ordre + 1;
      v_pid := nullif(v_pr ->> 'id', '')::uuid;
      if v_pid is not null and exists (select 1 from public.obj_contrat_prime where id = v_pid and contrat_id = v_id) then
        update public.obj_contrat_prime set
          ordre       = v_ordre,
          section     = v_pr ->> 'section',
          libelle     = v_pr ->> 'libelle',
          description = nullif(v_pr ->> 'description', ''),
          mode        = coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
          indicateur  = coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
          paliers     = coalesce(v_pr -> 'paliers', '[]'::jsonb),
          montant     = coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
          echeance    = coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'),
          familles_macro = coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles_macro', '[]'::jsonb))), '{}'),
          familles    = coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles', '[]'::jsonb))), '{}'),
          base_ca     = case when v_pr ->> 'base_ca' = 'agence' then 'agence' else 'perso' end,
          cible_evol  = nullif(v_pr ->> 'cible_evol', '')::numeric,
          tranche     = nullif(v_pr ->> 'tranche', ''),
          cible_nb    = nullif(v_pr ->> 'cible_nb', '')::numeric,
          updated_at  = now()
        where id = v_pid;
      else
        insert into public.obj_contrat_prime (contrat_id, ordre, section, libelle, description, mode, indicateur, paliers, montant, echeance,
                                              familles_macro, familles, base_ca, cible_evol, tranche, cible_nb)
        values (v_id, v_ordre, v_pr ->> 'section', v_pr ->> 'libelle', nullif(v_pr ->> 'description', ''),
                coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
                coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
                coalesce(v_pr -> 'paliers', '[]'::jsonb),
                coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
                coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'),
                coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles_macro', '[]'::jsonb))), '{}'),
                coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles', '[]'::jsonb))), '{}'),
                case when v_pr ->> 'base_ca' = 'agence' then 'agence' else 'perso' end,
                nullif(v_pr ->> 'cible_evol', '')::numeric,
                nullif(v_pr ->> 'tranche', ''),
                nullif(v_pr ->> 'cible_nb', '')::numeric)
        returning id into v_pid;
      end if;
      v_ids := v_ids || v_pid;
    end loop;
    delete from public.obj_contrat_prime where contrat_id = v_id and not (id = any (v_ids));
  end if;

  return v_id;
end;
$$;

create or replace function public.get_suivi_objectifs(p_annee integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
-- Depuis le 03/11/2026 (demandé par Arnaud) : les objectifs du suivi agences /
-- commerciaux viennent des CONTRATS D'OBJECTIFS (obj_contrat / obj_contrat_prime),
-- plus de l'écran Objectifs (objectifs_commerciaux n'est plus lu).
--   - collaborateur (perimetre_type 'collaborateur', ref = code) : CA HT
--     (contrats dont l'objectif porte sur le CA perso), évolution du CA par
--     macro-famille (primes evol_familles, forfait : cible ; paliers : 1er seuil),
--     nombre de clients par tranche (primes nb_clients), zéro impayé > 45 j ;
--   - agence = somme des objectifs CA perso et des cibles « nombre de clients »
--     des contrats de ses collaborateurs (agence de la fiche collaborateur) ;
--   - entreprise = somme des agences.
-- Même règle de visibilité qu'avant (suivi_perimetre). 'commerciaux' est vide :
-- la règle « agence à un seul commercial » n'a plus lieu d'être (agence = somme).
declare
  v_illimite boolean;
  v_agences text[];
  v_collabs text[];
  v_codes text[];
begin
  if auth.uid() is null then
    return null;
  end if;

  select illimite, agences, collaborateurs, codes
    into v_illimite, v_agences, v_collabs, v_codes
  from public.suivi_perimetre();

  return (
    with c as (
      select c.*, rc.agence as agence, public.suivi_norm_agence(rc.agence) as agence_norm
      from public.obj_contrat c
      left join public.obj_ref_collaborateurs() rc on rc.code = c.collaborateur_code
      where c.annee = p_annee and c.statut <> 'brouillon'
    ),
    p as (
      select pr.*, c.collaborateur_code, c.agence, c.agence_norm
      from public.obj_contrat_prime pr join c on c.id = pr.contrat_id
    ),
    o as (
      -- CA HT perso
      select 'collaborateur'::text as perimetre_type, c.collaborateur_code as perimetre_ref, c.agence_norm,
             'ca_valeur'::text as type_objectif, null::text as famille_macro, c.objectif_caht as valeur_cible
      from c where c.perimetre_objectif = 'perso' and c.objectif_caht is not null
      union all
      -- évolution du CA par macro-famille (base perso)
      select 'collaborateur', p.collaborateur_code, p.agence_norm, 'ca_evolution_pct', m.fam,
             round(100 * coalesce(case when p.mode = 'paliers'
                                       then (select min((x ->> 'seuil')::numeric) from jsonb_array_elements(p.paliers) x)
                                       else p.cible_evol end, 0), 1)
      from p cross join lateral unnest(p.familles_macro) as m(fam)
      where p.indicateur = 'evol_familles' and p.base_ca = 'perso'
      union all
      -- nombre de clients par tranche (base perso)
      select 'collaborateur', p.collaborateur_code, p.agence_norm, 'nb_clients_' || p.tranche, null, p.cible_nb
      from p where p.indicateur = 'nb_clients' and p.base_ca = 'perso' and p.tranche is not null and p.cible_nb is not null
      union all
      -- zéro impayé
      select distinct 'collaborateur', p.collaborateur_code, p.agence_norm, 'zero_impaye_45j', null::text, 0::numeric
      from p where p.indicateur = 'zero_impaye_45j'
    ),
    o_vis as (
      select * from o
      where v_illimite
         or o.perimetre_ref = any (coalesce(v_codes, '{}'))
         or (cardinality(coalesce(v_collabs, '{}')) = 0 and o.agence_norm = any (coalesce(v_agences, '{}')))
    ),
    ag as (
      select 'agence'::text as perimetre_type, max(c.agence) as perimetre_ref, c.agence_norm,
             'ca_valeur'::text as type_objectif, null::text as famille_macro, sum(c.objectif_caht) as valeur_cible
      from c where c.perimetre_objectif = 'perso' and c.objectif_caht is not null and c.agence_norm is not null
      group by c.agence_norm
      union all
      select 'agence', max(p.agence), p.agence_norm, 'nb_clients_' || p.tranche, null, sum(p.cible_nb)
      from p where p.indicateur = 'nb_clients' and p.tranche is not null and p.cible_nb is not null and p.agence_norm is not null
      group by p.agence_norm, p.tranche
    ),
    ag_vis as (
      select * from ag
      where v_illimite
         or ag.agence_norm = any (coalesce(v_agences, '{}'))
         or ag.agence_norm in (select o_vis.agence_norm from o_vis)
    ),
    ent as (
      select 'entreprise'::text as perimetre_type, null::text as perimetre_ref, null::text as agence_norm,
             'ca_valeur'::text as type_objectif, null::text as famille_macro, sum(valeur_cible) as valeur_cible
      from ag where type_objectif = 'ca_valeur'
      having sum(valeur_cible) is not null
    ),
    tout as (
      select * from o_vis union all select * from ag_vis union all select * from ent
    )
    select jsonb_build_object(
      'source', 'contrats',
      'objectifs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'perimetre_type', t.perimetre_type,
                 'perimetre_ref', t.perimetre_ref,
                 'type_objectif', t.type_objectif,
                 'famille_macro', t.famille_macro,
                 'valeur_cible', t.valeur_cible))
        from tout t
      ), '[]'::jsonb),
      'commerciaux', '[]'::jsonb,
      'repartition', coalesce((
        select jsonb_agg(jsonb_build_object('mois', r.mois, 'pct', r.pct, 'source', r.source) order by r.mois)
        from public.objectifs_repartition_mensuelle r
        where r.annee = p_annee
      ), '[]'::jsonb)
    )
  );
end;
$$;
