import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight, findPathAStar } from "./collision.js";
import { generateMaze, buildScene, setupMapRockets } from "./worldBuilder.js";
import { generateBossMaze, buildBossScene, setupBossMapRockets } from "./bossWorldBuilder.js";
import { buildDeadStageScene } from "./deadStage.js";
import { buildClearStageScene } from "./clearStage.js";

let scene, camera, renderer, clock;
let maze, player, goalMesh;
let enemies = [];
let bossObj = null; // { group, planeMesh, radius, hitRadius, type }
let running = false, ended = false;
let currentFloor = 1;
let isBossStage = false;
let bossTypeMode = null; // "world_enemy" or "beast_king"

let stamina = CONFIG.maxStamina;
let health = CONFIG.maxHealth;
let bossHp = 100;
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0, z:0};
let sprintHeld = false;

let stageTimeRemaining = CONFIG.stageTimeLimit;

// ボス用タイマー
let bossTimer1 = 0; // WE:10秒召喚 / BK:10秒突進タイマー
let bossTimer2 = 0; // WE:2秒弾丸タイマー
let bossDashDurationTimer = 0; // BK:2秒突進持続タイマー
let isBossDashing = false; // 獣王が突進中かどうか
let bossProjectiles = [];

// 突進状態
let isDashing = false;
let dashTimer = 0;
let dashCooldownTimer = 0;
let hasHitBossInCurrentDash = false; // 一突進で1回のみダメージ判定用

// トラップ鈍足化
let isSlowed = false;
let slowTimer = 0;

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

let isDeadStageEvent = false;
let isClearStageEvent = false;

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
  preloadedVideo.pause();
  preloadedVideo.currentTime = 0;
}

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

function setupEnemiesOptimized(openCells, spawnPos) {
  for (let eObj of enemies) { if (eObj.group) scene.remove(eObj.group); }
  enemies = [];

  const totalEnemies = isBossStage ? 0 : (gameSettings.progressiveEnemies ? currentFloor : 1);

  for (let i = 0; i < totalEnemies; i++) {
    const candidates = openCells.filter(c => Math.hypot(cellWorld(c.x, c.z, maze.length).x - spawnPos.x, cellWorld(c.x, c.z, maze.length).z - spawnPos.z) >= 4);
    const spawnCellPos = candidates[Math.floor(Math.random() * candidates.length)] || openCells[0];

    const ep = cellWorld(spawnCellPos.x, spawnCellPos.z, maze.length);
    const group = new THREE.Group();
    group.position.set(ep.x, 0, ep.z);
    scene.add(group);

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
    planeMesh.position.y = 1.0;
    group.add(planeMesh);

    if (enemyTextureNormal) {
      planeMesh.material = createEnemyMaterial(enemyTextureNormal);
    }

    enemies.push({
      id: i, group, planeMesh, state: "patrol", target: null,
      path: [], pathIndex: 0, repathTimer: 0, attackCdTimer: 0,
      color: NEEDLE_COLORS[i % NEEDLE_COLORS.length]
    });
  }

  updateRadarUI(totalEnemies);
}

function updateRadarUI(totalEnemies) {
  const radarCircle = $("radar");
  radarCircle.innerHTML = "";
  if (!gameSettings.compass || isBossStage) return;

  for (let i = 0; i < totalEnemies; i++) {
    const needle = document.createElement("div");
    needle.id = `radar-needle-${i}`;
    needle.className = "needle";
    needle.style.backgroundColor = NEEDLE_COLORS[i % NEEDLE_COLORS.length];
    radarCircle.appendChild(needle);
  }
}

function cleanupPreviousStage() {
  if (scene) {
    scene.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    scene.clear();
  }
  enemies = [];
  mapRocketItems = [];
  projectiles = [];
  bossProjectiles = [];
  elevationsList = [];
  trapsList = [];
  pointLightsList = [];
  if (goalMesh) { goalMesh = null; }
  if (bossObj) { bossObj = null; }
}

