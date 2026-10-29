const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('../site/game.js');
const { bestCategory, chooseHolds } = require('../site/bot.js');

function seeded(seed) {
  return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

test('bestCategory takes a yahtzee', () => {
  const g = newGame(['Bot']);
  g.dice = [4, 4, 4, 4, 4];
  assert.equal(bestCategory(g), 'yahtzee');
});

test('bestCategory only returns open categories', () => {
  const g = newGame(['Bot']);
  g.dice = [4, 4, 4, 4, 4];
  g.players[0].card.yahtzee = 50;
  assert.notEqual(bestCategory(g), 'yahtzee');
});

test('chooseHolds keeps a made yahtzee and a four of a kind', () => {
  const g = newGame(['Bot']);
  g.dice = [3, 3, 3, 3, 3];
  assert.deepEqual(chooseHolds(g, seeded(1)), [true, true, true, true, true]);
  g.dice = [6, 6, 6, 6, 2];
  assert.deepEqual(chooseHolds(g, seeded(2)).slice(0, 4), [true, true, true, true]);
});

test('chooseHolds keeps a large straight', () => {
  const g = newGame(['Bot']);
  g.dice = [1, 2, 3, 4, 5];
  assert.deepEqual(chooseHolds(g, seeded(3)), [true, true, true, true, true]);
});
