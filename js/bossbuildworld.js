import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, ROCKET_IMAGE } from "./config.js";
import { cellWorld } from "./collision.js";

const loader = new THREE.TextureLoader();

function resizeTextureImage(image, maxSize = CONFIG.maxTextureSize) {
  if (!image || (image.width <= maxSize && image.height <= maxSize)) return image;
  const canvas = document.createElement('canvas');
  let w = image.width, h = image.height;
  if (w > h) {
    if (w > maxSize) { h = Math.round(h * (maxSize / w)); w = maxSize; }
  } else {
    if (h > maxSize) { w = Math.round(w * (maxSize / h)); h = maxSize; }
  }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, h);
  return canvas;
}

export function buildBossScene(bossType) {
  const size = 10;
  // 外枠のみ壁(1)、内部はすべて通路(0)の10x10グリッド
  const maze = Array.from({ length: size }, (_, z) =>
    Array.from({ length: size }, (_, x) =>
      (z === 0 || z === size - 1 || x === 0 || x === size - 1) ? 1 : 0
    )
  );

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.Fog(0x0a0a08, CONFIG.fogNear, CONFIG.fogFar);

  scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x444444, 2.0));
  const dirLight = new THREE.DirectionalLight(0x999988, 0.4);
  dirLight.position.set(5, 12, 4);
  scene.add(dirLight);

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x555040, roughness: 0.9 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: 0x777060, roughness: 0.9 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xaaa080, roughness: 0.9 });

  loader.load('./assets/textures/wall.jpeg', tex => {
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.needsUpdate = true;
    wallMat.map = tex; wallMat.needsUpdate = true;
  });
  loader.load('./assets/textures/floor.jpeg', tex => {
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(size / 2, size / 2);
    tex.needsUpdate = true;
    floorMat.map = tex; floorMat.needsUpdate = true;
  });
  loader.load('./assets/textures/ceiling.jpeg', tex => {
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(size / 2, size / 2);
    tex.needsUpdate = true;
    ceilingMat.map = tex; ceilingMat.needsUpdate = true;
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * CONFIG.cellSize, size * CONFIG.cellSize), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0; scene.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(size * CONFIG.cellSize, size * CONFIG.cellSize), ceilingMat);
  ceiling.rotation.x = Math.PI / 2; ceiling.position.y = CONFIG.wallHeight; scene.add(ceiling);

  let wallCount = 0;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (maze[z][x] === 1) wallCount++;
    }
  }

  const wallGeo = new THREE.BoxGeometry(CONFIG.cellSize, CONFIG.wallHeight, CONFIG.cellSize);
  const wallInstancedMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  let wIdx = 0;
  const dummy = new THREE.Object3D();

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (maze[z][x] === 1) {
        const p = cellWorld(x, z, size);
        dummy.position.set(p.x, CONFIG.wallHeight / 2, p.z);
        dummy.updateMatrix();
        wallInstancedMesh.setMatrixAt(wIdx++, dummy.matrix);
      }
    }
  }
  scene.add(wallInstancedMesh);

  // ボスステージではライトは赤色のみ生成
  const pointLightsList = [];
  for (let z = 1; z < size - 1; z += 2) {
    for (let x = 1; x < size - 1; x += 2) {
      const p = cellWorld(x, z, size);
      const lightColor = 0xff3333;
      const lampEmissive = 0x661111;

      const lampMat = new THREE.MeshStandardMaterial({
        color: lightColor,
        emissive: lampEmissive,
        emissiveIntensity: 0.4,
        roughness: 0.8
      });
      const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.4), lampMat);
      lampMesh.position.set(p.x, CONFIG.wallHeight - 0.04, p.z);
      scene.add(lampMesh);

      const baseInt = 14.0;
      const pl = new THREE.PointLight(lightColor, baseInt, 18.0);
      pl.position.set(p.x, CONFIG.wallHeight - 0.8, p.z);
      scene.add(pl);

      pointLightsList.push({
        position: new THREE.Vector3(p.x, CONFIG.wallHeight - 0.8, p.z),
        light: pl,
        lampMesh: lampMesh,
        baseIntensity: baseInt
      });
    }
  }

  // 段差・トラップ生成（World Enemy戦では中央(4.5, 4.5)から半径2セル以内および角セルを除外）
  const elevations = [];
  const traps = [];
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xaaa080, roughness: 0.85 });
  const trapMat = new THREE.MeshStandardMaterial({ color: 0xbb9368, roughness: 0.80 });

  const centerCoord = (size - 1) / 2; // 4.5
  const validStepCells = [];
  const allInnerCells = [];

  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      allInnerCells.push({ x, z });
      // 部屋の角(1,1)付近はプレイヤーの安全のため除外
      if (x <= 2 && z <= 2) continue;
      // World Enemy戦では部屋の中央から半径2セル以内に段差を生成しない
      if (bossType === "boss_world_enemy") {
        const distFromCenter = Math.hypot(x - centerCoord, z - centerCoord);
        if (distFromCenter <= 2.2) continue;
      }
      validStepCells.push({ x, z });
    }
  }

  const usedCells = new Set();
  const targetObjCount = 8;
  for (let i = 0; i < targetObjCount && validStepCells.length > 0; i++) {
    const idx = Math.floor(Math.random() * validStepCells.length);
    const cell = validStepCells.splice(idx, 1)[0];
    const key = `${cell.x},${cell.z}`;
    if (usedCells.has(key)) continue;
    usedCells.add(key);

    const isTrap = Math.random() < CONFIG.trapProbability;
    const h = Math.random() < 0.5 ? CONFIG.stepHeight1 : CONFIG.stepHeight2;
    const p = cellWorld(cell.x, cell.z, size);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.cellSize, h, CONFIG.cellSize), isTrap ? trapMat : stepMat);
    mesh.position.set(p.x, h / 2, p.z);
    scene.add(mesh);

    const obj = { mesh, position: p, height: h, steps: h === CONFIG.stepHeight1 ? 1 : 2, isTrap, cell, active: true };
    if (isTrap) traps.push(obj);
    else elevations.push(obj);
  }

  // ロケットアイテム生成（中央付近は避ける）
  const bossRockets = [];
  const rocketPool = allInnerCells.filter(c => {
    if (c.x === 1 && c.z === 1) return false;
    if (bossType === "boss_world_enemy" && Math.hypot(c.x - centerCoord, c.z - centerCoord) <= 2.0) return false;
    return true;
  });

  loader.load(ROCKET_IMAGE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    for (let i = 0; i < 3; i++) {
      if (rocketPool.length === 0) break;
      const cell = rocketPool.splice(Math.floor(Math.random() * rocketPool.length), 1)[0];
      const rPos = cellWorld(cell.x, cell.z, size);

      let targetY = 0.8;
      for (let el of [...elevations, ...traps]) {
        if (Math.abs(rPos.x - el.position.x) < 0.5 && Math.abs(rPos.z - el.position.z) < 0.5) {
          targetY = el.height + 0.5;
          break;
        }
      }
      rPos.y = targetY;

      const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
      const geo = new THREE.PlaneGeometry(1.2, 1.2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(rPos.x, rPos.y, rPos.z);
      scene.add(mesh);

      const blueLight = new THREE.PointLight(0x00aaff, 4.0, 12);
      blueLight.position.set(rPos.x, rPos.y + 0.3, rPos.z);
      scene.add(blueLight);

      bossRockets.push({ mesh, light: blueLight, active: true });
    }
  });

  return { scene, maze, pointLightsList, elevations, traps, bossRockets };
}
