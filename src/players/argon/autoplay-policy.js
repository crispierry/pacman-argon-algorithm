import {step, requestDirection, drainEvents} from './game.js';
import {canEnter, key, neighbor} from './maze.js';
import {STEP} from './rules.js';


const DIRECTIONS = ['up', 'left', 'down', 'right'];
const graphs = new Map();
function graphFor(variant) {
  if (graphs.has(variant)) return graphs.get(variant);
  const graph = new Map(), minY = variant === 'split-256' ? -1 : 0;
  for (let y = minY; y <= 30; y++) for (let x = -2; x <= 29; x++) {
    if (!canEnter(x, y, 'player', variant)) continue;
    graph.set(key(x, y), DIRECTIONS.map(dir => ({ dir, to: neighbor(x, y, dir, 'player', variant) })).filter(edge => edge.to));
  }
  graphs.set(variant, graph); return graph;
}



const distanceFields = new WeakMap();
function graphDistances(graph, start) {
  if (!graph.has(start)) return null;
  let cache = distanceFields.get(graph);
  if (!cache) { cache = new Map(); distanceFields.set(graph, cache); }
  if (cache.has(start)) return cache.get(start);
  const distances = new Map([[start, 0]]), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const edge of graph.get(queue[i]) ?? []) {
      const next = key(edge.to.x, edge.to.y);
      if (graph.has(next) && !distances.has(next)) {
        distances.set(next, distances.get(queue[i]) + 1); queue.push(next);
      }
    }
  }
  cache.set(start, distances); return distances;
}




