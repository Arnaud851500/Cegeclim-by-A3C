import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@sparticuz/chromium',
    'puppeteer-core',
  ],

  // 26/10/2026 : scintillement / boucle de rechargement après déploiement.
  // Les pages et leurs données (RSC) ne sont plus gardées par le navigateur :
  // chaque ouverture redemande la version en ligne. Les fichiers versionnés
  // /_next/static restent en cache (Next.js les sert en immutable).
  async headers() {
    return [
      {
        source: '/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|webmanifest)$).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ]
  },

  outputFileTracingIncludes: {
    '/api/reports/focus-mensuel-pdf': [
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
  },
}

export default nextConfig