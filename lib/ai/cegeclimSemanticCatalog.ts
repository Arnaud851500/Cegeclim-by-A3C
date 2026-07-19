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

export type SemanticDimensionKey =
  | 'mois'
  | 'annee'
  | 'agence_collaborateur'
  | 'depot'
  | 'collaborateur_facture'
  | 'collaborateur_tiers'
  | 'departement_tiers'
  | 'famille_macro'
  | 'famille'
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
    description: 'Analyse des bons de livraison, du mix produit et de la performance commerciale.',
    sourceHint: "Utiliser indicateur_activite_mensuel avec type_document = 'BL' pour les analyses agence/client/famille, et indicateur_flux_articles_mensuel avec type_document = 'BL' pour les analyses par référence article.",
    defaultMeasures: ['ca_ht', 'quantite'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'famille_macro', 'famille', 'numero_tiers', 'intitule_tiers', 'reference_article'],
  },
  {
    key: 'factures',
    label: 'Factures',
    description: 'Analyse du chiffre d’affaires facturé, des quantités et de la marge.',
    sourceHint: 'Utiliser indicateur_factures_mensuel.',
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['departement_tiers', 'collaborateur_facture', 'famille_macro', 'famille', 'intitule_tiers'],
  },
  {
    key: 'devis',
    label: 'Devis',
    description: 'Analyse des devis émis, de leur valeur et de leur répartition.',
    sourceHint: 'Utiliser indicateur_devis_mensuel.',
    defaultMeasures: ['ca_ht', 'nb_lignes'],
    defaultDimensions: ['mois', 'agence_collaborateur'],
    suggestedDimensions: ['collaborateur_facture', 'departement_tiers', 'famille_macro', 'famille', 'intitule_tiers'],
  },
  {
    key: 'portefeuille',
    label: 'Portefeuille de commandes',
    description: 'Analyse des CDC, PL, BL et BR présents dans l’activité mensuelle.',
    sourceHint: "Utiliser indicateur_activite_mensuel et conserver type_document comme dimension ou filtre parmi CDC, PL, BL, BR et BL M-x.",
    defaultMeasures: ['ca_ht'],
    defaultDimensions: ['type_document', 'agence_collaborateur'],
    suggestedDimensions: ['mois', 'collaborateur_facture', 'departement_tiers', 'famille_macro', 'intitule_tiers'],
  },
  {
    key: 'clients',
    label: 'Clients',
    description: 'Analyse de la contribution, du panier, du mix familles et de la marge par client.',
    sourceHint: 'Utiliser les agrégats mensuels et regrouper par numero_tiers et intitule_tiers. Pour un panier moyen BL, calculer le CA BL divisé par un nombre de documents distincts uniquement si la source le permet ; sinon indiquer clairement la limite et utiliser un indicateur de CA par ligne.',
    defaultMeasures: ['ca_ht', 'marge_pct'],
    defaultDimensions: ['intitule_tiers', 'agence_collaborateur'],
    suggestedDimensions: ['numero_tiers', 'departement_tiers', 'famille_macro', 'famille', 'mois'],
  },
  {
    key: 'articles',
    label: 'Articles et familles',
    description: 'Analyse des références, désignations, familles et familles macro.',
    sourceHint: 'Utiliser indicateur_flux_articles_mensuel pour disposer de reference_article et designation.',
    defaultMeasures: ['ca_ht', 'quantite', 'marge_pct'],
    defaultDimensions: ['reference_article', 'famille_macro'],
    suggestedDimensions: ['designation', 'famille', 'mois', 'depot', 'collaborateur_tiers'],
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
  { key: 'nb_lignes', label: 'Nombre de lignes', description: 'Somme du nombre de lignes.', sqlHint: 'sum(nb_lignes)' },
  {
    key: 'panier_moyen',
    label: 'Panier moyen',
    description: 'CA divisé par le nombre de documents. À utiliser uniquement lorsque le nombre de documents distincts est disponible.',
  },
]

export const DIMENSIONS: SemanticDefinition[] = [
  { key: 'mois', label: 'Mois', description: 'Mois numérique de 1 à 12.' },
  { key: 'annee', label: 'Année', description: 'Année du document.' },
  { key: 'agence_collaborateur', label: 'Agence', description: 'Agence rattachée au collaborateur.' },
  { key: 'depot', label: 'Dépôt', description: 'Dépôt logistique ou commercial.' },
  { key: 'collaborateur_facture', label: 'Collaborateur du document', description: 'Collaborateur porté par le document.' },
  { key: 'collaborateur_tiers', label: 'Collaborateur du client', description: 'Collaborateur de rattachement du tiers.' },
  { key: 'departement_tiers', label: 'Département client', description: 'Département rattaché à l’adresse du tiers.' },
  { key: 'famille_macro', label: 'Famille macro', description: 'Regroupement métier supérieur de la famille article.' },
  { key: 'famille', label: 'Famille', description: 'Famille de la référence article.' },
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
    description: 'Tableau détaillé demandé pour analyser les ventes BL par territoire client.',
    subject: 'ventes_bl',
    measures: ['ca_ht', 'quantite'],
    dimensions: ['mois', 'reference_article', 'agence_collaborateur', 'departement_tiers'],
    visualization: 'tableau',
    promptSuffix: 'Présente d’abord une synthèse par agence, puis le détail par référence et département.',
  },
  {
    id: 'mix-famille-marge',
    title: 'Mix familles et marge',
    description: 'Repère les agences dont le mix familles est associé à une marge différente du réseau.',
    subject: 'factures',
    measures: ['ca_ht', 'marge_pct'],
    dimensions: ['agence_collaborateur', 'famille_macro'],
    visualization: 'histogramme_empile',
    promptSuffix: 'Signale les écarts significatifs de mix et de marge sans conclure à un lien de causalité.',
  },
  {
    id: 'top-clients',
    title: 'Top clients contributeurs',
    description: 'Classe les clients par CA et marge avec leur agence et leur famille principale.',
    subject: 'clients',
    measures: ['ca_ht', 'marge_pct'],
    dimensions: ['intitule_tiers', 'agence_collaborateur', 'famille_macro'],
    visualization: 'tableau',
    promptSuffix: 'Limite le résultat aux 30 principaux clients par CA HT.',
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
  'L’agence métier est en priorité l’agence du collaborateur de rattachement du client, sauf demande explicite sur le collaborateur du document.',
  'Pour les analyses par référence article ou désignation, utiliser indicateur_flux_articles_mensuel.',
  'Pour les ventes livrées, filtrer type_document = BL.',
  'Marge % doit être calculée comme une marge pondérée : somme marge / somme CA.',
  'hors_statistique est un booléen. Par défaut, exclure les lignes hors statistique.',
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
