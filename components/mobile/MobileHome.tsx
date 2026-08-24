'use client'

import { useEffect, useState } from 'react'
import type { AccessRights } from '@/components/AccessContext'
import type { MobileScreen } from './MobileShell'
import { supabase } from '@/lib/supabaseClient'
import LastSyncBadge from '@/components/LastSyncBadge'
import VoiceReportButtons from './VoiceReportButtons'
import MobileHomeSummary from './MobileHomeSummary'

type ButtonConfig = {
  key: MobileScreen
  label: string
  sub: string
  accessKey?: keyof AccessRights
  icon: string
  gradient: string
  subColor: string
}

const BUTTONS: ButtonConfig[] = [
  { key: 'activite', label: 'Mon activité', sub: 'Devis · CDC · BL · Factures · Marge', accessKey: 'can_dashboard', icon: '📊', gradient: 'linear-gradient(160deg, #185FA5, #0C447C)', subColor: '#B5D4F4' },
  { key: 'clients', label: 'Mes clients', sub: 'Fiches et suivi client', accessKey: 'can_dashboard', icon: '👥', gradient: 'linear-gradient(160deg, #3B6D11, #27500A)', subColor: '#C0DD97' },
  { key: 'rdv', label: 'Mes rdv', sub: 'Agenda, comptes rendus, recherche documents', icon: '📅', gradient: 'linear-gradient(160deg, #534AB7, #3C3489)', subColor: '#CECBF6' },
  { key: 'alertes', label: 'Mes tâches - alertes', sub: 'À traiter en priorité', icon: '✅', gradient: 'linear-gradient(160deg, #993C1D, #712B13)', subColor: '#F5C4B3' },
  // Nouveau : recherche article, stock par dépôt, projection -- couleur
  // "sauge" reprise de la charte CEGECLIM (#A6A181), pas encore utilisée
  // par les autres cartes de cet écran.
  { key: 'stock', label: 'Stock articles', sub: 'Recherche, dépôts, projection', accessKey: 'can_dashboard', icon: '📦', gradient: 'linear-gradient(160deg, #A6A181, #6E6A54)', subColor: '#EDE9D8' },
  { key: 'prospects', label: 'Carte Prospects & Clients', sub: '', icon: '🗺️', gradient: 'linear-gradient(160deg, #0F6E56, #085041)', subColor: '#9FE1CB' },
]

// Marge horizontale de l'écran -- resserrée une 3e fois (6px -> 3px de
// chaque côté), pour se rapprocher du rendu "bord à bord" déjà obtenu sur
// la liste "À faire" (MobileListSheet), qui n'a quasiment aucune marge
// externe. 3px reste juste assez pour ne pas coller les cartes aux coins
// arrondis du téléphone.
const MARGE_ECRAN = 3

// Les 6 timbres proposés par OpenAI TTS (moteur utilisé par
// /api/atelier-ai/speak) -- pas d'accent régional possible avec ce
// fournisseur, seulement des voix au grain différent.
const VOIX_OPTIONS = [
  { id: 'nova', label: 'Nova', description: 'Voix féminine, claire et dynamique (par défaut)' },
  { id: 'alloy', label: 'Alloy', description: 'Voix neutre, posée' },
  { id: 'echo', label: 'Echo', description: 'Voix masculine, grave' },
  { id: 'fable', label: 'Fable', description: 'Voix chaleureuse, légèrement posée' },
  { id: 'onyx', label: 'Onyx', description: 'Voix masculine, profonde et assurée' },
  { id: 'shimmer', label: 'Shimmer', description: 'Voix féminine, douce' },
]

// Vitesse de lecture TTS -- plage acceptée par OpenAI : 0.25 à 4.0.
// 1.15 = valeur historique (celle qui était codée en dur avant que ce
// réglage soit configurable).
const VITESSE_OPTIONS = [
  { valeur: 0.85, label: '0.85×', description: 'Plus lente' },
  { valeur: 1.0, label: '1×', description: 'Normale' },
  { valeur: 1.15, label: '1.15×', description: 'Par défaut' },
  { valeur: 1.3, label: '1.3×', description: 'Rapide' },
  { valeur: 1.5, label: '1.5×', description: 'Très rapide' },
]

