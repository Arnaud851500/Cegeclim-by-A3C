-- ============================================================================
-- 20261104c_hotline_historique_import.sql — Hotline technique (04/11/2026)
-- ----------------------------------------------------------------------------
-- 1. Évolution du ticket :
--    - nature de l'appel (DEPANNAGE, QUESTION_TECHNIQUE, ASSISTANCE,
--      DEMANDE_GARANTIE, DEMANDE_DEVIS, LIVRAISON_PIECE, AUTRE) ;
--    - groupe extérieur (GE) : modele_ge, serie_ge ; l'unité intérieure (UI)
--      reste dans reference_article / numero_serie ;
--    - code_defaut, date_mes (date de mise en service) ;
--    - source IMPORT pour l'historique repris de l'ancien outil.
-- 2. Historique chantier / machine : la recherche par n° de série couvre le
--    GE et l'UI, la recherche par chantier couvre aussi le modèle GE.
-- 3. Import de l'ancien outil de ticketing (RPC hotline_importer_historique) :
--    numéro conservé (TICK…), date de création imposée, client retrouvé par
--    le téléphone (fiche tiers, contacts SAGE et BLG, carnet hotline) puis par
--    le nom de la société, code tiers corrigé dans le fichier prioritaire ;
--    notes et diagnostics dans le corps du ticket ; ré-import = mise à jour.
--    Réservé aux comptes d'Arnaud. Le carnet hotline n'est complété que pour
--    les téléphones qu'il ne connaît pas encore.
-- ============================================================================

alter table public.hotline_tickets add column if not exists nature text;
alter table public.hotline_tickets add column if not exists modele_ge text;
alter table public.hotline_tickets add column if not exists serie_ge text;
alter table public.hotline_tickets add column if not exists code_defaut text;
alter table public.hotline_tickets add column if not exists date_mes date;
alter table public.hotline_tickets drop constraint if exists hotline_tickets_source_check;
alter table public.hotline_tickets add constraint hotline_tickets_source_check
  check (source in ('TELEPHONE', 'MANUEL', 'EXTRANET', 'IMPORT'));
create index if not exists idx_hotline_tickets_tel_cle on public.hotline_tickets (public.hotline_tel_cle(telephone_appelant));
create index if not exists idx_hotline_tickets_tiers on public.hotline_tickets (numero_tiers, opened_at desc);

-- Le carnet n'est pas alimenté ligne à ligne par l'import (voir la RPC).
create or replace function public.hotline_ticket_memoriser_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cle text := public.hotline_tel_cle(new.telephone_appelant);
begin
  if new.source = 'IMPORT' then
    return new;
  end if;
  if v_cle is null or length(v_cle) < 9 then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and coalesce(new.numero_tiers, '') = coalesce(old.numero_tiers, '')
     and coalesce(new.intitule_tiers, '') = coalesce(old.intitule_tiers, '')
     and coalesce(new.contact_nom, '') = coalesce(old.contact_nom, '')
     and coalesce(new.contact_email, '') = coalesce(old.contact_email, '')
     and coalesce(new.telephone_appelant, '') = coalesce(old.telephone_appelant, '') then
    return new;
  end if;

  insert into public.hotline_contacts as c (telephone_cle, telephone, numero_tiers, intitule_tiers, contact_nom, email, updated_by)
  values (v_cle, new.telephone_appelant, nullif(trim(new.numero_tiers), ''), nullif(trim(new.intitule_tiers), ''),
          nullif(trim(new.contact_nom), ''), nullif(lower(trim(new.contact_email)), ''), public.current_user_email())
  on conflict (telephone_cle) do update set
    telephone      = excluded.telephone,
    numero_tiers   = coalesce(excluded.numero_tiers, c.numero_tiers),
    intitule_tiers = coalesce(excluded.intitule_tiers, c.intitule_tiers),
    contact_nom    = coalesce(excluded.contact_nom, c.contact_nom),
    email          = coalesce(excluded.email, c.email),
    nb_appels      = c.nb_appels + case when tg_op = 'INSERT' then 1 else 0 end,
    dernier_appel  = case when tg_op = 'INSERT' then now() else c.dernier_appel end,
    updated_by     = excluded.updated_by;
  return new;
