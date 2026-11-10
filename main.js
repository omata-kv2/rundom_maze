import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight } from "./collision.js";
import { generateMaze, buildScene } from "./worldBuilder.js";

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

// 設定トグル状態
let gameSettings = {
  fog: true,
  compass: true,
  progressiveEnemies: true
};

let invulnerableTimer = 0; // スタート時3秒無敵用

let enemyTextureNormal = null;
let enemyTextureBoom = null;

let messageTimer = 0;
let spawnCell = {x:1, z:1};

let provokePos = null;
let provokeMesh = null;
const PROVOKE_HIT_RADIUS = 2.5;

let mapRocketItems = [];
let rocketAmmo = 0;
let projectiles = [];
let pointLightsList = [];

const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();
const cameraWorldPos = new THREE.Vector3();
const tempVec3 = new THREE.Vector3();
const tempBox = new THREE.Box3();

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

// ------------------------------------
// ゴール設置
// ------------------------------------
function placeGoal(openCells, spawnPos) {
  const pool = openCells.filter(c => {
    const p = cellWorld(c.x, c.z, maze.length);
    const dist = Math.hypot(p.x - spawnPos.x, p.z - spawnPos.z);
    return dist >= CONFIG.goalMinStraightDistance;
  });

  const goalCell = pool[Math.floor(Math.random() * pool.length)] || openCells[openCells.length - 1];
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

  const glow = new THREE.PointLight(0x8aff9d, 1.1, 8); glow.position.set(0, 2.1, 0.5); goalMesh.add(glow);
  scene.add(goalMesh);
}

// ------------------------------------
// 敵とコンパス針の初期化（累進野獣数対応）
// ------------------------------------
function setupEnemies(openCells, spawnPos) {
  for (let eObj of enemies) { if (eObj.group) scene.remove(eObj.group); }
  enemies = [];

  // 累進野獣数ONなら階層ごとに敵数増加（1F:1~2体, 2F:2~3体...）
  const baseCount = gameSettings.progressiveEnemies ? currentFloor : 1;
  const extraCount = Math.floor(Math.random() * 2);
  const totalEnemies = baseCount + extraCount;

  const pool = openCells.filter(c => {
    const p = cellWorld(c.x, c.z, maze.length);
    return Math.hypot(p.x - spawnPos.x, p.z - spawnPos.z) >= CONFIG.enemySpawnMinDistance;
  });

  for (let i = 0; i < totalEnemies; i++) {
    const enemyCell = pool[Math.floor(Math.random() * pool.length)] || openCells[openCells.length - 1];
    const ep = cellWorld(enemyCell.x, enemyCell.z, maze.length);
    const group = new THREE.Group();
    group.position.set(ep.x, 0, ep.z);
    scene.add(group);

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
    planeMesh.position.y = 1.0;
    group.add(planeMesh);

    if (enemyTextureNormal) {
      planeMesh.material = new THREE.MeshBasicMaterial({map: enemyTextureNormal, transparent: true, side: THREE.DoubleSide});
    }

    enemies.push({
      id: i, group, planeMesh, state: "patrol", target: null, nextPatrolCell: null,
      repathTimer: 0, respawnTimer: 0, isSpawnPatroller: (i === 0),
      color: NEEDLE_COLORS[i % NEEDLE_COLORS.length]
    });
  }

  const radarCircle = $("radar");
  radarCircle.innerHTML = "";
  for (let i = 0; i < totalEnemies; i++) {
    const needle = document.createElement("div");
    needle.id = `radar-needle-${i}`;
    needle.className = "needle";
    needle.style.backgroundColor = NEEDLE_COLORS[i % NEEDLE_COLORS.length];
    radarCircle.appendChild(needle);
  }
}

