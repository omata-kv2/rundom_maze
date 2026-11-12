import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight, findPathAStar } from "./collision.js";
import { generateMaze, buildScene, buildBossScene, setupMapRockets } from "./worldBuilder.js";

let scene, camera, renderer, clock;
let maze, player, goalMesh;
let enemies = [];
let running = false, ended = false;
let currentFloor = 1;
let gameMode = "normal"; // normal | worldEnemy | beastKing | deadstage
let bossName = "";
let health = CONFIG.bossHealth;
let floorTimer = CONFIG.floorTimeLimit;
let bossHealth = CONFIG.beastKingHealth;
let bossAttackCooldown = 0;
let bossChargeTimer = 0;
let bossChargeElapsed = 0;
let chargeHitThisCycle = false;
let deathTransitioning = false;
let deadstageElapsed = 0;
let deadstageChasers = [];

let stamina = CONFIG.maxStamina;
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0, z:0};
let sprintHeld = false;

// 突進状態
let isDashing = false;
let dashTimer = 0;
let dashCooldownTimer = 0;

// トラップ鈍足化（スローダウン）状態
let isSlowed = false;
let slowTimer = 0;

// ★ ロケットの階層間引き継ぎフラグ (1発でも撃っていれば次階層開始時に最大数所持)
let hasRocketFromPreviousFloor = false;

let elevationsList = [];
let trapsList = [];

let gameSettings = {
  compass: true,
  progressiveEnemies: true
};

let invulnerableTimer = 0;
let enemyTextureNormal = null;
let enemyTextureBoom = null;

let messageTimer = 0;
const startCell = {x:1, z:1};
let goalCell = {x:13, z:13};

let mapRocketItems = [];
let rocketAmmo = 0;
let projectiles = [];
let pointLightsList = [];

let lastFrameTime = performance.now();
let frameCount = 0;
let fpsTimer = 0;

const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
const cameraWorldPos = new THREE.Vector3();
const cameraWorldDir = new THREE.Vector3();
const tempVec3 = new THREE.Vector3();

const loader = new THREE.TextureLoader();
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));

function playAudio(id, vol = 1.0) {
  const el = $(id);
  if (el) {
    el.currentTime = 0;
    el.volume = vol;
    el.play().catch(e => console.warn("Audio play failed:", id, e));
  }
}

function showMessage(text){
  $("message").textContent = text;
  $("message").style.opacity = "1";
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => $("message").style.opacity = "0", 3500);
}

function disableGestures() {
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('gestureend', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

function showLoading(show, text = "STAGE GENERATING...") {
  const el = $("loading-screen");
  if (show) {
    $("loading-text").textContent = text;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

let preloadedVideo = null;
function unlockAndPreloadMedia() {
  if (!preloadedVideo) {
    preloadedVideo = document.createElement("video");
    preloadedVideo.id = "direct-capture-video";
    preloadedVideo.src = "./assets/videos/inmuking.mp4";
    preloadedVideo.playsInline = true;
    preloadedVideo.muted = false;
    preloadedVideo.preload = "auto";
    preloadedVideo.setAttribute("playsinline", "");
    preloadedVideo.setAttribute("webkit-playsinline", "");
    preloadedVideo.style.cssText = "display:none; position:fixed; inset:0; width:100vw; height:100vh; object-fit:contain; z-index:9999; background:black; pointer-events:auto;";
    document.body.appendChild(preloadedVideo);
  }

  // 自動再生アンロック用の完全停止
  preloadedVideo.pause();
  preloadedVideo.currentTime = 0;
}

// ★ iPadでのスタート時誤再生を完全防ぐ動画停止関数
function stopCaptureVideoImmediately() {
  let video = document.getElementById("direct-capture-video");
  if (video) {
    video.pause();
    video.currentTime = 0;
    video.style.display = "none";
  }
}

function playCaptureVideoDirectly(onEndedCallback) {
  let video = document.getElementById("direct-capture-video");
  if (!video) {
    unlockAndPreloadMedia();
    video = document.getElementById("direct-capture-video");
  }

  video.style.display = "block";
  video.currentTime = 0;
  video.muted = false;

  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(e => {
      console.warn("Audio play blocked, fallback:", e);
      video.muted = true;
      video.play().then(() => { video.muted = false; }).catch(err => console.error("Video failed:", err));
    });
  }

  const blockOverlay = document.createElement("div");
  blockOverlay.id = "catch-block-overlay";
  blockOverlay.style.cssText = "position:fixed; inset:0; z-index:9998; background:transparent; pointer-events:auto;";
  document.body.appendChild(blockOverlay);

  $("mobile-controls").style.display = "none";

  setTimeout(() => {
    video.pause();
    video.style.display = "none";
    if (blockOverlay.parentNode) blockOverlay.parentNode.removeChild(blockOverlay);
    $("mobile-controls").style.display = "block";
    if (onEndedCallback) onEndedCallback();
  }, CONFIG.captureWaitTime * 1000);
}

function placeGoalFixed(openCells) {
  const targetX = CONFIG.mazeCells - 2;
  const targetZ = CONFIG.mazeCells - 2;

  let bestCell = {x: targetX, z: targetZ};
  if (maze[targetZ][targetX] === 1) {
    let minDist = Infinity;
    for (let c of openCells) {
      const d = Math.hypot(c.x - targetX, c.z - targetZ);
      if (d < minDist) { minDist = d; bestCell = c; }
    }
  }

  goalCell = bestCell;
  maze[goalCell.z][goalCell.x] = 0;
  const gp = cellWorld(goalCell.x, goalCell.z, maze.length);

  let rotY = 0;
  let offsetDist = (CONFIG.cellSize / 2) - 0.2;
  let finalPos = new THREE.Vector3(gp.x, 0, gp.z);

  if (maze[goalCell.z - 1]?.[goalCell.x] === 1) { rotY = 0; finalPos.z -= offsetDist; }
  else if (maze[goalCell.z + 1]?.[goalCell.x] === 1) { rotY = Math.PI; finalPos.z += offsetDist; }
  else if (maze[goalCell.z][goalCell.x - 1] === 1) { rotY = Math.PI / 2; finalPos.x -= offsetDist; }
  else if (maze[goalCell.z][goalCell.x + 1] === 1) { rotY = -Math.PI / 2; finalPos.x += offsetDist; }

  goalMesh = new THREE.Group();
  goalMesh.position.copy(finalPos);
  goalMesh.rotation.y = rotY;

  const frameMat = new THREE.MeshStandardMaterial({color: 0x4b4637, roughness: .85});
  const doorMat = new THREE.MeshStandardMaterial({color: 0x6f755f, roughness: .7});
  const leftPost = new THREE.Mesh(new THREE.BoxGeometry(.18, 2.5, .22), frameMat); leftPost.position.set(-.78, 1.25, 0); goalMesh.add(leftPost);
  const rightPost = leftPost.clone(); rightPost.position.x = .78; goalMesh.add(rightPost);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.72, .2, .24), frameMat); lintel.position.set(0, 2.45, 0); goalMesh.add(lintel);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.35, 2.3, .12), doorMat); door.position.set(0, 1.15, -.04); goalMesh.add(door);
  
  const signCanvas = document.createElement("canvas"); signCanvas.width = 128; signCanvas.height = 48;
  const signCtx = signCanvas.getContext("2d"); signCtx.fillStyle = "#183c2a"; signCtx.fillRect(0, 0, 128, 48);
  signCtx.strokeStyle = "#d7e8c9"; signCtx.lineWidth = 4; signCtx.strokeRect(2, 2, 124, 44);
  signCtx.fillStyle = "#f0f4df"; signCtx.font = "bold 24px Arial"; signCtx.textAlign = "center";
  signCtx.fillText(currentFloor === CONFIG.maxFloors ? "FINAL EXIT" : `EXIT ${currentFloor}F`, 64, 32);
  const signTex = new THREE.CanvasTexture(signCanvas);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, .38), new THREE.MeshBasicMaterial({map: signTex}));
  sign.position.set(0, 2.1, .09); goalMesh.add(sign);

  const glow = new THREE.PointLight(0x8aff9d, 2.0, 10); glow.position.set(0, 2.1, 0.5); goalMesh.add(glow);
  scene.add(goalMesh);
}

