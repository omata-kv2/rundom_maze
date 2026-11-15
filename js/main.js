import * as THREE from "./libs/three.module.js";
import { CONFIG, CHASER_IMAGES, BOOM_IMAGE, IZAN_IMAGE, ROCKET_IMAGE, NEEDLE_COLORS } from "./config.js";
import { cellWorld, worldCell, isWallAt, canStand, lineOfSight, findPathAStar, getElevationHeightAt } from "./collision.js";
import { generateMaze, buildScene, setupMapRockets } from "./worldBuilder.js";
import { buildBossScene } from "./bossbuildworld.js";
import { buildDeadStage } from "./deadstagebuilt.js";

let scene, camera, renderer, clock;
let maze, player, goalMesh;
let enemies = [];
let running = false, ended = false;
let isTransitioningToDeadStage = false;
let currentFloor = 1;
let gameMode = "normal";
let lastBossMode = "boss_beast_king";

let stamina = CONFIG.maxStamina;
let playerHp = 20;
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0, z:0};
let sprintHeld = false;

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
let izanTexture = null;

let messageTimer = 0;
const startCell = {x:1, z:1};
let goalCell = {x:13, z:13};

let mapRocketItems = [];
let rocketAmmo = 0;
let projectiles = [];
let pointLightsList = [];

let deadStageTimer = 0;

// Clear Stage 3秒間ホワイトアウト演出用
let clearStageActive = false;
let clearStageTimer = 0;
let clearStageDeleted = false;
let clearBossTitle = "";

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

function startYarimasuneLoop() {
  const el = $("bgm-yarimasune");
  if (el) {
    el.loop = true;
    el.volume = 1.0;
    el.currentTime = 0;
    el.play().catch(e => console.warn("Yarimasune play failed:", e));
  }
}

function stopYarimasuneLoop() {
  const el = $("bgm-yarimasune");
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
}

function showMessage(text){
  const msgEl = $("message");
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.style.opacity = "1";
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    if ($("message")) $("message").style.opacity = "0";
  }, 3500);
}