export function chooseAutoplayDirection(state, { threatDistance = 8, horizon = 120, scoreSeeking = true, pursueFruit = scoreSeeking, pursueFrightened = scoreSeeking, rolloutReplanning = true, rolloutScoreSeeking = true, rolloutEnabled = true, lateLookahead = true, mazeThreats = false, reversalPenalty = 0, accurateAnchor = false, avoidReverse = false, dotReward = false, simulationBudget = null, workCounter = null } = {}) {
  if (simulationBudget !== null && (!Number.isSafeInteger(simulationBudget.remaining) || simulationBudget.remaining < 0)) throw RangeError('Invalid simulation budget');
  if (workCounter !== null && (!Number.isSafeInteger(workCounter.ticks) || workCounter.ticks < 0)) throw RangeError('Invalid simulation work counter');
  if (state.phase !== 'playing') return null;



  if (rolloutEnabled && lateLookahead && state.level >= 21 && threatDistance === 8 && horizon === 120) {
    threatDistance = 12; horizon = state.level >= 22 ? 360 : 240;
  }
  const variant = state.mazeVariant, graph = graphFor(variant), player = state.player;
  const anchor = player.next ?? { x: Math.round(player.x), y: Math.round(player.y) };
  if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.y)) return null;
  const start = key(anchor.x, anchor.y), edges = graph.get(start) ?? [];
  if (!edges.length) return null;
  const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[player.dir];
  const threats = state.ghosts.filter(ghost => ghost.status === 'active' && !ghost.frightened);
  const fields = mazeThreats ? threats.map(ghost => graphDistances(graph, key(Math.round(ghost.x), Math.round(ghost.y)))) : [];



  const betweenTiles = accurateAnchor && player.next && !player.turn;
  const remaining = betweenTiles ? Math.min(1, Math.abs(player.x - anchor.x) + Math.abs(player.y - anchor.y)) : 0;
  const queue = [{ node: start, cost: remaining, first: null }], bestCost = new Map([[start, remaining]]);
  if (betweenTiles) {
    const behind = neighbor(anchor.x, anchor.y, opposite, 'player', variant);
    if (behind) {
      const node = key(behind.x, behind.y), cost = 1 - remaining + (avoidReverse ? 10000 : reversalPenalty);
      queue.push({ node, cost, first: opposite }); bestCost.set(node, cost);
    }
  }
  let preferred = betweenTiles && state.pellets.has(start) ? player.dir : null, fruitDirection = null, iterations = 0;
  const fruitTiles = state.fruit && pursueFruit ? new Set([key(Math.floor(state.fruit.x), state.fruit.y), key(Math.ceil(state.fruit.x), state.fruit.y)]) : null;
  while (queue.length && iterations++ < graph.size) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (current.cost > bestCost.get(current.node)) continue;
    if (current.first && !preferred && state.pellets.has(current.node)) preferred = current.first;
    if (current.first && fruitTiles?.has(current.node) && current.cost <= 12) { fruitDirection = current.first; break; }
    if (preferred && (!fruitTiles || current.cost > 12)) break;
    for (const edge of graph.get(current.node) ?? []) {
      if (betweenTiles && !current.first && edge.dir === opposite) continue;
      const destination = key(edge.to.x, edge.to.y);
      if (!graph.has(destination)) continue;
      let danger = 0;
      for (const [i, ghost] of threats.entries()) {
        const distance = fields[i]?.get(destination) ?? Math.hypot(ghost.x - edge.to.x, ghost.y - edge.to.y);
        if (distance < 4) danger += (4 - distance) ** 2 * 4;
      }
      const cost = current.cost + 1 + danger + (!current.first && edge.dir === opposite ? (avoidReverse ? 10000 : reversalPenalty) : 0);
      if (cost < (bestCost.get(destination) ?? Infinity)) {
        bestCost.set(destination, cost); queue.push({ node: destination, cost, first: current.first ?? edge.dir });
      }
    }
  }
  preferred = fruitDirection ?? preferred;
  preferred ??= edges.find(edge => edge.dir === player.dir)?.dir ?? edges[0].dir;
  const edibleNearby = pursueFrightened && state.ghosts.some(ghost => ghost.status === 'active' && ghost.frightened && Math.hypot(ghost.x - player.x, ghost.y - player.y) < 5);
  if (!rolloutEnabled || (!edibleNearby && !threats.some(ghost => Math.hypot(ghost.x - player.x, ghost.y - player.y) < threatDistance))) return preferred;
  let best = null, bestNonReverse = null;
  for (const edge of edges) {
    const simulated = structuredClone(state);


    simulated.accumulator = 0;
    drainEvents(simulated);
    requestDirection(simulated, edge.dir);
    let survived = 0, earnedPoints = 0;
    for (; survived < horizon; survived++) {




      if (rolloutReplanning && survived > 0 && survived % 8 === 0) {
        const next = chooseAutoplayDirection(simulated, { scoreSeeking: scoreSeeking && rolloutScoreSeeking, pursueFruit: pursueFruit && rolloutScoreSeeking, pursueFrightened, rolloutEnabled: false, mazeThreats, reversalPenalty, accurateAnchor });
        if (next) requestDirection(simulated, next);
      }
      if (simulationBudget && simulationBudget.remaining <= 0) return null;
      step(simulated, STEP);
      if (simulationBudget) simulationBudget.remaining--;
      if (workCounter) workCounter.ticks++;
      for (const event of drainEvents(simulated)) if (['dot','power','fruit','ghost'].includes(event.type)) earnedPoints += event.points ?? 0;
      if (simulated.phase === 'dying' || simulated.phase === 'game-over') break;
    }

    const progress = dotReward ? Math.min(4000, Math.max(0, simulated.levelDotsEaten - state.levelDotsEaten) * 100) : 0;
    const score = survived * 10000 + (scoreSeeking ? Math.min(4000, earnedPoints) : progress) + (edge.dir === preferred ? 2 : 0) - (edge.dir === opposite ? reversalPenalty : 0);
    if (!best || score > best.score) best = { dir: edge.dir, score };
    if (edge.dir !== opposite && survived === horizon && (!bestNonReverse || score > bestNonReverse.score)) bestNonReverse = {dir: edge.dir, score};
  }
  if (avoidReverse && bestNonReverse) return bestNonReverse.dir;
  return best?.dir ?? preferred;
}



export function createCompletionController({dotReward = false, scoreSeeking = true, accurateAnchor = false, reversalPenalty = 0, commitment = 1, reversalThreshold = 20} = {}) {
  let direction = null, level = null, lives = null, cooldown = 0, decision = 0, lastReversal = null, repeated = 0;
  const opposite = {up:'down', down:'up', left:'right', right:'left'};
  return {
    choose(state) {
      if (state.phase !== 'playing') { direction = null; cooldown = 0; lastReversal = null; repeated = 0; return null; }
      if (state.level !== level || state.lives !== lives) { level = state.level; lives = state.lives; direction = null; cooldown = 0; lastReversal = null; repeated = 0; }
      decision++;
      if (direction && state.player.dir === opposite[direction]) {
        const {x,y} = state.player;
        repeated = lastReversal && decision - lastReversal.decision <= 4 && Math.hypot(x-lastReversal.x,y-lastReversal.y) <= 2 ? repeated + 1 : 0;
        lastReversal = {decision,x,y};
        if (repeated >= reversalThreshold) { cooldown = commitment; repeated = 0; }
      }
      direction = state.player.dir;
      const result = chooseAutoplayDirection(state, {scoreSeeking, reversalPenalty, accurateAnchor, dotReward, avoidReverse:cooldown > 0});
      if (cooldown > 0) cooldown--;
      return result;
    }
  };
}
