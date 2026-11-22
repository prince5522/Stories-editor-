
(function () {
'use strict';

const KEY = 'storySlotPlannerV1';
const $ = id => document.getElementById(id);
const SLOT_NAMES = ['morning', 'lunch', 'evening'];

const SLOT_LABELS = {
  morning: '🌅 Morning',
  lunch: '☀️ Lunch',
  evening: '🌙 Evening'
};

let settings = {};
let refreshTimer = null;

function store() {
  return window.StudioStore;
}

function read(key, fallback) {
  try {
    return store() ? store().get(key, fallback) : fallback;
  } catch (error) {
    console.warn('Progress storage error:', error);
    return fallback;
  }
}

function readSettings() {
  const value = read(KEY, {});
  return value && typeof value === 'object' ? value : {};
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function normalName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function uniqueById(items) {
  const found = new Map();
  items.forEach(item => {
    if (item && item.id != null) found.set(String(item.id), item);
  });
  return [...found.values()];
}

/* EPISODE COLLECTIONS */

function getEpisodes(slot) {
  if (!slot || !slot.storyName) return [];

  if (slot.type === 'ready') {
    const items = read('readyMadeEpisodes', []);
    if (!Array.isArray(items)) return [];

    return uniqueById(items.filter(ep => {
      const name = ep.story_title || ep.storyName || ep.title || 'Ready-made episodes';
      return normalName(name) === normalName(slot.storyName);
    })).sort((a, b) =>
      Number(a.season_number || 1) - Number(b.season_number || 1) ||
      Number(a.episode_number || 1) - Number(b.episode_number || 1)
    );
  }

  const items = read('episodes', []);
  if (!Array.isArray(items)) return [];

  return uniqueById(items.filter(ep => {
    const name = ep.storyTitle || ep.seasonTitle || '';
    return !ep.archived && normalName(name) === normalName(slot.storyName);
  })).sort((a, b) =>
    Number(a.seasonNumber || 1) - Number(b.seasonNumber || 1) ||
    Number(a.episodeNumber || 1) - Number(b.episodeNumber || 1)
  );
}

/* COMPLETION RECORDS */

function getCompletedRecords(slotName) {
  const records = settings.completed?.[slotName];
  return Array.isArray(records) ? records : [];
}

function getEpisodeId(ep) {
  return ep && ep.id != null ? String(ep.id) : '';
}

function getCompletionIds(slotName) {
  const ids = new Set();

  getCompletedRecords(slotName).forEach(record => {
    if (record && record.episodeId != null) {
      ids.add(String(record.episodeId));
    }
  });

  return ids;
}

function isReadyPosted(ep) {
  return String(ep.status || '').toLowerCase() === 'posted';
}

/* STARTING POSITION */

function getEpisodePosition(ep, type) {
  return {
    season: Number(type === 'ready'
      ? ep.season_number || 1
      : ep.seasonNumber || 1),
    episode: Number(type === 'ready'
      ? ep.episode_number || 1
      : ep.episodeNumber || 1)
  };
}

function getSlotPosition(slot) {
  return {
    season: Math.max(1, Number(slot.season || 1)),
    episode: Math.max(1, Number(slot.episode || 1))
  };
}

function isBeforeStartingPosition(ep, slot) {
  const current = getEpisodePosition(ep, slot.type);
  const start = getSlotPosition(slot);

  return current.season < start.season ||
    (current.season === start.season && current.episode < start.episode);
}

/* PROGRESS CALCULATION */

function calculateProgress(slotName) {
  const slot = settings.slots?.[slotName];

  if (!slot || !slot.storyName) {
    return {
      configured: false,
      total: 0,
      completed: 0,
      remaining: 0,
      percentage: 0,
      episodes: [],
      previousCount: 0
    };
  }

  // Include ALL available episodes, including those before the start.
  const episodes = getEpisodes(slot);
  const completionIds = getCompletionIds(slotName);
  const completedIds = new Set();

  let previousCount = 0;

  episodes.forEach(ep => {
    const id = getEpisodeId(ep);
    if (!id) return;

    // Episodes before the selected starting episode form the baseline.
    // They count as previously posted but no fake history is created.
    if (isBeforeStartingPosition(ep, slot)) {
      completedIds.add(id);
      previousCount++;
    }

    // Existing Ready-Made posted statuses remain completed.
    if (slot.type === 'ready' && isReadyPosted(ep)) {
      completedIds.add(id);
    }

    // Preserve genuine posting confirmation records.
    if (completionIds.has(id)) {
      completedIds.add(id);
    }
  });

  const total = episodes.length;
  const completed = Math.min(total, completedIds.size);
  const remaining = Math.max(0, total - completed);
  const percentage = total
    ? Math.round((completed / total) * 100)
    : 0;

  return {
    configured: true,
    total,
    completed,
    remaining,
    percentage,
    episodes,
    completedIds,
    previousCount
  };
}

/* DISPLAY */

function ensureProgressSection() {
  let section = $('plannerProgressSection');
  if (section) return section;

  section = document.createElement('section');
  section.id = 'plannerProgressSection';
  section.className = 'section-block panel';

  section.innerHTML = `
    <details class="planner-folder" id="postingProgressFolder">
      <summary>
        <span>📊 Posting Progress</span>
        <span class="small muted">Morning · Lunch · Evening</span>
      </summary>
      <div class="planner-folder-content">
        <p class="small muted">Track completed and remaining episodes in each queue.</p>
        <div id="plannerProgressCards" class="stack-list"></div>
      </div>
    </details>
  `;

  const setup = $('plannerSetupStatus');

  if (setup?.closest('.section-block')) {
    setup.closest('.section-block').after(section);
  } else {
    const main = document.querySelector('main');
    if (main) main.appendChild(section);
    else document.body.appendChild(section);
  }

  return section;
}

function renderProgressCard(slotName) {
  const slot = settings.slots?.[slotName];
  const progress = calculateProgress(slotName);
  const label = SLOT_LABELS[slotName];

  if (!progress.configured) {
    return `
      <details class="planner-folder planner-queue-folder" id="${slotName}ProgressFolder">
        <summary>${label} Progress</summary>
        <div class="planner-folder-content">
          <article class="list-item">
            <div class="section-heading">
              <h3>${label}</h3>
              <span class="pill">Not configured</span>
            </div>
            <p class="small muted">Choose a story and save this queue to track progress.</p>
          </article>
        </div>
      </details>
    `;
  }

  const percent = progress.percentage;
  const status = progress.total === 0
    ? 'No episodes uploaded'
    : progress.remaining === 0
      ? 'All available episodes completed'
      : `${progress.remaining} episodes remaining`;

  const progressType = slot.type === 'ready' ? 'Ready-Made' : 'Serial story';

  return `
    <details class="planner-folder planner-queue-folder" id="${slotName}ProgressFolder">
      <summary>${label} Progress</summary>
      <div class="planner-folder-content">
        <article class="list-item">
          <div class="section-heading">
            <h3>${label}</h3>
            <span class="pill">${percent}%</span>
          </div>

          <p class="small muted">${escapeHTML(slot.storyName)}</p>
          <p class="small muted">${progressType}</p>

          <div
            role="progressbar"
            aria-label="${escapeHTML(slot.storyName)} progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${percent}"
            style="width:100%;height:10px;overflow:hidden;border-radius:20px;background:var(--surface-2,rgba(127,127,127,.18));margin:12px 0;"
          >
            <div style="width:${percent}%;height:100%;border-radius:20px;background:var(--accent,var(--primary,#16a34a));transition:width .3s ease;"></div>
          </div>

          <div class="section-heading">
            <span class="small">✅ Completed: <strong>${progress.completed}</strong></span>
            <span class="small">⏳ Remaining: <strong>${progress.remaining}</strong></span>
          </div>

          <p class="small muted">Total episodes: ${progress.total}</p>

          ${progress.previousCount > 0 ? `
            <p class="small muted">
              ⏮️ Previously posted before starting episode: ${progress.previousCount}
            </p>
          ` : ''}

          <p class="small muted">${escapeHTML(status)}</p>
        </article>
      </div>
    </details>
  `;
}

function renderProgress() {
  ensureProgressSection();

  const target = $('plannerProgressCards');
  if (!target) return;

  const openFolders = new Set(
    [...target.querySelectorAll('details[open]')].map(folder => folder.id)
  );

  target.innerHTML = SLOT_NAMES.map(renderProgressCard).join('');

  openFolders.forEach(id => {
    const folder = $(id);
    if (folder) folder.open = true;
  });
}

/* POSTING HISTORY */

function getHistoryEntries() {
  const entries = [];

  SLOT_NAMES.forEach(slotName => {
    getCompletedRecords(slotName).forEach(record => {
      if (!record) return;
      entries.push({ ...record, slotName });
    });
  });

  const unique = new Map();

  entries.forEach(entry => {
    const episodeId = entry.episodeId != null ? String(entry.episodeId) : '';
    const key = episodeId
      ? `${entry.slotName}:${episodeId}`
      : `${entry.slotName}:${entry.completedAt || entry.date || entry.label}`;

    const old = unique.get(key);
    const currentTime = new Date(entry.completedAt || entry.date || 0).getTime();
    const oldTime = old
      ? new Date(old.completedAt || old.date || 0).getTime()
      : -1;

    if (!old || currentTime >= oldTime) unique.set(key, entry);
  });

  return [...unique.values()].sort((a, b) =>
    new Date(b.completedAt || b.date || 0).getTime() -
    new Date(a.completedAt || a.date || 0).getTime()
  );
}

function formatDate(value) {
  if (!value) return 'Date not recorded';

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleString();
}

function renderHistoryEntry(entry) {
  const label = SLOT_LABELS[entry.slotName] || entry.slotName;
  const title = entry.title ||
    settings.slots?.[entry.slotName]?.storyName ||
    'Story episode';
  const episode = entry.label || 'Episode completed';
  const date = formatDate(entry.completedAt || entry.date || entry.timestamp);

  return `
    <article class="list-item">
      <div class="section-heading">
        <strong>${escapeHTML(title)}</strong>
        <span class="pill">${escapeHTML(label)}</span>
      </div>
      <p class="small">✅ ${escapeHTML(episode)}</p>
      <p class="small muted">${escapeHTML(date)}</p>
    </article>
  `;
}

function ensureHistorySection() {
  let section = $('plannerHistorySection');
  if (section) return section;

  section = document.createElement('section');
  section.id = 'plannerHistorySection';
  section.className = 'section-block panel';

  section.innerHTML = `
    <details class="planner-folder" id="postingHistoryFolder">
      <summary>
        <span>🗂️ Posting History</span>
        <span class="small muted">All recorded posts</span>
      </summary>
      <div class="planner-folder-content">
        <p class="small muted">Your recorded posting activity across all three queues.</p>
        <div id="plannerHistoryList" class="stack-list"></div>
      </div>
    </details>
  `;

  const progress = $('plannerProgressSection');

  if (progress) progress.after(section);
  else {
    const main = document.querySelector('main');
    if (main) main.appendChild(section);
  }

  return section;
}

function renderHistory() {
  ensureHistorySection();

  const target = $('plannerHistoryList');
  if (!target) return;

  const entries = getHistoryEntries();

  if (!entries.length) {
    target.innerHTML = `
      <div class="planner-empty">
        <p>No completed posts recorded yet.</p>
        <p class="small muted">Your posting history will appear here after the Planner records completed episodes.</p>
      </div>
    `;
    return;
  }

  target.innerHTML = entries.slice(0, 100).map(renderHistoryEntry).join('');
}

/* REFRESH */

function render() {
  settings = readSettings();

  if (!settings.slots) settings.slots = {};
  if (!settings.completed) settings.completed = {};

  renderProgress();
  renderHistory();
}

function scheduleRefresh() {
  if (refreshTimer) window.clearTimeout(refreshTimer);

  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    render();
  }, 100);
}

/* EVENTS */

function bindEvents() {
  document.addEventListener('planner:posts-updated', scheduleRefresh);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleRefresh();
  });

  window.addEventListener('focus', scheduleRefresh);
  window.addEventListener('pageshow', scheduleRefresh);
  window.addEventListener('storage', scheduleRefresh);

  document.addEventListener('click', event => {
    const button = event.target.closest(
      '#saveAllPlannerSlots, #savePlannerSettings'
    );
    if (button) scheduleRefresh();
  });
}

/* START */

function init() {
  if (!store()) {
    console.warn('Planner progress waiting for StudioStore.');
    return;
  }

  render();
  bindEvents();

  window.setInterval(() => {
    if (!document.hidden) render();
  }, 15000);

  console.log('Planner progress with previous-episode baseline loaded.');
}

document.addEventListener('DOMContentLoaded', init);

})();
