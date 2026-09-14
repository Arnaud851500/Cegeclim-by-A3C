'use client'

import LoginScreen from '@/components/LoginScreen'

export default function FinancementLoginPage() {
  return (
    <LoginScreen
      brand={{
        eyebrow: 'Suivi des dossiers CEE',
        title: 'Le pilotage des aides financières CEGECLIM',
        subtitle:
          "Suivez l’avancement de vos dossiers de Certificats d’Économies d’Énergie, du dépôt de la demande jusqu’au versement de la prime.",
        signaturePrefix: 'Financer',
        signatureAccent: 'la rénovation énergétique',
        railItems: [
          { label: 'Dossiers suivis', value: 'En temps réel' },
          { label: 'Étapes', value: '8' },
          { label: 'Mise à jour', value: 'Quotidienne' },
        ],
        defaultLandingPage: '/financement',
        formHelper: "Utilisez l’adresse email associée à votre dossier.",
        showAnnonce: false,
      }}
    />
  )
}
