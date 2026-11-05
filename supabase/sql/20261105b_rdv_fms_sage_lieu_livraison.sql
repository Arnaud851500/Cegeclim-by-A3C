-- ============================================================================
-- 20261105b_rdv_fms_sage_lieu_livraison.sql
-- ----------------------------------------------------------------------------
-- Demandes d'Arnaud du 05/11/2026 :
--
-- 1. RDV de déchargement FMS lu dans SAGE. Il n'existe pas de champ dédié : le RDV
--    confirmé est écrit en commentaire de la CDF (sage.bdcf_commentaires), ex.
--      « Livraison le 13.11 à 13h selon échanges @ 26.10 »
--      « Hitachi propose de livrer 17.11 selon @ 22.10 => OK FMS @ 26.10 »
--      « Livraison décalée au 18.11 selon @ Nadia/FMS 27.10 »
--    Les « Livraison estimée … » sont des estimations et ne valent PAS RDV.
--    appro_rdv_fms_sage() lit le dernier commentaire confirmé (n° de ligne le plus grand) ;
--    v_appro_cdf_rdv_fms_effectif = RDV saisi dans le compagnon s'il existe, sinon RDV SAGE.
--
-- 2. Buffer de 3 jours ouvrés entre la réception FMS (RDV) et la disponibilité à
--    l'expédition (FMS → client ou FMS → agence) : plan_exp_delai_mise_en_stock_jours = 3,
--    appliqué directement à la date de dispo des réceptions dans le plan.
--
-- 3. Lieu de livraison des commandes départ FMS : les envois ne se cumulent que pour un
--    même lieu. Par défaut (SAGE) : lieu de livraison = nom du client → « chez le pro »,
--    sinon → « chantier » (adresse du lieu de livraison). Bascule possible dans la vue
--    agence (action LIVRAISON, livraison_type PRO | CHANTIER), prise en compte par le calcul.
--
-- 4. Portefeuille commandes fournisseurs : rattachement CDC ↔ CDF refait en FIFO. Une ligne
--    de CDC non couverte par le stock dépend de LA réception qui comble son manque (réceptions
--    de la référence servies dans l'ordre des dates), et non plus de toutes les réceptions
--    antérieures à sa date (qui gonflait les compteurs : 1 550 CDC sur un container de 649 pièces).
--
-- La fonction refresh_plan_expedition_fms est mise à jour dans 20261104d_plan_expedition_fms.sql
-- (version du 05/11/2026) — rejouer ce fichier après celui-ci.
-- ============================================================================

-- ─── 1. RDV FMS lus dans les commentaires SAGE ──────────────────────────────
create or replace function public.appro_rdv_fms_sage()
returns table (cdf_numero text, rdv_date date, rdv_heure time, texte text, dl_ligne integer)
language plpgsql
stable
security definer
set search_path = public, sage
as $$
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
    where c.dl_design ~* '(livraison|livrer|rdv|rendez)'
      and c.dl_design !~* 'estim'
    order by c.do_piece, c.dl_ligne
  loop
    m := null;
    -- « Livraison le 13.11 », « Livraison décalée au 18.11 », « Livraison confirmée le 20/11 », « RDV FMS 21.11 »
    m := regexp_match(r.dl_design, '(?:livraison\s+(?:le|confirm\w*(?:\s+le)?|pr[ée]vue\s+le|fix[ée]e\s+(?:au|le)|d[ée]cal[ée]e\s+(?:au|le)|report[ée]e\s+(?:au|le)|avanc[ée]e\s+(?:au|le))|rdv(?:\s+fms)?(?:\s+le)?|rendez-vous(?:\s+le)?)\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', 'i');
    -- « Hitachi propose de livrer 17.11 … => OK FMS »
    if m is null and r.dl_design ~* 'ok\s+fms' then
      m := regexp_match(r.dl_design, 'livrer\s+(?:le\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?', 'i');
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
end $$;
revoke all on function public.appro_rdv_fms_sage() from public, anon;
grant execute on function public.appro_rdv_fms_sage() to authenticated;

-- Dernier RDV confirmé par CDF
create or replace view public.v_appro_cdf_rdv_fms_sage as
select distinct on (s.cdf_numero) s.cdf_numero, s.rdv_date, s.rdv_heure, s.texte, s.dl_ligne
from public.appro_rdv_fms_sage() s
order by s.cdf_numero, s.dl_ligne desc;
grant select on public.v_appro_cdf_rdv_fms_sage to authenticated;

-- RDV en vigueur : saisi dans le compagnon, sinon SAGE
create or replace view public.v_appro_cdf_rdv_fms_effectif as
select coalesce(m.cdf_numero, s.cdf_numero) as cdf_numero,
       m.container_numero,
       coalesce(m.rdv_date, s.rdv_date) as rdv_date,
       case when m.rdv_date is not null then m.rdv_heure else s.rdv_heure end as rdv_heure,
       case when m.rdv_date is not null then 'COMPAGNON' else 'SAGE' end as source,
       coalesce(m.commentaire, s.texte) as commentaire
from public.v_appro_cdf_rdv_fms_actuel m
full join public.v_appro_cdf_rdv_fms_sage s on s.cdf_numero = m.cdf_numero;
grant select on public.v_appro_cdf_rdv_fms_effectif to authenticated;

-- ─── 2. Buffer réception → expédition ───────────────────────────────────────
update public.appro_parametres
set valeur = 3,
    description = 'Plan d''expédition FMS : jours ouvrés entre la réception FMS (RDV de déchargement) et la disponibilité à l''expédition (FMS → client ou agence)'
where cle = 'plan_exp_delai_mise_en_stock_jours';

-- ─── 3. Lieu de livraison ───────────────────────────────────────────────────
alter table public.appro_plan_exp_actions drop constraint if exists appro_plan_exp_actions_type_action_check;
alter table public.appro_plan_exp_actions add constraint appro_plan_exp_actions_type_action_check
  check (type_action in ('DEPOT', 'DATE', 'SPLIT', 'LIVRAISON'));
alter table public.appro_plan_exp_actions add column if not exists livraison_type text
  check (livraison_type is null or livraison_type in ('PRO', 'CHANTIER'));

alter table public.appro_plan_exp_lignes add column if not exists lieu_type text;        -- PRO | CHANTIER (effectif)
alter table public.appro_plan_exp_lignes add column if not exists lieu_sage text;        -- PRO | CHANTIER (déduit de SAGE)
alter table public.appro_plan_exp_lignes add column if not exists lieu_cle text;         -- regroupement des envois
alter table public.appro_plan_exp_lignes add column if not exists lieu_libelle text;     -- adresse du lieu de livraison
alter table public.appro_plan_exp_lignes add column if not exists chantier text;         -- référence de la pièce SAGE
alter table public.appro_plan_exp_receptions add column if not exists rdv_source text;   -- COMPAGNON | SAGE
alter table public.appro_plan_exp_receptions add column if not exists nb_cdc integer;    -- CDC servies (horizon du plan)
alter table public.appro_plan_exp_receptions add column if not exists rdv_dispo date;    -- RDV (avant buffer)

-- ─── 4. Rattachement CDC ↔ CDF en FIFO ──────────────────────────────────────
create or replace function public.appro_cdf_cdc_dependances()
returns table (numero_cdf text, date_livraison_cdf date, numero_document text, nom_tiers text, numero_tiers text,
               representant text, agence text, reference_article text, quantite numeric, date_livraison date,
               statut_couverture text, retard_estime_jours integer)
language sql
stable
security definer
set search_path = public, sage, interne
as $$
  with cdc as (
    select v.*
    from interne.v_couverture_stock_global v
    where v.statut_couverture in ('COUVERT_PAR_RECEPTION', 'RECEPTION_TARDIVE')
      and v.stock_projete_hors_receptions < 0
  ),
  rec as (
    select r.numero_cdf, r.reference_article, r.date_reception_retenue, r.date_livraison_sage,
           coalesce(sum(r.quantite_attendue) over w_avant, 0) as cumul_avant,
           sum(r.quantite_attendue) over w_fin as cumul_fin
    from v_couverture_stock_receptions r
    window w_avant as (partition by r.reference_article order by r.date_reception_retenue, r.numero_cdf, r.ligne_cdf_id
                       rows between unbounded preceding and 1 preceding),
           w_fin   as (partition by r.reference_article order by r.date_reception_retenue, r.numero_cdf, r.ligne_cdf_id
                       rows between unbounded preceding and current row)
  )
  -- la ligne de CDC dépend de la réception qui comble son manque cumulé (une seule)
  select distinct on (r.numero_cdf, r.date_livraison_sage, c.id)
         r.numero_cdf::text, r.date_livraison_sage::date, c.numero_document::text, c.nom_tiers::text, c.numero_tiers::text,
         c.representant::text, c.agence::text, c.reference_article::text,
         least(c.quantite, -c.stock_projete_hors_receptions - r.cumul_avant)::numeric,
         c.date_livraison::date, c.statut_couverture::text, c.retard_estime_jours::integer
  from cdc c
  join rec r on r.reference_article = c.reference_article
            and r.cumul_avant < -c.stock_projete_hors_receptions
            and r.cumul_fin >= -c.stock_projete_hors_receptions
$$;
revoke all on function public.appro_cdf_cdc_dependances() from public, anon;
grant execute on function public.appro_cdf_cdc_dependances() to authenticated;

-- ─── Vue agence : lieu de livraison et chantier ─────────────────────────────
create or replace function public.get_plan_exp_agence(p_agence text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not plan_exp_autorise() then raise exception 'Accès réservé'; end if;
  return jsonb_build_object(
    'meta', (select to_jsonb(m) from appro_plan_exp_meta m where id = 1),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.ligne_id, 'doc', l.numero_document, 'chantier', coalesce(l.chantier, nullif(btrim(e.reference), '')), 'tiers', l.numero_tiers, 'client', l.nom_tiers, 'rep', l.representant,
        'depot', upper(btrim(l.depot_expedition)), 'liv', l.date_livraison, 'crea', l.date_creation,
        'ref', l.reference_article, 'des', l.designation, 'fam', l.famille, 'macro', l.famille_macro, 'role', l.role_famille,
        'qte', l.quantite, 'mt', l.montant_ht, 'q_ag', l.qte_agence, 'q_fms', l.qte_fms_dispo, 'q_att', l.qte_attente,
        'cdf', l.numero_cdf, 'cont', l.container, 'dispo', l.date_dispo, 'sim', l.rdv_simule, 'sans_rec', l.sans_reception,
        'vol', l.vol_unitaire, 'pu', round(l.palette_unitaire, 4), 'rp', l.regle_palette, 'p_d', round(l.palettes_dispo, 3), 'p_a', round(l.palettes_attente, 3), 'statut', l.statut,
        'lieu_type', l.lieu_type, 'lieu_sage', l.lieu_sage, 'lieu_cle', l.lieu_cle, 'lieu_lib', l.lieu_libelle
      ) order by l.nom_tiers, l.numero_document, l.reference_article)
      from appro_plan_exp_lignes l
      left join activite_entete e on e.numero_piece = l.numero_document
      where coalesce(l.agence_commerciale, 'NON AFFECTE') = p_agence), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at)
      from appro_plan_exp_actions a
      where a.statut = 'A_REPORTER'
        and (a.agence = p_agence or a.numero_document in (
              select l.numero_document from appro_plan_exp_lignes l where coalesce(l.agence_commerciale, 'NON AFFECTE') = p_agence))), '[]'::jsonb)
  );
end $$;
