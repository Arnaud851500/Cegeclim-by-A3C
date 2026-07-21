import type { SemanticSubjectKey } from '@/lib/ai/cegeclimSemanticCatalog'

export type SemanticRoutingSource =
  | 'factures'
  | 'flux_articles'
  | 'devis'
  | 'activite'
  | 'ref_articles'

export type SemanticRoutingRule = {
  key: string
  label: string
  priority: number
  aliases: string[]
  patterns: RegExp[]
  subject: SemanticSubjectKey
  source: SemanticRoutingSource
  documentType?: 'FACTURE' | 'BL' | 'DEVIS' | 'CDC' | 'PL'
  dateFields: string[]
  joins: string[]
  note?: string
}

export const SEMANTIC_ROUTING_RULES: SemanticRoutingRule[] = [
  {
    key: 'portefeuille_non_facture',
    label: 'Portefeuille et documents non facturés',
    priority: 120,
    aliases: ['portefeuille', 'non facturé', 'en cours de commande', 'expédié non facturé', 'BL non facturé'],
    patterns: [
      /\bportefeuille\b/i,
      /\bnon\s+factur[eé]s?\b/i,
      /\ben\s+cours\s+de\s+commande\b/i,
      /\bexp[eé]di[eé]s?\s+non\s+factur[eé]s?\b/i,
      /\bbl\s+non\s+factur[eé]s?\b/i,
    ],
    subject: 'portefeuille',
    source: 'activite',
    dateFields: ['date_piece'],
    joins: ['ref_tiers', 'ref_collaborateurs', 'ref_articles', 'ref_familles'],
  },
  {
    key: 'facturation_explicite',
    label: 'Factures et facturation',
    priority: 110,
    aliases: ['facture', 'factures', 'facturé', 'facturation', 'CA facturé'],
    patterns: [
      /\bfactures?\b/i,
      /\bfactur[eé](?:e|es|s)?\b/i,
      /\bfacturation\b/i,
      /\bca\s+factur[eé]\b/i,
    ],
    subject: 'factures',
    source: 'factures',
    documentType: 'FACTURE',
    dateFields: ['date_facture', 'date_piece', 'date'],
    joins: ['ref_tiers', 'ref_collaborateurs', 'clients', 'ref_articles', 'ref_familles'],
  },
  {
    key: 'devis',
    label: 'Devis',
    priority: 105,
    aliases: ['devis', 'offre', 'proposition commerciale'],
    patterns: [
      /\bdevis\b/i,
      /\boffres?\b/i,
      /\bpropositions?\s+commerciales?\b/i,
    ],
    subject: 'devis',
    source: 'devis',
    documentType: 'DEVIS',
    dateFields: ['date_devis', 'date_piece'],
    joins: ['ref_tiers', 'ref_collaborateurs', 'ref_articles', 'ref_familles'],
  },
  {
    key: 'preparation_livraison',
    label: 'Préparations de livraison',
    priority: 100,
    aliases: ['PL', 'préparation de livraison'],
    patterns: [
      /\bpl\b/i,
      /\bpr[eé]parations?\s+de\s+livraison\b/i,
    ],
    subject: 'portefeuille',
    source: 'activite',
    documentType: 'PL',
    dateFields: ['date_pl', 'date_livraison', 'date_piece'],
    joins: ['ref_tiers', 'ref_collaborateurs', 'ref_articles', 'ref_familles'],
    note: 'Le Flux Articles actuel expose DEVIS, CDC, BL et FACTURE, mais pas encore PL ; les PL restent donc analysés depuis Activité.',
  },
  {
    key: 'commandes_cdc',
    label: 'Commandes clients CDC',
    priority: 95,
    aliases: ['commandé', 'commande', 'CDC', 'bon de commande'],
    patterns: [
      /\bcommand[eé](?:e|es|s)?\b/i,
      /\bcommandes?\b/i,
      /\bcdc\b/i,
      /\bbons?\s+de\s+commande\b/i,
    ],
    subject: 'portefeuille',
    source: 'flux_articles',
    documentType: 'CDC',
    dateFields: ['date_bc', 'date_livraison', 'date_piece'],
    joins: ['ref_collaborateurs', 'ref_articles', 'ref_familles'],
  },
  {
    key: 'ventes_bl',
    label: 'Ventes et expéditions BL',
    priority: 90,
    aliases: ['vente', 'ventes', 'vendu', 'expédié', 'expédition', 'BL', 'livraison'],
    patterns: [
      /\bventes?\b/i,
      /\bvendu(?:e|es|s)?\b/i,
      /\bexp[eé]di[eé](?:e|es|s)?\b/i,
      /\bexp[eé]ditions?\b/i,
      /\bbons?\s+de\s+livraison\b/i,
      /\bbl\b/i,
      /\blivraisons?\b/i,
    ],
    subject: 'ventes_bl',
    source: 'flux_articles',
    documentType: 'BL',
    dateFields: ['date_bl', 'date_livraison', 'date_piece'],
    joins: ['ref_collaborateurs', 'ref_articles', 'ref_familles'],
  },
  {
    key: 'chiffre_affaires',
    label: 'Chiffre d’affaires',
    priority: 80,
    aliases: ["chiffre d'affaires", 'CA', 'CA HT'],
    patterns: [
      /\bchiffre\s+d['’]?affaires?\b/i,
      /\bca\s*ht\b/i,
      /\bca\b/i,
    ],
    subject: 'factures',
    source: 'factures',
    documentType: 'FACTURE',
    dateFields: ['date_facture', 'date_piece', 'date'],
    joins: ['ref_tiers', 'ref_collaborateurs', 'clients', 'ref_articles', 'ref_familles'],
    note: 'Par convention CEGECLIM, un chiffre d’affaires sans autre précision désigne le chiffre d’affaires facturé.',
  },
  {
    key: 'articles_references',
    label: 'Référentiel articles',
    priority: 60,
    aliases: ['référence', 'article', 'produit'],
    patterns: [
      /\br[eé]f[eé]rences?\b/i,
      /\barticles?\b/i,
      /\bproduits?\b/i,
    ],
    subject: 'articles',
    source: 'ref_articles',
    dateFields: [],
    joins: ['ref_familles'],
    note: 'Le référentiel décrit les articles ; dès qu’une quantité, une marge ou un CA est demandé, la source transactionnelle du contexte reste prioritaire.',
  },
]

export function resolveSemanticRouting(text: string) {
  const source = String(text || '').trim()
  if (!source) return null
  return [...SEMANTIC_ROUTING_RULES]
    .sort((a, b) => b.priority - a.priority)
    .find((rule) => rule.patterns.some((pattern) => pattern.test(source))) || null
}

export function describeSemanticRouting(rule: SemanticRoutingRule) {
  const dates = rule.dateFields.length ? rule.dateFields.join(' / ') : 'sans date métier propre'
  const joins = rule.joins.length ? ` ; jointures possibles : ${rule.joins.join(', ')}` : ''
  const note = rule.note ? ` ${rule.note}` : ''
  return `${rule.label} → sujet ${rule.subject} → source ${rule.source} → dates ${dates}${joins}.${note}`
}

export function buildSemanticRoutingPromptReference() {
  return SEMANTIC_ROUTING_RULES
    .map((rule) => `${rule.aliases.join(', ')} => sujet=${rule.subject}, source=${rule.source}, document=${rule.documentType || 'aucun'}, dates=${rule.dateFields.join('/') || 'aucune'}`)
    .join('\n')
}