function initStage(callback) {
  showLoading(true, isBossStage ? `BOSS STAGE (${bossTypeMode})` : `${currentFloor}F GENERATING...`);

  setTimeout(() => {
    cleanupPreviousStage();

    if (renderer) {
      const dom = renderer.domElement;
      if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
    }

    stageTimeRemaining = CONFIG.stageTimeLimit;
    bossTimer1 = 0;
    bossTimer2 = 0;
    bossDashDurationTimer = 0;
    isBossDashing = false;
    bossHp = 100;

    if (isBossStage) {
      maze = generateBossMaze(10);
      const built = buildBossScene(maze, bossTypeMode);
      scene = built.scene;
      pointLightsList = built.pointLightsList;
      elevationsList = built.elevations;
      trapsList = built.traps;
      bossObj = built.bossObj;
    } else {
      maze = generateMaze(CONFIG.mazeCells);
      const built = buildScene(maze);
      scene = built.scene;
      pointLightsList = built.pointLightsList;
      elevationsList = built.elevations;
      trapsList = built.traps;
    }

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
    camera.rotation.order = "YXZ";

    renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
    renderer.setSize(window.innerWidth, window.innerHeight);
    $("game").appendChild(renderer.domElement);

    clock = new THREE.Clock();

    const open = [];
    for(let z=1; z<maze.length-1; z++) for(let x=1; x<maze.length-1; x++) if(maze[z][x]===0) open.push({x,z});
    
    const spawnPos = isBossStage ? cellWorld(1, 1, maze.length) : cellWorld(startCell.x, startCell.z, maze.length);
    player = { position: new THREE.Vector3(spawnPos.x, 1.4, spawnPos.z), baseEyeY: 1.4 };
    camera.position.copy(player.position);

    if (!isBossStage) {
      placeGoalFixed(open);
    }

    stamina = CONFIG.maxStamina;
    health = CONFIG.maxHealth;
    isDashing = false; dashTimer = 0; dashCooldownTimer = 0; hasHitBossInCurrentDash = false;
    isSlowed = false; slowTimer = 0;
    isDeadStageEvent = false;
    isClearStageEvent = false;

    if (hasRocketFromPreviousFloor) {
      rocketAmmo = CONFIG.maxRocketAmmo;
      $("rocket-hud").classList.remove("hidden");
      $("shoot-button").classList.remove("hidden");
    } else {
      rocketAmmo = 0;
      $("rocket-hud").classList.add("hidden");
      $("shoot-button").classList.add("hidden");
    }

    if (isBossStage) {
      mapRocketItems = setupBossMapRockets(scene, open, maze.length, elevationsList);
    } else {
      mapRocketItems = setupMapRockets(scene, open, maze.length, spawnPos, elevationsList);
    }

    setupEnemiesOptimized(open, spawnPos);

    if (isBossStage) {
      // ★ 全ボスステージ：走るボタン消去
      $("sprint-button").classList.add("hidden");
      $("compass-container").classList.add("hidden");
      $("boss-hud-container").classList.remove("hidden");
      $("boss-name-label").textContent = bossTypeMode === "world_enemy" ? "WORLD ENEMY" : "BEAST KING";
      $("boss-hp-fill").style.width = "100%";
      $("boss-hp-text").textContent = "100 / 100";
      $("bar-label").textContent = "HEALTH";
    } else {
      $("sprint-button").classList.remove("hidden");
      $("boss-hud-container").classList.add("hidden");
      if (gameSettings.compass) $("compass-container").classList.remove("hidden");
      else $("compass-container").classList.add("hidden");
      $("floor-display").textContent = `${currentFloor}F`;
      $("bar-label").textContent = "STAMINA";
    }

    if (!enemyTextureNormal) {
      loader.load(CHASER_IMAGES[0], tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        enemyTextureNormal = tex;
        for (let e of enemies) if (e.planeMesh) e.planeMesh.material = createEnemyMaterial(tex);
      });
    }
    if (!enemyTextureBoom) {
      loader.load(BOOM_IMAGE, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        enemyTextureBoom = tex;
      });
    }

    if (!isBossStage && goalMesh) {
      const dx = goalMesh.position.x - spawnPos.x;
      const dz = goalMesh.position.z - spawnPos.z;
      yaw = Math.atan2(-dx, -dz);
    } else {
      yaw = 0;
    }
    camera.rotation.set(0, yaw, 0);

    invulnerableTimer = CONFIG.invulnerableDuration;

    showLoading(false);
    if (callback) callback();
  }, 100);
}

