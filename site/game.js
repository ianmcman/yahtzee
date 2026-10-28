(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const scoreModule = require('./score.js');
    module.exports = factory(scoreModule);
  } else {
    root.YahtzeeGame = factory(root.YahtzeeScore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (scoreModule) {
  const { CATEGORIES, scoreCategory, totals } = scoreModule;

  function newGame(playerNames) {
    if (!playerNames || !playerNames.length) {
      throw new Error('Must provide at least one player');
    }
    return {
      players: playerNames.map(name => ({
        name,
        card: {}
      })),
      current: 0,
      rollsLeft: 3,
      dice: [1, 1, 1, 1, 1],
      held: [false, false, false, false, false]
    };
  }

  function roll(g, rng = Math.random) {
    if (isOver(g)) {
      throw new Error('Game is over');
    }
    if (g.rollsLeft <= 0) {
      throw new Error('No rolls left');
    }
    for (let i = 0; i < 5; i++) {
      if (!g.held[i]) {
        g.dice[i] = Math.floor(rng() * 6) + 1;
      }
    }
    g.rollsLeft--;
    return g;
  }

  function toggleHold(g, index) {
    if (isOver(g)) {
      throw new Error('Game is over');
    }
    if (g.rollsLeft === 3) {
      throw new Error('Must roll before holding');
    }
    if (index < 0 || index >= 5) {
      throw new Error('Invalid die index');
    }
    g.held[index] = !g.held[index];
    return g;
  }

  function score(g, category) {
    if (isOver(g)) {
      throw new Error('Game is over');
    }
    if (g.rollsLeft === 3) {
      throw new Error('Must roll before scoring');
    }
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}`);
    }
    const player = g.players[g.current];
    if (player.card[category] !== undefined) {
      throw new Error('Category already scored');
    }

    const isYahtzee = scoreCategory('yahtzee', g.dice) === 50;
    if (isYahtzee && player.card.yahtzee === 50) {
      player.card.yahtzeeBonus = (player.card.yahtzeeBonus || 0) + 1;
    }

    player.card[category] = scoreCategory(category, g.dice);
    g.rollsLeft = 3;
    g.held = [false, false, false, false, false];

    if (!isOver(g)) {
      g.current = (g.current + 1) % g.players.length;
    }
    return g;
  }

  function isOver(g) {
    return g.players.length > 0 && g.players.every(p => {
      return CATEGORIES.every(cat => typeof p.card[cat] === 'number');
    });
  }

  function winner(g) {
    let best = null;
    let bestScore = -Infinity;
    for (const p of g.players) {
      const t = totals(p.card).total;
      if (t > bestScore) {
        bestScore = t;
        best = p;
      }
    }
    return best;
  }

  return {
    newGame,
    roll,
    toggleHold,
    score,
    isOver,
    winner
  };
});
