import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight, findPathAStar } from "./collision.js";
import { generateMaze, buildScene, setupMapRockets } from "./worldBuilder.js";
import { buildBossScene } from "./bossbuildworld.js";
import { buildDeadStage } from "./deadstagebuilt.js";

let scene, camera, renderer, clock;
let maze, player, goalMesh;
let enemies = [];
let running = false, ended = false;
let currentFloor = 1;
let gameMode = "normal"; // "normal", "boss_world_enemy", "boss_beast_king", "deadstage"

let stamina = CONFIG.maxStamina;
let playerHp = 20; // ボスステージ用体力
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0, z:0};

let isDashing = false;
let dashTimer = 0;
let dashCooldownTimer = 0;

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

// 戦闘時間タイマー (60秒)
let stageTimer = CONFIG.stageTimeLimit;

// DeadStageイベント用変数
let deadStageTimer = 0;
let deadStagePhase = 0; // 0: 追跡者接近中, 1: 待機・caught待ち

let lastFrameTime = performance.now();
let frameCount = 0;
let fpsTimer = 0;

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
  }, CONFIG.captureWaitTime * 1000); // 28秒
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

  if (gameMode === "boss_beast_king") {
    // 新ボス「獣　王」生成（通常の2倍の大きさ、HP100）
    const ep = { x: 0, z: -10 };
    const group = new THREE.Group();
    group.position.set(ep.x, 0, ep.z);
    scene.add(group);

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 4.0)); // 2倍の大きさ
    planeMesh.position.y = 2.0;
    group.add(planeMesh);

    if (enemyTextureNormal) {
      planeMesh.material = createEnemyMaterial(enemyTextureNormal);
    }

    enemies.push({
      id: 0, group, planeMesh, state: "chase", target: null,
      hp: 100, maxHp: 100, isBeastKing: true,
      attackCooldown: 0, bossDashTimer: 0, bossDashActive: false,
      path: [], pathIndex: 0, repathTimer: 0, frozenTimer: 0,
      color: "#ff0000"
    });
    updateRadarUI(1);
    return;
  }

  const baseCount = gameSettings.progressiveEnemies ? (gameMode === "boss_world_enemy" ? 4 : currentFloor) : 1;
  const totalEnemies = baseCount;

  for (let i = 0; i < totalEnemies; i++) {
    const candidates = openCells.filter(c => Math.hypot(cellWorld(c.x, c.z, gameMode === "boss_world_enemy" ? 10 : maze.length).x - spawnPos.x, cellWorld(c.x, c.z, gameMode === "boss_world_enemy" ? 10 : maze.length).z - spawnPos.z) >= 4);
    const spawnCellPos = candidates[Math.floor(Math.random() * candidates.length)] || openCells[0];

    const mapSz = gameMode === "boss_world_enemy" ? 10 : maze.length;
    const ep = cellWorld(spawnCellPos.x, spawnCellPos.z, mapSz);
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
      attackCooldown: 0, // world enemy攻撃クールダウン2秒
      path: [], pathIndex: 0, repathTimer: 0, frozenTimer: 0,
      color: NEEDLE_COLORS[i % NEEDLE_COLORS.length]
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

// ★ 堅牢なスタート（初期化）関数
function initStage(callback) {
  showLoading(true, gameMode.startsWith("boss") ? "BOSS STAGE GENERATING..." : `${currentFloor}F GENERATING...`);

  setTimeout(() => {
    try {
      if (renderer) {
        const dom = renderer.domElement;
        if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
      }

      stageTimer = CONFIG.stageTimeLimit;

      if (gameMode === "boss_world_enemy" || gameMode === "boss_beast_king") {
        const bossBuild = buildBossScene(gameMode);
        scene = bossBuild.scene;
        elevationsList = bossBuild.elevations;
        trapsList = [];
        mapRocketItems = bossBuild.bossRockets || [];
        pointLightsList = [];
        
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
        camera.rotation.order = "YXZ";

        renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
        renderer.setSize(window.innerWidth, window.innerHeight);
        $("game").appendChild(renderer.domElement);

        clock = new THREE.Clock();

        const spawnPos = { x: 0, z: 0 };
        player = { position: new THREE.Vector3(spawnPos.x, 1.4, spawnPos.z), baseEyeY: 1.4 };
        camera.position.copy(player.position);

        playerHp = 20; // ボス戦初期HP
        rocketAmmo = 3; // ボスステージはロケット3つ
        $("rocket-hud").classList.remove("hidden");
        $("shoot-button").classList.remove("hidden");

        const fakeOpen = [{x:5, z:5}];
        setupEnemiesOptimized(fakeOpen, spawnPos);

        $("compass-container").classList.add("hidden");
        $("floor-display").textContent = gameMode === "boss_world_enemy" ? "WORLD ENEMY" : "BEAST KING";

        // ボス時UI切り替え（HPバー表示）
        $("status-bar-label").textContent = "HP";
        $("stamina-fill").style.background = "#e74c3c";
        $("sprint-button").style.display = "none"; // 走るボタン非表示

      } else if (gameMode === "deadstage") {
        const deadBuild = buildDeadStage();
        scene = deadBuild.scene;
        elevationsList = [];
        trapsList = [];
        mapRocketItems = [];
        pointLightsList = [];

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
        camera.rotation.order = "YXZ";

        renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
        renderer.setSize(window.innerWidth, window.innerHeight);
        $("game").appendChild(renderer.domElement);

        clock = new THREE.Clock();

        player = { position: new THREE.Vector3(0, 1.4, 0), baseEyeY: 1.4 };
        camera.position.copy(player.position);

        // デッドステージイベント用追跡者4体生成
        enemies = [];
        for (let i = 0; i < 4; i++) {
          const group = new THREE.Group();
          // 端から配置 (例: x=-4, 4 など)
          const startX = i < 2 ? -5 : 5;
          const startZ = i % 2 === 0 ? -5 : 5;
          group.position.set(startX, 0, startZ);
          scene.add(group);
          const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
          planeMesh.position.y = 1.0;
          group.add(planeMesh);
          if (enemyTextureNormal) planeMesh.material = createEnemyMaterial(enemyTextureNormal);
          enemies.push({ group, planeMesh, state: "deadstage_approach" });
        }

        deadStageTimer = 3.0; // 3秒かけて中央へ
        deadStagePhase = 0;
        $("compass-container").classList.add("hidden");
        $("floor-display").textContent = "DEAD STAGE";
        $("sprint-button").style.display = "none";
        $("mobile-controls").style.display = "none"; // 操作ボタン等は全て非表示・透明化

      } else {
        // 通常ステージ
        maze = generateMaze(CONFIG.mazeCells);
        const built = buildScene(maze);
        scene = built.scene;
        pointLightsList = built.pointLightsList;
        elevationsList = built.elevations;
        trapsList = built.traps;

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
        camera.rotation.order = "YXZ";

        renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
        renderer.setSize(window.innerWidth, window.innerHeight);
        $("game").appendChild(renderer.domElement);

        clock = new THREE.Clock();

        const open = [];
        for(let z=1; z<maze.length-1; z++) for(let x=1; x<maze.length-1; x++) if(maze[z][x]===0) open.push({x,z});
        
        const spawnPos = cellWorld(startCell.x, startCell.z, maze.length);
        player = { position: new THREE.Vector3(spawnPos.x, 1.4, spawnPos.z), baseEyeY: 1.4 };
        camera.position.copy(player.position);

        placeGoalFixed(open);

        stamina = CONFIG.maxStamina;
        isDashing = false; dashTimer = 0; dashCooldownTimer = 0;
        isSlowed = false; slowTimer = 0;

        if (hasRocketFromPreviousFloor) {
          rocketAmmo = CONFIG.maxRocketAmmo;
          $("rocket-hud").classList.remove("hidden");
          $("shoot-button").classList.remove("hidden");
        } else {
          rocketAmmo = 0;
          $("rocket-hud").classList.add("hidden");
          $("shoot-button").classList.add("hidden");
        }

        mapRocketItems = setupMapRockets(scene, open, maze.length, spawnPos, elevationsList);
        setupEnemiesOptimized(open, spawnPos);

        if (gameSettings.compass) $("compass-container").classList.remove("hidden");
        else $("compass-container").classList.add("hidden");

        $("floor-display").textContent = `${currentFloor}F`;
        $("status-bar-label").textContent = "STAMINA";
        $("stamina-fill").style.background = "#82c78c";
        $("sprint-button").style.display = "block"; // 通常時は走るボタン表示
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

      invulnerableTimer = CONFIG.invulnerableDuration;

      showLoading(false);
      if (callback) callback();
    } catch (err) {
      console.error("Stage initialization error:", err);
      showLoading(false);
      showMessage("ステージ生成に失敗しました。再試行してください。");
    }
  }, 100);
}

function updateOcclusionAndLOD() {
  if (!camera || !scene || gameMode === "deadstage") return;
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
      if (dist <= CONFIG.rocketHitRadius && (gameMode.startsWith("boss") || rocketAmmo < CONFIG.maxRocketAmmo)) {
        item.active = false;
        scene.remove(item.mesh);
        if (item.light) scene.remove(item.light);
        if (gameMode.startsWith("boss")) {
          rocketAmmo++;
        } else {
          rocketAmmo = CONFIG.maxRocketAmmo;
          hasRocketFromPreviousFloor = true;
        }
        $("rocket-hud").classList.remove("hidden");
        $("shoot-button").classList.remove("hidden");
        showMessage(`ロケットを入手した！（弾数${rocketAmmo}発）`);
      }
    }
  }

  if (goalMesh && gameMode === "normal") {
    const distToGoal = cameraWorldPos.distanceTo(goalMesh.position);
    goalMesh.visible = (distToGoal <= CONFIG.drawDistance);
  }
}