function startClearStageEvent() {
  if (isClearStageEvent) return;
  isClearStageEvent = true;
  showLoading(true, "CLEARING STAGE...");

  setTimeout(() => {
    cleanupPreviousStage();

    const clearBuilt = buildClearStageScene();
    scene = clearBuilt.scene;

    player.position.set(0, 1.4, 0);
    camera.position.copy(player.position);

    showLoading(false);
    
    ended = true; running = false;
    $("bgm-yarimasune").volume = 0;

    $("end-title").textContent = "ボスステージCLEAR！！";
    const bossNameStr = bossTypeMode === "world_enemy" ? "world enemy" : "獣 王";
    $("end-text").innerHTML = `君は${bossNameStr}を倒した！！`;
    $("boss-stages-section").classList.add("hidden");
    $("next-floor-button").classList.add("hidden");
    $("retry-floor-button").classList.add("hidden");
    $("restart-button").classList.remove("hidden");
    $("restart-button").textContent = "最初(1階のこと)から始める";

    playAudio("se-clear", 1.0);
    $("end-overlay").classList.remove("hidden");
    if (document.pointerLockElement) document.exitPointerLock();
  }, 1000);
}

function startDeadStageEvent() {
  if (isDeadStageEvent) return;
  isDeadStageEvent = true;
  showLoading(true, "ENTERING DEAD STAGE...");

  setTimeout(() => {
    cleanupPreviousStage();

    const deadBuilt = buildDeadStageScene();
    scene = deadBuilt.scene;

    player.position.set(0, 1.4, 0);
    camera.position.copy(player.position);

    $("bar-label").textContent = "STAMINA";
    stamina = CONFIG.maxStamina;

    $("mobile-controls").style.opacity = "0";
    $("mobile-controls").style.pointerEvents = "none";
    $("look-pad").style.pointerEvents = "none";

    const deadEnemiesCount = 4;
    const startRadius = 6.0;
    for (let i = 0; i < deadEnemiesCount; i++) {
      const angle = (i / deadEnemiesCount) * Math.PI * 2;
      const ex = Math.cos(angle) * startRadius;
      const ez = Math.sin(angle) * startRadius;
      const group = new THREE.Group();
      group.position.set(ex, 0, ez);
      scene.add(group);

      const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
      planeMesh.position.y = 1.0;
      group.add(planeMesh);
      if (enemyTextureNormal) planeMesh.material = createEnemyMaterial(enemyTextureNormal);

      enemies.push({
        id: i, group, planeMesh, state: "dead_march",
        startX: ex, startZ: ez,
        marchTimer: 0, marchDuration: 3.0
      });
    }

    showLoading(false);
    showMessage("デッドステージイベント開始…追跡者が迫る！");
  }, 1000);
}

