


export function completionFingerprint(state) {
  const {events, eventId, accumulator, pauseReason, suspendedPhase, ...game} = state;
  const data = JSON.stringify(game, (_key, value) => value instanceof Map ? [...value] : value);
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 2246822519);
  }
  return `${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`;
}