function disableGestures() {
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('gesturechange', e => e.preventDefault());
  document.addEventListener('gestureend', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

function showLoading(show, text = "STAGE GENERATING...") {
  const el = $("loading-screen");
  if (!el) return;
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
  stopYarimasuneLoop();
}

function playCaptureVideoDirectly(onEndedCallback) {
  stopYarimasuneLoop();
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

// プレイヤーへのダメージ統一関数（HPが0以下になったら確実にdeadstageへ移行）
function damagePlayer(amount, msg) {
  if (ended || clearStageActive || isTransitioningToDeadStage || gameMode === "deadstage") return;
  playerHp = Math.max(0, playerHp - amount);

  const hpFill = $("hp-fill");
  const hpText = $("hp-text");
  if (hpFill) hpFill.style.width = `${(playerHp / 20) * 100}%`;
  if (hpText) hpText.textContent = `${Math.ceil(playerHp)} / 20`;

  if (msg) showMessage(msg);

  if (playerHp <= 0) {
    triggerDeadStage();
  }
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

function updateBossHpUI(bossObj) {
  const panel = $("boss-hp-panel");
  const fill = $("boss-hp-fill");
  const text = $("boss-hp-text");
  const label = $("boss-hp-label");
  if (!panel || !fill || !text || !bossObj) return;
  const hpVal = Math.max(0, Math.ceil(bossObj.hp));
  const maxHp = bossObj.maxHp || 100;
  if (label) {
    label.textContent = bossObj.isWorldEnemy ? "WORLD ENEMY HP" : "BEAST KING HP";
  }
  fill.style.width = `${(hpVal / maxHp) * 100}%`;
  text.textContent = `${hpVal} / ${maxHp}`;
}

function spawnNormalChaserAt(x, z, id, isBossMinion = false) {
  const stepH = getElevationHeightAt(x, z, [...elevationsList, ...trapsList]);
  const group = new THREE.Group();
  group.position.set(x, stepH, z);
  scene.add(group);

  const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
  planeMesh.position.y = 1.0;
  group.add(planeMesh);

  if (enemyTextureNormal) {
    planeMesh.material = createEnemyMaterial(enemyTextureNormal);
  }

  const enemyObj = {
    id,
    group,
    planeMesh,
    state: isBossMinion ? "chase" : "patrol",
    target: null,
    isBossMinion,
    attackCooldown: 0,
    path: [],
    pathIndex: 0,
    repathTimer: 0,
    frozenTimer: 0,
    color: NEEDLE_COLORS[id % NEEDLE_COLORS.length]
  };
  enemies.push(enemyObj);
  return enemyObj;
}

function setupEnemiesOptimized(openCells, spawnPos) {
  for (let eObj of enemies) { if (eObj.group) scene.remove(eObj.group); }
  enemies = [];

  if (gameMode === "boss_beast_king") {
    const ep = { x: 0, z: -10 };
    const stepH = getElevationHeightAt(ep.x, ep.z, [...elevationsList, ...trapsList]);
    const group = new THREE.Group();
    group.position.set(ep.x, stepH, ep.z);
    scene.add(group);

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 4.0));
    planeMesh.position.y = 2.0;
    group.add(planeMesh);

    if (enemyTextureNormal) {
      planeMesh.material = createEnemyMaterial(enemyTextureNormal);
    }

    const beastKing = {
      id: 0, group, planeMesh, state: "chase", target: null,
      hp: 100, maxHp: 100, isBeastKing: true,
      attackCooldown: 0, bossDashTimer: 0, bossDashActive: false,
      path: [], pathIndex: 0, repathTimer: 0, frozenTimer: 0,
      color: "#ff0000"
    };
    enemies.push(beastKing);
    updateBossHpUI(beastKing);
    return;
  }

  if (gameMode === "boss_world_enemy") {
    const cubeSize = CONFIG.wallHeight;
    const group = new THREE.Group();
    group.position.set(0, 0, 0);
    scene.add(group);

    const cubeMat = new THREE.MeshBasicMaterial({
      map: izanTexture || null,
      color: izanTexture ? 0xffffff : 0x552288
    });
    const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
    const cubeMesh = new THREE.Mesh(cubeGeo, cubeMat);
    cubeMesh.position.y = cubeSize / 2;
    group.add(cubeMesh);

    if (!izanTexture) {
      loader.load(IZAN_IMAGE, tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        izanTexture = tex;
        cubeMat.map = tex;
        cubeMat.color.setHex(0xffffff);
        cubeMat.needsUpdate = true;
      });
    }

    const worldEnemy = {
      id: 0,
      group,
      cubeMesh,
      planeMesh: null,
      state: "boss_turret",
      hp: 100,
      maxHp: 100,
      isWorldEnemy: true,
      cubeSize,
      halfExtent: cubeSize / 2,
      shootTimer: 3.0,
      spawnMinionTimer: 10.0,
      spinTimer: 2.0,
      attackCooldown: 0,
      color: "#00aaff"
    };
    enemies.push(worldEnemy);
    updateBossHpUI(worldEnemy);

    spawnNormalChaserAt(0, 0, 1, true);
    spawnNormalChaserAt(0, 0, 2, true);
    showMessage("World Enemyが家臣を2体産出した！");
    return;
  }

  const baseCount = gameSettings.progressiveEnemies ? currentFloor : 1;
  const totalEnemies = baseCount;

  for (let i = 0; i < totalEnemies; i++) {
    const candidates = openCells.filter(c => {
      const p = cellWorld(c.x, c.z, maze.length);
      return Math.hypot(p.x - spawnPos.x, p.z - spawnPos.z) >= 4;
    });
    const spawnCellPos = candidates[Math.floor(Math.random() * candidates.length)] || openCells[0];
    const ep = cellWorld(spawnCellPos.x, spawnCellPos.z, maze.length);

    spawnNormalChaserAt(ep.x, ep.z, i, false);
  }

  updateRadarUI(totalEnemies);
}

function updateRadarUI(totalEnemies) {
  const radarCircle = $("radar");
  if (!radarCircle) return;
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

function clearAllStageObjectsForClear() {
  if (!scene) return;
  const toRemove = [];
  scene.traverse(obj => {
    if (obj !== scene && obj !== camera) {
      toRemove.push(obj);
    }
  });
  for (let obj of toRemove) {
    if (obj.parent) obj.parent.remove(obj);
  }
  enemies = [];
  projectiles = [];
  mapRocketItems = [];
  elevationsList = [];
  trapsList = [];
  pointLightsList = [];
  goalMesh = null;
}

function triggerClearStage(bossName) {
  if (clearStageActive || ended || isTransitioningToDeadStage) return;
  clearStageActive = true;
  clearStageTimer = 0;
  clearStageDeleted = false;
  clearBossTitle = bossName;

  for (let p of projectiles) {
    if (p.mesh) scene.remove(p.mesh);
  }
  projectiles = [];

  if (scene) {
    scene.background = new THREE.Color(0xffffff);
    scene.fog = new THREE.FogExp2(0xffffff, 0.01);
  }
}

function initStage(callback) {
  const loadingMsg = gameMode === "deadstage"
    ? "DEAD STAGE..."
    : (gameMode.startsWith("boss") ? "BOSS STAGE GENERATING..." : `${currentFloor}F GENERATING...`);
  showLoading(true, loadingMsg);

  setTimeout(() => {
    try {
      if (renderer) {
        const dom = renderer.domElement;
        if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
      }

      clearStageActive = false;
      clearStageTimer = 0;
      clearStageDeleted = false;
      projectiles = [];

      if (gameMode === "boss_world_enemy" || gameMode === "boss_beast_king") {
        lastBossMode = gameMode;
        const bossBuild = buildBossScene(gameMode);
        scene = bossBuild.scene;
        maze = bossBuild.maze;
        elevationsList = bossBuild.elevations;
        trapsList = bossBuild.traps || [];
        mapRocketItems = bossBuild.bossRockets || [];
        pointLightsList = bossBuild.pointLightsList || [];
        
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, .1, CONFIG.drawDistance);
        camera.rotation.order = "YXZ";

        renderer = new THREE.WebGLRenderer({antialias: false, powerPreference: "high-performance"});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5) * CONFIG.renderScale);
        renderer.setSize(window.innerWidth, window.innerHeight);
        $("game").appendChild(renderer.domElement);

        clock = new THREE.Clock();

        const cornerPos = cellWorld(1, 1, 10);
        const startStepH = getElevationHeightAt(cornerPos.x, cornerPos.z, [...elevationsList, ...trapsList]);
        player = { position: new THREE.Vector3(cornerPos.x, 1.4 + startStepH, cornerPos.z), baseEyeY: 1.4 };
        camera.position.copy(player.position);
        yaw = Math.atan2(-cornerPos.x, -cornerPos.z) + Math.PI;
        pitch = 0;

        playerHp = 20;
        rocketAmmo = 3;
        $("rocket-hud").classList.remove("hidden");
        $("shoot-button").classList.remove("hidden");

        setupEnemiesOptimized([], cornerPos);

        $("compass-container").classList.remove("hidden");
        $("compass-container").classList.add("transparent-boss");
        $("boss-hp-panel").classList.remove("hidden");

        $("floor-display").textContent = gameMode === "boss_world_enemy" ? "WORLD ENEMY" : "BEAST KING";

        $("stamina-panel").classList.add("hidden");
        $("hp-panel").classList.remove("hidden");
        $("sprint-button").style.display = "none";
        $("mobile-controls").style.display = "block";

      } else if (gameMode === "deadstage") {
        startYarimasuneLoop();

        const deadBuild = buildDeadStage();
        scene = deadBuild.scene;
        maze = null;
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

        enemies = [];
        const deadAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const startRadius = 8.0;

        for (let i = 0; i < 4; i++) {
          const group = new THREE.Group();
          const angle = deadAngles[i];
          const startX = Math.cos(angle) * startRadius;
          const startZ = Math.sin(angle) * startRadius;
          group.position.set(startX, 0, startZ);
          scene.add(group);

          const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0));
          planeMesh.position.y = 1.0;
          group.add(planeMesh);
          if (enemyTextureNormal) planeMesh.material = createEnemyMaterial(enemyTextureNormal);

          enemies.push({ group, planeMesh, state: "deadstage_approach", angle, startDist: startRadius });
        }

        deadStageTimer = 6.0;
        $("rocket-hud").classList.add("hidden");
        $("shoot-button").classList.add("hidden");
        $("compass-container").classList.add("hidden");
        $("boss-hp-panel").classList.add("hidden");
        $("floor-display").textContent = "DEAD STAGE";
        $("stamina-panel").classList.add("hidden");
        $("hp-panel").classList.add("hidden");
        $("sprint-button").style.display = "none";
        $("mobile-controls").style.display = "none";

      } else {
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

        $("boss-hp-panel").classList.add("hidden");
        $("compass-container").classList.remove("transparent-boss");
        if (gameSettings.compass) $("compass-container").classList.remove("hidden");
        else $("compass-container").classList.add("hidden");

        $("floor-display").textContent = `${currentFloor}F`;
        
        $("hp-panel").classList.add("hidden");
        $("stamina-panel").classList.remove("hidden");
        $("sprint-button").style.display = "block";
        $("mobile-controls").style.display = "block";
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
  }, 80);
}

