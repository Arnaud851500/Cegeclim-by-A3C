export type SemanticSubjectKey =
  | 'ventes_bl'
  | 'factures'
  | 'devis'
  | 'portefeuille'
  | 'clients'
  | 'articles'

export type SemanticMeasureKey =
  | 'ca_ht'
  | 'quantite'
  | 'marge_valeur'
  | 'marge_pct'
  | 'nb_lignes'
  | 'panier_moyen'
  | 'nb_clients_crees'

export type SemanticDimensionKey =
  | 'mois'
  | 'annee'
  | 'annee_creation_client'
  | 'agence_collaborateur'
  | 'depot'
  | 'collaborateur_facture'
  | 'collaborateur_tiers'
  | 'departement_tiers'
  | 'famille_macro'
  | 'famille'
  | 'classe_abc_ca'
  | 'classe_abc_lignes'
  | 'numero_tiers'
  | 'intitule_tiers'
  | 'reference_article'
  | 'designation'
  | 'type_document'

export type SemanticVisualizationKey =
  | 'tableau'
  | 'courbe'
  | 'histogramme'
  | 'histogramme_empile'
  | 'camembert'

export type SemanticSubject = {
  key: SemanticSubjectKey
  label: string
  description: string
  sourceHint: string
  defaultMeasures: SemanticMeasureKey[]
  defaultDimensions: SemanticDimensionKey[]
  suggestedDimensions: SemanticDimensionKey[]
}

export type SemanticDefinition = {
  key: string
  label: string
  description: string
  sqlHint?: string
}

export type AnalysisTemplate = {
  id: string
  title: string
  description: string
  subject: SemanticSubjectKey
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
  visualization: SemanticVisualizationKey
  promptSuffix?: string
}

export const SUBJECTS: SemanticSubject[] = [
  {
    key: 'ventes_bl',
    label: 'Ventes BL',
    description: 'Analyse les marchandises livrées : CA, quantités, références, clients et mix produit.',
    sourceHint: "Utiliser les bons de livraison uniquement. Les analyses simples viennent de l’agrégat activité ; les croisements Référence × Agence/Client utilisent les lignes de BL et les référentiels.",
    defaultMeasures: ['ca_ht', 'quantite'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'famille_macro', 'famille', 'numero_tiers', 'intitule_tiers', 'reference_article'],
  },
  {
    key: 'factures',
    label: 'Factures',
    description: 'Analyse le chiffre d’affaires réellement facturé, les quantités et la marge.',
    sourceHint: 'Utiliser l’agrégat factures. Si une référence ou une classe ABC est demandée, utiliser les lignes de factures enrichies par les référentiels articles et ABC.',
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'collaborateur_facture', 'famille_macro', 'famille', 'classe_abc_ca', 'intitule_tiers'],
  },
  {
    key: 'devis',
    label: 'Devis',
    description: 'Analyse les propositions commerciales émises, leur valeur et leur répartition.',
    sourceHint: 'Utiliser l’agrégat devis. Les détails par référence utilisent les lignes de devis enrichies par les référentiels.',
    defaultMeasures: ['ca_ht', 'nb_lignes'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['collaborateur_facture', 'departement_tiers', 'famille_macro', 'famille', 'intitule_tiers'],
  },
  {
    key: 'portefeuille',
    label: 'Portefeuille de commandes',
    description: 'Analyse les documents encore présents dans l’activité : CDC, PL, BL et BR.',
    sourceHint: 'Utiliser l’activité mensuelle avec le type de document comme filtre ou dimension. Ce sujet ne représente pas le CA facturé.',
    defaultMeasures: ['ca_ht'],
    defaultDimensions: ['type_document', 'agence_collaborateur'],
    suggestedDimensions: ['mois', 'collaborateur_facture', 'departement_tiers', 'famille_macro', 'intitule_tiers'],
  },
  {
    key: 'clients',
    label: 'Clients',
    description: 'Analyse la création, la contribution, le panier, le mix familles et la marge des clients.',
    sourceHint: 'Pour les ventes clients, utiliser les agrégats de factures. Pour les nouveaux clients, utiliser ref_tiers.date_creation et rattacher l’agence via le représentant du client.',
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['intitule_tiers', 'agence_collaborateur'],
    suggestedDimensions: ['annee_creation_client', 'numero_tiers', 'departement_tiers', 'famille_macro', 'famille', 'mois'],
  },
  {
    key: 'articles',
    label: 'Articles et familles',
    description: 'Analyse les références, désignations, familles, classes ABC et familles macro.',
    sourceHint: 'Utiliser l’agrégat flux articles. Les croisements avec agence/client nécessitent les lignes détaillées et les référentiels.',
    defaultMeasures: ['ca_ht', 'quantite', 'marge_pct'],
    defaultDimensions: ['reference_article', 'famille_macro'],
    suggestedDimensions: ['designation', 'famille', 'classe_abc_ca', 'classe_abc_lignes', 'mois', 'depot', 'collaborateur_tiers'],
  },
]