function createEnemyMaterial(mapTex) {
  return new THREE.MeshBasicMaterial({
    map: mapTex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
  });
}

// ★ 全員のゴール守備行動を廃止、全員ランダム巡回を行うように調整
function setupEnemiesOptimized(openCells, spawnPos) {
  for (const old of enemies) if (old.group) scene.remove(old.group);
  enemies = [];
  const baseCount = gameSettings.progressiveEnemies ? currentFloor : 1;
  const totalEnemies = gameMode === "beastKing" ? 1 : (gameMode === "worldEnemy" ? Math.max(1, baseCount) : baseCount);
  for (let i = 0; i < totalEnemies; i++) {
    const candidates = openCells.filter(c => {
      const p = cellWorld(c.x, c.z, maze.length);
      return Math.hypot(p.x-spawnPos.x,p.z-spawnPos.z) >= (gameMode === "normal" ? 8 : 5);
    });
    const spawnCellPos = candidates[Math.floor(Math.random()*candidates.length)] || openCells[Math.min(i,openCells.length-1)];
    const ep = cellWorld(spawnCellPos.x, spawnCellPos.z, maze.length);
    const group = new THREE.Group();
    group.position.set(ep.x, 0, ep.z);
    scene.add(group);
    const scale = gameMode === "beastKing" ? 2 : 1;
    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2*scale,2*scale));
    planeMesh.position.y = scale;
    group.add(planeMesh);
    if (enemyTextureNormal) planeMesh.material = createEnemyMaterial(enemyTextureNormal);
    enemies.push({
      id:i, group, planeMesh, isBoss:gameMode==="beastKing",
      hp:CONFIG.beastKingHealth, attackCooldown:0, chargeCooldown:10,
      chargeTimer:0, chargeHit:false, state:"patrol", target:null,
      path:[], pathIndex:0, repathTimer:0, frozenTimer:0,
      color:NEEDLE_COLORS[i%NEEDLE_COLORS.length]
    });
  }
  updateRadarUI(totalEnemies);
}

function updateRadarUI(totalEnemies) {
  const radarCircle = $("radar");
  radarCircle.innerHTML = "";
  if (!gameSettings.compass) return;

  for (let i = 0; i < totalEnemies; i++) {
    const needle = document.createElement("div");
    needle.id = `radar-needle-${i}`;
    needle.className = "needle";
    needle.style.backgroundColor = NEEDLE_COLORS[i % NEEDLE_COLORS.length];
    radarCircle.appendChild(needle);
  }
}