end
$function$;

-- Résumé d'un ticket dans les historiques : nature, GE, code défaut.
create or replace function public.hotline_ticket_resume(t hotline_tickets)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object('id', t.id, 'numero', t.numero, 'filiere', t.filiere, 'motif', t.motif,
           'statut', t.statut, 'niveau', t.niveau, 'opened_at', t.opened_at, 'description', t.description,
           'preconisation', t.preconisation, 'chantier', t.chantier, 'numero_serie', t.numero_serie,
           'contact_nom', t.contact_nom, 'intitule_tiers', t.intitule_tiers, 'numero_tiers', t.numero_tiers,
           'nature', t.nature, 'serie_ge', t.serie_ge, 'modele_ge', t.modele_ge, 'reference_article', t.reference_article,
           'code_defaut', t.code_defaut, 'source', t.source);
$function$;

-- Historique chantier / machine : n° de série GE ou UI, modèle GE.
do $do$
declare
  v_def text;
begin
  select pg_get_functiondef('public.hotline_contexte(text, text, text, text, text)'::regprocedure) into v_def;
  v_def := replace(v_def,
    $a$or (v_serie is not null and t.numero_serie ilike '%' || v_serie || '%')$a$,
    $b$or (v_serie is not null and (t.numero_serie ilike '%' || v_serie || '%' or t.serie_ge ilike '%' || v_serie || '%'))$b$);
  v_def := replace(v_def,
    $a$or t.reference_article ilike '%' || v_chant || '%'))$a$,
    $b$or t.reference_article ilike '%' || v_chant || '%' or t.modele_ge ilike '%' || v_chant || '%'))$b$);
  if position('t.serie_ge' in v_def) = 0 or position('t.modele_ge' in v_def) = 0 then
    raise exception 'hotline_contexte : motif de remplacement introuvable';
  end if;
  execute v_def;
end
$do$;

