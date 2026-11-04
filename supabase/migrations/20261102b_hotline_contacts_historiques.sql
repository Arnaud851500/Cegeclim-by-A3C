-- ============================================================================
-- 20261102b_hotline_contacts_historiques.sql — Hotline : contacts, historiques,
-- aide à la saisie du client (02/11/2026, retours d'Arnaud après test)
-- ----------------------------------------------------------------------------
-- 1. hotline_contacts : annuaire propre à la hotline. À l'ouverture d'un ticket,
--    le numéro de l'appelant est enregistré avec le client et le nom du contact
--    (trigger sur hotline_tickets) : au prochain appel du même numéro, la
--    console pré-remplit les champs, même si le numéro est inconnu de SAGE et BLG.
-- 2. hotline_identifier_appelant : cherche d'abord dans hotline_contacts
--    (source « Hotline »), puis SAGE et BLG comme avant.
-- 3. hotline_contexte : trois historiques distincts
--      tickets_client   → même code tiers,
--      tickets_contact  → même numéro appelant (ou même contact chez ce client),
--      tickets_chantier → même chantier ou même n° de série / machine.
--    La clé « tickets » est conservée (= historique client) pour compatibilité.
-- 4. hotline_rechercher_tiers(q) : aide à la saisie du client par code tiers
--    ou par nom (ref_tiers, 12 résultats).
-- ============================================================================

-- 1. Annuaire des contacts hotline ---------------------------------------------
create table if not exists public.hotline_contacts (
  telephone_cle   text primary key,          -- 9 derniers chiffres
  telephone       text not null,
  numero_tiers    text,
  intitule_tiers  text,
  contact_nom     text,
  nb_appels       integer not null default 1,
  premier_appel   timestamptz not null default now(),
  dernier_appel   timestamptz not null default now(),
  updated_by      text
);
create index if not exists hotline_contacts_tiers_idx on public.hotline_contacts(numero_tiers);

alter table public.hotline_contacts enable row level security;
drop policy if exists hotline_contacts_acces on public.hotline_contacts;
create policy hotline_contacts_acces on public.hotline_contacts for all to authenticated
  using (public.hotline_peut_acceder()) with check (public.hotline_peut_acceder());
grant select, insert, update, delete on public.hotline_contacts to authenticated;

-- Enregistrement automatique à l'ouverture et à la mise à jour d'un ticket :
-- les champs renseignés écrasent les anciens, les champs vides ne les effacent pas.
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
     and coalesce(new.telephone_appelant, '') = coalesce(old.telephone_appelant, '') then
    return new;
  end if;

  insert into public.hotline_contacts as c (telephone_cle, telephone, numero_tiers, intitule_tiers, contact_nom, updated_by)
  values (v_cle, new.telephone_appelant, nullif(trim(new.numero_tiers), ''), nullif(trim(new.intitule_tiers), ''),
          nullif(trim(new.contact_nom), ''), public.current_user_email())
  on conflict (telephone_cle) do update set
    telephone      = excluded.telephone,
    numero_tiers   = coalesce(excluded.numero_tiers, c.numero_tiers),
    intitule_tiers = coalesce(excluded.intitule_tiers, c.intitule_tiers),
    contact_nom    = coalesce(excluded.contact_nom, c.contact_nom),
    nb_appels      = c.nb_appels + case when tg_op = 'INSERT' then 1 else 0 end,
    dernier_appel  = case when tg_op = 'INSERT' then now() else c.dernier_appel end,
    updated_by     = excluded.updated_by;
  return new;
end
$function$;

drop trigger if exists trg_hotline_ticket_memoriser_contact on public.hotline_tickets;
create trigger trg_hotline_ticket_memoriser_contact
  after insert or update on public.hotline_tickets
  for each row execute function public.hotline_ticket_memoriser_contact();

-- Reprise des tickets déjà ouverts (tests du 02/11).
insert into public.hotline_contacts (telephone_cle, telephone, numero_tiers, intitule_tiers, contact_nom, nb_appels, premier_appel, dernier_appel)
select distinct on (public.hotline_tel_cle(t.telephone_appelant))
       public.hotline_tel_cle(t.telephone_appelant), t.telephone_appelant, t.numero_tiers, t.intitule_tiers, t.contact_nom,
       count(*) over (partition by public.hotline_tel_cle(t.telephone_appelant)),
       min(t.opened_at) over (partition by public.hotline_tel_cle(t.telephone_appelant)),
       max(t.opened_at) over (partition by public.hotline_tel_cle(t.telephone_appelant))
from public.hotline_tickets t
where length(coalesce(public.hotline_tel_cle(t.telephone_appelant), '')) = 9
order by public.hotline_tel_cle(t.telephone_appelant), t.opened_at desc
on conflict (telephone_cle) do nothing;

-- 2. Identification : annuaire hotline en premier ---------------------------------
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
           h.telephone, t.ville, t.agence_rattachement as agence, t.representant
    from public.hotline_contacts h
    left join public.ref_tiers t on t.numero = h.numero_tiers
    where h.telephone_cle = v_cle
    union all
    select 1, 'SAGE fiche tiers', t.numero, t.intitule, nullif(t.contact, ''),
           t.telephone, t.ville, t.agence_rattachement, t.representant
    from public.ref_tiers t
    where public.hotline_tel_cle(t.telephone) = v_cle
    union all
    select 2, 'SAGE contact', c.ct_ctnum, t.intitule, trim(concat_ws(' ', c.ct_ctprenom, c.ct_ctnom)),
           coalesce(nullif(c.ct_cttelportable, ''), c.ct_cttelephone), t.ville, t.agence_rattachement, t.representant
    from sage.contact c
    left join public.ref_tiers t on t.numero = c.ct_ctnum
    where public.hotline_tel_cle(c.ct_cttelephone) = v_cle or public.hotline_tel_cle(c.ct_cttelportable) = v_cle
    union all
    select 3, 'BLG contact', b.numero_tiers, t.intitule, b.nom_complet, b.telephones, t.ville, t.agence_rattachement, t.representant
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
           'telephone', telephone, 'ville', ville, 'agence', agence, 'representant', representant) order by rang), '[]'::jsonb)
  into v_res
  from (select * from d order by rang limit 20) d;

  return v_res;
