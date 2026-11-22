/* STORIES EDITOR — CLOUD BACKUP REMINDERS */

(function () {
  'use strict';

  const cloud = window.ChannelStudioCloud;
  const BACKUP_TABLE = 'app_backups';
  const REMINDER_AFTER_HOURS = 24;

  function createReminderPanel() {
    const cloudSection = document.getElementById('cloudBackupUpload')
      ?.closest('.panel');

    if (!cloudSection) return null;

    let panel = document.getElementById('backupReminder');

    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'backupReminder';
    panel.className = 'notice info';
    panel.style.marginTop = '14px';
    panel.textContent = 'Checking your latest cloud backup…';

    const status = document.getElementById('cloudBackupStatus');

    if (status) {
      status.insertAdjacentElement('afterend', panel);
    } else {
      cloudSection.appendChild(panel);
    }

    return panel;
  }

  async function checkBackup() {
    const panel = createReminderPanel();

    if (!panel) return;

    try {
      if (!cloud) {
        panel.textContent = 'Cloud backup service is not available.';
        return;
      }

      await cloud.ready;

      const user = await cloud.getUser();

      if (!user || user.is_anonymous) {
        panel.textContent =
          'Sign in with your email account to check cloud backup reminders.';
        return;
      }

      const client = cloud.getClient();

      if (!client) {
        panel.textContent = 'Unable to connect to Supabase.';
        return;
      }

      const { data, error } = await client
        .from(BACKUP_TABLE)
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (!data || !data.length) {
        panel.textContent =
          '⚠️ You have not created a cloud backup yet. Create your first backup to protect your app records.';
        return;
      }

      const lastBackup = new Date(data[0].created_at);
      const hoursOld =
        (Date.now() - lastBackup.getTime()) / 3600000;

      const dateText = lastBackup.toLocaleString();

      if (hoursOld >= REMINDER_AFTER_HOURS) {
        panel.textContent =
          '⚠️ Your last cloud backup was ' + dateText +
          '. It is at least 24 hours old. Consider creating a fresh backup.';
      } else {
        panel.textContent =
          '✅ Your latest cloud backup was saved on ' +
          dateText + '. Your backup is up to date.';
      }

    } catch (error) {
      console.error('Backup reminder error:', error);
      panel.textContent =
        'Could not check your latest cloud backup. Please refresh and try again.';
    }
  }

  function initialize() {
    checkBackup();

    const refresh = document.getElementById('cloudBackupRefresh');

    if (refresh) {
      refresh.addEventListener('click', function () {
        setTimeout(checkBackup, 1200);
      });
    }

    const upload = document.getElementById('cloudBackupUpload');

    if (upload) {
      upload.addEventListener('click', function () {
        setTimeout(checkBackup, 2500);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();