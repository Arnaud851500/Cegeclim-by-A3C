-- ============================================================================
-- Écran « Tarifs fournisseurs » — export Excel pour l'import des tarifs dans BLG (23/11/2026)
-- Demandé par Arnaud : fichier ID BLG / Fournisseur / Date de début / Date de fin / Prix tarif.
-- get_tarif_ids_blg(p_fournisseur, p_references) renvoie :
--   { fournisseur_blg: 'fH0001' (blg.article_supplier.name, casse BLG), fournisseur_blg_id, fournisseur_blg_titre,
--     articles: [{ reference, part_id, appariement_via }] }
-- Appariement article identique à v_appro_article_blg_cles (reference prioritaire, puis internal_reference).
-- ============================================================================
create or replace function public.get_tarif_ids_blg(p_fournisseur text, p_references text[])
returns jsonb
language sql
stable
security definer
set search_path = public, blg
as $$
  select case when not public.tarif_peut_acceder() then null else jsonb_build_object(
    'fournisseur_blg', s.name,
    'fournisseur_blg_id', s.id,
    'fournisseur_blg_titre', s.title,
    'articles', coalesce((
      select jsonb_agg(jsonb_build_object('reference', r.ref, 'part_id', c.part_id, 'appariement_via', c.appariement_via))
      from (select distinct upper(trim(x)) as ref from unnest(p_references) x where x is not null and trim(x) <> '') r
      join public.v_appro_article_blg_cles c on c.cle = r.ref
    ), '[]'::jsonb)
  ) end
  from (select 1) d
  left join lateral (
    select a.id, a.name, a.title from blg.article_supplier a
    where upper(a.name) = 'F' || upper(trim(p_fournisseur))
    order by a.active desc nulls last, a.id limit 1
  ) s on true;
$$;

revoke all on function public.get_tarif_ids_blg(text, text[]) from public, anon;
grant execute on function public.get_tarif_ids_blg(text, text[]) to authenticated;