-- Import de l'historique -------------------------------------------------------
create or replace function public.hotline_norm_nom(v text)
returns text
language sql
immutable
as $function$
  select nullif(regexp_replace(
           upper(translate(coalesce(v, ''), 'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),
           '(\mSARL\M|\mSAS\M|\mSASU\M|\mEURL\M|\mSA\M|\mETS\M|\mSTE\M|[^A-Z0-9])', '', 'g'), '');
$function$;

create or replace function public.hotline_gamme_depuis_modeles(p_ge text, p_ui text)
returns text
language sql
immutable
as $function$
  select case
    when m ~ '(^|[^A-Z])(RPI|RAD|RPIM)-' or m ~ 'GAINABLE' then 'GAINABLE'
    when m ~ '(^|[^A-Z])(RWH|RWD|RWM|TAW|HWD|RASM|RAW)-' or m ~ '(YUTAKI|YUTAMPO)' or m ~ 'RAS-[0-9.,]+W?H(V)?N' then 'RO'
    when m ~ '(^|[^A-Z])(RAK|RAC|RAM|RCI|RCIM|RAI|RAF|RPK|RPC|RCD)-' or m ~ 'RAS-[0-9.,]+H' then 'RR'
  end
  from (select upper(coalesce(p_ui, '') || ' ' || coalesce(p_ge, '')) m) s;
$function$;

create or replace function public.hotline_importer_historique(p_lignes jsonb, p_simulation boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
set statement_timeout to '120s'
as $function$
declare
  v_res jsonb;
  v_stats jsonb;
begin
  if lower(coalesce(public.current_user_email(), '')) not in ('valancha@gmail.com', 'a.valanchauskas@cegeclim-energies.com') then
    raise exception 'Import de l''historique réservé à l''administrateur de la hotline.';
  end if;

  drop table if exists pg_temp.h_src;
  create temp table h_src on commit drop as
  select upper(trim(x.ref)) as ref,
         (x.date_creation::timestamp at time zone 'Europe/Paris') as opened_at,
         nullif(trim(x.etat), '') as etat,
         nullif(trim(x.societe), '') as societe,
         nullif(nullif(trim(x.site), ''), 'NC') as site,
         nullif(nullif(nullif(trim(x.contact), ''), 'NC'), 'nc') as contact,
         nullif(trim(x.telephone), '') as telephone,
         public.hotline_tel_cle(x.telephone) as cle,
         nullif(trim(x.hotliner), '') as hotliner,
         nullif(trim(x.nature), '') as nature_src,
         nullif(trim(x.code_defaut), '') as code_defaut,
         nullif(case when upper(trim(x.modele_ge)) in ('', 'NC', 'NR') then null else trim(x.modele_ge) end, '') as modele_ge,
         nullif(case when upper(trim(x.serie_ge)) in ('', 'NC', 'NR') then null else trim(x.serie_ge) end, '') as serie_ge,
         nullif(case when upper(trim(x.modele_ui)) in ('', 'NC', 'NR') then null else trim(x.modele_ui) end, '') as modele_ui,
         nullif(case when upper(trim(x.serie_ui)) in ('', 'NC', 'NR') then null else trim(x.serie_ui) end, '') as serie_ui,
         x.date_mes,
         nullif(trim(x.notes), '') as notes,
         nullif(trim(x.diagnostics), '') as diagnostics,
         nullif(upper(trim(x.code_tiers)), '') as code_tiers
  from jsonb_to_recordset(p_lignes) as x(ref text, date_creation text, etat text, societe text, site text, contact text,
       telephone text, hotliner text, nature text, code_defaut text, modele_ge text, serie_ge text, modele_ui text,
       serie_ui text, date_mes date, notes text, diagnostics text, code_tiers text)
  where coalesce(trim(x.ref), '') <> '' and coalesce(trim(x.date_creation), '') <> '';

  -- Téléphones connus : fiche tiers, contacts SAGE, contacts BLG, carnet hotline
  drop table if exists pg_temp.h_tel;
  create temp table h_tel on commit drop as
  with cles as (select distinct cle from h_src where cle is not null and length(cle) >= 9),
  sources as (
    select public.hotline_tel_cle(t.telephone) as cle, t.numero from public.ref_tiers t
    union all
    select public.hotline_tel_cle(x), c.ct_ctnum from sage.contact c, lateral unnest(array[c.ct_cttelephone, c.ct_cttelportable]) x
    union all
    select public.hotline_tel_cle(x), b.numero_tiers from blg.contacts_tiers_blg b, lateral regexp_split_to_table(coalesce(b.telephones, ''), '[,;/|]') x
    union all
    select h.telephone_cle, h.numero_tiers from public.hotline_contacts h
  )
  select s.cle, array_agg(distinct s.numero) as numeros
  from sources s join cles using (cle)
  where s.numero is not null and s.numero <> ''
  group by s.cle;

  drop table if exists pg_temp.h_nom;
  create temp table h_nom on commit drop as
  select public.hotline_norm_nom(t.intitule) as nom, (array_agg(t.numero))[1] as numero, count(*) as nb
  from public.ref_tiers t
  where public.hotline_norm_nom(t.intitule) in (select public.hotline_norm_nom(societe) from h_src)
  group by 1;

  drop table if exists pg_temp.h_map;
  create temp table h_map on commit drop as
  select s.*,
         null::text as intitule_tiers,
         case
           when s.code_tiers is not null and exists (select 1 from public.ref_tiers r where r.numero = s.code_tiers) then s.code_tiers
           when cardinality(tl.numeros) = 1 then tl.numeros[1]
           when n.nb = 1 then n.numero
         end as numero_tiers,
         case
           when s.code_tiers is not null and exists (select 1 from public.ref_tiers r where r.numero = s.code_tiers) then 'FICHIER'
           when s.code_tiers is not null then 'CODE_FICHIER_INCONNU'
           when cardinality(tl.numeros) = 1 then 'TELEPHONE'
           when n.nb = 1 then 'NOM'
           when cardinality(tl.numeros) > 1 then 'TELEPHONE_AMBIGU'
           else 'AUCUN'
         end as methode,
         array_to_string(tl.numeros[1:5], ', ') as candidats,
         case
           when s.nature_src is null then null
           when upper(s.nature_src) like 'D_PANNAGE%' then 'DEPANNAGE'
           when upper(s.nature_src) like 'QUESTION%' then 'QUESTION_TECHNIQUE'
           when upper(s.nature_src) like '%GARANTIE%' then 'DEMANDE_GARANTIE'
           when upper(s.nature_src) like '%DEVIS%' then 'DEMANDE_DEVIS'
           when upper(s.nature_src) like '%PI_CE%' then 'LIVRAISON_PIECE'
           when upper(s.nature_src) like 'ASSISTANCE%' then 'ASSISTANCE'
           else 'AUTRE'
         end as nature,
         public.hotline_gamme_depuis_modeles(s.modele_ge, s.modele_ui) as gamme,
         case
           when s.etat ilike 'en cours%' then 'EN_COURS'
           when s.etat ilike 'a rappeler%' or s.etat ilike 'à rappeler%' then 'EN_COURS'
           else 'CLOS'
         end as statut,
         exists (select 1 from public.hotline_tickets t where t.numero = s.ref) as existe
  from h_src s
  left join h_tel tl on tl.cle = s.cle
  left join h_nom n on n.nom = public.hotline_norm_nom(s.societe);

  update h_map m set intitule_tiers = r.intitule from public.ref_tiers r where r.numero = m.numero_tiers and m.numero_tiers is not null;

  select jsonb_build_object(
           'lignes', count(*),
           'nouveaux', count(*) filter (where not existe),
           'deja_importes', count(*) filter (where existe),
           'par_telephone', count(*) filter (where methode = 'TELEPHONE'),
           'par_nom', count(*) filter (where methode = 'NOM'),
           'par_fichier', count(*) filter (where methode = 'FICHIER'),
           'ambigus', count(*) filter (where methode = 'TELEPHONE_AMBIGU'),
           'non_trouves', count(*) filter (where methode in ('AUCUN', 'CODE_FICHIER_INCONNU')),
           'ouverts', count(*) filter (where statut <> 'CLOS'))
  into v_stats from h_map;

  if not p_simulation then
    insert into public.hotline_tickets as t (
      numero, filiere, motif, gamme, statut, niveau, source, telephone_appelant, numero_tiers, intitule_tiers, contact_nom,
      chantier, numero_serie, reference_article, modele_ge, serie_ge, code_defaut, date_mes, nature, description,
      ouvert_par, assigne_a, opened_at, updated_at)
    select m.ref, 'THERMIQUE', case when m.nature = 'DEPANNAGE' then 'EXPLOITATION' end, m.gamme, m.statut, 1, 'IMPORT',
           m.telephone, m.numero_tiers, coalesce(m.intitule_tiers, m.societe), m.contact,
           m.site, m.serie_ui, m.modele_ui, m.modele_ge, m.serie_ge, m.code_defaut, m.date_mes, m.nature, m.notes,
           coalesce(m.hotliner, 'import'), m.hotliner, m.opened_at, now()
    from h_map m
    on conflict (numero) do update set
      gamme = excluded.gamme, statut = case when t.source = 'IMPORT' then excluded.statut else t.statut end,
      telephone_appelant = excluded.telephone_appelant, numero_tiers = excluded.numero_tiers,
      intitule_tiers = excluded.intitule_tiers, contact_nom = excluded.contact_nom, chantier = excluded.chantier,
      numero_serie = excluded.numero_serie, reference_article = excluded.reference_article,
      modele_ge = excluded.modele_ge, serie_ge = excluded.serie_ge, code_defaut = excluded.code_defaut,
      date_mes = excluded.date_mes, nature = excluded.nature, description = excluded.description,
      opened_at = excluded.opened_at, updated_at = now()
    where t.source = 'IMPORT';

    -- Étapes de l'historique (recréées à chaque import)
    delete from public.hotline_ticket_etapes e
    using public.hotline_tickets t, h_map m
    where e.ticket_id = t.id and t.numero = m.ref and t.source = 'IMPORT' and coalesce(e.details->>'import', '') = 'true';

    insert into public.hotline_ticket_etapes (ticket_id, at, auteur, type, libelle, details)
    select t.id, m.opened_at, coalesce(m.hotliner, 'import'), 'OUVERTURE',
           format('Ticket %s repris de l''ancien outil de ticketing%s%s', m.ref,
                  case when m.nature_src is not null then ' · ' || m.nature_src else '' end,
                  case when m.hotliner is not null then ' · hotliner ' || m.hotliner else '' end),
           jsonb_build_object('import', true, 'societe', m.societe, 'methode_client', m.methode, 'etat', m.etat)
    from h_map m join public.hotline_tickets t on t.numero = m.ref and t.source = 'IMPORT';

    insert into public.hotline_ticket_etapes (ticket_id, at, auteur, type, libelle, details)
    select t.id, m.opened_at + interval '1 second', coalesce(m.hotliner, 'import'), 'COMMENTAIRE',
           'Diagnostic : ' || m.diagnostics, jsonb_build_object('import', true)
    from h_map m join public.hotline_tickets t on t.numero = m.ref and t.source = 'IMPORT'
    where m.diagnostics is not null;

    insert into public.hotline_ticket_etapes (ticket_id, at, auteur, type, libelle, details)
    select t.id, m.opened_at + interval '2 seconds', coalesce(m.hotliner, 'import'), 'COMMENTAIRE',
           'État dans l''ancien outil : ' || m.etat, jsonb_build_object('import', true)
    from h_map m join public.hotline_tickets t on t.numero = m.ref and t.source = 'IMPORT'
    where m.etat is not null and m.statut <> 'CLOS';

    insert into public.hotline_ticket_etapes (ticket_id, at, auteur, type, libelle, details)
    select t.id, m.opened_at + interval '3 seconds', coalesce(m.hotliner, 'import'), 'CLOTURE',
           'Ticket terminé dans l''ancien outil', jsonb_build_object('import', true)
    from h_map m join public.hotline_tickets t on t.numero = m.ref and t.source = 'IMPORT'
    where m.statut = 'CLOS';

    -- Carnet : téléphones encore inconnus, dernier client et contact connus
    insert into public.hotline_contacts as c (telephone_cle, telephone, numero_tiers, intitule_tiers, contact_nom, nb_appels, dernier_appel, updated_by)
    select distinct on (m.cle) m.cle, m.telephone, m.numero_tiers, coalesce(m.intitule_tiers, m.societe), m.contact,
           count(*) over (partition by m.cle), max(m.opened_at) over (partition by m.cle), 'import historique'
    from h_map m
    where m.cle is not null and length(m.cle) >= 9
    order by m.cle, m.opened_at desc
    on conflict (telephone_cle) do nothing;
  end if;

  select jsonb_build_object('ok', true, 'simulation', p_simulation, 'stats', v_stats,
           'lignes', coalesce(jsonb_agg(jsonb_build_object(
             'ref', ref, 'date', opened_at, 'societe', societe, 'telephone', telephone,
             'numero_tiers', numero_tiers, 'intitule_tiers', intitule_tiers, 'methode', methode, 'candidats', candidats,
             'nature', nature, 'gamme', gamme, 'statut', statut, 'existe', existe) order by opened_at desc), '[]'::jsonb))
  into v_res from h_map;
  return v_res;
end
$function$;

revoke all on function public.hotline_importer_historique(jsonb, boolean) from public, anon;
grant execute on function public.hotline_importer_historique(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

-- Correctif (04/11/2026) : modèles saisis avec un espace (« RAM 90 QH5 », « TAW 270 RHD »).
create or replace function public.hotline_gamme_depuis_modeles(p_ge text, p_ui text)
returns text
language sql
immutable
as $function$
  select case
    when m ~ '(^|[^A-Z])(RPI|RAD|RPIM)[- ]?[0-9]' or m ~ 'GAINABLE' then 'GAINABLE'
    when m ~ '(^|[^A-Z])(RWH|RWD|RWM|TAW|HWD|RASM|RAW)[- ]?[0-9]' or m ~ '(YUTAKI|YUTAMPO)' or m ~ 'RAS[- ]?[0-9.,]+ ?W?H(V)?N' then 'RO'
    when m ~ '(^|[^A-Z])(RAK|RAC|RAM|RCI|RCIM|RAI|RAF|RPK|RPC|RCD)[- ]?[0-9]' or m ~ 'RAS[- ]?[0-9.,]+ ?H' then 'RR'
  end
  from (select upper(coalesce(p_ui, '') || ' ' || coalesce(p_ge, '')) m) s;
$function$;
