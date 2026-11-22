
/* =====================================================
   STORIES EDITOR — FULL SUPABASE CLOUD BACKUP
   Uses app_backups table and the existing Supabase login.
   Local records are never deleted by this file.
===================================================== */

(function () {
  'use strict';

  const TABLE = 'app_backups';
  const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

  const cloud = window.ChannelStudioCloud;
  const store = window.StudioStore;

  const $ = id => document.getElementById(id);

  function show(message, isError = false) {
    const output = $('cloudBackupStatus');

    if (output) {
      output.textContent = message;
      output.style.color = isError ? '#dc3545' : '';
    }

    if (typeof window.studioToast === 'function') {
      window.studioToast(message);
    }
  }

  function isPlainObject(value) {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value);
  }

  function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return !value.trim();
    if (Array.isArray(value)) return value.length === 0;

    if (isPlainObject(value)) {
      return Object.values(value).every(isEmpty);
    }

    return false;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeMissing(current, incoming) {
    if (isPlainObject(current) && isPlainObject(incoming)) {
      const result = clone(current);

      for (const key of Object.keys(incoming)) {
        if (
          !Object.prototype.hasOwnProperty.call(result, key) ||
          isEmpty(result[key])
        ) {
          result[key] = clone(incoming[key]);
        } else if (
          isPlainObject(result[key]) &&
          isPlainObject(incoming[key])
        ) {
          result[key] = mergeMissing(result[key], incoming[key]);
        }
      }

      return result;
    }

    return isEmpty(current) ? clone(incoming) : clone(current);
  }

  async function getAccount() {
    if (!cloud || !store) {
      throw new Error('Cloud or local storage is unavailable.');
    }

    const ready = await cloud.ready;

    if (ready && ready.online === false) {
      throw new Error(ready.error || 'Supabase is unavailable.');
    }

    if (cloud.waitForCloudSync) {
      const sync = await cloud.waitForCloudSync();

      if (sync && sync.success === false) {
        throw new Error(sync.error || 'Account synchronization failed.');
      }
    }

    const user = await cloud.getUser();

    if (!user || user.is_anonymous) {
      throw new Error('Sign in with your registered email account first.');
    }

    const client = cloud.getClient();

    if (!client) {
      throw new Error('Supabase client is unavailable.');
    }

    return { user, client };
  }

  async function createSnapshot() {
    await store.ready;
    await store.flush();

    const records = typeof store.allAsync === 'function'
      ? await store.allAsync()
      : store.all();

    if (!records || !Object.keys(records).length) {
      throw new Error('There is no local app data to back up.');
    }

    return {
      application: 'Story Studio',
      format: 'story-studio-backup',
      version: 2,
      cloudBackupVersion: 1,
      exportedAt: new Date().toISOString(),
      records: records
    };
  }

  async function uploadBackup() {
    const { user, client } = await getAccount();
    const snapshot = await createSnapshot();
    const json = JSON.stringify(snapshot);
    const bytes = new Blob([json]).size;

    if (bytes > MAX_BACKUP_BYTES) {
      throw new Error(
        'This backup is larger than 5 MB. Export a local JSON backup and contact us before uploading a larger backup.'
      );
    }

    const { data, error } = await client
      .from(TABLE)
      .insert({
        user_id: user.id,
        backup_data: snapshot,
        backup_version: 1,
        record_count: Object.keys(snapshot.records).length
      })
      .select('id, created_at, record_count')
      .single();

    if (error) throw error;

    show(
      'Cloud backup saved successfully. ' +
      data.record_count + ' data sections backed up.'
    );

    await listBackups();

    return data;
  }

  async function listBackups() {
    const { user, client } = await getAccount();

    const { data, error } = await client
      .from(TABLE)
      .select('id, created_at, record_count, backup_version')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    const list = $('cloudBackupList');

    if (!list) return data || [];

    list.replaceChildren();

    if (!data || !data.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No cloud backups yet.';
      list.appendChild(empty);
      return [];
    }

    data.forEach(item => {
      const row = document.createElement('div');
      row.className = 'cloud-backup-item';

      const info = document.createElement('div');
      const date = document.createElement('strong');
      const count = document.createElement('p');

      date.textContent = new Date(item.created_at).toLocaleString();
      count.textContent = item.record_count + ' data sections';

      info.append(date, count);

      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = 'Restore';
      restore.addEventListener('click', () => restoreBackup(item.id));

      row.append(info, restore);
      list.appendChild(row);
    });

    return data;
  }

  async function restoreBackup(id) {
    if (!id) return;

    const confirmed = window.confirm(
      'Restore this cloud backup into this device?\n\n' +
      'Existing non-empty local data will be preserved. ' +
      'Missing or empty sections may be filled from the cloud backup.'
    );

    if (!confirmed) return;

    try {
      const { user, client } = await getAccount();

      const { data, error } = await client
        .from(TABLE)
        .select('backup_data')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error) throw error;

      const backup = data && data.backup_data;

      if (
        !backup ||
        backup.application !== 'Story Studio' ||
        backup.format !== 'story-studio-backup' ||
        !isPlainObject(backup.records)
      ) {
        throw new Error('The selected cloud backup is invalid.');
      }

      if (backup.version !== 2) {
        throw new Error('This cloud backup version is not supported.');
      }

      const current = await store.allAsync();
      let restored = 0;
      let preserved = 0;

      for (const key of Object.keys(backup.records)) {
        if (
          !key ||
          key.length > 200 ||
          key.startsWith('__') ||
          backup.records[key] === undefined
        ) {
          preserved++;
          continue;
        }

        if (
          !Object.prototype.hasOwnProperty.call(current, key) ||
          isEmpty(current[key])
        ) {
          store.set(key, clone(backup.records[key]));
          restored++;
          continue;
        }

        if (
          isPlainObject(current[key]) &&
          isPlainObject(backup.records[key])
        ) {
          const merged = mergeMissing(
            current[key],
            backup.records[key]
          );

          if (JSON.stringify(merged) !== JSON.stringify(current[key])) {
            store.set(key, merged);
            restored++;
          } else {
            preserved++;
          }
        } else {
          preserved++;
        }
      }

      await store.flush();

      show(
        'Cloud restore finished. ' + restored +
        ' sections restored or filled; ' +
        preserved + ' existing sections preserved. Reload the app to refresh its pages.'
      );

    } catch (error) {
      console.error('Cloud restore failed:', error);
      show(error.message || 'Cloud restore failed.', true);
    }
  }

  async function run(action) {
    const button = $('cloudBackupUpload');

    if (button) button.disabled = true;

    try {
      if (action === 'upload') {
        await uploadBackup();
      } else if (action === 'list') {
        await listBackups();
        show('Cloud backup list refreshed.');
      }
    } catch (error) {
      console.error('Cloud backup error:', error);
      show(error.message || 'Cloud backup operation failed.', true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function initialize() {
    const upload = $('cloudBackupUpload');
    const refresh = $('cloudBackupRefresh');

    if (upload) {
      upload.addEventListener('click', () => run('upload'));
    }

    if (refresh) {
      refresh.addEventListener('click', () => run('list'));
    }

    if (upload || refresh) {
      run('list');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