export default function MobileHome({
  email,
  rights,
  alertsCount,
  onNavigate,
}: {
  email?: string | null
  rights: AccessRights
  alertsCount: number
  onNavigate: (screen: MobileScreen) => void
}) {
  const visibleButtons = BUTTONS.filter((b) => !b.accessKey || rights[b.accessKey])

  // "Arnaud V." (user_page_access.display_name) plutôt que "a.valanchauskas"
  // (dérivé de l'email) -- même source que les autres écrans mobile
  // (MobileRdv, MobileClients...). Repli sur l'email si display_name est
  // vide, pour ne jamais afficher "Bonjour," tout court.
  const [displayName, setDisplayName] = useState('')
  useEffect(() => {
    let cancelled = false
    async function chargerNom() {
      if (!email) return
      const { data } = await supabase
        .from('user_page_access')
        .select('display_name')
        .eq('email', email)
        .maybeSingle()
      if (!cancelled) setDisplayName(String(data?.display_name || '').trim())
    }
    void chargerNom()
    return () => { cancelled = true }
  }, [email])

  const nomAffiche = displayName || (email ? email.split('@')[0] : '')

  // Choix de la voix, de la vitesse de lecture, et du mode "annonce
  // courte" de l'assistant vocal -- tous les trois dans la même table
  // (vision_tci_preferences), réutilisés tels quels par VoiceReportButtons
  // et MobileHomeSummary pour tous leurs appels à /api/atelier-ai/speak.
  const [voixSelecteurOuvert, setVoixSelecteurOuvert] = useState(false)
  const [voixActuelle, setVoixActuelle] = useState('nova')
  const [voixEnCoursEcoute, setVoixEnCoursEcoute] = useState<string | null>(null)
  const [voixSauvegardeEnCours, setVoixSauvegardeEnCours] = useState(false)
  const [vitesseActuelle, setVitesseActuelle] = useState(1.15)
  const [annonceCourte, setAnnonceCourte] = useState(false)
  const [preferencesSauvegardeEnCours, setPreferencesSauvegardeEnCours] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function charger() {
      if (!email) return
      const { data } = await supabase.from('vision_tci_preferences').select('voix_assistant, vitesse_lecture, annonce_courte').eq('user_email', email).maybeSingle()
      if (cancelled) return
      setVoixActuelle(String(data?.voix_assistant || 'nova'))
      setVitesseActuelle(data?.vitesse_lecture !== null && data?.vitesse_lecture !== undefined ? Number(data.vitesse_lecture) : 1.15)
      setAnnonceCourte(Boolean(data?.annonce_courte))
    }
    void charger()
    return () => { cancelled = true }
  }, [email])

  async function choisirVoix(voix: string) {
    setVoixActuelle(voix)
    setVoixSauvegardeEnCours(true)
    try {
      await supabase.from('vision_tci_preferences').upsert({ user_email: email, voix_assistant: voix, updated_at: new Date().toISOString() })
    } finally {
      setVoixSauvegardeEnCours(false)
    }
  }

  async function choisirVitesse(vitesse: number) {
    setVitesseActuelle(vitesse)
    setPreferencesSauvegardeEnCours(true)
    try {
      await supabase.from('vision_tci_preferences').upsert({ user_email: email, vitesse_lecture: vitesse, updated_at: new Date().toISOString() })
    } finally {
      setPreferencesSauvegardeEnCours(false)
    }
  }

  async function basculerAnnonceCourte() {
    const next = !annonceCourte
    setAnnonceCourte(next)
    setPreferencesSauvegardeEnCours(true)
    try {
      await supabase.from('vision_tci_preferences').upsert({ user_email: email, annonce_courte: next, updated_at: new Date().toISOString() })
    } finally {
      setPreferencesSauvegardeEnCours(false)
    }
  }

  async function ecouterExemple(voix: string) {
    setVoixEnCoursEcoute(voix)
    try {
      const res = await fetch('/api/atelier-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Bonjour, voici un exemple de ma voix pour tes résumés et comptes-rendus.', voice: voix, speed: vitesseActuelle }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        void audio.play().catch(() => resolve())
      })
      URL.revokeObjectURL(url)
    } finally {
      setVoixEnCoursEcoute(null)
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: `28px ${MARGE_ECRAN}px`, gap: 14 }}>
      <div style={{ marginBottom: 10, padding: '0 4px' }}>
        <div
          style={{
            fontSize: 11.5,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.4)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          CEGECLIM
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, marginTop: 4 }}>
          Bonjour{nomAffiche ? `, ${nomAffiche}` : ''}
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <LastSyncBadge />
          <button
            type="button"
            onClick={() => setVoixSelecteurOuvert(true)}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.65)', fontSize: 11.5, fontWeight: 600 }}
          >
            🎙️ Voix
          </button>
        </div>
      </div>

      {voixSelecteurOuvert && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(6,10,18,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setVoixSelecteurOuvert(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, background: '#141A26', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid rgba(255,255,255,0.1)', padding: '12px 18px 26px', display: 'flex', flexDirection: 'column', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.2)', margin: '0 auto 2px' }} />
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Voix & lecture</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 4, lineHeight: 1.5 }}>
              6 timbres proposés par le moteur vocal -- pas d'accent régional disponible, seulement des voix différentes.
            </div>

            {VOIX_OPTIONS.map((v) => {
              const actif = voixActuelle === v.id
              const enEcoute = voixEnCoursEcoute === v.id
              return (
                <div
                  key={v.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
                    border: `1px solid ${actif ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.1)'}`,
                    background: actif ? 'rgba(75,146,172,0.14)' : 'rgba(255,255,255,0.03)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void ecouterExemple(v.id)}
                    disabled={enEcoute}
                    aria-label={`Écouter un exemple de la voix ${v.label}`}
                    style={{ flexShrink: 0, width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 15 }}
                  >
                    {enEcoute ? '…' : '▶️'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void choisirVoix(v.id)}
                    disabled={voixSauvegardeEnCours}
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', padding: 0 }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>{v.label}</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>{v.description}</div>
                  </button>
                  {actif && <span style={{ color: '#8FC7DA', fontSize: 18, flexShrink: 0 }}>✓</span>}
                </div>
              )
            })}

            {/* Vitesse de lecture -- même préférence utilisateur que la voix
               (vision_tci_preferences.vitesse_lecture), transmise à chaque
               appel à /api/atelier-ai/speak. */}
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginTop: 8 }}>Vitesse de lecture</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {VITESSE_OPTIONS.map((opt) => {
                const actif = Math.abs(vitesseActuelle - opt.valeur) < 0.001
                return (
                  <button
                    key={opt.valeur}
                    type="button"
                    onClick={() => void choisirVitesse(opt.valeur)}
                    disabled={preferencesSauvegardeEnCours}
                    style={{
                      padding: '9px 13px', borderRadius: 999,
                      border: `1px solid ${actif ? 'rgba(75,146,172,0.6)' : 'rgba(255,255,255,0.15)'}`,
                      background: actif ? 'rgba(75,146,172,0.25)' : 'rgba(255,255,255,0.04)',
                      color: '#fff', fontSize: 13, fontWeight: 700,
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {/* Annonce courte -- quand actif, VoiceReportButtons et
               MobileHomeSummary doivent remplacer leur phrase d'accroche
               habituelle par une version raccourcie ("J'écoute tes tâches
               à rajouter" / "Que souhaites-tu savoir ?") avant de lancer
               l'enregistrement, pour gagner du temps à l'usage. */}
            <button
              type="button"
              onClick={() => void basculerAnnonceCourte()}
              disabled={preferencesSauvegardeEnCours}
              style={{
                marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '12px 14px', borderRadius: 12,
                border: `1px solid ${annonceCourte ? 'rgba(75,146,172,0.5)' : 'rgba(255,255,255,0.1)'}`,
                background: annonceCourte ? 'rgba(75,146,172,0.14)' : 'rgba(255,255,255,0.03)',
                textAlign: 'left',
              }}
            >
              <span>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff' }}>Annonce courte</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                  Raccourcit les phrases d'accueil pour "Nouvelle tâche" et "Résumé vocal"
                </div>
              </span>
              <span
                style={{
                  flexShrink: 0, width: 42, height: 24, borderRadius: 999, position: 'relative',
                  background: annonceCourte ? '#4B92AC' : 'rgba(255,255,255,0.15)', transition: 'background .15s',
                }}
              >
                <span
                  style={{
                    position: 'absolute', top: 2, left: annonceCourte ? 20 : 2, width: 20, height: 20, borderRadius: '50%',
                    background: '#fff', transition: 'left .15s',
                  }}
                />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setVoixSelecteurOuvert(false)}
              style={{ marginTop: 6, padding: '12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 13.5, fontWeight: 600 }}
            >
              Fermer
            </button>
          </div>
        </div>
      )}

      {/* Une seule grille 2 colonnes pour TOUT (boutons vocaux inclus) --
         garantit une largeur strictement identique entre "Nouvelle tâche"
         et les cartes de navigation en dessous (avant : deux systèmes de
         mise en page différents -- flex ici, grid plus bas -- donnaient
         des largeurs légèrement différentes selon le contenu).
         Hauteur FIXE (pas minHeight) sur les cartes de navigation : sans
         ça, une carte au sous-titre plus long (ex. "Mes rdv" sur 3 lignes)
         s'étire plus que ses voisines, et comme le titre est ancré au
         centre, ça décale visuellement les titres d'une carte à l'autre.
         Avec une hauteur fixe, tous les titres tombent exactement à la
         même hauteur, alignés entre les cases.

         "Carte Prospects & Clients" repasse en demi-largeur avec l'ajout
         de "Stock articles" : la règle "seule ? pleine largeur" ci-dessous
         (i === visibleButtons.length - 1 && length % 2 !== 0) ne se
         déclenche plus, puisque le total de cartes est désormais pair
         (6 au lieu de 5) -- aucune logique à changer, juste un bouton de
         plus dans BUTTONS. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <VoiceReportButtons
          modeUnique="tache"
          labelBouton="Nouvelle tâche"
          userEmail={email || ''}
          userName={nomAffiche}
        />
        <MobileHomeSummary userEmail={email} />

        {visibleButtons.map((b, i) => {
          const seule = i === visibleButtons.length - 1 && visibleButtons.length % 2 !== 0
          return (
            <button
              key={b.key}
              onClick={() => onNavigate(b.key)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                border: '1px solid rgba(255,255,255,0.14)',
                background: b.gradient,
                borderRadius: 18,
                padding: '20px 14px',
                height: 148,
                color: '#fff',
                fontFamily: 'var(--font-body)',
                gridColumn: seule ? '1 / -1' : undefined,
              }}
            >
              <span style={{ position: 'absolute', top: 12, right: 14, fontSize: 20, color: 'rgba(255,255,255,0.55)' }}>›</span>
              <div
                style={{
                  width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.16)',
                  border: '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, marginBottom: 10,
                }}
              >
                {b.icon}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20.5, fontWeight: 700, lineHeight: 1.25, color: '#fff' }}>
                {b.label}
                {b.key === 'alertes' && alertsCount > 0 ? ` (${alertsCount})` : ''}
              </div>
              <div style={{ fontSize: 13, color: b.subColor, marginTop: 6 }}>{b.sub}</div>
            </button>
          )
        })}
      </div>

      {visibleButtons.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginTop: 20 }}>
          Aucun accès activé pour ce profil.
        </div>
      )}
    </div>
  )
}
