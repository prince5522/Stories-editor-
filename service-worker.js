
/* =====================================================
   STORIES EDITOR — SERVICE WORKER
   Version: 32

   Features:
   - Offline page support
   - Automatic application updates
   - Previous cache migration
   - Network-first page loading
   - Network-first JavaScript and CSS
   - Offline fallback
   - Notification click navigation
   - Safe cache cleanup
===================================================== */

'use strict';

/* =====================================================
   CACHE CONFIGURATION
===================================================== */

const CACHE_VERSION = 'channel-studio-shell-v32';
const CACHE_PREFIX = 'channel-studio-shell-';

const FETCH_TIMEOUT = 8000;

/* =====================================================
   APPLICATION PAGES
   All files are stored in the repository root.
===================================================== */

const PAGES = [
  './',
  'index.html',
  'login.html',
  'home.html',
  'stories.html',
  'episodes.html',
  'ready-made.html',
  'planner.html',
  'publish.html',
  'hype.html',
  'media.html',
  'channels.html',
  'docs.html',
  'complaints.html',
  'reviews.html',
  'notifications.html',
  'backup.html',
  'settings.html',
  'accounts.html'
];

/* =====================================================
   CSS FILES
===================================================== */

const STYLES = [
  'styles.css',
  'animations.css',
  'themes.css',
  'whatsapp-shell.css',
  'ready-made.css'
];

/* =====================================================
   JAVASCRIPT FILES
   Only existing repository files are included.
===================================================== */

const SCRIPTS = [
  'app-shell-behavior.js',
  'storage.js',
  'themes.js',
  'transitions.js',
  'effects.js',
  'notifications.js',
  'native-notifications.js',
  'feedback.js',
  'app.js',
  'backup.js',
  'backup-reliability.js',
  'android-import.js',
  'story-engine.js',
  'story-split-post.js',
  'documents.js',
  'creator-lab.js',
  'media.js',
  'media-attach.js',
  'planner-media.js',
  'planner-story-slots.js',
  'planner-publish.js',
  'planner-progress.js',
  'planner-stage3.js',
  'planner-stage4.js',
  'ready-made.js',
  'supabase-cloud.js',
  'auth.js',
  'whatsapp-shell.js',
  'wallpaper.js',
  'story-runway-alerts.js'
];

/* =====================================================
   OTHER APPLICATION FILES
===================================================== */

const OTHER_FILES = [
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

const CORE_FILES = [
  ...PAGES,
  ...STYLES,
  ...SCRIPTS,
  ...OTHER_FILES
];

/* =====================================================
   HELPER FUNCTIONS
===================================================== */

function makeURL(path) {
  return new URL(
    path,
    self.registration.scope
  ).href;
}

async function fetchWithTimeout(resource) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT);

  try {
    return await fetch(resource, {
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function saveResponse(cache, request, response) {
  if (!response || !response.ok) {
    return;
  }

  try {
    await cache.put(
      request,
      response.clone()
    );
  } catch (error) {
    console.warn(
      '[Stories Editor] Could not cache:',
      request.url || request,
      error
    );
  }
}

function isCodeAsset(request, url) {
  const destination = request.destination || '';

  if (
    destination === 'script' ||
    destination === 'style'
  ) {
    return true;
  }

  return /\.(js|css)$/i.test(url.pathname);
}

/* =====================================================
   INSTALL
===================================================== */

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);

    console.log(
      '[Stories Editor] Installing version 32...'
    );

    /* ---------------------------------------------
       MIGRATE PREVIOUS CACHE CONTENT
    --------------------------------------------- */

    const oldCaches = (
      await caches.keys()
    ).filter(name =>
      name.startsWith(CACHE_PREFIX) &&
      name !== CACHE_VERSION
    );

    for (const oldName of oldCaches) {
      try {
        const oldCache = await caches.open(oldName);
        const requests = await oldCache.keys();

        for (const request of requests) {
          try {
            if (await cache.match(request)) {
              continue;
            }

            const response = await oldCache.match(request);

            if (response) {
              await cache.put(
                request,
                response
              );
            }
          } catch (error) {
            console.warn(
              '[Stories Editor] Cache migration item skipped:',
              request.url,
              error
            );
          }
        }
      } catch (error) {
        console.warn(
          '[Stories Editor] Previous cache migration failed:',
          oldName,
          error
        );
      }
    }

    /* ---------------------------------------------
       DOWNLOAD CORE APPLICATION FILES
    --------------------------------------------- */

    const results = await Promise.allSettled(
      CORE_FILES.map(async path => {
        const url = makeURL(path);

        try {
          const response = await fetchWithTimeout(url);

          if (response && response.ok) {
            await saveResponse(
              cache,
              url,
              response
            );
          } else {
            console.warn(
              '[Stories Editor] File unavailable:',
              path
            );
          }
        } catch (error) {
          console.warn(
            '[Stories Editor] Could not download:',
            path
          );
        }
      })
    );

    const successful = results.filter(
      result => result.status === 'fulfilled'
    ).length;

    console.log(
      `[Stories Editor] Core cache processed: ${successful}/${CORE_FILES.length}`
    );

    await self.skipWaiting();

  })());
});

