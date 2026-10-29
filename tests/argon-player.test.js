import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../src/game.js';
import * as rules from '../src/rules.js';
import { advancePlaybackTime } from '../src/playback-clock.js';
import { createIndependentBoardStart } from '../scripts/score-independent-start.js';
import { ARGON_PLAYER, createArgonPlayer } from '../src/players/argon.js';

function runIndependentLevel(level) {
  const { state } = createIndependentBoardStart(level, { game, rules });
  const player = createArgonPlayer(state);
  if (state.phase === 'ready') game.startGame(state);
  player.observeInitial(state, game.drainEvents(state));
  let safety = 0;
  while (state.level === level && state.phase !== 'game-over' && safety < 5000) {
    let cursor = 0;
    advancePlaybackTime(state, 0.099, 8, {
      beforeTick(s) {
        cursor = s.events.length;
        const input = player.beforeTick(s);
        if (input !== null) game.requestDirection(s, input);
      },
      afterTick(s) {
        player.afterTick(s, s.events.slice(cursor));
      }
    });
    game.drainEvents(state);
    safety++;
  }
  return { state, diagnostics: player.diagnostics() };
}

test('Argon player metadata and controller lifecycle', () => {
  assert.equal(ARGON_PLAYER.id, 'argon');
  assert.equal(ARGON_PLAYER.name, 'Argon Algorithm');
  const state = game.createGame({ seed: 0x504143, schedulerPhase: 42 });
  const player = createArgonPlayer(state);
  assert.equal(player.diagnostics().player, ARGON_PLAYER);
  assert.equal(player.diagnostics().errors, 0);
  player.dispose();
});

test('Argon player achieves perfect score on Level 1', () => {
  const { state, diagnostics } = runIndependentLevel(1);
  assert.equal(state.level, 2);
  assert.equal(state.score, 14800);
  assert.equal(diagnostics.ledger.pointsEarned, 14800);
  assert.equal(diagnostics.ledger.deaths, 0);
  assert.equal(diagnostics.ledger.completeness, 'complete-history');
});

test('Argon player achieves perfect score on 1-second High-Elroy Level 15', () => {
  const { state, diagnostics } = runIndependentLevel(15);
  assert.equal(state.level, 16);
  assert.equal(state.score, 24600);
  assert.equal(diagnostics.ledger.pointsEarned, 24600);
  assert.equal(diagnostics.ledger.deaths, 0);
  assert.equal(diagnostics.ledger.losses.length, 0);
});

test('Argon player achieves perfect score on zero-frightened Level 19', () => {
  const { state, diagnostics } = runIndependentLevel(19);
  assert.equal(state.level, 20);
  assert.equal(state.score, 12600);
  assert.equal(diagnostics.ledger.pointsEarned, 12600);
  assert.equal(diagnostics.ledger.deaths, 0);
  assert.equal(diagnostics.ledger.losses.length, 0);
});

test('Argon player achieves maximum possible score on split-screen Level 256', () => {
  const { state, diagnostics } = runIndependentLevel(256);
  assert.equal(state.phase, 'game-over');
  assert.equal(state.score, 6490);
  assert.equal(diagnostics.ledger.pointsEarned, 6490);
  assert.equal(diagnostics.ledger.board.scope, 'split-unsupported');
});