function initStage(callback) {
  showLoading(true, gameMode === "normal" ? `${currentFloor}F GENERATING...` : `${bossName || "DEADSTAGE"} GENERATING...`);
  setTimeout(() => {
    let generationPhase = "旧ステージの破棄";
    try {
    if (scene) {
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach(mat => mat.dispose());
        }
      });
    }
    if (renderer) {
      if (renderer.domElement?.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
    }

    let built;
    generationPhase = "迷路・ステージ構造の生成";
    if (gameMode === "deadstage") {
      maze = Array.from({length: 2}, () => [0, 0]);
      built = { scene: new THREE.Scene(), maze, elevations: [], traps: [], pointLightsList: [] };
      built.scene.background = new THREE.Color(0x000000);
    } else if (gameMode === "worldEnemy" || gameMode === "beastKing") {
      built = buildBossScene();
      maze = built.maze;
    } else {
      maze = generateMaze(CONFIG.mazeCells);
      built = buildScene(maze);
    }
    scene = built.scene;
    pointLightsList = built.pointLightsList || [];
    elevationsList = built.elevations || [];
    trapsList = built.traps || [];

    generationPhase = "カメラ・WebGLレンダラーの初期化";
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
    camera.rotation.order = "YXZ";
    renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
    $("game").appendChild(renderer.domElement);
    clock = new THREE.Clock();

    generationPhase = "通行可能セル・プレイヤー配置";
    const open = [];
    for (let z=1; z<maze.length-1; z++) for (let x=1; x<maze.length-1; x++) if (maze[z][x]===0) open.push({x,z});
    const spawnPos = gameMode === "deadstage" ? {x:0,z:0} : cellWorld(gameMode === "normal" ? 1 : 1, 1, maze.length);
    player = { position: new THREE.Vector3(spawnPos.x, 1.4, spawnPos.z), baseEyeY: 1.4 };
    camera.position.copy(player.position);

    if (gameMode === "normal") placeGoalFixed(open);
    else goalMesh = null;

    generationPhase = "HUD・ステータス初期化";
    stamina = CONFIG.maxStamina;
    health = CONFIG.bossHealth;
    floorTimer = CONFIG.floorTimeLimit;
    bossHealth = CONFIG.beastKingHealth;
    bossAttackCooldown = 0;
    bossChargeElapsed = 0;
    bossChargeTimer = 0;
    chargeHitThisCycle = false;
    updateHealthUI();
    const bossMode = gameMode === "worldEnemy" || gameMode === "beastKing";
    $("stamina-panel").classList.toggle("hidden", bossMode);
    $("health-panel").classList.toggle("hidden", !bossMode);
    $("sprint-button").classList.toggle("hidden", bossMode);
    $("boss-health-panel").classList.toggle("hidden", gameMode !== "beastKing");
    updateBossHealthUI(CONFIG.beastKingHealth);
    $("dash-button").classList.toggle("hidden", gameMode === "deadstage");
    $("shoot-button").classList.toggle("hidden", gameMode === "deadstage");
    $("rocket-hud").classList.toggle("hidden", gameMode === "deadstage");
    isDashing = false; dashTimer = 0; dashCooldownTimer = 0;
    isSlowed = false; slowTimer = 0;

    generationPhase = "ロケット配置";
    rocketAmmo = 0;
    $("rocket-hud").classList.add("hidden");
    $("shoot-button").classList.add("hidden");
    mapRocketItems = bossMode ? setupMapRockets(scene, open, maze.length, spawnPos, 3, elevationsList)
      : (gameMode === "normal" ? setupMapRockets(scene, open, maze.length, spawnPos, null, elevationsList) : []);

    generationPhase = "追跡者配置";
    if (gameMode === "normal" || gameMode === "worldEnemy" || gameMode === "beastKing") {
      setupEnemiesOptimized(open, spawnPos);
    } else {
      enemies = [];
      startDeadstageChasers();
    }

    if (gameSettings.compass && gameMode === "normal") $("compass-container").classList.remove("hidden");
    else $("compass-container").classList.add("hidden");
    $("floor-display").textContent = gameMode === "normal" ? `${currentFloor}F` : (gameMode === "deadstage" ? "DEADSTAGE" : bossName);
    $("timer-display").textContent = gameMode === "deadstage" ? "—" : "60";

    generationPhase = "敵画像・テクスチャ読み込み開始";
    if (!enemyTextureNormal) {
      loader.load(CHASER_IMAGES[0], tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        enemyTextureNormal = tex;
        for (let e of enemies) if (e.planeMesh) e.planeMesh.material = createEnemyMaterial(tex);
        if (gameMode === "deadstage") deadstageChasers.forEach(g => { if (g.children[0]) g.children[0].material = createEnemyMaterial(tex); });
      });
    }
    if (!enemyTextureBoom) loader.load(BOOM_IMAGE, tex => { tex.colorSpace = THREE.SRGBColorSpace; enemyTextureBoom = tex; });

    const dx = goalMesh ? goalMesh.position.x - spawnPos.x : 0;
    const dz = goalMesh ? goalMesh.position.z - spawnPos.z : -1;
    yaw = Math.atan2(-dx, -dz);
    camera.rotation.set(0, yaw, 0);
    generationPhase = "生成完了処理";
    invulnerableTimer = CONFIG.invulnerableDuration;
    showLoading(false);
    if (callback) callback();
    } catch (error) {
      console.error("YAJU ESCAPE stage generation failed:", generationPhase, error);
      running = false;
      const detail = `${generationPhase}\n${error?.name || "Error"}: ${error?.message || String(error)}`;
      showLoading(true, "STAGE GENERATION ERROR");
      $("loading-text").style.whiteSpace = "pre-wrap";
      $("loading-text").textContent = `STAGE GENERATION ERROR\n${detail}\n\nこの画面を撮影して送ってください。`;
    }
  }, 100);
}

function updateOcclusionAndLOD() {
  if (!camera || !scene) return;
  camera.getWorldPosition(cameraWorldPos);
  camera.getWorldDirection(cameraWorldDir);

  for (let item of pointLightsList) {
    const toLight = tempVec3.subVectors(item.position, cameraWorldPos);
    const dist = toLight.length();
    const dot = cameraWorldDir.dot(toLight.normalize());

    if (dist <= CONFIG.lightDrawDistance && dot > -0.2) { 
      const factor = 1.0 - (dist / CONFIG.lightDrawDistance);
      item.light.intensity = item.baseIntensity * factor;
      item.lampMesh.visible = true;
    } else {
      item.light.intensity = 0;
      item.lampMesh.visible = false;
    }
  }

  for (let t of trapsList) {
    if (t.mesh) {
      const d = cameraWorldPos.distanceTo(t.mesh.position);
      t.mesh.visible = (d <= CONFIG.drawDistance);
    }
  }
  for (let el of elevationsList) {
    if (el.mesh) {
      const d = cameraWorldPos.distanceTo(el.mesh.position);
      el.mesh.visible = (d <= CONFIG.drawDistance);
    }
  }

  for (let item of mapRocketItems) {
    if (item.active && item.mesh) {
      item.mesh.lookAt(camera.position.x, item.mesh.position.y, camera.position.z);
      const dist = Math.hypot(player.position.x - item.mesh.position.x, player.position.z - item.mesh.position.z);
      if (dist <= CONFIG.rocketHitRadius && rocketAmmo < CONFIG.maxRocketAmmo) {
        item.active = false;
        scene.remove(item.mesh);
        if (item.light) scene.remove(item.light);
        rocketAmmo = CONFIG.maxRocketAmmo;
        hasRocketFromPreviousFloor = true;
        $("rocket-hud").classList.remove("hidden");
        $("shoot-button").classList.remove("hidden");
        showMessage(`ロケットを入手した！（弾数${rocketAmmo}発）`);
      }
    }
  }

  if (goalMesh) {
    const distToGoal = cameraWorldPos.distanceTo(goalMesh.position);
    goalMesh.visible = (distToGoal <= CONFIG.drawDistance);
  }
}

