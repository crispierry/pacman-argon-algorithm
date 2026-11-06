# Argon Algorithm · Standalone Real-Time 1–256 Perfect-Score Pac-Man Solver

This repository contains the standalone **Argon Algorithm** (`src/players/argon/`, `src/players/argon.js`) and its technical architecture and qualification documentation (`docs/argon-architecture-brief.md`, `docs/argon-campaign-qualification.md`), separated from the Pac-Man game engine and evaluation harness.

Released under the [MIT License](LICENSE).

---

## Overview

The **Argon Algorithm** (`ARGON_PLAYER`, `createArgonRealtimePlayer`, `createArgonPlayer`, `createArgonStartState`) is a fully autonomous, real-time, state-driven Pac-Man solver that computes every move online by simulating forward from the current game state inside a background worker (`src/players/argon/score-v2-worker.js`) while delivering verified controls within the `16.5 ms` arcade frame deadline (`0.0057 ms` mean `beforeTick` latency, `0` missed actions across `989,573` ticks).

Across a continuous 1–256 real-time campaign (`seed = 5259587` / `0x504143`, `schedulerPhase = 42`), it is independently certified with **`perfectRealtime: true`**, achieving the theoretical maximum Pac-Man score of **3,333,180 cumulative points** (`333,180` displayed after the 1,000,000-point rollover) with **zero obligation losses**.

| Regime | Levels | Boards | Verified Outcome | Cumulative Score |
| :--- | :--- | :---: | :--- | ---: |
| **Sustained-Frightened Boards** | `1–16, 18` | `17 / 17` | `68 / 68` 4-ghost chains (`272` captures), `34 / 34` fruits, `0` deaths | `327,800 / 327,800` |
| **Zero-Frightened Normal Boards** | `17, 19–255` | `238 / 238` | All `244` pellets/board + `476 / 476` fruits (`5,000`-pt Keys), `0` deaths | `2,998,800 / 2,998,800` |
| **Split-Screen Finale** | `256` | `1 / 1` | All `150` collectible dots across 4 lives + `2` energizers + `5,000`-pt Key | `6,580 / 6,580` |
| **Full Continuous Real-Time Game** | **`1–256`** | **`256 / 256`** | **100% Perfect Pac-Man Score (`perfectRealtime: true`, `0` missed controls)** | **`3,333,180 / 3,333,180`** |

---

## Repository Contents

| Path | Description |
| :--- | :--- |
| **[`src/players/argon/`](src/players/argon/)** | Self-contained real-time candidate package (`score-realtime-controller.js`, `score-v2-worker.js`, `score-cleanup-shadow.js`, `argon-core.js`, and pinned physics modules). |
| **[`src/players/argon.js`](src/players/argon.js)** | Browser & CLI player entry point (`ARGON_PLAYER`, `createArgonRealtimePlayer`, `createArgonPlayer`, `createArgonStartState`). |
| **[`scripts/evaluate-argon.js`](scripts/evaluate-argon.js)** | Accelerated CLI evaluator for verifying independent boards or the full 1–256 continuous perfect game. |
| **[`tests/argon-player.test.js`](tests/argon-player.test.js)** | Multi-regime unit test suite (Level 1, 1-second High-Elroy Level 15, zero-frightened Level 19, split-screen Level 256, and candidate source integrity). |
| **[`docs/argon-architecture-brief.md`](docs/argon-architecture-brief.md)** | Detailed technical architecture brief explaining beam-search ghost herding, the 14-order active power solver, energizer-preserving staging, and real-time worker pipelining. |
| **[`docs/argon-campaign-qualification.md`](docs/argon-campaign-qualification.md)** | Certified 1x real-time campaign qualification report (`perfectRealtime: true`) and replay instructions. |
| **[`docs/product-brief.md`](docs/product-brief.md)** | Companion Autonomous Player Product Brief defining the rules, priorities, and verification requirements. |

---

## Integration into `pacman-harness`

To run and verify the Argon Algorithm against the clean-room `pacman-harness` repository:
1. Copy `src/players/argon/`, `src/players/argon.js`, `scripts/evaluate-argon.js`, and `tests/argon-player.test.js` into the corresponding directories of `pacman-harness`.
2. Run the multi-regime unit test suite, accelerated 1–256 evaluation, or independent 1x real-time campaign qualification:
   ```sh
   node --test tests/argon-player.test.js
   node scripts/evaluate-argon.js
   npm run evaluate:score:campaign -- --source src/players/argon --seed 5259587 --phase 42 --max-ticks 1500000 --output /tmp/pacman-argon-qualification
   ```
