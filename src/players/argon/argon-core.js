import * as game from './game.js';
import * as rules from './rules.js';
import * as maze from './maze.js';
import { chooseAutoplayDirection } from './autoplay-policy.js';
import { createCleanupSearch } from './score-cleanup-search.js';
import { fruitDirection } from './score-fruit-route.js';
import { completionFingerprint } from './completion-fingerprint.js';
import { canonicalStateKey } from './score-realtime-sync.js';

export const ARGON_PLAYER = Object.freeze({
  id: 'argon',
  name: 'Argon Algorithm',
  version: 'v2-realtime'
});

export function createArgonStartState(level = 1, { seed = 0x504143, schedulerPhase = 42 } = {}) {
  if (level <= 1) {
    const s = game.createGame({ seed, schedulerPhase });
    game.startGame(s);
    return s;
  }
  const runTransition = precursorPhase => {
    const s = game.createGame({ seed, schedulerPhase });
    s.level = level - 1;
    s.phase = 'clearing';
    s.phaseDuration = rules.STEP;
    s.phaseRemaining = rules.STEP;
    s.clearDelayFrames = 0;
    s.pellets.clear();
    s.levelDotsEaten = 244;
    s.schedulerPhase = precursorPhase;
    let ticks = 0;
    while (s.level !== level && ticks < 1000) {
      game.step(s, rules.STEP);
      ticks++;
    }
    return { state: s, ticks };
  };
  const dry = runTransition(schedulerPhase);
  const precursorPhase = (schedulerPhase - (dry.ticks % 60) + 60) % 60;
  const { state } = runTransition(precursorPhase);
  game.drainEvents(state);
  state.eventId = 0;
  return state;
}

const DIRS = ['up', 'left', 'down', 'right'];
const ENERGIZERS = [{ x: 26, y: 3 }, { x: 1, y: 3 }, { x: 26, y: 23 }, { x: 1, y: 23 }];
const tile = p => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function fastClone(s) {
  const p = s.player;
  return {
    ...s,
    accumulator: 0,
    events: [],
    pellets: new Map(s.pellets),
    player: {
      x: p.x,
      y: p.y,
      dir: p.dir,
      next: p.next ? { x: p.next.x, y: p.next.y } : null,
      ...(p.turn ? {
        turn: {
          corner: { x: p.turn.corner.x, y: p.turn.corner.y },
          oldDir: p.turn.oldDir,
          dir: p.turn.dir,
          ...(p.turn.correcting !== undefined ? { correcting: p.turn.correcting } : {}),
          ...(p.turn.correctionJunction ? { correctionJunction: { x: p.turn.correctionJunction.x, y: p.turn.correctionJunction.y } } : {})
        }
      } : {}),
      ...(p.neutralWall ? { neutralWall: { vector: p.neutralWall.vector } } : {})
    },
    playerMasks: { normal: s.playerMasks.normal, powered: s.playerMasks.powered },
    ghosts: s.ghosts.map(g => ({
      ...g,
      next: g.next ? { x: g.next.x, y: g.next.y } : null,
      moveMasks: { ...g.moveMasks },
      ...(g.pendingTarget ? { pendingTarget: { position: { x: g.pendingTarget.position.x, y: g.pendingTarget.position.y }, incoming: g.pendingTarget.incoming } } : {}),
      ...(g.transit ? { transit: { points: g.transit.points.map(pt => ({ x: pt.x, y: pt.y })), index: g.transit.index } } : {}),
      ...(g.capturedExit ? { capturedExit: { ...g.capturedExit, tile: { x: g.capturedExit.tile.x, y: g.capturedExit.tile.y } } } : {}),
      ...(g.exitCollisionTile ? { exitCollisionTile: { x: g.exitCollisionTile.x, y: g.exitCollisionTile.y } } : {})
    })),
    fruit: s.fruit ? { ...s.fruit } : null,
    fruitTriggered: [s.fruitTriggered[0], s.fruitTriggered[1]],
    award: s.award ? { ...s.award } : null,
    intermission: s.intermission ? { ...s.intermission } : null,
    actorVisibility: { player: s.actorVisibility.player, ghosts: s.actorVisibility.ghosts },
    mazeView: s.mazeView
  };
}

