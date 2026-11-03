/* Generated release: 4d1552344a6d596f. Rebuild with python tools/build-offline.py. */
'use strict';
const CACHE_NAME = 'locheofitness-shell-4d1552344a6d596f';
const CORE = ["./session.html", "./index.html", "./manifest.webmanifest", "./assets/app.css", "./assets/icons/app-icon.png", "./assets/offline-storage.js", "./assets/vendor/chart-4.4.8.umd.js", "./assets/vendor/fontawesome/css/all.min.css", "./assets/vendor/fontawesome/webfonts/fa-brands-400.woff2", "./assets/vendor/fontawesome/webfonts/fa-regular-400.woff2", "./assets/vendor/fontawesome/webfonts/fa-solid-900.woff2", "./assets/vendor/fontawesome/webfonts/fa-v4compatibility.woff2", "./assets/vendor/THIRD_PARTY_NOTICES.txt"];
const root = new URL('./', self.location.href);
const absolute = path => new URL(path, root).href;
const paths = new Set(CORE.map(path => new URL(path,root).pathname));
const shell = absolute('session.html');
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            await Promise.all(CORE.map(async path => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(),30000);
                try {
                    const response = await fetch(new Request(absolute(path), {cache:'reload',signal:controller.signal}));
                    if (!response.ok || response.type==='opaque') throw new Error('Offline asset unavailable: '+path);
                    await cache.put(absolute(path), response);
                } finally { clearTimeout(timer); }
            }));
            // Do not replace an open workout with another app release.
            if (!self.registration.active) await self.skipWaiting();
        } catch (error) { await caches.delete(CACHE_NAME); throw error; }
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name.startsWith('locheofitness-shell-') && name !== CACHE_NAME) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const request=event.request, url=new URL(request.url);
    // Group data must never be cached or served across groups.
    if (request.method!=='GET' || url.origin!==root.origin || url.pathname.startsWith('/api/')) return;
    const appNavigation=request.mode==='navigate' && [root.pathname, root.pathname+'index.html',root.pathname+'session',root.pathname+'session.html'].includes(url.pathname);
    if (!appNavigation && !paths.has(url.pathname)) return;
    event.respondWith((async () => {
        const cache=await caches.open(CACHE_NAME);
        const saved=await cache.match(appNavigation ? shell : request, {ignoreSearch:true});
        if (saved) return saved;
        return fetch(request);
    })());
});
