/**
 * Service Worker - 离线缓存支持
 */

const CACHE_NAME = 'chickennoteLM-v9';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/js/db.js',
  '/js/data-service.js',
  '/js/state.js',
  '/js/notes.js',
  '/js/chat.js',
  '/js/events.js',
  '/js/ui.js',
  '/js/settings.js',
  '/js/main.js',
  '/js/import.js',
  '/js/export.js',
  '/js/ai-format.js',
  '/js/paste-image.js',
];

// 安装时缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.error('[SW] Cache failed:', err);
      })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // API 请求：网络优先，失败时返回离线响应
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Offline', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }
  
  // 静态资源：缓存优先 + 后台更新，避免长期卡旧版本
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          // 后台更新缓存，不阻塞当前响应
          fetch(request)
            .then((fetchResponse) => {
              if (fetchResponse.status === 200 && request.method === 'GET') {
                const responseClone = fetchResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(request, responseClone);
                });
              }
            })
            .catch(() => {});
          return response;
        }
        return fetch(request)
          .then((fetchResponse) => {
            // 缓存新资源
            if (fetchResponse.status === 200 && request.method === 'GET') {
              const responseClone = fetchResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return fetchResponse;
          })
          .catch(() => {
            // 离线时返回缓存的 index.html（SPA 支持）
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// 后台同步
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notes') {
    event.waitUntil(syncNotes());
  }
});

async function syncNotes() {
  // 通知所有客户端进行同步
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_NOTES' });
  });
}
