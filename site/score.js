(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.YahtzeeScore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CATEGORIES = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'
  ];

  const UPPER_CATEGORIES = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const LOWER_CATEGORIES = ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance'];

  const UPPER_MAP = {
    ones: 1,
    twos: 2,
    threes: 3,
    fours: 4,
    fives: 5,
    sixes: 6
  };

  function sum(dice) {
    return dice.reduce((a, b) => a + b, 0);
  }

  function getCounts(dice) {
    const counts = {};
    for (const d of dice) {
      counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }

  function scoreCategory(category, dice) {
    if (UPPER_MAP[category] !== undefined) {
      const val = UPPER_MAP[category];
      return dice.filter(d => d === val).reduce((a, b) => a + b, 0);
    }

    const countsObj = getCounts(dice);
    const countValues = Object.values(countsObj);

    switch (category) {
      case 'threeKind': {
        return countValues.some(c => c >= 3) ? sum(dice) : 0;
      }
      case 'fourKind': {
        return countValues.some(c => c >= 4) ? sum(dice) : 0;
      }
      case 'fullHouse': {
        const sortedCounts = [...countValues].sort((a, b) => a - b);
        if (
          (sortedCounts.length === 1 && sortedCounts[0] === 5) ||
          (sortedCounts.length === 2 && sortedCounts[0] === 2 && sortedCounts[1] === 3)
        ) {
          return 25;
        }
        return 0;
      }
      case 'smallStraight': {
        const set = new Set(dice);
        const has1234 = set.has(1) && set.has(2) && set.has(3) && set.has(4);
        const has2345 = set.has(2) && set.has(3) && set.has(4) && set.has(5);
        const has3456 = set.has(3) && set.has(4) && set.has(5) && set.has(6);
        return (has1234 || has2345 || has3456) ? 30 : 0;
      }
      case 'largeStraight': {
        const set = new Set(dice);
        const has12345 = set.has(1) && set.has(2) && set.has(3) && set.has(4) && set.has(5);
        const has23456 = set.has(2) && set.has(3) && set.has(4) && set.has(5) && set.has(6);
        return (has12345 || has23456) ? 40 : 0;
      }
      case 'yahtzee': {
        return countValues.some(c => c === 5) ? 50 : 0;
      }
      case 'chance': {
        return sum(dice);
      }
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }

  function upperBonus(upperSum) {
    return upperSum >= 63 ? 35 : 0;
  }

  function totals(card) {
    let upper = 0;
    for (const cat of UPPER_CATEGORIES) {
      if (typeof card[cat] === 'number') {
        upper += card[cat];
      }
    }
    const bonus = upperBonus(upper);

    let lower = 0;
    for (const cat of LOWER_CATEGORIES) {
      if (typeof card[cat] === 'number') {
        lower += card[cat];
      }
    }
    if (typeof card.yahtzeeBonus === 'number') {
      lower += card.yahtzeeBonus * 100;
    }

    const total = upper + bonus + lower;
    return { upper, bonus, lower, total };
  }

  return {
    CATEGORIES,
    scoreCategory,
    upperBonus,
    totals
  };
});
