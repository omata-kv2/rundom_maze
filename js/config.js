// --- CONFIG (v23.3) ---
export const CONFIG = {
  mazeCells: 15,
  cellSize: 4,
  wallHeight: 4.53,
  playerRadius: 0.45,
  enemyRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  
  dashSpeed: 20.0,
  dashDuration: 2.0,
  dashStaminaCost: 10,
  dashCooldown: 5.0,
  
  maxStamina: 20,
  maxHealth: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  enemyWalkSpeed: 4.5, 
  enemyChaseSpeed: 5.8,
  
  enemyDetectDistance: 11,
  enemyFovDegrees: 360,
  enemyCatchDistance: 2.0,
  enemySpawnMinDistance: 8,
  enemySpawnMaxDistance: 16,
  enemyRepathInterval: 0.25,
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 28,

  stageTimeLimit: 60,

  totalElevationObjectsMin: 15,
  totalElevationObjectsMax: 25,
  trapProbability: 0.33,
  stepHeight1: 0.45,
  stepHeight2: 0.90,

  trapSlowDuration: 3.0,

  rocketSpawnMinDist: 6,
  rocketSpawnMaxDist: 14,
  rocketHitRadius: 1.2,
  projectileSpeed: 12.0,
  projectileHitRadius: 3.0,
  enemyRespawnCooldown: 10.0,
  maxRocketAmmo: 2,

  renderScale: 0.65,
  maxTextureSize: 256,

  lightDrawDistance: 16.0,
  drawDistance: 32.0,
  fogNear: 10.0,
  fogFar: 32.0,

  targetFPS: 30,
  maxFloors: 5,
  invulnerableDuration: 3.0
};

export const CHASER_IMAGES = ["./assets/chasers/inmu_king.png"];
export const BOOM_IMAGE = "./assets/chasers/boom.png";
export const ROCKET_IMAGE = "./assets/items/rocket.png";

export const NEEDLE_COLORS = ["#ff0000", "#ff00ff", "#00ffff", "#ffff00", "#ff8800", "#00ff00", "#ffffff"];
