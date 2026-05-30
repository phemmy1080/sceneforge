// SceneForge Service Worker
// Strategy:
//   - Static assets (JS/CSS/fonts/icons): Cache-first (long-lived)
//   - API calls: Network-first with cache fallback (fresh data preferred)
//   - Video files: Network-only (too large to cache, streamed from R2)

const CACHE_VERSION  = 'sceneforge-v1'
const STATIC_CACHE   = `${CACHE_VERSION}-static`
const API_CACHE      = `${CACHE_VERSION}-api`

const STATIC_PRECACHE = [
  '/',
  '/index.html',
]

// Assets to never cache
const NO_CACHE_PATTERNS = [
  /\/api\/render\/stream/,
  /\.mp4$/,
  /\.mp3$/,
  /cloudflare/,
  /r2\.dev/,
  /paystack/,
]

// ── Install: precache shell ────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_PRECACHE))
  )
  self.skipWaiting()
})

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('sceneforge-') && !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ── Fetch: routing strategies ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never cache these
  if (NO_CACHE_PATTERNS.some(p => p.test(url.href))) return
  if (request.method !== 'GET') return

  // API calls: network-first, fall back to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithFallback(request))
    return
  }

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.svg') ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  // HTML navigation: network-first, offline fallback to /index.html
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request))
    return
  }
})

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return cached || new Response('Offline', { status: 503 })
  }
}

async function networkFirstWithFallback(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(API_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response(
      JSON.stringify({ error: 'offline', message: 'No internet connection' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match('/') || await caches.match('/index.html')
    return cached || new Response('Offline — please reconnect', { status: 503 })
  }
}
