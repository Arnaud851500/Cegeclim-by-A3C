-- =============================================================================
-- Contrôle « Stock FMS SAGE ↔ MyStock » — v2 (19/11/2026)
-- -----------------------------------------------------------------------------
-- 1. Heure de l'image MyStock (mystock_controles.heure_image). Le stock SAGE
--    comparé est la dernière photo quotidienne de SAGE prise AVANT l'heure de
--    l'image (ex. image du 12/11 à 8h48 → photo SAGE du 11/11, import de 23h05).
-- 2. Mouvements MyStock à la ligne importés depuis l'écran (reporting FMS) :
--      - expéditions / préparations (reporting_commandes : N° commande = BL SAGE
--        ou n° de transfert 28xxx, Référence, Quantité, Date d'expédition) ;
--      - réceptions (reporting_arrivages : N° réception, Nom, Retour, Référence,
--        Quantité, Date de validation).
--    Réimporter un fichier met à jour les lignes déjà connues (clé type +
--    document + référence), sans doublon.
-- 3. mystock_controle_donnees(id) renvoie au navigateur tout ce qu'il faut pour
--    expliquer chaque écart (BL SAGE à la ligne tous dépôts, mouvements MyStock,
--    photos SAGE FMS / TRANSIT FMS). Le classement « expliqué à coup sûr / à
--    valider / sans explication » est calculé dans lib/mystockRapprochement.ts
--    puis enregistré dans mystock_controles.resume (mystock_controle_enregistrer_resume).
-- Accès : can_appro ou can_autorisation (mystock_peut_controler).
-- =============================================================================

alter table public.mystock_controles add column if not exists heure_image timestamptz;

-- Image chargée le 12/11 (fichier STOCK_FMS_121126_8h48)
update public.mystock_controles
   set heure_image = timestamp '2026-11-12 08:48' at time zone 'Europe/Paris'
 where id = 1 and heure_image is null;

create table if not exists public.mystock_mouvements_imports (
  id            bigserial primary key,
  type          text not null check (type in ('expedition', 'reception')),
  fichier_nom   text,
  nb_lignes     integer,
  nb_nouvelles  integer,
  nb_maj        integer,
  date_min      timestamptz,
  date_max      timestamptz,
  cree_le       timestamptz not null default now(),
  cree_par      text
);

create table if not exists public.mystock_mouvements (
  id              bigserial primary key,
  type            text not null check (type in ('expedition', 'reception')),
  document        text not null,
  reference       text not null,
  quantite        numeric not null default 0,
  date_mouvement  timestamptz not null,
  date_import     timestamptz,
  tiers           text,
  transporteur    text,
  retour          boolean not null default false,
  commande_fms    text,
  import_id       bigint references public.mystock_mouvements_imports(id) on delete set null,
  maj_le          timestamptz not null default now(),
  unique (type, document, reference)
);
create index if not exists idx_mystock_mvt_ref_date on public.mystock_mouvements (reference, date_mouvement);
create index if not exists idx_mystock_mvt_type_date on public.mystock_mouvements (type, date_mouvement);

alter table public.mystock_mouvements          enable row level security;
alter table public.mystock_mouvements_imports  enable row level security;
revoke all on public.mystock_mouvements, public.mystock_mouvements_imports from anon, authenticated;

-- Import ------------------------------------------------------------------------
-- p_lignes = [{ document, reference, quantite, date: 'YYYY-MM-DDTHH:MM:SS' (heure de Paris),
--               date_import, tiers, transporteur, retour (bool), commande_fms }, ...]
create or replace function public.mystock_mouvements_importer(p_type text, p_fichier text, p_lignes jsonb)
returns jsonb
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_import bigint;
  v_n      integer;
  v_new    integer;
  v_min    timestamptz;
  v_max    timestamptz;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  if p_type not in ('expedition', 'reception') then
    raise exception 'Type de mouvement inconnu : %', p_type;
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne lue dans le fichier';
  end if;

  insert into public.mystock_mouvements_imports (type, fichier_nom, nb_lignes, cree_par)
  values (p_type, p_fichier, jsonb_array_length(p_lignes), public.current_user_email())
  returning id into v_import;

  create temporary table tmp_mvt on commit drop as
  select upper(trim(e->>'document')) as document,
         upper(trim(e->>'reference')) as reference,
         sum(coalesce(nullif(replace(e->>'quantite', ',', '.'), '')::numeric, 0)) as quantite,
         max((e->>'date')::timestamp at time zone 'Europe/Paris') as date_mouvement,
         max((nullif(e->>'date_import', ''))::timestamp at time zone 'Europe/Paris') as date_import,
         max(nullif(trim(e->>'tiers'), '')) as tiers,
         max(nullif(trim(e->>'transporteur'), '')) as transporteur,
         bool_or(coalesce((e->>'retour')::boolean, false)) as retour,
         max(nullif(trim(e->>'commande_fms'), '')) as commande_fms
  from jsonb_array_elements(p_lignes) e
  where nullif(trim(e->>'document'), '') is not null
    and nullif(trim(e->>'reference'), '') is not null
    and nullif(e->>'date', '') is not null
  group by 1, 2;

  select count(*), min(date_mouvement), max(date_mouvement) into v_n, v_min, v_max from tmp_mvt;

  select count(*) into v_new
  from tmp_mvt t
  where not exists (select 1 from public.mystock_mouvements m
                    where m.type = p_type and m.document = t.document and m.reference = t.reference);

  insert into public.mystock_mouvements
    (type, document, reference, quantite, date_mouvement, date_import, tiers, transporteur, retour, commande_fms, import_id, maj_le)
  select p_type, document, reference, quantite, date_mouvement, date_import, tiers, transporteur, retour, commande_fms, v_import, now()
  from tmp_mvt
  on conflict (type, document, reference) do update
    set quantite = excluded.quantite, date_mouvement = excluded.date_mouvement, date_import = excluded.date_import,
        tiers = excluded.tiers, transporteur = excluded.transporteur, retour = excluded.retour,
        commande_fms = excluded.commande_fms, import_id = excluded.import_id, maj_le = now();

  update public.mystock_mouvements_imports
     set nb_lignes = v_n, nb_nouvelles = v_new, nb_maj = v_n - v_new, date_min = v_min, date_max = v_max
   where id = v_import;

  return jsonb_build_object('import_id', v_import, 'lignes', v_n, 'nouvelles', v_new, 'maj', v_n - v_new,
                            'date_min', v_min, 'date_max', v_max);
end;
$$;

create or replace function public.mystock_mouvements_couverture()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  return jsonb_build_object(
    'types', coalesce((
      select jsonb_object_agg(type, jsonb_build_object('lignes', n, 'date_min', dmin, 'date_max', dmax, 'documents', nd))
      from (select type, count(*) n, count(distinct document) nd, min(date_mouvement) dmin, max(date_mouvement) dmax
            from public.mystock_mouvements group by type) x
    ), '{}'::jsonb),
    'imports', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.cree_le desc)
      from (select * from public.mystock_mouvements_imports order by cree_le desc limit 20) i
    ), '[]'::jsonb)
  );
