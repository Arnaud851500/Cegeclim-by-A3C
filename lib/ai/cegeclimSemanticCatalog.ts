export type SemanticEnvironmentKey =
  | 'pilotage_commercial'
  | 'clients_territoires'
  | 'produits_articles'
  | 'stocks_approvisionnements'
  | 'controles_actions'

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

export type SemanticEnvironment = {
  key: SemanticEnvironmentKey
  label: string
  description: string
  icon: string
  subjects: SemanticSubjectKey[]
  examples: string[]
}

export type SemanticSubject = {
  key: SemanticSubjectKey
  environment: SemanticEnvironmentKey
  label: string
  description: string
  sourceHint: string
  aliases: string[]
  defaultMeasures: SemanticMeasureKey[]
  defaultDimensions: SemanticDimensionKey[]
  suggestedDimensions: SemanticDimensionKey[]
  supportedMeasures: SemanticMeasureKey[]
  supportedDimensions: SemanticDimensionKey[]
}

export type SemanticDefinition = {
  key: string
  label: string
  description: string
  aliases?: string[]
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

const COMMON_MEASURES: SemanticMeasureKey[] = [
  'ca_ht',
  'quantite',
  'marge_valeur',
  'marge_pct',
  'nb_lignes',
  'panier_moyen',
]

const COMMON_DIMENSIONS: SemanticDimensionKey[] = [
  'mois',
  'annee',
  'agence_collaborateur',
  'depot',
  'collaborateur_facture',
  'collaborateur_tiers',
  'departement_tiers',
  'famille_macro',
  'famille',
  'numero_tiers',
  'intitule_tiers',
  'reference_article',
  'designation',
  'type_document',
]

export const ENVIRONMENTS: SemanticEnvironment[] = [
  {
    key: 'pilotage_commercial',
    label: 'Pilotage commercial',
    description: 'Ventes livrées, facturation, devis et portefeuille de commandes.',
    icon: '€',
    subjects: ['ventes_bl', 'factures', 'devis', 'portefeuille'],
    examples: [
      'Évolution du CA facturé par agence',
      'Top clients en BL sur les trois derniers mois',
      'Portefeuille CDC et PL par dépôt',
    ],
  },
  {
    key: 'clients_territoires',
    label: 'Clients et territoires',
    description: 'Création, contribution et implantation des clients par agence ou département.',
    icon: 'CL',
    subjects: ['clients', 'factures', 'ventes_bl'],
    examples: [
      'Nouveaux clients par agence',
      'CA par département client',
      'Clients sans activité récente',
    ],
  },
  {
    key: 'produits_articles',
    label: 'Produits et articles',
    description: 'Références, familles, mix produit, quantités, marge et classes ABC.',
    icon: 'PR',
    subjects: ['articles', 'ventes_bl', 'factures', 'devis'],
    examples: [
      'Top références R/R par quantité',
      'Mix famille macro et marge',
      'CA par classe ABC actuelle',
    ],
  },
  {
    key: 'stocks_approvisionnements',
    label: 'Stocks et approvisionnements',
    description: 'Analyse article et préparation des extensions stock, ruptures et commandes fournisseurs.',
    icon: 'ST',
    subjects: ['articles'],
    examples: [
      'Articles les plus contributeurs',
      'Références par classe ABC',
      'Analyse des quantités par dépôt',
    ],
  },
  {
    key: 'controles_actions',
    label: 'Contrôles et actions',
    description: 'Analyse des documents et préparation des contrôles opérationnels et plans d’action.',
    icon: 'OK',
    subjects: ['portefeuille'],
    examples: [
      'BL à analyser par agence',
      'Répartition des documents par type',
      'Volumes d’activité par dépôt',
    ],
  },
]

export const SUBJECTS: SemanticSubject[] = [
  {
    key: 'ventes_bl',
    environment: 'pilotage_commercial',
    label: 'Ventes BL',
    description: 'Marchandises livrées : CA, quantités, références, clients et mix produit.',
    sourceHint: 'Utiliser l’agrégat activité pour les analyses générales et Flux Articles filtré sur BL lorsqu’une famille ou une référence est demandée.',
    aliases: ['ventes', 'livraisons', 'bons de livraison', 'bl', 'sorties', 'marchandises livrées'],
    defaultMeasures: ['ca_ht', 'quantite'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: COMMON_DIMENSIONS,
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'factures',
    environment: 'pilotage_commercial',
    label: 'Factures',
    description: 'Chiffre d’affaires facturé, quantités et marge.',
    sourceHint: 'Utiliser l’agrégat factures pour les analyses générales et Flux Articles filtré sur FACTURE pour les analyses famille/article.',
    aliases: ['facture', 'factures', 'facturation', 'ca facturé', 'chiffre d’affaires facturé'],
    defaultMeasures: ['ca_ht', 'marge_valeur'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: COMMON_DIMENSIONS,
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'devis',
    environment: 'pilotage_commercial',
    label: 'Devis',
    description: 'Propositions commerciales émises, valeur, quantités et répartition.',
    sourceHint: 'Utiliser l’agrégat devis pour les analyses générales et Flux Articles filtré sur DEVIS pour les analyses famille/article.',
    aliases: ['devis', 'offres', 'propositions commerciales', 'pipeline devis'],
    defaultMeasures: ['ca_ht', 'nb_lignes'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: COMMON_DIMENSIONS,
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'portefeuille',
    environment: 'pilotage_commercial',
    label: 'Portefeuille de commandes',
    description: 'Documents encore présents dans l’activité : CDC, PL, BL et BR.',
    sourceHint: 'Utiliser l’activité et les documents du portefeuille selon les types sélectionnés.',
    aliases: ['portefeuille', 'encours', 'commandes', 'cdc', 'préparations', 'pl', 'br'],
    defaultMeasures: ['ca_ht', 'quantite'],
    defaultDimensions: ['mois', 'type_document'],
    suggestedDimensions: COMMON_DIMENSIONS,
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'clients',
    environment: 'clients_territoires',
    label: 'Clients',
    description: 'Création, contribution, panier, mix familles et marge des clients.',
    sourceHint: 'Utiliser ref_tiers pour les créations et la facturation détaillée pour la contribution et le mix client.',
    aliases: ['clients', 'tiers', 'prospects', 'nouveaux clients', 'créations clients'],
    defaultMeasures: ['nb_clients_crees'],
    defaultDimensions: ['annee_creation_client', 'agence_collaborateur'],
    suggestedDimensions: ['annee_creation_client', 'annee', 'mois', 'agence_collaborateur', 'collaborateur_tiers', 'departement_tiers', 'numero_tiers', 'intitule_tiers', 'famille_macro'],
    supportedMeasures: [...COMMON_MEASURES, 'nb_clients_crees'],
    supportedDimensions: [...COMMON_DIMENSIONS, 'annee_creation_client'],
  },
  {
    key: 'articles',
    environment: 'produits_articles',
    label: 'Articles et familles',
    description: 'Références, désignations, familles, classes ABC et familles macro.',
    sourceHint: 'Utiliser exclusivement indicateur_flux_articles_mensuel, avec choix explicite du flux FACTURE, BL, DEVIS, CDC ou de tous les flux. Ne jamais basculer silencieusement sur activite_lignes.',
    aliases: ['articles', 'références', 'produits', 'familles', 'famille macro', 'abc', 'sku'],
    defaultMeasures: ['quantite'],
    defaultDimensions: ['famille_macro', 'famille'],
    suggestedDimensions: ['mois', 'annee', 'agence_collaborateur', 'depot', 'collaborateur_tiers', 'famille_macro', 'famille', 'reference_article', 'designation', 'type_document', 'classe_abc_ca', 'classe_abc_lignes'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: ['mois', 'annee', 'agence_collaborateur', 'depot', 'collaborateur_tiers', 'famille_macro', 'famille', 'reference_article', 'designation', 'type_document', 'classe_abc_ca', 'classe_abc_lignes'],
  },
]

export const MEASURES: SemanticDefinition[] = [
  { key: 'ca_ht', label: 'CA HT', description: 'Somme du chiffre d’affaires hors taxes.', aliases: ['ca', 'chiffre d’affaires', 'montant ht', 'ventes', 'valeur'], sqlHint: 'SUM(ca_ht)' },
  { key: 'quantite', label: 'Quantité', description: 'Somme des quantités du sujet.', aliases: ['quantité', 'quantités', 'volume', 'volumes', 'unités'], sqlHint: 'SUM(quantite)' },
  { key: 'marge_valeur', label: 'Marge €', description: 'Marge totale en valeur.', aliases: ['marge', 'marge euro', 'marge valeur'], sqlHint: 'SUM(marge_valeur)' },
  { key: 'marge_pct', label: 'Marge %', description: 'Marge pondérée : marge totale divisée par CA total.', aliases: ['taux de marge', 'marge pourcentage', 'marge %'], sqlHint: 'SUM(marge_valeur) / NULLIF(SUM(ca_ht), 0) * 100' },
  { key: 'nb_lignes', label: 'Nombre de lignes', description: 'Nombre ou somme des lignes selon la source.', aliases: ['nombre de lignes', 'nb lignes', 'lignes'], sqlHint: 'SUM(nb_lignes)' },
  { key: 'panier_moyen', label: 'Panier moyen', description: 'CA divisé par le nombre de lignes ou documents disponibles.', aliases: ['panier', 'panier moyen', 'ticket moyen'], sqlHint: 'SUM(ca_ht) / NULLIF(SUM(nb_lignes), 0)' },
  { key: 'nb_clients_crees', label: 'Nouveaux clients', description: 'Nombre de clients distincts créés selon ref_tiers.date_creation.', aliases: ['nouveaux clients', 'clients créés', 'créations clients'], sqlHint: 'COUNT(DISTINCT ref_tiers.numero)' },
]

export const DIMENSIONS: SemanticDefinition[] = [
  { key: 'mois', label: 'Mois', description: 'Mois numérique de 1 à 12.', aliases: ['mois', 'mensuel', 'mois par mois'] },
  { key: 'annee', label: 'Année', description: 'Année du document ou du flux.', aliases: ['année', 'an', 'annuel'] },
  { key: 'annee_creation_client', label: 'Année de création client', description: 'Année issue de ref_tiers.date_creation.', aliases: ['année de création', 'ancienneté client'] },
  { key: 'agence_collaborateur', label: 'Agence', description: 'Agence du collaborateur rattaché au client.', aliases: ['agence', 'agence de rattachement', 'agence client'] },
  { key: 'depot', label: 'Dépôt', description: 'Dépôt porté par le document ou le flux.', aliases: ['dépôt', 'depot', 'stockage'] },
  { key: 'collaborateur_facture', label: 'Collaborateur du document', description: 'Collaborateur porté directement par le document.', aliases: ['commercial document', 'vendeur facture', 'collaborateur facture'] },
  { key: 'collaborateur_tiers', label: 'Collaborateur du client', description: 'Représentant ou collaborateur rattaché au tiers.', aliases: ['commercial client', 'représentant client', 'collaborateur tiers'] },
  { key: 'departement_tiers', label: 'Département client', description: 'Département calculé depuis le code postal du client.', aliases: ['département', 'territoire', 'zone géographique'] },
  { key: 'famille_macro', label: 'Famille macro', description: 'Regroupement principal des familles articles.', aliases: ['famille macro', 'macro famille', 'univers produit'] },
  { key: 'famille', label: 'Famille', description: 'Famille de l’article.', aliases: ['famille', 'famille article'] },
  { key: 'classe_abc_ca', label: 'Classe ABC CA', description: 'Classe ABC CA actuelle issue de la projection stock.', aliases: ['abc ca', 'classe abc chiffre d’affaires'] },
  { key: 'classe_abc_lignes', label: 'Classe ABC lignes', description: 'Classe ABC lignes actuelle issue de la projection stock.', aliases: ['abc lignes', 'classe abc lignes'] },
  { key: 'numero_tiers', label: 'Code client', description: 'Numéro ou code du tiers.', aliases: ['code client', 'numéro client', 'tiers'] },
  { key: 'intitule_tiers', label: 'Client', description: 'Nom ou intitulé du tiers.', aliases: ['client', 'raison sociale', 'intitulé client'] },
  { key: 'reference_article', label: 'Référence article', description: 'Référence de l’article.', aliases: ['référence', 'article', 'sku', 'code article'] },
  { key: 'designation', label: 'Désignation', description: 'Libellé de l’article.', aliases: ['désignation', 'libellé article', 'produit'] },
  { key: 'type_document', label: 'Type de document', description: 'Flux ou type de document : facture, devis, CDC, BL, BR ou PL.', aliases: ['document', 'flux', 'type de pièce'] },
]

export const ANALYSIS_TEMPLATES: AnalysisTemplate[] = [
  { id: 'ventes-agences', title: 'Ventes mensuelles par agence', description: 'CA BL et quantités, mois par mois et par agence.', subject: 'ventes_bl', measures: ['ca_ht', 'quantite'], dimensions: ['mois', 'agence_collaborateur'], visualization: 'histogramme_empile' },
  { id: 'ventes-articles', title: 'Ventes par référence, agence et département', description: 'Tableau détaillé des ventes BL par article et territoire client.', subject: 'ventes_bl', measures: ['ca_ht', 'quantite'], dimensions: ['reference_article', 'agence_collaborateur', 'departement_tiers'], visualization: 'tableau' },
  { id: 'mix-familles', title: 'Mix familles et marge', description: 'Compare le mix familles et la marge entre agences.', subject: 'factures', measures: ['ca_ht', 'marge_valeur', 'marge_pct'], dimensions: ['famille_macro', 'agence_collaborateur'], visualization: 'histogramme_empile' },
  { id: 'nouveaux-clients', title: 'Nouveaux clients par agence', description: 'Nombre de clients créés par année et agence de rattachement.', subject: 'clients', measures: ['nb_clients_crees'], dimensions: ['annee_creation_client', 'agence_collaborateur'], visualization: 'histogramme_empile' },
  { id: 'abc-facture', title: 'CA facturé par classe ABC', description: 'Répartit le CA facturé selon la classe ABC CA actuelle des articles.', subject: 'factures', measures: ['ca_ht'], dimensions: ['classe_abc_ca', 'famille_macro'], visualization: 'histogramme' },
  { id: 'top-clients', title: 'Top clients contributeurs', description: 'Classe les clients par CA et marge avec leur agence et leur famille principale.', subject: 'factures', measures: ['ca_ht', 'marge_valeur'], dimensions: ['intitule_tiers', 'agence_collaborateur', 'famille_macro'], visualization: 'tableau', promptSuffix: 'Trier le CA par ordre décroissant.' },
  { id: 'portefeuille', title: 'Portefeuille par agence et document', description: 'Répartition mensuelle du portefeuille entre CDC, PL, BL et BR.', subject: 'portefeuille', measures: ['ca_ht', 'quantite'], dimensions: ['agence_collaborateur', 'type_document'], visualization: 'histogramme_empile' },
]

export function getSubject(key: SemanticSubjectKey) {
  const subject = SUBJECTS.find((item) => item.key === key)
  if (!subject) throw new Error(`Sujet métier inconnu : ${key}`)
  return subject
}

export function getEnvironment(key: SemanticEnvironmentKey) {
  const environment = ENVIRONMENTS.find((item) => item.key === key)
  if (!environment) throw new Error(`Environnement métier inconnu : ${key}`)
  return environment
}

export function environmentForSubject(subject: SemanticSubjectKey) {
  return getSubject(subject).environment
}

export function subjectsForEnvironment(environment: SemanticEnvironmentKey) {
  const keys = getEnvironment(environment).subjects
  return SUBJECTS.filter((subject) => keys.includes(subject.key))
}

export function recommendedVisualization(dimensions: SemanticDimensionKey[], measures: SemanticMeasureKey[]): SemanticVisualizationKey {
  const temporal = dimensions.some((key) => key === 'mois' || key === 'annee' || key === 'annee_creation_client')
  if (temporal) return dimensions.length > 1 ? 'histogramme_empile' : 'courbe'
  if (dimensions.length > 2 || measures.length > 2) return 'tableau'
  if (dimensions.length > 1) return 'histogramme_empile'
  return 'histogramme'
}

export function sanitizeSubjectConfiguration(input: {
  subject: SemanticSubjectKey
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
}) {
  const subject = getSubject(input.subject)
  const measures = Array.from(new Set(input.measures.filter((key) => subject.supportedMeasures.includes(key))))
  const dimensions = Array.from(new Set(input.dimensions.filter((key) => subject.supportedDimensions.includes(key))))
  return {
    measures: measures.length ? measures : [...subject.defaultMeasures],
    dimensions: dimensions.length ? dimensions : [...subject.defaultDimensions],
  }
}

export function buildSemanticPromptReference() {
  return [
    `ENVIRONNEMENTS : ${ENVIRONMENTS.map((item) => `${item.key}=${item.label}`).join(' ; ')}`,
    `SUJETS : ${SUBJECTS.map((item) => `${item.key}=${item.label} (alias: ${item.aliases.join(', ')})`).join(' ; ')}`,
    `MESURES : ${MEASURES.map((item) => `${item.key}=${item.label} (alias: ${(item.aliases || []).join(', ')})`).join(' ; ')}`,
    `DIMENSIONS : ${DIMENSIONS.map((item) => `${item.key}=${item.label} (alias: ${(item.aliases || []).join(', ')})`).join(' ; ')}`,
    'VISUALISATIONS : tableau, courbe, histogramme, histogramme_empile, camembert.',
  ].join('\n')
}

export function buildGuidedQuestion(input: {
  subject: SemanticSubjectKey
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
  visualization: SemanticVisualizationKey
  dateStart: string
  dateEnd: string
  freeText?: string
  promptSuffix?: string
}) {
  const subject = getSubject(input.subject)
  const measureLabels = input.measures.map((key) => MEASURES.find((item) => item.key === key)?.label || key)
  const dimensionLabels = input.dimensions.map((key) => DIMENSIONS.find((item) => item.key === key)?.label || key)
  return [
    `Sujet métier : ${subject.label}.`,
    `Mesures : ${measureLabels.join(', ')}.`,
    `Regrouper dans cet ordre : ${dimensionLabels.join(' puis ')}.`,
    `Période : ${input.dateStart || 'non précisée'} au ${input.dateEnd || 'non précisée'}.`,
    `Restitution : ${input.visualization}.`,
    input.freeText ? `Demande libre : ${input.freeText}.` : '',
    input.promptSuffix || '',
  ].filter(Boolean).join('\n')
}
