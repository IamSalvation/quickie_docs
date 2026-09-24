/* =========================================================
   Quickie Docs — Service Worker
   v1.4.7 — Mobile sheet stability fixes
   ========================================================= */

const VERSION = 'v1.5.0';
const APP_CACHE = `quickie-docs-app-${VERSION}`;
const CDN_CACHE = `quickie-docs-cdn-${VERSION}`;
const RUNTIME_CACHE = `quickie-docs-runtime-${VERSION}`;

const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './assets/logo.png',
    './assets/favicon.ico',
    './assets/favicon-32.png',
    './assets/apple-touch-icon.png',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './assets/icon-maskable-512.png'
];

const CDN_URLS = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/mammoth@1.7.0/mammoth.browser.min.js'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const appCache = await caches.open(APP_CACHE);
        await Promise.all(APP_SHELL.map(async url => {
            try {
                const res = await fetch(url, { cache: 'no-cache' });
                if (res.ok) await appCache.put(url, res);
                else console.warn('[SW] Skipping:', url, res.status);
            } catch (err) {
                console.warn('[SW] Skipping:', url, err.message);
            }
        }));
        const cdnCache = await caches.open(CDN_CACHE);
        await Promise.all(CDN_URLS.map(async url => {
            try {
                const res = await fetch(url, { mode: 'no-cors' });
                await cdnCache.put(url, res);
            } catch (err) {
                console.warn('[SW] CDN pre-cache failed:', url, err.message);
            }
        }));
    })());
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter(k => ![APP_CACHE, CDN_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(req, APP_CACHE));
        return;
    }
    if (CDN_URLS.some(u => req.url.startsWith(u.split('?')[0]))) {
        event.respondWith(cacheFirst(req, CDN_CACHE));
        return;
    }
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request)
        .then(res => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
            return res;
        })
        .catch(() => cached);
    return cached || fetchPromise;
}
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
        const res = await fetch(request);
        if (res && (res.status === 200 || res.type === 'opaque')) cache.put(request, res.clone());
        return res;
    } catch (err) {
        return new Response('', { status: 503, statusText: 'Offline' });
    }
}
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const res = await fetch(request);
        if (res && res.status === 200) cache.put(request, res.clone());
        return res;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});