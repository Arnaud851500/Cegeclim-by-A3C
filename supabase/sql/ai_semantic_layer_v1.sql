-- Assistant BI CEGECLIM - couche sémantique V1
-- À exécuter dans l'éditeur SQL Supabase avant d'activer l'administration du dictionnaire métier.

create table if not exists public.ai_semantic_entities (
  code text primary key,
  label text not null,
  description text not null default '',
  source_table text not null,
  source_filter jsonb not null default '{}'::jsonb,
  synonyms text[] not null default '{}'::text[],
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_semantic_fields (
  code text primary key,
  entity_code text not null references public.ai_semantic_entities(code) on delete cascade,
  label text not null,
  description text not null default '',
  source_expression text not null,
  data_type text not null default 'text' check (data_type in ('text','integer','number','currency','percent','date','boolean')),
  semantic_role text not null default 'dimension' check (semantic_role in ('dimension','measure','filter','identifier')),
  aggregation text null,
  synonyms text[] not null default '{}'::text[],
  is_sensitive boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_semantic_relationships (
  code text primary key,
  from_entity text not null references public.ai_semantic_entities(code) on delete cascade,
  to_entity text not null references public.ai_semantic_entities(code) on delete cascade,
  relationship_type text not null default 'many_to_one' check (relationship_type in ('one_to_one','one_to_many','many_to_one','many_to_many')),
  join_expression text not null,
  business_description text not null default '',
  prevents_fanout boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_semantic_metrics (
  code text primary key,
  label text not null,
  description text not null default '',
  entity_code text not null references public.ai_semantic_entities(code) on delete cascade,
  sql_expression text not null,
  format text not null default 'number' check (format in ('number','currency','percent','integer')),
  required_filters jsonb not null default '{}'::jsonb,
  caveats text not null default '',
  synonyms text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_business_rules (
  code text primary key,
  topic text not null,
  rule_text text not null,
  priority integer not null default 100,
  applies_to text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_analysis_templates (
  code text primary key,
  title text not null,
  description text not null default '',
  subject_code text not null,
  measures text[] not null default '{}'::text[],
  dimensions text[] not null default '{}'::text[],
  default_filters jsonb not null default '{}'::jsonb,
  visualization jsonb not null default '{}'::jsonb,
  prompt_suffix text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_saved_reports (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid(),
  name text not null,
  description text null,
  analysis_plan jsonb not null default '{}'::jsonb,
  last_result jsonb null,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_query_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null default auth.uid(),
  question text not null,
  analysis_plan jsonb not null default '{}'::jsonb,
  generated_sql text null,
  row_count integer null,
  duration_ms integer null,
  status text not null default 'success' check (status in ('success','error','cancelled')),
  error_message text null,
  created_at timestamptz not null default now()
);

create index if not exists ai_semantic_fields_entity_idx on public.ai_semantic_fields(entity_code);
create index if not exists ai_semantic_metrics_entity_idx on public.ai_semantic_metrics(entity_code);
create index if not exists ai_query_history_user_date_idx on public.ai_query_history(user_id, created_at desc);
create index if not exists ai_saved_reports_owner_idx on public.ai_saved_reports(owner_user_id, updated_at desc);

alter table public.ai_semantic_entities enable row level security;
alter table public.ai_semantic_fields enable row level security;
alter table public.ai_semantic_relationships enable row level security;
alter table public.ai_semantic_metrics enable row level security;
alter table public.ai_business_rules enable row level security;
alter table public.ai_analysis_templates enable row level security;
alter table public.ai_saved_reports enable row level security;
alter table public.ai_query_history enable row level security;

drop policy if exists ai_semantic_entities_read on public.ai_semantic_entities;
create policy ai_semantic_entities_read on public.ai_semantic_entities for select to authenticated using (is_active = true);
drop policy if exists ai_semantic_fields_read on public.ai_semantic_fields;
create policy ai_semantic_fields_read on public.ai_semantic_fields for select to authenticated using (is_active = true);
drop policy if exists ai_semantic_relationships_read on public.ai_semantic_relationships;
create policy ai_semantic_relationships_read on public.ai_semantic_relationships for select to authenticated using (is_active = true);
drop policy if exists ai_semantic_metrics_read on public.ai_semantic_metrics;
create policy ai_semantic_metrics_read on public.ai_semantic_metrics for select to authenticated using (is_active = true);
drop policy if exists ai_business_rules_read on public.ai_business_rules;
create policy ai_business_rules_read on public.ai_business_rules for select to authenticated using (is_active = true);
drop policy if exists ai_analysis_templates_read on public.ai_analysis_templates;
create policy ai_analysis_templates_read on public.ai_analysis_templates for select to authenticated using (is_active = true);

drop policy if exists ai_saved_reports_owner_select on public.ai_saved_reports;
create policy ai_saved_reports_owner_select on public.ai_saved_reports for select to authenticated using (owner_user_id = auth.uid() or is_shared = true);
drop policy if exists ai_saved_reports_owner_insert on public.ai_saved_reports;
create policy ai_saved_reports_owner_insert on public.ai_saved_reports for insert to authenticated with check (owner_user_id = auth.uid());
drop policy if exists ai_saved_reports_owner_update on public.ai_saved_reports;
create policy ai_saved_reports_owner_update on public.ai_saved_reports for update to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists ai_saved_reports_owner_delete on public.ai_saved_reports;
create policy ai_saved_reports_owner_delete on public.ai_saved_reports for delete to authenticated using (owner_user_id = auth.uid());

drop policy if exists ai_query_history_owner_select on public.ai_query_history;
create policy ai_query_history_owner_select on public.ai_query_history for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_query_history_owner_insert on public.ai_query_history;
create policy ai_query_history_owner_insert on public.ai_query_history for insert to authenticated with check (user_id = auth.uid());

insert into public.ai_semantic_entities (code, label, description, source_table, source_filter, synonyms, priority)
values
  ('ventes_bl', 'Ventes BL', 'Bons de livraison utilisés pour analyser les ventes livrées.', 'indicateur_activite_mensuel', '{"type_document":"BL","hors_statistique":false}', array['ventes','bons de livraison','bl'], 10),
  ('factures', 'Factures', 'Chiffre d’affaires facturé et marge.', 'indicateur_factures_mensuel', '{"hors_statistique":false}', array['facturation','ca facturé'], 20),
  ('devis', 'Devis', 'Devis commerciaux mensuels.', 'indicateur_devis_mensuel', '{"hors_statistique":false}', array['offres','propositions commerciales'], 30),
  ('portefeuille', 'Portefeuille', 'CDC, PL, BL et BR présents dans l’activité.', 'indicateur_activite_mensuel', '{"hors_statistique":false}', array['commandes','encours','carnet de commandes'], 40),
  ('flux_articles', 'Flux articles', 'Flux mensuels avec référence et désignation article.', 'indicateur_flux_articles_mensuel', '{"hors_statistique":false}', array['articles','références','produits'], 50)
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  source_table = excluded.source_table,
  source_filter = excluded.source_filter,
  synonyms = excluded.synonyms,
  priority = excluded.priority,
  updated_at = now();

insert into public.ai_semantic_fields (code, entity_code, label, description, source_expression, data_type, semantic_role, aggregation, synonyms)
values
  ('ventes_bl.mois','ventes_bl','Mois','Mois du document BL.','mois','integer','dimension',null,array['mois de vente']),
  ('ventes_bl.annee','ventes_bl','Année','Année du document BL.','annee','integer','dimension',null,array['année de vente']),
  ('ventes_bl.agence','ventes_bl','Agence','Agence rattachée au collaborateur.','agence_collaborateur','text','dimension',null,array['agence commerciale']),
  ('ventes_bl.departement_client','ventes_bl','Département client','Département rattaché au tiers.','departement_tiers','text','dimension',null,array['département tiers','territoire client']),
  ('ventes_bl.famille_macro','ventes_bl','Famille macro','Regroupement supérieur de la famille article.','famille_macro','text','dimension',null,array['macro famille','univers produit']),
  ('ventes_bl.famille','ventes_bl','Famille','Famille de la référence article.','famille','text','dimension',null,array['famille article']),
  ('ventes_bl.client','ventes_bl','Client','Intitulé du tiers.','intitule_tiers','text','dimension',null,array['tiers']),
  ('flux_articles.reference','flux_articles','Référence article','Code de la référence.','reference_article','text','dimension',null,array['article','référence']),
  ('flux_articles.designation','flux_articles','Désignation','Désignation de la référence article.','designation','text','dimension',null,array['libellé article']),
  ('factures.agence','factures','Agence','Agence rattachée au collaborateur.','agence_collaborateur','text','dimension',null,array['agence commerciale']),
  ('factures.client','factures','Client','Intitulé du tiers facturé.','intitule_tiers','text','dimension',null,array['tiers']),
  ('devis.agence','devis','Agence','Agence rattachée au collaborateur.','agence_collaborateur','text','dimension',null,array['agence commerciale']),
  ('portefeuille.type_document','portefeuille','Type de document','CDC, PL, BL, BR ou BL M-x.','type_document','text','dimension',null,array['document','statut portefeuille'])
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  source_expression = excluded.source_expression,
  data_type = excluded.data_type,
  semantic_role = excluded.semantic_role,
  aggregation = excluded.aggregation,
  synonyms = excluded.synonyms,
  updated_at = now();

insert into public.ai_semantic_metrics (code, label, description, entity_code, sql_expression, format, required_filters, caveats, synonyms)
values
  ('ventes_bl.ca_ht','CA HT BL','Somme du chiffre d’affaires HT des BL.','ventes_bl','sum(ca_ht)','currency','{"type_document":"BL","hors_statistique":false}','Les BL sont une mesure de ventes livrées et non nécessairement facturées.',array['ventes','chiffre d’affaires bl']),
  ('ventes_bl.quantite','Quantité BL','Somme des quantités livrées.','ventes_bl','sum(quantite)','number','{"type_document":"BL","hors_statistique":false}','Vérifier la pertinence des unités entre familles.',array['volume bl']),
  ('ventes_bl.marge_valeur','Marge BL €','Somme de la marge des BL.','ventes_bl','sum(marge_valeur)','currency','{"type_document":"BL","hors_statistique":false}','Disponible uniquement si la marge est alimentée dans l’agrégat.',array['marge valeur']),
  ('ventes_bl.marge_pct','Marge BL %','Marge pondérée des BL.','ventes_bl','case when sum(ca_ht) <> 0 then sum(marge_valeur) / sum(ca_ht) * 100 else 0 end','percent','{"type_document":"BL","hors_statistique":false}','Ne jamais faire la moyenne simple des pourcentages de marge.',array['taux de marge']),
  ('factures.ca_ht','CA facturé HT','Somme du chiffre d’affaires HT facturé.','factures','sum(ca_ht)','currency','{"hors_statistique":false}','',array['facturation','ca facturé']),
  ('factures.marge_pct','Marge facturée %','Marge facturée pondérée.','factures','case when sum(ca_ht) <> 0 then sum(marge_valeur) / sum(ca_ht) * 100 else 0 end','percent','{"hors_statistique":false}','Ne jamais faire la moyenne simple des pourcentages de marge.',array['taux de marge facturé']),
  ('devis.ca_ht','Montant devis HT','Somme du montant HT des devis.','devis','sum(ca_ht)','currency','{"hors_statistique":false}','Le montant de devis ne mesure pas à lui seul la transformation.',array['valeur devis']),
  ('portefeuille.ca_ht','Portefeuille HT','Somme du montant HT des documents d’activité sélectionnés.','portefeuille','sum(ca_ht)','currency','{"hors_statistique":false}','Toujours afficher ou filtrer le type de document pour éviter les confusions.',array['encours','carnet de commandes'])
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  entity_code = excluded.entity_code,
  sql_expression = excluded.sql_expression,
  format = excluded.format,
  required_filters = excluded.required_filters,
  caveats = excluded.caveats,
  synonyms = excluded.synonyms,
  updated_at = now();

insert into public.ai_business_rules (code, topic, rule_text, priority, applies_to)
values
  ('agence_rattachement','Agence','L’agence métier est en priorité l’agence du collaborateur de rattachement du client, sauf demande explicite sur le collaborateur du document.',10,array['ventes_bl','factures','devis','portefeuille']),
  ('famille_macro','Article','La famille macro provient du référentiel familles relié à la référence article.',20,array['ventes_bl','factures','devis','flux_articles']),
  ('reference_source','Article','Toute analyse par référence article ou désignation doit utiliser indicateur_flux_articles_mensuel.',30,array['flux_articles','ventes_bl']),
  ('marge_ponderee','Marge','La marge en pourcentage est toujours calculée par somme(marge_valeur) / somme(ca_ht), jamais par moyenne des taux.',5,array['ventes_bl','factures','devis','portefeuille']),
  ('hors_statistique','Périmètre','Par défaut, exclure les lignes hors_statistique en appliquant hors_statistique = false.',5,array['ventes_bl','factures','devis','portefeuille','flux_articles']),
  ('correlation','Analyse IA','Présenter une corrélation comme une association statistique et non comme une causalité.',10,array['ventes_bl','factures','devis','portefeuille','flux_articles'])
on conflict (code) do update set
  topic = excluded.topic,
  rule_text = excluded.rule_text,
  priority = excluded.priority,
  applies_to = excluded.applies_to,
  updated_at = now();

insert into public.ai_analysis_templates (code, title, description, subject_code, measures, dimensions, default_filters, visualization, prompt_suffix)
values
  ('ventes_mensuelles_agence','Ventes mensuelles par agence','CA BL et quantités mois par mois et par agence.','ventes_bl',array['ca_ht','quantite'],array['mois','agence_collaborateur'],'{"type_document":"BL","hors_statistique":false}','{"type":"histogramme_empile","x":"mois","series":"agence_collaborateur","value":"ca_ht"}',''),
  ('ventes_reference_agence_departement','Ventes par référence, agence et département','Tableau détaillé des ventes BL par territoire client.','ventes_bl',array['ca_ht','quantite'],array['mois','reference_article','agence_collaborateur','departement_tiers'],'{"type_document":"BL","hors_statistique":false}','{"type":"tableau"}','Présenter d’abord une synthèse par agence, puis le détail par référence et département.'),
  ('mix_famille_marge','Mix familles et marge','Recherche des différences de mix et de marge entre agences.','factures',array['ca_ht','marge_pct'],array['agence_collaborateur','famille_macro'],'{"hors_statistique":false}','{"type":"histogramme_empile"}','Signaler les associations significatives sans conclure à un lien de causalité.'),
  ('top_clients','Top clients contributeurs','Classement des clients par CA et marge.','factures',array['ca_ht','marge_pct'],array['intitule_tiers','agence_collaborateur','famille_macro'],'{"hors_statistique":false}','{"type":"tableau","top_n":30}','Limiter le résultat aux 30 principaux clients par CA HT.')
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  subject_code = excluded.subject_code,
  measures = excluded.measures,
  dimensions = excluded.dimensions,
  default_filters = excluded.default_filters,
  visualization = excluded.visualization,
  prompt_suffix = excluded.prompt_suffix,
  updated_at = now();

create or replace function public.ai_semantic_context()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'entities', coalesce((select jsonb_agg(to_jsonb(e) order by e.priority, e.code) from public.ai_semantic_entities e where e.is_active), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(to_jsonb(f) order by f.entity_code, f.code) from public.ai_semantic_fields f where f.is_active), '[]'::jsonb),
    'metrics', coalesce((select jsonb_agg(to_jsonb(m) order by m.entity_code, m.code) from public.ai_semantic_metrics m where m.is_active), '[]'::jsonb),
    'relationships', coalesce((select jsonb_agg(to_jsonb(r) order by r.code) from public.ai_semantic_relationships r where r.is_active), '[]'::jsonb),
    'business_rules', coalesce((select jsonb_agg(to_jsonb(b) order by b.priority, b.code) from public.ai_business_rules b where b.is_active), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.code) from public.ai_analysis_templates t where t.is_active), '[]'::jsonb)
  );
$$;

grant execute on function public.ai_semantic_context() to authenticated;

comment on function public.ai_semantic_context() is 'Retourne le dictionnaire métier CEGECLIM utilisé par l’Assistant BI.';