function updateOcclusionAndLOD() {
  if (!camera || !scene || isDeadStageEvent || isClearStageEvent) return;
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

function triggerDash() {
  if (!running || ended || isDashing || dashCooldownTimer > 0 || isDeadStageEvent || isClearStageEvent) return;

  // ★ ボスステージでは消費なしでクールダウン5秒ごとに使用可能
  if (!isBossStage) {
    if (stamina < CONFIG.dashStaminaCost) {
      showMessage("スタミナ不足！(消費: 10)");
      return;
    }
    stamina -= CONFIG.dashStaminaCost;
  }

  isDashing = true;
  dashTimer = CONFIG.dashDuration;
  dashCooldownTimer = CONFIG.dashCooldown; // 5秒クールダウン
  hasHitBossInCurrentDash = false; // 一突進で1回のみダメージ判定リセット

  playAudio("se-totugeki", 1.0);
  setTimeout(() => {
    const el = $("se-totugeki");
    if (el) { el.pause(); el.currentTime = 0; }
  }, 4000);

  showMessage("突進発動！");
}

function movePlayer(dt) {
  if (isDeadStageEvent || isClearStageEvent) return;

  if (isDashing) {
    dashTimer -= dt;
    if (dashTimer <= 0) isDashing = false;
  }

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

  let currentSpeed = CONFIG.walkSpeed;

  if (isBossStage) {
    // ★ 全ボスステージ：常時走るスピード (消費不要)
    currentSpeed = isDashing ? CONFIG.dashSpeed : CONFIG.runSpeed;
  } else {
    if (isDashing) {
      currentSpeed = CONFIG.dashSpeed;
    } else {
      const isRunning = (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && isMoving && stamina > 0;
      if (isRunning) {
        stamina = Math.max(0, stamina - CONFIG.staminaUsePerSecond * dt);
        currentSpeed = CONFIG.runSpeed;
      } else {
        stamina = Math.min(CONFIG.maxStamina, stamina + CONFIG.staminaRegenPerSecond * dt);
      }
    }
  }

  if (isSlowed) currentSpeed /= 2.0;

  if (isBossStage) {
    $("stamina-fill").style.width = `${health/CONFIG.maxHealth*100}%`;
    $("stamina-text").textContent = `${Math.ceil(health)} / ${CONFIG.maxHealth}`;
  } else {
    $("stamina-fill").style.width = `${stamina/CONFIG.maxStamina*100}%`;
    $("stamina-text").textContent = `${Math.ceil(stamina)} / ${CONFIG.maxStamina}`;
  }

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(currentSpeed * dt);

  const nx = player.position.x + delta.x, nz = player.position.z + delta.z;
  if (canStand(nx, player.position.z, CONFIG.playerRadius, maze)) player.position.x = nx;
  if (canStand(player.position.x, nz, CONFIG.playerRadius, maze)) player.position.z = nz;

  let currentStepHeight = 0;
  for (let el of elevationsList) {
    if (Math.abs(player.position.x - el.position.x) < CONFIG.cellSize * 0.5 &&
        Math.abs(player.position.z - el.position.z) < CONFIG.cellSize * 0.5) {
      currentStepHeight = Math.max(currentStepHeight, el.height);
    }
  }

  if (!isBossStage) {
    for (let t of trapsList) {
      if (t.active && Math.abs(player.position.x - t.position.x) < CONFIG.cellSize * 0.5 &&
          Math.abs(player.position.z - t.position.z) < CONFIG.cellSize * 0.5) {
        currentStepHeight = Math.max(currentStepHeight, t.height);
        if (!isSlowed) {
          isSlowed = true;
          slowTimer = CONFIG.trapSlowDuration;
          showMessage("トラップにかかった！(3秒間移動速度1/2)");
        }
      }
    }
  }

  player.position.y = player.baseEyeY + currentStepHeight;
  camera.position.copy(player.position);
  camera.rotation.set(pitch, yaw, 0);

  // 突進接触時のボスダメージ判定（一突進で1回のみ）
  if (isDashing && !hasHitBossInCurrentDash && isBossStage && bossObj) {
    const bPos = bossObj.group.position;
    const hitRadius = bossObj.hitRadius || 3.0;
    const distToBoss = Math.hypot(player.position.x - bPos.x, player.position.z - bPos.z);
    if (distToBoss <= hitRadius) {
      hasHitBossInCurrentDash = true;
      const dmg = (bossObj.type === "beast_king") ? 5 : 10; // 獣王は突進5dmg、WEは突進10dmg
      bossHp -= dmg;
      playAudio("se-boom", 1.0);
      showMessage(`突進命中！ボスに${dmg}ダメージ！ 残りHP: ${bossHp}`);
      $("boss-hp-fill").style.width = `${Math.max(0, bossHp)}%`;
      $("boss-hp-text").textContent = `${Math.max(0, bossHp)} / 100`;

      if (bossHp <= 0) {
        startClearStageEvent();
      }
    }
  }
}

// ボスロジック（world enemy & 獣 王）
function updateBossLogic(dt) {
  if (!isBossStage || !bossObj || isDeadStageEvent || isClearStageEvent) return;

  if (bossObj.type === "world_enemy") {
    // world enemy
    bossTimer2 += dt;
    if (bossTimer2 >= 2.0) {
      bossTimer2 = 0;
      const sphereGeo = new THREE.SphereGeometry(0.5, 8, 8);
      const sphereMat = new THREE.MeshBasicMaterial({color: 0x3498db});
      const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
      
      sphereMesh.position.copy(bossObj.group.position);
      scene.add(sphereMesh);

      const dir = new THREE.Vector3().subVectors(player.position, bossObj.group.position).normalize();
      bossProjectiles.push({ mesh: sphereMesh, direction: dir, speed: 12.0, life: 5.0 });
    }

    // 青い球体当たり判定
    for (let i = bossProjectiles.length - 1; i >= 0; i--) {
      const bp = bossProjectiles[i];
      bp.life -= dt;
      bp.mesh.position.addScaledVector(bp.direction, bp.speed * dt);

      if (isWallAt(bp.mesh.position.x, bp.mesh.position.z, maze) || bp.life <= 0) {
        scene.remove(bp.mesh);
        bossProjectiles.splice(i, 1);
        continue;
      }

      if (Math.hypot(player.position.x - bp.mesh.position.x, player.position.z - bp.mesh.position.z) <= 1.2) {
        if (invulnerableTimer <= 0) {
          health -= 5;
          invulnerableTimer = 1.0;
          showMessage("ボスからの弾が命中！ 5ダメージ！ 残りHP: " + health);
          if (health <= 0) {
            startDeadStageEvent();
          }
        }
        scene.remove(bp.mesh);
        bossProjectiles.splice(i, 1);
      }
    }

    // 10秒ごとに追跡者召喚
    bossTimer1 += dt;
    if (bossTimer1 >= 10.0) {
      bossTimer1 = 0;
      const spawnCount = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < spawnCount; k++) {
        const angle = Math.random() * Math.PI * 2;
        const ex = bossObj.group.position.x + Math.cos(angle) * 2.0;
        const ez = bossObj.group.position.z + Math.sin(angle) * 2.0;

        const group = new THREE.Group();
        group.position.set(ex, 0, ez);
        scene.add(group);

        const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
        planeMesh.position.y = 1.0;
        group.add(planeMesh);
        if (enemyTextureNormal) planeMesh.material = createEnemyMaterial(enemyTextureNormal);

        enemies.push({
          id: enemies.length, group, planeMesh, state: "chase", target: null,
          path: [], pathIndex: 0, repathTimer: 0, attackCdTimer: 0,
          color: NEEDLE_COLORS[enemies.length % NEEDLE_COLORS.length]
        });
      }
      playAudio("se-provoke", 1.0);
      showMessage("ボスが追跡者を召喚した！");
    }

  } else if (bossObj.type === "beast_king") {
    // ★ 獣 王
    // 常にビルボードでプレイヤーを見る
    if (bossObj.planeMesh) {
      bossObj.planeMesh.lookAt(camera.position.x, bossObj.planeMesh.getWorldPosition(new THREE.Vector3()).y, camera.position.z);
    }

    // 10秒毎に2秒間ボスの早さが2倍になる（ボス突進）
    bossTimer1 += dt;
    if (bossTimer1 >= 10.0) {
      bossTimer1 = 0;
      isBossDashing = true;
      bossDashDurationTimer = 2.0;
      playAudio("se-provoke", 1.0);
      showMessage("獣王の突進攻撃！(速度2倍)");
    }

    if (isBossDashing) {
      bossDashDurationTimer -= dt;
      if (bossDashDurationTimer <= 0) {
        isBossDashing = false;
      }
    }

    const moveSpeed = isBossDashing ? 10.0 : 5.0; // 常に速さ5で追いかけ、突進時2倍(10)

    const dx = player.position.x - bossObj.group.position.x;
    const dz = player.position.z - bossObj.group.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.1) {
      const dirX = dx / dist;
      const dirZ = dz / dist;
      const nextX = bossObj.group.position.x + dirX * moveSpeed * dt;
      const nextZ = bossObj.group.position.z + dirZ * moveSpeed * dt;

      if (canStand(nextX, bossObj.group.position.z, bossObj.radius, maze)) {
        bossObj.group.position.x = nextX;
      }
      if (canStand(bossObj.group.position.x, nextZ, bossObj.radius, maze)) {
        bossObj.group.position.z = nextZ;
      }
    }

    // 獣王の攻撃判定（大きさに見合った判定、caught無効でダメージ4）
    if (dist <= bossObj.hitRadius) {
      if (invulnerableTimer <= 0) {
        health -= 4;
        invulnerableTimer = 1.5; // ★ 1.5秒のクールダウン付き通常攻撃
        showMessage("獣王の攻撃を受けた！ 4ダメージ！ 残りHP: " + health);
        if (health <= 0) {
          startDeadStageEvent();
        }
      }
    }
  }
}