export function fastStateHash(s) {
  const p = s.player, g0 = s.ghosts[0], g1 = s.ghosts[1], g2 = s.ghosts[2], g3 = s.ghosts[3];
  return `${s.level},${s.phase},${s.lives},${s.score},${s.remaining},${s.levelDotsEaten},${s.pellets.size},${s.power},${s.frightenedIndex},${s.schedulerPhase},${s.rng},${s.respawnHoldFrames ?? 0}|${p.x},${p.y},${p.dir},${s.requested},${s.fruit ? s.fruit.remaining : 0}|${g0.x},${g0.y},${g0.dir},${g0.status},${g0.frightened ? 1 : 0}|${g1.x},${g1.y},${g1.dir},${g1.status},${g1.frightened ? 1 : 0}|${g2.x},${g2.y},${g2.dir},${g2.status},${g2.frightened ? 1 : 0}|${g3.x},${g3.y},${g3.dir},${g3.status},${g3.frightened ? 1 : 0}`;
}

const CELL_COUNT = 36 * 32;
const toIdx = (x, y) => y * 32 + (x + 2);
const NORMAL_ADJ = new Int16Array(CELL_COUNT * 4).fill(-1);
for (let y = 0; y < 36; y++) {
  for (let x = -2; x < 30; x++) {
    const idx = toIdx(x, y);
    for (let d = 0; d < 4; d++) {
      const n = maze.neighbor(x, y, DIRS[d], 'player', 'normal');
      if (n) NORMAL_ADJ[idx * 4 + d] = toIdx(n.x, n.y);
    }
  }
}

const distCache = new Array(CELL_COUNT);
function getDistArr(tx, ty) {
  const tIdx = toIdx(tx, ty);
  let arr = distCache[tIdx];
  if (!arr) {
    arr = new Uint8Array(CELL_COUNT).fill(99);
    arr[tIdx] = 0;
    const q = new Int16Array(CELL_COUNT);
    q[0] = tIdx;
    let head = 0, tail = 1;
    while (head < tail) {
      const cur = q[head++];
      const nextD = arr[cur] + 1;
      const base = cur * 4;
      for (let d = 0; d < 4; d++) {
        const nIdx = NORMAL_ADJ[base + d];
        if (nIdx >= 0 && arr[nIdx] === 99) {
          arr[nIdx] = nextD;
          q[tail++] = nIdx;
        }
      }
    }
    distCache[tIdx] = arr;
  }
  return arr;
}

function mazeDist(x1, y1, x2, y2) {
  return getDistArr(Math.round(x2), Math.round(y2))[toIdx(Math.round(x1), Math.round(y1))];
}

const bfsQ = new Int16Array(CELL_COUNT);
const bfsFirst = new Int8Array(CELL_COUNT);
const bfsStamp = new Uint32Array(CELL_COUNT);
let stampCounter = 1;

function fastRouteDir(state, tx, ty, blockedIdxs = null) {
  const p = state.player;
  const anchor = p.next ?? tile(p);
  if (anchor.x === tx && anchor.y === ty) {
    const dx = tx - p.x, dy = ty - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 1e-6) {
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    }
    return p.dir;
  }
  const startIdx = toIdx(anchor.x, anchor.y);
  if (!blockedIdxs || blockedIdxs.length === 0) {
    const dArr = getDistArr(tx, ty);
    const base = startIdx * 4;
    let bestDir = null, bestD = 999;
    for (let d = 0; d < 4; d++) {
      const nIdx = NORMAL_ADJ[base + d];
      if (nIdx < 0) continue;
      const dist = dArr[nIdx];
      if (dist < bestD) { bestD = dist; bestDir = DIRS[d]; }
    }
    return bestDir;
  }
  const targetIdx = toIdx(tx, ty);
  stampCounter = (stampCounter + 1) >>> 0;
  if (stampCounter === 0) { bfsStamp.fill(0); stampCounter = 1; }
  for (let i = 0; i < blockedIdxs.length; i++) bfsStamp[blockedIdxs[i]] = stampCounter;
  bfsStamp[startIdx] = stampCounter;
  bfsQ[0] = startIdx;
  bfsFirst[0] = -1;
  let head = 0, tail = 1;
  while (head < tail) {
    const cur = bfsQ[head];
    const f = bfsFirst[head++];
    if (cur === targetIdx) return f >= 0 ? DIRS[f] : null;
    const base = cur * 4;
    for (let d = 0; d < 4; d++) {
      const nIdx = NORMAL_ADJ[base + d];
      if (nIdx < 0 || bfsStamp[nIdx] === stampCounter) continue;
      bfsStamp[nIdx] = stampCounter;
      bfsQ[tail] = nIdx;
      bfsFirst[tail++] = f >= 0 ? f : d;
    }
  }
  return null;
}

