// --- CONFIG (v23 ボスステージ追加版) ---
export const CONFIG = {
  mazeCells: 15,
  cellSize: 4,
  wallHeight: 4.53,
  playerRadius: 0.45,
  enemyRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  
  dashSpeed: 20.0,            // 突進スピード 20.0
  dashDuration: 2.0,          // 突進効果時間 2秒間
  dashStaminaCost: 10,        // 突進スタミナ消費 10
  dashCooldown: 5.0,          // 突進クールダウン 5秒
  
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  enemyWalkSpeed: 4.5, 
  enemyChaseSpeed: 5.8,
  
  enemyDetectDistance: 11,    // 追跡者の探知範囲 (16の2/3に相当する整数値 11)
  enemyFovDegrees: 360,
  enemyCatchDistance: 2.0,
  enemySpawnMinDistance: 8,
  enemySpawnMaxDistance: 16,
  enemyRepathInterval: 0.25,
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 28,

  // 段差 & トラップ設定
  totalElevationObjectsMin: 15,
  totalElevationObjectsMax: 25,
  trapProbability: 0.33,        // 33%でトラップモンスター化
  stepHeight1: 0.45,
  stepHeight2: 0.90,

  trapSlowDuration: 3.0,        // トラップ踏下時のスローダウン時間 3秒

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
  floorTimeLimit: 60,
  bossHealth: 20,
  beastKingHealth: 100,
  invulnerableDuration: 3.0
};

export const CHASER_IMAGES = ["./assets/chasers/inmu_king.png"];
export const BOOM_IMAGE = "./assets/chasers/boom.png";
export const ROCKET_IMAGE = "./assets/items/rocket.png";

export const NEEDLE_COLORS = ["#ff0000", "#ff00ff", "#00ffff", "#ffff00", "#ff8800", "#00ff00", "#ffffff"];
