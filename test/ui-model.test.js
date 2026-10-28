const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES } = require('../site/score.js');
const { LAYOUT, TILES, pipLayout, upperProgress, rollPips, initials } = require('../site/ui-model.js');

test('layout: upper section on the left, lower section on the right, every category once', () => {
  assert.deepEqual(LAYOUT.left, ['ones','twos','threes','fours','fives','sixes']);
  assert.deepEqual(LAYOUT.right, ['threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance']);
  assert.deepEqual([...LAYOUT.left, ...LAYOUT.right].sort(), [...CATEGORIES].sort());
});
test('tiles: one per category with a kind and a label', () => {
  assert.deepEqual(Object.keys(TILES).sort(), [...CATEGORIES].sort());
  for (const c of LAYOUT.left) { assert.equal(TILES[c].kind, 'pips'); assert.ok(TILES[c].face >= 1 && TILES[c].face <= 6); }
  assert.deepEqual(LAYOUT.left.map(c => TILES[c].face), [1,2,3,4,5,6]);
  assert.equal(TILES.threeKind.text, '3x');
  assert.equal(TILES.fourKind.text, '4x');
  assert.equal(TILES.smallStraight.text, 'SMALL');
  assert.equal(TILES.largeStraight.text, 'LARGE');
  assert.equal(TILES.yahtzee.text, 'YAHTZEE');
  assert.equal(TILES.chance.text, '?');
  assert.equal(TILES.fullHouse.kind, 'icon');
  for (const c of CATEGORIES) assert.ok(typeof TILES[c].label === 'string' && TILES[c].label.length > 2, c);
});
test('pip layouts use a 3x3 grid, cells numbered 0 to 8 row by row', () => {
  assert.deepEqual(pipLayout(1), [4]);
  assert.deepEqual(pipLayout(2), [2, 6]);
  assert.deepEqual(pipLayout(3), [2, 4, 6]);
  assert.deepEqual(pipLayout(4), [0, 2, 6, 8]);
  assert.deepEqual(pipLayout(5), [0, 2, 4, 6, 8]);
  assert.deepEqual(pipLayout(6), [0, 2, 3, 5, 6, 8]);
  assert.throws(() => pipLayout(0));
  assert.throws(() => pipLayout(7));
});
test('upper progress toward the 63 point bonus', () => {
  assert.deepEqual(upperProgress({}), { sum: 0, target: 63, remaining: 63, bonusEarned: false });
  assert.deepEqual(upperProgress({ ones: 3, twos: 6, chance: 20 }), { sum: 9, target: 63, remaining: 54, bonusEarned: false });
  assert.deepEqual(upperProgress({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 }), { sum: 63, target: 63, remaining: 0, bonusEarned: true });
  assert.equal(upperProgress({ sixes: 30, fives: 25, fours: 20 }).bonusEarned, true);
});
test('roll pips show how many of the three rolls are used', () => {
  assert.deepEqual(rollPips(3), [{ n: 1, used: false }, { n: 2, used: false }, { n: 3, used: false }]);
  assert.deepEqual(rollPips(2), [{ n: 1, used: true }, { n: 2, used: false }, { n: 3, used: false }]);
  assert.deepEqual(rollPips(0), [{ n: 1, used: true }, { n: 2, used: true }, { n: 3, used: true }]);
});
test('initials for the player badge', () => {
  assert.equal(initials('Ann Lee'), 'AL');
  assert.equal(initials('ian'), 'I');
  assert.equal(initials('  mary jane watson '), 'MJ');
  assert.equal(initials('   '), '?');
  assert.equal(initials('😀 Bob'), '😀B');
});
