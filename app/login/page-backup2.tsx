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
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Logo%20et%20images/Cegeclim.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvIGV0IGltYWdlcy9DZWdlY2xpbS5wbmciLCJpYXQiOjE3NzQzODQ2MjgsImV4cCI6NDg5NjQ0ODYyOH0.TeMYJJWCzmXPRP_5zDzeBqUspJDeT_uxjys7Ahps_6E'

  const handleLogin = async () => {
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

    router.replace('/dashboard')
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={logosRowStyle}>
          <img src={logoA3C} alt="A3C Conseil" style={logoLeftStyle} />

          <div style={middleTextStyle}></div>

          <img src={logoCegeclim} alt="Cegeclim Énergies" style={logoRightStyle} />
        </div>

        <div style={formWrapperStyle}>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleLogin()
              }}
            />
          </div>

          <div style={buttonRowStyle}>
            <button onClick={handleLogin} style={buttonStyle} disabled={loading}>
              {loading ? 'Connexion...' : 'Connexion'}
            </button>
          </div>

          {errorMsg && <p style={errorStyle}>{errorMsg}</p>}
        </div>
      </div>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#5f6c89',
  padding: 24,
  boxSizing: 'border-box',
}

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 980,
  background: '#ffffff',
  border: '1px solid #d0d7de',
  borderRadius: 18,
  padding: '40px 48px 50px',
  boxSizing: 'border-box',
}

const logosRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  gap: 24,
  marginBottom: 56,
}

const logoLeftStyle: React.CSSProperties = {
  maxWidth: 72,
  maxHeight: 36,
  objectFit: 'contain',
  justifySelf: 'left',
}

const logoRightStyle: React.CSSProperties = {
  maxWidth: 360,
  maxHeight: 180,
  objectFit: 'contain',
  justifySelf: 'center',
}

const middleTextStyle: React.CSSProperties = {
  fontSize: 16,
  color: '#101828',
  whiteSpace: 'nowrap',
}

const formWrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
}

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '160px 280px',
  gap: '14px 18px',
  alignItems: 'center',
}

const labelStyle: React.CSSProperties = {
  fontSize: 18,
  color: '#101828',
  textAlign: 'left',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 42,
  borderRadius: 10,
  border: '2px solid #16324a',
  padding: '0 12px',
  fontSize: 16,
  boxSizing: 'border-box',
  outline: 'none',
}

const buttonRowStyle: React.CSSProperties = {
  marginTop: 18,
  width: 100,
  display: 'flex',
  justifyContent: 'left',
}

const buttonStyle: React.CSSProperties = {
  height: 42,
  padding: '0 18px',
  borderRadius: 10,
  border: '2px solid #16324a',
  background: '#ffffff',
  color: '#101828',
  fontSize: 16,
  fontWeight: 600,
  cursor: 'pointer',
}

const errorStyle: React.CSSProperties = {
  marginTop: 18,
  color: '#b42318',
  textAlign: 'center',
}