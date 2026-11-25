
/* =====================================================
   STORIES EDITOR — APP SHELL BEHAVIOUR
   Version 2.0
   - Theme-aware Android safe area
   - Shared sidebar navigation
   - Library sidebar update
   - Planner notification routing
   - Global wallpaper restoration
===================================================== */

(function () {
  'use strict';

  const DB_NAME = 'channelStudioAppearanceDB';
  const STORE_NAME = 'wallpapers';
  const WALLPAPER_KEY = 'custom-wallpaper';
  const BRIGHTNESS_KEY = 'studio_wallpaper_brightness';

  const SLOT_NAMES = ['morning', 'lunch', 'evening'];

  let notificationListenerRegistered = false;
  let notificationRegistrationPromise = null;
  let notificationRetryCount = 0;

  const MAX_NOTIFICATION_RETRIES = 20;
  const NOTIFICATION_RETRY_DELAY = 500;

  /* ---------- ANDROID SAFE AREA ---------- */

  function isAndroidApp() {
    return (
      window.Capacitor?.isNativePlatform?.() === true &&
      window.Capacitor?.getPlatform?.() === 'android'
    );
  }

  function getCurrentThemeBackground() {
    try {
      const body = document.body;

      if (body) {
        const value = getComputedStyle(body)
          .getPropertyValue('--bg')
          .trim();

        if (value) return value;
      }

      const rootValue = getComputedStyle(
        document.documentElement
      ).getPropertyValue('--bg').trim();

      if (rootValue) return rootValue;

      const meta = document.querySelector(
        'meta[name="theme-color"]'
      );

      if (meta?.content) return meta.content;

    } catch (error) {
      console.warn('Could not read theme background:', error);
    }

    return '#101827';
  }

  function updateAndroidSafeAreaColor() {
    const background = getCurrentThemeBackground();

    const statusBackground = document.getElementById(
      'android-status-bar-background'
    );

    if (statusBackground) {
      statusBackground.style.background = background;
    }

    document.documentElement.style.setProperty(
      '--android-status-background',
      background
    );
  }

  function applyAndroidSafeArea() {
    if (!isAndroidApp()) return;

    document.documentElement.classList.add(
      'native-android-shell'
    );

    let statusBackground = document.getElementById(
      'android-status-bar-background'
    );

    if (!statusBackground) {
      statusBackground = document.createElement('div');
      statusBackground.id = 'android-status-bar-background';

      Object.assign(statusBackground.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        height: 'max(28px, env(safe-area-inset-top, 28px))',
        background: getCurrentThemeBackground(),
        zIndex: '99999',
        pointerEvents: 'none',
        transition: 'background-color .2s ease'
      });

      document.body.appendChild(statusBackground);
    }

    if (!document.getElementById('android-safe-area-fix')) {
      const style = document.createElement('style');
      style.id = 'android-safe-area-fix';

      style.textContent = `
        html.native-android-shell body {
          padding-top: max(28px, env(safe-area-inset-top, 0px));
        }

        html.native-android-shell .topbar {
          top: 0;
        }

        html.native-android-shell #android-status-bar-background {
          background: var(--android-status-background, var(--bg, #101827));
        }
      `;

      document.head.appendChild(style);
    }

    updateAndroidSafeAreaColor();
  }

  /* ---------- LIBRARY SIDEBAR ---------- */

  function updateLibrarySidebar() {
    const nav = document.querySelector(
      '.sidebar .main-nav'
    );

    if (!nav) return;

    const links = Array.from(
      nav.querySelectorAll('a.nav-link')
    );

    let libraryLink = links.find(function (link) {
      const label = link.querySelector('b')
        ?.textContent.trim().toLowerCase();

      const href = link.getAttribute('href') || '';

      return (
        label === 'library' ||
        /(^|\/)library\.html$/i.test(href)
      );
    });

    links.forEach(function (link) {
      const label = link.querySelector('b')
        ?.textContent.trim().toLowerCase() || '';

      const href = (link.getAttribute('href') || '')
        .split('?')[0]
        .split('#')[0];

      if (label === 'library') {
        if (link !== libraryLink) link.remove();
        return;
      }

      const oldNavigationItem = [
        'stories',
        'episodes',
        'planner',
        'auto-splitter'
      ].includes(label);

      const oldNavigationPage =
        /(^|\/)(stories|episodes|planner)\.html$/i.test(href);

      if (oldNavigationItem || oldNavigationPage) {
        link.remove();
      }
    });

    if (libraryLink && !libraryLink.isConnected) {
      libraryLink = null;
    }

    if (!libraryLink) {
      libraryLink = document.createElement('a');
      libraryLink.className = 'nav-link';
      libraryLink.innerHTML =
        '<span>▧</span><b>Library</b>';

      const homeLink = nav.querySelector(
        'a[href$="home.html"]'
      );

      if (homeLink) {
        homeLink.insertAdjacentElement(
          'afterend',
          libraryLink
        );
      } else {
        nav.prepend(libraryLink);
      }
    }

    libraryLink.href = 'library.html';

    const currentPage = location.pathname
      .split('/')
      .pop();

    libraryLink.classList.toggle(
      'active',
      currentPage === 'library.html'
    );
  }

  /* ---------- SHARED SIDEBAR NAVIGATION ---------- */

  function setupSidebarNavigation() {
    const menuToggle = document.getElementById(
      'menuToggle'
    );

    const sidebar = document.querySelector('.sidebar');

    if (!menuToggle || !sidebar) return;

    if (menuToggle.dataset.sidebarFixed === '1') {
      return;
    }

    menuToggle.dataset.sidebarFixed = '1';
    menuToggle.dataset.wired = '1';

    menuToggle.setAttribute(
      'aria-expanded',
      'false'
    );

    menuToggle.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();

      const isOpen = sidebar.classList.toggle('open');

      menuToggle.setAttribute(
        'aria-expanded',
        isOpen ? 'true' : 'false'
      );
    });

    document.addEventListener('click', function (event) {
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(event.target) &&
        !menuToggle.contains(event.target)
      ) {
        sidebar.classList.remove('open');

        menuToggle.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    });
  }

  /* ---------- PLANNER NOTIFICATION ROUTING ---------- */

  function revealPlannerSlot(slotName) {
    if (!SLOT_NAMES.includes(slotName)) return;

    const folder = document.getElementById(
      'dailyPostingFolder'
    );

    if (folder) folder.open = true;

    const panel = document.querySelector(
      `[data-slot="${slotName}"]`
    );

    if (!panel) return;

    const parentFolder = panel.closest('details');

    if (parentFolder) parentFolder.open = true;

    window.setTimeout(function () {
      try {
        panel.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        const action = panel.querySelector(
          '[data-prepare-episode], [data-start-advert]'
        );

        action?.focus({ preventScroll: true });

      } catch (error) {
        console.warn('Planner focus failed:', error);
      }
    }, 250);
  }

  function handlePlannerNotificationOpened(event) {
    revealPlannerSlot(event?.detail?.slot || '');
  }

  function handlePlannerNotificationQuery() {
    const currentPage = location.pathname
      .split('/')
      .pop();

    if (currentPage !== 'planner.html') return;

    const params = new URLSearchParams(location.search);
    const slotName = params.get('slot');

    if (!SLOT_NAMES.includes(slotName)) return;

    window.setTimeout(function () {
      revealPlannerSlot(slotName);
    }, 350);
  }

  /* ---------- NOTIFICATION DESTINATION ---------- */

  function getNotificationExtra(event) {
    const notification = event?.notification || {};

    return (
      notification.extra ||
      notification.data ||
      event?.extra ||
      {}
    );
  }

  function openPlannerFromNotification(event) {
    try {
      const extra = getNotificationExtra(event);

      const requestedPage = String(
        extra.page || 'planner.html'
      );

      const targetPage = requestedPage
        .split('?')[0]
        .split('#')[0];

      if (targetPage !== 'planner.html') {
        location.assign('planner.html');
        return;
      }

      const targetURL = new URL(
        'planner.html',
        location.href
      );

      const slot = String(extra.slot || '');

      if (SLOT_NAMES.includes(slot)) {
        targetURL.searchParams.set('slot', slot);
      }

      const currentPage = location.pathname
        .split('/')
        .pop();

      if (
        currentPage === 'planner.html' &&
        location.search === targetURL.search
      ) {
        window.dispatchEvent(
          new CustomEvent('planner:notification-opened', {
            detail: { slot }
          })
        );

        return;
      }

      location.assign(
        targetURL.pathname + targetURL.search
      );

    } catch (error) {
      console.warn('Planner notification routing failed:', error);
      location.assign('planner.html');
    }
  }

  /* ---------- ANDROID NOTIFICATION LISTENER ---------- */

  function registerAndroidNotificationClicks() {
    if (
      !isAndroidApp() ||
      notificationListenerRegistered ||
      notificationRegistrationPromise
    ) {
      return;
    }

    const notifications =
      window.Capacitor?.Plugins?.LocalNotifications;

    if (!notifications?.addListener) {
      scheduleNotificationRetry();
      return;
    }

    try {
      notificationRegistrationPromise = Promise.resolve(
        notifications.addListener(
          'localNotificationActionPerformed',
          openPlannerFromNotification
        )
      );

      notificationRegistrationPromise
        .then(function () {
          notificationListenerRegistered = true;
          notificationRetryCount = 0;
          console.info(
            'Stories Editor: Android notification clicks are ready.'
          );
        })
        .catch(function (error) {
          console.warn('Notification listener failed:', error);
          notificationRegistrationPromise = null;
          scheduleNotificationRetry();
        });

    } catch (error) {
      notificationRegistrationPromise = null;
      console.warn('Notification listener error:', error);
      scheduleNotificationRetry();
    }
  }

  function scheduleNotificationRetry() {
    if (
      !isAndroidApp() ||
      notificationListenerRegistered ||
      notificationRegistrationPromise ||
      notificationRetryCount >= MAX_NOTIFICATION_RETRIES
    ) {
      return;
    }

    notificationRetryCount++;

    window.setTimeout(function () {
      registerAndroidNotificationClicks();
    }, NOTIFICATION_RETRY_DELAY);
  }

  /* ---------- GLOBAL WALLPAPER ---------- */

  function applyGlobalWallpaper(blob) {
    if (!blob || !(blob instanceof Blob)) return;

    let layer = document.getElementById(
      'studioGlobalWallpaper'
    );

    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'studioGlobalWallpaper';

      Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '-1',
        pointerEvents: 'none',
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat'
      });

      document.body.prepend(layer);
    }

    const oldUrl = layer.dataset.objectUrl;

    if (oldUrl) URL.revokeObjectURL(oldUrl);

    const imageUrl = URL.createObjectURL(blob);
    layer.dataset.objectUrl = imageUrl;

    let brightness = 75;

    try {
      const savedBrightness = Number(
        localStorage.getItem(BRIGHTNESS_KEY)
      );

      if (
        Number.isFinite(savedBrightness) &&
        savedBrightness >= 20 &&
        savedBrightness <= 100
      ) {
        brightness = savedBrightness;
      }
    } catch (error) {}

    const darkness =
      ((100 - brightness) / 100) * 0.65;

    layer.style.backgroundImage =
      `linear-gradient(rgba(0,0,0,${darkness}), rgba(0,0,0,${darkness})), url("${imageUrl}")`;

    document.documentElement.style.backgroundColor =
      'transparent';

    document.body.style.backgroundColor =
      'transparent';
  }

  function loadGlobalWallpaper() {
    if (!window.indexedDB) return;

    let request;

    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (error) {
      console.warn('Wallpaper database could not open:', error);
      return;
    }

    request.onupgradeneeded = function (event) {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = function () {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.close();
        return;
      }

      try {
        const transaction = db.transaction(
          STORE_NAME,
          'readonly'
        );

        const getRequest = transaction
          .objectStore(STORE_NAME)
          .get(WALLPAPER_KEY);

        getRequest.onsuccess = function () {
          applyGlobalWallpaper(getRequest.result);
        };

        getRequest.onerror = function () {
          console.warn('Could not restore saved wallpaper.');
        };

        transaction.oncomplete = function () {
          db.close();
        };

        transaction.onerror = function () {
          db.close();
        };

      } catch (error) {
        console.warn('Wallpaper restoration failed:', error);
        db.close();
      }
    };

    request.onerror = function () {
      console.warn('Wallpaper database could not be opened.');
    };
  }

  /* ---------- STARTUP ---------- */

  function start() {
    setupSidebarNavigation();
    updateLibrarySidebar();
    applyAndroidSafeArea();
    registerAndroidNotificationClicks();
    loadGlobalWallpaper();
    handlePlannerNotificationQuery();
  }

  /* ---------- EVENT LISTENERS ---------- */

  document.addEventListener(
    'planner:notification-opened',
    handlePlannerNotificationOpened
  );

  document.addEventListener(
    'studio:appearance-changed',
    updateAndroidSafeAreaColor
  );

  document.addEventListener(
    'visibilitychange',
    function () {
      if (!document.hidden) {
        updateAndroidSafeAreaColor();
        registerAndroidNotificationClicks();
      }
    }
  );

  window.addEventListener('focus', function () {
    updateAndroidSafeAreaColor();
    registerAndroidNotificationClicks();
  });

  window.addEventListener('pageshow', function () {
    updateAndroidSafeAreaColor();
  });

  document.addEventListener('DOMContentLoaded', function () {
    updateAndroidSafeAreaColor();
  });

  document.addEventListener('deviceready', function () {
    applyAndroidSafeArea();
    registerAndroidNotificationClicks();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {
      once: true
    });
  } else {
    start();
  }

})();
