const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES, scoreCategory, upperBonus, totals } = require('../site/score.js');

test('category list is the 13 standard ones in order', () => {
  assert.deepEqual(CATEGORIES, ['ones','twos','threes','fours','fives','sixes',
    'threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance']);
});
test('upper section sums matching dice', () => {
  assert.equal(scoreCategory('threes', [3,3,1,3,6]), 9);
  assert.equal(scoreCategory('sixes', [1,2,3,4,5]), 0);
});
test('n of a kind', () => {
  assert.equal(scoreCategory('threeKind', [2,2,2,5,6]), 17);
  assert.equal(scoreCategory('threeKind', [2,2,3,5,6]), 0);
  assert.equal(scoreCategory('fourKind', [4,4,4,4,1]), 17);
  assert.equal(scoreCategory('fourKind', [4,4,4,1,1]), 0);
  assert.equal(scoreCategory('fourKind', [5,5,5,5,5]), 25);
});
test('full house is 25, and a yahtzee also counts', () => {
  assert.equal(scoreCategory('fullHouse', [2,2,3,3,3]), 25);
  assert.equal(scoreCategory('fullHouse', [2,2,3,3,4]), 0);
  assert.equal(scoreCategory('fullHouse', [6,6,6,6,6]), 25);
});
test('straights', () => {
  assert.equal(scoreCategory('smallStraight', [1,2,3,4,6]), 30);
  assert.equal(scoreCategory('smallStraight', [3,4,5,6,6]), 30);
  assert.equal(scoreCategory('smallStraight', [1,2,3,5,6]), 0);
  assert.equal(scoreCategory('largeStraight', [2,3,4,5,6]), 40);
  assert.equal(scoreCategory('largeStraight', [1,2,3,4,6]), 0);
});
test('yahtzee is 50, chance is the sum', () => {
  assert.equal(scoreCategory('yahtzee', [1,1,1,1,1]), 50);
  assert.equal(scoreCategory('yahtzee', [1,1,1,1,2]), 0);
  assert.equal(scoreCategory('chance', [1,2,3,4,6]), 16);
});
test('dice order does not matter', () => {
  assert.equal(scoreCategory('fullHouse', [3,2,3,2,3]), 25);
});
test('upper bonus is 35 at 63 or more', () => {
  assert.equal(upperBonus(63), 35);
  assert.equal(upperBonus(62), 0);
});
test('totals', () => {
  const card = { ones:3, twos:6, threes:9, fours:12, fives:15, sixes:18, chance:20, yahtzee:50 };
  assert.deepEqual(totals(card), { upper: 63, bonus: 35, lower: 70, total: 168 });
  assert.deepEqual(totals({}), { upper: 0, bonus: 0, lower: 0, total: 0 });
});
test('extra yahtzee bonus: 100 each after a scored 50', () => {
  const card = { yahtzee: 50, yahtzeeBonus: 2 };
  assert.equal(totals(card).lower, 250);
});