// ★ 新・突進機能：5秒CD、効果時間2秒、totugeki.mp3を4秒間再生
function triggerDash() {
  if (!running || ended || gameMode === "deadstage" || isDashing || dashCooldownTimer > 0) return;
  if (gameMode === "normal" && stamina < CONFIG.dashStaminaCost) {
    showMessage("スタミナ不足！(消費: 10)");
    return;
  }

  if (gameMode === "normal") stamina -= CONFIG.dashStaminaCost;
  isDashing = true;
  dashTimer = CONFIG.dashDuration; // 2秒間突進
  dashCooldownTimer = CONFIG.dashCooldown; // 5秒クールダウン

  // totugeki.mp3を4秒間流す
  playAudio("se-totugeki", 1.0);
  setTimeout(() => {
    const el = $("se-totugeki");
    if (el) { el.pause(); el.currentTime = 0; }
  }, 4000);

  showMessage("突進発動！(2秒間無敵突進＆接触爆破)");
}

function movePlayer(dt) {
  // 突進タイマー更新
  if (isDashing) {
    dashTimer -= dt;
    if (dashTimer <= 0) {
      isDashing = false;
    }
  }

  // クールダウンタイマー更新
  if (dashCooldownTimer > 0) {
    dashCooldownTimer = Math.max(0, dashCooldownTimer - dt);
    const progress = (CONFIG.dashCooldown - dashCooldownTimer) / CONFIG.dashCooldown;
    const strokeVal = progress * 100;
    $("dash-cd-path").setAttribute("stroke-dasharray", `${strokeVal}, 100`);
    $("dash-button").disabled = true;
  } else {
    $("dash-cd-path").setAttribute("stroke-dasharray", "100, 100");
    $("dash-button").disabled = false;
  }

  // トラップの鈍足化（スローダウン）タイマー更新
  if (isSlowed) {
    slowTimer -= dt;
    if (slowTimer <= 0) {
      isSlowed = false;
      showMessage("移動速度低下が解除された");
    }
  }

  let x = (keys.KeyD?1:0) - (keys.KeyA?1:0) + joystick.x;
  let z = (keys.KeyS?1:0) - (keys.KeyW?1:0) + joystick.z;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  const isMoving = len > 0.05;

  let currentSpeed = (gameMode === "worldEnemy" || gameMode === "beastKing") ? CONFIG.runSpeed : CONFIG.walkSpeed;

  if (isDashing) {
    currentSpeed = CONFIG.dashSpeed; // 突進 20.0
  } else {
    const isRunning = gameMode === "normal" && (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && isMoving && stamina > 0;
    if (isRunning) {
      stamina = Math.max(0, stamina - CONFIG.staminaUsePerSecond * dt);
      currentSpeed = CONFIG.runSpeed;
    } else {
      stamina = Math.min(CONFIG.maxStamina, stamina + CONFIG.staminaRegenPerSecond * dt);
    }
  }

  // トラップ踏下時は速度数値を1/2にする
  if (isSlowed) {
    currentSpeed /= 2.0;
  }

  $("stamina-fill").style.width = `${stamina/CONFIG.maxStamina*100}%`;
  $("stamina-text").textContent = `${Math.ceil(stamina)} / ${CONFIG.maxStamina}`;

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(currentSpeed * dt);

  const nx = player.position.x + delta.x, nz = player.position.z + delta.z;
  if (canStand(nx, player.position.z, CONFIG.playerRadius, maze)) player.position.x = nx;
  if (canStand(player.position.x, nz, CONFIG.playerRadius, maze)) player.position.z = nz;

  // 段差昇降処理
  let currentStepHeight = 0;
  for (let el of elevationsList) {
    if (Math.abs(player.position.x - el.position.x) < CONFIG.cellSize * 0.5 &&
        Math.abs(player.position.z - el.position.z) < CONFIG.cellSize * 0.5) {
      currentStepHeight = Math.max(currentStepHeight, el.height);
    }
  }

  // トラップモンスター踏下処理（3秒間の鈍足化）
  for (let t of trapsList) {
    if (t.active && Math.abs(player.position.x - t.position.x) < CONFIG.cellSize * 0.5 &&
        Math.abs(player.position.z - t.position.z) < CONFIG.cellSize * 0.5) {
      currentStepHeight = Math.max(currentStepHeight, t.height);
      if (!isSlowed) {
        isSlowed = true;
        slowTimer = CONFIG.trapSlowDuration; // 3秒間のスローダウン
        showMessage("トラップにかかった！(3秒間移動速度1/2)");
      }
    }
  }

  player.position.y = player.baseEyeY + currentStepHeight;
  camera.position.copy(player.position);
  camera.rotation.set(pitch, yaw, 0);
}


function updateBossHealthUI(value) {
  const fill = $("boss-health-fill"), label = $("boss-health-text");
  if (!fill || !label) return;
  fill.style.width = `${Math.max(0, value / CONFIG.beastKingHealth * 100)}%`;
  label.textContent = `${Math.max(0, value)} / ${CONFIG.beastKingHealth}`;
}
function updateHealthUI() {
  const fill = $("health-fill");
  const label = $("health-text");
  if (!fill || !label) return;
  fill.style.width = `${Math.max(0, health / CONFIG.bossHealth * 100)}%`;
  label.textContent = `${Math.max(0, health)} / ${CONFIG.bossHealth}`;
}
function damagePlayer(amount) {
  if (gameMode !== "worldEnemy" && gameMode !== "beastKing") return;
  if (deathTransitioning) return;
  health = Math.max(0, health - amount);
  updateHealthUI();
  if (health <= 0) beginDeadstage();
}
function beginDeadstage() {
  if (deathTransitioning) return;
  deathTransitioning = true;
  running = false;
  // 全ての移動物体を停止してから、元ステージを破棄して専用空間を構築
  enemies.forEach(e => { e.state = "frozen"; });
  projectiles.forEach(p => scene?.remove(p.mesh));
  projectiles = [];
  mapRocketItems.forEach(it => { if (it.mesh) scene?.remove(it.mesh); if (it.light) scene?.remove(it.light); });
  mapRocketItems = [];
  gameMode = "deadstage";
  setTimeout(() => initStage(() => {
    deadstageElapsed = 0;
    $("stamina-panel").classList.remove("hidden");
    $("health-panel").classList.add("hidden");
    $("stamina-fill").style.width = "100%";
    $("stamina-text").textContent = `${CONFIG.maxStamina} / ${CONFIG.maxStamina}`;
    $("mobile-controls").classList.add("deadstage-controls");
    $("joystick").style.opacity = "0";
    $("joystick").style.pointerEvents = "none";
    $("sprint-button").style.opacity = "0";
    $("dash-button").style.opacity = "0";
    $("shoot-button").style.opacity = "0";
    running = true;
  }), 0);
}
function startDeadstageChasers() {
  deadstageChasers = [];
  const corners = [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]];
  const mat = enemyTextureNormal ? createEnemyMaterial(enemyTextureNormal) : new THREE.MeshBasicMaterial({ color: 0xeeeeee });
  corners.forEach(([x,z]) => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.userData.startX = x; group.userData.startZ = z;
    const sprite = new THREE.Mesh(new THREE.PlaneGeometry(2,2), mat);
    sprite.position.y = 1;
    group.add(sprite);
    scene.add(group);
    deadstageChasers.push(group);
  });
}
function updateDeadstage(dt) {
  deadstageElapsed += dt;
  const t = Math.min(1, deadstageElapsed / 3);
  for (const enemy of deadstageChasers) {
    enemy.position.x = enemy.userData.startX * (1 - t);
    enemy.position.z = enemy.userData.startZ * (1 - t);
    if (enemy.children[0]) enemy.children[0].lookAt(camera.position.x, 1, camera.position.z);
  }
  if (deadstageElapsed >= 3 && deadstageChasers.some(e => Math.hypot(e.position.x, e.position.z) < CONFIG.enemyCatchDistance)) {
    triggerDeadstageCaught();
  }
}
function triggerDeadstageCaught() {
  if (ended) return;
  ended = true; running = false;
  $("bgm-yarimasune").volume = 0;
  $("mobile-controls").classList.remove("deadstage-controls");
  $("mobile-controls").style.display = "none";
  playCaptureVideoDirectly(() => {
    $("mobile-controls").style.display = "none";
    $("end-title").textContent = "DEATH CAUGHT";
    $("end-text").textContent = "捕獲された。";
    $("next-floor-button").classList.add("hidden");
    $("retry-floor-button").classList.add("hidden");
    $("restart-button").classList.remove("hidden");
    $("restart-button").textContent = "1階からやり直す";
    $("deadstage-boss-retry").classList.remove("hidden");
    $("end-overlay").classList.remove("hidden");
  });
}
function startBossStage(mode) {
  gameMode = mode;
  bossName = mode === "beastKing" ? "獣　王" : "world enemy";
  currentFloor = 1;
  hasRocketFromPreviousFloor = false;
  deathTransitioning = false;
  $("end-overlay").classList.add("hidden");
  $("boss-stage-menu").classList.add("hidden");
  $("mobile-controls").style.display = "block";
  $("mobile-controls").classList.remove("deadstage-controls");
  $("joystick").style.opacity = "1"; $("joystick").style.pointerEvents = "auto";
  $("sprint-button").style.opacity = "0";
  initStage(() => { running = true; ended = false; playAudio("se-start", 1); });
}

