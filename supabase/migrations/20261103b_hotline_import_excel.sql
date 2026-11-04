-- ============================================================================
-- 20261103b_hotline_import_excel.sql — Hotline : import / export Excel des
-- parcours de diagnostic (03/11/2026, demande d'Arnaud)
-- ----------------------------------------------------------------------------
-- 1. Codes stables : hotline_arbres.code (unique) et hotline_noeuds.code
--    (unique par parcours). Le fichier Excel désigne parcours et questions par
--    ces codes : un code existant = mise à jour, un nouveau code = création.
--    Codes existants initialisés (ex. TH-MES-1 / Q1, Q2…) ; un parcours ou une
--    question créés dans l'éditeur reçoivent un code automatiquement.
-- 2. hotline_importer_parcours(p_parcours jsonb, p_simulation boolean) :
--    contrôle tout le fichier (filière, motif, codes, questions suivantes
--    existantes, une question de départ…) puis, hors simulation, applique en
--    une seule transaction. Chaque parcours présent dans le fichier est
--    REMPLACÉ par son contenu (questions absentes du fichier supprimées) ; les
--    parcours absents du fichier ne sont pas touchés. Réservé aux experts.
-- ============================================================================

alter table public.hotline_arbres add column if not exists code text;
alter table public.hotline_noeuds add column if not exists code text;

-- Initialisation des codes existants
with a as (
  select id,
         (case filiere when 'PV' then 'PV' else 'TH' end) || '-' ||
         (case motif when 'MISE_EN_SERVICE' then 'MES' else 'EXP' end) || '-' ||
         row_number() over (partition by filiere, motif order by updated_at, nom) as code
  from public.hotline_arbres
  where code is null
)
update public.hotline_arbres t set code = a.code from a where t.id = a.id;

with n as (
  select id, 'Q' || row_number() over (partition by arbre_id order by ordre, updated_at, id) as code
  from public.hotline_noeuds
  where code is null
)
update public.hotline_noeuds t set code = n.code from n where t.id = n.id;

create unique index if not exists hotline_arbres_code_uidx on public.hotline_arbres (upper(code));
create unique index if not exists hotline_noeuds_code_uidx on public.hotline_noeuds (arbre_id, upper(code));

-- Code automatique à la création depuis l'éditeur
create or replace function public.hotline_code_auto()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_base text;
  v_n int;
begin
  if coalesce(trim(new.code), '') <> '' then
    new.code := upper(trim(new.code));
    return new;
  end if;
  if tg_table_name = 'hotline_arbres' then
    v_base := (case new.filiere when 'PV' then 'PV' else 'TH' end) || '-' || (case new.motif when 'MISE_EN_SERVICE' then 'MES' else 'EXP' end) || '-';
    select coalesce(max(nullif(regexp_replace(code, '^.*-', ''), '')::int), 0) + 1 into v_n
    from public.hotline_arbres where code ~ ('^' || v_base || '[0-9]+$');
    new.code := v_base || v_n;
  else
    select coalesce(max(nullif(regexp_replace(code, '^Q', ''), '')::int), 0) + 1 into v_n
    from public.hotline_noeuds where arbre_id = new.arbre_id and code ~ '^Q[0-9]+$';
    new.code := 'Q' || v_n;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_hotline_arbres_code on public.hotline_arbres;
create trigger trg_hotline_arbres_code before insert or update of code on public.hotline_arbres
  for each row execute function public.hotline_code_auto();
drop trigger if exists trg_hotline_noeuds_code on public.hotline_noeuds;
create trigger trg_hotline_noeuds_code before insert or update of code on public.hotline_noeuds
  for each row execute function public.hotline_code_auto();

-- Import
create or replace function public.hotline_importer_parcours(p_parcours jsonb, p_simulation boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_err text[] := '{}';
  v_p jsonb;
  v_q jsonb;
  v_r jsonb;
  v_code text;
  v_codes_p text[] := '{}';
  v_codes_q text[];
  v_departs int;
  v_arbre uuid;
  v_ids jsonb;
  v_choix jsonb;
  v_racine uuid;
  v_crees int := 0;
  v_maj int := 0;
  v_nb_q int := 0;
  v_nb_r int := 0;
  v_nb_d int := 0;
  v_suppr int := 0;
  v_existe boolean;
  v_lot int;
begin
  if not public.hotline_est_expert() then
    raise exception 'Import des parcours réservé aux experts hotline.';
  end if;
  if jsonb_typeof(p_parcours) <> 'array' or jsonb_array_length(p_parcours) = 0 then
    return jsonb_build_object('ok', false, 'erreurs', jsonb_build_array('Aucun parcours dans le fichier (onglet « Parcours » vide).'));
  end if;

  -- 1. Contrôles ---------------------------------------------------------------
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    v_code := upper(trim(coalesce(v_p->>'code', '')));
    if v_code = '' then
      v_err := v_err || format('Parcours « %s » : code parcours manquant.', coalesce(v_p->>'nom', '?'));
      continue;
    end if;
    if v_code = any (v_codes_p) then
      v_err := v_err || format('Parcours %s : code présent deux fois dans l''onglet Parcours.', v_code);
    end if;
    v_codes_p := v_codes_p || v_code;
    if coalesce(v_p->>'filiere', '') not in ('PV', 'THERMIQUE') then
      v_err := v_err || format('Parcours %s : filière « %s » inconnue (PV ou THERMIQUE).', v_code, coalesce(v_p->>'filiere', ''));
    end if;
    if coalesce(v_p->>'motif', '') not in ('MISE_EN_SERVICE', 'EXPLOITATION') then
      v_err := v_err || format('Parcours %s : motif « %s » inconnu (MISE_EN_SERVICE ou EXPLOITATION).', v_code, coalesce(v_p->>'motif', ''));
    end if;
    if coalesce(trim(v_p->>'nom'), '') = '' then
      v_err := v_err || format('Parcours %s : nom manquant.', v_code);
    end if;
    if jsonb_array_length(coalesce(v_p->'questions', '[]'::jsonb)) = 0 then
      v_err := v_err || format('Parcours %s : aucune question (onglet Questions).', v_code);
      continue;
    end if;

    v_codes_q := '{}';
    v_departs := 0;
    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      if coalesce(trim(v_q->>'code'), '') = '' then
        v_err := v_err || format('Parcours %s : une question sans code.', v_code);
        continue;
      end if;
      if upper(trim(v_q->>'code')) = any (v_codes_q) then
        v_err := v_err || format('Parcours %s : question %s présente deux fois.', v_code, upper(trim(v_q->>'code')));
      end if;
      v_codes_q := v_codes_q || upper(trim(v_q->>'code'));
      if coalesce(trim(v_q->>'question'), '') = '' then
        v_err := v_err || format('Parcours %s, question %s : texte de la question manquant.', v_code, upper(trim(v_q->>'code')));
      end if;
      if coalesce((v_q->>'depart')::boolean, false) then v_departs := v_departs + 1; end if;
    end loop;
    if v_departs > 1 then
      v_err := v_err || format('Parcours %s : %s questions marquées « Départ » (une seule attendue).', v_code, v_departs);
    end if;

    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      for v_r in select * from jsonb_array_elements(coalesce(v_q->'reponses', '[]'::jsonb)) loop
        if coalesce(trim(v_r->>'libelle'), '') = '' then
          v_err := v_err || format('Parcours %s, question %s : réponse sans libellé.', v_code, upper(trim(v_q->>'code')));
        end if;
        if coalesce(trim(v_r->>'suivant'), '') <> '' and not (upper(trim(v_r->>'suivant')) = any (v_codes_q)) then
          v_err := v_err || format('Parcours %s, question %s, réponse « %s » : question suivante %s introuvable dans ce parcours.',
                                   v_code, upper(trim(v_q->>'code')), v_r->>'libelle', upper(trim(v_r->>'suivant')));
        end if;
      end loop;
    end loop;
  end loop;

  if array_length(v_err, 1) > 0 then
    return jsonb_build_object('ok', false, 'erreurs', to_jsonb(v_err[1:200]));
  end if;

  -- Bilan (simulation et import)
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    select exists (select 1 from public.hotline_arbres where upper(code) = upper(trim(v_p->>'code'))) into v_existe;
    if v_existe then v_maj := v_maj + 1; else v_crees := v_crees + 1; end if;
    v_nb_q := v_nb_q + jsonb_array_length(v_p->'questions');
    select coalesce(sum(jsonb_array_length(coalesce(q->'reponses', '[]'::jsonb))), 0), coalesce(sum(jsonb_array_length(coalesce(q->'documents', '[]'::jsonb))), 0)
      into v_lot, v_departs from jsonb_array_elements(v_p->'questions') q;
    v_nb_r := v_nb_r + v_lot;
    v_nb_d := v_nb_d + v_departs;
    if v_existe then
      select count(*) into v_lot from public.hotline_noeuds n
      join public.hotline_arbres a on a.id = n.arbre_id
      where upper(a.code) = upper(trim(v_p->>'code'))
        and not (upper(n.code) in (select upper(trim(q->>'code')) from jsonb_array_elements(v_p->'questions') q));
      v_suppr := v_suppr + v_lot;
    end if;
  end loop;

  if p_simulation then
    return jsonb_build_object('ok', true, 'simulation', true, 'parcours_crees', v_crees, 'parcours_maj', v_maj,
      'questions', v_nb_q, 'reponses', v_nb_r, 'documents', v_nb_d, 'questions_supprimees', v_suppr);
  end if;

  -- 2. Application ---------------------------------------------------------------
  for v_p in select * from jsonb_array_elements(p_parcours) loop
    v_code := upper(trim(v_p->>'code'));
    insert into public.hotline_arbres as a (code, filiere, motif, nom, famille, actif, publie_extranet, updated_at, updated_by)
    values (v_code, v_p->>'filiere', v_p->>'motif', trim(v_p->>'nom'), nullif(trim(coalesce(v_p->>'famille', '')), ''),
            coalesce((v_p->>'actif')::boolean, true), coalesce((v_p->>'publie_extranet')::boolean, false), now(), public.current_user_email())
    on conflict ((upper(code))) do update set
      filiere = excluded.filiere, motif = excluded.motif, nom = excluded.nom, famille = excluded.famille,
      actif = excluded.actif, publie_extranet = excluded.publie_extranet, updated_at = now(), updated_by = excluded.updated_by
    returning a.id into v_arbre;

    -- questions (sans les réponses : les identifiants des questions suivantes
    -- ne sont connus qu'après ce premier passage)
    insert into public.hotline_noeuds as n (arbre_id, code, question, aide, ordre, documents, choix, updated_at)
    select v_arbre, upper(trim(q->>'code')), trim(q->>'question'), nullif(trim(coalesce(q->>'aide', '')), ''),
           coalesce(nullif(q->>'ordre', '')::int, o.i::int),
           coalesce((select jsonb_agg(jsonb_build_object('titre', trim(d->>'titre'), 'type', coalesce(nullif(trim(d->>'type'), ''), 'PDF'), 'url', coalesce(trim(d->>'url'), '')))
                     from jsonb_array_elements(coalesce(q->'documents', '[]'::jsonb)) d where coalesce(trim(d->>'titre'), '') <> ''), '[]'::jsonb),
           '[]'::jsonb, now()
    from jsonb_array_elements(v_p->'questions') with ordinality o(q, i)
    on conflict (arbre_id, (upper(code))) do update set
      question = excluded.question, aide = excluded.aide, ordre = excluded.ordre, documents = excluded.documents, updated_at = now();

    delete from public.hotline_noeuds n
    where n.arbre_id = v_arbre
      and not (upper(n.code) in (select upper(trim(q->>'code')) from jsonb_array_elements(v_p->'questions') q));

    select jsonb_object_agg(upper(code), id) into v_ids from public.hotline_noeuds where arbre_id = v_arbre;

    for v_q in select * from jsonb_array_elements(v_p->'questions') loop
      select coalesce(jsonb_agg(jsonb_build_object(
               'libelle', trim(r->>'libelle'),
               'suivant', case when coalesce(trim(r->>'suivant'), '') <> '' then v_ids->>upper(trim(r->>'suivant')) end,
               'preconisation', coalesce(trim(r->>'preconisation'), ''),
               'escalade', coalesce((r->>'escalade')::boolean, false))), '[]'::jsonb)
      into v_choix
      from jsonb_array_elements(coalesce(v_q->'reponses', '[]'::jsonb)) r;
      update public.hotline_noeuds set choix = v_choix
      where arbre_id = v_arbre and upper(code) = upper(trim(v_q->>'code'));
    end loop;

    select (v_ids->>upper(trim(q->>'code')))::uuid into v_racine
    from jsonb_array_elements(v_p->'questions') with ordinality o(q, i)
    order by coalesce((q->>'depart')::boolean, false) desc, o.i
    limit 1;
    update public.hotline_arbres set noeud_racine = v_racine where id = v_arbre;
  end loop;

  return jsonb_build_object('ok', true, 'simulation', false, 'parcours_crees', v_crees, 'parcours_maj', v_maj,
    'questions', v_nb_q, 'reponses', v_nb_r, 'documents', v_nb_d, 'questions_supprimees', v_suppr);
end
$function$;

grant execute on function public.hotline_importer_parcours(jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
