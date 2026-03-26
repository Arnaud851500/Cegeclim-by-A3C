'use client'

import { useState } from 'react'

type Zone = {
  id: string
  title: string
  shortText: string
  description: string
  logoUrl: string
  detailImageUrl: string
  top: string
  left: string
  width: string
  height: string
}

type MapView = 'cartographie' | 'densite' | 'isochrone'

export default function Page() {
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null)
  const [selectedMap, setSelectedMap] = useState<MapView>('cartographie')

  const mainImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Carte%20principale%20(1).png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvQ2FydGUgcHJpbmNpcGFsZSAoMSkucG5nIiwiaWF0IjoxNzc0NDI5MjExLCJleHAiOjQ4OTY0OTMyMTF9.IcsMF44gh3OTl7lNIvfmZWVqvSRcoOQbwELUmZ7ZwOY'

  const densitePopulationImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Densite%20pop%20Nv%20Aq.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvRGVuc2l0ZSBwb3AgTnYgQXEucG5nIiwiaWF0IjoxNzc0NDI5Njg4LCJleHAiOjQ4OTY0OTM2ODh9.JgudcNUXlibQNgA9-i-eAwMgPIWSX5vA91eUuP-CaNg'

  const isochrone30ImageUrl =
    'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20densemble%20Isochrone.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBkZW5zZW1ibGUgSXNvY2hyb25lLmpwZyIsImlhdCI6MTc3NDM5OTE4NiwiZXhwIjo0ODk2NDYzMTg2fQ.ubCPjSiShouzc1FoVIveAjw7fKv5c4JYjfePFA-5x0g'

  const mapImages: Record<MapView, string> = {
    cartographie: mainImageUrl,
    densite: densitePopulationImageUrl,
    isochrone: isochrone30ImageUrl,
  }

  const zones: Zone[] = [
    {
      id: 'zone-1',
      title: 'Agence Pau',
      shortText: 'Cliquez pour afficher\nAgence créée en 2019\nStockage : 650 K€',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Pau.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL1BhdS5wbmciLCJpYXQiOjE3NzQzOTM5NTMsImV4cCI6NDg5NjQ1Nzk1M30.Th6AGuZFySKCgeF5Lw61mip2wl2daj5M-xwMWLZEEWs',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Pau.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBQYXUuanBnIiwiaWF0IjoxNzc0MzkzOTMyLCJleHAiOjQ4OTY0NTc5MzJ9.BAGOJl1TGbUltd-aj2MplszBrRi31ViZvREtL4AsJW0',
      top: '90.5%',
      left: '56.3%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-2',
      title: 'Agence Anglet',
      shortText: 'Cliquez pour afficher le détail de Anglet.',
      description:
        'Cette zone correspond à l’agence de Bordeaux. Tu peux ajouter ici la description, l’activité, la couverture géographique ou les données clés.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Anglet.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0FuZ2xldC5wbmciLCJpYXQiOjE3NzQzOTQ2NjMsImV4cCI6NDg5NjQ1ODY2M30.Ak60FimDbPQ9elLvSoOhRXogX3e8ys21XwsHJfEkHH8',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Anglet.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBBbmdsZXQuanBnIiwiaWF0IjoxNzc0Mzk1MzI2LCJleHAiOjQ4OTY0NTkzMjZ9.D6f9lBnczjPFDP_pSpRsw9FMeWY82lPIAOLbn6QM2uY',
      top: '88%',
      left: '45%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-3',
      title: 'Agence Dax',
      shortText: 'Cliquez pour afficher le détail de Dax.',
      description:
        'Cette zone représente les Landes. Tu peux afficher ici les données de marché, les points de service ou les informations commerciales.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Dax.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0RheC5wbmciLCJpYXQiOjE3NzQzOTU0MDUsImV4cCI6NDg5NjQ1OTQwNX0.LZFnKgk5EkEFkmFS4r1zZuLvSg7YoXlKQ74Qw3zezCY',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Dax.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBEYXguanBnIiwiaWF0IjoxNzc0MzkzODgyLCJleHAiOjQ4OTY0NTc4ODJ9.W8vhYUwjar0e2RWNrA_ahO0XYLNm98LUznRBS_jgqfQ',
      top: '85%',
      left: '49%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-4',
      title: 'PF FMS',
      shortText: 'Cliquez pour afficher le détail de FMS.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl: 'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/FMS.jpeg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0ZNUy5qcGVnIiwiaWF0IjoxNzc0NDY0NDIxLCJleHAiOjQ4OTY1Mjg0MjF9.ew2RLNIZp6_HGngPsi710FpvbIrc0fEHOYV5TMCdAgg',
      detailImageUrl: 'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/FMS.jpeg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0ZNUy5qcGVnIiwiaWF0IjoxNzc0NDY0NDIxLCJleHAiOjQ4OTY1Mjg0MjF9.ew2RLNIZp6_HGngPsi710FpvbIrc0fEHOYV5TMCdAgg',
      top: '85%',
      left: '48%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-5',
      title: 'Agence Arcachon',
      shortText: 'Cliquez pour afficher le détail de Arcachon.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Arcachon.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0FyY2FjaG9uLnBuZyIsImlhdCI6MTc3NDQ2NDI5MSwiZXhwIjo0ODk2NTI4MjkxfQ.n4xCe38aBiVR5Btbt74uf43hyiQkNmd2q0TiCV5CPZ0',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Arcachon.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBBcmNhY2hvbi5qcGciLCJpYXQiOjE3NzQzOTM4MzMsImV4cCI6NDg5NjQ1NzgzM30.u76ivUsVORC-D1yBGh55LchYmpNbMWge-wxjX7DYcMI',
      top: '72%',
      left: '49%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-6',
      title: 'Agence Marmande',
      shortText: 'Cliquez pour afficher le détail de Marmande.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Marmande.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL01hcm1hbmRlLnBuZyIsImlhdCI6MTc3NDM5MDk4NCwiZXhwIjo0ODk2NDU0OTg0fQ.IJO3b5I4VDG0Vo_9nG5sHtfESoVc_YhVTS9ZNPdhkGo',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Marmande.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBNYXJtYW5kZS5qcGciLCJpYXQiOjE3NzQzOTEwMzgsImV4cCI6NDg5NjQ1NTAzOH0.6ihq0VQqjON92pdoEPa1_JSrkP7eNr8nmcBaIv_9Nuw',
      top: '74.7%',
      left: '61.5%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-7',
      title: 'Agence Merignac',
      shortText: 'Cliquez pour afficher le détail de Merignac.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Merignac.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL01lcmlnbmFjLmpwZyIsImlhdCI6MTc3NDM5NDc2NSwiZXhwIjo0ODk2NDU4NzY1fQ.og9QRWewamLg7YqY8B8uv5N9nhpRuYiAK5FDPy176XM',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Pan%20Merignac.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGFuIE1lcmlnbmFjLmpwZyIsImlhdCI6MTc3NDM5Mzc2NywiZXhwIjo0ODk2NDU3NzY3fQ.PqNU5P5sRgPVoHOsZFtsiXcpOKaqPW8XfhT-xXnfNRQ',
      top: '68.5%',
      left: '53%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-8',
      title: 'Agence Artigue',
      shortText: 'Cliquez pour afficher le détail de Artigue.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Artigues.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0FydGlndWVzLnBuZyIsImlhdCI6MTc3NDU0NjUxNywiZXhwIjo0ODk2NjEwNTE3fQ._hpGLqMLE0KuElshxCFEvvUlHdxFNv4y_6DXoz2064Y',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Artigue.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBBcnRpZ3VlLmpwZyIsImlhdCI6MTc3NDM5Mzg1MCwiZXhwIjo0ODk2NDU3ODUwfQ.iRSdAcNqaYtfvA7umvAkkjDhT--f0XxlEU8t5p9zAdk',
      top: '68%',
      left: '55.2%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-9',
      title: 'Agence Brive',
      shortText: 'Cliquez pour afficher le détail de Brive.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Brive.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0JyaXZlLnBuZyIsImlhdCI6MTc3NDM5NDg1OCwiZXhwIjo0ODk2NDU4ODU4fQ.FK9B370i2b7hvF2Ff3_53G-lyHPPpwxaxGla2yFrv0o',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Brive.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBCcml2ZS5qcGciLCJpYXQiOjE3NzQzOTM4NjksImV4cCI6NDg5NjQ1Nzg2OX0.ZjfFqk8Ij7rcXpEbVPD4dFs5yImX6v3RXfPUmnGqxFM',
      top: '64%',
      left: '75%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-Angouleme',
      title: 'Agence Angouleme',
      shortText: 'Cliquez pour afficher le détail d Angouleme.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Angouleme.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0FuZ291bGVtZS5wbmciLCJpYXQiOjE3NzQzOTQ4MjcsImV4cCI6NDg5NjQ1ODgyN30.p-7VoCARRbXFWIVhOL1Ck7YMpM-aUvAlmnkNPDihYZ8',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Angouleme.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBBbmdvdWxlbWUuanBnIiwiaWF0IjoxNzc0MzkzODE0LCJleHAiOjQ4OTY0NTc4MTR9._dwrjs31KoxQ-tSOPx7UWubTMk81KwJOLY1cCjvnaqI',
      top: '56%',
      left: '62%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-11',
      title: 'Agence La Rochelle',
      shortText: 'Cliquez pour afficher le détail de la Rochelle.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://YOUR-PROJECT.supabase.co/storage/v1/object/public/site-images/logo-a3c.png',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20La%20Rochelle.jpg?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBMYSBSb2NoZWxsZS5qcGciLCJpYXQiOjE3NzQzOTM5MDQsImV4cCI6NDg5NjQ1NzkwNH0.L0m9ds_p3GfP19ee90Zel-gvBQht_BaYc426e63hSWI',
      top: '48.7%',
      left: '48.5%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-12',
      title: 'Agence Angers',
      shortText: 'Cliquez pour afficher le détail d Angers.',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Agences/Angers.webp?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJBZ2VuY2VzL0FuZ2Vycy53ZWJwIiwiaWF0IjoxNzc0Mzk0MDYyLCJleHAiOjQ4OTY0NTgwNjJ9.dmQEj6gUQyNKVMzbOwnr_SBKzdaGLTSGs_yJc7QkcTA',
      detailImageUrl:
        'https://gchwihltydsplarhveyv.supabase.co/storage/v1/object/sign/Cartes/Plan%20Angers.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV8yZWU1N2MxYS05ZjJjLTQ1OTItYjE0Ny03ZGE2YzlmOTRmMDIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJDYXJ0ZXMvUGxhbiBBbmdlcnMucG5nIiwiaWF0IjoxNzc0Mzk1NzI3LCJleHAiOjQ4OTY0NTk3Mjd9.9RF-lrT4vQNJF5dqKSjanTuvksKGNh3tegtvr--OKjo',
      top: '28.5%',
      left: '55%',
      width: '20px',
      height: '20px',
    },
    {
      id: 'zone-13',
      title: 'PF Rennes',
      shortText: 'Cliquez pour détail Plateforme CVC',
      description:
        'Cette zone correspond à l’agence de Bayonne. Tu peux afficher ici les informations détaillées, KPI, responsables, potentiel ou commentaires.',
      logoUrl:
        'https://YOUR-PROJECT.supabase.co/storage/v1/object/public/site-images/logo-a3c.png',
      detailImageUrl: '',
      top: '18%',
      left: '43%',
      width: '20px',
      height: '20px',
    },
  ]

  const hoveredZone = zones.find((zone) => zone.id === hoveredZoneId) || null

  return (
    <main style={{ minHeight: '100vh', background: '#fdfdfd', padding: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontSize: 48,
            fontWeight: 800,
            color: '#0f172a',
            margin: 0,
          }}
        >
          Cartographie
        </h1>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              setSelectedMap('cartographie')
              setHoveredZoneId(null)
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: selectedMap === 'cartographie' ? '1px solid #0f172a' : '1px solid #cbd5e1',
              background: selectedMap === 'cartographie' ? '#0f172a' : '#ffffff',
              color: selectedMap === 'cartographie' ? '#ffffff' : '#334155',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cartographie
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedMap('densite')
              setHoveredZoneId(null)
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: selectedMap === 'densite' ? '1px solid #0f172a' : '1px solid #cbd5e1',
              background: selectedMap === 'densite' ? '#0f172a' : '#ffffff',
              color: selectedMap === 'densite' ? '#ffffff' : '#334155',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Densité Population
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedMap('isochrone')
              setHoveredZoneId(null)
            }}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: selectedMap === 'isochrone' ? '1px solid #0f172a' : '1px solid #cbd5e1',
              background: selectedMap === 'isochrone' ? '#0f172a' : '#ffffff',
              color: selectedMap === 'isochrone' ? '#ffffff' : '#334155',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Isochrone 30 min
          </button>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          display: 'inline-block',
          lineHeight: 0,
          maxWidth: '100%',
        }}
      >
        <img
          src={mapImages[selectedMap]}
          alt={
            selectedMap === 'cartographie'
              ? 'Cartographie interactive'
              : selectedMap === 'densite'
              ? 'Densité Population'
              : 'Isochrone 30 min'
          }
          style={{
            display: 'block',
            maxWidth: '100%',
            height: 'auto',
            borderRadius: 16,
          }}
        />

        {selectedMap === 'cartographie' && (
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
              maxWidth: 420,
              background: 'rgba(255,255,255,0.95)',
              border: '1px solid #e2e8f0',
              borderRadius: 18,
              padding: '18px 20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.16)',
              zIndex: 25,
              lineHeight: 1.5,
              backdropFilter: 'blur(6px)',
            }}
          >
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: 10,
                lineHeight: 1.2,
              }}
            >
              Carte interactive
            </div>

            <div
              style={{
                fontSize: 15,
                color: '#334155',
                lineHeight: 1.7,
              }}
            >
              <div>• Passer la souris sur les agences =&gt; popup synthèse</div>
              <div>• Cliquer sur l’agence =&gt; fenêtre détail qui s’ouvre</div>
            </div>
          </div>
        )}

        {selectedMap === 'cartographie' &&
          zones.map((zone) => (
            <button
              key={zone.id}
              type="button"
              aria-label={`Afficher le détail de ${zone.title}`}
              onMouseEnter={() => setHoveredZoneId(zone.id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              onFocus={() => setHoveredZoneId(zone.id)}
              onBlur={() => setHoveredZoneId(null)}
              onClick={() => setSelectedZone(zone)}
              style={{
                position: 'absolute',
                top: zone.top,
                left: zone.left,
                width: zone.width,
                height: zone.height,
                border: '1px solid red',
                background: '#1c8671',
                borderRadius: 24,
                zIndex: 20,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: 'hidden',
                  clip: 'rect(0,0,0,0)',
                  whiteSpace: 'nowrap',
                  border: 0,
                }}
              >
                {`Afficher le détail de ${zone.title}`}
              </span>
            </button>
          ))}

        {selectedMap === 'cartographie' && hoveredZone && (
          <div
            style={{
              position: 'absolute',
              top: '45%',
              left: '58%',
              width: 300,
              background: '#c2aeae',
              border: '1px solid #e2e8f0',
              borderRadius: 18,
              padding: 16,
              boxShadow: '0 20px 40px rgba(0,0,0,0.18)',
              zIndex: 30,
              lineHeight: 1.4,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {hoveredZone.logoUrl ? (
                <img
                  src={hoveredZone.logoUrl}
                  alt="Logo"
                  style={{ width: 40, height: 40, objectFit: 'contain' }}
                />
              ) : null}

              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  {hoveredZone.title}
                </div>
                <div
                  style={{
                    whiteSpace: 'pre-line',
                    fontSize: 10,
                    color: '#475569',
                    marginTop: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {hoveredZone.shortText}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedZone && (
        <div
          onClick={() => setSelectedZone(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 1200,
              background: '#fff',
              borderRadius: 24,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: '1.4fr 0.8fr',
              boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ background: '#e2e8f0' }}>
              {selectedZone.detailImageUrl ? (
                <img
                  src={selectedZone.detailImageUrl}
                  alt={`Image détaillée - ${selectedZone.title}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  style={{
                    minHeight: 400,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#64748b',
                    fontSize: 14,
                  }}
                >
                  Aucune image détaillée disponible
                </div>
              )}
            </div>

            <div style={{ padding: 24 }}>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  marginBottom: 20,
                }}
              >
                {selectedZone.logoUrl ? (
                  <img
                    src={selectedZone.logoUrl}
                    alt="Logo"
                    style={{
                      width: 56,
                      height: 56,
                      objectFit: 'contain',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: 4,
                    }}
                  />
                ) : null}

                <div>
                  <h2
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      margin: 0,
                      color: '#0f172a',
                    }}
                  >
                    {selectedZone.title}
                  </h2>
                  <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
                    Informations complémentaires
                  </p>
                </div>
              </div>

              <p style={{ fontSize: 14, lineHeight: 1.7, color: '#334155' }}>
                {selectedZone.description}
              </p>

              <button
                type="button"
                onClick={() => setSelectedZone(null)}
                style={{
                  marginTop: 24,
                  padding: '10px 16px',
                  borderRadius: 12,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  cursor: 'pointer',
                }}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}