function moveEnemies(dt) {
  for (let eObj of enemies) {
    if (eObj.state === "defeated") continue;

    if (isDeadStageEvent && eObj.state === "dead_march") {
      eObj.marchTimer += dt;
      const progress = Math.min(1.0, eObj.marchTimer / eObj.marchDuration);
      eObj.group.position.x = THREE.MathUtils.lerp(eObj.startX, 0, progress);
      eObj.group.position.z = THREE.MathUtils.lerp(eObj.startZ, 0, progress);
      eObj.group.lookAt(player.position.x, eObj.group.position.y, player.position.z);

      if (progress >= 1.0) {
        finishGame(false);
      }
      continue;
    }

    if (eObj.state === "booming") {
      eObj.repathTimer -= dt;
      if (eObj.repathTimer <= 0) {
        eObj.state = "defeated";
        eObj.group.visible = false;
      }
      continue;
    }

    let targetWorldPos = null;
    const canSee = lineOfSight(eObj.group.position, player.position, maze);
    const distToPlayer = Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z);

    if (canSee && distToPlayer <= CONFIG.enemyDetectDistance) {
      eObj.state = "chase";
    }

    if (eObj.state === "chase") {
      targetWorldPos = player.position;
    } else {
      if (!eObj.target || Math.hypot(eObj.group.position.x - eObj.target.x, eObj.group.position.z - eObj.target.z) < 1.5) {
        const rx = 1 + Math.floor(Math.random() * (maze.length - 2));
        const rz = 1 + Math.floor(Math.random() * (maze.length - 2));
        eObj.target = cellWorld(rx, rz, maze.length);
      }
      targetWorldPos = eObj.target;
    }

    if (targetWorldPos) {
      eObj.repathTimer -= dt;
      if (eObj.repathTimer <= 0 || !eObj.path || eObj.path.length === 0) {
        eObj.repathTimer = CONFIG.enemyRepathInterval;
        eObj.path = findPathAStar(eObj.group.position, targetWorldPos, maze);
        eObj.pathIndex = 0;
      }

      let currentWaypoint = eObj.path[eObj.pathIndex] || targetWorldPos;
      const dx = currentWaypoint.x - eObj.group.position.x;
      const dz = currentWaypoint.z - eObj.group.position.z;
      const len = Math.hypot(dx, dz);

      if (len < 0.6 && eObj.pathIndex < eObj.path.length - 1) {
        eObj.pathIndex++;
        currentWaypoint = eObj.path[eObj.pathIndex];
      }

      const moveSpeed = (eObj.state === "chase") ? CONFIG.enemyChaseSpeed : CONFIG.enemyWalkSpeed;
      if (len > 0.05) {
        const dirX = (currentWaypoint.x - eObj.group.position.x) / (Math.hypot(currentWaypoint.x - eObj.group.position.x, currentWaypoint.z - eObj.group.position.z) || 1);
        const dirZ = (currentWaypoint.z - eObj.group.position.z) / (Math.hypot(currentWaypoint.x - eObj.group.position.x, currentWaypoint.z - eObj.group.position.z) || 1);

        const nextX = eObj.group.position.x + dirX * moveSpeed * dt;
        const nextZ = eObj.group.position.z + dirZ * moveSpeed * dt;

        if (canStand(nextX, eObj.group.position.z, CONFIG.enemyRadius, maze)) {
          eObj.group.position.x = nextX;
        }
        if (canStand(eObj.group.position.x, nextZ, CONFIG.enemyRadius, maze)) {
          eObj.group.position.z = nextZ;
        }

        let enemyStepH = 0;
        for (let el of elevationsList) {
          if (Math.abs(eObj.group.position.x - el.position.x) < CONFIG.cellSize * 0.5 &&
              Math.abs(eObj.group.position.z - el.position.z) < CONFIG.cellSize * 0.5) {
            enemyStepH = Math.max(enemyStepH, el.height);
          }
        }
        eObj.group.position.y = enemyStepH;

        eObj.group.rotation.y = Math.atan2(dirX, dirZ);
      }
    }

    if (eObj.attackCdTimer > 0) {
      eObj.attackCdTimer -= dt;
    }

    if (distToPlayer < CONFIG.enemyCatchDistance) {
      if (isDashing) {
        eObj.state = "booming";
        eObj.repathTimer = 1.0;
        if (enemyTextureBoom && eObj.planeMesh) {
          eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
        }
        playAudio("se-boom", 1.0);
        showMessage("突進撃破！！");
      } else if (invulnerableTimer <= 0 && !isDeadStageEvent) {
        if (isBossStage) {
          // ★ world enemyステージ等の追跡者攻撃にクールダウン(2秒間)を追加
          if (eObj.attackCdTimer <= 0) {
            eObj.attackCdTimer = 2.0; // クールダウン2秒
            health -= 3;
            showMessage("追跡者の攻撃を受けた！ 3ダメージ！ 残りHP: " + health);
            if (health <= 0) {
              startDeadStageEvent();
            }
          }
        } else {
          finishGame(false);
        }
      }
    }
  }
}

