import type { Metadata } from 'next'

// Cette section se présente comme un produit à part : le titre d'onglet
// distinct fait partie de l'habillage (cf. app/financement/login pour la
// page de connexion elle-même).
export const metadata: Metadata = {
  title: 'Le pilotage des aides financières CEGECLIM',
}

export default function FinancementLayout({ children }: { children: React.ReactNode }) {
  return children
}
