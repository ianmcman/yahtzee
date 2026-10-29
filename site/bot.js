(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./score.js'));
  } else {
    root.YahtzeeBot = factory(root.YahtzeeScore);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  // Typical score per category over a full game; a category is worth (score - typical).
  const TYPICAL = {
    ones: 2.1, twos: 5.3, threes: 8.6, fours: 12.2, fives: 15.7, sixes: 19.2,
    threeKind: 21.7, fourKind: 13.1, fullHouse: 22.6, smallStraight: 29.5,
    largeStraight: 32.7, yahtzee: 16.9, chance: 22
  };

  function open(player) {
    return S.CATEGORIES.filter(c => player.card[c] === undefined);
  }

  function value(cat, dice) {
    return S.scoreCategory(cat, dice) - TYPICAL[cat];
  }

  function bestCategory(g) {
    const cats = open(g.players[g.current]);
    let best = cats[0], bv = -Infinity;
    for (const c of cats) {
      const v = value(c, g.dice);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  // Best of the open categories after rerolling the dice not in `keep`, averaged over samples.
  function chooseHolds(g, rng = Math.random, samples = 60) {
    const cats = open(g.players[g.current]);
    let bestMask = 0, bestV = -Infinity;
    for (let mask = 0; mask < 32; mask++) {
      let sum = 0;
      for (let s = 0; s < samples; s++) {
        const d = g.dice.map((v, i) => (mask >> i) & 1 ? v : Math.floor(rng() * 6) + 1);
        let top = -Infinity;
        for (const c of cats) top = Math.max(top, value(c, d));
        sum += top;
      }
      if (sum > bestV) { bestV = sum; bestMask = mask; }
    }
    return [0, 1, 2, 3, 4].map(i => Boolean((bestMask >> i) & 1));
  }

  return { bestCategory, chooseHolds };
});
