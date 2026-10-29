(function () {
  const $ = id => document.getElementById(id);
  const card = $('account-card');
  if (!card) return;

  const sections = ['screen-account', 'screen-board', 'screen-profile'];
  let me = null;
  let mode = 'signin';
  let board = 'wins';
  let period = 'all';
  let profileFrom = 'start';

  const BOARD_LABELS = { wins: 'Wins', winrate: 'Win rate %', best: 'Best score', yahtzees: 'Yahtzees' };

  async function api(path, opts) {
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function post(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }

  function open(id) {
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== id; });
    const header = document.querySelector('.app-header');
    if (header) header.hidden = false;
  }

  function close() {
    sections.forEach(id => { $(id).hidden = true; });
    window.YahtzeeApp.showScreen('start');
  }

  function showErr(el, msg) {
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function applyUser() {
    const signedIn = Boolean(me);
    $('account-status').textContent = signedIn ? `Signed in as ${me.username}` : 'Sign in to join the leaderboard. Guests can still play.';
    $('btn-account-signin').hidden = signedIn;
    $('btn-account-profile').hidden = !signedIn;
    $('btn-account-signout').hidden = !signedIn;
    const name = $('online-player-name');
    if (name) {
      if (signedIn) { name.value = me.username; name.readOnly = true; }
      else if (name.readOnly) { name.value = ''; name.readOnly = false; }
    }
  }

  async function refreshMe() {
    try {
      const data = await api('/api/me');
      card.hidden = !data.enabled;
      me = data.user;
    } catch {
      card.hidden = true;
      me = null;
    }
    applyUser();
  }

  function setMode(next) {
    mode = next;
    const reg = next === 'register';
    $('tab-signin').setAttribute('aria-pressed', String(!reg));
    $('tab-register').setAttribute('aria-pressed', String(reg));
    $('tab-signin').className = reg ? 'btn btn-secondary' : 'btn btn-primary';
    $('tab-register').className = reg ? 'btn btn-primary' : 'btn btn-secondary';
    $('btn-account-submit').textContent = reg ? 'Create account' : 'Sign in';
    $('account-hint').hidden = !reg;
    $('account-password').autocomplete = reg ? 'new-password' : 'current-password';
    showErr($('account-error'), '');
  }

  async function submitAccount(ev) {
    ev.preventDefault();
    showErr($('account-error'), '');
    try {
      const data = await post(mode === 'register' ? '/api/register' : '/api/login', {
        username: $('account-username').value.trim(),
        password: $('account-password').value,
      });
      $('account-password').value = '';
      me = { username: data.username };
      applyUser();
      close();
    } catch (err) {
      showErr($('account-error'), err.message);
    }
  }

  async function signOut() {
    try { await post('/api/logout'); } catch { /* cookie is cleared server side when reachable */ }
    me = null;
    applyUser();
  }

  function cell(tag, text) {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  }

  async function loadBoard() {
    showErr($('board-error'), '');
    $('board-value-head').textContent = BOARD_LABELS[board];
    const body = $('board-body');
    body.textContent = '';
    try {
      const data = await api(`/api/leaderboard?board=${board}&period=${period}`);
      $('board-empty').hidden = data.rows.length > 0;
      for (const r of data.rows) {
        const tr = document.createElement('tr');
        tr.appendChild(cell('td', String(r.rank)));
        const td = document.createElement('td');
        const link = cell('button', r.username);
        link.type = 'button';
        link.className = 'btn btn-outline btn-small';
        link.addEventListener('click', () => showProfile(r.username, 'board'));
        td.appendChild(link);
        tr.appendChild(td);
        tr.appendChild(cell('td', String(r.value)));
        tr.appendChild(cell('td', String(r.games)));
        body.appendChild(tr);
      }
    } catch (err) {
      showErr($('board-error'), err.message);
    }
  }

  function pressed(groupId, attr, value) {
    $(groupId).querySelectorAll('button').forEach(b => {
      const on = b.dataset[attr] === value;
      b.setAttribute('aria-pressed', String(on));
      b.className = on ? 'btn btn-primary' : 'btn btn-secondary';
    });
  }

  function openBoard() {
    open('screen-board');
    loadBoard();
  }

  async function showProfile(username, from) {
    profileFrom = from;
    open('screen-profile');
    $('profile-title').textContent = username;
    $('profile-stats').textContent = '';
    $('profile-recent').textContent = '';
    try {
      const p = await api(`/api/users/${encodeURIComponent(username)}`);
      $('profile-title').textContent = p.username;
      const rows = [
        ['Ranked games', p.games], ['Wins', p.wins], ['Win rate', `${p.winRate}%`],
        ['Best score', p.best], ['Yahtzees', p.yahtzees], ['Member since', new Date(p.since).toLocaleDateString()],
      ];
      for (const [k, v] of rows) {
        const tr = document.createElement('tr');
        tr.appendChild(cell('th', k));
        tr.appendChild(cell('td', String(v)));
        $('profile-stats').appendChild(tr);
      }
      for (const g of p.recent) {
        const tr = document.createElement('tr');
        tr.appendChild(cell('td', g.won ? 'Won' : 'Lost'));
        tr.appendChild(cell('td', String(g.total)));
        tr.appendChild(cell('td', g.opponents.join(', ') || '-'));
        $('profile-recent').appendChild(tr);
      }
    } catch (err) {
      $('profile-stats').appendChild(cell('tr', err.message));
    }
  }

  $('btn-account-signin').addEventListener('click', () => { setMode('signin'); open('screen-account'); $('account-username').focus(); });
  $('btn-account-board').addEventListener('click', openBoard);
  $('btn-account-profile').addEventListener('click', () => me && showProfile(me.username, 'start'));
  $('btn-account-signout').addEventListener('click', signOut);
  $('btn-account-back').addEventListener('click', close);
  $('btn-board-back').addEventListener('click', close);
  $('btn-profile-back').addEventListener('click', () => (profileFrom === 'board' ? openBoard() : close()));
  $('tab-signin').addEventListener('click', () => setMode('signin'));
  $('tab-register').addEventListener('click', () => setMode('register'));
  $('account-form').addEventListener('submit', submitAccount);
  $('board-tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-board]');
    if (!b) return;
    board = b.dataset.board;
    pressed('board-tabs', 'board', board);
    loadBoard();
  });
  $('period-tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-period]');
    if (!b) return;
    period = b.dataset.period;
    pressed('period-tabs', 'period', period);
    loadBoard();
  });

  refreshMe();
})();
