'use client'

// Page publique /installer (25/09/2026) — cible du QR code de lancement du
// Compagnon auprès des commerciaux.
//
// Rôle : faire ajouter le Compagnon à l'écran d'accueil du téléphone, puis
// l'ouvrir en plein écran sur la page de connexion.
// - Android / Chrome : vrai bouton « Installer le Compagnon » (invite native
//   captée par components/PwaSetup.tsx).
// - iPhone : aucune API ne permet d'installer par programme ; la page montre
//   les gestes Safari (Partager → Sur l'écran d'accueil).
// - Ordinateur : affiche le QR code en grand (projection en réunion) et les
//   deux modes opératoires.
// - Ouverte depuis l'icône (mode standalone) : renvoie directement vers
//   /login (ou l'accueil si une session existe).
//
// Paramètre optionnel ?u=prenom.nom@… : identifiant transmis à /login pour
// préremplir le champ (jamais de mot de passe dans l'URL).
//
// Publique : déclarée comme page « de connexion » dans ClientRootShell
// (INSTALLER_PATH), donc pas de redirection ni de bandeau.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  APP_INSTALLED_EVENT,
  INSTALL_PROMPT_READY_EVENT,
  type BeforeInstallPromptEvent,
} from '@/components/PwaSetup'

const C = {
  marine: '#0B1220',
  marine2: '#131C2E',
  creme: '#F5F3EC',
  sauge: '#A6A181',
  alerte: '#C1683C',
  texteDoux: 'rgba(245,243,236,0.72)',
  bord: 'rgba(245,243,236,0.14)',
}

const APP_URL = 'https://cegeclim-by-a3-c.vercel.app/installer'

type Plateforme =
  | 'chargement'
  | 'ios-safari'
  | 'ios-autre-navigateur' // Chrome, Edge, Firefox iOS : partage possible depuis iOS 16.4
  | 'ios-app-integree' // navigateur intégré (Gmail, WhatsApp, Teams…) : pas d'ajout possible
  | 'android'
  | 'ordinateur'

