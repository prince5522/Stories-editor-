/* =====================================================
   STORY STUDIO — DURABLE LOCAL STORAGE ENGINE
   Version: 3.0
   Existing channelStudio.* keys are preserved.
   ===================================================== */
(function () {
  'use strict';

  const PREFIX = 'channelStudio.';
  const DB_NAME = 'channelStudioRecoveryDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'records';
  const memoryFallback = Object.create(null);

  let db = null;
  let recoveryAvailable = false;
  let pendingWrites = Promise.resolve();

  function getStorage() {
    try {
      const storage = window.localStorage;
      const testKey = PREFIX + '__storage_test__';
      storage.setItem(testKey, '1');
      storage.removeItem(testKey);
      return storage;
    } catch (error) {
      console.warn('Story Studio: localStorage unavailable.', error);
      return null;
    }
  }

  function makeKey(key) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Storage key must be a non-empty string.');
    }
    return PREFIX + key.trim();
  }

  function parseValue(raw, fallback, key) {
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn('Story Studio: Could not parse record:', key, error);
      return fallback;
    }
  }

  function openRecoveryDB() {
    return new Promise(resolve => {
      if (!('indexedDB' in window)) return resolve(null);

      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        console.warn('Story Studio: Recovery DB could not open.', error);
        return resolve(null);
      }

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        db = request.result;
        recoveryAvailable = true;
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          db = null;
          recoveryAvailable = false;
        };
        resolve(db);
      };

      request.onerror = request.onblocked = () => {
        console.warn('Story Studio: Recovery DB unavailable.', request.error);
        resolve(null);
      };
    });
  }

  function recoveryPut(fullKey, serialized) {
    if (!db) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          key: fullKey,
          value: serialized,
          deleted: false,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (error) {
        console.warn('Story Studio: Recovery mirror write failed.', error);
        resolve(false);
      }
    });
  }

  function recoveryDelete(fullKey) {
    if (!db) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        // Keep a tombstone so an intentionally deleted record
        // cannot be resurrected during recovery.
        tx.objectStore(STORE_NAME).put({
          key: fullKey,
          value: null,
          deleted: true,
          updatedAt: Date.now()
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (error) {
        console.warn('Story Studio: Recovery delete failed.', error);
        resolve(false);
      }
    });
  }

  function recoveryGetAll() {
    if (!db) return Promise.resolve([]);
    return new Promise(resolve => {
      try {
        const request = db.transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function restoreMissingFromRecovery() {
    if (!db) return 0;
    const records = await recoveryGetAll();
    const storage = getStorage();
    let restored = 0;

    for (const record of records) {
      if (!record || typeof record.key !== 'string' ||
          !record.key.startsWith(PREFIX) || record.deleted ||
          typeof record.value !== 'string') continue;

      let exists = false;
      try { exists = !!storage && storage.getItem(record.key) !== null; }
      catch (_) {}

      if (exists) continue;

      const shortKey = record.key.slice(PREFIX.length);
      const value = parseValue(record.value, undefined, shortKey);
      if (value === undefined) continue;

      memoryFallback[record.key] = value;
      try { if (storage) storage.setItem(record.key, record.value); }
      catch (error) {
        console.warn('Story Studio: Recovered record remains in memory.', shortKey, error);
      }
      restored++;
    }

    if (restored) {
      console.info('Story Studio: Recovered ' + restored + ' record(s).');
    }
    return restored;
  }

  function get(key, fallback = null) {
    let fullKey;
    try { fullKey = makeKey(key); }
    catch (error) { console.warn(error); return fallback; }

    const storage = getStorage();
    if (storage) {
      try {
        const raw = storage.getItem(fullKey);
        if (raw !== null) return parseValue(raw, fallback, key);
      } catch (error) {
        console.warn('Story Studio: Read failed:', key, error);
      }
    }

    return Object.prototype.hasOwnProperty.call(memoryFallback, fullKey)
      ? memoryFallback[fullKey] : fallback;
  }

  function set(key, value) {
    let fullKey;
    try { fullKey = makeKey(key); }
    catch (error) { console.warn(error); return false; }

    let serialized;
    try {
      serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error('Value cannot be saved as JSON.');
    } catch (error) {
      console.error('Story Studio: Serialization failed:', key, error);
      return false;
    }

    let saved = false;
    const storage = getStorage();
    try {
      if (storage) {
        storage.setItem(fullKey, serialized);
        saved = true;
      }
    } catch (error) {
      console.error('Story Studio: localStorage write failed:', key, error);
      if (error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014) {
        console.warn('Story Studio: Storage is full. Existing data was not deleted.');
      }
    }

    memoryFallback[fullKey] = value;

    // Wait for DB initialization before writing the recovery copy.
    pendingWrites = pendingWrites
      .then(() => recoveryOpen)
      .then(() => recoveryPut(fullKey, serialized))
      .catch(error => {
        console.warn('Story Studio: Recovery write queue failed.', error);
        return false;
      });

    return saved;
  }

  function remove(key) {
    let fullKey;
    try { fullKey = makeKey(key); }
    catch (error) { console.warn(error); return false; }

    try {
      const storage = getStorage();
      if (storage) storage.removeItem(fullKey);
      delete memoryFallback[fullKey];

      pendingWrites = pendingWrites
        .then(() => recoveryOpen)
        .then(() => recoveryDelete(fullKey))
        .catch(() => false);

      return true;
    } catch (error) {
      console.warn('Story Studio: Remove failed:', key, error);
      return false;
    }
  }

  function all() {
    const output = Object.create(null);
    const storage = getStorage();

    if (storage) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const fullKey = storage.key(i);
          if (!fullKey || !fullKey.startsWith(PREFIX)) continue;
          const key = fullKey.slice(PREFIX.length);
          try {
            const raw = storage.getItem(fullKey);
            if (raw !== null) output[key] = JSON.parse(raw);
          } catch (error) {
            console.warn('Story Studio: Skipping unreadable record:', key, error);
          }
        }
      } catch (error) {
        console.warn('Story Studio: Could not enumerate records.', error);
      }
    }

    Object.keys(memoryFallback).forEach(fullKey => {
      if (!fullKey.startsWith(PREFIX)) return;
      const key = fullKey.slice(PREFIX.length);
      if (!Object.prototype.hasOwnProperty.call(output, key)) {
        output[key] = memoryFallback[fullKey];
      }
    });

    return output;
  }

  async function flush() {
    await pendingWrites;
    return true;
  }

  async function allAsync() {
    await ready;
    await flush();

    const output = all();
    const records = await recoveryGetAll();

    for (const record of records) {
      if (!record || typeof record.key !== 'string' ||
          !record.key.startsWith(PREFIX) || record.deleted) continue;
      const key = record.key.slice(PREFIX.length);
      if (Object.prototype.hasOwnProperty.call(output, key)) continue;
      const value = parseValue(record.value, undefined, key);
      if (value !== undefined) output[key] = value;
    }
    return output;
  }

  function status() {
    return {
      localStorage: !!getStorage(),
      recoveryDatabase: recoveryAvailable,
      memoryRecords: Object.keys(memoryFallback).length
    };
  }

  const recoveryOpen = openRecoveryDB();
  const ready = recoveryOpen.then(async database => {
    if (database) await restoreMissingFromRecovery();
    return status();
  });

  window.StudioStore = {
    get,
    set,
    remove,
    all,
    isAvailable: () => !!getStorage(),
    allAsync,
    flush,
    status,
    ready,
    restoreMissingFromRecovery
  };

  console.info('Story Studio durable local storage initialized.');
})();