/* =====================================================
   ACTIVATE
===================================================== */

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    /* Remove older Stories Editor caches. */

    await Promise.all(
      cacheNames
        .filter(name =>
          name.startsWith(CACHE_PREFIX) &&
          name !== CACHE_VERSION
        )
        .map(name => caches.delete(name))
    );

    await self.clients.claim();

    console.log(
      '[Stories Editor] Version 32 activated.'
    );

    /* Notify open application windows. */

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    clients.forEach(client => {
      client.postMessage({
        type: 'STORY_STUDIO_UPDATED',
        version: CACHE_VERSION
      });
    });

  })());
});

/* =====================================================
   UPDATE MESSAGES
===================================================== */

self.addEventListener('message', event => {
  const message = event.data;

  if (message === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (
    message &&
    message.type === 'GET_VERSION'
  ) {
    event.source?.postMessage({
      type: 'SERVICE_WORKER_VERSION',
      version: CACHE_VERSION
    });
  }
});

/* =====================================================
   OFFLINE FALLBACK
===================================================== */

async function offlineResponse(request) {
  const cache = await caches.open(CACHE_VERSION);

  /* Try the exact requested page first. */

  if (request.mode === 'navigate') {
    const cachedPage = await cache.match(
      request,
      { ignoreSearch: true }
    );

    if (cachedPage) {
      return cachedPage;
    }

    /* Try the home page. */

    const home = await cache.match(
      makeURL('home.html')
    );

    if (home) {
      return home;
    }

    /* Try the welcome page. */

    const welcome = await cache.match(
      makeURL('index.html')
    );

    if (welcome) {
      return welcome;
    }

    return new Response(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head><body><h1>Stories Editor is offline</h1><p>This page has not been saved for offline use yet. Reconnect to the internet and try again.</p></body></html>',
      {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8'
        }
      }
    );
  }

  /* Try the cached resource. */

  const cachedResource = await cache.match(
    request,
    { ignoreSearch: true }
  );

  if (cachedResource) {
    return cachedResource;
  }

  return new Response(
    'This resource is not available offline.',
    {
      status: 504,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    }
  );
}

/* =====================================================
   FETCH HANDLER
===================================================== */

self.addEventListener('fetch', event => {
  const request = event.request;

  /* Only handle GET requests. */

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  /* Do not intercept external websites or CDNs. */

  if (url.origin !== self.location.origin) {
    return;
  }

  /* Do not interfere with partial media requests. */

  if (request.headers.has('range')) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);

    /* ---------------------------------------------
       HTML PAGES — NETWORK FIRST
    --------------------------------------------- */

    if (request.mode === 'navigate') {
      try {
        const response = await fetchWithTimeout(request);

        if (response && response.ok) {
          await saveResponse(
            cache,
            request,
            response
          );

          return response;
        }
      } catch (error) {
        console.warn(
          '[Stories Editor] Loading page from offline cache:',
          url.pathname
        );
      }

      return offlineResponse(request);
    }

    /* ---------------------------------------------
       JAVASCRIPT AND CSS — NETWORK FIRST
    --------------------------------------------- */

    if (isCodeAsset(request, url)) {
      try {
        const response = await fetchWithTimeout(request);

        if (response && response.ok) {
          await saveResponse(
            cache,
            request,
            response
          );

          return response;
        }
      } catch (error) {
        console.warn(
          '[Stories Editor] Using cached code:',
          url.pathname
        );
      }

      return offlineResponse(request);
    }

    /* ---------------------------------------------
       OTHER FILES — CACHE FIRST
    --------------------------------------------- */

    const cached = await cache.match(
      request,
      { ignoreSearch: true }
    );

    if (cached) {
      /* Refresh the cached copy in the background. */

      event.waitUntil(
        fetchWithTimeout(request)
          .then(response =>
            saveResponse(
              cache,
              request,
              response
            )
          )
          .catch(() => {
            // Keep the existing offline copy.
          })
      );

      return cached;
    }

    /* ---------------------------------------------
       RESOURCE NOT CACHED — NETWORK
    --------------------------------------------- */

    try {
      const response = await fetchWithTimeout(request);

      if (response && response.ok) {
        await saveResponse(
          cache,
          request,
          response
        );
      }

      return response;

    } catch (error) {
      return offlineResponse(request);
    }

  })());
});

/* =====================================================
   NOTIFICATION CLICK
===================================================== */

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const requestedTarget =
    event.notification.data?.url || 'planner.html';

  event.waitUntil((async () => {
    let targetURL;

    try {
      targetURL = new URL(
        requestedTarget,
        self.registration.scope
      );

      /* Keep navigation inside this application. */

      if (
        targetURL.origin !== self.location.origin ||
        !targetURL.href.startsWith(
          self.registration.scope
        )
      ) {
        targetURL = new URL(
          'planner.html',
          self.registration.scope
        );
      }

    } catch (error) {
      targetURL = new URL(
        'planner.html',
        self.registration.scope
      );
    }

    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of windows) {
      if (
        client.url.startsWith(
          self.registration.scope
        ) &&
        'focus' in client
      ) {
        await client.focus();

        if ('navigate' in client) {
          await client.navigate(
            targetURL.href
          );
        }

        return;
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(
        targetURL.href
      );
    }

  })());
});
