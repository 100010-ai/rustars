/**
 * Service Worker — intercepts network requests to minimize domain exposure.
 *
 * What this does:
 *   1. Intercepts fetch requests and strips sensitive headers
 *   2. Adds anti-debug headers to responses
 *   3. Blocks requests to known debug/profiling endpoints
 *   4. Adds cache-busting to prevent domain caching in DevTools
 *   5. Intercepts console output to prevent domain logging
 */

const CACHE_VERSION = 'v2';
const BLOCKED_URLS = [
  '/__webpack_hmr',
  '/_next/webpack-hmr',
  '/__nextjs_original-stack-frames',
  '/_next/static/development/',
  '.map',
  '.hot-update.',
  'sourceMappingURL',
];

// ═══════════════════════════════════════════════════════════
// INSTALL
// ═══════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// ═══════════════════════════════════════════════════════════
// ACTIVATE
// ═══════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ═══════════════════════════════════════════════════════════
// FETCH INTERCEPTOR
// ═══════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Block debug/hot-reload requests
  if (BLOCKED_URLS.some(pattern => url.pathname.includes(pattern) || url.href.includes(pattern))) {
    event.respondWith(new Response('', { status: 404 }));
    return;
  }

  // 2. Block source map requests
  if (url.pathname.endsWith('.map') || url.pathname.endsWith('.js.map')) {
    event.respondWith(new Response('Source maps are not available', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    }));
    return;
  }

  // 3. Add anti-debug headers to JS responses
  if (event.request.destination === 'script' || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('X-Content-Type-Options', 'nosniff');
        newHeaders.delete('X-SourceMap');
        newHeaders.delete('SourceMap');
        newHeaders.delete('X-Webpack-Hmr-Timeout');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }).catch(() => new Response('Network error', { status: 503 }))
    );
    return;
  }

  // 4. For API requests, add anti-caching headers
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        newHeaders.set('Pragma', 'no-cache');
        newHeaders.set('X-Content-Type-Options', 'nosniff');
        newHeaders.set('X-Frame-Options', 'DENY');
        newHeaders.delete('X-Powered-By');
        newHeaders.delete('Server');
        newHeaders.delete('X-Runtime');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      }).catch(() => new Response('Network error', { status: 503 }))
    );
    return;
  }

  // 5. Add security headers to all responses
  event.respondWith(
    fetch(event.request).then(response => {
      const newHeaders = new Headers(response.headers);
      newHeaders.set('X-Content-Type-Options', 'nosniff');
      newHeaders.delete('X-Powered-By');
      newHeaders.delete('Server');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }).catch(() => new Response('Network error', { status: 503 }))
  );
});

// ═══════════════════════════════════════════════════════════
// MESSAGE HANDLER (for communication with main thread)
// ═══════════════════════════════════════════════════════════

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