function detecterPlateforme(): Plateforme {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIOS) {
    if (/FBAN|FBAV|Instagram|LinkedInApp|Line\/|GSA\/|MicrosoftTeams|Teams\//i.test(ua)) return 'ios-app-integree'
    if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'ios-autre-navigateur'
    // WKWebView intégré sans « Safari » dans l'agent (Gmail, WhatsApp…)
    if (!/Safari\//.test(ua)) return 'ios-app-integree'
    return 'ios-safari'
  }
  if (/Android/i.test(ua)) return 'android'
  return 'ordinateur'
}

function estLanceeDepuisIcone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

// ─── Pictogrammes (SVG maison, pas d'icônes externes) ─────────────────────

function PictoPartager({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7.5 7.5 12 3l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PictoAjouter({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function PictoMenuAndroid({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

function PictoPlus({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  )
}

// ─── Blocs d'affichage ─────────────────────────────────────────────────────

function Etape({ n, titre, children, picto }: { n: number; titre: string; children?: React.ReactNode; picto?: React.ReactNode }) {
  return (
    <li style={styles.etape}>
      <span style={styles.etapeNum}>{n}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.etapeTitre}>
          {titre}
          {picto && <span style={styles.etapePicto}>{picto}</span>}
        </div>
        {children && <div style={styles.etapeTexte}>{children}</div>}
      </div>
    </li>
  )
}

function EtapesIphone({ navigateur }: { navigateur: 'safari' | 'autre' }) {
  // Pas de détection de version : depuis iOS 26, Safari fige la version d'iOS
  // dans son user-agent. Les consignes couvrent donc les deux dispositions.
  return (
    <ol style={styles.etapes}>
      {navigateur === 'safari' ? (
        <Etape n={1} titre="Touchez le bouton Partager" picto={<PictoPartager />}>
          En bas de l’écran dans Safari. Sur iOS 26, touchez d’abord <strong>⋯</strong> à droite de la barre
          d’adresse, puis <strong>Partager</strong>.
        </Etape>
      ) : (
        <Etape n={1} titre="Touchez le bouton Partager" picto={<PictoPartager />}>
          Dans la barre d’adresse de votre navigateur. Si l’option n’apparaît pas à l’étape suivante, ouvrez ce lien dans{' '}
          <strong>Safari</strong>.
        </Etape>
      )}
      <Etape n={2} titre="Choisissez « Sur l’écran d’accueil »" picto={<PictoAjouter />}>
        Faites défiler la liste vers le bas si besoin (ou touchez « Afficher plus »).
      </Etape>
      <Etape n={3} titre="Touchez « Ajouter »">
        Si l’option <strong>« Ouvrir en tant qu’app web »</strong> est proposée, laissez-la activée.
      </Etape>
      <Etape n={4} titre="Ouvrez le Compagnon depuis la nouvelle icône">
        Connectez-vous <strong>dans l’app</strong> (et non dans Safari) : c’est là que votre session restera ouverte.
      </Etape>
    </ol>
  )
}

function EtapesAndroidManuelles() {
  return (
    <ol style={styles.etapes}>
      <Etape n={1} titre="Touchez le menu de Chrome" picto={<PictoMenuAndroid />}>
        Les trois points en haut à droite.
      </Etape>
      <Etape n={2} titre="Choisissez « Installer l’application »">
        Selon la version : « Ajouter à l’écran d’accueil », puis « Installer ».
      </Etape>
      <Etape n={3} titre="Ouvrez le Compagnon depuis la nouvelle icône">
        Connectez-vous : la session reste ouverte les jours suivants.
      </Etape>
    </ol>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function InstallerPage() {
  const router = useRouter()
  const [plateforme, setPlateforme] = useState<Plateforme>('chargement')
  const [identifiant, setIdentifiant] = useState<string>('')
  const [invite, setInvite] = useState<BeforeInstallPromptEvent | null>(null)
  const [installee, setInstallee] = useState(false)
  const [refus, setRefus] = useState(false)
  const [lienCopie, setLienCopie] = useState(false)

  const loginUrl = useMemo(
    () => (identifiant ? `/login?u=${encodeURIComponent(identifiant)}` : '/login'),
    [identifiant],
  )

  // Détection + redirection quand la page est ouverte depuis l'icône.
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('u')?.trim() ?? ''
    setIdentifiant(u)

    if (estLanceeDepuisIcone()) {
      void (async () => {
        const { data } = await supabase.auth.getSession()
        router.replace(data.session ? '/accueil' : u ? `/login?u=${encodeURIComponent(u)}` : '/login')
      })()
      return
    }

    setPlateforme(detecterPlateforme())
  }, [router])

  // Invite d'installation Chrome Android (captée dans PwaSetup).
  useEffect(() => {
    const lire = () => setInvite(window.__cegeclimInstallPrompt ?? null)
    const onInstalled = () => {
      setInvite(null)
      setInstallee(true)
    }
    lire()
    window.addEventListener(INSTALL_PROMPT_READY_EVENT, lire)
    window.addEventListener(APP_INSTALLED_EVENT, onInstalled)
    return () => {
      window.removeEventListener(INSTALL_PROMPT_READY_EVENT, lire)
      window.removeEventListener(APP_INSTALLED_EVENT, onInstalled)
    }
  }, [])

  const installerAndroid = async () => {
    if (!invite) return
    setRefus(false)
    await invite.prompt()
    const choix = await invite.userChoice
    window.__cegeclimInstallPrompt = null
    setInvite(null)
    if (choix.outcome === 'accepted') setInstallee(true)
    else setRefus(true)
  }

  const copierLien = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setLienCopie(true)
      window.setTimeout(() => setLienCopie(false), 2500)
    } catch {
      /* presse-papiers indisponible */
    }
  }

  const estOrdinateur = plateforme === 'ordinateur'

  return (
    <main style={styles.page}>
      <style>{css}</style>

      <div style={estOrdinateur ? styles.cadreLarge : styles.cadre}>
        <header style={styles.entete}>
          <img src="/icon-192.png" alt="" width={64} height={64} style={styles.icone} />
          <div>
            <div style={styles.surtitre}>CEGECLIM by A3C</div>
            <h1 style={styles.titre}>Le compagnon CEGECLIM</h1>
          </div>
        </header>

        <p style={styles.intro}>
          Installez le Compagnon sur l’écran d’accueil de votre téléphone : il s’ouvrira en plein écran, comme une
          application, avec votre activité, vos clients et le stock toujours à portée de main.
        </p>

        {identifiant && (
          <div style={styles.bandeauIdentifiant}>
            Identifiant prérempli à la connexion : <strong>{identifiant}</strong>
          </div>
        )}

        {plateforme === 'chargement' && <div style={styles.carte}>Préparation…</div>}

        {/* ── iPhone / Safari ─────────────────────────────── */}
        {plateforme === 'ios-safari' && (
          <section style={styles.carte}>
            <h2 style={styles.carteTitre}>Sur votre iPhone</h2>
            <EtapesIphone navigateur="safari" />
          </section>
        )}

        {/* ── iPhone / Chrome, Edge… ──────────────────────── */}
        {plateforme === 'ios-autre-navigateur' && (
          <section style={styles.carte}>
            <h2 style={styles.carteTitre}>Sur votre iPhone</h2>
            <EtapesIphone navigateur="autre" />
          </section>
        )}

        {/* ── iPhone / navigateur intégré à une app ───────── */}
        {plateforme === 'ios-app-integree' && (
          <section style={styles.carte}>
            <h2 style={styles.carteTitre}>Ouvrez d’abord cette page dans Safari</h2>
            <p style={styles.carteTexte}>
              Vous êtes dans le navigateur intégré d’une application (mail, messagerie…), qui ne permet pas d’ajouter
              le Compagnon à l’écran d’accueil. Touchez <strong>⋯</strong> ou <PictoPlus size={14} /> puis{' '}
              <strong>« Ouvrir dans Safari »</strong>, ou scannez le QR code avec l’appareil photo.
            </p>
            <button type="button" onClick={copierLien} style={styles.boutonSecondaire}>
              {lienCopie ? 'Lien copié ✓' : 'Copier le lien'}
            </button>
          </section>
        )}

        {/* ── Android ─────────────────────────────────────── */}
        {plateforme === 'android' && (
          <section style={styles.carte}>
            {installee ? (
              <>
                <h2 style={styles.carteTitre}>C’est installé ✓</h2>
                <p style={styles.carteTexte}>
                  Fermez cette page et ouvrez le Compagnon depuis l’icône <strong>CEGECLIM</strong> de votre écran
                  d’accueil pour vous connecter.
                </p>
                <a href={loginUrl} style={styles.lienDiscret}>
                  Ou se connecter ici
                </a>
              </>
            ) : invite ? (
              <>
                <h2 style={styles.carteTitre}>Sur votre téléphone Android</h2>
                <button type="button" onClick={installerAndroid} style={styles.boutonPrincipal} className="pulse">
                  Installer le Compagnon
                </button>
                <p style={styles.carteTexteCentre}>Puis confirmez « Installer » dans la fenêtre qui s’ouvre.</p>
                {refus && (
                  <p style={styles.avertissement}>Installation annulée. Vous pouvez réessayer via le menu de Chrome :</p>
                )}
                {refus && <EtapesAndroidManuelles />}
              </>
            ) : (
              <>
                <h2 style={styles.carteTitre}>Sur votre téléphone Android</h2>
                <EtapesAndroidManuelles />
                <p style={styles.note}>
                  L’option n’apparaît pas ? Le Compagnon est peut-être déjà installé : cherchez l’icône CEGECLIM. Sur
                  un navigateur autre que Chrome, ouvrez ce lien dans Chrome.
                </p>
              </>
            )}
          </section>
        )}

        {/* ── Ordinateur : projection en réunion ──────────── */}
        {estOrdinateur && (
          <div style={styles.grilleOrdi} className="grilleOrdi">
            <section style={{ ...styles.carte, ...styles.carteQr }}>
              <h2 style={styles.carteTitre}>Scannez avec l’appareil photo du téléphone</h2>
              <img src="/qr-installer.png" alt={`QR code vers ${APP_URL}`} style={styles.qr} />
              <div style={styles.url}>{APP_URL.replace('https://', '')}</div>
            </section>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <section style={styles.carte}>
                <h2 style={styles.carteTitre}>iPhone (Safari)</h2>
                <EtapesIphone navigateur="safari" />
              </section>
              <section style={styles.carte}>
                <h2 style={styles.carteTitre}>Android (Chrome)</h2>
                <p style={styles.carteTexte}>
                  Touchez le bouton <strong>« Installer le Compagnon »</strong> affiché sur la page, confirmez, puis
                  ouvrez l’icône CEGECLIM.
                </p>
              </section>
            </div>
          </div>
        )}

        {plateforme !== 'chargement' && !estOrdinateur && (
          <div style={styles.pied}>
            <a href={loginUrl} style={styles.lienDiscret}>
              Continuer sans installer →
            </a>
          </div>
        )}
      </div>
    </main>
  )
}

// ─── Styles ────────────────────────────────────────────────────────────────

const css = `
  @keyframes compagnonPulse {
    0% { box-shadow: 0 0 0 0 rgba(166,161,129,.55); }
    70% { box-shadow: 0 0 0 14px rgba(166,161,129,0); }
    100% { box-shadow: 0 0 0 0 rgba(166,161,129,0); }
  }
  .pulse { animation: compagnonPulse 2s infinite; }
  @media (max-width: 860px) { .grilleOrdi { grid-template-columns: 1fr !important; } }
`

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    margin: 0,
    background: `radial-gradient(120% 80% at 50% 0%, ${C.marine2} 0%, ${C.marine} 60%)`,
    color: C.creme,
    fontFamily: 'var(--font-body), -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: 'max(24px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom))',
    boxSizing: 'border-box',
  },
  cadre: { maxWidth: 480, margin: '0 auto' },
  cadreLarge: { maxWidth: 1040, margin: '0 auto' },
  entete: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 },
  icone: { borderRadius: 16, boxShadow: '0 6px 20px rgba(0,0,0,.35)', flexShrink: 0 },
  surtitre: {
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: C.sauge,
  },
  titre: {
    fontFamily: 'var(--font-display), -apple-system, sans-serif',
    fontSize: 26,
    lineHeight: 1.15,
    margin: '4px 0 0',
    fontWeight: 700,
  },
  intro: { fontSize: 15, lineHeight: 1.55, color: C.texteDoux, margin: '20px 0 18px' },
  bandeauIdentifiant: {
    fontSize: 13,
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${C.bord}`,
    background: 'rgba(166,161,129,0.10)',
    marginBottom: 14,
    wordBreak: 'break-all',
  },
  carte: {
    background: 'rgba(245,243,236,0.05)',
    border: `1px solid ${C.bord}`,
    borderRadius: 18,
    padding: '20px 18px',
    marginBottom: 16,
  },
  carteQr: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  carteTitre: {
    fontFamily: 'var(--font-display), -apple-system, sans-serif',
    fontSize: 18,
    fontWeight: 700,
    margin: '0 0 14px',
  },
  carteTexte: { fontSize: 15, lineHeight: 1.55, color: C.texteDoux, margin: '0 0 14px' },
  carteTexteCentre: { fontSize: 14, color: C.texteDoux, textAlign: 'center', margin: '12px 0 0' },
  etapes: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 },
  etape: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  etapeNum: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: C.creme,
    color: C.marine,
    fontWeight: 700,
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontFamily: 'var(--font-mono), ui-monospace, monospace',
  },
  etapeTitre: { fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  etapePicto: {
    display: 'inline-flex',
    color: '#4DA3FF',
    background: 'rgba(77,163,255,0.12)',
    borderRadius: 8,
    padding: 4,
  },
  etapeTexte: { fontSize: 14, lineHeight: 1.5, color: C.texteDoux, marginTop: 4 },
  boutonPrincipal: {
    width: '100%',
    background: C.creme,
    color: C.marine,
    border: 0,
    borderRadius: 14,
    padding: '16px 20px',
    fontSize: 17,
    fontWeight: 700,
    fontFamily: 'var(--font-display), -apple-system, sans-serif',
    cursor: 'pointer',
  },
  boutonSecondaire: {
    background: 'transparent',
    color: C.creme,
    border: `1px solid ${C.bord}`,
    borderRadius: 12,
    padding: '12px 18px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  avertissement: { fontSize: 14, color: C.alerte, margin: '16px 0 12px' },
  note: { fontSize: 13, lineHeight: 1.5, color: C.texteDoux, margin: '16px 0 0' },
  pied: { textAlign: 'center', marginTop: 8 },
  lienDiscret: { color: C.sauge, fontSize: 14, textDecoration: 'none' },
  grilleOrdi: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' },
  qr: { width: '100%', maxWidth: 360, borderRadius: 16, background: '#FFFFFF', padding: 12, boxSizing: 'border-box' },
  url: { fontFamily: 'var(--font-mono), ui-monospace, monospace', fontSize: 14, color: C.sauge, marginTop: 14 },
}