export const MEASURES: SemanticDefinition[] = [
  { key: 'ca_ht', label: 'CA HT', description: 'Somme du montant HT.', sqlHint: 'sum(ca_ht)' },
  { key: 'quantite', label: 'Quantité', description: 'Somme des quantités.', sqlHint: 'sum(quantite)' },
  { key: 'marge_valeur', label: 'Marge €', description: 'Somme de la marge en valeur.', sqlHint: 'sum(marge_valeur)' },
  {
    key: 'marge_pct',
    label: 'Marge %',
    description: 'Marge pondérée par le CA.',
    sqlHint: 'case when sum(ca_ht) <> 0 then sum(marge_valeur) / sum(ca_ht) * 100 else 0 end',
  },
  { key: 'nb_lignes', label: 'Nombre de lignes', description: 'Somme ou décompte des lignes selon la source.', sqlHint: 'sum(nb_lignes)' },
  {
    key: 'panier_moyen',
    label: 'Panier moyen',
    description: 'CA divisé par le nombre de documents distincts lorsque la source détaillée le permet.',
  },
  {
    key: 'nb_clients_crees',
    label: 'Nouveaux clients',
    description: 'Nombre distinct de clients dont la date de création appartient à la période.',
  },
]

export const DIMENSIONS: SemanticDefinition[] = [
  { key: 'mois', label: 'Mois', description: 'Mois du document, de 1 à 12.' },
  { key: 'annee', label: 'Année', description: 'Année du document.' },
  { key: 'annee_creation_client', label: 'Année de création client', description: 'Année issue de ref_tiers.date_creation.' },
  { key: 'agence_collaborateur', label: 'Agence', description: 'Agence du représentant rattaché au client.' },
  { key: 'depot', label: 'Dépôt', description: 'Dépôt logistique ou commercial du document.' },
  { key: 'collaborateur_facture', label: 'Collaborateur du document', description: 'Collaborateur porté par le document.' },
  { key: 'collaborateur_tiers', label: 'Collaborateur du client', description: 'Représentant de rattachement du tiers.' },
  { key: 'departement_tiers', label: 'Département client', description: 'Département calculé depuis le code postal du tiers.' },
  { key: 'famille_macro', label: 'Famille macro', description: 'Regroupement métier supérieur de la famille article.' },
  { key: 'famille', label: 'Famille', description: 'Famille de la référence article.' },
  { key: 'classe_abc_ca', label: 'Classe ABC CA', description: 'Classe A/B/C actuelle calculée dans la projection stock selon le CA BL YTD.' },
  { key: 'classe_abc_lignes', label: 'Classe ABC lignes', description: 'Classe A/B/C actuelle calculée selon le nombre de lignes BL YTD.' },
  { key: 'numero_tiers', label: 'Code client', description: 'Identifiant du tiers.' },
  { key: 'intitule_tiers', label: 'Client', description: 'Nom ou intitulé du tiers.' },
  { key: 'reference_article', label: 'Référence article', description: 'Code de la référence article.' },
  { key: 'designation', label: 'Désignation', description: 'Désignation de la référence article.' },
  { key: 'type_document', label: 'Type de document', description: 'DEVIS, CDC, PL, BL, BR ou FACTURE selon la source.' },
]

