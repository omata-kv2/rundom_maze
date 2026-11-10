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
