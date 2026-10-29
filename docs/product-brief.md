# Pac Man autonomous player product brief

The project is to build an autonomous Pac-Man player that can **survive, complete the game and ultimately achieve the maximum score through decisions made from the current game state**.

The player should understand the game well enough to prepare opportunities, pursue them and recover when circumstances change. Its actions must come from observations and knowledge of the rules. Search, simulation, rules-based strategies and learned policies are all valid approaches. Following a recorded sequence of actions does not satisfy the autonomous-player goal.

This brief describes the intended product without prescribing an implementation or evaluating the players already built. Capability targets below are requirements, not claims about current performance.

## Product goal

We want two measurable capability levels:

- **Completion capability:** survive and clear levels 1–255 reliably, then handle level 256’s special terminal objective correctly.
- **Perfect-score capability:** accomplish that while collecting every required fruit and completing every eligible four-ghost capture opportunity.

The ultimate product combines both capabilities. A completion-capable player provides a useful baseline against which to evaluate scoring improvements.

The player must operate in real time. The game continues while it decides what to do. It may simulate alternatives on copies of the game state, but its computation must finish in time to control the running game.

There is **no objective to finish boards quickly**. The player may legally wait, circle or reposition to create a better opportunity. Patience is a strategic tool; computation responsiveness is an operational requirement.

## Winning and scoring

On an ordinary board, the game advances when Pac-Man consumes every dot and energizer. Fruit collection and ghost captures are additional requirements for our maximum-score objective.

| Item or event | Points |
|---|---:|
| Regular dot | 10 |
| Energizer | 50 |
| First ghost during one frightened period | 200 |
| Second ghost | 400 |
| Third ghost | 800 |
| Fourth ghost | 1,600 |
| Complete four-ghost chain | **3,000** |
| Fruit | 100–5,000, depending on level |

A normal board contains 240 regular dots and four energizers. It offers two fruit opportunities.

The fourth ghost is particularly valuable: its 1,600 points exceed the first three ghosts’ combined 1,400. A policy that collects nearby ghosts without planning the complete sequence can therefore leave much of the available score behind.

The first-board maximum is **14,800**. The default full-game maximum is **3,333,180 cumulative points**, including special handling of level 256. Different starting conditions, especially the lives available on entering level 256, change the appropriate target. The harness needs a cumulative score ledger because the displayed score wraps.

Contact with a dangerous ghost costs a life. Death can remove an active fruit, end a capture opportunity and change ghost-release conditions. Preserving lives matters for both survival and the eventual maximum score.

## Ordered priorities

| Priority | Required behavior |
|---|---|
| **1. Stay alive** | Preserve safe movement and escape options. |
| **2. Collect both fruits** | Reach each fruit before its opportunity is permanently lost. |
| **3. Capture all four distinct ghosts per eligible energizer** | Prepare and execute complete capture sequences. |
| **4. Collect remaining pellets and clear** | Finish while preserving higher priorities. |

These priorities resolve conflicts; they are not four isolated tasks performed in sequence. Collecting pellets triggers fruit and affects ghost releases and behavior. An energizer can support survival, fruit collection and ghost scoring simultaneously. The player should seek plans that satisfy these goals together.

If an opportunity is lost, the player should continue toward the best remaining outcome and record honestly that a perfect score is no longer attainable.

## Strategic behavior

- **Prepare before activating an energizer.** Account for ghost identities, positions, movement, release status, frightened duration, possible capture orders and escape options.
- **Intercept moving ghosts.** Distance to their current positions is insufficient; predict where they can be reached.
- **Use each ghost’s actual status.** Returning eyes are not a scoring target. A revived ghost may be dangerous while power remains active elsewhere.
- **Anticipate fruit.** Fruit triggers occur at 70 and 170 consumed collectibles, including energizers. Collection order affects how well Pac-Man can respond.
- **Coordinate fruit and captures.** A fruit spawn should prompt reassessment. Completing both objectives may still be feasible.
- **Preserve useful resources.** Even energizers with no sustained frightened interval can cause reversals and support escapes.
- **Finish maneuvers safely.** Four captures followed immediately by a death is not a successful maneuver.
- **Maintain coherent controls.** Retain useful intent while it remains valid, and reassess when danger or prediction errors require it. Repeated purposeless reversals are undesirable.

Waiting must use legal game actions; Pac-Man cannot simply stop anywhere. A waiting strategy needs a purpose, a desired future state and conditions for abandoning it. Endless circling fails completion even though board-clearing speed is not an objective.

## Timing and opportunities

Fruit lasts approximately 9–10 seconds in the local game, with its precise lifetime depending on the scheduler phase at spawn. The player should use authoritative remaining time rather than assume one fixed duration. Frightened duration varies by level; some boards provide only about one nominal second.

Different clocks behave differently:

- Ghost-capture pauses suspend the frightened countdown.
- Fruit lifetime continues decreasing during those pauses.
- Ghost-house release timing may continue.
- Releasing one housed ghost resets the timeout for the next.

A single elapsed-time counter cannot represent every deadline correctly.

Ghosts return, so waiting before energizer activation can help create a better opportunity. Each consumed energizer still represents one scoring opportunity: ghosts missed when its frightened period expires cannot restore those lost points later.

Eligible sustained frightened opportunities occur on levels **1–16 and 18**. Levels 17 and 19 onward have no sustained edible interval, though energizers retain strategic value.

## Available inputs

The primary interface should provide structured game state: a complete restorable snapshot for the harness and a simpler derived observation for the policy.