function blockedEnergizerIdxs(pellets, excludeE = null) {
  const out = [];
  for (const e of ENERGIZERS) {
    if (excludeE && e.x === excludeE.x && e.y === excludeE.y) continue;
    if (pellets.get(`${e.x},${e.y}`) === 'o') out.push(toIdx(e.x, e.y));
  }
  return out;
}

export function preserveAutoplay(state, { horizon = 240, rollout = true, allowEnergizers = false, workCounter = null } = {}) {
  const variant = state.mazeVariant;
  const p = state.player;
  const anchor = p.next ?? tile(p);
  const start = maze.key(anchor.x, anchor.y);
  const threats = state.ghosts.filter(g => g.status === 'active' && !g.frightened);
  const edges = DIRS.map(dir => ({ dir, to: maze.neighbor(anchor.x, anchor.y, dir, 'player', variant) }))
    .filter(e => e.to && (allowEnergizers || state.pellets.get(maze.key(e.to.x, e.to.y)) !== 'o'));
  if (!edges.length) return p.dir;

  const safeFruitEdge = () => {
    if (!state.fruit) return null;
    const fDir = fruitDirection(state);
    const edge = edges.find(e => e.dir === fDir);
    if (!edge) return null;
    for (const g of threats) {
      if (Math.hypot(g.x - edge.to.x, g.y - edge.to.y) < 1.4) return null;
    }
    return fDir;
  };

  if (state.fruit && !rollout) {
    const fDir = safeFruitEdge();
    if (fDir) return fDir;
  }

  const q = [{ node: start, x: anchor.x, y: anchor.y, cost: 0, first: null }];
  const bestCost = new Map([[start, 0]]);
  let preferred = null;
  while (q.length) {
    q.sort((a, b) => a.cost - b.cost);
    const cur = q.shift();
    if (cur.cost > bestCost.get(cur.node)) continue;
    if (cur.first && (allowEnergizers ? state.pellets.has(cur.node) : state.pellets.get(cur.node) === '.')) {
      preferred = cur.first;
      break;
    }
    for (const dir of DIRS) {
      const to = maze.neighbor(cur.x, cur.y, dir, 'player', variant);
      if (!to) continue;
      const dest = maze.key(to.x, to.y);
      if (!allowEnergizers && state.pellets.get(dest) === 'o') continue;
      let danger = 0;
      for (const g of threats) {
        const d = Math.hypot(g.x - to.x, g.y - to.y);
        if (d < 4) danger += (4 - d) ** 2 * 4;
      }
      const cost = cur.cost + 1 + danger;
      if (cost < (bestCost.get(dest) ?? Infinity)) {
        bestCost.set(dest, cost);
        q.push({ node: dest, x: to.x, y: to.y, cost, first: cur.first ?? dir });
      }
    }
  }
  const fPref = safeFruitEdge();
  if (fPref) preferred = fPref;
  preferred ??= edges.find(e => e.dir === p.dir)?.dir ?? edges[0].dir;
  if (!rollout) return preferred;

  let best = null;
  for (const edge of edges) {
    const sim = fastClone(state);
    game.requestDirection(sim, edge.dir);
    let survived = 0, pts = 0;
    for (; survived < horizon; survived++) {
      if (survived > 0 && survived % 8 === 0) {
        const next = preserveAutoplay(sim, { rollout: false, allowEnergizers });
        if (next) game.requestDirection(sim, next);
      }
      game.step(sim, rules.STEP);
      if (workCounter) workCounter.ticks++;
      const ev = game.drainEvents(sim);
      if (ev.some(e => (!allowEnergizers && e.type === 'power') || e.type === 'death' || e.type === 'fruit-expire') || sim.phase === 'dying') break;
      for (const e of ev) {
        if (e.type === 'dot') pts += 10;
        if (e.type === 'fruit') pts += 6000;
      }
      if (sim.level !== state.level || sim.phase === 'clearing') {
        survived = horizon;
        pts += 5000;
        break;
      }
    }
    const score = survived * 10000 + Math.min(8000, pts) + (edge.dir === preferred ? 2 : 0);
    if (!best || score > best.score) best = { dir: edge.dir, score };
  }
  return best?.dir ?? preferred;
}

