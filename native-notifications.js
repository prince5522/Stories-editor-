
/* =====================================================
   STORIES EDITOR — ANDROID NATIVE NOTIFICATIONS
   Daily posting reminders + post confirmation actions
   Capacitor Local Notifications 7
===================================================== */

(function () {
  'use strict';

  const SLOT_NAMES = ['morning', 'lunch', 'evening'];
  const PLANNER_KEY = 'storySlotPlannerV1';

  const POST_REMINDER_ID = 44001;
  const POST_ACTION_TYPE = 'STORY_POST_CONFIRMATION';
  const POST_REMINDER_DELAY = 5 * 60 * 1000;

  const ID_BASE = {
    morning: 41000,
    lunch: 42000,
    evening: 43000
  };

  let syncing = false;
  let actionListenerReady = false;

  /* ---------- PLATFORM ---------- */

  function getPlugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  function isAndroidApp() {
    return !!(
      window.Capacitor?.isNativePlatform?.() &&
      window.Capacitor?.getPlatform?.() === 'android'
    );
  }

  /* ---------- STORAGE ---------- */

  function readStore(key, fallback) {
    try {
      return window.StudioStore?.get(key, fallback) ?? fallback;
    } catch (error) {
      console.warn('Could not read ' + key, error);
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      return window.StudioStore?.set(key, value) !== false;
    } catch (error) {
      console.error('Could not save ' + key, error);
      return false;
    }
  }

  function readSettings() {
    return readStore(PLANNER_KEY, {}) || {};
  }

  function writeSettings(settings) {
    return writeStore(PLANNER_KEY, settings);
  }

  /* ---------- DATE HELPERS ---------- */

  function dateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
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

  function isCompleted(settings, slotName, date) {
    const day = dateKey(date);

    if (settings.slotRuns?.[slotName] === day) {
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
        dateKey(completedDate) === day;
    });
  }

  /* ---------- PERMISSIONS ---------- */

  async function requestNotificationPermission(plugin) {
    let permission = await plugin.checkPermissions();

    if (permission.display !== 'granted') {
      permission = await plugin.requestPermissions();
    }

    return permission.display === 'granted';
  }

  async function checkExactAlarmPermission(plugin) {
    if (
      typeof plugin.checkExactNotificationSetting !== 'function'
    ) {
      return true;
    }

    const result = await plugin.checkExactNotificationSetting();

    return result.exact_alarm === 'granted';
  }

  async function registerPostActions(plugin) {
    if (typeof plugin.registerActionTypes !== 'function') {
      console.warn(
        'This notification plugin version does not support action buttons.'
      );
      return false;
    }

    try {
      await plugin.registerActionTypes({
        types: [{
          id: POST_ACTION_TYPE,
          actions: [
            {
              id: 'posted',
              title: 'Yes, posted'
            },
            {
              id: 'not-posted',
              title: 'Not yet'
            }
          ]
        }]
      });

      return true;
    } catch (error) {
      console.error('Could not register notification actions:', error);
      return false;
    }
  }

  /* ---------- POST REMINDER ---------- */

  async function cancelPostConfirmation() {
    const plugin = getPlugin();

    if (!plugin || !isAndroidApp()) return;

    try {
      await plugin.cancel({
        notifications: [{ id: POST_REMINDER_ID }]
      });
    } catch (error) {
      console.warn('Could not cancel post reminder:', error);
    }
  }

  function getEpisodeTitle(settings, slotName, pending) {
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
      const allowed =
        await requestNotificationPermission(plugin);

      if (!allowed) {
        console.warn('Notification permission was denied.');
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

      const remindAt = new Date(
        Date.now() + POST_REMINDER_DELAY
      );

      const title = getEpisodeTitle(
        settings,
        details.slot,
        pending
      );

      await plugin.schedule({
        notifications: [{
          id: POST_REMINDER_ID,
          title: '📖 Have you posted this episode?',
          body: title + ' — choose Yes, posted or Not yet.',
          schedule: {
            at: remindAt,
            allowWhileIdle: true
          },
          actionTypeId: POST_ACTION_TYPE,
          autoCancel: true,
          extra: {
            kind: 'story-post-confirmation',
            slot: details.slot,
            episodeId: pending.episodeId,
            episodeLabel: pending.episodeLabel || '',
            storyName:
              settings.slots?.[details.slot]?.storyName || ''
          }
        }]
      });

      const latest = readSettings();

      if (
        latest.pending &&
        latest.pending.stage === 'episode-opened' &&
        latest.pending.slot === details.slot &&
        String(latest.pending.episodeId) ===
          String(details.episodeId)
      ) {
        latest.pending.confirmationReminderAt =
          remindAt.toISOString();

        latest.pending.confirmationReminderCount =
          Number(
            latest.pending.confirmationReminderCount || 0
          ) + 1;

        writeSettings(latest);
      }

      console.log('Five-minute post confirmation reminder scheduled.');
      return true;

    } catch (error) {
      console.error('Could not schedule post reminder:', error);
      return false;
    }
  }

  /* ---------- EPISODE LOOKUP ---------- */

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

  function findReadyEpisode(episodeId) {
    const episodes = readStore('readyMadeEpisodes', []);

    return episodes.find(item =>
      String(item.id) === String(episodeId)
    ) || null;
  }

  function findSerialEpisode(episodeId) {
    const episodes = readStore('episodes', []);

    return episodes.find(item =>
      String(item.id) === String(episodeId)
    ) || null;
  }

  /* ---------- MARK EPISODE AS POSTED ---------- */

  function markReadyEpisodePosted(episodeId) {
    const episodes = readStore('readyMadeEpisodes', []);

    const index = episodes.findIndex(item =>
      String(item.id) === String(episodeId)
    );

    if (index < 0) return false;

    episodes[index] = {
      ...episodes[index],
      status: 'posted',
      posted_at: new Date().toISOString(),
      postedAt: new Date().toISOString()
    };

    return writeStore('readyMadeEpisodes', episodes);
  }

  function markSerialEpisodePosted(episodeId) {
    const episodes = readStore('episodes', []);

    const index = episodes.findIndex(item =>
      String(item.id) === String(episodeId)
    );

    if (index < 0) return false;

    const now = new Date().toISOString();

    episodes[index] = {
      ...episodes[index],
      status: 'posted',
      postedAt: now,
      posted_at: now
    };

    return writeStore('episodes', episodes);
  }

  /* ---------- QUEUE PROGRESSION ---------- */

  function advanceQueuePosition(settings, slotName, episode) {
    const slot = settings.slots?.[slotName];

    if (!slot || !episode) return;

    const isReady = slot.type === 'ready';

    const season = Number(
      isReady
        ? episode.season_number || 1
        : episode.seasonNumber || 1
    );

    const number = Number(
      isReady
        ? episode.episode_number || 1
        : episode.episodeNumber || 1
    );

    if (isReady) {
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
        // Ready-Made stories have no 13-episode limit.
        slot.season = season;
        slot.episode = number + 1;
      }

      return;
    }

    // Serial stories use 13 episodes per season.
    if (number >= 13) {
      slot.season = season + 1;
      slot.episode = 1;
    } else {
      slot.season = season;
      slot.episode = number + 1;
    }
  }

  /* ---------- CONFIRM POST FROM NOTIFICATION ---------- */

  function confirmPostFromNotification(extra) {
    const slotName = extra?.slot;
    const episodeId = extra?.episodeId;

    if (
      !SLOT_NAMES.includes(slotName) ||
      episodeId == null
    ) {
      console.warn('Invalid post confirmation notification data.');
      return false;
    }

    const settings = readSettings();
    const pending = settings.pending;

    // Never mark a different episode as posted.
    if (
      !pending ||
      pending.stage !== 'episode-opened' ||
      pending.slot !== slotName ||
      String(pending.episodeId) !== String(episodeId)
    ) {
      console.warn('Notification does not match the active episode.');
      cancelPostConfirmation();
      return false;
    }

    const slot = settings.slots?.[slotName];

    if (!slot) return false;

    let episode = null;
    let marked = false;

    if (slot.type === 'ready') {
      episode = findReadyEpisode(episodeId);

      if (!episode) {
        console.warn('Ready-Made episode was not found.');
        return false;
      }

      marked = markReadyEpisodePosted(episodeId);

    } else {
      episode = findSerialEpisode(episodeId);

      if (!episode) {
        console.warn('Serial episode was not found.');
        return false;
      }

      marked = markSerialEpisodePosted(episodeId);
    }

    if (!marked) {
      console.error('Could not save the episode posting status.');
      return false;
    }

    const completedAt = new Date().toISOString();

    settings.completed = settings.completed || {};

    settings.completed[slotName] =
      Array.isArray(settings.completed[slotName])
        ? settings.completed[slotName]
        : [];

    const alreadyRecorded = settings.completed[slotName].some(
      record =>
        String(record.episodeId) === String(episodeId)
    );

    if (!alreadyRecorded) {
      settings.completed[slotName].push({
        episodeId,
        label:
          pending.episodeLabel ||
          extra.episodeLabel ||
          'Episode',
        title:
          slot.storyName ||
          extra.storyName ||
          '',
        completedAt,
        tracking: 'notification-confirmed-posted'
      });
    }

    settings.slotRuns = settings.slotRuns || {};
    settings.slotRuns[slotName] = dateKey(new Date());

    advanceQueuePosition(settings, slotName, episode);

    settings.pending = null;

    if (!writeSettings(settings)) {
      console.error('Could not save planner completion.');
      return false;
    }

    cancelPostConfirmation();

    try {
      document.dispatchEvent(
        new Event('planner:posts-updated')
      );
    } catch (error) {
      console.warn('Could not refresh planner display:', error);
    }

    console.log(
      'Episode marked posted from notification:',
      slotName,
      episodeId
    );

    return true;
  }

  /* ---------- NOTIFICATION BUTTON ACTIONS ---------- */

  async function handlePostNotificationAction(action) {
    const notification = action?.notification || {};
    const extra =
      notification.extra ||
      notification.data ||
      {};

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
        pending.lastConfirmationResponseAt =
          new Date().toISOString();

        writeSettings(settings);

        // Ask again five minutes later.
        await schedulePostConfirmation({
          slot: extra.slot,
          episodeId: extra.episodeId
        });

      } else {
        await cancelPostConfirmation();
      }
    }
  }

  /* ---------- ACTION LISTENER ---------- */

  async function setupPostActionListener() {
    if (actionListenerReady || !isAndroidApp()) return;

    const plugin = getPlugin();

    if (!plugin || typeof plugin.addListener !== 'function') {
      return;
    }

    try {
      await registerPostActions(plugin);

      await plugin.addListener(
        'localNotificationActionPerformed',
        handlePostNotificationAction
      );

      actionListenerReady = true;

    } catch (error) {
      console.error(
        'Could not attach notification action listener:',
        error
      );
    }
  }

  /* ---------- EXACT ALARM SETTINGS ---------- */

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

  /* ---------- DAILY SLOT REMINDERS ---------- */

  async function sync() {
    if (!isAndroidApp() || syncing) return;

    const plugin = getPlugin();

    if (!plugin) {
      console.warn('Local Notifications plugin unavailable.');
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
          'Exact alarm access is not enabled.'
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

          if (
            !scheduledDate ||
            scheduledDate <= new Date()
          ) {
            continue;
          }

          if (
            isCompleted(settings, slotName, scheduledDate)
          ) {
            continue;
          }

          const labels = {
            morning: '🌅 Morning posting time',
            lunch: '☀️ Lunch posting time',
            evening: '🌙 Evening posting time'
          };

          notifications.push({
            id: ID_BASE[slotName] + day,
            title: labels[slotName],
            body:
              'It is time to prepare ' +
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
        'Daily Android reminders synchronized:',
        notifications.length
      );

    } catch (error) {
      console.error('Android reminder sync failed:', error);

    } finally {
      syncing = false;
    }
  }

  /* ---------- CLEANUP ---------- */

  function monitorPostReminder() {
    const pending = readSettings().pending;

    if (
      !pending ||
      pending.stage !== 'episode-opened'
    ) {
      cancelPostConfirmation();
    }
  }

  function delayedSync() {
    window.setTimeout(sync, 700);
  }

  /* ---------- START ---------- */

  function init() {
    if (!isAndroidApp()) return;

    setupPostActionListener();

    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) {
          delayedSync();
          monitorPostReminder();
        }
      }
    );

    window.addEventListener('focus', () => {
      delayedSync();
      monitorPostReminder();
    });

    window.setInterval(monitorPostReminder, 5000);
  }

  document.addEventListener('DOMContentLoaded', () => {
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

  /* ---------- PUBLIC API ---------- */

  window.StoriesAndroidReminders = {
    sync,
    requestExactAlarmAccess,

    checkExactAlarmPermission: async function () {
      const plugin = getPlugin();

      if (!plugin || !isAndroidApp()) return false;

      return checkExactAlarmPermission(plugin);
    },

    schedulePostConfirmation,
    cancelPostConfirmation
  };

})();
