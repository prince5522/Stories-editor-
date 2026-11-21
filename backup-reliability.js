/* =====================================================
   STORY STUDIO — RELIABLE ANDROID BACKUP EXPORT
   Version 1.0
   Uses StudioStore.allAsync() when available.
   Prefers Android share sheet; falls back to file download.
   ===================================================== */
(function () {
  'use strict';

  const buttonId = 'exportBackup';
  let busy = false;

  function status(message, isError) {
    const output = document.getElementById('exportStatus');
    if (output) {
      output.textContent = message;
      output.style.color = isError ? '#dc5656' : '';
    }
    if (window.studioToast) window.studioToast(message);
  }

  function dateStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  async function createBackup() {
    const storage = window.StudioStore;
    if (!storage) throw new Error('Story Studio storage is not ready.');

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
      version: 2,
      exportedAt: new Date().toISOString(),
      records
    };
  }

  async function exportBackup() {
    if (busy) return;
    busy = true;

    const button = document.getElementById(buttonId);
    const originalText = button ? button.textContent : 'Download full backup';
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing backup…';
    }

    try {
      const backup = await createBackup();
      const json = JSON.stringify(backup, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const filename = 'story-studio-backup-' + dateStamp() + '.json';
      const file = new File([blob], filename, { type: 'application/json' });

      // Android Chrome/PWA: open the native share sheet when supported.
      if (navigator.share && navigator.canShare &&
          navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Story Studio backup',
          text: 'Save this Story Studio backup somewhere safe.'
        });
        status('Backup ready. Choose Files or Drive in the share sheet to save it. (' +
          Object.keys(backup.records).length + ' data sections.)', false);
        return;
      }

      // Browser fallback: initiate a real file download.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();

      // Keep the object URL alive long enough for Android download handling.
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      status('Backup file download was requested. Check your Downloads folder for ' +
        filename + '. (' + Object.keys(backup.records).length +
        ' data sections.)', false);

    } catch (error) {
      if (error && error.name === 'AbortError') {
        status('Backup sharing was cancelled. No backup was saved.', false);
      } else {
        console.error('Story Studio backup export failed:', error);
        status(error.message || 'Backup export failed. Your saved data was not changed.', true);
      }
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  // Capture the click before the older app.js export handler.
  document.addEventListener('click', function (event) {
    const button = event.target.closest('#' + buttonId);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    exportBackup();
  }, true);

  console.info('Story Studio reliable backup export initialized.');
})();
