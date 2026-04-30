'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000
const CHECK_INTERVAL_MS = 60 * 1000
const STORAGE_KEY = 'cegeclim_last_activity_at'

export default function AutoLogout() {
  const router = useRouter()
  const pathname = usePathname()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isLoggingOutRef = useRef(false)

  const isLoginPage = pathname === '/login'

  async function logout() {
    if (isLoggingOutRef.current) return
    isLoggingOutRef.current = true

    try {
      localStorage.removeItem(STORAGE_KEY)
      await supabase.auth.signOut()
    } catch (error) {
      console.error('Erreur lors du logout automatique :', error)
    } finally {
      router.replace('/login')
    }
  }

  function updateLastActivity() {
    if (isLoginPage) return
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
  }

  function checkInactivity() {
    if (isLoginPage) return

    const raw = localStorage.getItem(STORAGE_KEY)
    const lastActivity = raw ? Number(raw) : Date.now()

    if (!Number.isFinite(lastActivity)) {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
      return
    }

    if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
      void logout()
    }
  }

  useEffect(() => {
    if (isLoginPage) return

    const events: Array<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ]

    const handleActivity = () => updateLastActivity()

    if (!localStorage.getItem(STORAGE_KEY)) {
      updateLastActivity()
    }

    events.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true })
    })

    intervalRef.current = setInterval(checkInactivity, CHECK_INTERVAL_MS)

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        checkInactivity()
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        checkInactivity()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('storage', handleStorage)

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity)
      })

      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('storage', handleStorage)

      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [isLoginPage])

  return null
}