function updateOcclusionAndLOD() {
  if (!camera || !scene || gameMode === "deadstage" || clearStageActive || isTransitioningToDeadStage) return;
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
  if (!running || ended || isDashing || dashCooldownTimer > 0 || gameMode === "deadstage" || clearStageActive || isTransitioningToDeadStage) return;

  if (gameMode === "normal") {
    if (stamina < CONFIG.dashStaminaCost) {
      showMessage("スタミナ不足！(消費: 10)");
      return;
    }
    stamina -= CONFIG.dashStaminaCost;
  }

  isDashing = true;
  dashTimer = CONFIG.dashDuration;
  dashCooldownTimer = CONFIG.dashCooldown;

  playAudio("se-totugeki", 1.0);
  setTimeout(() => {
    const el = $("se-totugeki");
    if (el) { el.pause(); el.currentTime = 0; }
  }, 4000);

  showMessage("突進発動！(2秒間無敵突進＆接触爆破)");
}

function collidesWithWorldEnemy(x, z, radius) {
  for (let eObj of enemies) {
    if (eObj.isWorldEnemy && eObj.state !== "defeated") {
      const half = eObj.halfExtent + radius;
      if (Math.abs(x - eObj.group.position.x) < half && Math.abs(z - eObj.group.position.z) < half) {
        return true;
      }
    }
  }
  return false;
}

