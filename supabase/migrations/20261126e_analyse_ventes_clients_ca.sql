-- =============================================================================
-- 20261126e_analyse_ventes_clients_ca.sql — Analyse des ventes & devis, retours du 26/11 (15h)
-- -----------------------------------------------------------------------------
-- Premier essai d'Arnaud sur la SMER : le compte choisi (S0043, Brie) n'a aucune
-- vente en 2026 ; le compte actif est SB0002. Pour choisir le bon compte :
--   - la recherche client renvoie le CA facturé 12 mois glissants et le dernier
--     mois facturé (indicateur_factures_mensuel), triée par CA décroissant ;
--   - le filtre « date de la source » en doublon de la période (Date de facture
--     pour les factures, Date du BL pour les BL, Date de la CDC pour les CDC) est
--     retiré des filtres complémentaires.
-- =============================================================================

delete from public.analyse_champs
 where (source = 'factures' and code = 'date_facture')
    or (source = 'bl' and code = 'date_bl')
    or (source = 'cdc' and code = 'date_cdc');

drop function if exists public.analyse_clients(text, text[]);
create or replace function public.analyse_clients(p_recherche text, p_codes text[] default null)
returns jsonb
language plpgsql stable security invoker
set search_path = public
as $$
declare
  v_per record;
  v_q   text := nullif(btrim(coalesce(p_recherche, '')), '');
  v_dep date := (date_trunc('month', (now() at time zone 'Europe/Paris')) - interval '12 months')::date;
begin
  if not public.analyse_autorise() then
    raise exception 'Écran « Analyse des ventes & devis » non ouvert pour ce compte.';
  end if;
  select * into v_per from public.suivi_perimetre();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('code', z.numero, 'nom', z.intitule, 'ville', z.ville,
                                                 'ca_12m', z.ca_12m, 'dernier_mois', z.dernier_mois)
                              order by z.ca_12m desc nulls last, z.intitule), '[]'::jsonb)
    from (
      select t.numero, t.intitule, t.ville, i.ca_12m, i.dernier_mois
      from public.ref_tiers t
      left join lateral (
        select round(sum(m.ca_ht)) as ca_12m,
               max(make_date(m.annee, m.mois, 1)) filter (where m.ca_ht <> 0) as dernier_mois
        from public.indicateur_factures_mensuel m
        where m.numero_tiers = t.numero
          and make_date(m.annee, m.mois, 1) >= v_dep
      ) i on true
      where nullif(btrim(t.numero), '') is not null
        and (
          (p_codes is not null and t.numero = any (p_codes))
          or (p_codes is null and v_q is not null
              and (t.numero ilike v_q || '%' or t.intitule ilike '%' || v_q || '%' or t.ville ilike v_q || '%'))
        )
        and (coalesce(v_per.illimite, false)
             or upper(btrim(coalesce(t.representant, ''))) = any (coalesce(v_per.codes, '{}'))
             or public.tiers_non_affecte(t.representant::text))
      order by i.ca_12m desc nulls last, t.intitule
      limit 40
    ) z
  );
end;
$$;
grant execute on function public.analyse_clients(text, text[]) to authenticated;