// ★ 追跡者制御（探知範囲11、A*最短追尾、突進時の捕獲判定→一番近い追跡者爆破撃破変化）
function moveEnemies(dt) {
  for (const eObj of enemies) {
    if (eObj.state === "defeated" || eObj.state === "frozen") continue;
    if (gameMode === "worldEnemy") eObj.attackCooldown = Math.max(0, eObj.attackCooldown - dt);
    if (eObj.state === "booming") {
      eObj.repathTimer -= dt;
      if (eObj.repathTimer <= 0) { eObj.state = "defeated"; eObj.group.visible = false; }
      continue;
    }
    const dxPlayer = player.position.x - eObj.group.position.x;
    const dzPlayer = player.position.z - eObj.group.position.z;
    const distPlayer = Math.hypot(dxPlayer, dzPlayer) || 0.001;

    if (gameMode === "beastKing") {
      eObj.chargeCooldown -= dt;
      if (eObj.chargeCooldown <= 0 && eObj.chargeTimer <= 0) {
        eObj.chargeTimer = 2;
        eObj.chargeCooldown = 10;
        eObj.chargeHit = false;
      }
      if (eObj.chargeTimer > 0) eObj.chargeTimer = Math.max(0, eObj.chargeTimer - dt);
      eObj.attackCooldown = Math.max(0, eObj.attackCooldown - dt);
      const speed = eObj.chargeTimer > 0 ? 10 : 5;
      const nx = eObj.group.position.x + dxPlayer / distPlayer * speed * dt;
      const nz = eObj.group.position.z + dzPlayer / distPlayer * speed * dt;
      if (canStand(nx, eObj.group.position.z, CONFIG.enemyRadius * 2, maze)) eObj.group.position.x = nx;
      if (canStand(eObj.group.position.x, nz, CONFIG.enemyRadius * 2, maze)) eObj.group.position.z = nz;
      eObj.group.rotation.y = Math.atan2(dxPlayer, dzPlayer);
      const bossStep = elevationsList.find(el => Math.abs(eObj.group.position.x-el.position.x)<CONFIG.cellSize*.5 && Math.abs(eObj.group.position.z-el.position.z)<CONFIG.cellSize*.5);
      eObj.group.position.y = bossStep ? bossStep.height : 0;
      if (distPlayer < CONFIG.enemyCatchDistance * 2) {
        if (eObj.chargeTimer > 0 && !eObj.chargeHit) {
          eObj.hp -= 5;
          updateBossHealthUI(eObj.hp);
          eObj.chargeHit = true;
          showMessage(`ボス突進が命中！ 獣王HP ${Math.max(0, eObj.hp)}`);
        } else if (eObj.chargeTimer <= 0 && eObj.attackCooldown <= 0) {
          damagePlayer(4);
          eObj.attackCooldown = 1.5;
        }
      }
      if (eObj.hp <= 0) finishBossClear();
      continue;
    }

    const canSee = lineOfSight(eObj.group.position, player.position, maze);
    if (canSee && distPlayer <= CONFIG.enemyDetectDistance) eObj.state = "chase";
    let target = eObj.state === "chase" ? player.position : eObj.target;
    if (!target || (eObj.state !== "chase" && Math.hypot(eObj.group.position.x-target.x,eObj.group.position.z-target.z)<1.5)) {
      const rx = 1 + Math.floor(Math.random() * (maze.length - 2));
      const rz = 1 + Math.floor(Math.random() * (maze.length - 2));
      eObj.target = cellWorld(rx, rz, maze.length);
      target = eObj.target;
    }
    eObj.repathTimer -= dt;
    if (eObj.repathTimer <= 0 || !eObj.path?.length) {
      eObj.repathTimer = CONFIG.enemyRepathInterval;
      eObj.path = findPathAStar(eObj.group.position, target, maze);
      eObj.pathIndex = 0;
    }
    let waypoint = eObj.path[eObj.pathIndex] || target;
    let dx = waypoint.x - eObj.group.position.x, dz = waypoint.z - eObj.group.position.z;
    let len = Math.hypot(dx, dz);
    if (len < 0.6 && eObj.pathIndex < eObj.path.length - 1) {
      eObj.pathIndex++;
      waypoint = eObj.path[eObj.pathIndex];
      dx = waypoint.x - eObj.group.position.x; dz = waypoint.z - eObj.group.position.z; len = Math.hypot(dx,dz);
    }
    if (len > 0.05) {
      const speed = eObj.state === "chase" ? CONFIG.enemyChaseSpeed : CONFIG.enemyWalkSpeed;
      const nx = eObj.group.position.x + dx / len * speed * dt;
      const nz = eObj.group.position.z + dz / len * speed * dt;
      if (canStand(nx, eObj.group.position.z, CONFIG.enemyRadius, maze)) eObj.group.position.x = nx;
      if (canStand(eObj.group.position.x, nz, CONFIG.enemyRadius, maze)) eObj.group.position.z = nz;
      eObj.group.rotation.y = Math.atan2(dx, dz);
    }
    const enemyStep = elevationsList.find(el => Math.abs(eObj.group.position.x-el.position.x)<CONFIG.cellSize*.5 && Math.abs(eObj.group.position.z-el.position.z)<CONFIG.cellSize*.5);
    eObj.group.position.y = enemyStep ? enemyStep.height : 0;
    const dist = Math.hypot(player.position.x-eObj.group.position.x, player.position.z-eObj.group.position.z);
    if (dist < CONFIG.enemyCatchDistance && invulnerableTimer <= 0) {
      if (isDashing && gameMode === "normal") {
        eObj.state = "booming"; eObj.repathTimer = 1;
        if (enemyTextureBoom && eObj.planeMesh) eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
        playAudio("se-boom", 1);
      } else if (gameMode === "worldEnemy") {
        if (eObj.attackCooldown <= 0) { damagePlayer(4); eObj.attackCooldown = 2; }
      } else if (gameMode === "normal") finishGame(false);
    }
  }
}

