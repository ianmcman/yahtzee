(function () {
  'use strict';

  const STORAGE_KEYS = {
    SESSION: 'yahtzee_online_session',
    PLAYER_NAME: 'yahtzee_online_player_name'
  };

  // State
  let currentSession = null; // { code, token }
  let currentView = null;
  let eventSource = null;
  let isCheckingRoom = false;

  // DOM Elements - Start Screen
  const btnPlayOnline = document.getElementById('btn-play-online');
  const onlineStartError = document.getElementById('online-start-error');

  // DOM Elements - Online Setup Screen
  const btnOnlineBack = document.getElementById('btn-online-back');
  const onlinePlayerNameInput = document.getElementById('online-player-name');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const onlineRoomCodeInput = document.getElementById('online-room-code');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const onlineJoinPrompt = document.getElementById('online-join-prompt');
  const onlinePromptText = document.getElementById('online-prompt-text');
  const onlineErrorMsg = document.getElementById('online-error-msg');

  // DOM Elements - Lobby Screen
  const lobbyCodeDisplay = document.getElementById('lobby-code-display');
  const btnCopyInvite = document.getElementById('btn-copy-invite');
  const copyStatusMsg = document.getElementById('copy-status-msg');
  const lobbyPlayerCount = document.getElementById('lobby-player-count');
  const lobbyPlayerList = document.getElementById('lobby-player-list');
  const lobbyHostControls = document.getElementById('lobby-host-controls');
  const lobbyGuestControls = document.getElementById('lobby-guest-controls');
  const btnStartOnlineGame = document.getElementById('btn-start-online-game');
  const btnLeaveLobby = document.getElementById('btn-leave-lobby');
  const lobbyErrorMsg = document.getElementById('lobby-error-msg');

  // DOM Elements - Reconnecting Indicator
  const reconnectingBadge = document.getElementById('reconnecting-badge');

  // --- LocalStorage Helpers ---
  function safeGet(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function safeSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      // Ignore
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }

  // --- Error Display Helpers ---
  function showOnlineError(msg) {
    if (onlineErrorMsg) {
      onlineErrorMsg.textContent = msg;
      onlineErrorMsg.hidden = !msg;
    }
  }

  function showLobbyError(msg) {
    if (lobbyErrorMsg) {
      lobbyErrorMsg.textContent = msg;
      lobbyErrorMsg.hidden = !msg;
    }
  }

  function showReconnecting(show) {
    if (reconnectingBadge) {
      reconnectingBadge.hidden = !show;
    }
  }

  // --- API Client ---
  async function apiRequest(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (currentSession && currentSession.token) {
      headers['x-token'] = currentSession.token;
    }

    let res;
    try {
      res = await fetch(endpoint, {
        ...options,
        headers
      });
    } catch {
      const err = new Error("You're offline. Hot-seat play still works.");
      err.status = 0;
      throw err;
    }

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const errMsg = (data && data.error) ? data.error : `Request failed (${res.status})`;
      const err = new Error(errMsg);
      err.status = res.status;
      throw err;
    }

    return data;
  }

  // --- Server Probe ---
  let probeOffline = false;
  function unavailableMessage() {
    return probeOffline ? "You're offline. Hot-seat play still works." : 'Online play is unavailable on this server.';
  }
  async function checkServerAvailable() {
    probeOffline = false;
    try {
      const res = await fetch('/healthz');
      return res.ok;
    } catch {
      probeOffline = true;
      return false;
    }
  }

  async function probeRoomStatus(code, token) {
    if (isCheckingRoom) return;
    isCheckingRoom = true;
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(code)}/events?token=${encodeURIComponent(token)}`);
      if (res.status === 404 || res.status === 403) {
        leaveRoom('Room has expired or no longer exists.');
      }
    } catch {
      // Temporary network blip; keep reconnecting badge
    } finally {
      isCheckingRoom = false;
    }
  }

  // --- EventSource SSE ---
  function connectSSE(code, token) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    const url = `/api/rooms/${encodeURIComponent(code)}/events?token=${encodeURIComponent(token)}`;
    eventSource = new EventSource(url);

    eventSource.onopen = function () {
      showReconnecting(false);
    };

    eventSource.onmessage = function (event) {
      showReconnecting(false);
      try {
        const view = JSON.parse(event.data);
        handleViewUpdate(view);
      } catch (e) {
        console.error('Failed to parse SSE data', e);
      }
    };

    eventSource.onerror = function () {
      showReconnecting(true);
      probeRoomStatus(code, token);
    };
  }

  // --- View Update Handler ---
  function handleViewUpdate(view) {
    currentView = view;

    if (view.phase === 'lobby') {
      window.YahtzeeApp.exitOnlineMode();
      window.YahtzeeApp.showScreen('lobby');
      renderLobby(view);
    } else if (view.phase === 'playing' || view.phase === 'over') {
      const note = document.getElementById('end-ranked-note');
      if (note) note.hidden = !(view.ranked && view.phase === 'over');
      window.YahtzeeApp.enterOnlineMode(view, handleAction, () => leaveRoom());
    }
  }

  function renderLobby(view) {
    const rankedEl = document.getElementById('lobby-ranked');
    if (rankedEl) rankedEl.hidden = !view.ranked;
    lobbyCodeDisplay.textContent = view.code;
    lobbyPlayerCount.textContent = view.players.length;

    // Live players list - NEVER innerHTML for player names!
    lobbyPlayerList.innerHTML = '';
    view.players.forEach((player, idx) => {
      const li = document.createElement('li');
      li.className = 'lobby-player-item';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = player.name;
      li.appendChild(nameSpan);

      const badgesSpan = document.createElement('span');
      if (idx === 0) {
        const hostBadge = document.createElement('span');
        hostBadge.className = 'lobby-host-badge';
        hostBadge.textContent = 'Host';
        badgesSpan.appendChild(hostBadge);
      }
      if (idx === view.you) {
        const youBadge = document.createElement('span');
        youBadge.className = 'lobby-you-badge';
        youBadge.textContent = 'You';
        badgesSpan.appendChild(youBadge);
      }
      li.appendChild(badgesSpan);

      lobbyPlayerList.appendChild(li);
    });

    if (view.host) {
      lobbyHostControls.hidden = false;
      lobbyGuestControls.hidden = true;
      btnStartOnlineGame.disabled = view.players.length < 2;
    } else {
      lobbyHostControls.hidden = true;
      lobbyGuestControls.hidden = false;
    }

    showLobbyError('');
  }

  // --- Actions ---
  async function handleAction(action) {
    if (!currentSession) return;
    try {
      await apiRequest(`/api/rooms/${encodeURIComponent(currentSession.code)}/act`, {
        method: 'POST',
        body: JSON.stringify(action)
      });
    } catch (err) {
      window.YahtzeeApp.showStatusMessage(err.message);
    }
  }

  // --- Leave Room ---
  function leaveRoom(message) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    currentSession = null;
    currentView = null;
    safeRemove(STORAGE_KEYS.SESSION);
    showReconnecting(false);

    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    window.YahtzeeApp.exitOnlineMode();
    window.YahtzeeApp.showScreen('start');

    if (message) {
      onlineStartError.textContent = message;
      onlineStartError.hidden = false;
    }
  }

  // --- Prompt Join Room from Hash ---
  async function promptJoinRoom(code) {
    const available = await checkServerAvailable();
    if (!available) {
      onlineStartError.textContent = unavailableMessage();
      onlineStartError.hidden = false;
      return;
    }

    if (onlineRoomCodeInput) {
      onlineRoomCodeInput.value = code;
    }
    if (onlineJoinPrompt && onlinePromptText) {
      onlinePromptText.textContent = `Joining room ${code}. Enter your name to continue:`;
      onlineJoinPrompt.hidden = false;
    }
    window.YahtzeeApp.showScreen('online');
    if (onlinePlayerNameInput) {
      onlinePlayerNameInput.focus();
    }
  }

  // --- Event Listeners Setup ---
  function setupEventListeners() {
    // Start screen "Play Online" button
    btnPlayOnline.addEventListener('click', async () => {
      onlineStartError.hidden = true;
      onlineStartError.textContent = '';
      const available = await checkServerAvailable();
      if (!available) {
        onlineStartError.textContent = unavailableMessage();
        onlineStartError.hidden = false;
        return;
      }
      if (onlineJoinPrompt) onlineJoinPrompt.hidden = true;
      window.YahtzeeApp.showScreen('online');
      if (onlinePlayerNameInput) onlinePlayerNameInput.focus();
    });

    // Online setup "← Back" button
    btnOnlineBack.addEventListener('click', () => {
      showOnlineError('');
      if (onlineJoinPrompt) onlineJoinPrompt.hidden = true;
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      window.YahtzeeApp.showScreen('start');
    });

    // Create Room button
    btnCreateRoom.addEventListener('click', async () => {
      showOnlineError('');
      const name = onlinePlayerNameInput.value.trim();
      if (!name) {
        showOnlineError('Please enter your name.');
        onlinePlayerNameInput.focus();
        return;
      }
      safeSet(STORAGE_KEYS.PLAYER_NAME, name);
      btnCreateRoom.disabled = true;
      try {
        const res = await apiRequest('/api/rooms', {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        currentSession = { code: res.code, token: res.token };
        safeSet(STORAGE_KEYS.SESSION, currentSession);
        window.history.replaceState(null, '', '#' + res.code);
        connectSSE(res.code, res.token);
      } catch (err) {
        showOnlineError(err.message);
      } finally {
        btnCreateRoom.disabled = false;
      }
    });

    // Join Room button
    btnJoinRoom.addEventListener('click', async () => {
      showOnlineError('');
      const name = onlinePlayerNameInput.value.trim();
      if (!name) {
        showOnlineError('Please enter your name.');
        onlinePlayerNameInput.focus();
        return;
      }
      const code = onlineRoomCodeInput.value.trim().toUpperCase();
      if (!code || code.length !== 4) {
        showOnlineError('Please enter a 4-letter room code.');
        onlineRoomCodeInput.focus();
        return;
      }
      safeSet(STORAGE_KEYS.PLAYER_NAME, name);
      btnJoinRoom.disabled = true;
      try {
        const res = await apiRequest(`/api/rooms/${encodeURIComponent(code)}/join`, {
          method: 'POST',
          body: JSON.stringify({ name })
        });
        currentSession = { code, token: res.token };
        safeSet(STORAGE_KEYS.SESSION, currentSession);
        window.history.replaceState(null, '', '#' + code);
        connectSSE(code, res.token);
      } catch (err) {
        showOnlineError(err.message);
      } finally {
        btnJoinRoom.disabled = false;
      }
    });

    // Room code input: auto uppercase
    onlineRoomCodeInput.addEventListener('input', () => {
      onlineRoomCodeInput.value = onlineRoomCodeInput.value.toUpperCase();
    });

    // Enter key handling on name input
    onlinePlayerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const code = onlineRoomCodeInput.value.trim();
        if (code.length === 4) {
          btnJoinRoom.click();
        } else {
          btnCreateRoom.click();
        }
      }
    });

    // Enter key handling on code input
    onlineRoomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnJoinRoom.click();
      }
    });

    // Copy Invite Link button
    btnCopyInvite.addEventListener('click', async () => {
      if (!currentSession) return;
      const inviteUrl = `${window.location.origin}${window.location.pathname}#${currentSession.code}`;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(inviteUrl);
        } else {
          const ta = document.createElement('textarea');
          ta.value = inviteUrl;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        copyStatusMsg.textContent = 'Invite link copied to clipboard!';
        btnCopyInvite.textContent = 'Copied!';
        setTimeout(() => {
          copyStatusMsg.textContent = '';
          btnCopyInvite.textContent = 'Copy Invite Link';
        }, 2000);
      } catch {
        copyStatusMsg.textContent = inviteUrl;
      }
    });

    // Start Online Game button (Host)
    btnStartOnlineGame.addEventListener('click', async () => {
      if (!currentSession) return;
      btnStartOnlineGame.disabled = true;
      try {
        await apiRequest(`/api/rooms/${encodeURIComponent(currentSession.code)}/start`, {
          method: 'POST',
          body: JSON.stringify({})
        });
      } catch (err) {
        showLobbyError(err.message);
        btnStartOnlineGame.disabled = false;
      }
    });

    // Leave Lobby button
    btnLeaveLobby.addEventListener('click', () => {
      leaveRoom();
    });

    // Hash change handler
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace(/^#/, '').trim().toUpperCase();
      if (/^[A-HJ-NP-Z2-9]{4}$/.test(hash)) {
        if (!currentSession || currentSession.code !== hash) {
          promptJoinRoom(hash);
        }
      }
    });
  }

  // --- Initialize Online Subsystem ---
  async function init() {
    setupEventListeners();

    const savedName = safeGet(STORAGE_KEYS.PLAYER_NAME);
    if (savedName && onlinePlayerNameInput) {
      onlinePlayerNameInput.value = savedName;
    }

    const session = safeGet(STORAGE_KEYS.SESSION);
    const hash = window.location.hash.replace(/^#/, '').trim().toUpperCase();
    const isHashA4CharCode = /^[A-HJ-NP-Z2-9]{4}$/.test(hash);

    if (session && session.code && session.token) {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(session.code)}/events?token=${encodeURIComponent(session.token)}`);
        if (res.status === 404 || res.status === 403) {
          safeRemove(STORAGE_KEYS.SESSION);
          currentSession = null;
          if (isHashA4CharCode) {
            promptJoinRoom(hash);
          }
        } else if (res.ok) {
          currentSession = session;
          connectSSE(session.code, session.token);
        } else if (isHashA4CharCode) {
          promptJoinRoom(hash);
        }
      } catch {
        // Plain static server or offline - safe cleanup
        safeRemove(STORAGE_KEYS.SESSION);
      }
    } else if (isHashA4CharCode) {
      promptJoinRoom(hash);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