function solveActivePowerFast(entry, workCounter = null) {
  const blocked = blockedEnergizerIdxs(entry.pellets);
  const candidateOrders = [
    ['nearest-preturn'],
    ['farthest'],
    ['nearest'],
    ['clyde', 'pinky', 'inky', 'blinky'],
    ['pinky', 'clyde', 'inky', 'blinky'],
    ['inky', 'pinky', 'clyde', 'blinky'],
    ['blinky', 'pinky', 'inky', 'clyde'],
    ['pinky', 'inky', 'blinky', 'clyde'],
    ['clyde', 'inky', 'pinky', 'blinky'],
    ['blinky', 'inky', 'clyde', 'pinky'],
    ['blinky', 'clyde', 'pinky', 'inky'],
    ['inky', 'blinky', 'pinky', 'clyde'],
    ['clyde', 'blinky', 'inky', 'pinky'],
    ['pinky', 'blinky', 'clyde', 'inky'],
  ];
  let best = { captures: 0 };
  for (const order of candidateOrders) {
    const s = fastClone(entry);
    const captured = new Set();
    const trace = [];
    let ticks = 0, dead = false;
    while (s.power > 0 && !(captured.size === 4 && !s.fruit) && !dead && ticks < 650) {
      let stepDir = null;
      if (s.phase === 'playing') {
        let dir = null;
        if (s.fruit) dir = fruitDirection(s);
        if (!dir) {
          const rem = s.ghosts.filter(g => g.frightened && g.status !== 'eyes' && !captured.has(g.id));
          let targetGhost = null;
          if (order[0] === 'nearest' || order[0] === 'nearest-preturn') {
            rem.sort((a, b) => mazeDist(s.player.x, s.player.y, a.x, a.y) - mazeDist(s.player.x, s.player.y, b.x, b.y));
            targetGhost = rem[0];
            if (order[0] === 'nearest-preturn' && rem.length > 1) {
              const anchor = s.player.next ?? tile(s.player);
              const gt0 = targetGhost.next ?? tile(targetGhost);
              if (anchor.x === gt0.x && anchor.y === gt0.y) targetGhost = rem[1];
            }
          } else if (order[0] === 'farthest') {
            rem.sort((a, b) => mazeDist(s.player.x, s.player.y, b.x, b.y) - mazeDist(s.player.x, s.player.y, a.x, a.y));
            targetGhost = rem[0];
          } else {
            const unresolvedIds = order.filter(id => !captured.has(id));
            targetGhost = rem.find(g => g.id === unresolvedIds[0]) ?? rem[0];
            if (targetGhost && unresolvedIds.length > 1) {
              const anchor = s.player.next ?? tile(s.player);
              const gt0 = targetGhost.next ?? tile(targetGhost);
              if (anchor.x === gt0.x && anchor.y === gt0.y) {
                targetGhost = rem.find(g => g.id === unresolvedIds[1]) ?? targetGhost;
              }
            }
          }
          if (targetGhost) {
            const gt = targetGhost.next ?? tile(targetGhost);
            let dynBlocked = null;
            for (const g of s.ghosts) {
              if (g.status === 'active' && !g.frightened) {
                dynBlocked ??= blocked.slice();
                const lt = tile(g);
                dynBlocked.push(toIdx(lt.x, lt.y));
                if (g.next) dynBlocked.push(toIdx(g.next.x, g.next.y));
              }
            }
            dir = dynBlocked
              ? (fastRouteDir(s, gt.x, gt.y, dynBlocked) ?? fastRouteDir(s, gt.x, gt.y, blocked))
              : fastRouteDir(s, gt.x, gt.y, blocked);
          }
        }
        if (dir && dir !== s.requested) {
          game.requestDirection(s, dir);
          stepDir = dir;
        }
      }
      trace.push(stepDir);
      game.step(s, rules.STEP);
      if (workCounter) workCounter.ticks++;
      ticks++;
      for (const e of game.drainEvents(s)) {
        if (e.type === 'death' || e.type === 'power' || e.type === 'fruit-expire') dead = true;
        if (e.type === 'ghost') {
          if (captured.has(e.idGhost)) dead = true;
          else captured.add(e.idGhost);
        }
      }
      if (s.phase === 'dying') dead = true;
    }
    if (dead) continue;
    if (captured.size > best.captures) best = { captures: captured.size };
    if (captured.size === 4) {
      while (s.phase === 'capture') {
        trace.push(null);
        game.step(s, rules.STEP);
        if (workCounter) workCounter.ticks++;
        ticks++;
        game.drainEvents(s);
      }
      const check = fastClone(s);
      let safe = true;
      for (let k = 0; k < 24; k++) {
        if (check.phase === 'playing' && k % 8 === 0) {
          const next = preserveAutoplay(check, { rollout: false });
          if (next) game.requestDirection(check, next);
        }
        game.step(check, rules.STEP);
        if (workCounter) workCounter.ticks++;
        const ev = game.drainEvents(check);
        if (ev.some(e => e.type === 'death' || e.type === 'power' || e.type === 'fruit-expire') || check.phase === 'dying') {
          safe = false;
          break;
        }
      }
      if (safe) return { status: 'ready', captures: 4, state: s, trace };
    }
  }
  return best;
}