end
$function$;

-- 3. Contexte : trois historiques -----------------------------------------------
drop function if exists public.hotline_contexte(text, text, text, text);
create or replace function public.hotline_contexte(
  p_numero_tiers text default null,
  p_telephone    text default null,
  p_chantier     text default null,
  p_numero_serie text default null,
  p_contact_nom  text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tiers   text := nullif(trim(coalesce(p_numero_tiers, '')), '');
  v_cle     text := public.hotline_tel_cle(p_telephone);
  v_chant   text := nullif(trim(coalesce(p_chantier, '')), '');
  v_serie   text := nullif(trim(coalesce(p_numero_serie, '')), '');
  v_contact text := nullif(trim(coalesce(p_contact_nom, '')), '');
  v_client  jsonb;
  v_contact_tickets jsonb;
  v_chantier jsonb;
  v_docs    jsonb;
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline refusé (droit can_hotline).';
  end if;

  if v_cle is not null and length(v_cle) < 9 then
    v_cle := null;
  end if;

  -- Historique client
  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_client
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where v_tiers is not null and t.numero_tiers = v_tiers
    order by t.opened_at desc limit 15
  ) s;

  -- Historique contact : même numéro, ou même nom de contact chez ce client
  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_contact_tickets
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where (v_cle is not null and public.hotline_tel_cle(t.telephone_appelant) = v_cle)
       or (v_contact is not null and v_tiers is not null and t.numero_tiers = v_tiers and lower(trim(t.contact_nom)) = lower(v_contact))
    order by t.opened_at desc limit 15
  ) s;

  -- Historique chantier / machine
  select coalesce(jsonb_agg(x order by x->>'opened_at' desc), '[]'::jsonb) into v_chantier
  from (
    select public.hotline_ticket_resume(t) x
    from public.hotline_tickets t
    where (v_chant is not null and t.chantier ilike '%' || v_chant || '%')
       or (v_serie is not null and t.numero_serie ilike '%' || v_serie || '%')
    order by t.opened_at desc limit 15
  ) s;

  if v_tiers is null and v_serie is null then
    v_docs := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(d order by d->>'date' desc), '[]'::jsonb) into v_docs
    from (
      select jsonb_build_object(
               'numero_piece', f.numero_piece,
               'numero_bl', max(f.numero_piece_bl),
               'date', max(f.date_facture),
               'numero_tiers', max(f.numero_tiers_entete),
               'reference', max(f.reference),
               'projet', max(f.projet),
               'montant_ht', round(sum(f.montant_ht)::numeric, 2),
               'articles', (array_agg(distinct coalesce(nullif(f.designation_article, ''), f.designation)
                              order by coalesce(nullif(f.designation_article, ''), f.designation)))[1:6],
               'series', array_remove(array_agg(distinct nullif(f.numero_serie_lot, '')), null)
             ) d
      from public.facture_lignes f
      where (v_tiers is null or f.numero_tiers_entete = v_tiers)
        and (v_chant is null or f.reference ilike '%' || v_chant || '%' or f.projet ilike '%' || v_chant || '%')
        and (v_serie is null or f.numero_serie_lot ilike '%' || v_serie || '%')
        and f.date_facture >= current_date - interval '36 months'
      group by f.numero_piece
      order by max(f.date_facture) desc
      limit 25
    ) s;
  end if;

  return jsonb_build_object(
    'tickets', v_client,
    'tickets_client', v_client,
    'tickets_contact', v_contact_tickets,
    'tickets_chantier', v_chantier,
    'documents', v_docs
  );
end
$function$;

create or replace function public.hotline_ticket_resume(t public.hotline_tickets)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object('id', t.id, 'numero', t.numero, 'filiere', t.filiere, 'motif', t.motif,
           'statut', t.statut, 'niveau', t.niveau, 'opened_at', t.opened_at, 'description', t.description,
           'preconisation', t.preconisation, 'chantier', t.chantier, 'numero_serie', t.numero_serie,
           'contact_nom', t.contact_nom, 'intitule_tiers', t.intitule_tiers, 'numero_tiers', t.numero_tiers);
$function$;

-- 4. Aide à la saisie du client ---------------------------------------------------
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
           'agence', agence_rattachement, 'telephone', telephone) order by rang, intitule), '[]'::jsonb)
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

grant execute on function public.hotline_contexte(text, text, text, text, text) to authenticated;
grant execute on function public.hotline_rechercher_tiers(text) to authenticated;
grant execute on function public.hotline_ticket_resume(public.hotline_tickets) to authenticated;
