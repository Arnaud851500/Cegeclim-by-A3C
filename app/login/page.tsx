'use client'

import LoginScreen from '@/components/LoginScreen'

export default function LoginPage() {
  return (
    <LoginScreen
      brand={{
        eyebrow: 'Suivi commercial & prospect',
        title: 'Le pilotage commercial CEGECLIM',
        subtitle:
          "Activité quotidienne, portefeuille de commandes, projection de stock et indicateurs d’agence, sur un même périmètre.",
        signaturePrefix: 'Distributeur de solutions',
        signatureAccent: 'durables',
        railItems: [
          { label: 'Tableaux de bord', value: '9' },
          { label: 'Périmètre', value: 'Par profil' },
          { label: 'Mise à jour', value: 'Quotidienne' },
        ],
        defaultLandingPage: '/accueil',
        formHelper: "Utilisez l’adresse professionnelle associée à votre profil.",
      }}
    />
  )
}
