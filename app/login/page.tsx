'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useAccess, getFirstAllowedPath } from '@/components/AccessContext'

export default function LoginPage() {
  const router = useRouter()
  const { loading: accessLoading, rights, email: sessionEmail } = useAccess()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const logoA3C =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/A3C_conseil_logo.svg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9BM0NfY29uc2VpbF9sb2dvLnN2ZyIsImlhdCI6MTc3NDY1MTUyNSwiZXhwIjo0ODk2NzE1NTI1fQ.rqa0mdsrltexkL0PILiL5AnADb3tTSCGUWLyv2v2V3Q'
  const logoCegeclim =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDY1MTM3OSwiZXhwIjo0ODk2NzE1Mzc5fQ.ePcMFHir7RsvdR-cR7nwh83H03S8oihNKwVgK2eCmy0'

  useEffect(() => {
    if (accessLoading) return

    if (sessionEmail) {
      const path = getFirstAllowedPath(rights)
      router.replace(path)
    }
  }, [accessLoading, sessionEmail, rights, router])

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setLoading(true)
    setErrorMsg('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setErrorMsg(error.message)
      setLoading(false)
      return
    }

    setLoading(false)
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={logosTopStyle}>
          <img src={logoCegeclim} alt="Cegeclim Énergies" style={logoTopStyle} />
        </div>

        <div style={formWrapperStyle}>
          <form onSubmit={handleLogin}>
            <div style={formGridStyle}>
              <label style={labelStyle}>User</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />

              <label style={labelStyle}>Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={buttonRowStyle}>
              <button type="submit" style={buttonStyle} disabled={loading}>
                {loading ? 'Connexion...' : 'Connexion'}
              </button>
            </div>
          </form>

          {errorMsg && <p style={errorStyle}>{errorMsg}</p>}
        </div>

        <img
          src={logoA3C}
          alt="A3C Conseil"
          style={logoBottomRightStyle}
        />
      </div>
    </div>
  )
}

/* ===================== STYLES ===================== */

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#2e3952',
  padding: 24,
  boxSizing: 'border-box',
}

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 1120,
  background: '#ffffff',
  border: '1px solid #d0d7de',
  borderRadius: 18,
  padding: '40px 48px 50px',
  boxSizing: 'border-box',
  position: 'relative',
  minHeight: 620,
}

const logosTopStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: 72,
}

const logoTopStyle: React.CSSProperties = {
  maxWidth: 430,
  maxHeight: 220,
  objectFit: 'contain',
}

const formWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px 320px',
  gap: '18px 24px',
  alignItems: 'center',
}

const labelStyle: React.CSSProperties = {
  fontSize: 18,
  color: '#101828',
  textAlign: 'left',
  fontWeight: 500,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 44,
  borderRadius: 12,
  border: '2px solid #16324a',
  padding: '0 12px',
  fontSize: 16,
  boxSizing: 'border-box',
  outline: 'none',
}

const buttonRowStyle: React.CSSProperties = {
  marginTop: 20,
  display: 'flex',
  justifyContent: 'center',
}

const buttonStyle: React.CSSProperties = {
  height: 44,
  padding: '0 24px',
  borderRadius: 12,
  border: '2px solid #16324a',
  background: '#ffffff',
  color: '#101828',
  fontSize: 16,
  fontWeight: 700,
  cursor: 'pointer',
}

const logoBottomRightStyle: React.CSSProperties = {
  position: 'absolute',
  right: 28,
  bottom: 18,
  width: 105,
  height: 'auto',
  objectFit: 'contain',
}

const errorStyle: React.CSSProperties = {
  marginTop: 18,
  color: '#b42318',
  textAlign: 'center',
}