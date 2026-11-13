// ============================================================================
// app/api/admin/utilisateurs/route.ts — Comptes de connexion Supabase
// ----------------------------------------------------------------------------
// 13/11/2026. Appelée par l'écran Admin › Accès et permissions (/autorisation).
//   action 'create'       : crée le compte Supabase Auth (email + mot de passe,
//                           email confirmé d'office, aucun mail envoyé). Si le
//                           compte existe déjà, renvoie { existe: true } sans
//                           toucher au mot de passe.
//   action 'set_password' : redéfinit le mot de passe d'un compte existant
//                           (le crée s'il n'existe pas encore).
//   action 'status'       : indique si un compte de connexion existe.
// Les droits (user_page_access) restent gérés par l'écran lui-même.
// Accès : administrateurs (todo_is_admin = can_autorisation utilisateur ou profil).
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MDP_MIN = 8

async function trouverCompte(admin: SupabaseClient, email: string) {
  // listUsers est paginé ; le parc est petit (~100 comptes), on parcourt tout.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const trouve = data.users.find((u) => (u.email || '').toLowerCase() === email)
    if (trouve) return trouve
    if (data.users.length < 200) return null
  }
  return null
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !service) {
    return NextResponse.json({ error: 'Variables Supabase manquantes côté serveur.' }, { status: 500 })
  }

  const jeton = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jeton) return NextResponse.json({ error: 'Session utilisateur absente.' }, { status: 401 })

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jeton}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: estAdmin, error: erreurAdmin } = await client.rpc('todo_is_admin')
  if (erreurAdmin) return NextResponse.json({ error: erreurAdmin.message }, { status: 401 })
  if (!estAdmin) return NextResponse.json({ error: 'Réservé aux administrateurs.' }, { status: 403 })

  let corps: { action?: string; email?: string; password?: string; display_name?: string }
  try {
    corps = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const action = corps.action || 'create'
  const email = String(corps.email || '').toLowerCase().trim()
  const motDePasse = String(corps.password || '')
  const nom = String(corps.display_name || '').trim()

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email invalide.' }, { status: 400 })
  }

  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    const existant = await trouverCompte(admin, email)

    if (action === 'status') {
      return NextResponse.json({
        existe: Boolean(existant),
        derniere_connexion: existant?.last_sign_in_at || null,
        cree_le: existant?.created_at || null,
      })
    }

    if (action !== 'create' && action !== 'set_password') {
      return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }

    if (motDePasse.length < MDP_MIN) {
      return NextResponse.json({ error: `Le mot de passe doit contenir au moins ${MDP_MIN} caractères.` }, { status: 400 })
    }

    if (existant) {
      if (action === 'create') {
        return NextResponse.json({ existe: true, cree: false, message: 'Un compte de connexion existe déjà pour cet email : mot de passe inchangé.' })
      }
      const { error } = await admin.auth.admin.updateUserById(existant.id, {
        password: motDePasse,
        email_confirm: true,
        ...(nom ? { user_metadata: { ...(existant.user_metadata || {}), display_name: nom } } : {}),
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ existe: true, mot_de_passe_modifie: true })
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: motDePasse,
      email_confirm: true,
      user_metadata: nom ? { display_name: nom } : {},
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ existe: false, cree: true, id: data.user?.id || null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erreur inattendue.' }, { status: 500 })
  }
}