function movePlayer(dt) {
  if (gameMode === "deadstage" || clearStageActive || isTransitioningToDeadStage) {
    camera.position.copy(player.position);
    camera.rotation.set(pitch, yaw, 0);
    return;
  }

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
    $("hp-fill").style.width = `${(playerHp / 20) * 100}%`;
    $("hp-text").textContent = `${Math.ceil(playerHp)} / 20`;
  }

  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const delta = forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(currentSpeed * dt);

  const nx = player.position.x + delta.x, nz = player.position.z + delta.z;
  const currentMaze = maze || Array(10).fill(0).map(()=>Array(10).fill(0));
  
  if (canStand(nx, player.position.z, CONFIG.playerRadius, currentMaze) && !collidesWithWorldEnemy(nx, player.position.z, CONFIG.playerRadius)) {
    player.position.x = nx;
  }
  if (canStand(player.position.x, nz, CONFIG.playerRadius, currentMaze) && !collidesWithWorldEnemy(player.position.x, nz, CONFIG.playerRadius)) {
    player.position.z = nz;
  }

  let currentStepHeight = 0;
  for (let el of elevationsList) {
    if (Math.abs(player.position.x - el.position.x) < CONFIG.cellSize * 0.5 &&
        Math.abs(player.position.z - el.position.z) < CONFIG.cellSize * 0.5) {
      currentStepHeight = Math.max(currentStepHeight, el.height);
    }
  }

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

  player.position.y = player.baseEyeY + currentStepHeight;
  camera.position.copy(player.position);
  camera.rotation.set(pitch, yaw, 0);
}

function fireWorldEnemyBlueOrb(originPos) {
  const projectileMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0x0088ff })
  );
  const startPos = new THREE.Vector3(originPos.x, 1.5, originPos.z);
  const targetPos = new THREE.Vector3(player.position.x, 1.4, player.position.z);
  const dir = targetPos.sub(startPos).normalize();
  projectileMesh.position.copy(startPos).addScaledVector(dir, 2.5);
  scene.add(projectileMesh);

  projectiles.push({
    mesh: projectileMesh,
    direction: dir,
    speed: CONFIG.projectileSpeed,
    life: 5.0,
    isEnemyProjectile: true
  });
}

