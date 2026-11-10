import { CONFIG } from "./config.js";

export function cellWorld(x, z, mazeSize = CONFIG.mazeCells) {
  const offset = (mazeSize - 1) * CONFIG.cellSize / 2;
  return {
    x: x * CONFIG.cellSize - offset,
    z: z * CONFIG.cellSize - offset
  };
}

export function worldCell(pos, mazeSize = CONFIG.mazeCells) {
  const offset = (mazeSize - 1) * CONFIG.cellSize / 2;
  return {
    x: Math.round((pos.x + offset) / CONFIG.cellSize),
    z: Math.round((pos.z + offset) / CONFIG.cellSize)
  };
}

export function isWallAt(x, z, maze) {
  if (!maze) return false;
  const c = worldCell({x, z}, maze.length);
  return c.x < 0 || c.z < 0 || c.x >= maze.length || c.z >= maze.length || maze[c.z][c.x] === 1;
}

export function canStand(x, z, radius, maze) {
  const r = radius || CONFIG.playerRadius;
  return !isWallAt(x - r, z - r, maze) &&
         !isWallAt(x + r, z - r, maze) &&
         !isWallAt(x - r, z + r, maze) &&
         !isWallAt(x + r, z + r, maze) &&
         !isWallAt(x - r, z, maze) &&
         !isWallAt(x + r, z, maze) &&
         !isWallAt(x, z - r, maze) &&
         !isWallAt(x, z + r, maze);
}

export function lineOfSight(from, to, maze) {
  const start = worldCell(from, maze.length);
  const end = worldCell(to, maze.length);
  let x = start.x, z = start.z;
  const dx = Math.abs(end.x - start.x), dz = Math.abs(end.z - start.z);
  const sx = start.x < end.x ? 1 : -1, sz = start.z < end.z ? 1 : -1;
  let err = dx - dz;

  while (!(x === end.x && z === end.z)) {
    if (!(x === start.x && z === start.z) && maze[z]?.[x] === 1) return false;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x += sx; }
    if (e2 < dx) { err += dx; z += sz; }
    if (x < 0 || z < 0 || x >= maze.length || z >= maze.length) return false;
  }
  return true;
}

// ★ A* Pathfinding アルゴリズム（追跡者の最短経路探索 & 壁スタック防止）
export function findPathAStar(startWorldPos, goalWorldPos, maze) {
  const startCellPos = worldCell(startWorldPos, maze.length);
  const goalCellPos = worldCell(goalWorldPos, maze.length);

  const startKey = `${startCellPos.x},${startCellPos.z}`;
  const goalKey = `${goalCellPos.x},${goalCellPos.z}`;

  if (startKey === goalKey) {
    return [goalWorldPos];
  }

  const openSet = [];
  const openMap = new Map();
  const closedSet = new Set();
  const cameFrom = new Map();

  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startKey, 0);
  const hStart = Math.hypot(startCellPos.x - goalCellPos.x, startCellPos.z - goalCellPos.z);
  fScore.set(startKey, hStart);

  const startNode = { x: startCellPos.x, z: startCellPos.z, key: startKey, f: hStart };
  openSet.push(startNode);
  openMap.set(startKey, startNode);

  const dirs = [
    {x: 0, z: -1}, {x: 1, z: 0}, {x: 0, z: 1}, {x: -1, z: 0},
    {x: 1, z: -1}, {x: 1, z: 1}, {x: -1, z: 1}, {x: -1, z: -1}
  ];

  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    openMap.delete(current.key);

    if (current.key === goalKey) {
      const pathCells = [];
      let currKey = goalKey;
      while (cameFrom.has(currKey)) {
        const [cx, cz] = currKey.split(",").map(Number);
        pathCells.unshift({ x: cx, z: cz });
        currKey = cameFrom.get(currKey);
      }
      return pathCells.map(c => cellWorld(c.x, c.z, maze.length));
    }

    closedSet.add(current.key);

    for (const d of dirs) {
      const nx = current.x + d.x;
      const nz = current.z + d.z;

      if (nx < 0 || nz < 0 || nx >= maze.length || nz >= maze.length) continue;
      if (maze[nz][nx] === 1) continue;

      // 斜め移動時の壁角抜けチェック
      if (d.x !== 0 && d.z !== 0) {
        if (maze[current.z][nx] === 1 || maze[nz][current.x] === 1) continue;
      }

      const neighborKey = `${nx},${nz}`;
      if (closedSet.has(neighborKey)) continue;

      const moveCost = (d.x !== 0 && d.z !== 0) ? 1.414 : 1.0;
      const tentativeG = (gScore.get(current.key) || 0) + moveCost;

      if (!gScore.has(neighborKey) || tentativeG < gScore.get(neighborKey)) {
        cameFrom.set(neighborKey, current.key);
        gScore.set(neighborKey, tentativeG);
        const h = Math.hypot(nx - goalCellPos.x, nz - goalCellPos.z);
        const f = tentativeG + h;
        fScore.set(neighborKey, f);

        if (!openMap.has(neighborKey)) {
          const neighborNode = { x: nx, z: nz, key: neighborKey, f: f };
          openSet.push(neighborNode);
          openMap.set(neighborKey, neighborNode);
        } else {
          openMap.get(neighborKey).f = f;
        }
      }
    }
  }

  return [goalWorldPos]; // 経路なし時は目標へ直行
}
