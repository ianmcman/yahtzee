const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, roll, toggleHold, score, isOver, winner } = require('../site/game.js');

const seq = (...v) => { let i = 0; return () => (v[i++ % v.length] - 1) / 6 + 0.01; }; // rng giving dice v

test('new game: 1 player cards empty, roll 0, turn 0', () => {
  const g = newGame(['Ann', 'Bob']);
  assert.equal(g.players.length, 2);
  assert.equal(g.current, 0);
  assert.equal(g.rollsLeft, 3);
  assert.deepEqual(g.players[0].card, {});
  assert.equal(g.players[0].name, 'Ann');
});
test('must roll before scoring or holding', () => {
  const g = newGame(['A']);
  assert.throws(() => score(g, 'chance'));
  assert.throws(() => toggleHold(g, 0));
});
test('roll uses injected rng and decrements rollsLeft', () => {
  const g = newGame(['A']);
  roll(g, seq(1,2,3,4,5));
  assert.deepEqual(g.dice, [1,2,3,4,5]);
  assert.equal(g.rollsLeft, 2);
});
test('held dice are kept on re-roll', () => {
  const g = newGame(['A']);
  roll(g, seq(6,6,1,1,1));
  toggleHold(g, 0); toggleHold(g, 1);
  roll(g, seq(2,3,4));
  assert.deepEqual(g.dice, [6,6,2,3,4]);
});
test('no fourth roll', () => {
  const g = newGame(['A']);
  roll(g); roll(g); roll(g);
  assert.throws(() => roll(g));
});
test('scoring writes the card, ends the turn, clears holds, passes to next player', () => {
  const g = newGame(['A', 'B']);
  roll(g, seq(5,5,5,5,5));
  score(g, 'yahtzee');
  assert.equal(g.players[0].card.yahtzee, 50);
  assert.equal(g.current, 1);
  assert.equal(g.rollsLeft, 3);
  assert.deepEqual(g.held, [false,false,false,false,false]);
});
test('cannot score a used category', () => {
  const g = newGame(['A']);
  roll(g); score(g, 'chance');
  roll(g);
  assert.throws(() => score(g, 'chance'));
});
test('extra yahtzee adds 100 bonus', () => {
  const g = newGame(['A']);
  roll(g, seq(2,2,2,2,2)); score(g, 'yahtzee');
  roll(g, seq(3,3,3,3,3)); score(g, 'threes');
  assert.equal(g.players[0].card.yahtzeeBonus, 1);
});
test('game ends after 13 turns each and picks the winner', () => {
  const g = newGame(['A', 'B']);
  const cats = ['ones','twos','threes','fours','fives','sixes','threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
  for (const c of cats) {
    roll(g, seq(1,1,1,1,1)); score(g, c);   // A: all ones
    roll(g, seq(6,6,6,6,6)); score(g, c);   // B: all sixes
  }
  assert.equal(isOver(g), true);
  assert.equal(winner(g).name, 'B');
  assert.throws(() => roll(g));
});
