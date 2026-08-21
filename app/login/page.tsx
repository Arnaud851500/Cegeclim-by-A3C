'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'
import { logUserEvent } from '@/lib/audit'

const fontDisplay = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' })
const fontBody = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-body' })
const fontMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' })

const DEFAULT_LANDING_PAGE = '/accueil'

/** Préfixe des clés localStorage mémorisant les messages déjà masqués. */
const ANNONCE_MASQUEE_PREFIX = 'cegeclim_annonce_masquee_'

type Annonce = {
  id: string
  titre: string | null
  message: string
  date_debut: string
  date_fin: string
  dismissible: boolean
  dismiss_after_seconds: number
}

async function getUserLandingPage(email: string | null | undefined) {
  const normalizedEmail = String(email || '').toLowerCase().trim()
  if (!normalizedEmail) return DEFAULT_LANDING_PAGE

  const { data, error } = await supabase
    .from('user_page_access')
    .select('default_landing_page')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (error) return DEFAULT_LANDING_PAGE

  const page = String(data?.default_landing_page || '').trim()
  return page || DEFAULT_LANDING_PAGE
}

/**
 * Message temporaire piloté par la table `app_announcements`.
 * Rien n'est codé en dur : période de diffusion, texte, possibilité de masquer
 * et délai avant que le bouton « Ne plus afficher » s'active sont tous des
 * colonnes. Publier ou retirer un message ne demande aucun déploiement.
 */
