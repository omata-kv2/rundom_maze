// --- CONFIG (v15 5階層クリア仕様) ---
export const CONFIG = {
  mazeCells: 15,           // 1階あたり15セル
  cellSize: 4,
  wallHeight: 4.53,        // 元の6.8の3分の2 (6.8 * 2 / 3 = 4.53)
  playerRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  goalMinStraightDistance: 35,
  
  enemyWalkSpeed: 4.8, 
  enemyChaseSpeed: 5.8,
  
  enemyDetectDistance: 18,
  enemyFovDegrees: 360,
  enemyCatchDistance: 2.2,
  enemySpawnMinDistance: 8,
  enemySpawnMaxDistance: 16,
  enemyRepathInterval: 0.65,
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 27,

  rocketSpawnMinDist: 8,
  rocketSpawnMaxDist: 15,
  rocketHitRadius: 1.2,
  projectileSpeed: 12.0,
  projectileHitRadius: 3.0,
  enemyRespawnCooldown: 10.0,
  rocketRespawnCooldown: 10.0,
  maxRocketAmmo: 2,

  renderScale: 0.75,
  maxTextureSize: 512,
  
  drawDistance: 36.0,
  lightDrawDistance: 20.0,
  fogNear: 12.0,
  fogFar: 40.0,

  maxFloors: 5,            // 全5階層クリアで勝利
  invulnerableDuration: 3.0 // スタート時3秒間無敵
};

export const CHASER_IMAGES = ["./assets/chasers/inmu_king.png"];
export const BOOM_IMAGE = "./assets/chasers/boom.gif";
export const ROCKET_IMAGE = "./assets/items/rocket.png";

export const NEEDLE_COLORS = ["#ff0000", "#ff00ff", "#00ffff", "#ffff00", "#ff8800", "#00ff00", "#ffffff"];