function triggerDash() {
  if (!running || ended || isDashing || dashCooldownTimer > 0 || gameMode === "deadstage") return;

  if (gameMode === "normal") {
    if (stamina < CONFIG.dashStaminaCost) {
      showMessage("スタミナ不足！(消費: 10)");
      return;
    }
    stamina -= CONFIG.dashStaminaCost;
  }

  isDashing = true;
  dashTimer = CONFIG.dashDuration;
  dashCooldownTimer = CONFIG.dashCooldown; // 5秒CD

  playAudio("se-totugeki", 1.0);
  setTimeout(() => {
    const el = $("se-totugeki");
    if (el) { el.pause(); el.currentTime = 0; }
  }, 4000);

  showMessage("突進発動！(2秒間無敵突進＆接触爆破)");
}

function movePlayer(dt) {
  if (gameMode === "deadstage") return; // deadstage中はプレイヤー移動不可

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
    if (slowTimer <= 0) isSlowed = false;
  }

  let x = (keys.KeyD?1:0) - (keys.KeyA?1:0) + joystick.x;
  let z = (keys.KeyS?1:0) - (keys.KeyW?1:0) + joystick.z;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  const isMoving = len > 0.05;

  let currentSpeed = CONFIG.walkSpeed;

  if (isDashing) {
    currentSpeed = CONFIG.dashSpeed;
  } else if (gameMode.startsWith("boss")) {
    // ボスステージ：走るボタンなし、通常の移動速度を従来の走行速度(runSpeed=6.0)と同じにする
    currentSpeed = CONFIG.runSpeed;
  } else {
    const isRunning = (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && isMoving && stamina > 0;
    if (isRunning) {
      stamina = Math.max(0, stamina - CONFIG.staminaUsePerSecond * dt);
      currentSpeed = CONFIG.runSpeed;
    } else {
      stamina = Math.min(CONFIG.maxStamina, stamina + CONFIG.staminaRegenPerSecond * dt);
    }
  }

  if (isSlowed) currentSpeed /= 2.0;

  if (gameMode === "normal") {
    $("stamina-fill").style.width = `${stamina/CONFIG.maxStamina*100}%`;
    $("stamina-text").textContent = `${Math.ceil(stamina)} / ${CONFIG.maxStamina}`;
  } else {
    // ボスステージのHPバー表示
    $("stamina-fill").style.width = `${(playerHp / 20) * 100}%`;
    $("stamina-text").textContent = `${Math.ceil(playerHp)} / 20`;
  }

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(currentSpeed * dt);

  const nx = player.position.x + delta.x, nz = player.position.z + delta.z;
  const currentMaze = gameMode === "boss_world_enemy" || gameMode === "boss_beast_king" ? Array(10).fill(0).map(()=>Array(10).fill(0)) : maze;
  
  if (canStand(nx, player.position.z, CONFIG.playerRadius, currentMaze)) player.position.x = nx;
  if (canStand(player.position.x, nz, CONFIG.playerRadius, currentMaze)) player.position.z = nz;

  let currentStepHeight = 0;
  for (let el of elevationsList) {
    if (Math.abs(player.position.x - el.position.x) < CONFIG.cellSize * 0.5 &&
        Math.abs(player.position.z - el.position.z) < CONFIG.cellSize * 0.5) {
      currentStepHeight = Math.max(currentStepHeight, el.height);
    }
  }

  if (gameMode === "normal") {
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
}

function moveEnemies(dt) {
  if (gameMode === "deadstage") {
    // deadstageイベント進行
    if (deadStagePhase === 0) {
      deadStageTimer -= dt;
      // 3秒かけて中央へ接近
      for (let eObj of enemies) {
        eObj.group.position.lerp(new THREE.Vector3(0, 0, 0), 0.05);
      }
      if (deadStageTimer <= 0) {
        deadStagePhase = 1;
        // イベント開始：通常のcaught判定を有効にする
        for (let eObj of enemies) {
          eObj.state = "deadstage_active";
        }
      }
    } else if (deadStagePhase === 1) {
      // プレイヤーへ接近しcaughtさせる
      for (let eObj of enemies) {
        const dx = player.position.x - eObj.group.position.x;
        const dz = player.position.z - eObj.group.position.z;
        const len = Math.hypot(dx, dz);
        if (len > 0.2) {
          eObj.group.position.x += (dx / len) * 3.0 * dt;
          eObj.group.position.z += (dz / len) * 3.0 * dt;
        } else {
          // caught達成
          finishDeadStageCaught();
        }
      }
    }
    return;
  }

  // ボスステージの戦闘時間タイマー減少
  if (gameMode.startsWith("boss")) {
    stageTimer -= dt;
    if (stageTimer <= 0) {
      // タイムアップまたはクリア判定
    }
  }

  for (let eObj of enemies) {
    if (eObj.state === "defeated") continue;
    if (eObj.state === "booming") {
      eObj.repathTimer -= dt;
      if (eObj.repathTimer <= 0) {
        eObj.state = "defeated";
        eObj.group.visible = false;
        if (gameMode === "boss_beast_king" && eObj.hp <= 0) {
          finishBossWin("獣　王");
        }
      }
      continue;
    }

    if (eObj.isBeastKing) {
      // --- 新ボス「獣　王」の行動パターン ---
      // 1. 常にプレイヤーの位置を把握、速度5で追跡
      const targetWorldPos = player.position;
      
      // 2. 10秒ごとに2秒間移動速度が2倍になる「ボス突進」
      eObj.bossDashTimer += dt;
      if (eObj.bossDashTimer >= 10.0) {
        eObj.bossDashActive = true;
        eObj.bossDashTimer = 0;
        showMessage("獣王が突進してきた！！");
      }
      if (eObj.bossDashActive) {
        eObj.bossDashTimer += dt;
        if (eObj.bossDashTimer >= 2.0) {
          eObj.bossDashActive = false;
          eObj.bossDashTimer = 0;
        }
      }

      const speed = eObj.bossDashActive ? 10.0 : 5.0;
      const dx = targetWorldPos.x - eObj.group.position.x;
      const dz = targetWorldPos.z - eObj.group.position.z;
      const len = Math.hypot(dx, dz);

      if (len > 0.1) {
        eObj.group.position.x += (dx / len) * speed * dt;
        eObj.group.position.z += (dz / len) * speed * dt;
        eObj.group.rotation.y = Math.atan2(dx, dz);
      }

      // 突進中の接触：プレイヤー側から判定（後述のダメージ仕様）
      // 通常攻撃：ダメージ4、1.5秒のクールダウン
      eObj.attackCooldown = Math.max(0, eObj.attackCooldown - dt);
      if (len < CONFIG.enemyCatchDistance && eObj.attackCooldown <= 0) {
        eObj.attackCooldown = 1.5;
        playerHp -= 4;
        showMessage("獣王の攻撃を受けた！(-4 HP)");
        if (playerHp <= 0) {
          triggerDeathCaught();
          return;
        }
      }
      continue;
    }

    // 通常追跡者 / world enemyの処理
    let targetWorldPos = null;
    const canSee = lineOfSight(eObj.group.position, player.position, gameMode === "boss_world_enemy" ? Array(10).fill(0).map(()=>Array(10).fill(0)) : maze);
    const distToPlayer = Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z);

    if (canSee && distToPlayer <= CONFIG.enemyDetectDistance) {
      eObj.state = "chase";
    }

    if (eObj.state === "chase") {
      targetWorldPos = player.position;
    } else {
      if (!eObj.target || Math.hypot(eObj.group.position.x - eObj.target.x, eObj.group.position.z - eObj.target.z) < 1.5) {
        const sz = gameMode === "boss_world_enemy" ? 10 : CONFIG.mazeCells;
        const rx = 1 + Math.floor(Math.random() * (sz - 2));
        const rz = 1 + Math.floor(Math.random() * (sz - 2));
        eObj.target = cellWorld(rx, rz, sz);
      }
      targetWorldPos = eObj.target;
    }

    if (targetWorldPos) {
      eObj.repathTimer -= dt;
      const currentMaze = gameMode === "boss_world_enemy" ? Array(10).fill(0).map(()=>Array(10).fill(0)) : maze;
      if (eObj.repathTimer <= 0 || !eObj.path || eObj.path.length === 0) {
        eObj.repathTimer = CONFIG.enemyRepathInterval;
        eObj.path = findPathAStar(eObj.group.position, targetWorldPos, currentMaze, elevationsList);
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

        if (canStand(nextX, eObj.group.position.z, CONFIG.enemyRadius, currentMaze, elevationsList)) {
          eObj.group.position.x = nextX;
        }
        if (canStand(eObj.group.position.x, nextZ, CONFIG.enemyRadius, currentMaze, elevationsList)) {
          eObj.group.position.z = nextZ;
        }

        eObj.group.rotation.y = Math.atan2(dirX, dirZ);
      }
    }

    // 接触判定
    if (distToPlayer < CONFIG.enemyCatchDistance) {
      if (isDashing) {
        eObj.state = "booming";
        eObj.repathTimer = 1.0;
        if (enemyTextureBoom && eObj.planeMesh) {
          eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
        }
        playAudio("se-boom", 1.0);
        showMessage("突進撃破！！");
      } else if (gameMode.startsWith("boss")) {
        // world enemy等のボスステージ：攻撃に2秒間のクールダウン
        eObj.attackCooldown = (eObj.attackCooldown || 0) - dt;
        if (eObj.attackCooldown <= 0) {
          eObj.attackCooldown = 2.0; // 2秒クールダウン
          playerHp -= 5;
          showMessage("追跡者にダメージを受けた！(-5 HP)");
          if (playerHp <= 0) {
            triggerDeathCaught();
            return;
          }
        }
      } else if (invulnerableTimer <= 0) {
        finishGame(false);
      }
    }
  }
}

