// AFROJ GLOBAL VENTURES - Service Worker v3 (REST API)
// Network-first for app assets (always latest), network-only for API calls.
const CACHE_NAME = 'agv-cache-v3';
const ASSETS = ['./','./index.html','./css/style.css','./js/app.js','./favicon.svg','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache){ return cache.addAll(ASSETS); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(names){ return Promise.all(names.filter(function(n){ return n!==CACHE_NAME; }).map(function(n){ return caches.delete(n); })); }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // API calls -> always network only (never cache live data)
  if (url.pathname.indexOf('/api/') === 0) {
    event.respondWith(fetch(event.request).catch(function(){ return new Response('{"error":"offline"}', { headers:{'Content-Type':'application/json'} }); }));
    return;
  }
  // App assets -> network-first
  event.respondWith(
    fetch(event.request).then(function(response){
      if (response.ok && url.origin === self.location.origin) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, clone); });
      }
      return response;
    }).catch(function(){
      return caches.match(event.request).then(function(cached){
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status:503 });
      });
    })
  );
});
