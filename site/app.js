(function () {
  'use strict';

  // Constants & Category Definitions
  const STORAGE_KEYS = {
    LAST_NAMES: 'yahtzee_last_player_names',
    SAVED_GAME: 'yahtzee_saved_game_state'
  };

  const CATEGORIES_INFO = [
    { id: 'ones', name: 'Aces (1s)', section: 'upper', desc: 'Sum of 1s' },
    { id: 'twos', name: 'Twos (2s)', section: 'upper', desc: 'Sum of 2s' },
    { id: 'threes', name: 'Threes (3s)', section: 'upper', desc: 'Sum of 3s' },
    { id: 'fours', name: 'Fours (4s)', section: 'upper', desc: 'Sum of 4s' },
    { id: 'fives', name: 'Fives (5s)', section: 'upper', desc: 'Sum of 5s' },
    { id: 'sixes', name: 'Sixes (6s)', section: 'upper', desc: 'Sum of 6s' },
    { id: 'threeKind', name: '3 of a Kind', section: 'lower', desc: 'Sum of all dice' },
    { id: 'fourKind', name: '4 of a Kind', section: 'lower', desc: 'Sum of all dice' },
    { id: 'fullHouse', name: 'Full House', section: 'lower', desc: '25 points' },
    { id: 'smallStraight', name: 'Small Straight', section: 'lower', desc: '30 points' },
    { id: 'largeStraight', name: 'Large Straight', section: 'lower', desc: '40 points' },
    { id: 'yahtzee', name: 'Yahtzee', section: 'lower', desc: '50 points' },
    { id: 'chance', name: 'Chance', section: 'lower', desc: 'Sum of all dice' }
  ];

  // Application State
  let game = null;
  let isRollingAnimation = false;

  // DOM Elements
  const screenStart = document.getElementById('screen-start');
  const screenGame = document.getElementById('screen-game');
  const screenEnd = document.getElementById('screen-end');

  // Start Screen Elements
  const resumeBanner = document.getElementById('resume-banner');
  const resumeDetails = document.getElementById('resume-details');
  const btnResumeGame = document.getElementById('btn-resume-game');
  const btnDiscardGame = document.getElementById('btn-discard-game');
  const setupForm = document.getElementById('setup-form');
  const playerInputsContainer = document.getElementById('player-inputs-container');
  const btnAddPlayer = document.getElementById('btn-add-player');

  // Game Screen Elements
  const currentPlayerNameEl = document.getElementById('current-player-name');
  const statusMessageEl = document.getElementById('status-message');
  const btnQuitGame = document.getElementById('btn-quit-game');
  const diceContainer = document.getElementById('dice-container');
  const btnRoll = document.getElementById('btn-roll');
  const rollsLeftCountEl = document.getElementById('rolls-left-count');
  const rollInstructionEl = document.getElementById('roll-instruction');
  const scorecardHeadRow = document.getElementById('scorecard-head-row');
  const scorecardBody = document.getElementById('scorecard-body');

  // End Screen Elements
  const winnerBanner = document.getElementById('winner-banner');
  const standingsBody = document.getElementById('standings-body');
  const btnPlayAgain = document.getElementById('btn-play-again');
  const btnNewGameSetup = document.getElementById('btn-new-game-setup');

  // --- LocalStorage Helpers ---
  function safeGetStorage(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  function safeSetStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Ignore quota or privacy exceptions
    }
  }

  function safeRemoveStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Ignore
    }
  }

  function saveCurrentGameState() {
    if (game && !window.YahtzeeGame.isOver(game)) {
      safeSetStorage(STORAGE_KEYS.SAVED_GAME, game);
    } else {
      safeRemoveStorage(STORAGE_KEYS.SAVED_GAME);
    }
  }

  // --- Screen Switching ---
  function showScreen(screen) {
    screenStart.hidden = screen !== 'start';
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

  // --- SVG Die Renderer ---
  function getDieSvg(value) {
    const pips = {
      1: [[30, 30]],
      2: [[18, 18], [42, 42]],
      3: [[18, 18], [30, 30], [42, 42]],
      4: [[18, 18], [42, 18], [18, 42], [42, 42]],
      5: [[18, 18], [42, 18], [30, 30], [18, 42], [42, 42]],
      6: [[18, 18], [42, 18], [18, 30], [42, 30], [18, 42], [42, 42]]
    };
    const coords = pips[value] || [];
    const circles = coords.map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="4.5" class="die-pip" />`).join('');
    return `
      <svg viewBox="0 0 60 60" width="46" height="46" aria-hidden="true" focusable="false" class="die-face">
        <rect x="3" y="3" width="54" height="54" rx="10" class="die-bg" />
        ${circles}
      </svg>
    `;
  }

  // --- Game Rendering ---
  function renderGame() {
    if (!game) return;

    const curPlayer = game.players[game.current];
    currentPlayerNameEl.textContent = curPlayer.name;

    // Rolls Left and Roll button
    rollsLeftCountEl.textContent = game.rollsLeft;
    if (game.rollsLeft === 0) {
      btnRoll.disabled = true;
      btnRoll.textContent = 'No rolls left (Score a category)';
      rollInstructionEl.textContent = 'Choose a category to score.';
    } else if (game.rollsLeft === 3) {
      btnRoll.disabled = isRollingAnimation;
      btnRoll.innerHTML = `Roll (<span id="rolls-left-count">${game.rollsLeft}</span> left)`;
      rollInstructionEl.textContent = 'Roll the dice to start your turn.';
    } else {
      btnRoll.disabled = isRollingAnimation;
      btnRoll.innerHTML = `Roll (<span id="rolls-left-count">${game.rollsLeft}</span> left)`;
      rollInstructionEl.textContent = 'Tap dice to keep or re-roll, or choose a category.';
    }

    // Render Dice
    diceContainer.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const val = game.dice[i] || 1;
      const isHeld = Boolean(game.held[i]);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `die-btn ${isHeld ? 'is-held' : ''}`;
      btn.setAttribute('data-index', i);
      btn.setAttribute('aria-pressed', isHeld ? 'true' : 'false');

      // Cannot hold before rolling or when 0 rolls left or during animation
      const canHold = game.rollsLeft < 3 && game.rollsLeft > 0 && !isRollingAnimation;
      btn.disabled = !canHold;

      const heldLabel = isHeld ? 'held' : 'not held';
      btn.setAttribute('aria-label', `Die ${i + 1}: ${val}, ${heldLabel}`);

      btn.innerHTML = `
        ${getDieSvg(val)}
        <span class="die-badge">${isHeld ? 'HELD' : 'KEEP'}</span>
      `;

      btn.addEventListener('click', () => {
        if (!canHold) return;
        window.YahtzeeGame.toggleHold(game, i);
        saveCurrentGameState();
        renderGame();
      });

      diceContainer.appendChild(btn);
    }

    renderScorecard();
  }

  function renderScorecard() {
    // Render Header
    scorecardHeadRow.innerHTML = '<th scope="col" class="col-category">Category</th>';
    game.players.forEach((player, idx) => {
      const th = document.createElement('th');
      th.scope = 'col';
      const isCurrent = idx === game.current;
      if (isCurrent) {
        th.classList.add('col-current');
        th.setAttribute('aria-current', 'true');
        th.textContent = player.name + ' ';
        const ind = document.createElement('span');
        ind.className = 'current-indicator';
        ind.setAttribute('aria-hidden', 'true');
        ind.textContent = '◀';
        th.appendChild(ind);
      } else {
        th.textContent = player.name;
      }
      scorecardHeadRow.appendChild(th);
    });

    // Render Body
    scorecardBody.innerHTML = '';

    // Upper Categories
    const upperCats = CATEGORIES_INFO.filter(c => c.section === 'upper');
    upperCats.forEach(cat => {
      scorecardBody.appendChild(createCategoryRow(cat));
    });

    // Upper Subtotal Row
    scorecardBody.appendChild(createSummaryRow('Upper Subtotal', (card) => {
      return window.YahtzeeScore.totals(card).upper;
    }, 'row-subtotal'));

    // Upper Bonus Row
    scorecardBody.appendChild(createSummaryRow('Upper Bonus (63+)', (card) => {
      return window.YahtzeeScore.totals(card).bonus;
    }, 'row-bonus'));

    // Lower Categories
    const lowerCats = CATEGORIES_INFO.filter(c => c.section === 'lower');
    lowerCats.forEach(cat => {
      scorecardBody.appendChild(createCategoryRow(cat));
    });

    // Yahtzee Bonus Row
    scorecardBody.appendChild(createSummaryRow('Yahtzee Bonus', (card) => {
      return (card.yahtzeeBonus || 0) * 100;
    }, 'row-bonus'));

    // Grand Total Row
    scorecardBody.appendChild(createSummaryRow('Grand Total', (card) => {
      return window.YahtzeeScore.totals(card).total;
    }, 'row-grand-total'));
  }

  function createCategoryRow(cat) {
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.scope = 'row';
    th.className = 'col-category';
    th.textContent = cat.name;
    tr.appendChild(th);

    game.players.forEach((player, pIdx) => {
      const td = document.createElement('td');
      const isCurrent = pIdx === game.current;
      if (isCurrent) {
        td.classList.add('col-current');
      }

      const scoreVal = player.card[cat.id];
      if (scoreVal !== undefined) {
        // Already scored
        td.innerHTML = `<span class="score-used">${scoreVal}</span>`;
      } else if (isCurrent) {
        // Open category for current player
        if (game.rollsLeft === 3 || isRollingAnimation) {
          // Must roll first
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-score-disabled';
          btn.disabled = true;
          btn.textContent = '—';
          btn.setAttribute('aria-label', `${cat.name}: roll dice first to score`);
          td.appendChild(btn);
        } else {
          // Has rolled: show potential score as button
          const potentialScore = window.YahtzeeScore.scoreCategory(cat.id, game.dice);
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn-score-available';
          btn.textContent = String(potentialScore);
          btn.setAttribute('aria-label', `Score ${potentialScore} in ${cat.name}`);
          btn.addEventListener('click', () => {
            handleScoreCategory(cat.id);
          });
          td.appendChild(btn);
        }
      } else {
        // Open for another player
        td.innerHTML = '<span class="score-empty" aria-label="Not scored yet">—</span>';
      }

      tr.appendChild(td);
    });

    return tr;
  }

  function createSummaryRow(title, getValueFn, rowClass) {
    const tr = document.createElement('tr');
    if (rowClass) tr.className = rowClass;

    const th = document.createElement('th');
    th.scope = 'row';
    th.className = 'col-category';
    th.textContent = title;
    tr.appendChild(th);

    game.players.forEach((player, pIdx) => {
      const td = document.createElement('td');
      if (pIdx === game.current) {
        td.classList.add('col-current');
      }
      td.textContent = String(getValueFn(player.card));
      tr.appendChild(td);
    });

    return tr;
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

    // Roll animation (300 ms <= 400 ms)
    isRollingAnimation = true;
    btnRoll.disabled = true;

    const dieButtons = diceContainer.querySelectorAll('.die-btn:not(.is-held)');
    dieButtons.forEach(btn => btn.classList.add('is-rolling'));

    const interval = setInterval(() => {
      dieButtons.forEach(btn => {
        const rand = Math.floor(Math.random() * 6) + 1;
        btn.querySelector('.die-face').outerHTML = getDieSvg(rand);
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
    if (!game || game.rollsLeft === 3 || isRollingAnimation) return;

    const player = game.players[game.current];
    const isYahtzee = window.YahtzeeScore.scoreCategory('yahtzee', game.dice) === 50;
    const isExtraBonus = isYahtzee && player.card.yahtzee === 50;

    window.YahtzeeGame.score(game, catId);

    if (isExtraBonus) {
      statusMessageEl.textContent = `🎉 Extra Yahtzee Bonus: +100 points for ${player.name}!`;
    } else {
      statusMessageEl.textContent = '';
    }

    if (window.YahtzeeGame.isOver(game)) {
      safeRemoveStorage(STORAGE_KEYS.SAVED_GAME);
      renderEndScreen();
      showScreen('end');
    } else {
      saveCurrentGameState();
      renderGame();
    }
  }

  // --- End Screen Logic ---
  function renderEndScreen() {
    if (!game) return;

    const playersWithTotals = game.players.map(p => ({
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

    // Standings Table (sorted descending by total)
    const sorted = [...playersWithTotals].sort((a, b) => b.totals.total - a.totals.total);
    standingsBody.innerHTML = '';

    sorted.forEach((item, index) => {
      const tr = document.createElement('tr');

      const isWinner = item.totals.total === maxScore;
      const rankText = isWinner ? `🏆 1` : String(index + 1);

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
      saveCurrentGameState();
      showScreen('game');
      renderGame();
    });

    // Resume Game Button
    btnResumeGame.addEventListener('click', () => {
      const saved = safeGetStorage(STORAGE_KEYS.SAVED_GAME);
      if (saved && !window.YahtzeeGame.isOver(saved)) {
        game = saved;
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
    btnRoll.addEventListener('click', handleRoll);

    // Quit / New Game Button during game
    btnQuitGame.addEventListener('click', () => {
      const ok = confirm('Leave this game and return to setup?');
      if (ok) {
        checkResumeOption();
        showScreen('start');
      }
    });

    // Play Again Button (End Screen)
    btnPlayAgain.addEventListener('click', () => {
      if (!game) return;
      const names = game.players.map(p => p.name);
      game = window.YahtzeeGame.newGame(names);
      saveCurrentGameState();
      showScreen('game');
      renderGame();
    });

    // Change Players Button (End Screen)
    btnNewGameSetup.addEventListener('click', () => {
      renderPlayerInputs(getRememberedPlayerNames());
      checkResumeOption();
      showScreen('start');
    });
  }

  // --- Initialize App ---
  function init() {
    setupEventListeners();

    const savedGame = checkResumeOption();
    const rememberedNames = getRememberedPlayerNames();
    renderPlayerInputs(rememberedNames);

    showScreen('start');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
