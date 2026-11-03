-- ============================================================================
-- 20261103d_contrats_objectifs_familles.sql
-- Contrats d'objectifs : primes sur l'évolution du CA de familles produits,
-- calculées automatiquement (demandé par Arnaud le 03/11/2026 — ex. « Prime
-- dvpt Accessoires +20 % », « Yutampo +20 % », « A/A +20 % : DRV - Mono Multi »).
--   - indicateur 'evol_familles' : une ou plusieurs macro-familles et/ou
--     familles (indicateur_factures_mensuel.famille_macro / famille) ;
--   - base_ca : CA perso du collaborateur ou CA de son agence ;
--   - comparaison CA N vs CA N-1 sur les mêmes mois (janvier → dernier mois
--     de calcul, borné par la date de fin de contrat) ;
--   - forfait : atteint si évolution ≥ cible_evol (0,20 = +20 %) ;
--     paliers : seuils exprimés en évolution (0,10 = +10 %).
--   - nouvelle section 'familles' (Prime sur le développement de familles).
-- ============================================================================

alter table public.obj_contrat_prime
  add column if not exists familles_macro text[] not null default '{}',
  add column if not exists familles text[] not null default '{}',
  add column if not exists base_ca text not null default 'perso',
  add column if not exists cible_evol numeric;

alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_indicateur_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_indicateur_check
  check (indicateur in ('ca_perso', 'ca_agence', 'zero_impaye_45j', 'cerfa_complet', 'manuel', 'evol_familles'));
alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_section_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_section_check
  check (section in ('ca_perso', 'ca_agence', 'qualitatif', 'familles', 'avenant', 'avril_n1'));
alter table public.obj_contrat_prime drop constraint if exists obj_contrat_prime_base_ca_check;
alter table public.obj_contrat_prime add constraint obj_contrat_prime_base_ca_check
  check (base_ca in ('perso', 'agence'));

-- Référentiel des familles (macro → familles) vu dans la facturation N-1 / N
create or replace function public.get_obj_familles()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('macro', macro, 'familles', familles) order by macro), '[]'::jsonb)
  from (
    select btrim(famille_macro) as macro,
           array_agg(distinct btrim(famille) order by btrim(famille)) filter (where nullif(btrim(famille), '') is not null) as familles
    from public.indicateur_factures_mensuel
    where annee >= extract(year from current_date)::int - 1
      and nullif(btrim(famille_macro), '') is not null
    group by btrim(famille_macro)
  ) x;
$$;
grant execute on function public.get_obj_familles() to authenticated;

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
          updated_at  = now()
        where id = v_pid;
      else
        insert into public.obj_contrat_prime (contrat_id, ordre, section, libelle, description, mode, indicateur, paliers, montant, echeance,
                                              familles_macro, familles, base_ca, cible_evol)
        values (v_id, v_ordre, v_pr ->> 'section', v_pr ->> 'libelle', nullif(v_pr ->> 'description', ''),
                coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
                coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
                coalesce(v_pr -> 'paliers', '[]'::jsonb),
                coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
                coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'),
                coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles_macro', '[]'::jsonb))), '{}'),
                coalesce(array(select jsonb_array_elements_text(coalesce(v_pr -> 'familles', '[]'::jsonb))), '{}'),
                case when v_pr ->> 'base_ca' = 'agence' then 'agence' else 'perso' end,
                nullif(v_pr ->> 'cible_evol', '')::numeric)
        returning id into v_pid;
      end if;
      v_ids := v_ids || v_pid;
    end loop;
    delete from public.obj_contrat_prime where contrat_id = v_id and not (id = any (v_ids));
  end if;

  return v_id;
end;
$$;