function shootRocket() {
  if (!running || ended || gameMode === "deadstage" || rocketAmmo <= 0) return;
  rocketAmmo--;
  if (rocketAmmo <= 0) {
    $("rocket-hud").classList.add("hidden");
    $("shoot-button").classList.add("hidden");
  }
  const projectileMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 8, 8),
    new THREE.MeshBasicMaterial({color: 0xff5500})
  );
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  projectileMesh.position.copy(camera.position);
  scene.add(projectileMesh);

  projectiles.push({ mesh: projectileMesh, direction: dir, speed: CONFIG.projectileSpeed, life: 4.0 });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.direction, p.speed * dt);
    if (isWallAt(p.mesh.position.x, p.mesh.position.z, maze) || p.life <= 0) {
      scene.remove(p.mesh); projectiles.splice(i, 1); continue;
    }
    for (const eObj of enemies) {
      if (eObj.state === "defeated" || eObj.state === "booming" || !eObj.group.visible) continue;
      if (Math.hypot(p.mesh.position.x-eObj.group.position.x,p.mesh.position.z-eObj.group.position.z) > CONFIG.projectileHitRadius) continue;
      if (gameMode === "beastKing") {
        eObj.hp -= 15;
        updateBossHealthUI(eObj.hp);
        showMessage(`ロケット命中！ 獣王HP ${Math.max(0,eObj.hp)}`);
        if (eObj.hp <= 0) finishBossClear();
      } else {
        eObj.state = "booming"; eObj.repathTimer = 1;
        if (enemyTextureBoom && eObj.planeMesh) eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
      }
      playAudio("se-boom", 1);
      scene.remove(p.mesh); projectiles.splice(i, 1);
      break;
    }
  }
}

