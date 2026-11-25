
/* STORIES EDITOR — STORY CONTINUATION BRIDGE
   Version 1.0
   Connects Library Continue Story to the existing story engine.
*/
(function () {
  'use strict';

  function openContinuation() {
    const params = new URLSearchParams(window.location.search);
    const storyId = params.get('continueStory');

    if (!storyId) return;

    const storyList = document.getElementById('storyList');

    if (!storyList) {
      console.warn('Story continuation: story list not found.');
      return;
    }

    const continueButton = Array.from(
      storyList.querySelectorAll('button[data-story-continue]')
    ).find(button => button.dataset.storyContinue === storyId);

    if (!continueButton) {
      console.warn('Story continuation: saved story was not found.');
      return;
    }

    continueButton.click();

    // Remove the query after opening, so refresh won't reopen the form.
    const cleanURL = new URL(window.location.href);
    cleanURL.searchParams.delete('continueStory');

    window.history.replaceState(
      {},
      document.title,
      cleanURL.pathname + cleanURL.search + cleanURL.hash
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', openContinuation, {
      once: true
    });
  } else {
    openContinuation();
  }
})();
