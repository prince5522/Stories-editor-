
/* =========================================================
   STORIES EDITOR — STORY ACTION BRIDGE
   Version 4.0
   Supports:
   - Edit an existing saved season
   - Continue an existing story
   - Delete an existing manuscript
   - Keeps generated episodes when deleting a manuscript
========================================================= */

(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function cleanQuery(parameter) {
    const url = new URL(window.location.href);
    url.searchParams.delete(parameter);

    window.history.replaceState(
      {},
      document.title,
      url.pathname + url.search + url.hash
    );
  }

  function showMessage(message) {
    if (typeof window.studioToast === 'function') {
      window.studioToast(message);
    } else {
      console.info(message);
    }
  }

  async function openSelectedStory() {
    const params = new URLSearchParams(window.location.search);

    const editId = params.get('editStory');
    const continueId = params.get('continueStory');
    const deleteId = params.get('deleteStory');

    // Wait for the existing storage system.
    const store = window.StudioStore;

    if (!store) {
      if (editId || continueId || deleteId) {
        showMessage('Story storage is not available.');
      }
      return;
    }

    try {
      if (store.ready) {
        await store.ready;
      }

      // DELETE ROUTE
      // Process this before checking edit/continue parameters.
      if (deleteId) {
        const stories = store.get('stories', []);

        const story = stories.find(
          item => String(item.id) === String(deleteId)
        );

        if (!story) {
          throw new Error('The selected story could not be found.');
        }

        const confirmed = window.confirm(
          `Delete "${story.title || 'this story'}"?\n\nOnly the original manuscript will be deleted. Its existing episodes will be kept.`
        );

        if (confirmed) {
          const updatedStories = stories.filter(
            item => String(item.id) !== String(deleteId)
          );

          store.set('stories', updatedStories);

          showMessage(
            'Story manuscript deleted. Existing episodes have been kept.'
          );
        } else {
          showMessage('Deletion cancelled. Your story was kept.');
        }

        cleanQuery('deleteStory');
        return;
      }

      // No edit or continuation request.
      if (!editId && !continueId) return;

      const storyId = editId || continueId;

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

      const file = $('storyFile');

      if (file) {
        file.value = '';
      }

      // EDIT ROUTE
      if (editId) {
        $('storyTitle').value = story.title || '';

        $('storySeason').value = String(
          story.seasonNumber || story.season_number || 1
        );

        $('storyGenre').value = story.genre || 'General';
        $('storyDescription').value = story.description || '';
        $('storyText').value = story.content || '';

        delete form.dataset.continuationTitle;
        form.dataset.editingId = String(story.id);

        const submit = form.querySelector(
          'button[type="submit"]'
        );

        if (submit) {
          submit.textContent = 'Update season';
        }

        form.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        $('storyText')?.focus();

        showMessage(
          'Story loaded for editing. Make your changes and select Update season.'
        );

        cleanQuery('editStory');
        return;
      }

      // CONTINUE STORY ROUTE
      if (continueId) {
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
          Number(story.seasonNumber || story.season_number) || 1
        );

        let latestEpisode = 0;

        matchingEpisodes.forEach(ep => {
          const season = Math.max(
            1,
            Number(ep.seasonNumber || ep.season_number) || 1
          );

          const episode = Math.max(
            0,
            Number(ep.episodeNumber || ep.episode_number) || 0
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

        $('storyTitle').value = story.title || '';
        $('storySeason').value = String(latestSeason);
        $('storyGenre').value = story.genre || 'General';
        $('storyDescription').value = story.description || '';
        $('storyText').value = '';

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

        $('storyText')?.focus();

        showMessage(
          `Story loaded. Add your new continuation text for Season ${latestSeason}.`
        );

        cleanQuery('continueStory');
      }

    } catch (error) {
      console.error('Story action bridge error:', error);

      showMessage(
        error.message || 'Could not complete the story action.'
      );
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      openSelectedStory,
      { once: true }
    );
  } else {
    openSelectedStory();
  }
})();
