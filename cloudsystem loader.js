
/* =========================================================
   STORY STUDIO — SHARED CLOUD SYSTEM LOADER
   Loads Supabase, account system and automatic backup
   ========================================================= */

(function () {
  'use strict';

  if (window.StoryStudioCloudLoaderStarted) return;
  window.StoryStudioCloudLoaderStarted = true;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');

      script.src = src;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error('Could not load ' + src));
      };

      document.body.appendChild(script);
    });
  }

  async function startCloudSystem() {
    try {
      if (!window.StudioStore) {
        throw new Error('Local storage is not ready.');
      }

      // Load the Supabase library if it is not already available.
      if (
        !window.supabase ||
        !window.supabase.createClient
      ) {
        await loadScript(
          'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
        );
      }

      // Load the account and cloud connection system.
      if (!window.ChannelStudioCloud) {
        await loadScript('./supabase-cloud.js');
      }

      const cloud = window.ChannelStudioCloud;

      if (!cloud) {
        throw new Error('Cloud account system did not start.');
      }

      // Wait for Supabase initialization.
      if (cloud.ready) {
        await cloud.ready;
      }

      // Load automatic backup and synchronization.
      if (!window.StoryStudioAutoSync) {
        await loadScript('./auto-cloud-sync.js');
      }

      window.dispatchEvent(
        new CustomEvent('storystudio:cloud-system-ready')
      );

    } catch (error) {
      console.error(
        'Story Studio cloud loader:',
        error
      );

      window.dispatchEvent(
        new CustomEvent('storystudio:cloud-system-error', {
          detail: error.message
        })
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      startCloudSystem,
      { once: true }
    );
  } else {
    startCloudSystem();
  }

})();
