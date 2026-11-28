
/* =========================================================
   STORIES EDITOR — CENTRAL LIBRARY
   Version 4.0 — RESTORED STORY ACTION BUTTONS
   Actions: Read, Split, Continue, Edit, Delete
========================================================= */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const store = () => window.StudioStore;

  const read = key => {
    try {
      const value = store()?.get(key, []);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.error('Library read error:', key, error);
      return [];
    }
  };

/* =========================================================
   STORIES EDITOR — CENTRAL LIBRARY
   Version 4.1 — COMPLETE STORY ACTIONS
   Read · Split · Continue · Edit · Delete
========================================================= */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const store = () => window.StudioStore;

  const read = key => {
    try {
      const value = store()?.get(key, []);
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.error('Library read error:', key, error);
      return [];
    }
  };

  const escapeHTML = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  const normalize = value =>
    String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');

  const serialTitle = item =>
    String(item.storyTitle || item.seasonTitle || item.title || 'Untitled story').trim();

  const readyTitle = item =>
    String(item.story_title || item.storyName || 'Ready-made stories').trim();

  const seasonNumber = item =>
    Math.max(1, Number(item.seasonNumber || item.season_number) || 1);

  const episodeNumber = item =>
    Math.max(1, Number(item.episodeNumber || item.episode_number) || 1);

  const serialContent = item =>
    String(item.content ?? item.episode_text ?? item.episodeText ?? item.text ?? '');

  const readyContent = item =>
    String(item.episode_text ?? item.episodeText ?? item.content ?? item.text ?? '');

  const episodeTitle = item =>
    String(item.title || item.episode_name || item.episodeName ||
      `Episode ${episodeNumber(item)}`);

  let activeTab = 'serial';
  let searchTerm = '';
  let collections = { serial: [], ready: [] };
  let refreshQueued = false;

  function toast(message) {
    if (typeof window.studioToast === 'function') {
      window.studioToast(message);
    } else {
      console.info(message);
    }
  }

  function addToGroup(map, title, number) {
    const key = normalize(title) || 'untitledstory';

    if (!map.has(key)) {
      map.set(key, { title: title || 'Untitled story', seasons: new Map() });
    }

    const group = map.get(key);
    const season = Math.max(1, Number(number) || 1);

    if (!group.seasons.has(season)) {
      group.seasons.set(season, {
        number: season,
        manuscripts: [],
        episodes: []
      });
    }

    return group.seasons.get(season);
  }

  function finishGroups(groups) {
    return [...groups.values()]
      .map(group => {
        group.seasons = [...group.seasons.values()]
          .sort((a, b) => a.number - b.number);

        group.seasons.forEach(season => {
          season.episodes.sort((a, b) =>
            episodeNumber(a) - episodeNumber(b)
          );
        });

        return group;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function buildSerialCollection() {
    const groups = new Map();

    read('stories').forEach(story => {
      const folder = addToGroup(
        groups,
        String(story.title || 'Untitled story').trim(),
        seasonNumber(story)
      );

      folder.manuscripts.push(story);
    });

    read('episodes').forEach(episode => {
      if (episode.archived) return;

      const folder = addToGroup(
        groups,
        serialTitle(episode),
        seasonNumber(episode)
      );

      folder.episodes.push(episode);
    });

    return finishGroups(groups);
  }

  function buildReadyCollection() {
    const groups = new Map();

    read('readyMadeEpisodes').forEach(episode => {
      const folder = addToGroup(
        groups,
        readyTitle(episode),
        seasonNumber(episode)
      );

      folder.episodes.push(episode);
    });

    return finishGroups(groups);
  }

  function countEpisodes(group) {
    return group.seasons.reduce(
      (total, season) => total + season.episodes.length,
      0
    );
  }

  function matchesSearch(value) {
    if (!searchTerm) return true;
    return String(value || '').toLowerCase().includes(searchTerm.toLowerCase());
  }

  function groupMatches(group) {
    if (!searchTerm) return true;
    if (matchesSearch(group.title)) return true;

    return group.seasons.some(season => {
      if (matchesSearch(`season ${season.number}`)) return true;

      const manuscriptMatch = season.manuscripts.some(story =>
        [story.title, story.genre, story.description, story.content]
          .some(matchesSearch)
      );

      if (manuscriptMatch) return true;

      return season.episodes.some(episode =>
        [
          episodeTitle(episode),
          serialContent(episode),
          readyContent(episode),
          episode.episode_subtitle,
          episode.status,
          episode.storyTitle,
          episode.story_title
        ].some(matchesSearch)
      );
    });
  }

  function renderManuscript(story) {
    const content = String(story.content || '');
    if (!content.trim()) return '';

    const words = content.trim().split(/\s+/).length;
    const id = escapeHTML(story.id ?? '');

    return `
      <article class="library-episode">
        <h3>📖 Original season manuscript</h3>

        <p>
          ${escapeHTML(story.genre || 'General')}
          · Season ${seasonNumber(story)}
          · ${words.toLocaleString()} words
        </p>

        <div class="library-episode-actions">
          <button type="button"
            data-library-action="read"
            data-story-id="${id}">
            📖 Read Season
          </button>

          <button type="button"
            data-library-action="split"
            data-story-id="${id}">
            ✂ Split into Episodes
          </button>

          <button type="button"
            data-library-action="continue"
            data-story-id="${id}">
            ➕ Continue Story
          </button>

          <button type="button"
            data-library-action="edit"
            data-story-id="${id}">
            ✏️ Edit Details
          </button>

          <button type="button"
            data-library-action="delete"
            data-story-id="${id}">
            🗑️ Delete
          </button>
        </div>
      </article>
    `;
  }

  function renderEpisode(episode, type) {
    const content = type === 'ready'
      ? readyContent(episode)
      : serialContent(episode);

    const number = episodeNumber(episode);
    const title = episodeTitle(episode);
    const words = content.trim()
      ? content.trim().split(/\s+/).length
      : 0;

    const status = type === 'ready'
      ? String(episode.status || 'draft')
      : 'saved';

    return `
      <article class="library-episode">
        <h3>🎬 Episode ${number} · ${escapeHTML(title)}</h3>

        <p>${words.toLocaleString()} words · ${escapeHTML(status)}</p>

        ${episode.episode_subtitle
          ? `<p>${escapeHTML(episode.episode_subtitle)}</p>`
          : ''}

        <p>
          ${escapeHTML(content.slice(0, 210))}
          ${content.length > 210 ? '…' : ''}
        </p>

        <div class="library-episode-actions">
          <button type="button"
            data-library-read="${type}"
            data-episode-id="${escapeHTML(episode.id ?? '')}">
            Read episode
          </button>
        </div>
      </article>
    `;
  }

  function renderSeason(season, type) {
    const manuscripts = season.manuscripts.map(renderManuscript).join('');

    const episodes = season.episodes
      .map(episode => renderEpisode(episode, type))
      .join('');

    const total = season.episodes.length;

    return `
      <details class="library-season">
        <summary>
          📂 Season ${season.number}
          <span class="small muted">
            ${total} episode${total === 1 ? '' : 's'}
            ${season.manuscripts.length ? ' · Manuscript saved' : ''}
          </span>
        </summary>

        <div class="folder-content">
          ${manuscripts}
          ${episodes}
          ${!manuscripts && !episodes
            ? '<div class="library-empty">No content saved in this season yet.</div>'
            : ''}
        </div>
      </details>
    `;
  }

  function renderGroups(groups, type) {
    const visible = groups.filter(groupMatches);

    if (!visible.length) {
      return `
        <div class="library-empty">
          ${searchTerm
            ? 'No stories or episodes match your search.'
            : 'Nothing has been saved here yet. Your existing stories will appear here automatically.'}
        </div>
      `;
    }

    return visible.map(group => {
      const count = countEpisodes(group);

      const seasonHTML = group.seasons
        .map(season => renderSeason(season, type))
        .join('');

      return `
        <details class="library-folder">
          <summary>
            <span class="folder-icon">${type === 'ready' ? '✍' : '📚'}</span>

            <span class="folder-heading">
              <strong>${escapeHTML(group.title)}</strong>
              <small>
                ${group.seasons.length}
                season${group.seasons.length === 1 ? '' : 's'}
                · ${count}
                episode${count === 1 ? '' : 's'}
              </small>
            </span>
          </summary>

          <div class="folder-content">${seasonHTML}</div>
        </details>
      `;
    }).join('');
  }

  function renderStats() {
    const serialEpisodes = read('episodes')
      .filter(episode => !episode.archived);

    const readyEpisodes = read('readyMadeEpisodes');

    const serialGroups = collections.serial.length;
    const readyGroups = collections.ready.length;

    $('librarySerialCount').textContent = serialGroups;
    $('libraryReadyCount').textContent = readyGroups;
    $('libraryEpisodeCount').textContent =
      serialEpisodes.length + readyEpisodes.length;

    $('serialSectionCount').textContent =
      `${serialGroups} stor${serialGroups === 1 ? 'y' : 'ies'}`;

    $('readySectionCount').textContent =
      `${readyGroups} stor${readyGroups === 1 ? 'y' : 'ies'}`;
  }

  function render() {
    if (!$('serialFolders')) return;

    collections.serial = buildSerialCollection();
    collections.ready = buildReadyCollection();

    renderStats();

    $('serialFolders').innerHTML =
      renderGroups(collections.serial, 'serial');

    $('readyFolders').innerHTML =
      renderGroups(collections.ready, 'ready');

    $('serialSection').hidden = activeTab !== 'serial';
    $('readySection').hidden = activeTab !== 'ready';

    $('serialTab').classList.toggle('active', activeTab === 'serial');
    $('readyTab').classList.toggle('active', activeTab === 'ready');

    $('serialTab').setAttribute('aria-selected', String(activeTab === 'serial'));
    $('readyTab').setAttribute('aria-selected', String(activeTab === 'ready'));
  }

  function showReader(title, meta, content) {
    if (!String(content || '').trim()) {
      toast('There is no readable text in this item.');
      return;
    }

    $('libraryReaderTitle').textContent = title;
    $('libraryReaderMeta').textContent = meta;
    $('libraryReaderContent').textContent = content;
    $('libraryReader').hidden = false;

    $('libraryReader').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  function findById(items, id) {
    return items.find(item => String(item.id) === String(id));
  }

  function handleStoryAction(event) {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;

    const action = button.dataset.libraryAction;
    const id = button.dataset.storyId;
    const story = findById(read('stories'), id);

    if (!story) {
      toast('This saved story could not be found.');
      return;
    }

    if (action === 'read') {
      showReader(
        story.title || 'Story manuscript',
        `Season ${seasonNumber(story)} · ${story.genre || 'General'}`,
        story.content || ''
      );
      return;
    }

    if (action === 'split') {
      const url = new URL('./episodes.html', window.location.href);
      url.searchParams.set('story', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'continue') {
      const url = new URL('./stories.html', window.location.href);
      url.searchParams.set('continueStory', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'edit') {
      const url = new URL('./stories.html', window.location.href);
      url.searchParams.set('editStory', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'delete') {
      const url = new URL('./stories.html', window.location.href);
      url.searchParams.set('deleteStory', String(story.id));
      window.location.href = url.toString();
    }
  }

  function handleReadClick(event) {
    const button = event.target.closest('[data-library-read]');
    if (!button) return;

    const type = button.dataset.libraryRead;

    if (type === 'serial') {
      const episode = findById(read('episodes'), button.dataset.episodeId);

      if (!episode) {
        toast('This episode could not be found in storage.');
        return;
      }

      showReader(
        episodeTitle(episode),
        `${serialTitle(episode)} · Season ${seasonNumber(episode)} · Episode ${episodeNumber(episode)}`,
        serialContent(episode)
      );
      return;
    }

    if (type === 'ready') {
      const episode = findById(
        read('readyMadeEpisodes'),
        button.dataset.episodeId
      );

      if (!episode) {
        toast('This ready-made episode could not be found in storage.');
        return;
      }

      showReader(
        episodeTitle(episode),
        `${readyTitle(episode)} · Season ${seasonNumber(episode)} · Episode ${episodeNumber(episode)}`,
        readyContent(episode)
      );
    }
  }

  function switchTab(tab) {
    if (tab !== 'serial' && tab !== 'ready') return;
    activeTab = tab;
    render();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;

    requestAnimationFrame(() => {
      refreshQueued = false;
      render();
    });
  }

  function init() {
    if (!window.StudioStore) {
      console.error('Library: StudioStore is not available.');
      toast('Storage is not ready. Please reload the Library.');
      return;
    }

    $('serialTab').addEventListener('click', () => switchTab('serial'));
    $('readyTab').addEventListener('click', () => switchTab('ready'));

    $('librarySearch').addEventListener('input', event => {
      searchTerm = String(event.target.value || '').trim();
      render();
    });

    $('serialFolders').addEventListener('click', event => {
      handleStoryAction(event);
      handleReadClick(event);
    });

    $('readyFolders').addEventListener('click', handleReadClick);

    $('libraryCloseReader').addEventListener('click', () => {
      $('libraryReader').hidden = true;
    });

    window.addEventListener('pageshow', render);
    window.addEventListener('focus', render);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) render();
    });

    window.addEventListener('channelstudio:store-changed', event => {
      const key = event.detail?.key;

      if (!key || ['stories', 'episodes', 'readyMadeEpisodes'].includes(key)) {
        queueRefresh();
      }
    });

    render();
  }

  async function start() {
    try {
      if (window.ChannelStudioCloud?.ready) {
        await window.ChannelStudioCloud.ready;
      }

      if (window.StudioStore?.ready) {
        await window.StudioStore.ready;
      }
    } catch (error) {
      console.warn('Library startup recovery warning:', error);
    }

    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

  const save = (key, value) => {
    const db = store();

    if (!db || typeof db.set !== 'function') {
      throw new Error('Storage is not available. Your data was not changed.');
    }

    db.set(key, value);
  };

  const escapeHTML = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));

  const normalize = value =>
    String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');

  const serialTitle = item =>
    String(item.storyTitle || item.seasonTitle || item.title || 'Untitled story').trim();

  const readyTitle = item =>
    String(item.story_title || item.storyName || 'Ready-made stories').trim();

  const seasonNumber = item =>
    Math.max(1, Number(item.seasonNumber || item.season_number) || 1);

  const episodeNumber = item =>
    Math.max(1, Number(item.episodeNumber || item.episode_number) || 1);

  const serialContent = item =>
    String(item.content ?? item.episode_text ?? item.episodeText ?? item.text ?? '');

  const readyContent = item =>
    String(item.episode_text ?? item.episodeText ?? item.content ?? item.text ?? '');

  const episodeTitle = item =>
    String(item.title || item.episode_name || item.episodeName ||
      `Episode ${episodeNumber(item)}`);

  let activeTab = 'serial';
  let searchTerm = '';
  let collections = { serial: [], ready: [] };
  let refreshQueued = false;

  function toast(message) {
    if (typeof window.studioToast === 'function') {
      window.studioToast(message);
    } else {
      console.info(message);
    }
  }

  function addToGroup(map, title, number) {
    const key = normalize(title) || 'untitledstory';

    if (!map.has(key)) {
      map.set(key, { title: title || 'Untitled story', seasons: new Map() });
    }

    const group = map.get(key);
    const season = Math.max(1, Number(number) || 1);

    if (!group.seasons.has(season)) {
      group.seasons.set(season, {
        number: season,
        manuscripts: [],
        episodes: []
      });
    }

    return group.seasons.get(season);
  }

  function finishGroups(groups) {
    return [...groups.values()]
      .map(group => {
        group.seasons = [...group.seasons.values()]
          .sort((a, b) => a.number - b.number);

        group.seasons.forEach(season => {
          season.episodes.sort((a, b) =>
            episodeNumber(a) - episodeNumber(b)
          );
        });

        return group;
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  function buildSerialCollection() {
    const groups = new Map();

    read('stories').forEach(story => {
      const folder = addToGroup(
        groups,
        String(story.title || 'Untitled story').trim(),
        seasonNumber(story)
      );

      folder.manuscripts.push(story);
    });

    read('episodes').forEach(episode => {
      if (episode.archived) return;

      const folder = addToGroup(
        groups,
        serialTitle(episode),
        seasonNumber(episode)
      );

      folder.episodes.push(episode);
    });

    return finishGroups(groups);
  }

  function buildReadyCollection() {
    const groups = new Map();

    read('readyMadeEpisodes').forEach(episode => {
      const folder = addToGroup(
        groups,
        readyTitle(episode),
        seasonNumber(episode)
      );

      folder.episodes.push(episode);
    });

    return finishGroups(groups);
  }

  function countEpisodes(group) {
    return group.seasons.reduce(
      (total, season) => total + season.episodes.length,
      0
    );
  }

  function matchesSearch(value) {
    if (!searchTerm) return true;
    return String(value || '').toLowerCase().includes(searchTerm.toLowerCase());
  }

  function groupMatches(group) {
    if (!searchTerm) return true;
    if (matchesSearch(group.title)) return true;

    return group.seasons.some(season => {
      if (matchesSearch(`season ${season.number}`)) return true;

      const manuscriptMatch = season.manuscripts.some(story =>
        [story.title, story.genre, story.description, story.content]
          .some(matchesSearch)
      );

      if (manuscriptMatch) return true;

      return season.episodes.some(episode =>
        [
          episodeTitle(episode),
          serialContent(episode),
          readyContent(episode),
          episode.episode_subtitle,
          episode.status,
          episode.storyTitle,
          episode.story_title
        ].some(matchesSearch)
      );
    });
  }

  function renderManuscript(story) {
    const content = String(story.content || '');
    if (!content.trim()) return '';

    const words = content.trim().split(/\s+/).length;
    const id = escapeHTML(story.id ?? '');

    return `
      <article class="library-episode">
        <h3>📖 Original season manuscript</h3>

        <p>
          ${escapeHTML(story.genre || 'General')}
          · Season ${seasonNumber(story)}
          · ${words.toLocaleString()} words
        </p>

        <div class="library-episode-actions">
          <button type="button"
            data-library-action="read"
            data-story-id="${id}">
            📖 Read Season
          </button>

          <button type="button"
            data-library-action="split"
            data-story-id="${id}">
            ✂ Split into Episodes
          </button>

          <button type="button"
            data-library-action="continue"
            data-story-id="${id}">
            ➕ Continue Story
          </button>

          <button type="button"
            data-library-action="edit"
            data-story-id="${id}">
            ✏️ Edit Details
          </button>

          <button type="button"
            data-library-action="delete"
            data-story-id="${id}">
            🗑️ Delete
          </button>
        </div>
      </article>
    `;
  }

  function renderEpisode(episode, type) {
    const content = type === 'ready'
      ? readyContent(episode)
      : serialContent(episode);

    const number = episodeNumber(episode);
    const title = episodeTitle(episode);
    const words = content.trim()
      ? content.trim().split(/\s+/).length
      : 0;

    const status = type === 'ready'
      ? String(episode.status || 'draft')
      : 'saved';

    return `
      <article class="library-episode">
        <h3>🎬 Episode ${number} · ${escapeHTML(title)}</h3>

        <p>${words.toLocaleString()} words · ${escapeHTML(status)}</p>

        ${episode.episode_subtitle
          ? `<p>${escapeHTML(episode.episode_subtitle)}</p>`
          : ''}

        <p>
          ${escapeHTML(content.slice(0, 210))}
          ${content.length > 210 ? '…' : ''}
        </p>

        <div class="library-episode-actions">
          <button type="button"
            data-library-read="${type}"
            data-episode-id="${escapeHTML(episode.id ?? '')}">
            Read episode
          </button>
        </div>
      </article>
    `;
  }

  function renderSeason(season, type) {
    const manuscripts = season.manuscripts.map(renderManuscript).join('');

    const episodes = season.episodes
      .map(episode => renderEpisode(episode, type))
      .join('');

    const total = season.episodes.length;

    return `
      <details class="library-season">
        <summary>
          📂 Season ${season.number}
          <span class="small muted">
            ${total} episode${total === 1 ? '' : 's'}
            ${season.manuscripts.length ? ' · Manuscript saved' : ''}
          </span>
        </summary>

        <div class="folder-content">
          ${manuscripts}
          ${episodes}
          ${!manuscripts && !episodes
            ? '<div class="library-empty">No content saved in this season yet.</div>'
            : ''}
        </div>
      </details>
    `;
  }

  function renderGroups(groups, type) {
    const visible = groups.filter(groupMatches);

    if (!visible.length) {
      return `
        <div class="library-empty">
          ${searchTerm
            ? 'No stories or episodes match your search.'
            : 'Nothing has been saved here yet. Your existing stories will appear here automatically.'}
        </div>
      `;
    }

    return visible.map(group => {
      const count = countEpisodes(group);

      const seasonHTML = group.seasons
        .map(season => renderSeason(season, type))
        .join('');

      return `
        <details class="library-folder">
          <summary>
            <span class="folder-icon">${type === 'ready' ? '✍' : '📚'}</span>

            <span class="folder-heading">
              <strong>${escapeHTML(group.title)}</strong>
              <small>
                ${group.seasons.length}
                season${group.seasons.length === 1 ? '' : 's'}
                · ${count}
                episode${count === 1 ? '' : 's'}
              </small>
            </span>
          </summary>

          <div class="folder-content">${seasonHTML}</div>
        </details>
      `;
    }).join('');
  }

  function renderStats() {
    const serialEpisodes = read('episodes')
      .filter(episode => !episode.archived);

    const readyEpisodes = read('readyMadeEpisodes');

    const serialGroups = collections.serial.length;
    const readyGroups = collections.ready.length;

    $('librarySerialCount').textContent = serialGroups;
    $('libraryReadyCount').textContent = readyGroups;
    $('libraryEpisodeCount').textContent =
      serialEpisodes.length + readyEpisodes.length;

    $('serialSectionCount').textContent =
      `${serialGroups} stor${serialGroups === 1 ? 'y' : 'ies'}`;

    $('readySectionCount').textContent =
      `${readyGroups} stor${readyGroups === 1 ? 'y' : 'ies'}`;
  }

  function render() {
    if (!$('serialFolders')) return;

    collections.serial = buildSerialCollection();
    collections.ready = buildReadyCollection();

    renderStats();

    $('serialFolders').innerHTML =
      renderGroups(collections.serial, 'serial');

    $('readyFolders').innerHTML =
      renderGroups(collections.ready, 'ready');

    $('serialSection').hidden = activeTab !== 'serial';
    $('readySection').hidden = activeTab !== 'ready';

    $('serialTab').classList.toggle('active', activeTab === 'serial');
    $('readyTab').classList.toggle('active', activeTab === 'ready');

    $('serialTab').setAttribute('aria-selected', String(activeTab === 'serial'));
    $('readyTab').setAttribute('aria-selected', String(activeTab === 'ready'));
  }

  function showReader(title, meta, content) {
    if (!String(content || '').trim()) {
      toast('There is no readable text in this item.');
      return;
    }

    $('libraryReaderTitle').textContent = title;
    $('libraryReaderMeta').textContent = meta;
    $('libraryReaderContent').textContent = content;
    $('libraryReader').hidden = false;

    $('libraryReader').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  function findById(items, id) {
    return items.find(item => String(item.id) === String(id));
  }

  function handleStoryAction(event) {
    const button = event.target.closest('[data-library-action]');
    if (!button) return;

    const action = button.dataset.libraryAction;
    const id = button.dataset.storyId;
    const story = findById(read('stories'), id);

    if (!story) {
      toast('This saved story could not be found.');
      return;
    }

    if (action === 'read') {
      showReader(
        story.title || 'Story manuscript',
        `Season ${seasonNumber(story)} · ${story.genre || 'General'}`,
        story.content || ''
      );
      return;
    }

    if (action === 'split') {
      const url = new URL('./episodes.html', window.location.href);
      url.searchParams.set('story', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'continue') {
      const url = new URL('./stories.html', window.location.href);
      url.searchParams.set('continueStory', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'edit') {
      const url = new URL('./stories.html', window.location.href);
      url.searchParams.set('editStory', String(story.id));
      window.location.href = url.toString();
      return;
    }

    if (action === 'delete') {
      const confirmed = window.confirm(
        `Delete "${story.title || 'this season'}"?\n\nOnly this saved manuscript will be deleted. Its existing episodes will be kept.`
      );

      if (!confirmed) return;

      try {
        const updatedStories = read('stories').filter(item =>
          String(item.id) !== String(story.id)
        );

        save('stories', updatedStories);
        toast('Manuscript deleted. Existing episodes have been kept.');
        render();
      } catch (error) {
        console.error('Library delete error:', error);
        toast(error.message || 'The manuscript could not be deleted.');
      }
    }
  }

  function handleReadClick(event) {
    const button = event.target.closest('[data-library-read]');
    if (!button) return;

    const type = button.dataset.libraryRead;

    if (type === 'serial') {
      const episode = findById(read('episodes'), button.dataset.episodeId);

      if (!episode) {
        toast('This episode could not be found in storage.');
        return;
      }

      showReader(
        episodeTitle(episode),
        `${serialTitle(episode)} · Season ${seasonNumber(episode)} · Episode ${episodeNumber(episode)}`,
        serialContent(episode)
      );
      return;
    }

    if (type === 'ready') {
      const episode = findById(
        read('readyMadeEpisodes'),
        button.dataset.episodeId
      );

      if (!episode) {
        toast('This ready-made episode could not be found in storage.');
        return;
      }

      showReader(
        episodeTitle(episode),
        `${readyTitle(episode)} · Season ${seasonNumber(episode)} · Episode ${episodeNumber(episode)}`,
        readyContent(episode)
      );
    }
  }

  function switchTab(tab) {
    if (tab !== 'serial' && tab !== 'ready') return;
    activeTab = tab;
    render();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;

    requestAnimationFrame(() => {
      refreshQueued = false;
      render();
    });
  }

  function init() {
    if (!window.StudioStore) {
      console.error('Library: StudioStore is not available.');
      toast('Storage is not ready. Please reload the Library.');
      return;
    }

    $('serialTab').addEventListener('click', () => switchTab('serial'));
    $('readyTab').addEventListener('click', () => switchTab('ready'));

    $('librarySearch').addEventListener('input', event => {
      searchTerm = String(event.target.value || '').trim();
      render();
    });

    $('serialFolders').addEventListener('click', event => {
      handleStoryAction(event);
      handleReadClick(event);
    });

    $('readyFolders').addEventListener('click', handleReadClick);

    $('libraryCloseReader').addEventListener('click', () => {
      $('libraryReader').hidden = true;
    });

    window.addEventListener('pageshow', render);
    window.addEventListener('focus', render);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) render();
    });

    window.addEventListener('channelstudio:store-changed', event => {
      const key = event.detail?.key;

      if (!key || ['stories', 'episodes', 'readyMadeEpisodes'].includes(key)) {
        queueRefresh();
      }
    });

    render();
  }

  async function start() {
    try {
      if (window.ChannelStudioCloud?.ready) {
        await window.ChannelStudioCloud.ready;
      }

      if (window.StudioStore?.ready) {
        await window.StudioStore.ready;
      }
    } catch (error) {
      console.warn('Library startup recovery warning:', error);
    }

    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
