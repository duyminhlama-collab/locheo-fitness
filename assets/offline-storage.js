/* Local data first; IndexedDB is a durable mirror, never a network dependency. */
(function () {
    'use strict';
    const memory = new Map(), changes = new Set(), PREFIX = 'lcf-write-time:';
    let database = null, pending = Promise.resolve();
    function localRead(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
    const opening = new Promise(resolve => {
        if (!('indexedDB' in window)) return resolve(null);
        try {
            const request = indexedDB.open('locheofitness-offline', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('values', {keyPath:'key'});
            request.onsuccess = () => { database = request.result; database.onversionchange = () => database.close(); resolve(database); };
            request.onerror = request.onblocked = () => resolve(null);
        } catch (_) { resolve(null); }
    });
    function mirror(record) {
        pending = pending.catch(() => {}).then(async () => {
            const db = await opening;
            if (!db) return;
            await new Promise((resolve, reject) => {
                try {
                    const tx = db.transaction('values','readwrite');
                    tx.objectStore('values').put(record);
                    tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error);
                } catch (e) { reject(e); }
            });
        }).catch(e => console.warn('Local backup unavailable:',e));
    }
    const hydrated = opening.then(db => new Promise(resolve => {
        if (!db) return resolve();
        try {
            const tx = db.transaction('values','readonly'), request = tx.objectStore('values').getAll();
            request.onsuccess = () => {
                for (const record of request.result) {
                    if (changes.has(record.key)) continue;
                    const raw = localRead(record.key), time = Number(localRead(PREFIX+record.key)) || 0;
                    if (raw === null || record.updatedAt > time) {
                        memory.set(record.key, record.value);
                        try {
                            if (record.value === null) localStorage.removeItem(record.key);
                            else localStorage.setItem(record.key,record.value);
                            localStorage.setItem(PREFIX+record.key,String(record.updatedAt));
                        } catch (_) { /* Memory + IndexedDB still work when localStorage is full. */ }
                    }
                }
                resolve();
            };
            request.onerror = () => resolve();
        } catch (_) { resolve(); }
    }));
    window.appStorage = {
        ready: () => Promise.race([hydrated, new Promise(resolve => setTimeout(resolve,1500))]),
        getItem(key) { key=String(key); return memory.has(key) ? memory.get(key) : localRead(key); },
        setItem(key,value) {
            key=String(key); value=String(value);
            const updatedAt=Date.now(); memory.set(key,value); changes.add(key);
            try { localStorage.setItem(key,value); localStorage.setItem(PREFIX+key,String(updatedAt)); }
            catch (_) { try { localStorage.removeItem(key); } catch (_) {} }
            mirror({key,value,updatedAt});
        },
        removeItem(key) {
            key=String(key); memory.set(key,null); changes.add(key);
            const updatedAt=Date.now();
            try { localStorage.removeItem(key); localStorage.setItem(PREFIX+key,String(updatedAt)); } catch (_) {}
            mirror({key,value:null,updatedAt});
        },
        flush: () => pending,
        async requestPersistence() {
            try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); } catch (_) {}
            return false;
        }
    };
    document.addEventListener('pointerdown', () => window.appStorage.requestPersistence(), {once:true,passive:true});
})();
