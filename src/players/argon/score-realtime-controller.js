import * as game from './game.js';
import * as rules from './rules.js';
import { createObligationLedger } from './score-obligations.js';
import { canonicalStateKey } from './score-realtime-sync.js';
import {
  ARGON_PLAYER,
  fastClone,
  fastStateHash,
  createPlannerState,
  clonePlannerState,
  stepArgonDecision,
  chooseFastFallback
} from './argon-core.js';

export function createRealtimeScoreController(
  initialState,
  {
    workerFactory,
    cleanupWorkerFactory = null,
    sessionId = 'argon-v2',
    reuseWorker = true,
    maxQueuedTicks = 9000
  } = {}
) {
  if (typeof workerFactory !== 'function') {
    throw TypeError('A worker factory is required');
  }
  if (cleanupWorkerFactory !== null && typeof cleanupWorkerFactory !== 'function') {
    throw TypeError('cleanupWorkerFactory must be a function');
  }

  const ledger = createObligationLedger(initialState);
  let tick = 0;
  let epoch = 0;
  let boardId = initialState.level;
  let disposed = false;

  let activeQueue = [];
  let queueHead = 0;
  let tailTick = 0;
  let tailState = null;
  let tailStateKey = null;
  let tailPlanner = createPlannerState(initialState.level);
  let livePlanner = createPlannerState(initialState.level);
  let lastExecutedStep = null;
  let lastDecision = null;

  let worker = null;
  let inFlight = null;
  let nextRequestId = 0;

  let issued = 0;
  let accepted = 0;
  let stale = 0;
  let overrides = 0;
  let errors = 0;
  let recoveries = 0;
  let workersCreated = 0;
  let workerReuses = 0;
  let ignoredReplies = 0;
  const outcomes = {};

  function terminateWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    inFlight = null;
  }

  function invalidate(reason) {
    epoch++;
    terminateWorker();
    activeQueue = [];
    queueHead = 0;
    tailState = null;
    tailStateKey = null;
    lastExecutedStep = null;
    return reason;
  }

  function compactQueueIfNeeded() {
    if (queueHead >= 512 && queueHead * 2 >= activeQueue.length) {
      activeQueue = activeQueue.slice(queueHead);
      queueHead = 0;
    }
  }

  function appendWorkerReply(reply) {
    if (
      reply?.status !== 'ready' ||
      reply.anchorTick !== tailTick ||
      reply.anchorStateKey !== tailStateKey ||
      !Array.isArray(reply.steps) ||
      reply.steps.length === 0 ||
      !reply.endState ||
      typeof reply.endStateKey !== 'string' ||
      !reply.endPlanner
    ) {
      stale++;
      return false;
    }
    const len = reply.steps.length;
    for (let i = 0; i < len; i++) {
      const s = reply.steps[i];
      activeQueue.push({
        tick: reply.anchorTick + i,
        input: s.input,
        mode: s.mode,
        preHash: s.preHash,
        postHash: s.postHash,
        anchorStateKey: i === 0 ? reply.anchorStateKey : null,
        endStateKey: i === len - 1 ? reply.endStateKey : null,
        endPlanner: i === len - 1 ? clonePlannerState(reply.endPlanner) : null
      });
    }
    tailTick = reply.anchorTick + len;
    tailState = fastClone(reply.endState);
    tailStateKey = reply.endStateKey;
    tailPlanner = clonePlannerState(reply.endPlanner);
    accepted++;
    return true;
  }

  function seedFastPrefix(fromState, fromPlanner, startTick, maxSteps = 240) {
    const sim = fastClone(fromState);
    sim.accumulator = 0;
    game.drainEvents(sim);
    const ps = clonePlannerState(fromPlanner);
    const startKey = canonicalStateKey(sim);
    let count = 0;
    for (let i = 0; i < maxSteps; i++) {
      if (sim.phase === 'game-over') break;
      const dec = stepArgonDecision(sim, ps, { allowHeavySearch: false });
      if (dec.haltBeforeHeavy) break;
      const preHash = fastStateHash(sim);
      if (dec.input !== null) game.requestDirection(sim, dec.input);
      game.step(sim, rules.STEP);
      game.drainEvents(sim);
      const postHash = fastStateHash(sim);
      activeQueue.push({
        tick: startTick + i,
        input: dec.input,
        mode: dec.mode,
        preHash,
        postHash,
        anchorStateKey: i === 0 ? startKey : null,
        endStateKey: null,
        endPlanner: null
      });
      count++;
    }
    tailTick = startTick + count;
    tailState = sim;
    tailStateKey = count === 0 ? startKey : canonicalStateKey(sim);
    tailPlanner = ps;
    if (count > 0) {
      activeQueue[activeQueue.length - 1].endStateKey = tailStateKey;
      activeQueue[activeQueue.length - 1].endPlanner = clonePlannerState(ps);
    }
    return count;
  }

  function maybeRequestChunk() {
    const remainingQueued = activeQueue.length - queueHead;
    if (disposed || inFlight || !tailState || tailState.phase === 'game-over' || remainingQueued >= maxQueuedTicks) {
      return;
    }
    const requestId = ++nextRequestId;
    const request = {
      sessionId,
      boardId,
      generation: epoch,
      requestId,
      observedTick: tick,
      anchorTick: tailTick,
      replyByTick: tailTick + 2800,
      anchorStateKey: tailStateKey,
      anchorLedgerKey: 'argon-v2',
      maxChunkTicks: 480,
      snapshot: fastClone(tailState),
      plannerState: clonePlannerState(tailPlanner)
    };
    issued++;
    try {
      inFlight = request;
      if (!worker) {
        const instance = workerFactory();
        worker = instance;
        workersCreated++;
        instance.onmessage = event => {
          if (worker !== instance || disposed) return;
          const reply = event.data;
          const pending = inFlight;
          if (!pending || reply?.requestId !== pending.requestId) {
            ignoredReplies++;
            return;
          }
          inFlight = null;
          if (!reuseWorker || reply?.status === 'error') {
            terminateWorker();
          }
          const status = reply?.status ?? 'error';
          outcomes[status] = (outcomes[status] ?? 0) + 1;
          if (status !== 'ready') {
            if (status === 'error') errors++;
            return;
          }
          if (pending.anchorTick < tick) {
            stale++;
            return;
          }
          appendWorkerReply(reply);
        };
        instance.onerror = () => {
          if (worker !== instance) return;
          terminateWorker();
          if (!disposed) errors++;
        };
      } else {
        workerReuses++;
      }
      worker.postMessage(request);
    } catch {
      terminateWorker();
      errors++;
    }
  }

  return {
    beforeTick(state) {
      if (disposed) return null;
      boardId = state.level;

      if (tailState === null && activeQueue.length - queueHead === 0) {
        seedFastPrefix(state, livePlanner, tick, 240);
      }

      maybeRequestChunk();

      let stepRec = activeQueue[queueHead];
      if (stepRec) {
        const hashMatches = stepRec.tick === tick && stepRec.preHash === fastStateHash(state);
        const keyMatches = !stepRec.anchorStateKey || stepRec.anchorStateKey === canonicalStateKey(state);
        if (!hashMatches || !keyMatches) {
          stale++;
          invalidate('pre-checkpoint-mismatch');
          livePlanner = createPlannerState(state.level);
          livePlanner.cooldownSteps = 240;
          seedFastPrefix(state, livePlanner, tick, 240);
          maybeRequestChunk();
          stepRec = activeQueue[queueHead];
        }
      }

      if (!stepRec) {
        recoveries++;
        invalidate('queue-underflow-recovery');
        if (livePlanner.currentLevel !== state.level) {
          livePlanner = createPlannerState(state.level);
        }
        livePlanner.cooldownSteps = 240;
        seedFastPrefix(state, livePlanner, tick, 240);
        maybeRequestChunk();
        stepRec = activeQueue[queueHead];
      }

      if (stepRec && stepRec.tick === tick) {
        queueHead++;
        if (stepRec.endPlanner) {
          livePlanner = clonePlannerState(stepRec.endPlanner);
        }
        lastExecutedStep = stepRec;
        compactQueueIfNeeded();
        maybeRequestChunk();
        lastDecision = {
          tick,
          level: state.level,
          phase: state.phase,
          mode: stepRec.mode,
          input: stepRec.input,
          owner: 'planned'
        };
        return stepRec.input;
      }

      overrides++;
      const fallbackInput = chooseFastFallback(state);
      lastExecutedStep = null;
      lastDecision = {
        tick,
        level: state.level,
        phase: state.phase,
        mode: 'fallback',
        input: fallbackInput,
        owner: 'fallback'
      };
      return fallbackInput;
    },

    afterTick(state, events = [], ack = null) {
      if (disposed) return;
      ledger.observe(events, state, tick);
      boardId = state.level;

      if (lastExecutedStep) {
        const appliedMismatch = ack && ack.appliedInput !== undefined && ack.appliedInput !== lastExecutedStep.input;
        const postHashMismatch = fastStateHash(state) !== lastExecutedStep.postHash;
        const endKeyMismatch = lastExecutedStep.endStateKey && canonicalStateKey(state) !== lastExecutedStep.endStateKey;
        if (appliedMismatch || postHashMismatch || endKeyMismatch) {
          stale++;
          invalidate('post-checkpoint-mismatch');
          livePlanner = createPlannerState(state.level);
          livePlanner.cooldownSteps = 240;
        }
        lastExecutedStep = null;
      }

      tick++;
    },

    observeInitial(state, events = []) {
      if (disposed) return;
      ledger.observe(events, state, tick);
      boardId = state.level;
      if (tick === 0 && tailState === null && activeQueue.length - queueHead === 0 && state.phase !== 'ready') {
        seedFastPrefix(state, livePlanner, tick, 240);
        if (activeQueue.length - queueHead > 0) {
          maybeRequestChunk();
        }
      }
    },

    decision() {
      return structuredClone(lastDecision);
    },

    transcript() {
      return [];
    },

    diagnostics() {
      const snap = ledger.snapshot();
      return {
        tick,
        epoch,
        player: ARGON_PLAYER,
        issued,
        accepted,
        stale,
        overrides,
        errors,
        recoveries,
        reuseWorker,
        workersCreated,
        workerReuses,
        ignoredReplies,
        workerAlive: !!worker,
        inFlightRequestId: inFlight?.requestId ?? null,
        queuedTicks: activeQueue.length - queueHead,
        outcomes: { ...outcomes },
        ledger: {
          completeness: snap.completeness,
          pointsEarned: snap.pointsEarned,
          deaths: snap.deaths,
          losses: snap.losses,
          board: snap.board,
          pastBoardsCount: snap.pastBoards.length
        },
        cleanup: { workerAlive: false }
      };
    },

    dispose() {
      disposed = true;
      invalidate('disposed');
    }
  };
}
