import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, ROCKET_IMAGE } from "./config.js";
import { cellWorld } from "./collision.js";

const loader = new THREE.TextureLoader();

export function buildBossScene(bossType) {
  const size = 10;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.Fog(0x0a0a08, CONFIG.fogNear, CONFIG.fogFar);

  scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x444444, 2.0));
  const dirLight = new THREE.DirectionalLight(0x999988, 0.4);
  dirLight.position.set(5, 12, 4);
  scene.add(dirLight);

  const floorMat = new THREE.MeshStandardMaterial({color:0x555040, roughness:0.9});
  const ceilingMat = new THREE.MeshStandardMaterial({color:0x777060, roughness:0.9});
  const wallMat = new THREE.MeshStandardMaterial({color:0xaaa080, roughness:0.9});

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * CONFIG.cellSize, size * CONFIG.cellSize), floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.y = 0; scene.add(floor);
  
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(size * CONFIG.cellSize, size * CONFIG.cellSize), ceilingMat);
  ceiling.rotation.x = Math.PI/2; ceiling.position.y = CONFIG.wallHeight; scene.add(ceiling);

  // 10x10の外壁生成
  let wallCount = 0;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (z === 0 || z === size - 1 || x === 0 || x === size - 1) wallCount++;
    }
  }

  const wallGeo = new THREE.BoxGeometry(CONFIG.cellSize, CONFIG.wallHeight, CONFIG.cellSize);
  const wallInstancedMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  let wIdx = 0;
  const dummy = new THREE.Object3D();

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (z === 0 || z === size - 1 || x === 0 || x === size - 1) {
        const p = cellWorld(x, z, size);
        dummy.position.set(p.x, CONFIG.wallHeight/2, p.z);
        dummy.updateMatrix();
        wallInstancedMesh.setMatrixAt(wIdx++, dummy.matrix);
      }
    }
  }
  scene.add(wallInstancedMesh);

  // トラップモンスターなしの段差のみを生成
  const elevations = [];
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xaaa080, roughness: 0.85 });
  const openCells = [];
  for (let z = 2; z < size - 2; z++) {
    for (let x = 2; x < size - 2; x++) {
      openCells.push({ x, z });
    }
  }

  for (let i = 0; i < 6; i++) {
    if (openCells.length === 0) break;
    const idx = Math.floor(Math.random() * openCells.length);
    const cell = openCells.splice(idx, 1)[0];
    const p = cellWorld(cell.x, cell.z, size);
    const h = Math.random() < 0.5 ? CONFIG.stepHeight1 : CONFIG.stepHeight2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.cellSize, h, CONFIG.cellSize), stepMat);
    mesh.position.set(p.x, h / 2, p.z);
    scene.add(mesh);
    elevations.push({ mesh, position: p, height: h, steps: h === CONFIG.stepHeight1 ? 1 : 2 });
  }

  // ロケットを3つ生成
  const bossRockets = [];
  loader.load(ROCKET_IMAGE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    for (let i = 0; i < 3; i++) {
      if (openCells.length === 0) break;
      const cell = openCells.splice(Math.floor(Math.random() * openCells.length), 1)[0];
      const rPos = cellWorld(cell.x, cell.z, size);
      rPos.y = 0.8;
      const mat = new THREE.MeshBasicMaterial({map: texture, transparent: true, side: THREE.DoubleSide});
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

  return { scene, elevations, bossRockets };
}
