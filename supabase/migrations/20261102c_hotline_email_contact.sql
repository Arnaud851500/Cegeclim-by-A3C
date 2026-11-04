-- ============================================================================
-- 20261102c_hotline_email_contact.sql — Hotline : adresse e-mail du contact
-- (02/11/2026, demande d'Arnaud : document envoyé en pièce jointe, adresse du
-- contact pré-remplie)
-- ----------------------------------------------------------------------------
-- - hotline_tickets.contact_email et hotline_contacts.email (carnet hotline,
--   mémorisé à l'ouverture / mise à jour du ticket comme le reste du contact).
-- - hotline_identifier_appelant renvoie l'e-mail : carnet hotline, contact
--   SAGE (CT_EMail), contact BLG, sinon e-mail de la fiche tiers SAGE.
-- - hotline_rechercher_tiers renvoie l'e-mail de la fiche tiers.
-- ============================================================================

alter table public.hotline_tickets  add column if not exists contact_email text;
alter table public.hotline_contacts add column if not exists email text;

create or replace function public.hotline_ticket_memoriser_contact()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cle text := public.hotline_tel_cle(new.telephone_appelant);
begin
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

create or replace function public.hotline_identifier_appelant(p_telephone text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cle text := public.hotline_tel_cle(p_telephone);
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if v_cle is null or length(v_cle) < 9 then
    return '[]'::jsonb;
  end if;

  with m as (
    select 0 as rang, 'Hotline'::text as source, h.numero_tiers, coalesce(h.intitule_tiers, t.intitule) as intitule, h.contact_nom as contact,
           h.telephone, t.ville, t.agence_rattachement as agence, t.representant,
           coalesce(nullif(h.email, ''), nullif(t.email, '')) as email
    from public.hotline_contacts h
    left join public.ref_tiers t on t.numero = h.numero_tiers
    where h.telephone_cle = v_cle
    union all
    select 1, 'SAGE fiche tiers', t.numero, t.intitule, nullif(t.contact, ''),
           t.telephone, t.ville, t.agence_rattachement, t.representant, nullif(t.email, '')
    from public.ref_tiers t
    where public.hotline_tel_cle(t.telephone) = v_cle
    union all
    select 2, 'SAGE contact', c.ct_ctnum, t.intitule, trim(concat_ws(' ', c.ct_ctprenom, c.ct_ctnom)),
           coalesce(nullif(c.ct_cttelportable, ''), c.ct_cttelephone), t.ville, t.agence_rattachement, t.representant,
           coalesce(nullif(c.ct_ctemail, ''), nullif(t.email, ''))
    from sage.contact c
    left join public.ref_tiers t on t.numero = c.ct_ctnum
    where public.hotline_tel_cle(c.ct_cttelephone) = v_cle or public.hotline_tel_cle(c.ct_cttelportable) = v_cle
    union all
    select 3, 'BLG contact', b.numero_tiers, t.intitule, b.nom_complet, b.telephones, t.ville, t.agence_rattachement, t.representant,
           coalesce(nullif(trim(split_part(regexp_replace(coalesce(b.emails, ''), '[;,|/ ]+', ',', 'g'), ',', 1)), ''), nullif(t.email, ''))
    from blg.contacts_tiers_blg b
    left join public.ref_tiers t on t.numero = b.numero_tiers
    where exists (
      select 1 from regexp_split_to_table(coalesce(b.telephones, ''), '[,;/|]') x
      where public.hotline_tel_cle(x) = v_cle
    )
  ),
  d as (
    select distinct on (source, coalesce(numero_tiers, ''), coalesce(contact, '')) *
    from m
    order by source, coalesce(numero_tiers, ''), coalesce(contact, ''), rang
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', source, 'numero_tiers', numero_tiers, 'intitule', intitule, 'contact', contact,
           'telephone', telephone, 'ville', ville, 'agence', agence, 'representant', representant,
           'email', lower(trim(email))) order by rang), '[]'::jsonb)
  into v_res
  from (select * from d order by rang limit 20) d;

  return v_res;
end
$function$;

create or replace function public.hotline_rechercher_tiers(p_q text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_res jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;
  if v_q is null or length(v_q) < 2 then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'numero_tiers', numero, 'intitule', intitule, 'ville', ville, 'code_postal', code_postal,
           'agence', agence_rattachement, 'telephone', telephone, 'email', lower(nullif(trim(email), ''))) order by rang, intitule), '[]'::jsonb)
  into v_res
  from (
    select t.*,
           case when upper(t.numero) = upper(v_q) then 0
                when t.numero ilike v_q || '%' then 1
                when t.intitule ilike v_q || '%' then 2
                else 3 end as rang
    from public.ref_tiers t
    where coalesce(t.mise_en_sommeil, false) = false
      and (t.numero ilike v_q || '%' or t.intitule ilike '%' || v_q || '%' or t.abrege ilike '%' || v_q || '%')
    order by rang, t.intitule
    limit 12
  ) s;

  return v_res;
end
$function$;

notify pgrst, 'reload schema';
