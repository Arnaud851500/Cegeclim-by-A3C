-- =============================================================================
-- 20261119h_tarifs_fournisseurs_appariement.sql — corrections du 19/11/2026 (10h)
-- -----------------------------------------------------------------------------
-- Constat sur le 1er dépôt (tarif Aspen 2027) : 0 / 1 017 lignes appariées, car
-- le fournisseur deviné à partir des noms du fichier était CEGECLIM (C0003F),
-- cité en en-tête (« SOCIETE : CEGECLIM »), et non ASPEN PUMPS (A0028F).
--  1. tarif_deviner_fournisseur(refs) : fournisseur SAGE qui porte le plus de
--     références fournisseur du fichier (utilisé au dépôt et dans l'écran) ;
--  2. update_tarif_proposition accepte « fournisseur » (changement de
--     fournisseur d'une proposition déjà déposée → appariement relancé) ;
--  3. appariement : niveau supplémentaire « ref_alnum » (mêmes lettres et
--     chiffres, ponctuation ignorée : ES6 ↔ ES-6) ;
--  4. correction de la proposition n° 1 (rattachée à A0028F, ré-appariée).
-- =============================================================================

create or replace function public.tarif_norm_alnum(p text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(coalesce(public.tarif_norm_ref_sans_obs(p), ''), '[^A-Z0-9]', '', 'g'), '');
$$;

-- 1. Fournisseur le plus probable d'une liste de références --------------------------
create or replace function public.tarif_deviner_fournisseur(p_refs text[])
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  with r as (
    select distinct public.tarif_norm_ref_sans_obs(x) as rf from unnest(coalesce(p_refs, array[]::text[])) x
    where public.tarif_norm_ref_sans_obs(x) is not null
  ),
  m as (
    select upper(trim(f.ct_num)) as ct_num, count(distinct r.rf) as nb
    from r join sage.article_fournisseur f on public.tarif_norm_ref_sans_obs(f.af_reffourniss) = r.rf
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('fournisseur', m.ct_num, 'nom', t.ct_intitule, 'nb', m.nb, 'sur', (select count(*) from r)) order by m.nb desc), '[]'::jsonb)
    into v
  from (select * from m order by nb desc limit 5) m
  left join sage.tiers_complet t on upper(trim(t.ct_num)) = m.ct_num;
  return v;
end;
$$;
grant execute on function public.tarif_deviner_fournisseur(text[]) to authenticated;

-- 2. Mise à jour d'une proposition, y compris son fournisseur ------------------------
create or replace function public.update_tarif_proposition(p_id bigint, p jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
declare v_old text;
begin
  if not public.tarif_peut_acceder() then
    raise exception 'Accès refusé (droit Appro requis)';
  end if;
  select fournisseur into v_old from public.tarif_propositions where id = p_id;
  update public.tarif_propositions set
    fournisseur     = case when p ? 'fournisseur' and coalesce(trim(p->>'fournisseur'), '') <> '' then upper(trim(p->>'fournisseur')) else fournisseur end,
    fournisseur_nom = case when p ? 'fournisseur' and coalesce(trim(p->>'fournisseur'), '') <> ''
                           then (select ct_intitule from sage.tiers_complet where upper(trim(ct_num)) = upper(trim(p->>'fournisseur')) limit 1)
                           else fournisseur_nom end,
    libelle     = case when p ? 'libelle'     then p->>'libelle'                        else libelle end,
    statut      = case when p ? 'statut'      then p->>'statut'                         else statut end,
    commentaire = case when p ? 'commentaire' then p->>'commentaire'                    else commentaire end,
    date_effet  = case when p ? 'date_effet'  then nullif(p->>'date_effet', '')::date   else date_effet end,
    date_fin    = case when p ? 'date_fin'    then nullif(p->>'date_fin', '')::date     else date_fin end,
    resume      = case when p ? 'resume'      then p->'resume'
                       when p ? 'fournisseur' then null                                 else resume end,
    modifie_le  = now(),
    modifie_par = public.current_user_email()
  where id = p_id;
  if p ? 'fournisseur' and upper(trim(p->>'fournisseur')) is distinct from v_old then
    update public.tarif_proposition_lignes
       set appariement_manuel = false, reference_article = null, appariement = null, nb_candidats = null
     where proposition_id = p_id;
    perform public.tarif_apparier(p_id);
  end if;
end;
$$;

-- 3. Appariement avec le niveau « ref_alnum » --------------------------------------------
create or replace function public.tarif_apparier(p_id bigint)
returns integer
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '60s'
as $$
declare
  v_frs text;
  v_n integer;
begin
  select upper(trim(fournisseur)) into v_frs from public.tarif_propositions where id = p_id;
  if v_frs is null then
    raise exception 'Proposition % introuvable', p_id;
  end if;

  with af as (
    select upper(trim(f.ar_ref)) as ar_ref,
           public.tarif_norm_ref(f.af_reffourniss) as rf,
           public.tarif_norm_ref_sans_obs(f.af_reffourniss) as rf_obs,
           public.tarif_norm_alnum(f.af_reffourniss) as rf_alnum,
           public.tarif_norm_ref(f.af_codebarre) as ean_af,
           public.tarif_norm_ref(b.ar_codebarre) as ean_ar,
           coalesce(a.art_sommeil, '') <> 'En sommeil' as actif,
           f.af_principal = '1' as principal
    from sage.article_fournisseur f
    left join sage.articles a on a.art_num = f.ar_ref
    left join sage.article_bis b on b.ar_ref = f.ar_ref
    where upper(trim(f.ct_num)) = v_frs
  ),
  l as (
    select id, public.tarif_norm_ref(ref_fournisseur) as rf, public.tarif_norm_alnum(ref_fournisseur) as rf_alnum,
           public.tarif_norm_ref(ean) as ean
    from public.tarif_proposition_lignes
    where proposition_id = p_id and not appariement_manuel
  ),
  candidats as (
    select l.id, af.ar_ref, 1 as niveau, 'ref_fournisseur' as mode, af.actif, af.principal
      from l join af on af.rf = l.rf
    union all
    select l.id, af.ar_ref, 2, 'ref_obsolete', af.actif, af.principal
      from l join af on af.rf_obs = public.tarif_norm_ref_sans_obs(l.rf) and af.rf is distinct from l.rf
    union all
    select l.id, af.ar_ref, 3, 'ref_alnum', af.actif, af.principal
      from l join af on length(l.rf_alnum) >= 3 and af.rf_alnum = l.rf_alnum
    union all
    select l.id, upper(trim(a.art_num)), 4, 'reference', coalesce(a.art_sommeil, '') <> 'En sommeil', false
      from l join sage.articles a on public.tarif_norm_ref(a.art_num) = l.rf
    union all
    select l.id, af.ar_ref, 5, 'ean', af.actif, af.principal
      from l join af on l.ean is not null and length(l.ean) >= 8 and (af.ean_af = l.ean or af.ean_ar = l.ean)
  ),
  meilleur_niveau as (
    select id, min(niveau) as niveau from candidats group by id
  ),
  choix as (
    select distinct on (c.id) c.id, c.ar_ref, c.mode,
           count(*) over (partition by c.id) as nb
    from candidats c
    join meilleur_niveau m on m.id = c.id and m.niveau = c.niveau
    order by c.id, c.actif desc, c.principal desc, c.ar_ref
  )
  update public.tarif_proposition_lignes t
     set reference_article = ch.ar_ref,
         appariement       = ch.mode,
         nb_candidats      = ch.nb
    from (select l.id, ch.ar_ref, ch.mode, ch.nb from l left join choix ch on ch.id = l.id) ch
   where t.id = ch.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.tarif_apparier(bigint) from public, anon, authenticated;

-- 4. Proposition n° 1 (Aspen 2027 rattachée par erreur à CEGECLIM) ------------------------
update public.tarif_propositions
   set fournisseur = 'A0028F',
       fournisseur_nom = (select ct_intitule from sage.tiers_complet where ct_num = 'A0028F'),
       resume = null
 where id = 1 and fournisseur = 'C0003F';
select public.tarif_apparier(1);