function herdAndCapture(entry, targetE, { maxLayers = 135, width = 48, deep = false, workCounter = null } = {}) {
  const root = fastClone(entry);
  const blocked = blockedEnergizerIdxs(root.pellets, targetE);
  const levelRules = rules.rulesForLevel(root.level);
  const nomPower = levelRules.nominalPowerSeconds;
  const highElroyOneSec = nomPower === 1 && (levelRules.elroyDots[0] >= 100 || deep);
  if (highElroyOneSec) {
    maxLayers = 160;
    width = 64;
  }
  const maxTriggerDist = nomPower === 1 ? 10 : nomPower === 2 ? 11 : 12;
  const waits = highElroyOneSec ? [0, 2, 4, 6, 8, 10, 12] : nomPower <= 2 ? [0, 3, 6, 9, 12] : [0, 6];
  const maxActPerLayer = highElroyOneSec ? 4 : 3;

  let beam = [{ state: root, chunkDirs: [], score: 0 }];
  let overallBestCap = 0;
  const actSeen = new Set();

  for (let layer = 0; layer < maxLayers && beam.length; layer++) {
    const next = [];
    const seen = new Set();
    let actTries = 0;
    for (const node of beam) {
      const p = tile(node.state.player);
      const dPlayer = mazeDist(p.x, p.y, targetE.x, targetE.y);
      const gDists = node.state.ghosts.map(g => mazeDist(g.x, g.y, targetE.x, targetE.y));
      const maxG = Math.max(...gDists);
      const actKey = `${p.x},${p.y}|` + node.state.ghosts.map(g => `${Math.round(g.x)},${Math.round(g.y)}`).join('|');

      if (actTries < maxActPerLayer && dPlayer <= 2 && maxG <= maxTriggerDist && !node.state.fruit && node.state.ghosts.every(g => g.status === 'active') && !actSeen.has(actKey)) {
        actSeen.add(actKey);
        actTries++;
        for (const wait of waits) {
          const actFork = fastClone(node.state);
          const actTrace = [];
          let dead = false, powered = false;

          for (let w = 0; w < wait && !dead; w++) {
            const awayDir = DIRS.find(d => {
              const n = maze.neighbor(tile(actFork.player).x, tile(actFork.player).y, d, 'player', 'normal');
              return n && !(n.x === targetE.x && n.y === targetE.y);
            });
            const dir = w < Math.floor(wait / 2) ? awayDir : fastRouteDir(actFork, targetE.x, targetE.y, blocked);
            let stepDir = null;
            if (dir && dir !== actFork.requested) {
              game.requestDirection(actFork, dir);
              stepDir = dir;
            }
            actTrace.push(stepDir);
            game.step(actFork, rules.STEP);
            if (workCounter) workCounter.ticks++;
            for (const e of game.drainEvents(actFork)) {
              if (e.type === 'death' || e.type === 'fruit-expire' || e.type === 'power') dead = true;
            }
            if (actFork.phase === 'dying') dead = true;
          }

          for (let k = 0; k < 24 && !powered && !dead; k++) {
            const dir = fastRouteDir(actFork, targetE.x, targetE.y, blocked);
            let stepDir = null;
            if (dir && dir !== actFork.requested) {
              game.requestDirection(actFork, dir);
              stepDir = dir;
            }
            actTrace.push(stepDir);
            game.step(actFork, rules.STEP);
            if (workCounter) workCounter.ticks++;
            for (const e of game.drainEvents(actFork)) {
              if (e.type === 'death' || e.type === 'fruit-expire') dead = true;
              if (e.type === 'power') powered = true;
            }
            if (actFork.phase === 'dying') dead = true;
          }

          if (powered && !dead) {
            const res = solveActivePowerFast(actFork, workCounter);
            if (res.captures > overallBestCap) overallBestCap = res.captures;
            if (res.status === 'ready') {
              const prefixTrace = [];
              for (const cDir of node.chunkDirs) {
                prefixTrace.push(cDir, null, null, null, null, null, null, null);
              }
              return {
                status: 'ready',
                targetE,
                trace: [...prefixTrace, ...actTrace, ...res.trace],
                state: res.state
              };
            }
          }
        }
      }

      for (const dir of DIRS) {
        const s = fastClone(node.state);
        game.requestDirection(s, dir);
        let dead = false, fruitGain = 0;
        for (let k = 0; k < 8; k++) {
          game.step(s, rules.STEP);
          if (workCounter) workCounter.ticks++;
          for (const e of game.drainEvents(s)) {
            if (e.type === 'death' || e.type === 'power' || e.type === 'fruit-expire') dead = true;
            if (e.type === 'fruit') fruitGain += 5000;
          }
          if (s.phase === 'dying' || dead) { dead = true; break; }
        }
        if (dead) continue;
        const fp = completionFingerprint(s);
        if (seen.has(fp)) continue;
        seen.add(fp);

        const np = tile(s.player);
        const dp = mazeDist(np.x, np.y, targetE.x, targetE.y);
        const gd = s.ghosts.map(g => mazeDist(g.x, g.y, targetE.x, targetE.y));
        const mg = Math.max(...gd);
        const sg = gd.reduce((a, b) => a + b, 0);
        const minThreat = Math.min(...s.ghosts.map(g => Math.hypot(g.x - s.player.x, g.y - s.player.y)));
        if (minThreat < 1.2) continue;

        const isScatter = game.mode(s) === 'scatter';
        const targetDp = isScatter ? 8 : 2;
        const fruitSeek = s.fruit ? -mazeDist(np.x, np.y, 13, 17) * 50 : 0;
        const score = -(mg * 15 + sg * 5 + Math.abs(dp - targetDp) * 8) + minThreat * 2 + fruitSeek + fruitGain;

        next.push({
          state: s,
          bucket: `${np.x},${np.y}:${s.player.dir}`,
          chunkDirs: [...node.chunkDirs, dir],
          score
        });
      }
    }
    next.sort((a, b) => b.score - a.score);
    const chosen = [];
    const buckets = new Map();
    for (const n of next) {
      const c = buckets.get(n.bucket) ?? 0;
      if (c >= 2) continue;
      buckets.set(n.bucket, c + 1);
      chosen.push(n);
      if (chosen.length >= width) break;
    }
    beam = chosen;
  }
  return { status: 'unresolved', bestCaptures: overallBestCap };
}

