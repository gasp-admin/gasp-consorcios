const CACHE_NAME = 'gasp-consorcios-v6'
const urlsToCache = ['/']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  // No cachear JS de Next.js — siempre buscar la versión nueva
  if (event.request.url.includes('/_next/')) {
    event.respondWith(fetch(event.request))
    return
  }
  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response
      return fetch(event.request).catch(() => caches.match('/'))
    })
  )
})