function updateCompasses() {
  if (ended || !gameSettings.compass) return;

  if (goalMesh) {
    const exitDx = goalMesh.position.x - player.position.x;
    const exitDz = goalMesh.position.z - player.position.z;
    $("exit-distance").textContent = Math.floor(Math.hypot(exitDx, exitDz)) + "m";
    const exitAngle = Math.atan2(-exitDx, -exitDz) - yaw;
    $("exit-needle").style.transform = `translateX(-50%) rotate(${-exitAngle}rad)`;
  }

  let nearestDist = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const eObj = enemies[i];
    const needle = $(`radar-needle-${i}`);
    if (!needle) continue;

    if (eObj.state === "defeated") {
      needle.style.display = "none";
      continue;
    }
    needle.style.display = "block";

    const yajuDx = eObj.group.position.x - player.position.x;
    const yajuDz = eObj.group.position.z - player.position.z;
    const dist = Math.hypot(yajuDx, yajuDz);
    if (dist < nearestDist) nearestDist = dist;

    const yajuAngle = Math.atan2(-yajuDx, -yajuDz) - yaw;
    needle.style.transform = `translateX(-50%) rotate(${-yajuAngle}rad)`;
  }

  const radar = $("radar");
  if (radar) {
    if (nearestDist < CONFIG.radarYellowDist) {
      radar.style.borderColor = "#ff3333";
    } else if (nearestDist < CONFIG.radarGreenDist) {
      radar.style.borderColor = "#ffff33";
    } else {
      radar.style.borderColor = "#82c78c";
    }
  }
}