function safeFruitDir(s, workCounter = null) {
  if (!s.fruit) return null;
  const fDir = fruitDirection(s);
  if (!fDir) return null;
  const sim = fastClone(s);
  game.requestDirection(sim, fDir);
  let gotFruit = false, dead = false;
  for (let k = 0; k < 180; k++) {
    if (k > 0 && k % 8 === 0) {
      const next = gotFruit
        ? chooseAutoplayDirection(sim, { scoreSeeking: true, threatDistance: 12, horizon: 120, lateLookahead: false, workCounter })
        : fruitDirection(sim);
      if (next) game.requestDirection(sim, next);
    }
    game.step(sim, rules.STEP);
    if (workCounter) workCounter.ticks++;
    for (const e of game.drainEvents(sim)) {
      if (e.type === 'death' || e.type === 'fruit-expire') dead = true;
      if (e.type === 'fruit') gotFruit = true;
    }
    if (sim.phase === 'dying' || dead) { dead = true; break; }
    if (gotFruit && k >= 60) break;
  }
  return (!dead && gotFruit) ? fDir : null;
}

export function createPlannerState(level = 1) {
  return {
    currentLevel: level,
    activeTick: 0,
    traceQueue: [],
    chainsCompleted: 0,
    chainAttempt: 0,
    advanceStepCount: 0,
    cooldownSteps: 0,
    cleanupSearched: false,
    cleanupFallbackTick: 0
  };
}

export function clonePlannerState(ps) {
  return {
    currentLevel: ps.currentLevel,
    activeTick: ps.activeTick,
    traceQueue: ps.traceQueue.slice(),
    chainsCompleted: ps.chainsCompleted,
    chainAttempt: ps.chainAttempt,
    advanceStepCount: ps.advanceStepCount,
    cooldownSteps: ps.cooldownSteps,
    cleanupSearched: ps.cleanupSearched,
    cleanupFallbackTick: ps.cleanupFallbackTick
  };
}