function moveEnemies(dt) {
  if (clearStageActive || isTransitioningToDeadStage) return;

  if (gameMode === "deadstage") {
    deadStageTimer -= dt;
    const progress = 1.0 - clamp(deadStageTimer / 6.0, 0, 1.0);
    const spiralAngularSpeed = (60 / 60) * Math.PI * 2; // 60rpm

    for (let i = 0; i < enemies.length; i++) {
      const eObj = enemies[i];
      const currentDist = eObj.startDist * (1.0 - progress);
      const currentAngle = eObj.angle + spiralAngularSpeed * (6.0 - deadStageTimer);

      const px = Math.cos(currentAngle) * currentDist;
      const pz = Math.sin(currentAngle) * currentDist;
      eObj.group.position.set(px, 0, pz);
    }

    if (deadStageTimer <= 0) {
      finishDeadStageCaught();
    }
    return;
  }

  for (let i = 0; i < enemies.length; i++) {
    const eObj = enemies[i];
    if (eObj.state === "defeated") continue;

    if (eObj.state === "booming") {
      eObj.repathTimer -= dt;
      if (eObj.repathTimer <= 0) {
        eObj.state = "defeated";
        eObj.group.visible = false;
        if (eObj.isBeastKing && eObj.hp <= 0) {
          triggerClearStage("獣　王");
          return;
        }
        if (eObj.isWorldEnemy && eObj.hp <= 0) {
          triggerClearStage("World Enemy");
          return;
        }
      }
      continue;
    }

    if (eObj.isWorldEnemy) {
      eObj.group.position.set(0, 0, 0);

      eObj.shootTimer -= dt;
      if (eObj.shootTimer <= 0) {
        eObj.shootTimer = 3.0;
        fireWorldEnemyBlueOrb(eObj.group.position);
      }

      eObj.spawnMinionTimer -= dt;
      if (eObj.spawnMinionTimer <= 0) {
        eObj.spawnMinionTimer = 10.0;
        eObj.spinTimer = 2.0;
        const baseId = enemies.length;
        spawnNormalChaserAt(0, 0, baseId, true);
        spawnNormalChaserAt(0, 0, baseId + 1, true);
        showMessage("World Enemyが家臣を2体産出した！");
      }

      if (eObj.spinTimer > 0) {
        eObj.spinTimer -= dt;
        const angularVel = (240 / 60) * Math.PI * 2;
        eObj.group.rotation.y -= angularVel * dt;
      }

      const half = eObj.halfExtent + CONFIG.playerRadius + 0.2;
      if (Math.abs(player.position.x) <= half && Math.abs(player.position.z) <= half) {
        if (isDashing && !eObj.dashHitCooldown) {
          eObj.dashHitCooldown = true;
          eObj.hp = Math.max(0, eObj.hp - 15);
          updateBossHpUI(eObj);
          playAudio("se-boom", 1.0);
          showMessage(`World Enemyに突進ヒット！(-15 HP, 残りHP: ${eObj.hp})`);
          if (eObj.hp <= 0) {
            triggerClearStage("World Enemy");
            return;
          }
        } else if (!isDashing) {
          eObj.attackCooldown = Math.max(0, (eObj.attackCooldown || 0) - dt);
          if (eObj.attackCooldown <= 0) {
            eObj.attackCooldown = 1.5;
            damagePlayer(4, "World Enemyに触れてダメージを受けた！(-4 HP)");
            if (isTransitioningToDeadStage || gameMode === "deadstage") return;
          }
        }
      }
      if (!isDashing) eObj.dashHitCooldown = false;
      continue;
    }

    if (eObj.isBeastKing) {
      const targetWorldPos = player.position;
      
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
      const stepH = getElevationHeightAt(eObj.group.position.x, eObj.group.position.z, [...elevationsList, ...trapsList]);
      eObj.group.position.y = stepH;

      eObj.attackCooldown = Math.max(0, eObj.attackCooldown - dt);
      if (len < CONFIG.enemyCatchDistance && eObj.attackCooldown <= 0) {
        eObj.attackCooldown = 1.5;
        damagePlayer(4, "獣王の攻撃を受けた！(-4 HP)");
        if (isTransitioningToDeadStage || gameMode === "deadstage") return;
      }
      continue;
    }

    let targetWorldPos = null;
    const currentMaze = maze || Array(10).fill(0).map(()=>Array(10).fill(0));
    const canSee = lineOfSight(eObj.group.position, player.position, currentMaze);
    const distToPlayer = Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z);

    if (eObj.isBossMinion || (canSee && distToPlayer <= CONFIG.enemyDetectDistance)) {
      eObj.state = "chase";
    }

    if (eObj.state === "chase") {
      targetWorldPos = player.position;
    } else {
      if (!eObj.target || Math.hypot(eObj.group.position.x - eObj.target.x, eObj.group.position.z - eObj.target.z) < 1.5) {
        const sz = currentMaze.length;
        const rx = 1 + Math.floor(Math.random() * (sz - 2));
        const rz = 1 + Math.floor(Math.random() * (sz - 2));
        eObj.target = cellWorld(rx, rz, sz);
      }
      targetWorldPos = eObj.target;
    }

    if (targetWorldPos) {
      eObj.repathTimer -= dt;
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

        if (canStand(nextX, eObj.group.position.z, CONFIG.enemyRadius, currentMaze, elevationsList, eObj.isBossMinion)) {
          eObj.group.position.x = nextX;
        }
        if (canStand(eObj.group.position.x, nextZ, CONFIG.enemyRadius, currentMaze, elevationsList, eObj.isBossMinion)) {
          eObj.group.position.z = nextZ;
        }

        const stepH = getElevationHeightAt(eObj.group.position.x, eObj.group.position.z, [...elevationsList, ...trapsList]);
        eObj.group.position.y = stepH;
        eObj.group.rotation.y = Math.atan2(dirX, dirZ);
      }
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
      } else if (eObj.isBossMinion || gameMode.startsWith("boss")) {
        eObj.attackCooldown = (eObj.attackCooldown || 0) - dt;
        if (eObj.attackCooldown <= 0) {
          eObj.attackCooldown = 2.0;
          damagePlayer(4, "追跡者にダメージを受けた！(-4 HP)");
          if (isTransitioningToDeadStage || gameMode === "deadstage") return;
        }
      } else if (invulnerableTimer <= 0) {
        finishGame(false);
      }
    }
  }
}

