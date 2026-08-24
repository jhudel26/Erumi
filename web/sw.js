const CACHE_NAME = 'erumi-pwa-v10';
const METADATA_CACHE = 'erumi-metadata-v2';
const OFFLINE_PAGE = '/offline.html';

const ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/style.css',
  '/app.js',
  '/erumi.png',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  // Pin specific versions for stability
  'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://cdn.jsdelivr.net/npm/hls.js@0.14.17/dist/hls.min.js',
  'https://cdn.jsdelivr.net/npm/feather-icons@4.29.2/dist/feather.min.js'
];

// Install event - cache all assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(ASSETS);
      } catch (error) {
        console.warn('[Erumi SW] Some assets failed to cache:', error);
        // Continue with what we have
      }
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== METADATA_CACHE) {
            console.log('[Erumi SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // ============================================
  // 1. CACHE METADATA API (1 hour TTL)
  // ============================================
  if (url.pathname === '/api/metadata') {
    event.respondWith(
      caches.open(METADATA_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        
        // Check if cached response is still fresh (1 hour)
        if (cached) {
          const cachedTime = cached.headers.get('sw-cache-time');
          if (cachedTime && Date.now() - parseInt(cachedTime) < 3600000) {
            return cached;
          }
        }
        
        // Fetch fresh data
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            // Clone before modifying to avoid body locked error
            const responseToCache = response.clone();
            const headers = new Headers(responseToCache.headers);
            headers.set('sw-cache-time', Date.now().toString());
            const newResponse = new Response(responseToCache.body, { headers });
            cache.put(event.request, newResponse);
            return response;
          }
          return response;
        } catch (error) {
          // If offline and have cached data, return it even if expired
          if (cached) {
            return cached;
          }
          // Return empty JSON as fallback
          return new Response(JSON.stringify({ success: false, data: null }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    );
    return;
  }
  
  // ============================================
  // 2. SKIP OTHER API CALLS
  // ============================================
  if (url.pathname.startsWith('/api/')) {
    // For other API calls, just pass through
    return;
  }
  
  // ============================================
  // 3. NAVIGATION REQUESTS - Offline Fallback
  // ============================================
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Try to serve offline page
        return caches.match(OFFLINE_PAGE).then((response) => {
          return response || caches.match('/');
        });
      })
    );
    return;
  }
  
  // ============================================
  // 4. ASSETS - Stale-While-Revalidate Strategy
  // ============================================
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Always fetch fresh data in background
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Only cache valid responses
        if (networkResponse && networkResponse.status === 200) {
          // Clone before caching to avoid "body already used" error
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((error) => {
        // If network fails, return cached if available
        if (cachedResponse) {
          return cachedResponse;
        }
        // For images and fonts, return a fallback if possible
        if (event.request.destination === 'image') {
          return caches.match('/erumi.png');
        }
        throw error;
      });
      
      // Return cached response immediately if available,
      // otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});

// ============================================
// 5. BACKGROUND SYNC (Optional)
// ============================================
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-history') {
    event.waitUntil(syncWatchHistory());
  }
});

async function syncWatchHistory() {
  try {
    const cache = await caches.open('pending-requests');
    const requests = await cache.keys();
    
    for (const request of requests) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.delete(request);
        }
      } catch (error) {
        console.warn('[Erumi SW] Failed to sync request:', error);
      }
    }
  } catch (error) {
    console.warn('[Erumi SW] Sync failed:', error);
  }
}

// ============================================
// 6. PUSH NOTIFICATIONS (Optional)
// ============================================
self.addEventListener('push', (event) => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Erumi Update', {
        body: data.body || 'New content available!',
        icon: '/erumi.png',
        badge: '/favicon-32x32.png',
        data: {
          url: data.url || '/'
        },
        actions: data.actions || [
          { action: 'open', title: 'Open' },
          { action: 'dismiss', title: 'Dismiss' }
        ]
      })
    );
  } catch (error) {
    console.warn('[Erumi SW] Push notification error:', error);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'dismiss') return;
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus an existing window
        for (const client of clientList) {
          if (client.url === event.notification.data.url && 'focus' in client) {
            return client.focus();
          }
        }
        // Open a new window
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url || '/');
        }
      })
  );
});

// ============================================
// 7. MESSAGE HANDLING (for app communication)
// ============================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== METADATA_CACHE) {
              return caches.delete(key);
            }
          })
        );
      })
    );
  }
});

// ============================================
// 8. PERIODIC BACKGROUND SYNC (if supported)
// ============================================
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-cache') {
      event.waitUntil(updateCachedContent());
    }
  });
}

async function updateCachedContent() {
  // Refresh essential assets in background
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const asset of ASSETS) {
      try {
        const response = await fetch(asset);
        if (response.ok) {
          await cache.put(asset, response);
        }
      } catch (error) {
        // Skip failed updates
      }
    }
  } catch (error) {
    console.warn('[Erumi SW] Background update failed:', error);
  }
}