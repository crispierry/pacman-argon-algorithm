# Argon Algorithm · Standalone 1–256 Continuous Perfect-Score Pac-Man Solver

This repository contains the standalone **Argon Algorithm** (`src/players/argon.js`) and its technical architecture documentation (`docs/argon-architecture-brief.md`), separated from the Pac-Man game engine and evaluation harness.

Released under the [MIT License](LICENSE).

---

## Overview

The **Argon Algorithm** (`ARGON_PLAYER`, `createArgonPlayer`, `createArgonStartState`) is a fully autonomous, state-driven Pac-Man solver that computes every move online by simulating forward from the current game state. Across a continuous 1–256 run (`seed = 0x504143`, `schedulerPhase = 42`), it achieves the theoretical maximum Pac-Man score of **3,333,180 cumulative points** (`333,180` displayed after the 1,000,000-point rollover) with **zero obligation losses**.

| Regime | Levels | Boards | Verified Outcome | Cumulative Score |
| :--- | :--- | :---: | :--- | ---: |
| **Sustained-Frightened Boards** | `1–16, 18` | `17 / 17` | `68 / 68` 4-ghost chains (`272` captures), `34 / 34` fruits, `0` deaths | `327,800 / 327,800` |
| **Zero-Frightened Normal Boards** | `17, 19–255` | `238 / 238` | All `244` pellets/board + `476 / 476` fruits (`5,000`-pt Keys), `0` deaths | `2,998,800 / 2,998,800` |
| **Split-Screen Finale** | `256` | `1 / 1` | All `150` collectible dots across 4 lives + `2` energizers + `5,000`-pt Key | `6,580 / 6,580` |
| **Full Continuous Game** | **`1–256`** | **`256 / 256`** | **100% Perfect Pac-Man Score (`333,180` displayed after rollover)** | **`3,333,180 / 3,333,180`** |

---

## Repository Contents

| File | Description |
| :--- | :--- |
| **[`src/players/argon.js`](src/players/argon.js)** | Complete standalone Argon Algorithm implementation (`ARGON_PLAYER`, `createArgonPlayer`, `createArgonStartState`). |
| **[`scripts/evaluate-argon.js`](scripts/evaluate-argon.js)** | CLI evaluator for verifying independent boards or the full 1–256 continuous perfect game. |
| **[`tests/argon-player.test.js`](tests/argon-player.test.js)** | Multi-regime unit test suite (Level 1, 1-second High-Elroy Level 15, zero-frightened Level 19, and split-screen Level 256). |
| **[`docs/argon-architecture-brief.md`](docs/argon-architecture-brief.md)** | Detailed technical architecture brief explaining the algorithm's beam-search ghost herding, 14-order active power solver, energizer-preserving staging, and accumulator synchronization. |
| **[`docs/product-brief.md`](docs/product-brief.md)** | Companion Autonomous Player Product Brief defining the rules, priorities, and verification requirements. |

---

## Integration into `pacman-harness`

To run and verify the Argon Algorithm against the clean-room `pacman-harness` repository:
1. Copy `src/players/argon.js`, `scripts/evaluate-argon.js`, and `tests/argon-player.test.js` into the corresponding directories of `pacman-harness`.
2. Run the multi-regime unit test suite or full 1–256 continuous evaluation:
   ```sh
   node --test tests/argon-player.test.js
   node scripts/evaluate-argon.js
   ```