function triggerDeadStage() {
  if (ended || isTransitioningToDeadStage || gameMode === "deadstage") return;
  isTransitioningToDeadStage = true;
  running = false;
  ended = false;
  gameMode = "deadstage";

  // 進行中の弾などをクリア
  for (let p of projectiles) {
    if (p.mesh && scene) scene.remove(p.mesh);
  }
  projectiles = [];

  initStage(() => {
    isTransitioningToDeadStage = false;
    running = true;
    ended = false;
  });
}

function finishDeadStageCaught() {
  if (ended) return;
  ended = true; running = false;
  playCaptureVideoDirectly(() => {
    $("end-title").textContent = "DEAD CAUGHT";
    $("end-text").textContent = "無慈悲な死が訪れた…";
    $("next-floor-button").classList.add("hidden");
    $("retry-floor-button").classList.remove("hidden");
    $("restart-button").classList.remove("hidden");
    $("restart-button").textContent = "1階からやり直す";
    $("retry-floor-button").textContent = "同じボスと戦う";
    
    if (localStorage.getItem("yaju_boss_unlocked") === "true") {
      $("end-boss-stages-section").classList.remove("hidden");
    } else {
      $("end-boss-stages-section").classList.add("hidden");
    }

    $("end-overlay").classList.remove("hidden");
  });
}

function shootRocket() {
  if (!running || ended || rocketAmmo <= 0 || gameMode === "deadstage" || clearStageActive || isTransitioningToDeadStage) return;
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

  projectiles.push({ mesh: projectileMesh, direction: dir, speed: CONFIG.projectileSpeed, life: 4.0, isEnemyProjectile: false });
}

