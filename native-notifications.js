
/* =====================================================
   STORIES EDITOR — ANDROID NATIVE REMINDER BRIDGE
   Daily slot reminders + 5-minute post confirmation
   Android notification actions:
   - Yes, posted
   - Not yet
===================================================== */

(function () {
  'use strict';

  const SLOT_NAMES = ['morning', 'lunch', 'evening'];
  const PLANNER_KEY = 'storySlotPlannerV1';
  const POST_REMINDER_ID = 44001;
  const POST_ACTION_TYPE = 'STORY_POST_CONFIRMATION';
  const POST_REMINDER_DELAY = 5 * 60 * 1000;
  const WHATSAPP_LAUNCH_WINDOW_MS = 90000;

  const ID_BASE = {
    morning: 41000,
    lunch: 42000,
    evening: 43000
  };

  let syncing = false;
  let actionListenerReady = false;
  let originalWindowOpen = null;

  function getPlugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  function isAndroidApp() {
    return !!(
      window.Capacitor?.isNativePlatform?.() &&
      window.Capacitor?.getPlatform?.() === 'android'
    );
  }

  function readSettings() {
    try {
      return window.StudioStore?.get(PLANNER_KEY, {}) || {};
    } catch (error) {
      console.warn('Could not read planner settings:', error);
      return {};
    }
  }

  function writeSettings(settings) {
    try {
      window.StudioStore?.set(PLANNER_KEY, settings);
      return true;
    } catch (error) {
      console.error('Could not save planner settings:', error);
      return false;
    }
  }

  function readStore(key, fallback) {
    try {
      return window.StudioStore?.get(key, fallback) ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.StudioStore?.set(key, value);
      return true;
    } catch (error) {
      console.error('Could not save ' + key + ':', error);
      return false;
    }
  }

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function isCompleted(settings, slotName, date) {
    const scheduledDay = dateKey(date);

    if (settings.slotRuns?.[slotName] === scheduledDay) {
      return true;
    }

    const records = settings.completed?.[slotName] || [];

    return Array.isArray(records) && records.some(record => {
      const value =
        record?.completedAt ||
        record?.posted_at ||
        record?.postedAt ||
        record?.date;

      if (!value) return false;

      const completedDate = new Date(value);

      return !Number.isNaN(completedDate.getTime()) &&
        dateKey(completedDate) === scheduledDay;
    });
  }

  function nextDate(time, offset) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
      String(time || '')
    );

    if (!match) return null;

    const date = new Date();
    date.setDate(date.getDate() + offset);
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);

    return date;
  }

  async function requestNotificationPermission(plugin) {
    let permission = await plugin.checkPermissions();

    if (permission.display !== 'granted') {
      permission = await plugin.requestPermissions();
    }

    return permission.display === 'granted';
  }

  async function checkExactAlarmPermission(plugin) {
    if (typeof plugin.checkExactNotificationSetting !== 'function') {
      return true;
    }

    const result = await plugin.checkExactNotificationSetting();
    return result.exact_alarm === 'granted';
  }

  async function registerPostActions(plugin) {
    if (typeof plugin.registerActionTypes !== 'function') {
      console.warn('This Local Notifications version does not support action buttons.');
      return false;
    }

    try {
      await plugin.registerActionTypes({
        types: [{
          id: POST_ACTION_TYPE,
          actions: [
            { id: 'posted', title: 'Yes, posted' },
            { id: 'not-posted', title: 'Not yet' }
          ]
        }]
      });

      return true;
    } catch (error) {
      console.error('Could not register post confirmation actions:', error);
      return false;
    }
  }

  async function cancelPostConfirmation() {
    const plugin = getPlugin();
    if (!plugin || !isAndroidApp()) return;

    try {
      await plugin.cancel({
        notifications: [{ id: POST_REMINDER_ID }]
      });
    } catch (error) {
      console.warn('Could not cancel post confirmation reminder:', error);
    }
  }

  function episodeTitle(settings, slotName, pending) {
    const slot = settings.slots?.[slotName] || {};

    return [
      slot.storyName || 'Your story',
      pending.episodeLabel || 'Selected episode'
    ].join(' — ');
  }

  async function schedulePostConfirmation(details) {
    if (!isAndroidApp()) return false;

    const plugin = getPlugin();
    if (!plugin) return false;

    try {
      const allowed = await requestNotificationPermission(plugin);

      if (!allowed) {
        console.warn('Post confirmation reminder skipped: notification permission denied.');
        return false;
      }

      const settings = readSettings();
      const pending = settings.pending;

      if (
        !pending ||
        pending.stage !== 'episode-opened' ||
        pending.slot !== details.slot ||
        String(pending.episodeId) !== String(details.episodeId)
      ) {
        return false;
      }

      const actionsReady = await registerPostActions(plugin);
      if (!actionsReady) return false;

      await cancelPostConfirmation();

      const slotName = details.slot;
      const title = episodeTitle(settings, slotName, pending);
      const remindAt = new Date(Date.now() + POST_REMINDER_DELAY);

      await plugin.schedule({
        notifications: [{
          id: POST_REMINDER_ID,
          title: '📖 Have you posted this episode?',
          body: title + ' — tap Yes, posted or Not yet.',
          schedule: {
            at: remindAt,
            allowWhileIdle: true
          },
          actionTypeId: POST_ACTION_TYPE,
          autoCancel: true,
          extra: {
            kind: 'story-post-confirmation',
            slot: slotName,
            episodeId: pending.episodeId,
            episodeLabel: pending.episodeLabel || '',
            storyName: settings.slots?.[slotName]?.storyName || ''
          }
        }]
      });

      const latest = readSettings();

      if (
        latest.pending &&
        latest.pending.slot === slotName &&
        String(latest.pending.episodeId) === String(details.episodeId)
      ) {
        latest.pending.confirmationReminderAt = remindAt.toISOString();

        latest.pending.confirmationReminderCount =
          Number(latest.pending.confirmationReminderCount || 0) + 1;

        writeSettings(latest);
      }

      console.log('Post confirmation reminder scheduled for five minutes after opening WhatsApp.');
      return true;

    } catch (error) {
      console.error('Could not schedule post confirmation reminder:', error);
      return false;
    }
  }

  function sameStoryName(a, b) {
    return String(a || '').trim().toLowerCase() ===
      String(b || '').trim().toLowerCase();
  }

  function episodeSort(a, b) {
    return Number(a.season_number || 1) -
      Number(b.season_number || 1) ||
      Number(a.episode_number || 1) -
      Number(b.episode_number || 1);
  }

  function markReadyEpisodePosted(episodeId) {
    const episodes = readStore('readyMadeEpisodes', []);

    const index = episodes.findIndex(item =>
      String(item.id) === String(episodeId)
    );

    if (index < 0) return false;

    episodes[index].status = 'posted';
    episodes[index].posted_at = new Date().toISOString();

    writeStore('readyMadeEpisodes', episodes);
    return true;
  }

  function advanceQueuePosition(settings, slotName, episode) {
    const slot = settings.slots?.[slotName];
    if (!slot || !episode) return;

    const season = Number(
      slot.type === 'ready'
        ? episode.season_number || 1
        : episode.seasonNumber || 1
    );

    const number = Number(
      slot.type === 'ready'
        ? episode.episode_number || 1
        : episode.episodeNumber || 1
    );

    if (slot.type === 'ready') {
      const all = readStore('readyMadeEpisodes', []);

      const storyEpisodes = all
        .filter(item => sameStoryName(
          item.story_title ||
          item.storyName ||
          item.title ||
          'Ready-made episodes',
          slot.storyName
        ))
        .sort(episodeSort);

      const currentIndex = storyEpisodes.findIndex(item =>
        String(item.id) === String(episode.id)
      );

      const next = currentIndex >= 0
        ? storyEpisodes.slice(currentIndex + 1).find(item =>
            String(item.status || '').toLowerCase() !== 'posted'
          )
        : null;

      if (next) {
        slot.season = Number(next.season_number || 1);
        slot.episode = Number(next.episode_number || 1);
      } else {
        // Ready-Made episodes are not limited to 13 per season.
        slot.season = season;
        slot.episode = number + 1;
      }

      return;
    }

    if (number >= 13) {
      slot.season = season + 1;
      slot.episode = 1;
    } else {
      slot.season = season;
      slot.episode = number + 1;
    }
  }

  function confirmPostFromNotification(extra) {
    const slotName = extra?.slot;
    const episodeId = extra?.episodeId;

    if (!SLOT_NAMES.includes(slotName) || episodeId == null) {
      console.warn('Post confirmation notification did not contain a valid queue and episode.');
      return false;
    }

    const settings = readSettings();
    const pending = settings.pending;

    if (
      !pending ||
      pending.stage !== 'episode-opened' ||
      pending.slot !== slotName ||
      String(pending.episodeId) !== String(episodeId)
    ) {
      console.warn('Post confirmation ignored because the active episode no longer matches.');
      cancelPostConfirmation();
      return false;
    }

    const slot = settings.slots?.[slotName];
    if (!slot) return false;

    let episode = null;

    if (slot.type === 'ready') {
      const episodes = readStore('readyMadeEpisodes', []);

      episode = episodes.find(item =>
        String(item.id) === String(episodeId)
      ) || null;

      if (!episode) {
        console.warn('Ready-Made episode was not found; queue was not advanced.');
        return false;
      }

      markReadyEpisodePosted(episodeId);

    } else {
      const episodes = readStore('episodes', []);

      episode = episodes.find(item =>
        String(item.id) === String(episodeId)
      ) || {
        id: episodeId,
        seasonNumber: slot.season || 1,
        episodeNumber: slot.episode || 1
      };
    }

    settings.completed = settings.completed || {};

    settings.completed[slotName] =
      Array.isArray(settings.completed[slotName])
        ? settings.completed[slotName]
        : [];

    const alreadyRecorded = settings.completed[slotName].some(record =>
      String(record.episodeId) === String(episodeId)
    );

    const completedAt = new Date().toISOString();

    if (!alreadyRecorded) {
      settings.completed[slotName].push({
        episodeId,
        label: pending.episodeLabel || extra.episodeLabel || 'Episode',
        title: slot.storyName || extra.storyName || '',
        completedAt,
        tracking: 'notification-confirmed-posted'
      });
    }

    settings.slotRuns = settings.slotRuns || {};
    settings.slotRuns[slotName] = dateKey(new Date());

    advanceQueuePosition(settings, slotName, episode);

    settings.pending = null;

    if (!writeSettings(settings)) return false;

    cancelPostConfirmation();

    try {
      document.dispatchEvent(new Event('planner:posts-updated'));
    } catch (_) {}

    console.log('Episode marked posted from Android notification:', slotName, episodeId);
    return true;
  }

  async function handlePostNotificationAction(action) {
    const notification = action?.notification || {};
    const extra = notification.extra || notification.data || {};
    const actionId = action?.actionId;

    if (extra.kind !== 'story-post-confirmation') return;

    if (actionId === 'posted') {
      confirmPostFromNotification(extra);
      return;
    }

    if (actionId === 'not-posted') {
      const settings = readSettings();
      const pending = settings.pending;

      if (
        pending &&
        pending.stage === 'episode-opened' &&
        pending.slot === extra.slot &&
        String(pending.episodeId) === String(extra.episodeId)
      ) {
        pending.lastConfirmationResponse = 'not-posted';
        pending.lastConfirmationResponseAt = new Date().toISOString();

        writeSettings(settings);

        // Ask again after another five minutes until confirmed.
        await schedulePostConfirmation({
          slot: extra.slot,
          episodeId: extra.episodeId
        });

      } else {
        await cancelPostConfirmation();
      }
    }
  }

  async function setupPostActionListener() {
    if (actionListenerReady || !isAndroidApp()) return;

    const plugin = getPlugin();

    if (!plugin || typeof plugin.addListener !== 'function') return;

    try {
      await registerPostActions(plugin);

      await plugin.addListener(
        'localNotificationActionPerformed',
        handlePostNotificationAction
      );

      actionListenerReady = true;

    } catch (error) {
      console.error('Could not attach post notification action listener:', error);
    }
  }

  function watchWhatsAppOpening() {
    if (originalWindowOpen || typeof window.open !== 'function') return;

    originalWindowOpen = window.open.bind(window);

    window.open = function (url, target, features) {
      try {
        const settings = readSettings();
        const pending = settings.pending;

        const launchTime = Number(pending?.launchRequestedAt || 0);
        const launchAge = Date.now() - launchTime;

        const isWhatsApp = /whatsapp|wa\.me/i.test(String(url || ''));

        if (
          isWhatsApp &&
          pending &&
          pending.stage === 'episode-opened' &&
          launchTime > 0 &&
          launchAge >= 0 &&
          launchAge <= WHATSAPP_LAUNCH_WINDOW_MS
        ) {
          schedulePostConfirmation({
            slot: pending.slot,
            episodeId: pending.episodeId
          });
        }

      } catch (error) {
        console.warn('Could not start post confirmation countdown:', error);
      }

      return originalWindowOpen(url, target, features);
    };
  }

  function monitorPostReminder() {
    const settings = readSettings();
    const pending = settings.pending;

    if (
      !pending ||
      pending.stage !== 'episode-opened'
    ) {
      cancelPostConfirmation();
    }
  }

  async function requestExactAlarmAccess() {
    if (!isAndroidApp()) {
      return {
        granted: false,
        message: 'Open this feature in the installed Android app.'
      };
    }

    const plugin = getPlugin();

    if (!plugin) {
      return {
        granted: false,
        message: 'Android notification service is unavailable.'
      };
    }

    try {
      const alreadyGranted =
        await checkExactAlarmPermission(plugin);

      if (alreadyGranted) {
        await sync();

        return {
          granted: true,
          message: 'Exact alarm access is already enabled.'
        };
      }

      if (
        typeof plugin.changeExactNotificationSetting !== 'function'
      ) {
        return {
          granted: false,
          message: 'Exact alarm settings are unavailable.'
        };
      }

      await plugin.changeExactNotificationSetting();

      const granted =
        await checkExactAlarmPermission(plugin);

      if (granted) await sync();

      return {
        granted,
        message: granted
          ? 'Exact alarm access enabled.'
          : 'Please allow Alarms & reminders in Android settings.'
      };

    } catch (error) {
      console.error('Exact alarm permission error:', error);

      return {
        granted: false,
        message: 'Could not open exact alarm settings.'
      };
    }
  }

  async function sync() {
    if (!isAndroidApp() || syncing) return;

    const plugin = getPlugin();

    if (!plugin) {
      console.warn('Android Local Notifications plugin unavailable.');
      return;
    }

    syncing = true;

    try {
      const allowed =
        await requestNotificationPermission(plugin);

      if (!allowed) {
        console.warn('Notification permission was not granted.');
        return;
      }

      await setupPostActionListener();

      const exactAllowed =
        await checkExactAlarmPermission(plugin);

      if (!exactAllowed) {
        console.warn(
          'Exact alarm access is not enabled. Use the planner permission button.'
        );
        return;
      }

      const settings = readSettings();
      const notifications = [];
      const cancelIds = [];

      SLOT_NAMES.forEach(slotName => {
        for (let day = 0; day < 30; day++) {
          cancelIds.push(ID_BASE[slotName] + day);
        }
      });

      for (const slotName of SLOT_NAMES) {
        const slot = settings.slots?.[slotName];

        if (
          !slot ||
          !slot.time ||
          !slot.storyName ||
          !slot.channelUrl
        ) {
          continue;
        }

        for (let day = 0; day < 30; day++) {
          const scheduledDate = nextDate(slot.time, day);

          if (!scheduledDate || scheduledDate <= new Date()) {
            continue;
          }

          if (isCompleted(settings, slotName, scheduledDate)) {
            continue;
          }

          const id = ID_BASE[slotName] + day;

          const labels = {
            morning: '🌅 Morning posting time',
            lunch: '☀️ Lunch posting time',
            evening: '🌙 Evening posting time'
          };

          notifications.push({
            id,
            title: labels[slotName],
            body: 'It is time to prepare ' +
              slot.storyName +
              ' in Stories Editor.',
            schedule: {
              at: scheduledDate,
              allowWhileIdle: true
            },
            extra: {
              slot: slotName,
              page: 'planner.html'
            }
          });
        }
      }

      await plugin.cancel({
        notifications: cancelIds.map(id => ({ id }))
      });

      if (notifications.length) {
        await plugin.schedule({ notifications });
      }

      console.log(
        'Android reminders synchronized:',
        notifications.length
      );

    } catch (error) {
      console.error('Android reminder sync failed:', error);

    } finally {
      syncing = false;
    }
  }

  function delayedSync() {
    window.setTimeout(sync, 700);
  }

  function init() {
    if (!isAndroidApp()) return;

    setupPostActionListener();
    watchWhatsAppOpening();

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        delayedSync();
        monitorPostReminder();
      }
    });

    window.addEventListener('focus', () => {
      delayedSync();
      monitorPostReminder();
    });

    window.setInterval(monitorPostReminder, 3000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    init();
    delayedSync();
  });

  document.addEventListener(
    'planner:posts-updated',
    delayedSync
  );

  document.addEventListener('click', event => {
    const button = event.target.closest(
      '#saveAllPlannerSlots, #savePlannerSettings'
    );

    if (button) delayedSync();
  });

  window.StoriesAndroidReminders = {
    sync,
    requestExactAlarmAccess,

    checkExactAlarmPermission: async function () {
      const plugin = getPlugin();

      if (!plugin) return false;

      return checkExactAlarmPermission(plugin);
    },

    schedulePostConfirmation,
    cancelPostConfirmation
  };

})();