end;
$$;

-- Création d'un contrôle : la date J (photo SAGE) découle de l'heure de l'image -----
drop function if exists public.mystock_controle_creer(date, text, text, text, integer, jsonb, text);

create or replace function public.mystock_controle_creer(
  p_date_image date, p_fichier text, p_col_reference text, p_col_quantite text,
  p_nb_lignes_fichier integer, p_lignes jsonb, p_depot_num text default '3',
  p_heure_image timestamptz default null
)
returns jsonb
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  v_id     bigint;
  v_date   date := p_date_image;
  v_result jsonb;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  if p_heure_image is not null then
    select max(date_stock) into v_date
    from public.stock_depot_snapshot_journalier
    where sto_dep_num = coalesce(nullif(p_depot_num, ''), '3') and loaded_at < p_heure_image;
    v_date := coalesce(v_date, (p_heure_image at time zone 'Europe/Paris')::date - 1);
  end if;
  if v_date is null then
    raise exception 'Date ou heure de l''image MyStock obligatoire';
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucune ligne lue dans le fichier';
  end if;

  insert into public.mystock_controles
    (date_image, heure_image, depot_num, fichier_nom, colonne_reference, colonne_quantite, nb_lignes_fichier, cree_par)
  values (v_date, p_heure_image, coalesce(nullif(p_depot_num, ''), '3'), p_fichier, p_col_reference, p_col_quantite,
          p_nb_lignes_fichier, public.current_user_email())
  returning id into v_id;

  insert into public.mystock_controle_lignes (controle_id, reference, designation, qte_mystock, nb_lignes)
  select v_id, ref, max(des), sum(qte), sum(nb)::int
  from (
    select upper(trim(e->>'reference')) as ref,
           nullif(trim(e->>'designation'), '') as des,
           coalesce(nullif(replace(e->>'qte', ',', '.'), '')::numeric, 0) as qte,
           coalesce(nullif(e->>'nb', '')::int, 1) as nb
    from jsonb_array_elements(p_lignes) e
  ) x
  where ref is not null and ref <> ''
  group by ref;

  v_result := public.mystock_controle_calcul(v_id);
  update public.mystock_controles set resume = v_result->'resume' where id = v_id;
  return v_result;
