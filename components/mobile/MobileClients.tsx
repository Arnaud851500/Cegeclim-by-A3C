'use client'

import { useState } from 'react'

/**
 * Scaffold en attente de la structure réelle de la page SMC.
 * Prévu à terme : recherche client (nom / n° tiers), liste de résultats,
 * fiche résumée (CA, encours, dernier document), accès rapide historique.
 * À finaliser dès que le fichier SMC (ou les colonnes utilisées) sera transmis.
 */
export default function MobileClients() {
  const [query, setQuery] = useState('')

  return (
    <div style={{ flex: 1, padding: '18px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un client (nom, n° tiers)…"
        style={{
          border: '1px solid rgba(255,255,255,0.15)',
          background: 'rgba(255,255,255,0.05)',
          color: '#fff',
          borderRadius: 12,
          padding: '12px 14px',
          fontSize: 14,
        }}
      />

      <div
        style={{
          border: '1px dashed rgba(255,255,255,0.2)',
          borderRadius: 14,
          padding: 18,
          color: 'rgba(255,255,255,0.5)',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Liste et fiches clients à connecter — en attente de la structure de
        données SMC (page ou requêtes existantes) pour reprendre les mêmes
        champs sans les redéfinir.
      </div>
    </div>
  )
}
