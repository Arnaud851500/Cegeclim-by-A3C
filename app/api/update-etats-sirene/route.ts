import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function normalizeSiret(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').trim()
}

export async function POST() {
  try {
    const batchSize = 500

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, siret')
      .not('siret', 'is', null)
      .is('sirene_etat_sync_attempted_at', null)
      .limit(batchSize)

    if (clientsError) {
      throw clientsError
    }

    const apiKey = process.env.INSEE_API_KEY
    if (!apiKey) {
      throw new Error('INSEE_API_KEY manquant')
    }

    let updated = 0
    let errors = 0
    let skipped = 0

    for (const client of clients || []) {
      const siret = normalizeSiret(client.siret)

      if (!siret || siret.length !== 14) {
        skipped += 1

        await supabase
          .from('clients')
          .update({
            sirene_etat_sync_attempted_at: new Date().toISOString(),
            sirene_etat_sync_error: 'SIRET invalide',
          })
          .eq('id', client.id)

        continue
      }

      await supabase
        .from('clients')
        .update({
          sirene_etat_sync_attempted_at: new Date().toISOString(),
          sirene_etat_sync_error: null,
        })
        .eq('id', client.id)

      try {
        const response = await fetch(`https://api.insee.fr/api-sirene/3.11/siret/${siret}`, {
          headers: {
            Accept: 'application/json',
            'X-INSEE-Api-Key-Integration': apiKey,
          },
        })

        if (!response.ok) {
          errors += 1

          await supabase
            .from('clients')
            .update({
              sirene_etat_sync_error: `HTTP ${response.status}`,
            })
            .eq('id', client.id)

          continue
        }

        const json = await response.json()
        const etablissement = json?.etablissement

        const etatAdministratifEtablissement =
          etablissement?.etatAdministratifEtablissement ?? null

        const etatAdministratifUniteLegale =
          etablissement?.uniteLegale?.etatAdministratifUniteLegale ?? null

        const { error: updateError } = await supabase
          .from('clients')
          .update({
            etatAdministratifUniteLegale,
            etatAdministratifEtablissement,
            sirene_etat_sync_success_at: new Date().toISOString(),
            sirene_etat_sync_error: null,
          })
          .eq('id', client.id)

        if (updateError) {
          errors += 1

          await supabase
            .from('clients')
            .update({
              sirene_etat_sync_error: updateError.message,
            })
            .eq('id', client.id)

          continue
        }

        updated += 1
      } catch (error: any) {
        errors += 1

        await supabase
          .from('clients')
          .update({
            sirene_etat_sync_error: error?.message || 'Erreur inconnue',
          })
          .eq('id', client.id)
      }
    }

    const { count: remaining } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .not('siret', 'is', null)
      .is('sirene_etat_sync_attempted_at', null)

    return NextResponse.json({
      success: true,
      processed: clients?.length || 0,
      updated,
      errors,
      skipped,
      remaining: remaining || 0,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Erreur inconnue',
      },
      { status: 500 }
    )
  }
}