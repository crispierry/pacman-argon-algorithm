import { ARGON_PLAYER, createArgonStartState, computeScoreV2Plan } from './argon/argon-core.js';
import { createRealtimeScoreController } from './argon/score-realtime-controller.js';

export { ARGON_PLAYER, createArgonStartState };

function createSyncWorkerFactory() {
  return () => {
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage(request) {
        try {
          const result = computeScoreV2Plan(request);
          worker.onmessage?.({
            data: {
              ...result,
              sessionId: request.sessionId,
              boardId: request.boardId,
              generation: request.generation,
              requestId: request.requestId,
              anchorTick: request.anchorTick,
              replyByTick: request.replyByTick,
              anchorStateKey: request.anchorStateKey,
              anchorLedgerKey: request.anchorLedgerKey
            }
          });
        } catch (error) {
          worker.onmessage?.({
            data: {
              status: 'error',
              error: String(error?.message ?? error),
              sessionId: request?.sessionId,
              boardId: request?.boardId,
              generation: request?.generation,
              requestId: request?.requestId
            }
          });
        }
      },
      terminate() {}
    };
    return worker;
  };
}

export function createArgonRealtimePlayer(state, options = {}) {
  return createRealtimeScoreController(state, {
    workerFactory: () => new Worker(new URL('./argon/score-v2-worker.js', import.meta.url), { type: 'module' }),
    ...options
  });
}

export function createArgonPlayer(state, options = {}) {
  return createRealtimeScoreController(state, {
    workerFactory: createSyncWorkerFactory(),
    ...options
  });
}