function shootRocket() {
  if (!running || ended || rocketAmmo <= 0 || isDeadStageEvent || isClearStageEvent) return;
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
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    if (isBossStage && bossObj) {
      const bPos = bossObj.group.position;
      const hitRadius = bossObj.hitRadius || 3.0;
      if (Math.hypot(bPos.x - p.mesh.position.x, bPos.z - p.mesh.position.z) <= hitRadius) {
        const dmg = (bossObj.type === "beast_king") ? 15 : 10; // ★ 獣王はロケット15dmg、WEは10dmg
        bossHp -= dmg;
        playAudio("se-boom", 1.0);
        showMessage(`ロケット命中！ボスに${dmg}ダメージ！ 残りHP: ${bossHp}`);
        $("boss-hp-fill").style.width = `${Math.max(0, bossHp)}%`;
        $("boss-hp-text").textContent = `${Math.max(0, bossHp)} / 100`;

        scene.remove(p.mesh);
        projectiles.splice(i, 1);

        if (bossHp <= 0) {
          startClearStageEvent();
        }
        continue;
      }
    }

    for (let eObj of enemies) {
      if (eObj.state !== "defeated" && eObj.state !== "booming" && eObj.group.visible) {
        if (Math.hypot(p.mesh.position.x - eObj.group.position.x, p.mesh.position.z - eObj.group.position.z) <= CONFIG.projectileHitRadius) {
          eObj.state = "booming";
          eObj.repathTimer = 1.0;
          if (enemyTextureBoom && eObj.planeMesh) {
            eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
          }
          playAudio("se-boom", 1.0);
          scene.remove(p.mesh);
          projectiles.splice(i, 1);
          break;
        }
      }
    }
  }
}