function resetPlannerLevel(ps, level) {
  ps.currentLevel = level;
  ps.activeTick = 0;
  ps.traceQueue = [];
  ps.chainsCompleted = 0;
  ps.chainAttempt = 0;
  ps.advanceStepCount = 0;
  ps.cooldownSteps = 0;
  ps.cleanupSearched = false;
  ps.cleanupFallbackTick = 0;
}

function shouldAdvanceBeforeChain(s, ps) {
  return (
    (s.phase === 'playing' || s.phase === 'capture') &&
    s.levelDotsEaten < 244 &&
    ps.advanceStepCount < 2500 &&
    (s.phase === 'capture' ||
      s.power > 0 ||
      s.fruit ||
      s.ghosts.some(g => g.status !== 'active' || g.frightened) ||
      (!s.fruitTriggered[0] && s.levelDotsEaten >= 55) ||
      (!s.fruitTriggered[1] && s.levelDotsEaten >= 155))
  );
}

export function stepArgonDecision(state, ps, { allowHeavySearch = true, workCounter = null } = {}) {
  if (state.level !== ps.currentLevel) {
    resetPlannerLevel(ps, state.level);
  }
  if ((state.phase !== 'playing' && state.phase !== 'capture') || state.respawnHoldFrames > 0) {
    if (state.phase === 'dying' || state.phase === 'respawning') {
      ps.traceQueue = [];
    }
    ps.activeTick = 0;
    const dir = state.requested === 'left' ? null : 'left';
    return { input: dir, mode: 'hold-left', heavySearch: false };
  }

  const levelRules = rules.rulesForLevel(state.level);

  if (state.level === 256) {
    let dir = null;
    if (state.pellets.size > 0 || state.fruit) {
      if (ps.activeTick % 8 === 0) {
        dir = safeFruitDir(state, workCounter) ?? chooseAutoplayDirection(state, { scoreSeeking: true, threatDistance: 12, horizon: 240, lateLookahead: false, workCounter });
      }
      ps.activeTick++;
    } else {
      const activeGhosts = state.ghosts.filter(g => g.status === 'active');
      activeGhosts.sort((a, b) => Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y));
      const g = activeGhosts[0];
      if (g) {
        dir = fastRouteDir(state, Math.round(g.x), Math.round(g.y));
      }
    }
    const out = dir && dir !== state.requested ? dir : null;
    return { input: out, mode: 'split-256', heavySearch: false };
  }

  if (levelRules.nominalPowerSeconds === 0) {
    let dir = null;
    if (ps.activeTick % 8 === 0) {
      dir = safeFruitDir(state, workCounter) ?? chooseAutoplayDirection(state, { scoreSeeking: true, threatDistance: 12, horizon: 240, lateLookahead: false, workCounter });
    }
    ps.activeTick++;
    const out = dir && dir !== state.requested ? dir : null;
    return { input: out, mode: 'zero-fright', heavySearch: false };
  }

  if (ps.traceQueue.length > 0) {
    const dir = ps.traceQueue.shift();
    const out = dir && dir !== state.requested ? dir : null;
    return { input: out, mode: 'planned-trace', heavySearch: false };
  }

  if (ps.cooldownSteps > 0) {
    const k = 120 - ps.cooldownSteps;
    ps.cooldownSteps--;
    let dir = null;
    if (state.phase === 'playing' && k % 8 === 0) {
      dir = preserveAutoplay(state, { horizon: 240, rollout: true, workCounter });
    }
    if (ps.cooldownSteps === 0) {
      ps.advanceStepCount = 0;
    }
    const out = dir && dir !== state.requested ? dir : null;
    return { input: out, mode: 'attempt-cooldown', heavySearch: false };
  }

  if (shouldAdvanceBeforeChain(state, ps)) {
    let dir = null;
    if (state.phase === 'playing' && ps.advanceStepCount % 8 === 0) {
      dir = preserveAutoplay(state, { horizon: 240, rollout: true, workCounter });
    }
    ps.advanceStepCount++;
    const out = dir && dir !== state.requested ? dir : null;
    return { input: out, mode: 'advance-ready', heavySearch: false };
  }

  if (ps.chainsCompleted < 4 && !ps.cleanupSearched) {
    if (!allowHeavySearch) return { haltBeforeHeavy: true };
    for (const targetE of ENERGIZERS) {
      if (!state.pellets.has(`${targetE.x},${targetE.y}`)) continue;
      const res = herdAndCapture(state, targetE, { deep: ps.chainAttempt >= 1, workCounter });
      if (res.status === 'ready') {
        ps.traceQueue = res.trace.slice();
        ps.chainsCompleted++;
        ps.chainAttempt = 0;
        ps.advanceStepCount = 0;
        const dir = ps.traceQueue.shift() ?? null;
        const out = dir && dir !== state.requested ? dir : null;
        return { input: out, mode: 'herd-chain', heavySearch: true };
      }
    }
    if (ps.chainAttempt < 6) {
      ps.chainAttempt++;
      ps.cooldownSteps = 119;
      const dir = preserveAutoplay(state, { horizon: 240, rollout: true, workCounter });
      const out = dir && dir !== state.requested ? dir : null;
      return { input: out, mode: 'attempt-cooldown', heavySearch: true };
    }
  }

  if (!ps.cleanupSearched && ps.chainsCompleted === 4 && state.phase === 'playing' && !state.fruit && state.power === 0 && state.fruitTriggered[0] && state.fruitTriggered[1]) {
    if (!allowHeavySearch) return { haltBeforeHeavy: true };
    ps.cleanupSearched = true;
    const cleanRes = createCleanupSearch(state, { recordCheckpoints: false }).run(120000);
    if (workCounter && Number.isFinite(cleanRes.work)) workCounter.ticks += cleanRes.work;
    if (cleanRes.status === 'complete-clear') {
      const byTick = new Map(cleanRes.inputs.map(inp => [inp.tick, inp.direction]));
      ps.traceQueue = Array.from({ length: cleanRes.durationTicks }, (_, t) => byTick.get(t) ?? null);
      const dir = ps.traceQueue.shift() ?? null;
      const out = dir && dir !== state.requested ? dir : null;
      return { input: out, mode: 'cleanup-trace', heavySearch: true };
    }
  }

  let dir = null;
  if (state.phase === 'playing' && ps.cleanupFallbackTick % 8 === 0) {
    const allowEnergizers = ps.chainsCompleted === 4 || ps.chainAttempt >= 6 || ![...state.pellets.values()].includes('.');
    dir = (ps.chainsCompleted === 4 && !state.fruit && state.power === 0)
      ? chooseAutoplayDirection(state, { scoreSeeking: true, threatDistance: 12, horizon: 240, lateLookahead: false, workCounter })
      : preserveAutoplay(state, { horizon: 240, rollout: true, allowEnergizers, workCounter });
  }
  ps.cleanupFallbackTick++;
  const out = dir && dir !== state.requested ? dir : null;
  return { input: out, mode: 'cleanup-fallback', heavySearch: false };
}

