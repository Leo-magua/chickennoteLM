/**
 * Service Worker - 离线缓存支持
 * （与站点根目录 /sw.js 保持一致；当前构建仅注册 /sw.js）
 */

const CACHE_NAME = 'chickennoteLM-v10';
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

/** 应用入口与 JS：网络优先，避免刷新仍执行旧脚本导致「云端为准」逻辑不生效 */
function shouldNetworkFirst(request) {
  if (request.method !== 'GET') return false;
  try {
    const url = new URL(request.url);
    return (
      request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.includes('/js/')
    );
  } catch (e) {
    return false;
  }
}

async function networkFirst(request) {
  try {
    const fetchResponse = await fetch(request);
    if (fetchResponse.status === 200) {
      const responseClone = fetchResponse.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
    }
    return fetchResponse;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

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

  if (shouldNetworkFirst(request)) {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // 其余静态：缓存优先 + 后台更新
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
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
            if (fetchResponse.status === 200 && request.method === 'GET') {
              const responseClone = fetchResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
            }
            return fetchResponse;
          })
          .catch(() => {
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
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_NOTES' });
  });
}
