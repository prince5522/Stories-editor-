
/* STORIES EDITOR — DIRECT STORY CONTINUATION
   Version 2.0
   Loads the selected saved story directly from StudioStore.
*/
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  async function openContinuation() {
    const params = new URLSearchParams(window.location.search);
    const storyId = params.get('continueStory');

    if (!storyId) return;

    try {
      const store = window.StudioStore;

      if (!store) {
        throw new Error('Story storage is not available.');
      }

      if (store.ready) {
        await store.ready;
      }

      const stories = store.get('stories', []);
      const story = stories.find(
        item => String(item.id) === String(storyId)
      );

      if (!story) {
        throw new Error('The selected saved story could not be found.');
      }

      const form = $('storyForm');

      if (!form) {
        throw new Error('The story form could not be found.');
      }

      // Find the latest saved episode position for this story.
      const episodes = store.get('episodes', []);
      const normalize = value => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

      const matchingEpisodes = episodes.filter(ep =>
        normalize(ep.storyTitle || ep.seasonTitle) ===
        normalize(story.title)
      );

      let latestSeason = Math.max(
        1,
        Number(story.seasonNumber) || 1
      );
      let latestEpisode = 0;

      matchingEpisodes.forEach(ep => {
        const season = Math.max(
          1,
          Number(ep.seasonNumber) || 1
        );
        const episode = Math.max(
          0,
          Number(ep.episodeNumber) || 0
        );

        if (
          season > latestSeason ||
          (season === latestSeason && episode > latestEpisode)
        ) {
          latestSeason = season;
          latestEpisode = episode;
        }
      });

      if (latestEpisode >= 13) {
        latestSeason++;
      }

      // Fill the form with the selected story's details.
      $('storyTitle').value = story.title || '';
      $('storySeason').value = String(latestSeason);
      $('storyGenre').value = story.genre || 'General';
      $('storyDescription').value = story.description || '';
      $('storyText').value = '';

      const file = $('storyFile');
      if (file) file.value = '';

      delete form.dataset.editingId;
      form.dataset.continuationTitle = story.title || '';

      const submit = form.querySelector(
        'button[type="submit"]'
      );

      if (submit) {
        submit.textContent = 'Save continuation';
      }

      form.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

      if (typeof window.studioToast === 'function') {
        window.studioToast(
          'Story loaded. Add your new continuation text.'
        );
      }

      // Remove the query only after the story has loaded.
      const cleanURL = new URL(window.location.href);
      cleanURL.searchParams.delete('continueStory');

      window.history.replaceState(
        {},
        document.title,
        cleanURL.pathname + cleanURL.search + cleanURL.hash
      );

    } catch (error) {
      console.error('Story continuation error:', error);

      if (typeof window.studioToast === 'function') {
        window.studioToast(error.message);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      openContinuation,
      { once: true }
    );
  } else {
    openContinuation();
  }
})();