function updateProjectiles(dt) {
  if (clearStageActive || isTransitioningToDeadStage) return;
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.direction, p.speed * dt);

    const currentMaze = maze || Array(10).fill(0).map(()=>Array(10).fill(0));
    if (isWallAt(p.mesh.position.x, p.mesh.position.z, currentMaze) || p.life <= 0) {
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
      continue;
    }

    if (p.isEnemyProjectile) {
      const distToPlayer = Math.hypot(p.mesh.position.x - player.position.x, p.mesh.position.z - player.position.z);
      if (distToPlayer <= 1.2) {
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
        if (!isDashing) {
          playAudio("se-boom", 0.8);
          damagePlayer(4, "World Enemyの青色弾頭に被弾！(-4 HP)");
          if (isTransitioningToDeadStage || gameMode === "deadstage") return;
        }
      }
      continue;
    }

    for (let eObj of enemies) {
      if (eObj.state !== "defeated" && eObj.state !== "booming" && eObj.group.visible) {
        let hit = false;
        if (eObj.isWorldEnemy) {
          const half = eObj.halfExtent + 0.6;
          if (Math.abs(p.mesh.position.x - eObj.group.position.x) <= half &&
              Math.abs(p.mesh.position.z - eObj.group.position.z) <= half) {
            hit = true;
          }
        } else {
          if (Math.hypot(p.mesh.position.x - eObj.group.position.x, p.mesh.position.z - eObj.group.position.z) <= CONFIG.projectileHitRadius) {
            hit = true;
          }
        }

        if (hit) {
          if (eObj.isBeastKing || eObj.isWorldEnemy) {
            const dmg = 20;
            eObj.hp = Math.max(0, eObj.hp - dmg);
            updateBossHpUI(eObj);
            playAudio("se-boom", 1.0);
            const bossLabel = eObj.isWorldEnemy ? "World Enemy" : "獣王";
            showMessage(`${bossLabel}にロケット命中！(-${dmg} HP, 残りHP: ${eObj.hp})`);
            scene.remove(p.mesh);
            projectiles.splice(i, 1);

            if (eObj.hp <= 0) {
              triggerClearStage(bossLabel);
              return;
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

  for (let eObj of enemies) {
    if (eObj.isBeastKing && eObj.bossDashActive) {
      const dist = Math.hypot(player.position.x - eObj.group.position.x, player.position.z - eObj.group.position.z);
      if (dist < 3.0 && !eObj.hasDamagedThisDash) {
        eObj.hasDamagedThisDash = true;
        damagePlayer(5, "獣王の突進を喰らった！(-5 HP)");
        if (isTransitioningToDeadStage || gameMode === "deadstage") return;
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

  const radarEl = $("radar");
  if (radarEl) {
    if (nearestDist <= CONFIG.radarYellowDist) {
      radarEl.style.borderColor = "#ff4444";
    } else if (nearestDist <= CONFIG.radarGreenDist) {
      radarEl.style.borderColor = "#ffdd44";
    } else {
      radarEl.style.borderColor = "#82c78c";
    }
  }
}

function finishBossWin(bossName) {
  if (ended) return;
  ended = true; running = false;
  stopYarimasuneLoop();
  playAudio("se-clear", 1.0);

  $("end-title").textContent = "BOSS DEFEATED!";
  $("end-text").textContent = `君は${bossName}を倒した！！`;
  $("next-floor-button").classList.add("hidden");
  $("retry-floor-button").classList.remove("hidden");
  $("restart-button").classList.remove("hidden");
  $("retry-floor-button").textContent = "同じボスと再戦";
  $("restart-button").textContent = "1階からやり直す";
  
  if (localStorage.getItem("yaju_boss_unlocked") === "true") {
    $("end-boss-stages-section").classList.remove("hidden");
  } else {
    $("end-boss-stages-section").classList.add("hidden");
  }

  $("end-overlay").classList.remove("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
}

function finishGame(win) {
  if (ended) return;
  ended = true; running = false;
  stopYarimasuneLoop();

  if (win) {
    if (currentFloor < CONFIG.maxFloors) {
      $("end-title").textContent = `${currentFloor}F CLEARED!`;
      $("end-text").textContent = `第 ${currentFloor} 階層を突破！次の階層へ進みます。`;
      $("next-floor-button").classList.remove("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.add("hidden");
      $("end-boss-stages-section").classList.add("hidden");
    } else {
      $("end-title").textContent = "ALL CLEAR!!";
      $("end-text").textContent = "おめでとう！全5階層の迷路を完全脱出した！ボスステージが解放されたぞ！";
      $("next-floor-button").classList.add("hidden");
      $("retry-floor-button").classList.add("hidden");
      $("restart-button").classList.remove("hidden");
      $("restart-button").textContent = "最初からプレイ";
      
      localStorage.setItem("yaju_boss_unlocked", "true");
      $("end-boss-stages-section").classList.remove("hidden");
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
      $("end-boss-stages-section").classList.add("hidden");

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
    if ($("fps-counter")) $("fps-counter").textContent = `FPS: ${frameCount}`;
    frameCount = 0;
    fpsTimer = now;
  }

  const dt = clock ? Math.min(clock.getDelta(), 0.05) : 0.016;

  if (running && !ended && !isTransitioningToDeadStage) {
    if (clearStageActive) {
      clearStageTimer += dt;
      const progress = clamp(clearStageTimer / 3.0, 0, 1);
      if (scene) {
        scene.background = new THREE.Color(0xffffff);
        const fogDensity = 0.01 + Math.pow(progress, 2) * 2.5;
        scene.fog = new THREE.FogExp2(0xffffff, fogDensity);
      }
      if (!clearStageDeleted && progress >= 0.45) {
        clearStageDeleted = true;
        clearAllStageObjectsForClear();
      }
      if (clearStageTimer >= 3.0) {
        clearStageActive = false;
        finishBossWin(clearBossTitle);
      }
      if (renderer && scene && camera) renderer.render(scene, camera);
      return;
    }

    if (invulnerableTimer > 0) {
      invulnerableTimer -= dt;
      if (invulnerableTimer <= 0) showMessage("無敵時間が終了した");
    }

    movePlayer(dt);
    moveEnemies(dt);
    updateProjectiles(dt);
    updateOcclusionAndLOD();

    for (let eObj of enemies) {
      if (eObj.planeMesh && eObj.state !== "defeated") {
        eObj.planeMesh.lookAt(camera.position.x, eObj.planeMesh.getWorldPosition(new THREE.Vector3()).y, camera.position.z);
      }
    }

    updateCompasses();

    if (gameMode === "normal" && goalMesh && Math.hypot(player.position.x - goalMesh.position.x, player.position.z - goalMesh.position.z) < 1.35) {
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

function startGameFromSettings(mode = "normal") {
  try {
    gameMode = mode;
    isTransitioningToDeadStage = false;
    const compassEl = $("setting-compass");
    const progEl = $("setting-progressive-enemies");
    gameSettings.compass = compassEl ? compassEl.checked : true;
    gameSettings.progressiveEnemies = progEl ? progEl.checked : true;

    stopCaptureVideoImmediately();
    unlockAndPreloadMedia();

    if (mode === "normal") {
      currentFloor = 1;
      hasRocketFromPreviousFloor = false;
    }

    initStage(() => {
      const overlayEl = $("overlay");
      const endOverlayEl = $("end-overlay");
      if (overlayEl) overlayEl.classList.add("hidden");
      if (endOverlayEl) endOverlayEl.classList.add("hidden");
      document.body.classList.add("game-active");

      running = true;
      ended = false;
      playAudio("se-start", 1.0);
      if (renderer && matchMedia("(pointer:fine)").matches) {
        renderer.domElement.requestPointerLock?.();
      }
    });
  } catch (err) {
    console.error("Critical error in startGameFromSettings:", err);
    showLoading(false);
    showMessage("ゲームの起動に失敗しました。");
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
  isTransitioningToDeadStage = false;
  
  if (gameMode === "deadstage") {
    gameMode = lastBossMode;
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
  isTransitioningToDeadStage = false;
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

function initUIAndEvents() {
  const bossModeToggle = $("setting-boss-mode");
  const compassToggle = $("setting-compass");
  const startBtn = $("start-button");
  const bossButtonsGroup = $("boss-challenge-buttons");

  function syncBossModeToggleUI() {
    if (!bossModeToggle || !startBtn || !bossButtonsGroup) return;
    if (bossModeToggle.checked) {
      if (compassToggle) compassToggle.checked = false;
      startBtn.disabled = true;
      startBtn.classList.add("boss-mode-disabled");
      bossButtonsGroup.classList.remove("hidden");
    } else {
      startBtn.disabled = false;
      startBtn.classList.remove("boss-mode-disabled");
      bossButtonsGroup.classList.add("hidden");
    }
  }

  if (bossModeToggle) {
    bossModeToggle.checked = false;
    bossModeToggle.addEventListener("change", syncBossModeToggleUI);
    bossModeToggle.addEventListener("input", syncBossModeToggleUI);
    syncBossModeToggleUI();
  }

  if (startBtn) {
    startBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      startGameFromSettings("normal");
    });
  }

  const worldEnemyBtn = $("boss-world-enemy-btn");
  if (worldEnemyBtn) {
    worldEnemyBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      startGameFromSettings("boss_world_enemy");
    });
  }

  const beastKingBtn = $("boss-beast-king-btn");
  if (beastKingBtn) {
    beastKingBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      startGameFromSettings("boss_beast_king");
    });
  }

  const endWorldEnemyBtn = $("end-boss-world-enemy-btn");
  if (endWorldEnemyBtn) {
    endWorldEnemyBtn.addEventListener("click", () => {
      $("end-overlay").classList.add("hidden");
      startGameFromSettings("boss_world_enemy");
    });
  }

  const endBeastKingBtn = $("end-boss-beast-king-btn");
  if (endBeastKingBtn) {
    endBeastKingBtn.addEventListener("click", () => {
      $("end-overlay").classList.add("hidden");
      startGameFromSettings("boss_beast_king");
    });
  }

  $("next-floor-button")?.addEventListener("click", nextFloor);
  $("retry-floor-button")?.addEventListener("click", () => {
    if (gameMode === "deadstage" || $("end-title").textContent === "BOSS DEFEATED!") {
      startGameFromSettings(lastBossMode);
    } else {
      retryCurrentFloor();
    }
  });
  $("restart-button")?.addEventListener("click", () => {
    restartFromFloor1();
  });

  disableGestures();
  window.addEventListener("resize", handleResize);

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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUIAndEvents);
} else {
  initUIAndEvents();
}
