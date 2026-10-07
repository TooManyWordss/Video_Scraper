import type { NextConfig } from 'next';

const config: NextConfig = {
  // Database drivers load native/wasm assets at runtime and must not be bundled;
  // the document parsers used by the instructions importer are kept out too.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'unpdf', 'word-extractor'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default config;
