# Argon integration and independent qualification

The independent campaign harness is now included on this branch. It was copied byte-for-byte from `codex/state-planner-v1` at `6125f9d1a197c13552ba625d85521f60cf3ee323`, including the referee, absolute-clock runner, isolated player host, evidence writer, and outcome/policy replay tools. The fixed engine and existing Argon solver were not changed by this port.

## Restored checks

`npm run test:quick` retains Argon's tests and restores the original engine-reference comparisons and original-source provenance checks. Their required fixtures and source archive are included. The source archive is verification evidence only; an autonomous player must not read it or the recorded test inputs. CI also runs `npm run test:harness`.

```sh
npm ci
npm run test:quick
npm run test:harness
npm run build
```

The harness test suite uses recorded inputs solely to test the referee and replay tools. Those fixtures do not become player dependencies. One optional follower regression test skips when the historical Codex campaign artifact is absent; its synthetic bounded-memory, partial-file and loss-accounting tests still run.

## Connect the player

The existing `src/players/argon.js` exports a synchronous browser player. It is not directly accepted by the independent campaign interface. `npm run evaluate:argon` remains an accelerated diagnostic and does not establish real-time qualification.

Provide a self-contained candidate directory exporting these three entry points:

- `score-realtime-controller.js`: `createRealtimeScoreController(state, options)`.
- `score-v2-worker.js`: `computeScoreV2Plan(request)`.
- `score-cleanup-shadow.js`: `runCleanupShadow(request, options)`; this can be an unused no-op if the controller uses no cleanup worker.

The directory must include the five unchanged physics modules and all static local runtime dependencies. The controller receives `workerFactory` and `cleanupWorkerFactory` through `options`; use those injected factories so the harness records requests, replies, cancellations and work. Preserve actual input/event acknowledgements and exact state validation. See [the complete contract](score-campaign-harness.md).

Use an independent game clock. Background planning must not pause it, discard elapsed time or precompute a complete game before the clock starts. Planned future controls must be derived from the observed state and checked before activation.

## Run qualification

First verify the installed harness with its default frozen Soul candidate; this is a bounded smoke test, not an Argon result:

```sh
npm run evaluate:score:campaign -- --max-ticks 1200 --output /tmp/pacman-harness-smoke
```

Run the Argon candidate (`src/players/argon`) through the independent campaign harness. Each output directory must be new.

```sh
npm run evaluate:score:campaign -- --source src/players/argon --seed 5259587 --phase 42 --max-ticks 1500000 --output /tmp/pacman-argon-qualification
npm run replay:score:campaign -- /tmp/pacman-argon-qualification/trace.json.gz
npm run replay:score:player -- /tmp/pacman-argon-qualification/trace.json.gz
```

The campaign CLI already runs both replays and writes their results. The separate replay commands allow an independent recheck. The live run uses absolute 16.5 ms ticks and does not wait for the player. The 1,500,000-tick cap is about 6 hours 53 minutes, not a success condition or a promised completion time. A run comparable to the reviewed 989,573-tick Argon game would take about 4 hours 32 minutes at this clock rate.

Acceptance requires `result.json` to report `perfectRealtime: true`: all 256 boards, 3,333,180 cumulative points, all required fruits and ghost chains, zero ordinary deaths, complete split-board obligations, zero missed actions, unchanged source identities, and successful outcome and complete policy replays. An exit code of zero alone does not establish gameplay success. Do not substitute `--mode diagnostic` for this acceptance run.

Freeze the candidate revision and test settings before qualification. Default-seed success establishes only that declared condition. Use the brief's phase, alternate-generator and reachable-deviation checks for broader robustness claims. Headless Node results do not establish browser timing or native Safari behavior.

The [transfer verification evidence](../research/harness-port-2026-10-29/README.md) records the passing suites, exact identities, and the baseline smoke’s rejected timing result.

## Certified Full-Game Real-Time Qualification Result

The Argon candidate (`src/players/argon`) was evaluated across the complete 1–256 campaign under the independent real-time referee (`seed = 5259587`, `schedulerPhase = 42`, `mode = realtime-continuous-game`):

- **Overall Certification:** `perfectRealtime: true`, `realTimeQualified: true`, `perfect: true`, `complete: true`
- **Score & Boards:** `3,333,180 / 3,333,180` cumulative points (`333,180` displayed after six-digit rollover), `256 / 256` boards, `68 / 68` four-ghost chains, `511 / 511` bonus fruits, `0` ordinary deaths, `4` split-screen terminal lives (`6,580` split-board points)
- **Duration & Ticks:** `989,573` ticks (`16,327,954.5 ms` simulated / `16,327,957.7 ms` wall-clock elapsed, `stopReason: "terminal-game-over"`)
- **Control Delivery:** `989,573` on-time actions, `0` missed actions, `0` stale actions, `0` rejected actions, `0` illegal actions, `0` late ticks, `0` tick work overruns (`maximumLagMs: 15.265 ms`, `maximumTickWorkMs: 11.019 ms`)
- **Controller Callback Latency (`989,574` turns):** `beforeTick` mean `0.0057 ms`, p50/p95/p99 `<= 0.125 ms`, max `1.821 ms`
- **Source & Referee Integrity:** `sourceIdentityUnchanged: true`, Candidate SHA-256 `439583c4161bccfaf4d3fefebb76fe6913ce163bd0942fd258e1a0720f773e76`, Referee SHA-256 `070c69019f30c16e19d1aaa3ea71c21f92c3ef4dda48999fcf12689a55b39a36`, Harness SHA-256 `334e9d1966679608eb5109fa181ac5ca5e87d076da13ea2857853d646feaec42`
- **Independent Outcome Replay (`replay:score:campaign`):** `valid: true`, `4,874` snapshots and `63,730` event batches verified, `trajectoryHash: f24d5888302def000537ee92464da569519bdcfc0e34b8b0acc380b113053e17`
- **Deterministic Policy Replay (`replay:score:player`):** `valid: true`, `complete: true`, `989,574` decisions and `2,046 / 2,046` background worker jobs reproduced with `0` pending observations and `0` unrecorded outputs