// deadstageイベントへ移行する関数
function triggerDeathCaught() {
  if (ended) return;
  gameMode = "deadstage";
  initStage(() => {
    running = true;
    ended = false;
  });
}

// deadstageで追跡者に捕まったときの処理
function finishDeadStageCaught() {
  if (ended) return;
  ended = true; running = false;
  playCaptureVideoDirectly(() => {
    $("end-title").textContent = "DEATH CAUGHT";
    $("end-text").textContent = "無慈悲な死が訪れた…";
    $("next-floor-button").classList.add("hidden");
    $("retry-floor-button").classList.remove("hidden"); // 「同じボスと戦う」用
    $("restart-button").classList.remove("hidden");     // 「1階からやり直す」
    $("restart-button").textContent = "1階からやり直す";
    $("retry-floor-button").textContent = "同じボスと戦う";
    $("end-overlay").classList.remove("hidden");
  });
}

function shootRocket() {
  if (!running || ended || rocketAmmo <= 0 || gameMode === "deadstage") return;
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

    const currentMaze = gameMode.startsWith("boss") ? Array(10).fill(0).map(()=>Array(10).fill(0)) : maze;
    if (isWallAt(p.mesh.position.x, p.mesh.position.z, currentMaze) || p.life <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    for (let eObj of enemies) {
      if (eObj.state !== "defeated" && eObj.state !== "booming" && eObj.group.visible) {
        if (Math.hypot(p.mesh.position.x - eObj.group.position.x, p.mesh.position.z - eObj.group.position.z) <= CONFIG.projectileHitRadius) {
          
          if (eObj.isBeastKing) {
            // 獣王に対するロケット命中：15ダメージ
            eObj.hp -= 15;
            playAudio("se-boom", 1.0);
            showMessage(`獣王にロケット命中！(-15 HP, 残りHP: ${eObj.hp})`);
            scene.remove(p.mesh);
            projectiles.splice(i, 1);

            if (eObj.hp <= 0) {
              eObj.state = "booming";
              eObj.repathTimer = 1.0;
              if (enemyTextureBoom && eObj.planeMesh) {
                eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
              }
            }
            break;
          } else {
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

  // ボス突進中の接触：5ダメージ（1回の突進につき1回のみ）
  for (let eObj of enemies) {
    if (eObj.isBeastKing && eObj.bossDashActive) {
      const dist = Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z);
      if (dist < 3.0 && !eObj.hasDamagedThisDash) {
        eObj.hasDamagedThisDash = true;
        playerHp -= 5;
        showMessage("獣王の突進を喰らった！(-5 HP)");
        if (playerHp <= 0) {
          triggerDeathCaught();
        }
      }
    } else if (eObj.isBeastKing && !eObj.bossDashActive) {
      eObj.hasDamagedThisDash = false;
    }
  }
}

function updateCompasses() {
  if (ended || !gameSettings.compass || gameMode.startsWith("boss") || gameMode === "deadstage") return;

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
}

function finishBossWin(bossName) {
  if (ended) return;
  ended = true; running = false;
  $("bgm-yarimasune").volume = 0;
  playAudio("se-clear", 1.0);

  $("end-title").textContent = "BOSS DEFEATED!";
  $("end-text").textContent = `君は${bossName}を倒した！！`;
  $("next-floor-button").classList.add("hidden");
  $("retry-floor-button").classList.remove("hidden");
  $("restart-button").classList.remove("hidden");
  $("retry-floor-button").textContent = "ボス選択へ戻る";
  $("restart-button").textContent = "1階からやり直す";
  $("end-overlay").classList.remove("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
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
      $("end-text").textContent = "おめでとう！全5階層の迷路を完全脱出した！ボスステージが解放されたぞ！";
      $("next-floor-button").classList.add("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "最初からプレイ";
      
      // ボスステージ解放フラグ保存・表示
      localStorage.setItem("yaju_boss_unlocked", "true");
      $("boss-stages-section").classList.remove("hidden");
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
      $("retry-floor-button").textContent = "同じ階をやり直す";
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

    movePlayer(dt);
    moveEnemies(dt);
    updateProjectiles(dt);
    updateOcclusionAndLOD();

    for (let eObj of enemies) {
      if (eObj.group?.children[0] && eObj.state !== "defeated") {
        eObj.group.children[0].lookAt(camera.position.x, eObj.group.children[0].getWorldPosition(new THREE.Vector3()).y, camera.position.z);
      }
    }

    updateCompasses();

    if (gameMode === "normal" && goalMesh && Math.hypot(player.position.x - goalMesh.position.x, player.position.z - goalMesh.position.z) < 1.35) {
      finishGame(true);
    }

    // ボスステージで戦闘時間60秒経過時の処理 (world enemyクリア判定など)
    if (gameMode === "boss_world_enemy" && stageTimer <= 0) {
      finishBossWin("World Enemy");
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

let sprintHeld = false;

function handleResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ★ 非常時・ロード画面スタックを防ぐ極めて堅牢なスタート関数
function startGameFromSettings(mode = "normal") {
  try {
    gameMode = mode;
    gameSettings.compass = $("setting-compass").checked;
    gameSettings.progressiveEnemies = $("setting-progressive-enemies").checked;

    stopCaptureVideoImmediately();
    unlockAndPreloadMedia();

    if (mode === "normal") {
      currentFloor = 1;
      hasRocketFromPreviousFloor = false;
    }

    initStage(() => {
      $("overlay").classList.add("hidden");
      $("end-overlay").classList.add("hidden");
      document.body.classList.add("game-active");

      running = true; ended = false;
      playAudio("se-start", 1.0);
      if (matchMedia("(pointer:fine)").matches) renderer.domElement.requestPointerLock?.();
    });
  } catch (err) {
    console.error("Critical error in startGameFromSettings:", err);
    showLoading(false);
    showMessage("ゲームの起動に失敗しました。ページを再読み込みしてください。");
  }
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
  
  if (gameMode === "deadstage") {
    // 同じボスと戦う
    gameMode = "boss_beast_king"; // あるいは直前のボスモードに合わせる
  }

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

function restartFromFloor1() {
  currentFloor = 1;
  hasRocketFromPreviousFloor = false;
  gameMode = "normal";
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

$("start-button").addEventListener("click", () => startGameFromSettings("normal"));
$("boss-world-enemy-btn").addEventListener("click", () => startGameFromSettings("boss_world_enemy"));
$("boss-beast-king-btn").addEventListener("click", () => startGameFromSettings("boss_beast_king"));

$("next-floor-button").addEventListener("click", nextFloor);
$("retry-floor-button").addEventListener("click", () => {
  if (gameMode === "deadstage") {
    startGameFromSettings("boss_beast_king");
  } else {
    retryCurrentFloor();
  }
});
$("restart-button").addEventListener("click", () => {
  if ($("end-title").textContent === "BOSS DEFEATED" || $("end-title").textContent === "BOSS STAGE") {
    // ボス選択へ戻る
    $("end-overlay").classList.add("hidden");
    $("overlay").classList.remove("hidden");
  } else {
    restartFromFloor1();
  }
});

// 解放済みならボスステージ選択欄を表示
if (localStorage.getItem("yaju_boss_unlocked") === "true") {
  $("boss-stages-section").classList.remove("hidden");
}

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
