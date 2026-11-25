
/* =====================================================
   STORY STUDIO — AUTOMATIC CLOUD SYNC
   Version 2.0 — NO BACKUP TRIGGERED BY LOGIN

   - Watches actual StudioStore changes
   - Does not upload just because an account logs in
   - New changes after login can sync automatically
   - Keeps local storage as the immediate save
   - Protects newer cloud revisions
===================================================== */

(function () {
  'use strict';

  const TABLE = 'app_backups';
  const RPC = 'save_current_story_backup';
  const MAX_BYTES = 5 * 1024 * 1024;
  const DEBOUNCE_MS = 1800;

  let timer = null;
  let syncing = false;
  let dirty = false;
  let paused = false;
  let lastError = '';
  let lastRevision = null;
  let lastSyncedAt = null;
  let started = false;
  let accountReady = false;

  const pendingKeys = new Set();
  const $ = id => document.getElementById(id);

  function emitStatus(state, message) {
    const detail = {
      state,
      message,
      revision: lastRevision,
      syncedAt: lastSyncedAt
    };

    window.dispatchEvent(new CustomEvent('channelstudio:auto-sync-status', {
      detail
    }));

    const element = $('cloudStatus');
    if (element) {
      element.textContent = message;
      element.dataset.syncState = state;
      element.dataset.online = state === 'synced' ? 'true' : 'false';
    }

    const backupStatus = $('cloudBackupStatus');
    if (backupStatus && state === 'conflict') {
      backupStatus.textContent = message;
    }
  }

  function getCloud() {
    return window.ChannelStudioCloud || null;
  }

  function isOnline() {
    return navigator.onLine !== false;
  }

  function scheduleSync() {
    if (paused || !accountReady) return;

    dirty = true;
    clearTimeout(timer);

    if (!isOnline()) {
      emitStatus('offline', 'Offline · changes saved on this device');
      return;
    }

    emitStatus('pending', 'Changes saved locally · waiting to sync…');
    timer = setTimeout(runSync, DEBOUNCE_MS);
  }

  function recordChange(event) {
    const detail = event && event.detail;
    if (!detail || !detail.key) return;

    // Ignore changes until the account connection has completed.
    // This prevents login from uploading old pending local records.
    if (!accountReady) return;

    pendingKeys.add(detail.key);
    scheduleSync();
  }

  async function waitForCloud() {
    const cloud = getCloud();
    if (!cloud) throw new Error('Cloud system is not loaded.');

    if (cloud.ready) {
      const ready = await cloud.ready;
      if (!ready || ready.online === false) {
        throw new Error(ready?.error || 'Cloud connection unavailable.');
      }
    }

    if (!cloud.isLoggedIn || !cloud.isLoggedIn()) {
      throw new Error('Sign in with your registered account to sync.');
    }

    const client = cloud.getClient();
    const user = await cloud.getUser();

    if (!client || !user || user.is_anonymous) {
      throw new Error('A registered account is required.');
    }

    return { cloud, client, user };
  }

  async function makeSnapshot() {
    const store = window.StudioStore;
    if (!store) throw new Error('Local storage is unavailable.');

    if (store.ready) await store.ready;
    if (store.flush) await store.flush();

    const records = await store.allAsync();

    const snapshot = {
      application: 'Story Studio',
      format: 'story-studio-backup',
      version: 3,
      cloudBackupVersion: 4,
      exportedAt: new Date().toISOString(),
      records
    };

    const json = JSON.stringify(snapshot);
    const size = new Blob([json]).size;

    if (size > MAX_BYTES) {
      throw new Error(
        'App records exceed the 5 MB cloud backup limit. Media files will sync separately.'
      );
    }

    return {
      snapshot,
      recordCount: Object.keys(records).length
    };
  }

  async function saveSnapshot() {
    const { client, user } = await waitForCloud();
    const { snapshot, recordCount } = await makeSnapshot();

    const { data: current, error: readError } = await client
      .from(TABLE)
      .select('revision')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError) throw readError;

    const expectedRevision = current
      ? Number(current.revision) || 0
      : 0;

    if (lastRevision !== null && expectedRevision < lastRevision) {
      throw new Error(
        'Cloud revision changed unexpectedly. Sync paused to protect your newer backup.'
      );
    }

    const { data, error } = await client.rpc(RPC, {
      p_backup_data: snapshot,
      p_backup_version: 4,
      p_record_count: recordCount,
      p_expected_revision: expectedRevision
    });

    if (error) {
      const message = String(error.message || error);

      if (message.includes('BACKUP_REVISION_CONFLICT')) {
        const conflict = new Error(
          'A newer backup exists on another device. This device has not overwritten it. Refresh or restore the latest cloud backup before syncing again.'
        );
        conflict.code = 'BACKUP_REVISION_CONFLICT';
        throw conflict;
      }

      throw error;
    }

    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) throw new Error('Cloud did not confirm the saved revision.');

    lastRevision = Number(saved.new_revision);
    lastSyncedAt = saved.saved_at || new Date().toISOString();

    return saved;
  }

  async function runSync() {
    if (syncing || paused || !dirty || !accountReady) return;

    if (!isOnline()) {
      emitStatus('offline', 'Offline · changes waiting on this device');
      return;
    }

    syncing = true;
    dirty = false;
    emitStatus('syncing', 'Syncing new changes to cloud…');

    try {
      const saved = await saveSnapshot();

      lastError = '';
      pendingKeys.clear();

      emitStatus('synced', 'All new changes synced ✓');

      window.dispatchEvent(new CustomEvent('channelstudio:auto-synced', {
        detail: {
          revision: lastRevision,
          savedAt: lastSyncedAt,
          result: saved
        }
      }));
    } catch (error) {
      console.error('Automatic cloud sync failed:', error);
      lastError = error.message || 'Cloud sync failed.';

      if (error.code === 'BACKUP_REVISION_CONFLICT') {
        paused = true;
        emitStatus('conflict', 'Sync paused · newer cloud backup detected');
      } else {
        dirty = true;
        emitStatus('failed', 'Sync failed · local changes kept');
      }

      window.dispatchEvent(new CustomEvent('channelstudio:auto-sync-error', {
        detail: {
          message: lastError,
          conflict: error.code === 'BACKUP_REVISION_CONFLICT'
        }
      }));
    } finally {
      syncing = false;

      if (dirty && !paused && accountReady && isOnline()) {
        clearTimeout(timer);
        timer = setTimeout(runSync, DEBOUNCE_MS);
      }
    }
  }

  function retry() {
    if (!accountReady) {
      emitStatus('pending', 'Sign in first · local changes are safe');
      return;
    }

    paused = false;
    lastError = '';
    dirty = true;
    scheduleSync();
  }

  function getStatus() {
    return {
      syncing,
      dirty,
      paused,
      accountReady,
      revision: lastRevision,
      syncedAt: lastSyncedAt,
      error: lastError,
      pendingKeys: Array.from(pendingKeys)
    };
  }

  function start() {
    if (started) return;

    if (!window.StudioStore) {
      console.warn('Automatic sync: StudioStore is not available.');
      return;
    }

    started = true;

    window.addEventListener('channelstudio:store-changed', recordChange);

    window.addEventListener('online', function () {
      if (dirty && accountReady) {
        emitStatus('pending', 'Back online · syncing queued changes…');
        scheduleSync();
      }
    });

    window.addEventListener('offline', function () {
      if (dirty) {
        emitStatus('offline', 'Offline · changes saved on this device');
      }
    });

    // A login or initial account connection is NOT a backup request.
    // Clear pre-login pending flags without touching local records.
    window.addEventListener('channelstudio:cloud-ready', function () {
      accountReady = true;
      dirty = false;
      pendingKeys.clear();
      clearTimeout(timer);

      emitStatus(
        'synced',
        'Account connected · local data preserved'
      );
    });

    window.addEventListener('channelstudio:logged-out', function () {
      accountReady = false;
      dirty = false;
      pendingKeys.clear();
      clearTimeout(timer);

      emitStatus('offline', 'Signed out · local changes kept');
    });

    window.StoryStudioAutoSync = {
      sync: retry,
      retry,
      getStatus
    };

    emitStatus(
      'pending',
      'Automatic sync ready · waiting for account connection'
    );

    console.info('Story Studio automatic sync engine initialized.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