function finishBossClear() {
  if (ended) return;
  ended = true; running = false;
  $("bgm-yarimasune").volume = 0;
  $("end-title").textContent = "BOSS CLEAR!!";
  $("end-text").textContent = `君は（${bossName}）を倒した！！`;
  $("next-floor-button").classList.add("hidden");
  $("retry-floor-button").classList.add("hidden");
  $("restart-button").classList.remove("hidden");
  $("restart-button").textContent = "最初からスタート";
  $("deadstage-boss-retry").classList.add("hidden");
  $("end-overlay").classList.remove("hidden");
  playAudio("se-clear", 1);
}
function finishGame(win) {
  if (ended) return;
  ended = true; running = false;
  $("bgm-yarimasune").volume = 0;

  if (win) {
    if (currentFloor < CONFIG.maxFloors) {
      $("end-title").textContent = `${currentFloor}F CLEARED!`;
      $("end-text").textContent = `第 ${currentFloor} 階層を突破！次の階層へ進みます。`;
      $("next-floor-button").classList.remove("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.add("hidden");
    } else {
      $("end-title").textContent = "ALL CLEAR!!";
      $("end-text").textContent = "おめでとう！全5階層の迷路を完全脱出した！";
      $("next-floor-button").classList.add("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "最初からスタート";
      $("boss-stage-menu").classList.remove("hidden");
    }
    playAudio("se-clear", 1.0);
    $("end-overlay").classList.remove("hidden");
  } else {
    playCaptureVideoDirectly(() => {
      $("end-title").textContent = "CAUGHT";
      $("end-text").textContent = `第 ${currentFloor} 階層で追跡者に捕まった…`;
      $("next-floor-button").classList.add("hidden");
      $("retry-floor-button").classList.remove("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "1階からやり直す";
      $("end-overlay").classList.remove("hidden");
    });
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

const frameInterval = 1000 / CONFIG.targetFPS;

function animate(now) {
  requestAnimationFrame(animate);
  const delta = now - lastFrameTime;
  if (delta < frameInterval) return;
  lastFrameTime = now - (delta % frameInterval);
  frameCount++;
  if (now - fpsTimer >= 1000) {
    $("fps-counter").textContent = `FPS: ${frameCount}`;
    frameCount = 0; fpsTimer = now;
  }
  const dt = Math.min(clock ? clock.getDelta() : 0, 0.05);
  if (running && !ended) {
    if (gameMode === "deadstage") {
      updateDeadstage(dt);
    } else {
      floorTimer = Math.max(0, floorTimer - dt);
      $("timer-display").textContent = `${Math.ceil(floorTimer)}秒`;
      if (floorTimer <= 0) {
        if (gameMode === "worldEnemy" || gameMode === "beastKing") beginDeadstage();
        else finishGame(false);
      }
      if (invulnerableTimer > 0) invulnerableTimer = Math.max(0, invulnerableTimer-dt);
      if (running && !ended) {
        movePlayer(dt);
        moveEnemies(dt);
        updateProjectiles(dt);
        updateOcclusionAndLOD();
        for (const eObj of enemies) {
          if (eObj.group?.children[0] && eObj.state !== "defeated") {
            const sprite = eObj.group.children[0];
            sprite.lookAt(camera.position.x, sprite.getWorldPosition(new THREE.Vector3()).y, camera.position.z);
          }
        }
        updateCompasses();
        if (goalMesh && Math.hypot(player.position.x-goalMesh.position.x,player.position.z-goalMesh.position.z)<1.35) finishGame(true);
      }
    }
  }
  if (renderer && scene && camera) renderer.render(scene,camera);
}

function setupControls() {
  const joy = $("joystick"), stick = $("stick");
  const look = $("look-pad");
  const sprint = $("sprint-button");
  const dashBtn = $("dash-button");
  const shootBtn = $("shoot-button");

  let joyPointerId = null, lookPointerId = null;
  let lastTouchX = 0, lastTouchY = 0;

  joy.addEventListener("pointerdown", e => {
    e.preventDefault();
    joyPointerId = e.pointerId;
    joy.setPointerCapture(joyPointerId);
    updateStick(e);
  });
  joy.addEventListener("pointermove", e => {
    if (e.pointerId === joyPointerId && gameMode !== "deadstage") updateStick(e);
  });
  const resetStick = e => {
    if (e.pointerId === joyPointerId) {
      joyPointerId = null;
      joystick = {x: 0, z: 0};
      stick.style.transform = `translate(0, 0)`;
    }
  };
  joy.addEventListener("pointerup", resetStick);
  joy.addEventListener("pointercancel", resetStick);

  function updateStick(e) {
    const rect = joy.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const maxRadius = 45;
    const dist = Math.hypot(dx, dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    joystick.x = dx / maxRadius;
    joystick.z = dy / maxRadius;
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  look.addEventListener("pointerdown", e => {
    lookPointerId = e.pointerId;
    lastTouchX = e.clientX;
    lastTouchY = e.clientY;
    look.setPointerCapture(lookPointerId);
  });
  look.addEventListener("pointermove", e => {
    if (e.pointerId === lookPointerId) {
      const dx = e.clientX - lastTouchX;
      const dy = e.clientY - lastTouchY;
      yaw -= dx * 0.005;
      pitch = clamp(pitch - dy * 0.005, -1.35, 1.35);
      lastTouchX = e.clientX;
      lastTouchY = e.clientY;
    }
  });
  const resetLook = e => {
    if (e.pointerId === lookPointerId) lookPointerId = null;
  };
  look.addEventListener("pointerup", resetLook);
  look.addEventListener("pointercancel", resetLook);

  sprint.addEventListener("pointerdown", e => { if (gameMode === "deadstage") return; e.preventDefault(); sprintHeld = true; });
  sprint.addEventListener("pointerup", () => { sprintHeld = false; });
  sprint.addEventListener("pointercancel", () => { sprintHeld = false; });

  dashBtn.addEventListener("pointerdown", e => { if (gameMode === "deadstage") return; e.preventDefault(); triggerDash(); });
  shootBtn.addEventListener("pointerdown", e => { if (gameMode === "deadstage") return; e.preventDefault(); shootRocket(); });
}

function handleResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function startGameFromSettings() {
  gameSettings.compass = $("setting-compass").checked;
  gameSettings.progressiveEnemies = $("setting-progressive-enemies").checked;

  // ★ スタート時に動画が誤って再生されないよう確実にストップ制御
  stopCaptureVideoImmediately();
  unlockAndPreloadMedia();

  gameMode = "normal"; bossName = ""; deathTransitioning = false;
  $("boss-stage-menu").classList.add("hidden");
  currentFloor = 1;
  hasRocketFromPreviousFloor = false; // 1階開始時はリセット

  initStage(() => {
    $("overlay").classList.add("hidden");
    $("end-overlay").classList.add("hidden");
    document.body.classList.add("game-active");

    running = true; ended = false;
    playAudio("se-start", 1.0);
    if (matchMedia("(pointer:fine)").matches) renderer.domElement.requestPointerLock?.();
  });
}

function nextFloor() {
  currentFloor++;
  initStage(() => {
    $("end-overlay").classList.add("hidden");
    running = true; ended = false;
    playAudio("se-start", 1.0);
  });
}

function retryCurrentFloor() {
  $("end-overlay").classList.add("hidden");
  setTimeout(() => {
    playAudio("se-restart", 1.0);
    setTimeout(() => {
      const se = $("se-restart");
      if (se) { se.pause(); se.currentTime = 0; }
    }, 2000);
  }, 1000);

  initStage(() => {
    running = true; ended = false;
  });
}

function retryBossStage() {
  const mode = bossName === "獣　王" ? "beastKing" : "worldEnemy";
  deathTransitioning = false; $("deadstage-boss-retry").classList.add("hidden");
  $("end-overlay").classList.add("hidden"); $("mobile-controls").style.display = "block";
  $("mobile-controls").classList.remove("deadstage-controls");
  $("joystick").style.opacity = "1"; $("joystick").style.pointerEvents = "auto";
  $("sprint-button").style.opacity = "1"; $("dash-button").style.opacity = "1"; $("shoot-button").style.opacity = "1";
  startBossStage(mode);
}
function restartFromFloor1() {
  gameMode = "normal"; bossName = ""; deathTransitioning = false;
  $("boss-stage-menu").classList.add("hidden");
  $("deadstage-boss-retry").classList.add("hidden");
  $("mobile-controls").style.display = "block";
  $("mobile-controls").classList.remove("deadstage-controls");
  $("joystick").style.opacity = "1"; $("joystick").style.pointerEvents = "auto";
  $("sprint-button").style.opacity = "1"; $("dash-button").style.opacity = "1"; $("shoot-button").style.opacity = "1";
  currentFloor = 1;
  hasRocketFromPreviousFloor = false;
  $("end-overlay").classList.add("hidden");
  setTimeout(() => {
    playAudio("se-restart", 1.0);
    setTimeout(() => {
      const se = $("se-restart");
      if (se) { se.pause(); se.currentTime = 0; }
    }, 2000);
  }, 1000);

  initStage(() => {
    running = true; ended = false;
  });
}

disableGestures();
window.addEventListener("resize", handleResize);

$("start-button").addEventListener("click", startGameFromSettings);
$("next-floor-button").addEventListener("click", nextFloor);
$("retry-floor-button").addEventListener("click", retryCurrentFloor);
$("restart-button").addEventListener("click", restartFromFloor1);
$("boss-world-enemy").addEventListener("click", () => startBossStage("worldEnemy"));
$("boss-beast-king").addEventListener("click", () => startBossStage("beastKing"));
$("deadstage-boss-retry").addEventListener("click", retryBossStage);

addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "Space") shootRocket();
  if (e.code === "KeyE" || e.code === "ShiftRight") triggerDash();
});
addEventListener("keyup", e => keys[e.code] = false);

addEventListener("mousemove", e => {
  if (document.pointerLockElement && running) {
    yaw -= e.movementX * .0022;
    pitch = clamp(pitch - e.movementY * .0022, -1.35, 1.35);
  }
});

setupControls();
animate(performance.now());
