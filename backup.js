
/* Story Studio - Android Native JSON Backup
   Uses Capacitor Filesystem + Share.
   Keeps the existing browser backup unchanged.
*/
(function () {
  'use strict';

  const button = document.getElementById('exportBackup');
  const status = document.getElementById('exportStatus');

  if (!button) return;

  function showStatus(message, isError) {
    if (status) {
      status.textContent = message;
      status.style.color = isError ? '#dc2626' : '#16a34a';
    }

    if (typeof window.studioToast === 'function') {
      window.studioToast(message);
    }
  }

  function isNativeAndroid() {
    const cap = window.Capacitor;

    if (!cap) return false;

    const platform = typeof cap.getPlatform === 'function'
      ? cap.getPlatform()
      : '';

    return platform === 'android';
  }

  function createBackupJSON() {
    const store = window.StudioStore;

    if (!store || typeof store.all !== 'function') {
      throw new Error('Story Studio storage is not ready.');
    }

    const records = store.all();

    if (!records || typeof records !== 'object') {
      throw new Error('No backup data could be read.');
    }

    const backup = {
      application: 'Story Studio',
      format: 'story-studio-backup',
      version: 2,
      exportedAt: new Date().toISOString(),
      records: records
    };

    return JSON.stringify(backup, null, 2);
  }

  async function exportNativeBackup() {
    const plugins = window.Capacitor &&
      window.Capacitor.Plugins;

    const Filesystem = plugins && plugins.Filesystem;
    const Share = plugins && plugins.Share;

    if (!Filesystem || !Share) {
      throw new Error(
        'Android backup plugins are unavailable. Please rebuild the APK.'
      );
    }

    const json = createBackupJSON();

    const date = new Date().toISOString()
      .replace(/[:.]/g, '-');

    const filename = 'story-studio-backup-' + date + '.json';

    const savedFile = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: 'CACHE',
      encoding: 'utf8',
      recursive: true
    });

    if (!savedFile || !savedFile.uri) {
      throw new Error('Android could not create the backup file.');
    }

    await Share.share({
      title: 'Story Studio JSON Backup',
      text: 'Story Studio backup file. Keep this file safe.',
      files: [savedFile.uri],
      dialogTitle: 'Save Story Studio Backup'
    });

    showStatus(
      'Backup prepared. Choose where to save the JSON file.',
      false
    );
  }

  button.addEventListener('click', function (event) {
    if (!isNativeAndroid()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.dataset.backupRunning === 'true') return;

    button.dataset.backupRunning = 'true';

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparing backup...';

    exportNativeBackup()
      .catch(function (error) {
        console.error('Story Studio backup error:', error);

        showStatus(
          error && error.message
            ? error.message
            : 'Could not prepare the backup. Please try again.',
          true
        );
      })
      .finally(function () {
        button.disabled = false;
        button.textContent = originalText;
        button.dataset.backupRunning = 'false';
      });
  }, true);

})();
