(function () {
  'use strict';

  // Constants & Storage Keys
  const STORAGE_KEYS = {
    LAST_NAMES: 'yahtzee_last_player_names',
    SAVED_GAME: 'yahtzee_saved_game_state'
  };

  // Application State
  let game = null;
  let isRollingAnimation = false;
  let isOnlineMode = false;
  let onlineView = null;
  let onOnlineAction = null;
  let onOnlineLeave = null;

  // Board Owner State
  let displayedPlayerIndex = null;
  let lastTurnSeen = null;

  // DOM Elements - Screens
  const screenStart = document.getElementById('screen-start');
  const screenOnline = document.getElementById('screen-online');
  const screenLobby = document.getElementById('screen-lobby');
  const screenGame = document.getElementById('screen-game');
  const screenEnd = document.getElementById('screen-end');

  // DOM Elements - Start Screen
  const resumeBanner = document.getElementById('resume-banner');
  const resumeDetails = document.getElementById('resume-details');
  const btnResumeGame = document.getElementById('btn-resume-game');
  const btnDiscardGame = document.getElementById('btn-discard-game');
  const setupForm = document.getElementById('setup-form');
  const playerInputsContainer = document.getElementById('player-inputs-container');
  const btnAddPlayer = document.getElementById('btn-add-player');

  // DOM Elements - Game Screen
  const btnGameMenu = document.getElementById('btn-game-menu');
  const topBarPlayers = document.getElementById('top-bar-players');
  const currentPlayerNameEl = document.getElementById('current-player-name');
  const statusMessageEl = document.getElementById('status-message');
  const readOnlyBanner = document.getElementById('read-only-banner');
  const boardLeftColumn = document.getElementById('board-left-column');
  const boardRightColumn = document.getElementById('board-right-column');
  const diceContainer = document.getElementById('dice-container');
  const btnRoll = document.getElementById('btn-roll');
  const rollChipsEl = document.getElementById('roll-chips');
  const rollInstructionEl = document.getElementById('roll-instruction');
  const btnHint = document.getElementById('btn-hint');
  const btnRules = document.getElementById('btn-rules');

  // DOM Elements - Dialogs
  const gearMenuDialog = document.getElementById('gear-menu-dialog');
  const btnQuitGame = document.getElementById('btn-quit-game');
  const btnMenuRules = document.getElementById('btn-menu-rules');
  const btnCloseMenu = document.getElementById('btn-close-menu');
  const rulesDialog = document.getElementById('rules-dialog');
  const btnCloseRules = document.getElementById('btn-close-rules');
  const btnCloseRulesBottom = document.getElementById('btn-close-rules-bottom');

  // DOM Elements - End Screen
  const winnerBanner = document.getElementById('winner-banner');
  const standingsBody = document.getElementById('standings-body');
  const btnPlayAgain = document.getElementById('btn-play-again');
  const btnNewGameSetup = document.getElementById('btn-new-game-setup');
  const btnOnlineLeaveGame = document.getElementById('btn-online-leave-game');

  // --- LocalStorage Helpers ---
  function safeGetStorage(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore quota exceptions
    }
  }

  function safeRemoveStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore
    }
  }

  function saveCurrentGameState() {
    if (isOnlineMode) return;
    if (game && !window.YahtzeeGame.isOver(game)) {
      safeSetStorage(STORAGE_KEYS.SAVED_GAME, game);
    } else {
      safeRemoveStorage(STORAGE_KEYS.SAVED_GAME);
    }
  }

  // --- Screen Switching ---
  function showScreen(screen) {
    const appHeader = document.querySelector('.app-header');
    if (appHeader) {
      appHeader.hidden = (screen === 'game');
    }
    screenStart.hidden = screen !== 'start';
    if (screenOnline) screenOnline.hidden = screen !== 'online';
    if (screenLobby) screenLobby.hidden = screen !== 'lobby';
    screenGame.hidden = screen !== 'game';
    screenEnd.hidden = screen !== 'end';
  }

  // --- Start Screen Logic ---
  function getRememberedPlayerNames() {
    const saved = safeGetStorage(STORAGE_KEYS.LAST_NAMES);
    if (Array.isArray(saved) && saved.length >= 1 && saved.length <= 4) {
      return saved;
    }
    return ['Player 1'];
  }

  function renderPlayerInputs(names) {
    playerInputsContainer.innerHTML = '';
    names.forEach((name, idx) => {
      const row = document.createElement('div');
      row.className = 'player-input-row';

      const label = document.createElement('span');
      label.className = 'player-number-label';
      label.textContent = `Player ${idx + 1}:`;

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'player-name-input';
      input.value = name;
      input.maxLength = 20;
      input.placeholder = `Player ${idx + 1}`;
      input.setAttribute('aria-label', `Player ${idx + 1} name`);

      row.appendChild(label);
      row.appendChild(input);

      if (names.length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-remove-player';
        removeBtn.textContent = '✕';
        removeBtn.setAttribute('aria-label', `Remove Player ${idx + 1}`);
        removeBtn.addEventListener('click', () => {
          const currentValues = getCurrentInputValues();
          currentValues.splice(idx, 1);
          renderPlayerInputs(currentValues);
        });
        row.appendChild(removeBtn);
      }

      playerInputsContainer.appendChild(row);
    });

    btnAddPlayer.disabled = names.length >= 4;
  }

  function getCurrentInputValues() {
    const inputs = playerInputsContainer.querySelectorAll('.player-name-input');
    return Array.from(inputs).map(inp => inp.value);
  }

  function checkResumeOption() {
    const savedGame = safeGetStorage(STORAGE_KEYS.SAVED_GAME);
    if (
      savedGame &&
      Array.isArray(savedGame.players) &&
      savedGame.players.length >= 1 &&
      !window.YahtzeeGame.isOver(savedGame)
    ) {
      const names = savedGame.players.map(p => p.name).join(', ');
      const curName = savedGame.players[savedGame.current] ? savedGame.players[savedGame.current].name : '';
      resumeDetails.textContent = `Players: ${names} • Current turn: ${curName}`;
      resumeBanner.hidden = false;
      return savedGame;
    } else {
      resumeBanner.hidden = true;
      return null;
    }
  }

  // --- Element Builders (Pure DOM, No Inline Styles) ---

  function createUpperTileElement(face) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'red-tile red-tile-upper';
    tile.setAttribute('aria-hidden', 'true');
    tile.tabIndex = -1;

    const grid = document.createElement('div');
    grid.className = 'pip-grid';
    const activePips = window.YahtzeeUI.pipLayout(face);
    for (let p = 0; p < 9; p++) {
      const pip = document.createElement('span');
      pip.className = activePips.includes(p) ? 'pip pip-white' : 'pip pip-empty';
      grid.appendChild(pip);
    }
    tile.appendChild(grid);
    return tile;
  }

  function createLowerTileElement(cat) {
    const tileInfo = window.YahtzeeUI.TILES[cat];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'red-tile red-tile-lower';
    tile.setAttribute('aria-hidden', 'true');
    tile.tabIndex = -1;

    if (tileInfo.kind === 'icon') {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('fill', '#ffffff');
      svg.setAttribute('class', 'tile-icon-svg');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M12 3L2 12h3v8h6v-5h2v5h6v-8h3z');
      svg.appendChild(path);
      tile.appendChild(svg);
    } else {
      const span = document.createElement('span');
      span.className = `tile-text tile-text-${cat}`;
      span.textContent = tileInfo.text;
      tile.appendChild(span);
    }

    return tile;
  }

  function createBonusRowElement(card) {
    const prog = window.YahtzeeUI.upperProgress(card);
    const row = document.createElement('div');
    row.className = `bonus-row ${prog.bonusEarned ? 'bonus-earned' : ''}`;

    const labels = document.createElement('div');
    labels.className = 'bonus-label-group';
    const tag = document.createElement('span');
    tag.className = 'bonus-text-label';
    tag.textContent = 'BONUS';
    const pts = document.createElement('span');
    pts.className = `bonus-points-label ${prog.bonusEarned ? 'earned' : ''}`;
    pts.textContent = '+35';
    labels.appendChild(tag);
    labels.appendChild(pts);
    row.appendChild(labels);

    const ringWrap = document.createElement('div');
    ringWrap.className = 'bonus-ring-wrap';
    ringWrap.setAttribute('aria-label', `Upper bonus progress: ${prog.sum} of 63 points`);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bonus-ring-svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '36');
    svg.setAttribute('aria-hidden', 'true');

    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', '18');
    bgCircle.setAttribute('cy', '18');
    bgCircle.setAttribute('r', '15');
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', 'rgba(0, 0, 0, 0.35)');
    bgCircle.setAttribute('stroke-width', '3');
    svg.appendChild(bgCircle);

    const fillCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fillCircle.setAttribute('cx', '18');
    fillCircle.setAttribute('cy', '18');
    fillCircle.setAttribute('r', '15');
    fillCircle.setAttribute('fill', 'none');
    fillCircle.setAttribute('stroke', prog.bonusEarned ? '#fbbf24' : '#ffffff');
    fillCircle.setAttribute('stroke-width', '3');
    fillCircle.setAttribute('stroke-dasharray', '94.25');
    const offset = 94.25 * (1 - Math.min(1, prog.sum / 63));
    fillCircle.setAttribute('stroke-dashoffset', offset.toFixed(2));
    fillCircle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(fillCircle);
    ringWrap.appendChild(svg);

    const frac = document.createElement('span');
    frac.className = 'bonus-fraction';
    frac.textContent = `${prog.sum}/63`;
    ringWrap.appendChild(frac);

    row.appendChild(ringWrap);
    return row;
  }

  // --- Game Rendering ---

  function renderGame() {
    const curGame = isOnlineMode ? (onlineView && onlineView.game) : game;
    if (!curGame) return;

    // Detect turn advancement to reset displayed card to owner
    if (lastTurnSeen !== curGame.current) {
      lastTurnSeen = curGame.current;
      displayedPlayerIndex = isOnlineMode ? onlineView.you : curGame.current;
    }

    if (displayedPlayerIndex === null || displayedPlayerIndex >= curGame.players.length) {
      displayedPlayerIndex = isOnlineMode ? onlineView.you : curGame.current;
    }

    const curPlayer = curGame.players[curGame.current];
    const isMyTurn = isOnlineMode ? (onlineView.you === curGame.current) : true;
    const isReadOnly = isOnlineMode
      ? (displayedPlayerIndex !== onlineView.you)
      : (displayedPlayerIndex !== curGame.current);

    currentPlayerNameEl.textContent = curPlayer.name;
    btnQuitGame.textContent = isOnlineMode ? 'Leave Room' : 'New Game';

    // 1. Top Bar: Player Badges
    topBarPlayers.innerHTML = '';
    curGame.players.forEach((player, idx) => {
      const isViewing = (idx === displayedPlayerIndex);
      const isTurn = (idx === curGame.current);
      const totals = window.YahtzeeScore.totals(player.card);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `player-badge-btn ${isViewing ? 'is-viewing' : ''}`;
      btn.setAttribute('data-player-index', idx);

      const turnLabel = isTurn ? ', current turn' : '';
      const viewLabel = isViewing ? ', viewing card' : '';
      btn.setAttribute('aria-label', `${player.name}, score ${totals.total}${turnLabel}${viewLabel}`);

      const avatar = document.createElement('span');
      avatar.className = `badge-avatar ${isViewing ? 'avatar-glow' : ''}`;
      avatar.textContent = window.YahtzeeUI.initials(player.name);

      const pill = document.createElement('span');
      pill.className = `badge-score-pill ${isTurn ? 'pill-turn' : 'pill-other'}`;
      pill.textContent = String(totals.total);

      btn.appendChild(avatar);
      btn.appendChild(pill);

      btn.addEventListener('click', () => {
        displayedPlayerIndex = idx;
        renderGame();
      });

      topBarPlayers.appendChild(btn);
    });

    // 2. Read-only Banner
    if (isReadOnly) {
      readOnlyBanner.hidden = false;
      const targetName = curGame.players[displayedPlayerIndex].name;
      readOnlyBanner.textContent = `Viewing ${targetName}'s scorecard (Read-only)`;
    } else {
      readOnlyBanner.hidden = true;
      readOnlyBanner.textContent = '';
    }

    // 3. Board: Left & Right Columns
    const displayedPlayer = curGame.players[displayedPlayerIndex];
    const card = displayedPlayer.card;
    const canScore = !isReadOnly && isMyTurn && curGame.rollsLeft < 3 && !isRollingAnimation;

    // Left Column: Upper categories + Bonus row
    boardLeftColumn.innerHTML = '';
    window.YahtzeeUI.LAYOUT.left.forEach(cat => {
      const tileInfo = window.YahtzeeUI.TILES[cat];
      const row = document.createElement('div');
      row.className = 'board-row';

      const tile = createUpperTileElement(tileInfo.face);
      const scoreVal = card[cat];

      let cell;
      if (scoreVal !== undefined) {
        // Scored category: solid dark text, not a button
        cell = document.createElement('div');
        cell.className = 'score-cell cell-scored';
        cell.setAttribute('aria-label', `${tileInfo.label}, scored ${scoreVal}`);
        const span = document.createElement('span');
        span.className = 'score-text score-solid';
        span.textContent = String(scoreVal);
        cell.appendChild(span);
      } else if (canScore) {
        // Open category during active play: button with faded score
        const pot = window.YahtzeeScore.scoreCategory(cat, curGame.dice);
        cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'score-cell cell-open';
        cell.setAttribute('data-category', cat);
        cell.setAttribute('aria-label', `${tileInfo.label}, scores ${pot}`);
        const span = document.createElement('span');
        span.className = 'score-text score-faded';
        span.textContent = String(pot);
        cell.appendChild(span);

        cell.addEventListener('click', () => {
          cell.classList.add('score-pop');
          setTimeout(() => handleScoreCategory(cat), 100);
        });
        tile.disabled = false;
        tile.addEventListener('click', () => {
          cell.classList.add('score-pop');
          setTimeout(() => handleScoreCategory(cat), 100);
        });
      } else {
        // Open category when read-only / before rolling: empty, not a button
        cell = document.createElement('div');
        cell.className = 'score-cell cell-open cell-disabled';
        cell.setAttribute('aria-label', `${tileInfo.label}, open`);
        tile.disabled = true;
      }

      row.appendChild(tile);
      row.appendChild(cell);
      boardLeftColumn.appendChild(row);
    });

    // Bonus row at bottom of left column
    boardLeftColumn.appendChild(createBonusRowElement(card));

    // Right Column: Lower categories
    boardRightColumn.innerHTML = '';
    window.YahtzeeUI.LAYOUT.right.forEach(cat => {
      const tileInfo = window.YahtzeeUI.TILES[cat];
      const row = document.createElement('div');
      row.className = 'board-row';

      const tile = createLowerTileElement(cat);
      const scoreVal = card[cat];

      let cell;
      if (scoreVal !== undefined) {
        cell = document.createElement('div');
        cell.className = 'score-cell cell-scored';
        cell.setAttribute('aria-label', `${tileInfo.label}, scored ${scoreVal}`);
        const span = document.createElement('span');
        span.className = 'score-text score-solid';
        span.textContent = String(scoreVal);
        cell.appendChild(span);
      } else if (canScore) {
        const pot = window.YahtzeeScore.scoreCategory(cat, curGame.dice);
        cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'score-cell cell-open';
        cell.setAttribute('data-category', cat);
        cell.setAttribute('aria-label', `${tileInfo.label}, scores ${pot}`);
        const span = document.createElement('span');
        span.className = 'score-text score-faded';
        span.textContent = String(pot);
        cell.appendChild(span);

        cell.addEventListener('click', () => {
          cell.classList.add('score-pop');
          setTimeout(() => handleScoreCategory(cat), 100);
        });
        tile.disabled = false;
        tile.addEventListener('click', () => {
          cell.classList.add('score-pop');
          setTimeout(() => handleScoreCategory(cat), 100);
        });
      } else {
        cell = document.createElement('div');
        cell.className = 'score-cell cell-open cell-disabled';
        cell.setAttribute('aria-label', `${tileInfo.label}, open`);
        tile.disabled = true;
      }

      row.appendChild(tile);
      row.appendChild(cell);
      boardRightColumn.appendChild(row);
    });

    // 4. Dice Tray: 5 recessed slots
    diceContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const slot = document.createElement('div');
      slot.className = 'recessed-slot';

      if (curGame.rollsLeft < 3) {
        const val = curGame.dice[i] || 1;
        const isHeld = Boolean(curGame.held[i]);
        const canHold = !isReadOnly && isMyTurn && curGame.rollsLeft > 0 && !isRollingAnimation;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `die-btn ${isHeld ? 'is-held' : ''} ${isRollingAnimation && !isHeld ? 'is-rolling' : ''}`;
        btn.setAttribute('data-index', i);
        btn.setAttribute('aria-pressed', isHeld ? 'true' : 'false');
        btn.disabled = !canHold;

        const heldLabel = isHeld ? 'held' : 'not held';
        btn.setAttribute('aria-label', `Die ${i + 1}: ${val}, ${heldLabel}`);

        const activePips = window.YahtzeeUI.pipLayout(val);
        for (let p = 0; p < 9; p++) {
          const pip = document.createElement('span');
          pip.className = activePips.includes(p) ? 'pip pip-black' : 'pip pip-empty';
          btn.appendChild(pip);
        }

        if (isHeld) {
          const badge = document.createElement('span');
          badge.className = 'die-held-label';
          badge.textContent = 'HELD';
          btn.appendChild(badge);
        }

        btn.addEventListener('click', () => {
          if (!canHold) return;
          if (isOnlineMode) {
            if (onOnlineAction) onOnlineAction({ type: 'hold', index: i });
          } else {
            window.YahtzeeGame.toggleHold(game, i);
            saveCurrentGameState();
            renderGame();
          }
        });

        slot.appendChild(btn);
      }

      diceContainer.appendChild(slot);
    }

    // 5. Roll Button & Status Line
    rollChipsEl.innerHTML = '';
    const chips = window.YahtzeeUI.rollPips(curGame.rollsLeft);
    chips.forEach(chip => {
      const chipEl = document.createElement('span');
      chipEl.className = `roll-chip ${chip.used ? 'chip-used' : 'chip-unused'}`;
      chipEl.textContent = String(chip.n);
      rollChipsEl.appendChild(chipEl);
    });

    btnRoll.setAttribute('aria-label', `Roll dice (${curGame.rollsLeft} rolls left)`);

    if (!isMyTurn) {
      btnRoll.disabled = true;
      rollInstructionEl.textContent = `Waiting for ${curPlayer.name}…`;
      statusMessageEl.textContent = `Waiting for ${curPlayer.name}…`;
    } else if (isReadOnly) {
      btnRoll.disabled = true;
      rollInstructionEl.textContent = `Viewing ${curGame.players[displayedPlayerIndex].name}'s scorecard (Read-only)`;
    } else {
      statusMessageEl.textContent = '';
      if (curGame.rollsLeft === 0) {
        btnRoll.disabled = true;
        rollInstructionEl.textContent = 'Pick a category';
      } else if (curGame.rollsLeft === 3) {
        btnRoll.disabled = isRollingAnimation;
        rollInstructionEl.textContent = 'Roll to start your turn.';
      } else {
        btnRoll.disabled = isRollingAnimation;
        rollInstructionEl.textContent = 'Tap dice to hold, or Roll again.';
      }
    }
  }

  // --- Turn Actions ---

  function handleRoll() {
    if (!game || game.rollsLeft <= 0 || isRollingAnimation) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      window.YahtzeeGame.roll(game);
      statusMessageEl.textContent = '';
      saveCurrentGameState();
      renderGame();
      return;
    }

    isRollingAnimation = true;
    btnRoll.disabled = true;

    const dieButtons = diceContainer.querySelectorAll('.die-btn:not(.is-held)');
    dieButtons.forEach(btn => btn.classList.add('is-rolling'));

    const interval = setInterval(() => {
      dieButtons.forEach(btn => {
        const rand = Math.floor(Math.random() * 6) + 1;
        const activePips = window.YahtzeeUI.pipLayout(rand);
        const pips = btn.querySelectorAll('.pip');
        pips.forEach((pip, p) => {
          pip.className = activePips.includes(p) ? 'pip pip-black' : 'pip pip-empty';
        });
      });
    }, 60);

    setTimeout(() => {
      clearInterval(interval);
      isRollingAnimation = false;
      window.YahtzeeGame.roll(game);
      statusMessageEl.textContent = '';
      saveCurrentGameState();
      renderGame();
    }, 300);
  }

  function handleScoreCategory(catId) {
    const curGame = isOnlineMode ? (onlineView && onlineView.game) : game;
    if (!curGame || curGame.rollsLeft === 3 || isRollingAnimation) return;

    if (isOnlineMode) {
      if (onOnlineAction) onOnlineAction({ type: 'score', category: catId });
      return;
    }

    const player = game.players[game.current];
    const isYahtzee = window.YahtzeeScore.scoreCategory('yahtzee', game.dice) === 50;
    const isExtraBonus = isYahtzee && player.card.yahtzee === 50;

    window.YahtzeeGame.score(game, catId);

    if (isExtraBonus) {
      statusMessageEl.textContent = `Extra Yahtzee Bonus: +100 points for ${player.name}!`;
    } else {
      statusMessageEl.textContent = '';
    }

    if (window.YahtzeeGame.isOver(game)) {
      safeRemoveStorage(STORAGE_KEYS.SAVED_GAME);
      renderEndScreen();
      showScreen('end');
    } else {
      displayedPlayerIndex = game.current;
      saveCurrentGameState();
      renderGame();
    }
  }

  // --- End Screen Logic ---

  function renderEndScreen() {
    const curGame = isOnlineMode ? (onlineView && onlineView.game) : game;
    if (!curGame) return;

    if (isOnlineMode) {
      btnPlayAgain.hidden = true;
      btnNewGameSetup.hidden = true;
      if (btnOnlineLeaveGame) btnOnlineLeaveGame.hidden = false;
    } else {
      btnPlayAgain.hidden = false;
      btnNewGameSetup.hidden = false;
      if (btnOnlineLeaveGame) btnOnlineLeaveGame.hidden = true;
    }

    const playersWithTotals = curGame.players.map(p => ({
      name: p.name,
      totals: window.YahtzeeScore.totals(p.card)
    }));

    const maxScore = Math.max(...playersWithTotals.map(p => p.totals.total));
    const winners = playersWithTotals.filter(p => p.totals.total === maxScore);

    winnerBanner.innerHTML = '';
    const textEl = document.createElement('div');
    textEl.className = 'winner-text';

    if (winners.length > 1) {
      textEl.textContent = `Tie: ${winners.map(w => w.name).join(' and ')}!`;
    } else {
      textEl.textContent = `${winners[0].name} Wins!`;
    }

    const subTextEl = document.createElement('div');
    subTextEl.className = 'winner-subtext';
    subTextEl.textContent = `Grand Total: ${maxScore} points`;

    winnerBanner.appendChild(textEl);
    winnerBanner.appendChild(subTextEl);

    // Standings Table
    const sorted = [...playersWithTotals].sort((a, b) => b.totals.total - a.totals.total);
    standingsBody.innerHTML = '';

    sorted.forEach((item, index) => {
      const tr = document.createElement('tr');
      const isWinner = item.totals.total === maxScore;
      const rankText = isWinner ? '🏆 1' : String(index + 1);

      tr.innerHTML = `
        <td>${rankText}</td>
        <td></td>
        <td>${item.totals.upper}</td>
        <td>${item.totals.bonus}</td>
        <td>${item.totals.lower}</td>
        <td><strong>${item.totals.total}</strong></td>
      `;
      tr.children[1].textContent = item.name;
      standingsBody.appendChild(tr);
    });
  }

  // --- Event Listeners Setup ---

  function setupEventListeners() {
    // Add Player button
    btnAddPlayer.addEventListener('click', () => {
      const currentValues = getCurrentInputValues();
      if (currentValues.length < 4) {
        currentValues.push(`Player ${currentValues.length + 1}`);
        renderPlayerInputs(currentValues);
      }
    });

    // Start Game Form Submit
    setupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const rawNames = getCurrentInputValues();
      const cleanNames = rawNames
        .map((name, i) => name.trim() || `Player ${i + 1}`)
        .slice(0, 4);

      const finalNames = cleanNames.length > 0 ? cleanNames : ['Player 1'];

      safeSetStorage(STORAGE_KEYS.LAST_NAMES, finalNames);
      game = window.YahtzeeGame.newGame(finalNames);
      displayedPlayerIndex = 0;
      lastTurnSeen = 0;
      saveCurrentGameState();
      showScreen('game');
      renderGame();
    });

    // Resume Game Button
    btnResumeGame.addEventListener('click', () => {
      const saved = safeGetStorage(STORAGE_KEYS.SAVED_GAME);
      if (saved && !window.YahtzeeGame.isOver(saved)) {
        game = saved;
        displayedPlayerIndex = game.current;
        lastTurnSeen = game.current;
        showScreen('game');
        renderGame();
      }
    });

    // Discard Saved Game Button
    btnDiscardGame.addEventListener('click', () => {
      safeRemoveStorage(STORAGE_KEYS.SAVED_GAME);
      resumeBanner.hidden = true;
    });

    // Roll Button
    btnRoll.addEventListener('click', () => {
      if (isOnlineMode) {
        if (!onlineView || onlineView.you !== onlineView.game.current || onlineView.game.rollsLeft <= 0) return;
        if (onOnlineAction) onOnlineAction({ type: 'roll' });
      } else {
        handleRoll();
      }
    });

    // Hint Button
    btnHint.addEventListener('click', () => {
      const curGame = isOnlineMode ? (onlineView && onlineView.game) : game;
      if (!curGame || isRollingAnimation) return;

      if (curGame.rollsLeft === 3) {
        rollInstructionEl.textContent = 'Roll dice first to get a hint!';
        return;
      }

      const activePlayer = curGame.players[curGame.current];
      const openCats = window.YahtzeeScore.CATEGORIES.filter(cat => activePlayer.card[cat] === undefined);
      if (openCats.length === 0) return;

      let bestCat = openCats[0];
      let bestScore = -1;
      for (const cat of openCats) {
        const score = window.YahtzeeScore.scoreCategory(cat, curGame.dice);
        if (score > bestScore) {
          bestScore = score;
          bestCat = cat;
        }
      }

      // If viewing another card, switch back to current player's card to show the hint
      if (displayedPlayerIndex !== curGame.current) {
        displayedPlayerIndex = curGame.current;
        renderGame();
      }

      const targetCell = boardLeftColumn.querySelector(`[data-category="${bestCat}"]`) ||
                         boardRightColumn.querySelector(`[data-category="${bestCat}"]`);
      if (targetCell) {
        targetCell.classList.add('hint-pulse');
        setTimeout(() => targetCell.classList.remove('hint-pulse'), 1200);
      }
      const tileLabel = window.YahtzeeUI.TILES[bestCat].label;
      rollInstructionEl.textContent = `Hint: ${tileLabel} scores ${bestScore}`;
    });

    // Rules Button in Bottom Bar
    btnRules.addEventListener('click', () => {
      if (rulesDialog.showModal) rulesDialog.showModal();
      else rulesDialog.hidden = false;
    });

    // Gear Menu Button in Top Bar
    btnGameMenu.addEventListener('click', () => {
      if (gearMenuDialog.showModal) gearMenuDialog.showModal();
      else gearMenuDialog.hidden = false;
    });

    // Rules inside Gear Menu
    btnMenuRules.addEventListener('click', () => {
      if (gearMenuDialog.close) gearMenuDialog.close();
      else gearMenuDialog.hidden = true;
      if (rulesDialog.showModal) rulesDialog.showModal();
      else rulesDialog.hidden = false;
    });

    // Close buttons for Gear Menu
    btnCloseMenu.addEventListener('click', () => {
      if (gearMenuDialog.close) gearMenuDialog.close();
      else gearMenuDialog.hidden = true;
    });

    gearMenuDialog.addEventListener('click', (e) => {
      if (e.target === gearMenuDialog) {
        if (gearMenuDialog.close) gearMenuDialog.close();
        else gearMenuDialog.hidden = true;
      }
    });

    // Close buttons for Rules Dialog
    btnCloseRules.addEventListener('click', () => {
      if (rulesDialog.close) rulesDialog.close();
      else rulesDialog.hidden = true;
    });
    btnCloseRulesBottom.addEventListener('click', () => {
      if (rulesDialog.close) rulesDialog.close();
      else rulesDialog.hidden = true;
    });
    rulesDialog.addEventListener('click', (e) => {
      if (e.target === rulesDialog) {
        if (rulesDialog.close) rulesDialog.close();
        else rulesDialog.hidden = true;
      }
    });

    // Quit / Leave Game Button in Gear Menu
    btnQuitGame.addEventListener('click', () => {
      if (gearMenuDialog.close) gearMenuDialog.close();
      else gearMenuDialog.hidden = true;

      if (isOnlineMode) {
        const ok = confirm('Leave this online room?');
        if (ok && onOnlineLeave) {
          onOnlineLeave();
        }
      } else {
        const ok = confirm('Leave this game and return to setup?');
        if (ok) {
          checkResumeOption();
          showScreen('start');
        }
      }
    });

    // Play Again Button (End Screen - Hot seat)
    btnPlayAgain.addEventListener('click', () => {
      if (!game) return;
      const names = game.players.map(p => p.name);
      game = window.YahtzeeGame.newGame(names);
      displayedPlayerIndex = 0;
      lastTurnSeen = 0;
      saveCurrentGameState();
      showScreen('game');
      renderGame();
    });

    // Change Players Button (End Screen - Hot seat)
    btnNewGameSetup.addEventListener('click', () => {
      renderPlayerInputs(getRememberedPlayerNames());
      checkResumeOption();
      showScreen('start');
    });

    // Leave Online Game Button (End Screen - Online)
    if (btnOnlineLeaveGame) {
      btnOnlineLeaveGame.addEventListener('click', () => {
        if (onOnlineLeave) onOnlineLeave();
      });
    }
  }

  // --- Initialize App ---
  function init() {
    setupEventListeners();
    checkResumeOption();
    const rememberedNames = getRememberedPlayerNames();
    renderPlayerInputs(rememberedNames);
    showScreen('start');
  }

  // Expose interface for online multiplayer
  window.YahtzeeApp = {
    showScreen,
    enterOnlineMode(view, actionHandler, leaveHandler) {
      isOnlineMode = true;
      onlineView = view;
      onOnlineAction = actionHandler;
      onOnlineLeave = leaveHandler;
      if (view.phase === 'playing') {
        showScreen('game');
        renderGame();
      } else if (view.phase === 'over') {
        showScreen('end');
        renderEndScreen();
      }
    },
    exitOnlineMode() {
      isOnlineMode = false;
      onlineView = null;
      onOnlineAction = null;
      onOnlineLeave = null;
      displayedPlayerIndex = null;
      lastTurnSeen = null;
      btnQuitGame.textContent = 'New Game';
    },
    showStatusMessage(msg) {
      statusMessageEl.textContent = msg;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
