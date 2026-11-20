-- Inventaire — pilotage : quantités d'unités à compter (20/11/2026, demandé par Arnaud)
-- inv_campagne_suivi : qte_theorique (unités à compter, stock théorique SAGE de la liste), qte_transit,
--   qte_a_compter / qte_saisie (unités des lignes du comptage ouvert, théoriques / déjà saisies).
-- inv_options_perimetre : qte et transit_qte par dépôt (écran de préparation).
-- Logique existante inchangée.

create or replace function public.inv_options_perimetre()
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'sage'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    with s as (
      select trim(sd.sto_art_num) as ref, sd.sto_dep_num, sd.sto_qte, sd.sto_montant
      from sage.stock_depot sd
      join public.stock_agence_depots d on d.depot_num = sd.sto_dep_num
      where sd.sto_qte <> 0
    ),
    a as (
      select s.*, r.famille, coalesce(f.famille_macro, 'Sans famille macro') as macro, f.libelle_famille,
             r.fournisseur_principal
      from s
      left join public.ref_articles r on r.reference_article = s.ref
      left join public.ref_familles f on f.famille = r.famille
    ),
    tr as (
      select d.depot_num, trim(max(sd.sto_dep)) as libelle, count(distinct trim(sd.sto_art_num)) as n, round(sum(sd.sto_montant)) as v, sum(sd.sto_qte) as q
      from public.stock_agence_depots d
      join sage.stock_depot sd on sd.sto_dep_num = d.depot_transit_num and sd.sto_qte <> 0
      group by 1
    )
    select jsonb_build_object(
      'familles_macro', (select coalesce(jsonb_agg(jsonb_build_object('code', m.macro, 'nb_refs', m.n, 'valeur', m.v)
                           order by m.macro), '[]'::jsonb)
                         from (select macro, count(distinct ref) n, round(sum(sto_montant)) v from a group by 1) m),
      'familles', (select coalesce(jsonb_agg(jsonb_build_object('code', x.famille, 'libelle', x.lib, 'macro', x.macro,
                     'nb_refs', x.n, 'valeur', x.v) order by x.macro, x.famille), '[]'::jsonb)
                   from (select famille, max(libelle_famille) lib, max(macro) macro, count(distinct ref) n,
                                round(sum(sto_montant)) v
                         from a where famille is not null group by 1) x),
      'fournisseurs', (select coalesce(jsonb_agg(jsonb_build_object('code', x.fournisseur_principal, 'nom', x.nom,
                         'nb_refs', x.n, 'valeur', x.v) order by x.v desc nulls last), '[]'::jsonb)
                       from (select a.fournisseur_principal,
                                    (select max(t.ti_intitule) from sage.tiers t where t.ti_num = a.fournisseur_principal) nom,
                                    count(distinct ref) n, round(sum(sto_montant)) v
                             from a where a.fournisseur_principal is not null group by 1) x),
      'depots', (select coalesce(jsonb_agg(jsonb_build_object('depot_num', x.sto_dep_num, 'nb_refs', x.n, 'valeur', x.v, 'qte', x.q,
                   'transit_libelle', tr.libelle, 'transit_nb_refs', tr.n, 'transit_valeur', tr.v, 'transit_qte', tr.q)), '[]'::jsonb)
                 from (select sto_dep_num, count(distinct ref) n, round(sum(sto_montant)) v, sum(sto_qte) q from a group by 1) x
                 left join tr on tr.depot_num = x.sto_dep_num)
    )
  );
end $$;

-- Suivi : nombre de lignes transit ---------------------------------------------------
create or replace function public.inv_campagne_suivi(p_campagne_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  perform public.inv_exiger_pilotage();
  return (
    select coalesce(jsonb_agg(public.inv_depot_json(d) || jsonb_build_object(
      'nb_lignes', s.nb_lignes, 'nb_hors_liste', s.nb_hors_liste, 'nb_transit', s.nb_transit,
      'valeur_transit', s.valeur_transit,
      'nb_a_compter', s.nb_a_compter, 'nb_saisies', s.nb_saisies,
      'valeur_theorique', s.valeur_theorique,
      'qte_theorique', s.qte_theorique, 'qte_transit', s.qte_transit,
      'qte_a_compter', s.qte_a_compter, 'qte_saisie', s.qte_saisie,
      'nb_ecarts', s.nb_ecarts, 'nb_ecarts_a_decider', s.nb_ecarts_a_decider,
      'nb_valides', s.nb_valides, 'nb_refuses', s.nb_refuses,
      'valeur_ecart_plus', s.v_plus, 'valeur_ecart_moins', s.v_moins,
      'valeur_ecart_net', s.v_net, 'valeur_validee_net', s.v_valide)
      order by sad.ordre nulls last, d.depot_num), '[]'::jsonb)
    from public.inventaire_depots d
    left join public.stock_agence_depots sad on sad.depot_num = d.depot_num
    cross join lateral (
      select count(*) as nb_lignes,
             count(*) filter (where l.hors_liste) as nb_hors_liste,
             count(*) filter (where l.transit) as nb_transit,
             round(coalesce(sum(l.qte_theorique * l.pump) filter (where l.transit), 0), 2) as valeur_transit,
             count(*) filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant) as nb_a_compter,
             count(*) filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant
                                and case d.comptage_courant when 1 then l.q1 when 2 then l.q2 else l.q3 end is not null) as nb_saisies,
             round(coalesce(sum(l.qte_theorique * l.pump), 0), 2) as valeur_theorique,
             coalesce(sum(l.qte_theorique), 0) as qte_theorique,
             coalesce(sum(l.qte_theorique) filter (where l.transit), 0) as qte_transit,
             coalesce(sum(l.qte_theorique) filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant), 0) as qte_a_compter,
             coalesce(sum(case d.comptage_courant when 1 then l.q1 when 2 then l.q2 else l.q3 end)
                        filter (where d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant), 0) as qte_saisie,
             count(*) filter (where f.q is not null and f.q <> l.qte_theorique) as nb_ecarts,
             count(*) filter (where f.q is not null and f.q <> l.qte_theorique and l.decision is null
                                and not (d.statut = 'comptage' and l.nb_comptages >= d.comptage_courant)) as nb_ecarts_a_decider,
             count(*) filter (where l.decision = 'valide' and f.q <> l.qte_theorique) as nb_valides,
             count(*) filter (where l.decision = 'refuse' and f.q <> l.qte_theorique) as nb_refuses,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q > l.qte_theorique), 0), 2) as v_plus,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q < l.qte_theorique), 0), 2) as v_moins,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where f.q is not null), 0), 2) as v_net,
             round(coalesce(sum((f.q - l.qte_theorique) * l.pump) filter (where l.decision = 'valide'), 0), 2) as v_valide
      from public.inventaire_lignes l
      cross join lateral (select public.inv_qte_finale(l) as q) f
      where l.inv_depot_id = d.id
    ) s
    where d.campagne_id = p_campagne_id
  );
end $$;
