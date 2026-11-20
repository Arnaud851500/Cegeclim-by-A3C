'use client'

// ============================================================================
// app/quand-livrer/page.tsx — « Quand puis-je livrer ? » (20/11/2026)
// ----------------------------------------------------------------------------
// Écran PC du contrôle avant commande (composant partagé components/QuandLivrer,
// aussi rendu par l'écran mobile 'livrer'). Ouvert depuis le raccourci de
// l'accueil et le bloc Stocks & logistique (droit can_stocks).
// URL : ?devis=DE314531 ouvre un devis ; ?liste=REF;QTE,REF;QTE contrôle une liste.
// ============================================================================

import { Suspense, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import QuandLivrer from '@/components/QuandLivrer'

function Contenu() {
  const params = useSearchParams()
  const router = useRouter()
  const devis = params.get('devis')
  const liste = params.get('liste')

  const onDevisChange = useCallback(
    (numero: string | null) => {
      const url = numero ? `/quand-livrer?devis=${encodeURIComponent(numero)}` : '/quand-livrer'
      router.replace(url, { scroll: false })
    },
    [router]
  )

  return (
    <QuandLivrer
      initialDevis={devis}
      initialListe={liste}
      initialMode={params.has('liste') ? 'liste' : 'devis'}
      onDevisChange={onDevisChange}
    />
  )
}

export default function QuandLivrerPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24, opacity: 0.6 }}>Chargement…</div>}>
      <Contenu />
    </Suspense>
  )
}
