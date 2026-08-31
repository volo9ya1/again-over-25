// webapp/sw.js — Service Worker для PWA (кэширование и оффлайн-режим)

const CACHE_NAME = 'punchline-v1';
const ASSETS_TO_CACHE = [
  '/webapp/index.html',
  '/webapp/style.css',
  '/webapp/app.js',
  '/webapp/manifest.json',
  '/webapp/assets/logo-32.png',
  '/webapp/assets/logo-192.png',
  '/webapp/assets/logo-512.png',
  '/webapp/assets/logo-maskable.png'
];

// Установка Service Worker и кэширование статических ресурсов и аватарок
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Активация и удаление устаревших версий кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват сетевых запросов (Network First с фоллбеком в кэш для статики)
self.addEventListener('fetch', (event) => {
  // Игнорируем запросы к REST API (данные игры всегда должны быть свежими)
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
