-- ============================================================================
-- 20261112d_hotline_scenarios.sql — Scénarios proposés depuis les statistiques
-- (12/11/2026, demande d'Arnaud : « sur la base des statistiques proposer des
-- scénarios »)
-- ----------------------------------------------------------------------------
-- hotline_scenarios(p_mois, p_min) : à partir des tickets thermiques classés
-- des p_mois derniers mois, regroupe les situations récurrentes
--   - par gamme × code défaut normalisé (scénarios « code défaut »),
--   - par gamme × symptôme pour les tickets sans code défaut,
-- avec volume, part résolue au téléphone / par réglage, part finie en pièce ou
-- garantie, part cause installation, organe et symptôme dominants, modèles les
-- plus touchés, délai médian de résolution et parcours de diagnostic déjà en
-- place sur la gamme. Le type de scénario proposé :
--   PIECE      ≥ 55 % en pièce / garantie → parcours court N1 : identifier la
--              pièce de l'organe dominant, vérifier la garantie, demande de pièce ;
--   TELEPHONE  ≥ 40 % résolus au téléphone → parcours de contrôles guidés N1
--              (reset, réglages, paramètres) avant toute escalade ;
--   MIXTE      sinon → contrôles guidés N1 puis escalade N2 avec mesures.
-- Réservé au droit expert (comme hotline_stats).
-- ============================================================================

create or replace function public.hotline_scenarios(p_mois int default 24, p_min int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v jsonb;
begin
  if not public.hotline_est_expert() then
    raise exception 'Scénarios hotline réservés au droit can_hotline_expert.';
  end if;

  with t as (
    select h.*, public.hotline_code_defaut_norme(h.code_defaut) as code,
           upper(btrim(coalesce(nullif(h.modele_ge, ''), h.reference_article))) as modele
    from public.hotline_tickets h
    where h.filiere = 'THERMIQUE'
      and h.opened_at >= now() - make_interval(months => greatest(1, coalesce(p_mois, 24)))
  ),
  base as (
    select 'CODE'::text as axe, coalesce(t.gamme, '-') as gamme, t.code as cle,
           t.issue, t.niveau, t.actions, t.organe, t.symptome, t.opened_at, t.resolved_at, t.modele
    from t where t.code is not null
    union all
    select 'SYMPTOME', coalesce(t.gamme, '-'), t.symptome,
           t.issue, t.niveau, t.actions, t.organe, t.symptome, t.opened_at, t.resolved_at, t.modele
    from t where t.code is null and t.symptome is not null and t.symptome <> 'AUTRE'
  ),
  g as (
    select axe, gamme, cle,
           count(*) as n,
           round(100.0 * count(*) filter (where issue in ('RESOLU_TEL', 'RESOLU_REGLAGE')) / count(*)) as pct_tel,
           round(100.0 * count(*) filter (where issue in ('PIECE', 'GARANTIE')) / count(*)) as pct_piece,
           round(100.0 * count(*) filter (where issue = 'CAUSE_INSTALLATION') / count(*)) as pct_installation,
           round(100.0 * count(*) filter (where niveau >= 2 or 'ESCALADE' = any(coalesce(actions, '{}'))) / count(*)) as pct_escalade,
           count(*) filter (where organe is not null and organe <> 'AUCUN') as n_organe,
           round((percentile_cont(0.5) within group (order by extract(epoch from resolved_at - opened_at)) / 3600)::numeric, 1) as resolution_h
    from base
    group by axe, gamme, cle
    having count(*) >= greatest(5, coalesce(p_min, 30))
  ),
  organes as (
    select distinct on (axe, gamme, cle) axe, gamme, cle, organe, count(*) over (partition by axe, gamme, cle, organe) as n
    from base where organe is not null and organe <> 'AUCUN'
    order by axe, gamme, cle, count(*) over (partition by axe, gamme, cle, organe) desc
  ),
  symptomes as (
    select distinct on (axe, gamme, cle) axe, gamme, cle, symptome
    from base where symptome is not null
    order by axe, gamme, cle, count(*) over (partition by axe, gamme, cle, symptome) desc
  ),
  modeles as (
    select axe, gamme, cle, jsonb_agg(jsonb_build_object('modele', modele, 'n', n) order by n desc) as liste
    from (
      select axe, gamme, cle, modele, count(*) n,
             row_number() over (partition by axe, gamme, cle order by count(*) desc) rang
      from base where coalesce(modele, '') <> '' and modele !~* 'illisible|inconnu'
      group by axe, gamme, cle, modele
    ) m where rang <= 3
    group by axe, gamme, cle
  ),
  parcours as (
    select coalesce(gamme, '-') gamme, jsonb_agg(jsonb_build_object('code', code, 'nom', nom, 'motif', motif) order by code) liste
    from public.hotline_arbres where filiere = 'THERMIQUE' and actif group by 1
  )
  select jsonb_build_object(
    'mois', p_mois,
    'tickets', (select count(*) from t),
    'scenarios', coalesce(jsonb_agg(jsonb_build_object(
        'axe', g.axe, 'gamme', g.gamme, 'cle', g.cle, 'n', g.n,
        'pct_tel', g.pct_tel, 'pct_piece', g.pct_piece, 'pct_installation', g.pct_installation, 'pct_escalade', g.pct_escalade,
        'organe', o.organe, 'pct_organe', case when g.n_organe > 0 then round(100.0 * o.n / g.n_organe) end,
        'symptome', s.symptome, 'resolution_h', g.resolution_h,
        'modeles', coalesce(m.liste, '[]'::jsonb),
        'parcours', coalesce(p.liste, '[]'::jsonb),
        'type', case when g.pct_piece >= 55 then 'PIECE' when g.pct_tel >= 40 then 'TELEPHONE' else 'MIXTE' end
      ) order by g.n desc), '[]'::jsonb)
  ) into v
  from g
  left join organes o using (axe, gamme, cle)
  left join symptomes s using (axe, gamme, cle)
  left join modeles m using (axe, gamme, cle)
  left join parcours p on p.gamme = g.gamme;

  return v;
end
$$;

grant execute on function public.hotline_scenarios(int, int) to authenticated;
