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
    const batchSize = 5
    

    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, siret')
      .eq('siret', '81132207200026')
      .not('siret', 'is', null)
      .or('etatAdministratifUniteLegale.is.null,etatAdministratifEtablissement.is.null')
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

    for (const client of clients || []) {
      const siret = normalizeSiret(client.siret)
      if (!siret || siret.length !== 14) continue

      try {
        const response = await fetch(`https://api.insee.fr/api-sirene/3.11/siret/${siret}`, {
          headers: {
            Accept: 'application/json',
            'X-INSEE-Api-Key-Integration': apiKey,
          },
        })

        if (!response.ok) {
          errors += 1
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
          })
          .eq('id', client.id)

        if (updateError) {
          errors += 1
          continue
        }

        updated += 1
      } catch {
        errors += 1
      }
    }

    return NextResponse.json({
      success: true,
      processed: clients?.length || 0,
      updated,
      errors,
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