function AnnonceTemporaire() {
  const [annonce, setAnnonce] = useState<Annonce | null>(null)
  const [secondesRestantes, setSecondesRestantes] = useState(0)
  const [masquee, setMasquee] = useState(false)

  useEffect(() => {
    let annule = false

    async function charger() {
      const { data, error } = await supabase
        .from('app_announcements')
        .select('id, titre, message, date_debut, date_fin, dismissible, dismiss_after_seconds')
        .in('emplacement', ['login', 'both'])
        .eq('actif', true)
        .order('ordre', { ascending: true })
        .order('date_debut', { ascending: true })

      // Une annonce indisponible ne doit jamais empêcher de se connecter :
      // on trace en console et on n'affiche rien.
      if (error) {
        console.warn('[annonces] lecture impossible :', error.message)
        return
      }
      if (annule) return

      const aujourdhui = new Date().toISOString().slice(0, 10)

      const premiere = ((data || []) as Annonce[])
        .filter((a) => a.date_debut <= aujourdhui && aujourdhui <= a.date_fin)
        .find((a) => {
          if (!a.dismissible) return true
          try {
            return window.localStorage.getItem(`${ANNONCE_MASQUEE_PREFIX}${a.id}`) !== '1'
          } catch {
            return true
          }
        })

      if (!premiere) return

      setAnnonce(premiere)
      setSecondesRestantes(Math.max(0, Number(premiere.dismiss_after_seconds || 0)))
    }

    void charger()
    return () => {
      annule = true
    }
  }, [])

  useEffect(() => {
    if (!annonce || secondesRestantes <= 0) return
    const timer = window.setTimeout(() => setSecondesRestantes((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [annonce, secondesRestantes])

  const masquer = useCallback(() => {
    if (!annonce) return
    try {
      window.localStorage.setItem(`${ANNONCE_MASQUEE_PREFIX}${annonce.id}`, '1')
    } catch {
      // Navigation privée ou stockage refusé : le message réapparaîtra, ce qui
      // est le comportement le moins risqué pour une information importante.
    }
    setMasquee(true)
  }, [annonce])

  if (!annonce || masquee) return null

  const boutonActif = secondesRestantes <= 0

  return (
    <div style={styles.annonceWrap} role="status" aria-live="polite">
      <div style={styles.annonceCarte}>
        <span style={styles.annoncePastille} aria-hidden="true" />

        <div style={styles.annonceTexte}>
          {annonce.titre && <div style={styles.annonceTitre}>{annonce.titre}</div>}
          <div style={styles.annonceMessage}>{annonce.message}</div>
        </div>

        {annonce.dismissible && (
          <button
            type="button"
            onClick={masquer}
            disabled={!boutonActif}
            style={{
              ...styles.annonceBouton,
              opacity: boutonActif ? 1 : 0.45,
              cursor: boutonActif ? 'pointer' : 'default',
            }}
          >
            {boutonActif ? 'Ne plus afficher' : `Ne plus afficher (${secondesRestantes} s)`}
          </button>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const { loading: accessLoading, email: sessionEmail } = useAccess()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const logoCegeclim =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

  const backgroundImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/Image%20site%20CEGECLIM%20maison.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9JbWFnZSBzaXRlIENFR0VDTElNIG1haXNvbi5qcGciLCJpYXQiOjE3NzU1MDYyNTEsImV4cCI6NDg5NzU3MDI1MX0.d1YT7_-xD44QOm2LFbZIfpkjh9kiIGjpJiEuJxV0rMM'

  /**
   * Redirection après authentification.
   *
   * `router.replace` fait une navigation côté client : la coque applicative se
   * ré-évalue sans rechargement et peut, si la session n'est pas encore visible
   * à cet instant précis, renvoyer aussitôt vers /login — l'utilisateur revient
   * alors sur un formulaire vide sans le moindre message. Le filet ci-dessous
   * force un chargement complet si l'on est toujours sur /login peu après :
   * la session est relue depuis le stockage, et le rebond devient impossible.
   */
  const allerVers = useCallback(
    (destination: string) => {
      router.replace(destination)

      window.setTimeout(() => {
        if (window.location.pathname === '/login') {
          console.warn('[login] navigation cliente sans effet, rechargement complet vers', destination)
          window.location.assign(destination)
        }
      }, 1200)
    },
    [router],
  )

  useEffect(() => {
    if (accessLoading) return

    if (sessionEmail) {
      void (async () => {
        const landingPage = await getUserLandingPage(sessionEmail)
        allerVers(landingPage)
      })()
    }
  }, [accessLoading, sessionEmail, allerVers])

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const normalizedEmail = email.toLowerCase().trim()

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })

      if (error) {
        // L'erreur dit ce qui s'est passé et quoi faire, sans révéler si
        // l'adresse existe.
        setErrorMsg("Cette combinaison identifiant / mot de passe n'est pas reconnue. Vérifiez la saisie puis réessayez.")
        setLoading(false)
        return
      }

      // La journalisation ne doit jamais empêcher d'entrer : si l'audit tombe,
      // on trace et on poursuit.
      try {
        await logUserEvent({
          user_email: data.user?.email ?? email,
          event_type: 'login',
          pathname: '/login',
          metadata: { result: 'success' },
        })
      } catch (err) {
        console.warn('[login] journalisation impossible :', err)
      }

      let landingPage = DEFAULT_LANDING_PAGE
      try {
        landingPage = await getUserLandingPage(data.user?.email || normalizedEmail)
      } catch (err) {
        console.warn('[login] page d\'accueil du profil illisible, repli sur', DEFAULT_LANDING_PAGE, err)
      }

      setLoading(false)
      allerVers(landingPage)
    } catch (err) {
      // Sans ce filet, une exception laissait le bouton bloqué sur
      // « Connexion… » ou la page figée, sans rien afficher.
      console.error('[login] échec inattendu :', err)
      setErrorMsg("La connexion n'a pas abouti. Réessayez ; si le problème persiste, signalez-le avec l'heure exacte.")
      setLoading(false)
    }
  }

  return (
    <main
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable} loginPage`}
      style={styles.page}
    >
      <AnnonceTemporaire />

      {/* --- Volet identité : la photo recule derrière un voile marine ----- */}
      <section
        className="loginVisuel"
        style={{
          ...styles.visuel,
          backgroundImage: `linear-gradient(180deg, rgba(11,18,32,0.70), rgba(11,18,32,0.93)), url("${backgroundImageUrl}")`,
        }}
      >
        <div style={styles.marque} className="loginMarque">
          <img src={logoCegeclim} alt="CEGECLIM Énergies" style={styles.logo} className="loginLogo" />
          <div>
            <div style={styles.marqueSur} className="loginMarqueSur">
              Concessionnaire agréé de Bosch Home Comfort Group
            </div>
            <div style={styles.marqueNom} className="loginMarqueNom">
              Hitachi Cooling &amp; Heating
            </div>
          </div>
        </div>

        {/* Signature de marque. Le bicolore d'origine est marine + vert ; sur
            fond sombre le marine deviendrait illisible, la première partie
            passe donc en blanc et le vert #9EAD43 est conservé tel quel. */}
        <div style={styles.signature} className="loginSignature">
          Distributeur de solutions <span style={styles.signatureAccent}>durables</span>
        </div>

        <div style={styles.visuelBas} className="loginVisuelBas">
          <div style={styles.eyebrow} className="loginEyebrow">Suivi commercial &amp; prospect</div>
          <h1 style={styles.titre} className="loginTitre">Le pilotage commercial CEGECLIM</h1>
          <p style={styles.sousTitre} className="loginSousTitre">
            Activité quotidienne, portefeuille de commandes, projection de stock et indicateurs d&rsquo;agence,
            sur un même périmètre.
          </p>

          <div style={styles.rail} className="loginRail">
            <div>
              <div style={styles.railEtiquette}>Tableaux de bord</div>
              <div style={styles.railValeur}>9</div>
            </div>
            <div>
              <div style={styles.railEtiquette}>Périmètre</div>
              <div style={styles.railValeur}>Par profil</div>
            </div>
            <div>
              <div style={styles.railEtiquette}>Mise à jour</div>
              <div style={styles.railValeur}>Quotidienne</div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Volet formulaire --------------------------------------------- */}
      <section style={styles.voletForm} className="loginVolet">
        <div style={styles.carte} className="loginCarte">
          <div style={styles.formTitre} className="loginFormTitre">Connexion</div>
          <div style={styles.formAide} className="loginFormAide">Utilisez l&rsquo;adresse professionnelle associée à votre profil.</div>

          <form onSubmit={handleLogin} style={{ marginTop: 4 }} className="loginForm">
            <div style={styles.champ} className="loginChamp">
              <label htmlFor="email" style={styles.label} className="loginLabel">Identifiant</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                className="loginInput"
                autoComplete="email"
                placeholder="prenom.nom@cegeclim.fr"
              />
            </div>

            <div style={styles.champ} className="loginChamp">
              <label htmlFor="password" style={styles.label} className="loginLabel">Mot de passe</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                className="loginInput"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            <button type="submit" disabled={loading} style={styles.bouton} className="loginBouton">
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>

            {!!errorMsg && <div style={styles.erreur} role="alert">{errorMsg}</div>}
          </form>

          <div style={styles.pied} className="loginPied">Profil et périmètre appliqués automatiquement à la connexion.</div>
        </div>
      </section>

      <style jsx global>{`
        html, body { margin: 0; }

        .loginInput:focus {
          border-color: #A6A181 !important;
          box-shadow: 0 0 0 3px rgba(166, 161, 129, 0.28);
        }
        .loginBouton:hover:not(:disabled) { filter: brightness(1.08); }
        .loginBouton:disabled { opacity: 0.6; cursor: default; }

        @media (max-width: 1400px) {
          .loginCarte { max-width: 470px !important; }
        }

        /* Le volet identité passe au-dessus du formulaire sur écran étroit,
           réduit à une bande : la photo reste présente sans voler la hauteur
           nécessaire à la saisie. */
        @media (max-width: 1000px) {
          .loginPage { grid-template-columns: 1fr !important; }
          .loginVisuel { min-height: 300px; padding: 28px 26px !important; }
          .loginSousTitre { font-size: 17px !important; }
          .loginSignature { font-size: 19px !important; margin-top: 20px !important; }
          .loginRail { display: none !important; }
          .loginVolet { padding: 30px 20px !important; }
        }

        /* ---- Mobile : tout tient dans la hauteur d'écran, sans scroll. ----
           On passe en répartition par vh (au lieu de paddings fixes empilés),
           on retire les blocs non essentiels (rail déjà masqué, sous-titre et
           pied de carte allégés), et le titre passe sur une seule ligne via
           un corps de police qui s'ajuste à la largeur disponible. */
        @media (max-width: 600px) {
          html, body { height: 100%; overflow: hidden; }

          .loginPage {
            height: 100dvh;
            min-height: 100dvh;
            overflow: hidden;
            grid-template-rows: auto 1fr;
          }

          .loginVisuel {
            min-height: 0;
            height: 38dvh;
            padding: 16px 20px 14px !important;
            justify-content: space-between;
          }

          .loginMarque { gap: 12px !important; }
          .loginLogo { width: 96px !important; padding: 5px 8px !important; border-radius: 8px !important; }
          .loginMarqueSur { font-size: 10.5px !important; line-height: 1.2 !important; }
          .loginMarqueNom { font-size: 15px !important; margin-top: 2px !important; }

          .loginSignature { display: none !important; }

          .loginVisuelBas { margin-top: 0 !important; }
          .loginEyebrow { font-size: 10px !important; letter-spacing: 0.18em !important; }

          .loginTitre {
            font-size: clamp(15px, 5.6vw, 22px) !important;
            line-height: 1.08 !important;
            margin: 6px 0 0 !important;
            max-width: none !important;
            white-space: nowrap !important;
          }

          .loginSousTitre { display: none !important; }

          .loginVolet {
            padding: 16px !important;
            height: 62dvh;
            overflow: hidden;
          }

          .loginCarte {
            max-width: 100% !important;
            padding: 20px 20px 16px !important;
            border-radius: 16px !important;
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100%;
            box-sizing: border-box;
          }

          .loginFormTitre { font-size: 24px !important; }
          .loginFormAide { font-size: 13.5px !important; margin-top: 6px !important; }

          .loginChamp { margin-top: 14px !important; }
          .loginLabel { font-size: 11px !important; margin-bottom: 6px !important; }
          .loginInput { height: 46px !important; font-size: 15px !important; padding: 0 14px !important; }

          .loginBouton { height: 48px !important; margin-top: 18px !important; font-size: 15px !important; }

          .loginPied { display: none !important; }
        }

        @media (max-width: 600px) and (max-height: 700px) {
          .loginVisuel { height: 32dvh; }
          .loginVolet { height: 68dvh; }
        }

        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; }
        }
      `}</style>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '1fr 0.92fr',
    background: '#0B1220',
    fontFamily: 'var(--font-body)',
    color: '#fff',
  },

  /* ---- Message temporaire ----------------------------------------------- */

  annonceWrap: {
    position: 'fixed',
    top: 22,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 60,
    width: 'min(880px, calc(100vw - 32px))',
    display: 'flex',
    justifyContent: 'center',
  },

  annonceCarte: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    borderRadius: 14,
    background: '#F5F3EC',
    color: '#141A26',
    border: '1px solid rgba(166,161,129,0.55)',
    boxShadow: '0 18px 44px rgba(0,0,0,0.42)',
  },

  annoncePastille: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#C1683C',
    boxShadow: '0 0 0 4px rgba(193,104,60,0.18)',
    flexShrink: 0,
  },

  annonceTexte: {
    flex: 1,
    minWidth: 0,
  },

  annonceTitre: {
    fontFamily: 'var(--font-display)',
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    marginBottom: 3,
  },

  annonceMessage: {
    fontSize: 14,
    lineHeight: 1.5,
    color: 'rgba(20,26,38,0.75)',
  },

  annonceBouton: {
    flexShrink: 0,
    border: '1px solid rgba(20,26,38,0.22)',
    background: '#ffffff',
    color: '#141A26',
    borderRadius: 9,
    padding: '9px 14px',
    fontFamily: 'var(--font-body)',
    fontSize: 12.5,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },

  /* ---- Volet identité ---------------------------------------------------- */

  visuel: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    padding: '52px 56px 50px',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  },

  marque: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
  },

  logo: {
    width: 210,
    height: 'auto',
    objectFit: 'contain',
    background: '#fff',
    borderRadius: 10,
    padding: '7px 12px',
    flexShrink: 0,
  },

  marqueSur: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 1.25,
  },

  marqueNom: {
    fontFamily: 'var(--font-display)',
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: '-0.015em',
    marginTop: 4,
  },

  signature: {
    marginTop: 30,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: 'clamp(18px, 1.85vw, 30px)',
    lineHeight: 1.1,
    letterSpacing: '-0.005em',
    textTransform: 'uppercase',
    color: '#ffffff',
  },

  signatureAccent: {
    color: '#9EAD43',
  },

  visuelBas: {
    marginTop: 'auto',
  },

  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 15,
    fontWeight: 500,
    letterSpacing: '0.26em',
    textTransform: 'uppercase',
    color: '#A6A181',
  },

  titre: {
    fontFamily: 'var(--font-display)',
    // Le titre suit la largeur disponible plutôt qu'une valeur figée : sur un
    // très grand écran il double vraiment, sans déborder sur un portable.
    fontSize: 'clamp(30px, 5.4vw, 74px)',
    fontWeight: 700,
    lineHeight: 1.02,
    letterSpacing: '-0.035em',
    margin: '20px 0 0',
    maxWidth: '15ch',
  },

  sousTitre: {
    fontSize: 20,
    lineHeight: 1.55,
    color: 'rgba(255,255,255,0.6)',
    margin: '22px 0 0',
    maxWidth: '44ch',
  },

  rail: {
    display: 'flex',
    gap: 48,
    marginTop: 42,
    paddingTop: 28,
    borderTop: '1px solid rgba(255,255,255,0.16)',
  },

  railEtiquette: {
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.42)',
  },

  railValeur: {
    fontFamily: 'var(--font-mono)',
    fontSize: 30,
    fontWeight: 600,
    marginTop: 8,
  },

  /* ---- Volet formulaire -------------------------------------------------- */

  voletForm: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 44px',
  },

  carte: {
    width: '100%',
    maxWidth: 540,
    background: '#F5F3EC',
    borderRadius: 20,
    padding: '46px 44px 36px',
    color: '#141A26',
    boxShadow: '0 28px 70px rgba(0,0,0,0.38)',
  },

  formTitre: {
    fontFamily: 'var(--font-display)',
    fontSize: 38,
    fontWeight: 700,
    letterSpacing: '-0.025em',
    lineHeight: 1.05,
  },

  formAide: {
    fontSize: 17,
    lineHeight: 1.5,
    color: 'rgba(20,26,38,0.55)',
    marginTop: 10,
  },

  champ: {
    marginTop: 28,
  },

  label: {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(20,26,38,0.5)',
    marginBottom: 10,
  },

  input: {
    width: '100%',
    height: 58,
    borderRadius: 12,
    padding: '0 18px',
    fontSize: 18,
    fontFamily: 'var(--font-body)',
    color: '#141A26',
    background: '#fff',
    border: '1px solid rgba(20,26,38,0.16)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  },

  bouton: {
    width: '100%',
    height: 60,
    marginTop: 34,
    border: 'none',
    borderRadius: 12,
    background: '#A6A181',
    color: '#141A26',
    fontFamily: 'var(--font-body)',
    fontSize: 18,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'filter 0.15s ease',
  },

  erreur: {
    marginTop: 20,
    padding: '13px 15px',
    borderRadius: 12,
    background: 'rgba(193,104,60,0.12)',
    border: '1px solid rgba(193,104,60,0.28)',
    color: '#9C4A24',
    fontSize: 15,
    lineHeight: 1.5,
  },

  pied: {
    marginTop: 24,
    fontSize: 14,
    color: 'rgba(20,26,38,0.4)',
    textAlign: 'center',
  },
}