export function chooseFastFallback(state) {
  if (state.phase !== 'playing') {
    return state.requested === 'left' ? null : 'left';
  }
  const dir = preserveAutoplay(state, { rollout: false, allowEnergizers: ![...state.pellets.values()].includes('.') });
  return dir && dir !== state.requested ? dir : null;
}

export function computeScoreV2Plan(request) {
  if (!request || !request.snapshot || !request.plannerState) {
    throw Error('Invalid Argon worker request');
  }
  const sim = fastClone(request.snapshot);
  sim.accumulator = 0;
  game.drainEvents(sim);
  if (canonicalStateKey(sim) !== request.anchorStateKey) {
    throw Error('Anchor mismatch');
  }
  const ps = clonePlannerState(request.plannerState);
  const workCounter = { ticks: 0 };
  let verificationWork = 0;
  const maxChunkTicks = Number.isSafeInteger(request.maxChunkTicks) && request.maxChunkTicks > 0 ? request.maxChunkTicks : 480;
  const steps = [];

  for (let offset = 0; offset < 2800; offset++) {
    if (sim.phase === 'game-over') break;
    const dec = stepArgonDecision(sim, ps, { allowHeavySearch: offset === 0, workCounter });
    if (dec.haltBeforeHeavy) break;
    const preHash = fastStateHash(sim);
    if (dec.input !== null) game.requestDirection(sim, dec.input);
    game.step(sim, rules.STEP);
    verificationWork++;
    game.drainEvents(sim);
    const postHash = fastStateHash(sim);
    steps.push({
      input: dec.input,
      mode: dec.mode,
      preHash,
      postHash
    });
    if (ps.traceQueue.length === 0 && ps.cooldownSteps === 0 && offset + 1 >= maxChunkTicks) {
      break;
    }
  }

  const searchWork = workCounter.ticks;
  const endStateKey = canonicalStateKey(sim);
  return {
    status: 'ready',
    steps,
    durationTicks: steps.length,
    endState: sim,
    endStateKey,
    endPlanner: ps,
    work: searchWork + verificationWork,
    searchWork,
    verificationWork
  };
}
