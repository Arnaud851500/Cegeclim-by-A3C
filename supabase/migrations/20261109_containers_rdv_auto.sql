-- ============================================================================
-- 20261109_containers_rdv_auto.sql — Portefeuille CDF / containers (09/11/2026)
-- ----------------------------------------------------------------------------
-- 1. RDV de déchargement FMS mis à jour automatiquement depuis SAGE.
--    - appro_rdv_fms_sage() lit aussi les lignes de décalage sans le mot
--      « livraison » (« Décalée au 19.11 suite grève port selon @Hitachi/FMS »,
--      « Reportée au … », « Avancée au … »), en écartant les lignes d'arrivée
--      au port / d'expédition (« Arrivée FOS décalée 07.11 », « Expé … »).
--    - appro_rdv_fms_sync_sage() : quand la date (ou l'heure, ou le texte) du
--      dernier RDV lu dans SAGE change, une ligne est ajoutée dans
--      appro_cdf_rdv_fms (created_by = 'auto-sage', commentaire « SAGE : … »).
--      La dernière information l'emporte : une nouvelle info SAGE remplace une
--      saisie plus ancienne ; une saisie faite après reste en vigueur tant que
--      SAGE ne change pas.
--    - pg_cron « appro-rdv-fms-sync-sage » : toutes les heures (après les
--      imports SAGE).
-- 2. Bouton « Lancer la mise à jour Claude des dates de containers » :
--    - appro_container_maj_acces : comptes autorisés (Arnaud, Julien, Lydia) ;
--    - appro_container_maj_demandes : demandes, traitées par la tâche planifiée
--      Claude « Relevé containers » (relevé MSC / CMA CGM / HMM dans Chrome,
--      chaque matin en semaine + demandes en attente) ;
--    - RPC appro_container_maj_etat() / appro_container_maj_demander().
-- ============================================================================

-- 1. Extraction du RDV FMS dans les commentaires SAGE -------------------------
create or replace function public.appro_rdv_fms_sage()
returns table(cdf_numero text, rdv_date date, rdv_heure time without time zone, texte text, dl_ligne integer)
language plpgsql
stable security definer
set search_path to 'public', 'sage'
as $function$
declare
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  r record;
  m text[];
  h text[];
  d date;
  an integer;
begin
  for r in
    select c.do_piece, c.dl_ligne, c.dl_design
    from sage.bdcf_commentaires c
    where c.dl_design ~* '(livraison|livrer|rdv|rendez|d[ée]cal|report|avanc)'
      and c.dl_design !~* 'estim'
    order by c.do_piece, c.dl_ligne
  loop
    m := null;
    m := regexp_match(r.dl_design, '(?:livraison\s+(?:le|confirm\w*(?:\s+le)?|pr[ée]vue\s+le|fix[ée]e\s+(?:au|le)|d[ée]cal[ée]e\s+(?:au|le)|report[ée]e\s+(?:au|le)|avanc[ée]e\s+(?:au|le))|rdv(?:\s+fms)?(?:\s+le)?|rendez-vous(?:\s+le)?)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', 'i');
    if m is null and r.dl_design ~* 'ok\s+fms' then
      m := regexp_match(r.dl_design, 'livrer\s+(?:le\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', 'i');
    end if;
    -- 09/11/2026 : ligne de décalage du RDV sans le mot « livraison » (« Décalée au 19.11 suite grève port »),
    -- hors lignes d'arrivée au port ou d'expédition.
    if m is null and r.dl_design !~* '(arriv|\yfos\y|exp[ée]|charg|d[ée]part|bateau|navire|etd|eta)' then
      m := regexp_match(r.dl_design, '^\W*(?:livraison\s+)?(?:d[ée]cal[ée]e?s?|report[ée]e?s?|avanc[ée]e?s?)\s+(?:au|le|à)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', 'i');
    end if;
    continue when m is null;
    begin
      if m[3] is not null then
        an := m[3]::int; if an < 100 then an := an + 2000; end if;
      else
        an := extract(year from v_auj)::int;
      end if;
      d := make_date(an, m[2]::int, m[1]::int);
      if m[3] is null and d < v_auj - 180 then d := make_date(an + 1, m[2]::int, m[1]::int); end if;
      if m[3] is null and d > v_auj + 185 then d := make_date(an - 1, m[2]::int, m[1]::int); end if;
    exception when others then
      continue;
    end;
    h := regexp_match(r.dl_design, '(?:à|a)\s*(\d{1,2})\s*h\s*(\d{2})?', 'i');
    cdf_numero := r.do_piece; rdv_date := d; texte := r.dl_design; dl_ligne := r.dl_ligne;
    rdv_heure := case when h is not null and h[1]::int between 0 and 23 then make_time(h[1]::int, coalesce(h[2], '0')::int, 0) end;
    return next;
  end loop;
end $function$;

-- 2. Synchro automatique SAGE → RDV du compagnon -------------------------------
create or replace function public.appro_rdv_fms_sync_sage()
returns integer
language plpgsql
security definer
set search_path to 'public', 'sage'
as $function$
declare
  v_n integer;
begin
  with sage_rdv as (
    select s.cdf_numero, s.rdv_date, s.rdv_heure, 'SAGE : ' || btrim(s.texte) as commentaire
    from public.v_appro_cdf_rdv_fms_sage s
    where exists (select 1 from sage.bdcf b where b.al_docnum = s.cdf_numero and b.al_doctype = '12')
  ),
  dernier_auto as (
    select distinct on (r.cdf_numero) r.cdf_numero, r.rdv_date, r.rdv_heure, r.commentaire
    from public.appro_cdf_rdv_fms r
    where r.created_by = 'auto-sage'
    order by r.cdf_numero, r.created_at desc, r.id desc
  ),
  container as (
    select distinct on (c.cdf_numero) c.cdf_numero, c.container_numero
    from public.appro_container_releves c
    where c.container_numero is not null
    order by c.cdf_numero, c.created_at desc, c.id desc
  ),
  ins as (
    insert into public.appro_cdf_rdv_fms (cdf_numero, container_numero, rdv_date, rdv_heure, commentaire, created_by)
    select s.cdf_numero, c.container_numero, s.rdv_date, s.rdv_heure, s.commentaire, 'auto-sage'
    from sage_rdv s
    left join dernier_auto a on a.cdf_numero = s.cdf_numero
    left join container c on c.cdf_numero = s.cdf_numero
    where a.cdf_numero is null
       or a.rdv_date is distinct from s.rdv_date
       or a.rdv_heure is distinct from s.rdv_heure
       or a.commentaire is distinct from s.commentaire
    returning 1
  )
  select count(*) into v_n from ins;
  return v_n;
end $function$;

revoke all on function public.appro_rdv_fms_sync_sage() from public, anon;
grant execute on function public.appro_rdv_fms_sync_sage() to authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'appro-rdv-fms-sync-sage') then
    perform cron.unschedule('appro-rdv-fms-sync-sage');
  end if;
  perform cron.schedule('appro-rdv-fms-sync-sage', '25 * * * *', 'select public.appro_rdv_fms_sync_sage();');
