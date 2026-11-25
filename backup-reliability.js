
/* =====================================================
   STORY STUDIO — RELIABLE LOCAL BACKUP EXPORT
   Version 2.0 — DOWNLOAD BACKUP FILE

   - Exports all StudioStore records
   - Saves to Android Documents when Filesystem is available
   - Otherwise triggers a browser JSON download
   - Does not modify or delete app data
===================================================== */

(function () {
  'use strict';

  const BUTTON_ID = 'exportBackup';
  let busy = false;

  function status(message, isError) {
    const output = document.getElementById('exportStatus');

    if (output) {
      output.textContent = message;
      output.style.color = isError ? '#dc5656' : '';
    }

    if (window.studioToast) {
      window.studioToast(message);
    }
  }

  function dateStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  async function createBackup() {
    const storage = window.StudioStore;

    if (!storage) {
      throw new Error('Story Studio storage is not ready.');
    }

    if (storage.ready) await storage.ready;
    if (storage.flush) await storage.flush();

    const records = typeof storage.allAsync === 'function'
      ? await storage.allAsync()
      : storage.all();

    if (!records || !Object.keys(records).length) {
      throw new Error('No saved Story Studio records were found.');
    }

    return {
      application: 'Story Studio',
      format: 'story-studio-backup',
      version: 3,
      exportedAt: new Date().toISOString(),
      records
    };
  }

  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';

    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }

    return btoa(binary);
  }

  async function saveWithCapacitor(json, filename) {
    const capacitor = window.Capacitor;

    if (!capacitor) return false;

    let filesystem = capacitor.Plugins?.Filesystem;
    let directory = capacitor.Plugins?.Filesystem?.Directory;

    if (!filesystem && typeof capacitor.registerPlugin === 'function') {
      try {
        filesystem = capacitor.registerPlugin('Filesystem');
      } catch (error) {
        console.warn('Filesystem plugin registration failed:', error);
      }
    }

    if (!filesystem || typeof filesystem.writeFile !== 'function') {
      return false;
    }

    if (!directory) {
      directory = { Documents: 'DOCUMENTS' };
    }

    const result = await filesystem.writeFile({
      path: filename,
      data: toBase64(json),
      directory: directory.Documents || 'DOCUMENTS',
      recursive: true
    });

    if (!result || !result.uri) {
      throw new Error('Android did not confirm the backup file location.');
    }

    return result;
  }

  function saveWithBrowser(json, filename) {
    const blob = new Blob([json], {
      type: 'application/json;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.setAttribute('download', filename);
    link.style.position = 'fixed';
    link.style.left = '-9999px';

    document.body.appendChild(link);
    link.click();

    setTimeout(function () {
      link.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  }

  async function exportBackup() {
    if (busy) return;

    busy = true;

    const button = document.getElementById(BUTTON_ID);
    const originalText = button
      ? button.textContent
      : 'Download full backup';

    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing backup…';
    }

    try {
      const backup = await createBackup();
      const json = JSON.stringify(backup, null, 2);
      const filename = 'story-studio-backup-' + dateStamp() + '.json';
      const sectionCount = Object.keys(backup.records).length;

      let nativeResult = false;

      try {
        nativeResult = await saveWithCapacitor(json, filename);
      } catch (nativeError) {
        console.warn(
          'Android Documents save unavailable; using browser download:',
          nativeError
        );
      }

      if (nativeResult) {
        status(
          'Backup saved to Android Documents: ' + filename +
          ' (' + sectionCount + ' data sections).',
          false
        );
      } else {
        saveWithBrowser(json, filename);

        status(
          'Backup download started: ' + filename +
          '. Check your Downloads folder. (' +
          sectionCount + ' data sections.)',
          false
        );
      }
    } catch (error) {
      console.error('Story Studio backup export failed:', error);

      status(
        error.message ||
        'Backup export failed. Your saved data was not changed.',
        true
      );
    } finally {
      busy = false;

      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  // Capture the button before older app.js click handlers.
  document.addEventListener('click', function (event) {
    const target = event.target;
    const button = target && target.closest
      ? target.closest('#' + BUTTON_ID)
      : null;

    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    exportBackup();
  }, true);

  console.info('Story Studio local backup exporter initialized.');
})();
