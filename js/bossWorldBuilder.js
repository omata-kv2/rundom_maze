import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG, ROCKET_IMAGE, CHASER_IMAGES } from "./config.js";
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

export function generateBossMaze(size = 10) {
  const grid = Array.from({length: size}, () => Array(size).fill(0));
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (z === 0 || z === size - 1 || x === 0 || x === size - 1) {
        grid[z][x] = 1;
      }
    }
  }
  return grid;
}

export function buildBossScene(maze, bossType = "world_enemy") {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.Fog(0x0a0a08, CONFIG.fogNear, CONFIG.fogFar);

  scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x444444, 2.0));
  const dirLight = new THREE.DirectionalLight(0x999988, 0.4);
  dirLight.position.set(5, 12, 4);
  scene.add(dirLight);

  const size = maze.length;
  const cellSize = CONFIG.cellSize;

  const floorMat = new THREE.MeshStandardMaterial({color: 0xcccccc, roughness: 0.9});
  const ceilingMat = new THREE.MeshStandardMaterial({color: 0x777060, roughness: 0.9});
  const wallMat = new THREE.MeshStandardMaterial({color: 0xaaa080, roughness: 0.9});

  loader.load('./assets/textures/wall.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.needsUpdate = true;
    wallMat.map = tex; wallMat.needsUpdate = true; 
  });
  loader.load('./assets/textures/floor.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(size/2, size/2); 
    tex.needsUpdate = true;
    floorMat.map = tex; floorMat.needsUpdate = true; 
  });
  loader.load('./assets/textures/ceiling.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(size/2, size/2); 
    tex.needsUpdate = true;
    ceilingMat.map = tex; ceilingMat.needsUpdate = true; 
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * cellSize, size * cellSize), floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.y = 0; scene.add(floor);
  
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(size * cellSize, size * cellSize), ceilingMat);
  ceiling.rotation.x = Math.PI/2; ceiling.position.y = CONFIG.wallHeight; scene.add(ceiling);

  let wallCount = 0;
  for(let z=0; z<size; z++) for(let x=0; x<size; x++) if(maze[z][x]===1) wallCount++;
  
  const wallGeo = new THREE.BoxGeometry(cellSize, CONFIG.wallHeight, cellSize);
  const wallInstancedMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  let wIdx = 0;
  const dummy = new THREE.Object3D();
  
  for(let z=0; z<size; z++) for(let x=0; x<size; x++){
    if(maze[z][x]===1){
      const p = cellWorld(x, z, size);
      dummy.position.set(p.x, CONFIG.wallHeight/2, p.z);
      dummy.updateMatrix();
      wallInstancedMesh.setMatrixAt(wIdx++, dummy.matrix);
    }
  }
  scene.add(wallInstancedMesh);

  // トラップなしの段差生成
  const openCells = [];
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (maze[z][x] === 0 && !(x === 1 && z === 1)) {
        openCells.push({ x, z });
      }
    }
  }

  const elevations = [];
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xaaa080, roughness: 0.85 });
  const stepCount = 5;
  for (let i = 0; i < stepCount && openCells.length > 0; i++) {
    const idx = Math.floor(Math.random() * openCells.length);
    const cell = openCells.splice(idx, 1)[0];
    const p = cellWorld(cell.x, cell.z, size);
    const h = (i % 2 === 0) ? CONFIG.stepHeight1 : CONFIG.stepHeight2;
    
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(cellSize, h, cellSize), stepMat);
    mesh.position.set(p.x, h / 2, p.z);
    scene.add(mesh);
    elevations.push({ mesh, position: p, height: h, cell });
  }

  // ボス本体の生成
  let bossObj = null;
  if (bossType === "world_enemy") {
    const bossGroup = new THREE.Group();
    bossGroup.position.set(0, 2.0, 0);

    const bossGeo = new THREE.DodecahedronGeometry(1.8, 0);
    const bossMatFront = new THREE.MeshBasicMaterial({color: 0xffffff});
    const bossMatBack = new THREE.MeshBasicMaterial({color: 0xe74c3c});

    loader.load('./assets/chasers/izan.png', tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      bossMatFront.map = tex;
      bossMatFront.needsUpdate = true;
    });

    const bossMeshMain = new THREE.Mesh(bossGeo, [bossMatFront, bossMatBack]);
    bossGroup.add(bossMeshMain);
    scene.add(bossGroup);
    bossObj = { group: bossGroup, radius: 2.2, type: "world_enemy" };

  } else if (bossType === "beast_king") {
    // 獣王（通常の追跡者の2倍の大きさ：4.0 x 4.0）
    const bossGroup = new THREE.Group();
    bossGroup.position.set(0, 0, 0);

    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 4.0));
    planeMesh.position.y = 2.0;
    bossGroup.add(planeMesh);

    loader.load(CHASER_IMAGES[0], tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      planeMesh.material = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false
      });
    });

    scene.add(bossGroup);
    // 当たり判定はその大きさに見合ったものに（radius: 2.0, catch: 3.0）
    bossObj = { group: bossGroup, planeMesh, radius: 1.0, hitRadius: 3.0, type: "beast_king" };
  }

  const pointLightsList = [];
  const pl = new THREE.PointLight(0xfffae6, 18.0, 25.0);
  pl.position.set(0, CONFIG.wallHeight - 1.0, 0);
  scene.add(pl);
  pointLightsList.push({ position: pl.position, light: pl, lampMesh: {visible: true}, baseIntensity: 18.0 });

  return { scene, pointLightsList, elevations, traps: [], bossObj };
}

export function setupBossMapRockets(scene, openCells, mazeSize, elevations) {
  const mapItems = [];
  const count = 5;

  loader.load(ROCKET_IMAGE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    for (let i = 0; i < count && openCells.length > 0; i++) {
      const idx = Math.floor(Math.random() * openCells.length);
      const cell = openCells.splice(idx, 1)[0];
      const rPos = cellWorld(cell.x, cell.z, mazeSize);
      
      let stepHeight = 0;
      for (let el of elevations) {
        if (el.cell.x === cell.x && el.cell.z === cell.z) {
          stepHeight = el.height;
          break;
        }
      }
      rPos.y = stepHeight + 0.8;

      const mat = new THREE.MeshBasicMaterial({map: texture, transparent: true, side: THREE.DoubleSide});
      const geo = new THREE.PlaneGeometry(1.2, 1.2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(rPos.x, rPos.y, rPos.z);
      scene.add(mesh);

      const blueLight = new THREE.PointLight(0x00aaff, 4.0, 12);
      blueLight.position.set(rPos.x, rPos.y + 0.3, rPos.z);
      scene.add(blueLight);

      mapItems.push({ mesh, light: blueLight, cell, active: true });
    }
  });

  return mapItems;
}
