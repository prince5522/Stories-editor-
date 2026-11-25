
/* =========================================================
   STORY STUDIO — SUPABASE CLOUD SYSTEM
   Version 2.0 — SAFE LOGIN / NO AUTOMATIC DATA REPLACEMENT
   Local data remains the source of truth during login.
   ========================================================= */

(function () {
  'use strict';

  const PROJECT_URL = 'https://jsxfarnboxcfyptwktub.supabase.co';
  const PUBLISHABLE_KEY = 'sb_publishable_dNWnY4UFLlyqAkPNc73tIA_JuYCk0K2';

  const statusEl = () => document.getElementById('cloudStatus');

  function status(message, online) {
    const el = statusEl();
    if (!el) return;
    el.textContent = message;
    el.dataset.online = online ? 'true' : 'false';
  }

  if (!window.StudioStore) {
    console.error('Story Studio: StudioStore is missing.');
    status('Local storage unavailable', false);
    return;
  }

  let client = null;
  let ownerId = null;
  let currentUser = null;
  let currentProfile = null;
  let initialized = false;
  let initializationPromise = null;
  let backgroundSyncPromise = null;
  let queue = Promise.resolve();

  function errorMessage(error) {
    return String(error && error.message ? error.message : error || 'An unexpected error occurred.');
  }

  function validUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function normalizeUsername(username) {
    return String(username || '').trim();
  }

  function notifyError(error) {
    window.dispatchEvent(new CustomEvent('channelstudio:cloud-error', {
      detail: errorMessage(error)
    }));
  }

  /* =========================================================
     PROFILE SYSTEM
     ========================================================= */

  async function loadProfile() {
    if (!client || !currentUser) return null;

    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      currentProfile = data;
      return data;
    }

    const username = normalizeUsername(currentUser.user_metadata?.username);

    if (!validUsername(username)) {
      currentProfile = null;
      return null;
    }

    const { data: created, error: createError } = await client
      .from('profiles')
      .insert({
        id: currentUser.id,
        username,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) throw createError;

    currentProfile = created;
    return created;
  }

  function getUsername() {
    return (
      currentProfile?.username ||
      currentUser?.user_metadata?.username ||
      currentUser?.email?.split('@')[0] ||
      'Story Studio User'
    );
  }

  async function getProfile() {
    try {
      if (!currentUser) return null;
      return await loadProfile();
    } catch (error) {
      console.error('Profile loading failed:', error);
      return null;
    }
  }

  async function updateUsername(username) {
    try {
      if (!client || !currentUser) throw new Error('Please log in first.');

      username = normalizeUsername(username);

      if (!validUsername(username)) {
        throw new Error('Username must contain 3–20 letters, numbers or underscores.');
      }

      const { data, error } = await client
        .from('profiles')
        .upsert({
          id: currentUser.id,
          username,
          updated_at: new Date().toISOString()
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') throw new Error('Username is already taken.');
        throw error;
      }

      const { error: metadataError } = await client.auth.updateUser({
        data: { username }
      });

      if (metadataError) throw metadataError;

      currentProfile = data;
      currentUser.user_metadata = {
        ...currentUser.user_metadata,
        username
      };

      window.dispatchEvent(new CustomEvent('channelstudio:profile-updated', {
        detail: { username, user: currentUser }
      }));

      return {
        success: true,
        username,
        message: 'Username updated successfully.'
      };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  /* =========================================================
     EPISODE CLOUD SAVE
     This only runs after an actual local episode change.
     ========================================================= */

  function toRow(ep) {
    return {
      id: String(ep.id),
      author_id: ownerId,
      story_title: String(ep.story_title || ep.storyName || '').trim(),
      season_number: Number(ep.season_number) || 1,
      episode_number: Number(ep.episode_number) || 1,
      episode_name: String(ep.episode_name || ''),
      episode_subtitle: String(ep.episode_subtitle || ''),
      episode_text: String(ep.episode_text || ''),
      word_count: Number(ep.word_count) || 0,
      reading_time_min: Number(ep.reading_time_min) || 0,
      content_rating: ep.content_rating === '18+' ? '18+' : 'general',
      source: 'manual_ready_made',
      scheduled_post_at: ep.scheduled_post_at || null,
      reminder_enabled: !!ep.reminder_enabled,
      reminder_channel_push: ep.reminder_channel ? ep.reminder_channel.push !== false : true,
      reminder_channel_in_app: ep.reminder_channel ? ep.reminder_channel.in_app !== false : true,
      reminder_channel_whatsapp_sms: !!(ep.reminder_channel && ep.reminder_channel.whatsapp_sms),
      reminder_type: ['one_off', 'recurring', 'smart_cadence'].includes(ep.reminder_type)
        ? ep.reminder_type : 'one_off',
      status: ['draft', 'scheduled', 'posted'].includes(ep.status)
        ? ep.status : 'draft',
      posted_at: ep.posted_at || null,
      author_approved: !!ep.author_approved,
      auto_post_enabled: false,
      created_at: ep.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  async function syncChanges(before, after) {
    if (!initialized || !client || !ownerId) return;

    const oldItems = Array.isArray(before) ? before : [];
    const newItems = Array.isArray(after) ? after : [];

    const newIds = new Set(newItems.map(ep => String(ep.id)));
    const removed = oldItems
      .map(ep => String(ep.id))
      .filter(id => !newIds.has(id));

    try {
      if (newItems.length) {
        const { error } = await client
          .from('episodes')
          .upsert(newItems.map(toRow), { onConflict: 'id' });
        if (error) throw error;
      }

      if (removed.length) {
        const { error } = await client
          .from('episodes')
          .delete()
          .eq('author_id', ownerId)
          .in('id', removed);
        if (error) throw error;
      }

      status('Cloud synced ✓', true);
      window.dispatchEvent(new CustomEvent('channelstudio:cloud-synced'));
    } catch (error) {
      console.error('Cloud save failed:', error);
      status('Cloud save failed · local copy kept', false);
      notifyError(error);
    }
  }

  /* =========================================================
     PRESERVE LOCAL STORAGE
     ========================================================= */

  const originalSet = window.StudioStore.set.bind(window.StudioStore);

  window.StudioStore.set = function (key, value) {
    const before = key === 'readyMadeEpisodes'
      ? window.StudioStore.get(key, [])
      : null;

    const result = originalSet(key, value);

    if (key === 'readyMadeEpisodes' && Array.isArray(value)) {
      queue = queue
        .then(() => syncChanges(before, value))
        .catch(error => console.error('Cloud queue failed:', error));
    }

    return result;
  };

  /* =========================================================
     ACCOUNT SESSION
     Login only establishes the account session and profile.
     It does not download, replace, merge or upload app records.
     ========================================================= */

  async function refreshAccount() {
    if (!client) throw new Error('Cloud client unavailable.');

    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    const session = data.session;

    if (!session || !session.user) {
      throw new Error('No active account session.');
    }

    currentUser = session.user;
    ownerId = session.user.id;
    initialized = false;

    await loadProfile();

    // Deliberately do not call any cloud data import or backup here.
    initialized = true;

    status('Account connected ✓ · local data preserved', true);

    window.dispatchEvent(new CustomEvent('channelstudio:cloud-ready', {
      detail: {
        user: currentUser,
        username: getUsername()
      }
    }));

    return {
      success: true,
      user: currentUser,
      profile: currentProfile,
      username: getUsername(),
      userId: ownerId
    };
  }

  /* =========================================================
     REGISTER
     ========================================================= */

  async function signUp(username, email, password) {
    try {
      if (!client) throw new Error('Cloud client unavailable.');

      username = normalizeUsername(username);
      email = normalizeEmail(email);

      if (!validUsername(username)) {
        throw new Error('Username must be 3–20 characters using letters, numbers or underscores.');
      }
      if (!email || !password) throw new Error('Email and password are required.');
      if (password.length < 8) throw new Error('Password must contain at least 8 characters.');

      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;

      const current = sessionData.session?.user;
      let result;

      if (current && current.is_anonymous) {
        result = await client.auth.updateUser({
          email,
          password,
          data: { username }
        });
      } else {
        result = await client.auth.signUp({
          email,
          password,
          options: { data: { username } }
        });
      }

      if (result.error) throw result.error;

      const { data: latest, error: latestError } = await client.auth.getSession();
      if (latestError) throw latestError;

      if (latest.session) {
        currentUser = latest.session.user;
        ownerId = currentUser.id;

        const { error: profileError } = await client
          .from('profiles')
          .upsert({
            id: ownerId,
            username,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' });

        if (profileError) {
          if (profileError.code === '23505') throw new Error('That username is already taken.');
          throw profileError;
        }

        await refreshAccount();
      }

      return {
        success: true,
        username,
        message: latest.session
          ? 'Account created successfully.'
          : 'Check your email to confirm your account.',
        confirmationRequired: !latest.session,
        user: result.data.user
      };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  /* =========================================================
     LOGIN
     ========================================================= */

  async function signIn(email, password) {
    try {
      if (!client) throw new Error('Cloud client unavailable.');

      email = normalizeEmail(email);
      if (!email || !password) throw new Error('Email and password are required.');

      await queue;

      const { error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const account = await refreshAccount();

      return {
        success: true,
        message: 'Welcome back, ' + account.username + '!',
        user: account.user,
        username: account.username
      };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  /* =========================================================
     PASSWORD RECOVERY / CHANGE
     ========================================================= */

  async function resetPassword(email) {
    try {
      if (!client) throw new Error('Cloud client unavailable.');
      email = normalizeEmail(email);
      if (!email) throw new Error('Enter your email address.');

      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });

      if (error) throw error;
      return { success: true, message: 'Password recovery email sent.' };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  async function changePassword(password) {
    try {
      if (!client || !currentUser) throw new Error('Please log in first.');
      if (!password || password.length < 8) {
        throw new Error('Password must contain at least 8 characters.');
      }

      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;

      return { success: true, message: 'Password changed successfully.' };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  /* =========================================================
     LOGOUT
     ========================================================= */

  async function signOut() {
    try {
      if (!client) throw new Error('Cloud client unavailable.');

      await queue;
      const { error } = await client.auth.signOut();
      if (error) throw error;

      localStorage.removeItem('channelStudio.authenticated');
      localStorage.removeItem('channelStudio.username');

      initialized = false;
      ownerId = null;
      currentUser = null;
      currentProfile = null;

      status('Signed out · local copy kept', false);
      window.dispatchEvent(new CustomEvent('channelstudio:logged-out'));

      return { success: true, message: 'Signed out successfully.' };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function init() {
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async function () {
      status('Connecting to Supabase…', false);

      if (!window.supabase || !window.supabase.createClient) {
        status('Cloud unavailable · local mode', false);
        return { online: false, error: 'Supabase library is unavailable.' };
      }

      try {
        client = window.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        });

        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        let session = data.session;

        if (!session) {
          const guest = await client.auth.signInAnonymously();
          if (guest.error) throw guest.error;
          session = guest.data.session;
        }

        if (!session || !session.user) {
          throw new Error('Supabase did not return an active session.');
        }

        currentUser = session.user;
        ownerId = session.user.id;
        currentProfile = null;

        // Only load account/profile details in the background.
        backgroundSyncPromise = refreshAccount().catch(error => {
          console.error('Account initialization failed:', error);
          initialized = false;
          status('Account connected · profile needs attention', false);
          notifyError(error);
          return { success: false, error: errorMessage(error) };
        });

        return {
          online: true,
          authenticated: true,
          userId: ownerId,
          username: getUsername(),
          user: currentUser,
          syncing: false
        };
      } catch (error) {
        console.error('Story Studio cloud initialization failed:', error);
        initialized = false;
        status('Cloud setup needed · local copy kept', false);
        notifyError(error);
        return { online: false, error: errorMessage(error) };
      }
    })();

    return initializationPromise;
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.ChannelStudioCloud = {
    ready: null,
    getClient: () => client,

    getUser: async () => {
      if (!client) return null;
      const { data, error } = await client.auth.getUser();
      if (error) return null;
      currentUser = data.user;
      if (currentUser) ownerId = currentUser.id;
      return currentUser;
    },

    getUserId: () => ownerId,
    getUsername,
    getProfile,
    updateUsername,
    signUp,
    signIn,
    signOut,
    resetPassword,
    changePassword,
    refresh: refreshAccount,

    waitForCloudSync: async () => {
      if (backgroundSyncPromise) return await backgroundSyncPromise;
      return { success: initialized };
    },

    isConnected: () => initialized,
    isLoggedIn: () => !!currentUser && !currentUser.is_anonymous
  };

  window.ChannelStudioCloud.ready = init();
})();
