-- ============================================================================
-- 20261114b_hotline_modeles_cas_similaires.sql — Aide à la saisie et au
-- traitement dans la console (14/11/2026, retours d'ergonomie)
-- ----------------------------------------------------------------------------
--  - hotline_modeles_connus(q) : modèles GE / UI dont le nom commence par la
--    saisie (catalogue Hi-Parts + modèles déjà rencontrés dans les tickets) ;
--  - hotline_cas_similaires(...) : tickets résolus proches (même code défaut,
--    même modèle, même marque d'onduleur…) avec la solution apportée, pour la
--    colonne d'aide à droite de la console.
-- ============================================================================

create or replace function public.hotline_modeles_connus(p_q text, p_limite int default 12)
returns table (modele text, type text, source text, n bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_cle text := upper(regexp_replace(coalesce(p_q, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline requis.';
  end if;
  if length(v_cle) < 2 then
    return;
  end if;
  return query
  with tickets as (
    select upper(btrim(t.modele_ge)) as modele, 'GE'::text as type
    from public.hotline_tickets t where coalesce(btrim(t.modele_ge), '') <> ''
    union all
    select upper(btrim(t.reference_article)), 'UI'
    from public.hotline_tickets t where coalesce(btrim(t.reference_article), '') <> ''
  ),
  vus as (
    select x.modele, x.type, count(*) as n
    from tickets x
    where upper(regexp_replace(x.modele, '[^A-Za-z0-9]', '', 'g')) like v_cle || '%'
    group by 1, 2
  ),
  catalogue as (
    select distinct on (p.nom) p.nom as modele, coalesce(nullif(p.type_unite, 'AUTRE'), 'AUTRE') as type
    from public.hiparts_produits p
    where p.nom_cle like v_cle || '%'
  ),
  tout as (
    select coalesce(v.modele, c.modele) as modele,
           coalesce(c.type, v.type) as type,
           case when v.modele is not null and c.modele is not null then 'Hi-Parts · tickets'
                when c.modele is not null then 'Hi-Parts' else 'tickets' end as source,
           coalesce(v.n, 0) as n
    from vus v
    full join catalogue c on c.modele = v.modele
  )
  select t.modele, t.type, t.source, t.n
  from tout t
  order by t.n desc, length(t.modele), t.modele
  limit greatest(coalesce(p_limite, 12), 1);
end
$$;
grant execute on function public.hotline_modeles_connus(text, int) to authenticated;

create or replace function public.hotline_cas_similaires(
  p_filiere text,
  p_code_defaut text default null,
  p_modele_ge text default null,
  p_modele_ui text default null,
  p_onduleur text default null,
  p_marque text default null,
  p_equipement text default null,
  p_exclure uuid default null,
  p_limite int default 6
)
returns table (
  id uuid,
  numero text,
  opened_at timestamptz,
  intitule_tiers text,
  code_defaut text,
  modele text,
  description text,
  solution text,
  raisons text[],
  score int
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text := nullif(upper(btrim(coalesce(p_code_defaut, ''))), '');
  v_ge text := nullif(upper(regexp_replace(coalesce(p_modele_ge, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_ui text := nullif(upper(regexp_replace(coalesce(p_modele_ui, ''), '[^A-Za-z0-9]', '', 'g')), '');
  v_ond text := nullif(upper(regexp_replace(coalesce(p_onduleur, ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  if not public.hotline_peut_acceder() then
    raise exception 'Accès hotline requis.';
  end if;
  if v_code is null and v_ge is null and v_ui is null and v_ond is null and p_equipement is null then
    return;
  end if;
  return query
  with candidats as (
    select t.*,
      (v_code is not null and upper(btrim(coalesce(t.code_defaut, ''))) = v_code) as m_code,
      (v_ge is not null and upper(regexp_replace(coalesce(t.modele_ge, ''), '[^A-Za-z0-9]', '', 'g')) = v_ge) as m_ge,
      (v_ge is not null and length(v_ge) >= 6 and upper(regexp_replace(coalesce(t.modele_ge, ''), '[^A-Za-z0-9]', '', 'g')) like left(v_ge, 6) || '%') as m_ge_famille,
      (v_ui is not null and upper(regexp_replace(coalesce(t.reference_article, ''), '[^A-Za-z0-9]', '', 'g')) = v_ui) as m_ui,
      (v_ond is not null and upper(regexp_replace(coalesce(t.onduleur_modele, ''), '[^A-Za-z0-9]', '', 'g')) = v_ond) as m_ond,
      (p_marque is not null and t.pv_marque = p_marque) as m_marque,
      (p_equipement is not null and t.pv_equipement = p_equipement) as m_equip
    from public.hotline_tickets t
    where t.statut = 'RESOLU'
      and not t.est_test
      and t.filiere = p_filiere
      and (p_exclure is null or t.id <> p_exclure)
  ),
  notes as (
    select c.*,
      (case when c.m_code then 5 else 0 end
       + case when c.m_ge then 4 when c.m_ge_famille then 2 else 0 end
       + case when c.m_ui then 3 else 0 end
       + case when c.m_ond then 4 else 0 end
       + case when c.m_equip then 2 when c.m_marque then 1 else 0 end)::int as note
    from candidats c
  )
  select n.id, n.numero, n.opened_at, n.intitule_tiers, n.code_defaut,
         coalesce(nullif(n.modele_ge, ''), nullif(n.reference_article, ''), nullif(n.onduleur_modele, '')) as modele,
         n.description,
         coalesce(
           nullif(btrim(n.preconisation), ''),
           (select e.libelle from public.hotline_ticket_etapes e
             where e.ticket_id = n.id and e.type = 'RESOLUTION' and coalesce(e.auteur, '') <> 'cloture-auto'
               and e.libelle not like 'Ticket résolu%' and e.libelle not like 'Résolu%'
             order by e.at desc limit 1),
           (select e.libelle from public.hotline_ticket_etapes e
             where e.ticket_id = n.id and e.type = 'COMMENTAIRE' and coalesce((e.details ->> 'messagerie')::boolean, false) = false
               and e.libelle not like 'Repris dans la console%'
             order by e.at desc limit 1)
         ) as solution,
         array_remove(array[
           case when n.m_code then 'même code défaut' end,
           case when n.m_ge then 'même GE' when n.m_ge_famille then 'GE de la même famille' end,
           case when n.m_ui then 'même UI' end,
           case when n.m_ond then 'même onduleur' end,
           case when n.m_equip then 'même équipement' when n.m_marque then 'même marque' end
         ], null) as raisons,
         n.note
  from notes n
  where n.note >= 2
  order by n.note desc, n.opened_at desc
  limit greatest(coalesce(p_limite, 6), 1);
end
$$;
grant execute on function public.hotline_cas_similaires(text, text, text, text, text, text, text, uuid, int) to authenticated;
