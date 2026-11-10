import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight, findPathAStar } from "./collision.js";
import { generateMaze, buildScene, setupMapRockets } from "./worldBuilder.js";

let scene, camera, renderer, clock;
let maze, player, goalMesh;
let enemies = [];
let running = false, ended = false;
let currentFloor = 1;

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
  for (let eObj of enemies) { if (eObj.group) scene.remove(eObj.group); }
  enemies = [];

  const baseCount = gameSettings.progressiveEnemies ? currentFloor : 1;
  const totalEnemies = baseCount;

  for (let i = 0; i < totalEnemies; i++) {
    const candidates = openCells.filter(c => Math.hypot(cellWorld(c.x, c.z, maze.length).x - spawnPos.x, cellWorld(c.x, c.z, maze.length).z - spawnPos.z) >= 8);
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

function initStage(callback) {
  showLoading(true, `${currentFloor}F GENERATING...`);

  setTimeout(() => {
    if (renderer) {
      const dom = renderer.domElement;
      if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
    }

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

    // ★ ロケットの引き継ぎ判定：前階層ゴール時にロケットを持っていれば最大数(2発)所持
    if (hasRocketFromPreviousFloor) {
      rocketAmmo = CONFIG.maxRocketAmmo;
      $("rocket-hud").classList.remove("hidden");
      $("shoot-button").classList.remove("hidden");
    } else {
      rocketAmmo = 0;
      $("rocket-hud").classList.add("hidden");
      $("shoot-button").classList.add("hidden");
    }

    mapRocketItems = setupMapRockets(scene, open, maze.length, spawnPos);
    setupEnemiesOptimized(open, spawnPos);

    if (gameSettings.compass) $("compass-container").classList.remove("hidden");
    else $("compass-container").classList.add("hidden");

    $("floor-display").textContent = `${currentFloor}F`;

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

    const dx = goalMesh.position.x - spawnPos.x;
    const dz = goalMesh.position.z - spawnPos.z;
    yaw = Math.atan2(-dx, -dz);
    camera.rotation.set(0, yaw, 0);

    invulnerableTimer = CONFIG.invulnerableDuration;

    showLoading(false);
    if (callback) callback();
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
  if (!running || ended || isDashing || dashCooldownTimer > 0) return;
  if (stamina < CONFIG.dashStaminaCost) {
    showMessage("スタミナ不足！(消費: 10)");
    return;
  }

  stamina -= CONFIG.dashStaminaCost;
  isDashing = true;
  dashTimer = CONFIG.dashDuration; // 2秒間突進
  dashCooldownTimer = CONFIG.dashCooldown; // 5秒クールダウン

  // totugeki.mp3を4秒間流す
  playAudio("se-totugeki", 1.0);
  setTimeout(() => {
    const el = $("se-totugeki");
    if (el) { el.pause(); el.currentTime = 0; }
  }, 2000);

  showMessage("突進発動！野獣を轢き殺せ！！");
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

  let currentSpeed = CONFIG.walkSpeed;

  if (isDashing) {
    currentSpeed = CONFIG.dashSpeed; // 突進 20.0
  } else {
    const isRunning = (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && isMoving && stamina > 0;
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

// ★ 追跡者制御（探知範囲11、A*最短追尾、突進時の捕獲判定→一番近い追跡者爆破撃破変化）
function moveEnemies(dt) {
  for (let eObj of enemies) {
    if (eObj.state === "defeated") continue;
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

    // 探知範囲（CONFIG.enemyDetectDistance = 11）判定
    if (canSee && distToPlayer <= CONFIG.enemyDetectDistance) {
      eObj.state = "chase";
    }

    if (eObj.state === "chase") {
      targetWorldPos = player.position;
    } else {
      if (!eObj.target || Math.hypot(eObj.group.position.x - eObj.target.x, eObj.group.position.z - eObj.target.z) < 1.5) {
        const rx = 1 + Math.floor(Math.random() * (CONFIG.mazeCells - 2));
        const rz = 1 + Math.floor(Math.random() * (CONFIG.mazeCells - 2));
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

        eObj.group.rotation.y = Math.atan2(dirX, dirZ);
      }
    }

    // ★ caught 判定（突進状態なら爆破反撃、通常時ならゲームオーバー）
    if (distToPlayer < CONFIG.enemyCatchDistance) {
      if (isDashing) {
        // 突進状態：一番近くの追跡者を爆破判定にし撃破する
        eObj.state = "booming";
        eObj.repathTimer = 1.0;
        if (enemyTextureBoom && eObj.planeMesh) {
          eObj.planeMesh.material = createEnemyMaterial(enemyTextureBoom);
        }
        playAudio("se-boom", 1.0);
        showMessage("突進撃破！！追跡者を吹き飛ばした！");
      } else if (invulnerableTimer <= 0) {
        finishGame(false);
      }
    }
  }
}

function shootRocket() {
  if (!running || ended || rocketAmmo <= 0) return;
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
      $("restart-button").textContent = "最初からプレイ";
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

    if (Math.hypot(player.position.x - goalMesh.position.x, player.position.z - goalMesh.position.z) < 1.35) {
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

  // ★ スタート時に動画が誤って再生されないよう確実にストップ制御
  stopCaptureVideoImmediately();
  unlockAndPreloadMedia();

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

function restartFromFloor1() {
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
