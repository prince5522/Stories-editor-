
/* =====================================================
   STORIES EDITOR — SUPABASE CLOUD BACKUP
   Version 5.0

   FEATURES:
   - Keeps exactly TWO recovery versions.
   - Latest backup.
   - Immediately previous backup.
   - Automatically rotates backups.
   - Restores either backup.
   - Protects against outdated-device uploads.
   - Preserves existing local records.
===================================================== */

(function () {
  'use strict';

  const TABLE = 'app_backups';
  const MAX_BACKUP_BYTES = 9 * 1024 * 1024;

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

    if (typeof value === 'string') {
      return !value.trim();
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    if (isPlainObject(value)) {
      return Object.values(value).every(isEmpty);
    }

    return false;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sameValue(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (_) {
      return false;
    }
  }

  function getIdentity(item) {
    if (!isPlainObject(item)) return null;

    for (const field of ['id', 'uuid', '_id', 'recordId']) {
      const value = item[field];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        return field + ':' + String(value);
      }
    }

    return null;
  }

  function mergeArrays(current, incoming) {
    if (!Array.isArray(current)) {
      return isEmpty(current) ? clone(incoming) : clone(current);
    }

    const result = clone(current);

    for (const incomingItem of incoming) {
      const identity = getIdentity(incomingItem);

      if (identity !== null) {
        const index = result.findIndex(
          item => getIdentity(item) === identity
        );

        if (index !== -1) {
          result[index] = mergeMissing(
            result[index],
            incomingItem
          );
        } else {
          result.push(clone(incomingItem));
        }

        continue;
      }

      if (!result.some(item => sameValue(item, incomingItem))) {
        result.push(clone(incomingItem));
      }
    }

    return result;
  }

  function mergeMissing(current, incoming) {
    if (isEmpty(current)) {
      return clone(incoming);
    }

    if (Array.isArray(current) && Array.isArray(incoming)) {
      return mergeArrays(current, incoming);
    }

    if (isPlainObject(current) && isPlainObject(incoming)) {
      const result = clone(current);

      for (const key of Object.keys(incoming)) {
        if (
          !Object.prototype.hasOwnProperty.call(result, key) ||
          isEmpty(result[key])
        ) {
          result[key] = clone(incoming[key]);
        } else {
          result[key] = mergeMissing(
            result[key],
            incoming[key]
          );
        }
      }

      return result;
    }

    return clone(current);
  }

  async function getAccount() {
    if (!cloud || !store) {
      throw new Error(
        'Cloud or local storage is unavailable.'
      );
    }

    const ready = await cloud.ready;

    if (ready && ready.online === false) {
      throw new Error(
        ready.error || 'Supabase is unavailable.'
      );
    }

    if (cloud.waitForCloudSync) {
      const sync = await cloud.waitForCloudSync();

      if (sync && sync.success === false) {
        throw new Error(
          sync.error || 'Account synchronization failed.'
        );
      }
    }

    const user = await cloud.getUser();

    if (!user || user.is_anonymous) {
      throw new Error(
        'Sign in with your registered email account first.'
      );
    }

    const client = cloud.getClient();

    if (!client) {
      throw new Error(
        'Supabase client is unavailable.'
      );
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
      throw new Error(
        'There is no local app data to back up.'
      );
    }

    return {
      application: 'Story Studio',
      format: 'story-studio-backup',
      version: 3,
      cloudBackupVersion: 5,
      exportedAt: new Date().toISOString(),
      records
    };
  }

  /*
   * PREPARE PREVIOUS BACKUP
   *
   * Nested previous backups are removed.
   * This guarantees a maximum of two versions.
   */

  function makePreviousSnapshot(snapshot) {
    if (
      !snapshot ||
      snapshot.application !== 'Story Studio' ||
      snapshot.format !== 'story-studio-backup' ||
      !isPlainObject(snapshot.records)
    ) {
      return null;
    }

    return {
      application: snapshot.application,
      format: snapshot.format,
      version: snapshot.version || 3,
      cloudBackupVersion: snapshot.cloudBackupVersion || 4,
      exportedAt: snapshot.exportedAt || null,
      records: clone(snapshot.records)
    };
  }

  /*
   * UPLOAD AND ROTATE BACKUPS
   */

  async function uploadBackup() {
    const { user, client } = await getAccount();

    const snapshot = await createSnapshot();

    const { data: current, error: readError } = await client
      .from(TABLE)
      .select('revision, backup_data')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError) throw readError;

    const expectedRevision = current
      ? Number(current.revision) || 0
      : 0;

    const previous = current
      ? makePreviousSnapshot(current.backup_data)
      : null;

    if (previous) {
      snapshot.previousBackup = previous;
    }

    const bytes = new Blob([
      JSON.stringify(snapshot)
    ]).size;

    if (bytes > MAX_BACKUP_BYTES) {
      throw new Error(
        'Latest and previous backups together exceed 9 MB. ' +
        'No cloud backup was changed. Export a local backup ' +
        'and reduce large records before retrying.'
      );
    }

    const { data, error } = await client.rpc(
      'save_current_story_backup',
      {
        p_backup_data: snapshot,
        p_backup_version: 5,
        p_record_count: Object.keys(snapshot.records).length,
        p_expected_revision: expectedRevision
      }
    );

    if (error) {
      const message = String(error.message || error);

      if (message.includes('BACKUP_REVISION_CONFLICT')) {
        throw new Error(
          'Backup conflict detected. A newer backup exists ' +
          'on another device. Your local data has not been ' +
          'uploaded or overwritten. Refresh the cloud backup ' +
          'before trying again.'
        );
      }

      throw error;
    }

    const saved = Array.isArray(data)
      ? data[0]
      : data;

    if (!saved) {
      throw new Error(
        'The cloud did not confirm the backup.'
      );
    }

    show(
      'Cloud backup updated. Latest and previous recovery ' +
      'versions are maintained. ' +
      Object.keys(snapshot.records).length +
      ' data sections saved. Revision ' +
      saved.new_revision + '.'
    );

    await listBackups();

    return saved;
  }

  /*
   * DISPLAY BACKUP CARDS
   */

  function appendBackupCard(
    list,
    label,
    snapshot,
    slot,
    item
  ) {
    const row = document.createElement('div');
    row.className = 'cloud-backup-item';

    const info = document.createElement('div');

    const title = document.createElement('strong');
    title.textContent = label;

    const date = document.createElement('p');

    const stamp = slot === 'latest'
      ? item.created_at
      : snapshot && snapshot.exportedAt;

    date.textContent = stamp
      ? 'Saved: ' + new Date(stamp).toLocaleString()
      : 'Saved backup';

    const count = document.createElement('p');

    count.textContent =
      Object.keys(
        snapshot && snapshot.records || {}
      ).length + ' data sections';

    info.append(title, date, count);

    const restore = document.createElement('button');

    restore.type = 'button';
    restore.className = 'button';

    restore.textContent = slot === 'latest'
      ? 'Restore latest'
      : 'Restore previous';

    restore.disabled =
      !snapshot || !isPlainObject(snapshot.records);

    restore.addEventListener('click', () => {
      restoreBackup(item.id, slot);
    });

    row.append(info, restore);
    list.appendChild(row);
  }

  /*
   * LIST LATEST AND PREVIOUS BACKUPS
   */

  async function listBackups() {
    const { user, client } = await getAccount();

    const { data, error } = await client
      .from(TABLE)
      .select(
        'id, created_at, record_count, backup_version, revision, backup_data'
      )
      .eq('user_id', user.id)
      .limit(1);

    if (error) throw error;

    const list = $('cloudBackupList');

    if (!list) return data || [];

    list.replaceChildren();

    if (!data || !data.length) {
      const empty = document.createElement('p');

      empty.className = 'muted';
      empty.textContent = 'No cloud backup saved yet.';

      list.appendChild(empty);

      return [];
    }

    const item = data[0];

    const latest = item.backup_data;

    const previous = latest && latest.previousBackup;

    appendBackupCard(
      list,
      '🟢 Latest backup',
      latest,
      'latest',
      item
    );

    if (
      previous &&
      isPlainObject(previous.records)
    ) {
      appendBackupCard(
        list,
        '🕘 Previous backup',
        previous,
        'previous',
        item
      );
    } else {
      const note = document.createElement('p');

      note.className = 'muted';

      note.textContent =
        'No previous backup yet. It will appear after ' +
        'the next successful cloud backup.';

      list.appendChild(note);
    }

    const revision = document.createElement('p');

    revision.className = 'small muted';

    revision.textContent =
      'Cloud revision: ' + (item.revision || 0);

    list.appendChild(revision);

    return data;
  }

  /*
   * RESTORE LATEST OR PREVIOUS BACKUP
   */

  async function restoreBackup(id, slot = 'latest') {
    if (!id) return;

    const label = slot === 'previous'
      ? 'previous'
      : 'latest';

    const confirmed = window.confirm(
      'Restore the ' + label +
      ' cloud backup into this device?\n\n' +
      'Missing records and array items will be added. ' +
      'Existing non-empty local values will be preserved.\n\n' +
      'Export a local backup before continuing.'
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

      const stored = data && data.backup_data;

      const backup = slot === 'previous'
        ? stored && stored.previousBackup
        : stored;

      if (
        !backup ||
        backup.application !== 'Story Studio' ||
        backup.format !== 'story-studio-backup' ||
        !isPlainObject(backup.records)
      ) {
        throw new Error(
          slot === 'previous'
            ? 'No previous cloud backup is available yet.'
            : 'The selected cloud backup is invalid.'
        );
      }

      if (![2, 3].includes(Number(backup.version))) {
        throw new Error(
          'This cloud backup version is not supported.'
        );
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

        const incoming = backup.records[key];

        if (
          !Object.prototype.hasOwnProperty.call(current, key) ||
          isEmpty(current[key])
        ) {
          if (!store.set(key, clone(incoming))) {
            throw new Error(
              'Could not restore section: ' + key
            );
          }

          restored++;
          continue;
        }

        const merged = mergeMissing(
          current[key],
          incoming
        );

        if (!sameValue(merged, current[key])) {
          if (!store.set(key, merged)) {
            throw new Error(
              'Could not save restored section: ' + key
            );
          }

          restored++;
        } else {
          preserved++;
        }
      }

      await store.flush();

      show(
        'The ' + label +
        ' cloud backup restore finished. ' +
        restored + ' sections restored or merged; ' +
        preserved + ' sections preserved. ' +
        'Reload the app to refresh its pages.'
      );

    } catch (error) {
      console.error(
        'Cloud restore failed:',
        error
      );

      show(
        error.message || 'Cloud restore failed.',
        true
      );
    }
  }

  /*
   * BUTTON ACTIONS
   */

  async function run(action) {
    const upload = $('cloudBackupUpload');
    const refresh = $('cloudBackupRefresh');

    if (upload) upload.disabled = true;
    if (refresh) refresh.disabled = true;

    try {
      if (action === 'upload') {
        await uploadBackup();
      } else if (action === 'list') {
        await listBackups();

        show(
          'Latest and previous cloud backups checked.'
        );
      }

    } catch (error) {
      console.error(
        'Cloud backup error:',
        error
      );

      show(
        error.message || 'Cloud backup operation failed.',
        true
      );

    } finally {
      if (upload) upload.disabled = false;
      if (refresh) refresh.disabled = false;
    }
  }

  /*
   * INITIALIZE
   */

  function initialize() {
    const upload = $('cloudBackupUpload');
    const refresh = $('cloudBackupRefresh');

    if (upload) {
      upload.addEventListener('click', () => {
        run('upload');
      });
    }

    if (refresh) {
      refresh.addEventListener('click', () => {
        run('list');
      });
    }

    if (upload || refresh) {
      run('list');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      initialize
    );
  } else {
    initialize();
  }

})();
