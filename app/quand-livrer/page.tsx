'use client'

// ============================================================================
// app/quand-livrer/page.tsx — « Quand puis-je livrer ? » (20/11/2026)
// ----------------------------------------------------------------------------
// Écran PC du contrôle avant commande (composant partagé components/QuandLivrer,
// aussi rendu par l'écran mobile 'livrer'). Ouvert depuis le raccourci de
// l'accueil et le bloc Stocks & logistique (droit can_stocks).
// URL : ?devis=DE314531 ouvre un devis ; ?liste=REF;QTE,REF;QTE contrôle une liste.
// ÉVOLUTION (23/11/2026) : clic sur une référence → écran de projection du stock
// (/stock?ref=…&retour=…) ; le bouton de retour de cet écran revient ici et le
// contrôle est restauré sans être refait (état gardé par components/QuandLivrer).
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

  const onOuvrirArticle = useCallback(
    (ref: string) => {
      const retour = `${window.location.pathname}${window.location.search}`
      router.push(`/stock?ref=${encodeURIComponent(ref)}&retour=${encodeURIComponent(retour)}`)
    },
    [router]
  )

  return (
    <QuandLivrer
      initialDevis={devis}
      initialListe={liste}
      initialMode={params.has('liste') ? 'liste' : 'devis'}
      onDevisChange={onDevisChange}
      onOuvrirArticle={onOuvrirArticle}
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
