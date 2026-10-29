(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.YahtzeeUI = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LAYOUT = {
    left: ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'],
    right: ['threeKind', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yahtzee', 'chance']
  };

  const TILES = {
    ones: { kind: 'pips', face: 1, label: 'Ones' },
    twos: { kind: 'pips', face: 2, label: 'Twos' },
    threes: { kind: 'pips', face: 3, label: 'Threes' },
    fours: { kind: 'pips', face: 4, label: 'Fours' },
    fives: { kind: 'pips', face: 5, label: 'Fives' },
    sixes: { kind: 'pips', face: 6, label: 'Sixes' },
    threeKind: { kind: 'text', text: '3x', label: 'Three of a Kind' },
    fourKind: { kind: 'text', text: '4x', label: 'Four of a Kind' },
    fullHouse: { kind: 'icon', label: 'Full House' },
    smallStraight: { kind: 'text', text: 'SMALL', label: 'Small Straight' },
    largeStraight: { kind: 'text', text: 'LARGE', label: 'Large Straight' },
    yahtzee: { kind: 'text', text: 'YAHTZEE', label: 'Yahtzee' },
    chance: { kind: 'text', text: '?', label: 'Chance' }
  };

  const PIP_MAP = {
    1: [4],
    2: [2, 6],
    3: [2, 4, 6],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  function pipLayout(face) {
    if (!Number.isInteger(face) || face < 1 || face > 6) {
      throw new Error(`Invalid die face: ${face}`);
    }
    return PIP_MAP[face];
  }

  function upperProgress(card) {
    const c = card || {};
    let sum = 0;
    for (const key of LAYOUT.left) {
      if (typeof c[key] === 'number') {
        sum += c[key];
      }
    }
    const target = 63;
    const remaining = Math.max(0, target - sum);
    const bonusEarned = sum >= target;
    return { sum, target, remaining, bonusEarned };
  }

  function rollPips(rollsLeft) {
    const usedCount = Math.max(0, Math.min(3, 3 - rollsLeft));
    return [
      { n: 1, used: usedCount >= 1 },
      { n: 2, used: usedCount >= 2 },
      { n: 3, used: usedCount >= 3 }
    ];
  }

  function initials(name) {
    if (typeof name !== 'string') return '?';
    const trimmed = name.trim();
    if (!trimmed) return '?';
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) {
      const chars = Array.from(words[0]);
      return chars[0] ? chars[0].toUpperCase() : '?';
    }
    const firstChar = Array.from(words[0])[0];
    const secondChar = Array.from(words[1])[0];
    return (firstChar ? firstChar.toUpperCase() : '') + (secondChar ? secondChar.toUpperCase() : '');
  }

  return {
    LAYOUT,
    TILES,
    pipLayout,
    upperProgress,
    rollPips,
    initials
  };
});
