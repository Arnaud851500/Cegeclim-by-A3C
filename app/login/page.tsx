'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const logoA3C =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/A3C_conseil_logo.svg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9BM0NfY29uc2VpbF9sb2dvLnN2ZyIsImlhdCI6MTc3NDM4NDU5MywiZXhwIjo0ODk2NDQ4NTkzfQ.LRJdkDHMYsQW7-odB29ewButNKwI2cXK1wl5y82gMLY'
  const logoCegeclim =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/cegecilm%20officiel.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL2NlZ2VjaWxtIG9mZmljaWVsLmpwZyIsImlhdCI6MTc3NDQ2NDE3NCwiZXhwIjo0ODk2NTI4MTc0fQ.g5XD3gFp4jxV1llUgHV0lpWnmU2Yz-2s0EIeDqXdlzs'


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
      return
    }

    router.replace('/territoire')
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={topLogoWrapperStyle}>
          <img
            src={logoCegeclim}
            alt="Cegeclim"
            style={topLogoStyle}
          />
        </div>

        <form onSubmit={handleLogin} style={formWrapperStyle}>
          <div style={formGridStyle}>
            <label style={labelStyle}>User</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              autoComplete="username"
            />

            <label style={labelStyle}>Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              autoComplete="current-password"
            />
          </div>

          <div style={buttonRowStyle}>
            <button type="submit" style={buttonStyle} disabled={loading}>
              {loading ? 'Connexion...' : 'Connexion'}
            </button>
          </div>

          {errorMsg ? <div style={errorStyle}>{errorMsg}</div> : null}
        </form>

        <img
          src={logoA3C}
          alt="A3C Conseil"
          style={bottomLogoStyle}
        />
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'rgb(41, 59, 86)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
}

const cardStyle: React.CSSProperties = {
  position: 'relative',
  width: '80%',
  maxWidth: 1350,
  minHeight: 660,
  background: '#ffffff',
  borderRadius: 26,
  border: '1px solid rgba(16,24,40,0.10)',
  boxShadow: '0 6px 18px rgba(15,23,42,0.10)',
  padding: '70px 90px',
  boxSizing: 'border-box',
}

const topLogoWrapperStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  marginBottom: 90,
}

const topLogoStyle: React.CSSProperties = {
  width: 620,
  maxWidth: '100%',
  height: 'auto',
  objectFit: 'contain',
}

const formWrapperStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 550 ,
  margin: '10 auto',
}

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '220px 1fr',
  alignItems: 'center',
  columnGap: 60,
  rowGap: 22,
}

const labelStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 500,
  color: '#111827',
  textAlign: 'left',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 68,
  borderRadius: 20,
  border: '4px solid #17395a',
  background: '#f7f7f7',
  padding: '0 20px',
  fontSize: 24,
  color: '#111827',
  outline: 'none',
  boxSizing: 'border-box',
}

const buttonRowStyle: React.CSSProperties = {
  marginTop: 36,
  marginLeft: 280,
}

const buttonStyle: React.CSSProperties = {
  minWidth: 230,
  height: 66,
  borderRadius: 20,
  border: '4px solid #17395a',
  background: '#f7f7f7',
  color: '#111827',
  fontSize: 24,
  fontWeight: 700,
  cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  marginTop: 20,
  marginLeft: 280,
  color: '#b42318',
  fontSize: 16,
  fontWeight: 600,
}

const bottomLogoStyle: React.CSSProperties = {
  position: 'absolute',
  right: 38,
  bottom: 28,
  width: 130,
  height: 'auto',
  objectFit: 'contain',
}