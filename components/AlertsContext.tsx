'use client'

// ============================================================================
// components/AlertsContext.tsx — Centre d'alertes partagé
// ----------------------------------------------------------------------------
// ÉVOLUTION (2026-09-15) : les pastilles d'alerte du bandeau (calculées dans
// ClientRootShell) sont exposées ici pour que l'accueil puisse afficher un bloc
// « Mes alertes » et ouvrir la fenêtre flottante « Centre d'alertes », dont le
// rendu vit dans ClientRootShell (il a accès aux modales et aux navigations).
//
// ÉVOLUTION (2026-09-16) : chaque alerte porte en plus son objectif (la valeur
// à atteindre, « 0 » sauf vigilance) et ce qui est attendu de l'utilisateur
// (phrase + étapes éventuelles). Le Centre d'alertes affiche ces trois
// informations côte à côte : alerte · objectif · action attendue.
// ============================================================================

import { createContext, useContext } from 'react'

export type AlertStatus = 'red' | 'orange' | 'green'

export type AlertItem = {
  key: string
  /** Libellé court (identique à la pastille du bandeau). */
  label: string
  /** Une phrase : ce que compte la pastille et ce que fait le clic. */
  description: string
  status: AlertStatus
  count: number
  /** Unité du compteur : « commandes », « lignes », « clients », « tâches »… */
  unit: string
  /** Valeur cible affichée dans le pavé « Objectif » : « 0 », « Vigilance »… */
  objective: string
  /** Complément sous la valeur cible : « commande en retard », « mois en écart »… */
  objectiveLabel: string
  /** Ce que l'utilisateur doit faire pour faire disparaître l'alerte. */
  expected: string
  /** Étapes numérotées (facultatif) affichées sous la phrase attendue. */
  expectedSteps?: string[]
  /** Ce que fait le clic sur la pastille (même action que le bandeau). */
  onOpen: () => void
  /** false = rien à traiter, on affiche OK sans action. */
  clickable: boolean
}

export type AlertsContextValue = {
  items: AlertItem[]
  /** Nombre d'alertes ayant quelque chose à traiter (count > 0). */
  activeCount: number
  /** Somme brute des compteurs (informative). */
  totalCount: number
  alertCenterOpen: boolean
  openAlertCenter: () => void
  closeAlertCenter: () => void
  refresh: () => void
}

const noop = () => {}

export const AlertsContext = createContext<AlertsContextValue>({
  items: [],
  activeCount: 0,
  totalCount: 0,
  alertCenterOpen: false,
  openAlertCenter: noop,
  closeAlertCenter: noop,
  refresh: noop,
})

export function useAlerts() {
  return useContext(AlertsContext)
}