| Group | Information available to communicate |
|---|---|
| Board | Walls, corridors, junctions, tunnels, wrapping and legal connections, including actor-specific and directed edges. |
| Collectibles | Positions and types of remaining items, consumed and remaining counts, and whether the next collection clears the board. |
| Pac-Man | Subtile position, actual and requested direction, motion and effective speed, pending turns, and eating or movement delays. |
| Each ghost | Identity, subtile position, actual direction, speed and motion; frightened, housed, exiting, active or returning-eyes status; pending reversal. |
| Behavior context | Chase or scatter mode, targeting rules, mode timers, speed changes and pellet thresholds. |
| House release | Waiting identities and order, personal and global dot counters, inactivity timer and release conditions. |
| Energizer | Remaining power and warning interval, active energizer identity, chain count and distinct captured ghost identities. |
| Fruit | Position, value, lifetime, trigger progress and whether each opportunity is pending, active, collected or lost. |
| Game | Level and applicable rules, lives, cumulative and displayed score, bonus-life status, and phase such as play, capture, respawn or clear. |
| Synchronization | Tick and time, scheduler and movement phases, and board and life identities needed to reject stale decisions. |
| History | Prior actions and events, completed and lost opportunities, life changes and retained tactical intent. |

The player may also know the rules: ghost behavior, turning and collisions, speed profiles, fruit triggers, house release and level-specific timing. Nominal speed alone is insufficient; subtile positions, turns and delays affect whether a route or interception works.

If random-generator state or scheduler internals are exposed, declare that information budget explicitly. Compare policies with different information access separately. Inputs should represent the current state and known rules, without future recorded actions or evaluator routes.

## Harness responsibilities

The harness is the referee, laboratory and evidence recorder. It supplies the game, invokes the player and measures what actually happens. It should provide:

- An authoritative, versioned game model.
- A documented observation and legal-action interface.
- Reproducible starting conditions and restorable snapshots.
- A game clock that runs independently of planning.
- Action, event, decision and outcome logs.
- Independent replay verification.
- Matched comparisons between candidates and accepted baselines.

Actions use native directional controls, retaining a requested direction or using neutral input where supported. A player cannot alter coordinates, clocks, lives or resources. Predictions on cloned states are conditional on the model and assumed actions. Late planning results must be checked against the live state before use.

A failure should be reproducible from the full starting state, score and opportunity ledger, player memory, exact actions and timing, and the first point where prediction diverged or an opportunity was lost.

## Test modes

| Mode | Purpose |
|---|---|
| Mechanism tests | Verify movement, turns, contacts, clocks, scores and ghost release. |
| Scenario tests | Exercise specific known states, including legal deviations from successful runs. |
| Independent-level tests | Start each board from declared entry conditions and measure its outcome. |
| Continuous-game tests | Carry lives, score, random state, history and transitions naturally between boards. |
| Real-time tests | Measure actual computation and control deadlines while the game runs. |
| Generalization tests | Evaluate a frozen candidate on held-out seeds, phases and reachable conditions. |

Declare entry lives, score, phase and history. Unknown history must remain unknown rather than be fabricated. Controlled accelerated or fixed-delivery diagnostics should be reported separately from real-clock evidence.

Cover long, short and zero frightened periods, later-level speeds, life and board transitions, and level 256. First-board success is an early milestone, not evidence of full-game reliability.

## Metrics and reporting

For each board and run, record:

- Clear, deathless clear, game over, unfinished or the special terminal result.
- Death count and circumstances.
- Fruit collected, lost or pending, with reasons for losses.
- Complete four-distinct-ghost chains per eligible energizer.
- Partial captures and missed ghost identities.
- Actual cumulative score and the target appropriate to the entry conditions.
- Remaining collectibles and unresolved opportunities.
- Decision latency, missed deadlines, and stale or rejected responses.
- Total computation attempted, including failed discovery and verification work.
- Whether independent replay reproduces the result.

Distinguish earned points, points demonstrated by a particular forecast and an optimistic upper bound. A finite planner’s failure to find a solution does not establish impossibility. Short-term survival does not establish eventual safety.

A capped run is unfinished. Do not silently change caps or seeds to make results appear successful. Expose failures by level and rule family. Repeated trajectories are not independent strategies, and a sum of independent-level scores is not a continuous-game score.

## Level 256

Level 256 cannot be cleared like an ordinary board. Its objective is to collect the persistent items and fruit, collect the dots that regenerate per life, and use the remaining lives correctly to maximize the terminal score.

Track persistent collection separately from collection scoped to each life. Intentional death belongs only in the terminal policy after the relevant current-life collection is complete; it does not weaken the survival requirement on ordinary boards. The correct final outcome can be game over after maximum collection.

## Evidence required for success

Completion capability requires repeatable survival through levels 1–255, natural transitions and the correct split-board ending.

A default perfect continuous-game demonstration requires:

- Zero deaths on ordinary boards.
- All 510 ordinary-board fruits.
- All 68 eligible four-distinct-ghost chains, totaling 272 captures.
- Every ordinary-board collectible.
- Maximum collection on level 256 for the applicable entry conditions.
- A cumulative score of **3,333,180** under the default perfect-game conditions.
- Real-time operation without pausing for planning or following recorded routes.

Reliability requires a declared evaluation matrix and repeated evidence. Report success rates with their denominators and explicit information access and starting conditions.

The handoff deliverables are a written rules and observation contract, a reproducible harness, a trustworthy score and opportunity ledger, a player that makes decisions from current state, and inspectable evidence of successes and failures.
