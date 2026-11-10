// --- CONFIG (v16 パフォーマンス＆ライト＆AI最適化) ---
export const CONFIG = {
  mazeCells: 15,           // 15×15セル固定
  cellSize: 4,
  wallHeight: 4.53,        // 天井高さ 6.8 × 2/3 ≒ 4.53
  playerRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  
  enemyWalkSpeed: 4.5, 
  enemyChaseSpeed: 5.5,
  
  enemyDetectDistance: 16,
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

  renderScale: 0.65,        // 解像度スケール（iPad軽量化のため0.65に設定）
  maxTextureSize: 256,      // メモリ軽量化

  // ▼ ライト読み込み・描画制限
  lightDrawDistance: 16.0,  // プレイヤーの向いている方向16.0先までのライトを計算
  drawDistance: 32.0,       // メッシュ描画限界
  fogNear: 10.0,
  fogFar: 32.0,

  targetFPS: 30,            // iPad向け 30FPS制限ターゲット
  maxFloors: 5,
  invulnerableDuration: 3.0 // 開始時3秒無敵
};

export const CHASER_IMAGES = ["./assets/chasers/inmu_king.png"];
export const BOOM_IMAGE = "./assets/chasers/boom.gif";
export const ROCKET_IMAGE = "./assets/items/rocket.png";

export const NEEDLE_COLORS = ["#ff0000", "#ff00ff", "#00ffff", "#ffff00", "#ff8800", "#00ff00", "#ffffff"];