// ------------------------------------
// マップ構築
// ------------------------------------
function initStage() {
  if (renderer) {
    const dom = renderer.domElement;
    if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
  }

  maze = generateMaze(CONFIG.mazeCells);
  const built = buildScene(maze, gameSettings.fog);
  scene = built.scene;
  pointLightsList = built.pointLightsList;

  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, .1, CONFIG.drawDistance);
  camera.rotation.order = "YXZ";

  renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * CONFIG.renderScale);
  renderer.setSize(innerWidth, innerHeight);
  $("game").appendChild(renderer.domElement);

  clock = new THREE.Clock();

  const open = [];
  for(let z=1; z<maze.length-1; z++) for(let x=1; x<maze.length-1; x++) if(maze[z][x]===0) open.push({x,z});
  const spawnPos = cellWorld(spawnCell.x, spawnCell.z, maze.length);
  player = { position: new THREE.Vector3(spawnPos.x, 1.4, spawnPos.z) };
  camera.position.copy(player.position);

  placeGoal(open, spawnPos);
  setupEnemies(open, spawnPos);

  // 10%の確率でスタート時にロケット1発所持
  const startWithRocket = Math.random() < 0.10;
  if (startWithRocket) {
    rocketAmmo = 1;
    $("rocket-hud").classList.remove("hidden");
    $("shoot-button").classList.remove("hidden");
    showMessage(`【幸運】スタート時にロケットを1発獲得した！ [10%確率]`);
  } else {
    rocketAmmo = 0;
    $("rocket-hud").classList.add("hidden");
    $("shoot-button").classList.add("hidden");
  }

  // コンパス表示トグル制御
  if (gameSettings.compass) {
    $("compass-container").classList.remove("hidden");
  } else {
    $("compass-container").classList.add("hidden");
  }

  $("floor-display").textContent = `${currentFloor}F`;

  // テクスチャ設定
  if (!enemyTextureNormal) {
    loader.load(CHASER_IMAGES[0], tex => { enemyTextureNormal = tex; });
  }
  if (!enemyTextureBoom) {
    loader.load(BOOM_IMAGE, tex => { enemyTextureBoom = tex; });
  }

  const dx = goalMesh.position.x - spawnPos.x;
  const dz = goalMesh.position.z - spawnPos.z;
  yaw = Math.atan2(-dx, -dz);
  camera.rotation.set(0, yaw, 0);

  invulnerableTimer = CONFIG.invulnerableDuration; // 3秒無敵
}

// ------------------------------------
// 更新ループ
// ------------------------------------
function updateOcclusionAndLOD() {
  if (!camera || !scene) return;
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  camera.getWorldPosition(cameraWorldPos);

  for (let item of pointLightsList) {
    const dist = cameraWorldPos.distanceTo(item.position);
    if (dist > CONFIG.lightDrawDistance) {
      item.light.intensity = 0;
      item.lampMesh.visible = false;
    } else {
      const factor = 1.0 - (dist / CONFIG.lightDrawDistance);
      item.light.intensity = item.baseIntensity * factor;
      item.lampMesh.visible = true;
    }
  }

  if (goalMesh) {
    const distToGoal = cameraWorldPos.distanceTo(goalMesh.position);
    goalMesh.visible = (distToGoal <= CONFIG.drawDistance);
  }
}

