-- ============================================================================
-- 20261103c_contrats_objectifs_date_fin.sql
-- Contrats d'objectifs : date de fin de contrat (demandé par Arnaud le
-- 03/11/2026, cas d'un commercial parti en cours d'année). Le calcul (CA,
-- marge, commission, CA agence, avances) s'arrête au mois de la date de fin,
-- ce mois inclus ; la projection est faite sur la période du contrat.
-- ============================================================================

alter table public.obj_contrat add column if not exists date_fin date;

-- Dernier mois de calcul du contrat pour l'année : 12 sans date de fin,
-- mois de la date de fin si elle tombe dans l'année, 0 si elle est antérieure.
create or replace function public.obj_mois_fin(p_date_fin date, p_annee integer)
returns integer
language sql
immutable
as $$
  select case
    when p_date_fin is null then 12
    when extract(year from p_date_fin)::int > p_annee then 12
    when extract(year from p_date_fin)::int < p_annee then 0
    else extract(month from p_date_fin)::int
  end;
$$;
grant execute on function public.obj_mois_fin(date, integer) to authenticated;

create or replace function public.get_obj_contrats_liste(p_annee integer)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'auth'
set row_security to 'off'
as $$
declare
  v_result jsonb;
  v_mois_clos integer := case
    when p_annee < extract(year from current_date)::int then 12
    when p_annee > extract(year from current_date)::int then 0
    else extract(month from current_date)::int - 1 end;
begin
  if auth.uid() is null then
    raise exception 'authentification requise' using errcode = '42501';
  end if;

  with c as (
    select c.*, rc.nom as rc_nom, rc.agence as rc_agence,
           public.suivi_norm_agence(rc.agence) as agence_norm,
           public.obj_mois_fin(c.date_fin, p_annee) as mois_fin,
           least(v_mois_clos, public.obj_mois_fin(c.date_fin, p_annee)) as mois_calc
    from public.obj_contrat c
    left join public.obj_ref_collaborateurs() rc on rc.code = c.collaborateur_code
    where c.annee = p_annee and public.obj_peut_lire(c.collaborateur_code)
  ),
  perso as (
    select x.code, x.annee, x.mois, x.ca, x.marge
    from public.obj_realise_mensuel(p_annee, (select array_agg(collaborateur_code) from c)) x
  ),
  ag as (
    select public.suivi_norm_agence(rc.agence) as agence_norm, x.annee, x.mois, sum(x.ca) as ca
    from public.obj_realise_mensuel(p_annee, null) x
    join public.obj_ref_collaborateurs() rc on rc.code = x.code
    where exists (select 1 from c where c.perimetre_objectif = 'agence')
    group by 1, 2, 3
  ),
  r as (
    select c.id,
           (select sum(x.ca)    from perso x where x.code = c.collaborateur_code and x.annee = p_annee and x.mois <= c.mois_calc) as ca,
           (select sum(x.marge) from perso x where x.code = c.collaborateur_code and x.annee = p_annee and x.mois <= c.mois_calc) as marge,
           (select sum(x.ca)    from perso x where x.code = c.collaborateur_code and x.annee = p_annee - 1 and x.mois <= greatest(c.mois_calc, 1)) as ca_n1_a_date,
           (select sum(a.ca) from ag a where a.agence_norm = c.agence_norm and a.annee = p_annee and a.mois <= c.mois_calc) as ca_ag,
           (select sum(a.ca) from ag a where a.agence_norm = c.agence_norm and a.annee = p_annee - 1 and a.mois <= greatest(c.mois_calc, 1)) as ca_ag_n1
    from c
  ),
  p as (
    select pr.contrat_id,
           count(*) as nb_primes,
           count(*) filter (where pr.resultat = 'a_evaluer' and pr.indicateur in ('manuel', 'cerfa_complet')) as nb_a_evaluer
    from public.obj_contrat_prime pr
    where pr.contrat_id in (select id from c)
    group by pr.contrat_id
  )
  select jsonb_build_object(
    'annee', p_annee,
    'mois_clos', v_mois_clos,
    'modifier', public.obj_peut_modifier(),
    'mon_code', public.obj_mon_code(),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'code', c.collaborateur_code,
      'nom', coalesce(c.rc_nom, c.collaborateur_code),
      'agence', c.rc_agence,
      'statut', c.statut,
      'objectif_caht', c.objectif_caht,
      'marge_n1', c.marge_n1,
      'taux_base', c.taux_base,
      'taux_commission', c.taux_commission,
      'avance_mensuelle', coalesce(c.avance_mensuelle_saisie, round(coalesce(c.marge_n1, 0) * c.taux_base * c.taux_commission, 0)),
      'date_fin', c.date_fin,
      'mois_fin', c.mois_fin,
      'mois_calc', c.mois_calc,
      'ca', coalesce(r.ca, 0),
      'marge', coalesce(r.marge, 0),
      'ca_n1_a_date', coalesce(r.ca_n1_a_date, 0),
      'perimetre_objectif', c.perimetre_objectif,
      'ca_objectif', case when c.perimetre_objectif = 'agence' then coalesce(r.ca_ag, 0) else coalesce(r.ca, 0) end,
      'ca_objectif_n1_a_date', case when c.perimetre_objectif = 'agence' then coalesce(r.ca_ag_n1, 0) else coalesce(r.ca_n1_a_date, 0) end,
      'nb_primes', coalesce(p.nb_primes, 0),
      'nb_a_evaluer', coalesce(p.nb_a_evaluer, 0),
      'updated_at', c.updated_at
    ) order by c.rc_agence nulls last, coalesce(c.rc_nom, c.collaborateur_code)), '[]'::jsonb)
  ) into v_result
  from c
  left join r on r.id = c.id
  left join p on p.contrat_id = c.id;

  return v_result;
end;
$$;

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
    'repartition', coalesce(v_repart, '[]'::jsonb)
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
          updated_at  = now()
        where id = v_pid;
      else
        insert into public.obj_contrat_prime (contrat_id, ordre, section, libelle, description, mode, indicateur, paliers, montant, echeance)
        values (v_id, v_ordre, v_pr ->> 'section', v_pr ->> 'libelle', nullif(v_pr ->> 'description', ''),
                coalesce(nullif(v_pr ->> 'mode', ''), 'forfait'),
                coalesce(nullif(v_pr ->> 'indicateur', ''), 'manuel'),
                coalesce(v_pr -> 'paliers', '[]'::jsonb),
                coalesce(nullif(v_pr ->> 'montant', '')::numeric, 0),
                coalesce(nullif(v_pr ->> 'echeance', ''), 'avril_n1'))
        returning id into v_pid;
      end if;
      v_ids := v_ids || v_pid;
    end loop;
    delete from public.obj_contrat_prime where contrat_id = v_id and not (id = any (v_ids));
  end if;

  return v_id;
end;
$$;
