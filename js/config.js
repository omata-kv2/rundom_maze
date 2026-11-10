// --- CONFIG (v17 物理・当たり判定・描画安定調整) ---
export const CONFIG = {
  mazeCells: 15,           // 15×15マス固定
  cellSize: 4,
  wallHeight: 4.53,        // 天井高さ
  playerRadius: 0.45,      // プレイヤーの当たり判定半径
  enemyRadius: 0.5,        // 敵の当たり判定半径
  walkSpeed: 3.2,
  runSpeed: 6.0,
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  enemyWalkSpeed: 4.5, 
  enemyChaseSpeed: 5.8,    // ★ チェイススピードを5.8に修正
  
  enemyDetectDistance: 16,
  enemyFovDegrees: 360,
  enemyCatchDistance: 2.0, // キャッチ距離（より正確に判定）
  enemySpawnMinDistance: 8,
  enemySpawnMaxDistance: 16,
  enemyRepathInterval: 0.65,
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 27,

  rocketSpawnMinDist: 6,
  rocketSpawnMaxDist: 14,
  rocketHitRadius: 1.2,
  projectileSpeed: 12.0,
  projectileHitRadius: 3.0,
  enemyRespawnCooldown: 10.0,
  maxRocketAmmo: 2,

  renderScale: 0.65,
  maxTextureSize: 256,

  lightDrawDistance: 16.0,  // プレイヤー前方16mまで計算
  drawDistance: 32.0,
  fogNear: 10.0,
  fogFar: 32.0,

  targetFPS: 30,            // 30FPS固定
  maxFloors: 5,
  invulnerableDuration: 3.0
};

export const CHASER_IMAGES = ["./assets/chasers/inmu_king.png"];
export const BOOM_IMAGE = "./assets/chasers/boom.gif";
export const ROCKET_IMAGE = "./assets/items/rocket.png";

export const NEEDLE_COLORS = ["#ff0000", "#ff00ff", "#00ffff", "#ffff00", "#ff8800", "#00ff00", "#ffffff"];