function movePlayer(dt) {
  let x = (keys.KeyD?1:0) - (keys.KeyA?1:0) + joystick.x;
  let z = (keys.KeyS?1:0) - (keys.KeyW?1:0) + joystick.z;
  const len = Math.hypot(x,z); if (len > 1) { x /= len; z /= len; }
  const isMoving = len > .08;
  const isRunning = (keys.ShiftLeft || keys.ShiftRight || sprintHeld) && isMoving && stamina > 0;

  if (isRunning) stamina = Math.max(0, stamina - CONFIG.staminaUsePerSecond * dt);
  else stamina = Math.min(CONFIG.maxStamina, stamina + CONFIG.staminaRegenPerSecond * dt);

  $("stamina-fill").style.width = `${stamina/CONFIG.maxStamina*100}%`;
  $("stamina-text").textContent = `${Math.ceil(stamina)} / ${CONFIG.maxStamina}`;

  const speed = isRunning ? CONFIG.runSpeed : CONFIG.walkSpeed;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(speed * dt);

  const nx = player.position.x + delta.x, nz = player.position.z + delta.z;
  if (canStand(nx, player.position.z, maze)) player.position.x = nx;
  if (canStand(player.position.x, nz, maze)) player.position.z = nz;

  camera.position.copy(player.position);
  camera.rotation.set(pitch, yaw, 0);
}

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

    let target;
    const canSee = lineOfSight(eObj.group.position, player.position, maze);
    if (canSee && eObj.state !== "chase") { eObj.state = "chase"; }

    if (eObj.state === "chase") {
      const path = [worldCell(player.position, maze.length)];
      if (path.length) target = cellWorld(path[0].x, path[0].z, maze.length);
    }

    if (target) {
      const dx = target.x - eObj.group.position.x, dz = target.z - eObj.group.position.z;
      const len = Math.hypot(dx, dz);
      if (len > .08) {
        eObj.group.position.x += (dx/len) * CONFIG.enemyChaseSpeed * dt;
        eObj.group.position.z += (dz/len) * CONFIG.enemyChaseSpeed * dt;
      }
    }

    // 捕獲判定（無敵時間中はスキップ）
    if (invulnerableTimer <= 0 && Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z) < CONFIG.enemyCatchDistance) {
      finishGame(false);
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
            eObj.planeMesh.material = new THREE.MeshBasicMaterial({map: enemyTextureBoom, transparent: true, side: THREE.DoubleSide});
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

  for (let i = 0; i < enemies.length; i++) {
    const eObj = enemies[i];
    const needle = $(`radar-needle-${i}`);
    if (!needle) continue;
    if (eObj.state === "defeated") { needle.style.display = "none"; continue; }
    needle.style.display = "block";
    const yajuDx = eObj.group.position.x - player.position.x;
    const yajuDz = eObj.group.position.z - player.position.z;
    const yajuAngle = Math.atan2(-yajuDx, -yajuDz) - yaw;
    needle.style.transform = `translateX(-50%) rotate(${-yajuAngle}rad)`;
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
      $("restart-button").classList.add("hidden");
    } else {
      $("end-title").textContent = "ALL CLEAR!!";
      $("end-text").textContent = "おめでとう！全5階層の迷路を完全脱出した！";
      $("next-floor-button").classList.add("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "最初からプレイ";
    }
    playAudio("se-clear", 1.0);
    $("end-overlay").classList.remove("hidden");
  } else {
    $("end-title").textContent = "GAME OVER";
    $("end-text").textContent = `第 ${currentFloor} 階層で捕まってしまった…`;
    $("next-floor-button").classList.add("hidden");
    $("restart-button").classList.remove("hidden");
    $("restart-button").textContent = "1階からやり直す";
    
    const video = $("capture-video");
    video.style.display = "block"; video.currentTime = 0;
    video.play().catch(()=>{});

    $("end-overlay").classList.remove("hidden");
    setTimeout(() => { video.style.display = "none"; }, 4000);
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .05);

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

// ------------------------------------
// 設定決定とゲーム開始
// ------------------------------------
function startGameFromSettings() {
  gameSettings.fog = $("setting-fog").checked;
  gameSettings.compass = $("setting-compass").checked;
  gameSettings.progressiveEnemies = $("setting-progressive-enemies").checked;

  currentFloor = 1;
  initStage();

  $("overlay").classList.add("hidden");
  $("end-overlay").classList.add("hidden");
  document.body.classList.add("game-active");

  running = true;
  ended = false;
  playAudio("se-start", 1.0);
  if (matchMedia("(pointer:fine)").matches) renderer.domElement.requestPointerLock?.();
}

function nextFloor() {
  currentFloor++;
  initStage();
  $("end-overlay").classList.add("hidden");
  running = true; ended = false;
  playAudio("se-start", 1.0);
}

function restartFromFloor1() {
  currentFloor = 1;
  initStage();
  $("end-overlay").classList.add("hidden");
  running = true; ended = false;
  playAudio("se-restart", 1.0);
}

$("start-button").addEventListener("click", startGameFromSettings);
$("next-floor-button").addEventListener("click", nextFloor);
$("restart-button").addEventListener("click", restartFromFloor1);

addEventListener("keydown", e => {
  keys[e.code] = true;
  if (e.code === "Space") shootRocket();
});
addEventListener("keyup", e => keys[e.code] = false);

addEventListener("mousemove", e => {
  if (document.pointerLockElement && running) {
    yaw -= e.movementX * .0022;
    pitch = clamp(pitch - e.movementY * .0022, -1.35, 1.35);
  }
});

animate();