export const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
  {
    id: 'ventes-mensuelles-agence',
    title: 'Ventes mensuelles par agence',
    description: 'CA BL et quantités, mois par mois et par agence.',
    subject: 'ventes_bl',
    measures: ['ca_ht', 'quantite'],
    dimensions: ['mois', 'agence_collaborateur'],
    visualization: 'histogramme_empile',
  },
  {
    id: 'ventes-reference-agence-departement',
    title: 'Ventes par référence, agence et département',
    description: 'Tableau détaillé des ventes BL par article et territoire client.',
    subject: 'ventes_bl',
    measures: ['ca_ht', 'quantite'],
    dimensions: ['mois', 'reference_article', 'agence_collaborateur', 'departement_tiers'],
    visualization: 'tableau',
  },
  {
    id: 'mix-famille-marge',
    title: 'Mix familles et marge',
    description: 'Compare le mix familles et la marge entre agences.',
    subject: 'factures',
    measures: ['ca_ht', 'marge_pct'],
    dimensions: ['agence_collaborateur', 'famille_macro'],
    visualization: 'histogramme_empile',
  },
  {
    id: 'nouveaux-clients-agence',
    title: 'Nouveaux clients par agence',
    description: 'Nombre de clients créés par année et agence de rattachement.',
    subject: 'clients',
    measures: ['nb_clients_crees'],
    dimensions: ['annee_creation_client', 'agence_collaborateur'],
    visualization: 'histogramme_empile',
    promptSuffix: 'Exclure les prospects sauf choix contraire explicite.',
  },
  {
    id: 'factures-abc-ca',
    title: 'CA facturé par classe ABC',
    description: 'Répartit le CA facturé selon la classe ABC CA actuelle des articles.',
    subject: 'factures',
    measures: ['ca_ht'],
    dimensions: ['classe_abc_ca'],
    visualization: 'histogramme',
    promptSuffix: 'Préciser que la classe ABC est la classe actuelle de la projection stock et non une classe historique à la date de facture.',
  },
  {
    id: 'top-clients',
    title: 'Top clients contributeurs',
    description: 'Classe les clients par CA et marge avec leur agence et leur famille principale.',
    subject: 'clients',
    measures: ['ca_ht', 'marge_pct'],
    dimensions: ['intitule_tiers', 'agence_collaborateur', 'famille_macro'],
    visualization: 'tableau',
    promptSuffix: 'Limiter le résultat aux 30 principaux clients par CA HT.',
  },
  {
    id: 'portefeuille-agence-document',
    title: 'Portefeuille par agence et document',
    description: 'Répartition mensuelle du portefeuille entre CDC, PL, BL et BR.',
    subject: 'portefeuille',
    measures: ['ca_ht'],
    dimensions: ['mois', 'agence_collaborateur', 'type_document'],
    visualization: 'histogramme_empile',
  },
]

export const CEGECLIM_BUSINESS_RULES = [
  'Famille macro et famille proviennent du référentiel familles relié aux références article.',
  'L’agence métier est en priorité l’agence du représentant rattaché au client.',
  'Pour les ventes livrées, filtrer type_document = BL.',
  'Marge % doit être calculée comme une marge pondérée : somme marge / somme CA.',
  'Par défaut, exclure les articles hors statistiques après confirmation utilisateur.',
  'La classe ABC utilisée dans les analyses de factures est la classe actuelle de la projection stock, sauf création ultérieure d’un historique ABC daté.',
  'Une corrélation doit être présentée comme une association et non comme une causalité.',
]

function labelsFor(keys: string[], definitions: SemanticDefinition[]) {
  const dictionary = new Map(definitions.map((item) => [item.key, item.label]))
  return keys.map((key) => dictionary.get(key) || key)
}

export function getSubject(key: SemanticSubjectKey) {
  return SUBJECTS.find((item) => item.key === key) || SUBJECTS[0]
}

export function buildGuidedQuestion(input: {
  subject: SemanticSubjectKey
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
  visualization: SemanticVisualizationKey
  dateStart?: string
  dateEnd?: string
  freeText?: string
  promptSuffix?: string
}) {
  const subject = getSubject(input.subject)
  const measureLabels = labelsFor(input.measures, MEASURES)
  const dimensionLabels = labelsFor(input.dimensions, DIMENSIONS)
  const period = input.dateStart || input.dateEnd
    ? `sur la période ${input.dateStart || 'début disponible'} au ${input.dateEnd || 'dernier mois disponible'}`
    : 'sur la période disponible correspondant aux filtres'

  return [
    `Analyse ${subject.label} ${period}.`,
    `Mesures demandées : ${measureLabels.join(', ')}.`,
    `Niveaux de détail : ${dimensionLabels.join(', ')}.`,
    `Restitution souhaitée : ${input.visualization}.`,
    `Règle de source : ${subject.sourceHint}`,
    input.freeText ? `Précision utilisateur : ${input.freeText}` : '',
    input.promptSuffix || '',
    'Retourne des données agrégées et une synthèse métier courte. Propose ensuite deux approfondissements pertinents.',
  ].filter(Boolean).join('\n')
}