function updateCompasses() {
  if (ended || !gameSettings.compass || isDeadStageEvent || isClearStageEvent || isBossStage) return;

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

    if (eObj.state === "defeated" || eObj.state === "dead_march") {
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

function finishGame(win) {
  if (ended) return;
  ended = true; running = false;
  $("bgm-yarimasune").volume = 0;

  if (win) {
    if (!isBossStage && currentFloor < CONFIG.maxFloors) {
      $("end-title").textContent = `${currentFloor}F CLEARED!`;
      $("end-text").textContent = `第 ${currentFloor} 階層を突破！次の階層へ進みます。`;
      $("boss-stages-section").classList.add("hidden");
      $("next-floor-button").classList.remove("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.add("hidden");
    } else {
      $("end-title").textContent = isBossStage ? "BOSS DEFEATED!!" : "ALL CLEAR!!";
      $("end-text").textContent = isBossStage ? "ボスステージを完全制覇した！" : "おめでとう！全階層を脱出した！";
      $("boss-stages-section").classList.remove("hidden");
      $("next-floor-button").classList.add("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "1階からやり直す";
    }
    playAudio("se-clear", 1.0);
    $("end-overlay").classList.remove("hidden");
  } else {
    playCaptureVideoDirectly(() => {
      $("end-title").textContent = "CAUGHT";
      $("end-text").textContent = isDeadStageEvent ? "デッドステージで捕まった…" : `第 ${currentFloor} 階層で捕まった…`;
      $("boss-stages-section").classList.add("hidden");
      $("next-floor-button").classList.add("hidden");

      if (isBossStage) {
        $("retry-floor-button").textContent = "同じボスと戦う";
        $("retry-floor-button").classList.remove("hidden");
      } else {
        $("retry-floor-button").textContent = "同じ階をやり直す";
        $("retry-floor-button").classList.remove("hidden");
      }

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
    frameCount = 0;
    fpsTimer = now;
  }

  const dt = Math.min(clock.getDelta(), 0.05);

  if (running && !ended) {
    if (invulnerableTimer > 0) {
      invulnerableTimer -= dt;
      if (invulnerableTimer <= 0) showMessage("無敵時間が終了した");
    }

    if (!isDeadStageEvent && !isClearStageEvent) {
      stageTimeRemaining -= dt;
      if (stageTimeRemaining <= 0) {
        finishGame(true);
      }
      $("timer-display").textContent = `${Math.ceil(stageTimeRemaining)}s`;
    }

    movePlayer(dt);
    moveEnemies(dt);
    updateBossLogic(dt);
    updateProjectiles(dt);
    updateOcclusionAndLOD();

    for (let eObj of enemies) {
      if (eObj.group?.children[0] && eObj.state !== "defeated" && eObj.state !== "dead_march") {
        eObj.group.children[0].lookAt(camera.position.x, eObj.group.children[0].getWorldPosition(new THREE.Vector3()).y, camera.position.z);
      }
    }

    updateCompasses();

    if (!isBossStage && !isDeadStageEvent && !isClearStageEvent && goalMesh && Math.hypot(player.position.x - goalMesh.position.x, player.position.z - goalMesh.position.z) < 1.35) {
      finishGame(true);
    }
  }

  if (renderer && scene && camera) renderer.render(scene, camera);
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
    if (e.pointerId === joyPointerId) updateStick(e);
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

  sprint.addEventListener("pointerdown", e => { e.preventDefault(); sprintHeld = true; });
  sprint.addEventListener("pointerup", () => { sprintHeld = false; });
  sprint.addEventListener("pointercancel", () => { sprintHeld = false; });

  dashBtn.addEventListener("pointerdown", e => { e.preventDefault(); triggerDash(); });
  shootBtn.addEventListener("pointerdown", e => { e.preventDefault(); shootRocket(); });
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

  stopCaptureVideoImmediately();
  unlockAndPreloadMedia();

  currentFloor = 1;
  isBossStage = false;
  hasRocketFromPreviousFloor = false;

  initStage(() => {
    $("overlay").classList.add("hidden");
    $("end-overlay").classList.add("hidden");
    document.body.classList.add("game-active");

    running = true; ended = false;
    playAudio("se-start", 1.0);
    if (matchMedia("(pointer:fine)").matches) renderer.domElement.requestPointerLock?.();
  });
}

function startBossStage(type) {
  isBossStage = true;
  bossTypeMode = type;
  hasRocketFromPreviousFloor = false;

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

  if (isBossStage) {
    startBossStage(bossTypeMode);
  } else {
    initStage(() => {
      running = true; ended = false;
    });
  }
}

function restartFromFloor1() {
  currentFloor = 1;
  isBossStage = false;
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
$("boss-world-enemy-btn").addEventListener("click", () => startBossStage("world_enemy"));
$("boss-beast-king-btn").addEventListener("click", () => startBossStage("beast_king"));
$("next-floor-button").addEventListener("click", nextFloor);
$("retry-floor-button").addEventListener("click", retryCurrentFloor);
$("restart-button").addEventListener("click", restartFromFloor1);

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
