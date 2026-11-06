import { computeScoreV2Plan } from './argon-core.js';

export { computeScoreV2Plan };

if (typeof self !== 'undefined') {
  self.onmessage = event => {
    const request = event.data;
    try {
      const result = computeScoreV2Plan(request);
      self.postMessage({
        ...result,
        sessionId: request.sessionId,
        boardId: request.boardId,
        generation: request.generation,
        requestId: request.requestId,
        anchorTick: request.anchorTick,
        replyByTick: request.replyByTick,
        anchorStateKey: request.anchorStateKey,
        anchorLedgerKey: request.anchorLedgerKey
      });
    } catch (error) {
      self.postMessage({
        status: 'error',
        error: String(error?.message ?? error),
        sessionId: request?.sessionId,
        boardId: request?.boardId,
        generation: request?.generation,
        requestId: request?.requestId
      });
    }
  };
}