end;
$$;

-- Données de rapprochement -------------------------------------------------------
create or replace function public.mystock_controle_donnees(p_id bigint)
returns jsonb
language plpgsql security definer
set search_path to 'public'
set statement_timeout to '120s'
as $$
declare
  c        public.mystock_controles%rowtype;
  v_base   jsonb;
  v_refs   text[];
  v_depot  text;
  v_du     date;
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  select * into c from public.mystock_controles where id = p_id;
  if not found then
    raise exception 'Contrôle % introuvable', p_id;
  end if;

  v_base := public.mystock_controle_calcul(p_id);
  v_depot := v_base->'meta'->>'depot';
  v_du := c.date_image - 21;

  select coalesce(array_agg(e->>'reference'), '{}') into v_refs
  from jsonb_array_elements(v_base->'lignes') e
  where (e->>'ecart')::numeric <> 0;

  return v_base || jsonb_build_object(
    'controle', to_jsonb(c) - 'resume',
    'couverture', coalesce((
      select jsonb_object_agg(type, jsonb_build_object('date_min', dmin, 'date_max', dmax, 'lignes', n))
      from (select type, min(date_mouvement) dmin, max(date_mouvement) dmax, count(*) n
            from public.mystock_mouvements group by type) x), '{}'::jsonb),
    -- BL / retours SAGE à la ligne, tous dépôts : [ref, bl, date, qte, depot, mode d'expédition, client]
    'bl', coalesce((
      select jsonb_agg(jsonb_build_array(l.ref, l.bl, l.d, l.q, l.depot, e.expedition, l.cli))
      from (
        select upper(trim(a.reference_article)) ref, a.numero_piece bl, a.date_piece::date d, a.quantite q,
               coalesce(a.depot, '') depot, a.intitule_tiers_entete cli
        from public.activite_lignes a
        where a.type_document in ('Bon de livraison', 'Bon de retour')
          and a.date_piece::date >= v_du and coalesce(a.quantite, 0) <> 0
          and upper(trim(a.reference_article)) = any (v_refs)
        union all
        select upper(trim(f.reference_article)), f.numero_piece_bl, coalesce(f.date_bl, f.date_facture)::date, f.quantite,
               coalesce(f.depot, ''), f.intitule_tiers_entete
        from public.facture_lignes f
        where coalesce(f.date_bl, f.date_facture)::date >= v_du and coalesce(f.quantite, 0) <> 0
          and f.numero_piece_bl is not null
          and upper(trim(f.reference_article)) = any (v_refs)
          and not exists (select 1 from public.activite_lignes a2
                          where a2.numero_piece = f.numero_piece_bl
                            and upper(trim(a2.reference_article)) = upper(trim(f.reference_article)))
      ) l
      left join public.activite_entete e on e.numero_piece = l.bl
    ), '[]'::jsonb),
    -- Mouvements MyStock : [ref, type, document, date, qte, tiers, transporteur, retour]
    'mvt', coalesce((
      select jsonb_agg(jsonb_build_array(m.reference, m.type, m.document, m.date_mouvement, m.quantite,
                                         m.tiers, m.transporteur, m.retour) order by m.date_mouvement)
      from public.mystock_mouvements m
      where m.reference = any (v_refs) and m.date_mouvement >= v_du
    ), '[]'::jsonb),
    -- Photos SAGE quotidiennes depuis J : [ref, date, stock FMS, stock TRANSIT FMS]
    'photos', coalesce((
      select jsonb_agg(jsonb_build_array(x.reference, x.date_stock, x.fms, x.transit) order by x.reference, x.date_stock)
      from (select s.reference, s.date_stock,
                   sum(s.sto_qte) filter (where s.sto_dep_num = c.depot_num) fms,
                   sum(s.sto_qte) filter (where upper(s.sto_dep) = 'TRANSIT ' || upper(v_depot)) transit
            from public.stock_depot_snapshot_journalier s
            where s.date_stock >= c.date_image and s.reference = any (v_refs)
            group by s.reference, s.date_stock) x
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.mystock_controle_enregistrer_resume(p_id bigint, p_resume jsonb)
returns void
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  update public.mystock_controles set resume = coalesce(resume, '{}'::jsonb) || p_resume where id = p_id;
end;
$$;

-- La liste expose l'heure de l'image
create or replace function public.mystock_controles_liste()
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public.mystock_peut_controler() then
    raise exception 'Accès refusé : droit Appro requis';
  end if;
  return jsonb_build_object(
    'controles', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'date_image', c.date_image, 'heure_image', c.heure_image, 'depot_num', c.depot_num,
               'fichier_nom', c.fichier_nom, 'nb_lignes_fichier', c.nb_lignes_fichier,
               'cree_le', c.cree_le, 'cree_par', c.cree_par, 'resume', c.resume,
               'photo_disponible', exists (select 1 from public.stock_depot_snapshot_journalier s
                                           where s.date_stock = c.date_image and s.sto_dep_num = c.depot_num)
             ) order by c.date_image desc, c.id desc)
      from (select * from public.mystock_controles order by date_image desc, id desc limit 100) c
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object('date_stock', d.date_stock, 'loaded_at', d.loaded_at) order by d.date_stock desc)
      from (select date_stock, max(loaded_at) as loaded_at
            from public.stock_depot_snapshot_journalier
            where sto_dep_num = '3'
            group by date_stock order by date_stock desc limit 60) d
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.mystock_mouvements_importer(text, text, jsonb) from public, anon;
revoke all on function public.mystock_mouvements_couverture() from public, anon;
revoke all on function public.mystock_controle_creer(date, text, text, text, integer, jsonb, text, timestamptz) from public, anon;
revoke all on function public.mystock_controle_donnees(bigint) from public, anon;
revoke all on function public.mystock_controle_enregistrer_resume(bigint, jsonb) from public, anon;
grant execute on function public.mystock_mouvements_importer(text, text, jsonb) to authenticated;
grant execute on function public.mystock_mouvements_couverture() to authenticated;
grant execute on function public.mystock_controle_creer(date, text, text, text, integer, jsonb, text, timestamptz) to authenticated;
grant execute on function public.mystock_controle_donnees(bigint) to authenticated;
grant execute on function public.mystock_controle_enregistrer_resume(bigint, jsonb) to authenticated;
