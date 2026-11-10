// --- CONFIG (v21 A*Pathfinding・段差/トラップモンスター・突進機能) ---
export const CONFIG = {
  mazeCells: 15,
  cellSize: 4,
  wallHeight: 4.53,
  playerRadius: 0.45,
  enemyRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  dashSpeed: 20.0,            // 突進時の速度
  dashDuration: 1.0,          // 突進持続時間（1秒）
  dashStaminaCost: 10,        // 突進スタミナ消費（10）
  dashCooldown: 15.0,         // 突進クールダウン（15秒）
  dashFreezeRadius: 5.0,      // 突進時の敵足止め有効範囲（半径5）
  dashFreezeDuration: 3.0,    // 突進時の敵足止め時間（3秒）

  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  enemyWalkSpeed: 4.5, 
  enemyChaseSpeed: 5.8,
  
  enemyDetectDistance: 16,
  enemyFovDegrees: 360,
  enemyCatchDistance: 2.0,
  enemySpawnMinDistance: 8,
  enemySpawnMaxDistance: 16,
  enemyRepathInterval: 0.25,  // A*再検索の短間隔化
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 27,

  // 段差 & トラップ配置仕様
  totalElevationObjectsMin: 15, // 合計生成数下限
  totalElevationObjectsMax: 25, // 合計生成数上限
  trapProbability: 0.33,        // トラップ化確率 33%
  stepHeight1: 0.45,           // 1段の高さ (ジャンプなしで登れる)
  stepHeight2: 0.90,           // 2段の高さ (ジャンプなしで登れる)

  trapBindDuration: 2.0,       // トラップ拘束時間 (2秒)
  trapInvulnerableDuration: 1.0,// 拘束後の無敵時間 (1秒)

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
