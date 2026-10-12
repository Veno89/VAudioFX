import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import securityHeaders from './security-headers.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-offline-shell',
      apply: 'build',
      generateBundle(_, bundle) {
        const files = [
          '/',
          '/index.html',
          ...Object.keys(bundle)
            .filter((name) => name.startsWith('assets/'))
            .map((name) => `/${name}`),
        ];
        const revision = createHash('sha256')
          .update(JSON.stringify(files))
          .update(JSON.stringify(securityHeaders))
          .digest('hex')
          .slice(0, 16);
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `
const NAME = 'vaudiofx-shell-${revision}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => event.waitUntil(caches.open(NAME).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('vaudiofx-shell-') && name !== NAME).map(name => caches.delete(name))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.open(NAME).then(cache => cache.match('/index.html', { ignoreVary: true }))));
  else if (FILES.includes(url.pathname)) event.respondWith(caches.open(NAME).then(async cache => (await cache.match(url.pathname, { ignoreVary: true })) || fetch(event.request)));
});
`,
        });
      },
    },
  ],
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 10000 },
  build: { target: 'es2022' },
  preview: { headers: securityHeaders },
});
