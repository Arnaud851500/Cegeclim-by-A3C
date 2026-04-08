'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Montserrat } from 'next/font/google'
import { supabase } from '@/lib/supabaseClient'
import { useAccess } from '@/components/AccessContext'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
})

const DEFAULT_LANDING_PAGE = '/accueil'

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

export default function LoginPage() {
  const router = useRouter()
  const { loading: accessLoading, email: sessionEmail } = useAccess()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // Logo CEGECLIM déjà présent
  const logoCegeclim =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

  // À remplacer par l’URL réelle de la photo maison dans ton bucket Supabase
  const backgroundImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/Image%20site%20CEGECLIM%20maison.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9JbWFnZSBzaXRlIENFR0VDTElNIG1haXNvbi5qcGciLCJpYXQiOjE3NzU1MDYyNTEsImV4cCI6NDg5NzU3MDI1MX0.d1YT7_-xD44QOm2LFbZIfpkjh9kiIGjpJiEuJxV0rMM'

  useEffect(() => {
    if (accessLoading) return

    if (sessionEmail) {
      void (async () => {
        const landingPage = await getUserLandingPage(sessionEmail)
        router.replace(landingPage)
      })()
    }
  }, [accessLoading, sessionEmail, router])

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const normalizedEmail = email.toLowerCase().trim()

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      setErrorMsg('Identifiant ou mot de passe incorrect.')
      setLoading(false)
      return
    }

    const landingPage = await getUserLandingPage(data.user?.email || normalizedEmail)
    setLoading(false)
    router.replace(landingPage)
  }

  return (
    <main className={montserrat.className} style={styles.page}>
      <div style={styles.header} className="loginHeader">
        <div style={styles.headerLeft} className="loginHeaderLeft">
          <img
            src={logoCegeclim}
            alt="Cegeclim Énergies"
            style={styles.logo}
            className="loginLogo"
          />

          <div style={styles.headerTitles} className="loginHeaderTitles">
            <div style={styles.headerSubtitle} className="loginHeaderSubtitle">
              Concessionnaire agréé de Bosch Home Comfort Group
            </div>
            <div style={styles.headerTitle} className="loginHeaderTitle">
              Hitachi Cooling &amp; Heating
            </div>
          </div>
        </div>

        <div style={styles.headerRight} className="loginHeaderRight">
          <span style={styles.headerRightBlue}>DISTRIBUTEUR DE SOLUTIONS </span>
          <span style={styles.headerRightGreen}>DURABLES</span>
        </div>
      </div>

      <section
        className="loginHero"
        style={{
          ...styles.hero,
          backgroundImage: `url("${backgroundImageUrl}")`,
        }}
      >
        <div style={styles.formCard} className="loginCard">
          <div style={styles.formTitle} className="loginCardTitle">
            ACCES INTRANET
          </div>

          <form onSubmit={handleLogin} style={styles.form}>
            <div style={styles.formRow} className="loginRow">
              <label htmlFor="email" style={styles.label} className="loginLabel">
                User
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                className="loginInput"
                autoComplete="email"
              />
            </div>

            <div style={styles.formRow} className="loginRow">
              <label htmlFor="password" style={styles.label} className="loginLabel">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                className="loginInput"
                autoComplete="current-password"
              />
            </div>

            <div style={styles.buttonRow}>
              <button
                type="submit"
                disabled={loading}
                style={styles.button}
                className="loginButton"
              >
                {loading ? 'Connexion...' : 'Connexion'}
              </button>
            </div>

            {!!errorMsg && <div style={styles.error}>{errorMsg}</div>}
          </form>
        </div>
      </section>

      <style jsx>{`
        @media (max-width: 1200px) {
          .loginHeader {
            padding: 12px 24px;
          }

          .loginHeaderRight {
            font-size: 20px;
          }

          .loginHeaderSubtitle {
            font-size: 20px;
          }

          .loginHeaderTitle {
            font-size: 25px;
          }

          .loginCard {
            max-width: 680px;
          }
        }

        @media (max-width: 980px) {
          .loginHeader {
            height: auto;
            min-height: 96px;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 10px;
          }

          .loginHeaderLeft {
            width: 100%;
          }

          .loginHeaderRight {
            width: 100%;
            text-align: left;
            white-space: normal;
            margin-left: 0;
            font-size: 18px;
          }

          .loginLogo {
            width: 118px !important;
          }

          .loginHeaderSubtitle {
            font-size: 18px;
          }

          .loginHeaderTitle {
            font-size: 23px;
          }

          .loginHero {
            min-height: calc(100vh - 96px);
            padding: 24px;
          }

          .loginCard {
            max-width: 640px;
            padding: 28px 30px 24px !important;
          }

          .loginCardTitle {
            font-size: 30px !important;
            margin-bottom: 24px !important;
          }

          .loginRow {
            grid-template-columns: 160px 1fr !important;
            column-gap: 22px !important;
          }

          .loginLabel {
            font-size: 20px !important;
          }
        }

        @media (max-width: 700px) {
          .loginHeader {
            padding: 12px 16px;
          }

          .loginHeaderLeft {
            gap: 12px;
            align-items: flex-start;
          }

          .loginLogo {
            width: 90px !important;
          }

          .loginHeaderSubtitle {
            font-size: 14px;
            line-height: 1.2;
          }

          .loginHeaderTitle {
            font-size: 19px;
            line-height: 1.12;
          }

          .loginHeaderRight {
            font-size: 15px;
          }

          .loginHero {
            padding: 16px;
            background-position: center center;
          }

          .loginCard {
            width: 100%;
            padding: 22px 18px 20px !important;
          }

          .loginCardTitle {
            font-size: 24px !important;
            margin-bottom: 20px !important;
          }

          .loginRow {
            grid-template-columns: 1fr !important;
            row-gap: 8px !important;
            margin-bottom: 16px !important;
          }

          .loginLabel {
            font-size: 18px !important;
          }

          .loginInput {
            height: 48px !important;
            font-size: 16px !important;
            border-radius: 14px !important;
          }

          .loginButton {
            min-width: 160px !important;
            height: 48px !important;
            font-size: 18px !important;
            border-radius: 14px !important;
          }
        }
      `}</style>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    width: '100%',
    margin: 0,
    background: '#e9e9e9',
  },

  header: {
    height: 108,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 34px 10px 28px',
    boxSizing: 'border-box',
    borderBottom: '1px solid #ececec',
    gap: 20,
  },

  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 18,
    minWidth: 0,
  },

  logo: {
    width: 150,
    height: 'auto',
    objectFit: 'contain',
    flexShrink: 0,
  },

  headerTitles: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minWidth: 0,
  },

  headerSubtitle: {
    fontSize: 23,
    fontWeight: 500,
    color: '#2d2d2d',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
  },

  headerTitle: {
    fontSize: 28,
    fontWeight: 800,
    color: '#222222',
    lineHeight: 1.08,
    letterSpacing: '-0.02em',
    marginTop: 2,
  },

  headerRight: {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.1,
    letterSpacing: '0.01em',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    marginLeft: 24,
    flexShrink: 0,
  },

  headerRightBlue: {
    color: '#17344d',
  },

  headerRightGreen: {
    color: '#9ead43',
  },

  hero: {
    width: '100%',
    minHeight: 'calc(100vh - 108px)',
    backgroundSize: 'cover',
    backgroundPosition: 'center center',
    backgroundRepeat: 'no-repeat',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    boxSizing: 'border-box',
  },

  formCard: {
    width: '100%',
    maxWidth: 720,
    background: 'rgba(247, 247, 247, 0.97)',
    padding: '34px 56px 26px',
    boxSizing: 'border-box',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
  },

  formTitle: {
    textAlign: 'center',
    color: '#17344d',
    fontSize: 34,
    fontWeight: 800,
    letterSpacing: '-0.02em',
    marginBottom: 30,
  },

  form: {
    width: '100%',
  },

  formRow: {
    display: 'grid',
    gridTemplateColumns: '190px 1fr',
    alignItems: 'center',
    columnGap: 34,
    marginBottom: 20,
  },

  label: {
    fontSize: 22,
    fontWeight: 500,
    color: '#1f2430',
  },

  input: {
    width: '100%',
    height: 54,
    background: '#f7f7f7',
    border: '3px solid #17344d',
    borderRadius: 18,
    padding: '0 18px',
    fontSize: 18,
    color: '#1f2430',
    outline: 'none',
    boxSizing: 'border-box',
  },

  buttonRow: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 8,
  },

  button: {
    minWidth: 160,
    height: 52,
    borderRadius: 16,
    border: '3px solid #17344d',
    background: '#f7f7f7',
    color: '#1f2430',
    fontSize: 18,
    fontWeight: 700,
    cursor: 'pointer',
  },

  error: {
    marginTop: 16,
    textAlign: 'center',
    color: '#b42318',
    fontSize: 14,
    fontWeight: 600,
  },
}
