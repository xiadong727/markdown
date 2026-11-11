// 墨记阅读 Service Worker · 离线缓存
const CACHE = 'moji-reader-v4'
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './cloud.js',
  './manifest.webmanifest',
  './favicon.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './lib/marked.min.js',
  './lib/highlight.min.js',
  './lib/purify.min.js',
  './lib/supabase.min.js',
  './lib/hljs-github.css',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && new URL(req.url).origin === location.origin) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match('./index.html'))
    })
  )
})
