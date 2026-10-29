import assert from 'node:assert/strict';
import * as game from '../src/game.js';
import * as rules from '../src/rules.js';
import { createArgonPlayer, createArgonStartState } from '../src/players/argon.js';

function expectedIndependentScore(level) {
  if (level === 256) return 6490;
  const r = rules.rulesForLevel(level);
  const chainScore = r.nominalPowerSeconds > 0 ? 12000 : 0;
  return 2600 + 2 * r.fruit.points + chainScore;
}

function runIndependent(levels) {
  const results = [];
  for (const level of levels) {
    const t0 = Date.now();
    const state = createArgonStartState(level, { seed: 0x504143, schedulerPhase: 42 });
    const player = createArgonPlayer(state);
    player.observeInitial(state, game.drainEvents(state));
    let ticks = 0;
    while (state.level === level && state.phase !== 'game-over' && ticks < 25000) {
      const input = player.beforeTick(state);
      if (input !== null) game.requestDirection(state, input);
      game.step(state, rules.STEP);
      player.afterTick(state, game.drainEvents(state));
      ticks++;
    }
    const ledger = player.diagnostics().ledger;
    const expected = expectedIndependentScore(level);
    const row = {
      level,
      cleared: level === 256 ? state.phase === 'game-over' : state.level === level + 1,
      pointsEarned: ledger.pointsEarned,
      expectedScore: expected,
      deaths: ledger.deaths,
      losses: ledger.losses.length,
      ticks,
      ms: Date.now() - t0
    };
    console.log(`Level ${level}: points=${row.pointsEarned}/${row.expectedScore}, cleared=${row.cleared}, deaths=${row.deaths}, ms=${row.ms}`);
    assert.equal(row.cleared, true, `Level ${level} did not finish cleanly`);
    assert.equal(row.pointsEarned, expected, `Level ${level} score mismatch`);
    assert.equal(row.losses, 0, `Level ${level} lost scoring obligations`);
    results.push(row);
  }
  return results;
}

function runContinuousFullGame() {
  const tStart = Date.now();
  const state = game.createGame({ seed: 0x504143, schedulerPhase: 42 });
  const player = createArgonPlayer(state);
  game.startGame(state);
  player.observeInitial(state, game.drainEvents(state));

  let prevLevel = 1;
  let levelStartMs = Date.now();
  let boardsCleared = 0;

  while (state.phase !== 'game-over') {
    const input = player.beforeTick(state);
    if (input !== null) game.requestDirection(state, input);
    game.step(state, rules.STEP);
    player.afterTick(state, game.drainEvents(state));

    if (state.level !== prevLevel || state.phase === 'game-over') {
      boardsCleared++;
      const ledger = player.diagnostics().ledger;
      if (prevLevel <= 21 || prevLevel % 25 === 0 || prevLevel >= 255 || state.phase === 'game-over') {
        console.log(
          `Stage ${String(prevLevel).padStart(3, ' ')} -> ${String(state.level).padStart(3, ' ')} (${state.phase}): ` +
          `cumulative=${ledger.pointsEarned.toLocaleString()}, displayed=${state.score.toLocaleString()}, ` +
          `lives=${state.lives}, losses=${ledger.losses.length}, ms=${Date.now() - levelStartMs}`
        );
      }
      prevLevel = state.level;
      levelStartMs = Date.now();
    }
  }

  const finalLedger = player.diagnostics().ledger;
  const summary = {
    boardsVerified: boardsCleared,
    finalPhase: state.phase,
    finalLevel: state.level,
    cumulativeScore: finalLedger.pointsEarned,
    displayedScore: state.score,
    obligationLosses: finalLedger.losses.length,
    elapsedSeconds: Number(((Date.now() - tStart) / 1000).toFixed(1))
  };
  console.log('\n=== ARGON 1-256 CONTINUOUS VERIFICATION SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  assert.equal(boardsCleared, 256);
  assert.equal(finalLedger.pointsEarned, 3333180);
  assert.equal(state.score, 333180);
  assert.equal(finalLedger.losses.length, 0);
}

const args = process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 256);
if (args.length > 0) {
  runIndependent(args);
} else {
  runContinuousFullGame();
}
