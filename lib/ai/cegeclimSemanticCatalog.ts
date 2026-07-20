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
    sourceHint: "Utiliser les bons de livraison uniquement. Les analyses simples viennent de l’agrégat activité ; les croisements Référence × Agence/Client utilisent les lignes de BL et les référentiels.",
    aliases: ['vente', 'ventes', 'livraison', 'livraisons', 'bl', 'bons de livraison', 'sorties'],
    defaultMeasures: ['ca_ht', 'quantite'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'famille_macro', 'famille', 'numero_tiers', 'intitule_tiers', 'reference_article'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'factures',
    environment: 'pilotage_commercial',
    label: 'Factures',
    description: 'Chiffre d’affaires facturé, quantités et marge.',
    sourceHint: 'Utiliser l’agrégat factures. Si une référence ou une classe ABC est demandée, utiliser les lignes de factures enrichies par les référentiels articles et ABC.',
    aliases: ['facture', 'factures', 'facturation', 'ca facturé', 'chiffre d’affaires facturé'],
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'collaborateur_facture', 'famille_macro', 'famille', 'classe_abc_ca', 'intitule_tiers'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: [...COMMON_DIMENSIONS, 'classe_abc_ca', 'classe_abc_lignes'],
  },
  {
    key: 'devis',
    environment: 'pilotage_commercial',
    label: 'Devis',
    description: 'Propositions commerciales émises, valeur, quantités et répartition.',
    sourceHint: 'Utiliser l’agrégat devis. Les détails par référence utilisent les lignes de devis enrichies par les référentiels.',
    aliases: ['devis', 'offre', 'offres', 'proposition', 'propositions commerciales'],
    defaultMeasures: ['ca_ht', 'nb_lignes'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['collaborateur_facture', 'departement_tiers', 'famille_macro', 'famille', 'intitule_tiers'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'portefeuille',
    environment: 'pilotage_commercial',
    label: 'Portefeuille de commandes',
    description: 'Documents encore présents dans l’activité : CDC, PL, BL et BR.',
    sourceHint: 'Utiliser l’activité mensuelle avec le type de document comme filtre ou dimension. Ce sujet ne représente pas le CA facturé.',
    aliases: ['portefeuille', 'encours', 'commande', 'commandes', 'cdc', 'pl', 'préparation', 'br'],
    defaultMeasures: ['ca_ht'],
    defaultDimensions: ['type_document', 'agence_collaborateur'],
    suggestedDimensions: ['mois', 'collaborateur_facture', 'departement_tiers', 'famille_macro', 'intitule_tiers'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: COMMON_DIMENSIONS,
  },
  {
    key: 'clients',
    environment: 'clients_territoires',
    label: 'Clients',
    description: 'Création, contribution, panier, mix familles et marge des clients.',
    sourceHint: 'Pour les ventes clients, utiliser les agrégats de factures. Pour les nouveaux clients, utiliser ref_tiers.date_creation et rattacher l’agence via le représentant du client.',
    aliases: ['client', 'clients', 'tiers', 'prospect', 'prospects', 'nouveau client', 'nouveaux clients'],
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['intitule_tiers', 'agence_collaborateur'],
    suggestedDimensions: ['annee_creation_client', 'numero_tiers', 'departement_tiers', 'famille_macro', 'famille', 'mois'],
    supportedMeasures: [...COMMON_MEASURES, 'nb_clients_crees'],
    supportedDimensions: [...COMMON_DIMENSIONS, 'annee_creation_client'],
  },
  {
    key: 'articles',
    environment: 'produits_articles',
    label: 'Articles et familles',
    description: 'Références, désignations, familles, classes ABC et familles macro.',
    sourceHint: 'Utiliser l’agrégat flux articles. Les croisements avec agence/client nécessitent les lignes détaillées et les référentiels.',
    aliases: ['article', 'articles', 'référence', 'références', 'produit', 'produits', 'famille', 'familles', 'abc'],
    defaultMeasures: ['ca_ht', 'quantite', 'marge_pct'],
    defaultDimensions: ['reference_article', 'famille_macro'],
    suggestedDimensions: ['designation', 'famille', 'classe_abc_ca', 'classe_abc_lignes', 'mois', 'depot', 'collaborateur_tiers'],
    supportedMeasures: COMMON_MEASURES,
    supportedDimensions: [...COMMON_DIMENSIONS, 'classe_abc_ca', 'classe_abc_lignes'],
  },
]

export const MEASURES: SemanticDefinition[] = [
  { key: 'ca_ht', label: 'CA HT', description: 'Somme du montant HT.', aliases: ['ca', 'chiffre d’affaires', 'montant', 'valeur'], sqlHint: 'sum(ca_ht)' },
  { key: 'quantite', label: 'Quantité', description: 'Somme des quantités.', aliases: ['quantité', 'quantités', 'volume', 'volumes', 'unités'], sqlHint: 'sum(quantite)' },
  { key: 'marge_valeur', label: 'Marge €', description: 'Somme de la marge en valeur.', aliases: ['marge euro', 'marge valeur'], sqlHint: 'sum(marge_valeur)' },
  {
    key: 'marge_pct',
    label: 'Marge %',
    description: 'Marge pondérée par le CA.',
    aliases: ['taux de marge', 'marge pourcentage', '% marge'],
    sqlHint: 'case when sum(ca_ht) <> 0 then sum(marge_valeur) / sum(ca_ht) * 100 else 0 end',
  },
  { key: 'nb_lignes', label: 'Nombre de lignes', description: 'Somme ou décompte des lignes selon la source.', aliases: ['lignes', 'nombre de lignes'], sqlHint: 'sum(nb_lignes)' },
  {
    key: 'panier_moyen',
    label: 'Panier moyen',
    description: 'CA divisé par le nombre de documents distincts lorsque la source détaillée le permet.',
    aliases: ['ticket moyen', 'montant moyen', 'panier'],
  },
  {
    key: 'nb_clients_crees',
    label: 'Nouveaux clients',
    description: 'Nombre distinct de clients dont la date de création appartient à la période.',
    aliases: ['créations clients', 'clients créés', 'nouveaux comptes'],
  },
]

export const DIMENSIONS: SemanticDefinition[] = [
  { key: 'mois', label: 'Mois', description: 'Mois du document, de 1 à 12.', aliases: ['mensuel', 'mois par mois', 'évolution mensuelle'] },
  { key: 'annee', label: 'Année', description: 'Année du document.', aliases: ['annuel', 'année par année'] },
  { key: 'annee_creation_client', label: 'Année de création client', description: 'Année issue de ref_tiers.date_creation.', aliases: ['année de création', 'ancienneté client'] },
  { key: 'agence_collaborateur', label: 'Agence', description: 'Agence du représentant rattaché au client.', aliases: ['agence', 'agences', 'site commercial'] },
  { key: 'depot', label: 'Dépôt', description: 'Dépôt logistique ou commercial du document.', aliases: ['dépôt', 'dépôts', 'stockage'] },
  { key: 'collaborateur_facture', label: 'Collaborateur du document', description: 'Collaborateur porté par le document.', aliases: ['commercial document', 'vendeur document'] },
  { key: 'collaborateur_tiers', label: 'Collaborateur du client', description: 'Représentant de rattachement du tiers.', aliases: ['commercial client', 'représentant', 'vendeur'] },
  { key: 'departement_tiers', label: 'Département client', description: 'Département calculé depuis le code postal du tiers.', aliases: ['département', 'territoire', 'zone géographique'] },
  { key: 'famille_macro', label: 'Famille macro', description: 'Regroupement métier supérieur de la famille article.', aliases: ['macro famille', 'famille macro'] },
  { key: 'famille', label: 'Famille', description: 'Famille de la référence article.', aliases: ['famille article'] },
  { key: 'classe_abc_ca', label: 'Classe ABC CA', description: 'Classe A/B/C actuelle calculée dans la projection stock selon le CA BL YTD.', aliases: ['abc ca', 'classe abc'] },
  { key: 'classe_abc_lignes', label: 'Classe ABC lignes', description: 'Classe A/B/C actuelle calculée selon le nombre de lignes BL YTD.', aliases: ['abc lignes'] },
  { key: 'numero_tiers', label: 'Code client', description: 'Identifiant du tiers.', aliases: ['numéro client', 'code tiers'] },
  { key: 'intitule_tiers', label: 'Client', description: 'Nom ou intitulé du tiers.', aliases: ['nom client', 'intitulé client'] },
  { key: 'reference_article', label: 'Référence article', description: 'Code de la référence article.', aliases: ['référence', 'code article', 'sku'] },
  { key: 'designation', label: 'Désignation', description: 'Désignation de la référence article.', aliases: ['libellé article', 'nom article'] },
  { key: 'type_document', label: 'Type de document', description: 'DEVIS, CDC, PL, BL, BR ou FACTURE selon la source.', aliases: ['document', 'type de pièce', 'flux'] },
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
    dimensions: ['reference_article', 'agence_collaborateur', 'departement_tiers'],
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
  'Le dépôt est une dimension logistique distincte de l’agence client et ne doit jamais la remplacer.',
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

export function getEnvironment(key: SemanticEnvironmentKey) {
  return ENVIRONMENTS.find((item) => item.key === key) || ENVIRONMENTS[0]
}

export function getSubject(key: SemanticSubjectKey) {
  return SUBJECTS.find((item) => item.key === key) || SUBJECTS[0]
}

export function environmentForSubject(key: SemanticSubjectKey) {
  return getSubject(key).environment
}

export function subjectsForEnvironment(key: SemanticEnvironmentKey) {
  const environment = getEnvironment(key)
  return environment.subjects.map((subjectKey) => getSubject(subjectKey))
}

export function sanitizeSubjectConfiguration(input: {
  subject: SemanticSubjectKey
  measures: SemanticMeasureKey[]
  dimensions: SemanticDimensionKey[]
}) {
  const subject = getSubject(input.subject)
  const measures = input.measures.filter((key) => subject.supportedMeasures.includes(key))
  const dimensions = input.dimensions.filter((key) => subject.supportedDimensions.includes(key))
  return {
    measures: measures.length ? measures : [...subject.defaultMeasures],
    dimensions: dimensions.length ? dimensions : [...subject.defaultDimensions],
  }
}

export function recommendedVisualization(
  dimensions: SemanticDimensionKey[],
  measures: SemanticMeasureKey[],
): SemanticVisualizationKey {
  if (!dimensions.length || !measures.length) return 'tableau'
  if (dimensions[0] === 'mois' || dimensions[0] === 'annee' || dimensions[0] === 'annee_creation_client') {
    return dimensions.length > 1 ? 'histogramme_empile' : 'courbe'
  }
  if (dimensions.length > 2) return 'tableau'
  if (dimensions.length === 2) return 'histogramme_empile'
  return 'histogramme'
}

export function buildSemanticPromptReference() {
  const subjectLines = SUBJECTS.map((subject) =>
    `${subject.key} (${subject.label}) aliases=${subject.aliases.join('|')} mesures=${subject.supportedMeasures.join(',')} dimensions=${subject.supportedDimensions.join(',')}`,
  )
  const measureLines = MEASURES.map((item) => `${item.key} (${item.label}) aliases=${(item.aliases || []).join('|')}`)
  const dimensionLines = DIMENSIONS.map((item) => `${item.key} (${item.label}) aliases=${(item.aliases || []).join('|')}`)
  return [
    'SUJETS:',
    ...subjectLines,
    'MESURES:',
    ...measureLines,
    'DIMENSIONS:',
    ...dimensionLines,
  ].join('\n')
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
    input.freeText ? `Demande utilisateur : ${input.freeText}` : '',
    input.promptSuffix || '',
    'Retourne des données agrégées, une synthèse métier courte et deux approfondissements pertinents.',
  ].filter(Boolean).join('\n')
}
