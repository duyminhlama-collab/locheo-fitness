/* Generated release: f9fa679b9d5b3e9f. Rebuild with python tools/build-offline.py. */
'use strict';
const CACHE_NAME = 'locheofitness-shell-f9fa679b9d5b3e9f';
const CORE = ["./session.html", "./index.html", "./manifest.webmanifest", "./assets/app.css", "./assets/icons/app-icon.png", "./assets/offline-storage.js", "./assets/track-wheel.css", "./assets/track-wheel.js", "./assets/ui-system.css", "./assets/vendor/chart-4.4.8.umd.js", "./assets/vendor/fontawesome/css/all.min.css", "./assets/vendor/fontawesome/webfonts/fa-brands-400.woff2", "./assets/vendor/fontawesome/webfonts/fa-regular-400.woff2", "./assets/vendor/fontawesome/webfonts/fa-solid-900.woff2", "./assets/vendor/fontawesome/webfonts/fa-v4compatibility.woff2", "./assets/vendor/THIRD_PARTY_NOTICES.txt"];
const root = new URL('./', self.location.href);
const absolute = path => new URL(path, root).href;
const paths = new Set(CORE.map(path => new URL(path,root).pathname));
const shell = absolute('session.html');
// Safari rejects navigation responses carrying a redirect URL list.
async function safeResponse(response) {
    if (!response.redirected) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-encoding'); headers.delete('content-length');
    return new Response(await response.arrayBuffer(), {status:response.status,statusText:response.statusText,headers});
}
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
                    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
                    // Pages may return an HTML fallback with HTTP 200 for missing assets.
                    if ((path.endsWith('.css') && contentType !== 'text/css') ||
                        (path.endsWith('.js') && !/^(?:application|text)\/(?:javascript|ecmascript|x-javascript)$/.test(contentType))) {
                        throw new Error('Unexpected offline asset type: '+path+' ('+contentType+')');
                    }
                    await cache.put(absolute(path), await safeResponse(response));
                } finally { clearTimeout(timer); }
            }));
            // One-time automatic migration for the broken Safari redirect cache.
            // Activation changes the worker only: never reload a workout or touch user data.
            let brokenLegacyCache = false;
            for (const name of await caches.keys()) {
                if (!name.startsWith('locheofitness-shell-') || name === CACHE_NAME) continue;
                const previous = await caches.open(name);
                const oldShell = await previous.match(shell);
                if (oldShell && oldShell.redirected) { brokenLegacyCache = true; break; }
            }
            if (!self.registration.active || brokenLegacyCache) await self.skipWaiting();
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
        if (saved) return safeResponse(saved);
        return safeResponse(await fetch(new Request(request, {redirect:'follow'})));
    })());
});

// A client can activate an installed update once it is ready to reload.
self.addEventListener('message', event => {
    if (event.data && ['LCF_RECOVER_ACTIVATE', 'LCF_AUTO_ACTIVATE'].includes(event.data.type)) event.waitUntil(self.skipWaiting());
    if (event.data && event.data.type === 'LCF_REDIRECT_SAFE' && event.ports[0]) event.ports[0].postMessage({redirectSafe:true});
});