end $$;

-- 3. Demandes de relevé Claude des containers ----------------------------------
create table if not exists public.appro_container_maj_acces (
  email text primary key,
  nom text
);
insert into public.appro_container_maj_acces (email, nom) values
  ('a.valanchauskas@cegeclim-energies.com', 'Arnaud'),
  ('j.ithurbide@cegeclim-energies.com', 'Julien'),
  ('l.duval@cegeclim-energies.com', 'Lydia')
on conflict (email) do update set nom = excluded.nom;
alter table public.appro_container_maj_acces enable row level security;
drop policy if exists appro_container_maj_acces_lecture on public.appro_container_maj_acces;
create policy appro_container_maj_acces_lecture on public.appro_container_maj_acces for select to authenticated using (true);

create table if not exists public.appro_container_maj_demandes (
  id bigserial primary key,
  demande_par text not null default lower(auth.jwt() ->> 'email'),
  demande_le timestamptz not null default now(),
  statut text not null default 'EN_ATTENTE' check (statut in ('EN_ATTENTE', 'EN_COURS', 'TERMINEE', 'ECHEC', 'ANNULEE')),
  traitee_le timestamptz,
  resultat text
);
create index if not exists idx_appro_container_maj_demandes_statut on public.appro_container_maj_demandes (statut, demande_le);
alter table public.appro_container_maj_demandes enable row level security;
drop policy if exists appro_container_maj_demandes_lecture on public.appro_container_maj_demandes;
create policy appro_container_maj_demandes_lecture on public.appro_container_maj_demandes for select to authenticated using (true);

create or replace function public.appro_container_maj_autorise()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.appro_container_maj_acces a where lower(a.email) = lower(auth.jwt() ->> 'email'))
$function$;

-- État affiché à côté du bouton : droit, demande en cours, dernier relevé Claude.
create or replace function public.appro_container_maj_etat()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'autorise', public.appro_container_maj_autorise(),
    'en_attente', (select to_jsonb(d) from public.appro_container_maj_demandes d
                   where d.statut in ('EN_ATTENTE', 'EN_COURS') order by d.demande_le desc limit 1),
    'derniere', (select to_jsonb(d) from public.appro_container_maj_demandes d
                 where d.statut in ('TERMINEE', 'ECHEC') order by coalesce(d.traitee_le, d.demande_le) desc limit 1),
    'dernier_releve_claude', (select max(r.created_at) from public.appro_container_releves r
                              where r.created_by ilike '%claude%')
  )
$function$;

create or replace function public.appro_container_maj_demander()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existante public.appro_container_maj_demandes;
  v_nouvelle public.appro_container_maj_demandes;
begin
  if not public.appro_container_maj_autorise() then
    raise exception 'Mise à jour Claude des containers réservée à Arnaud, Julien et Lydia.';
  end if;
  select * into v_existante from public.appro_container_maj_demandes
  where statut in ('EN_ATTENTE', 'EN_COURS') order by demande_le desc limit 1;
  if found then
    return jsonb_build_object('deja', true, 'demande', to_jsonb(v_existante));
  end if;
  insert into public.appro_container_maj_demandes (demande_par) values (lower(auth.jwt() ->> 'email'))
  returning * into v_nouvelle;
  return jsonb_build_object('deja', false, 'demande', to_jsonb(v_nouvelle));
end
$function$;

revoke all on function public.appro_container_maj_demander() from public, anon;
grant execute on function public.appro_container_maj_demander() to authenticated;
grant execute on function public.appro_container_maj_etat() to authenticated;
grant execute on function public.appro_container_maj_autorise() to authenticated;

-- 4. Première synchro -----------------------------------------------------------
select public.appro_rdv_fms_sync_sage();
