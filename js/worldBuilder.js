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

export function generateMaze(size) {
  const grid = Array.from({length:size},()=>Array(size).fill(1));
  const stack = [[1,1]];
  grid[1][1] = 0;
  const dirs = [[0,-2],[2,0],[0,2],[-2,0]];
  while(stack.length){
    const [x,z] = stack[stack.length-1];
    const choices = dirs.filter(([dx,dz])=>{
      const nx=x+dx,nz=z+dz;
      return nx>0 && nz>0 && nx<size-1 && nz<size-1 && grid[nz][nx]===1;
    });
    if(!choices.length){stack.pop();continue;}
    const [dx,dz] = choices[Math.floor(Math.random()*choices.length)];
    grid[z+dz/2][x+dx/2]=0;
    grid[z+dz][x+dx]=0;
    stack.push([x+dx,z+dz]);
  }
  
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[z][x] !== 1 || Math.random() > 0.35) continue; 
      const horizontal = grid[z][x-1] === 0 && grid[z][x+1] === 0;
      const vertical = grid[z-1][x] === 0 && grid[z+1][x] === 0;
      if (horizontal || vertical) grid[z][x] = 0;
    }
  }

  grid[1][1] = 0; grid[1][2] = 0; grid[2][1] = 0;
  grid[size-2][size-2] = 0; grid[size-2][size-3] = 0; grid[size-3][size-2] = 0;

  return grid;
}

export function buildScene(maze) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  scene.fog = new THREE.Fog(0x0a0a08, CONFIG.fogNear, CONFIG.fogFar);

  scene.add(new THREE.HemisphereLight(0xaaaaaa, 0x444444, 2.0));
  const dirLight = new THREE.DirectionalLight(0x999988, 0.4);
  dirLight.position.set(5, 12, 4);
  scene.add(dirLight);

  const carpetCanvas = document.createElement("canvas");
  carpetCanvas.width = 128; carpetCanvas.height = 128;
  const carpetCtx = carpetCanvas.getContext("2d");
  carpetCtx.fillStyle = "#555040"; carpetCtx.fillRect(0,0,128,128);
  for(let i=0;i<800;i++){
    const v = 70 + Math.floor(Math.random()*30);
    carpetCtx.fillStyle = `rgba(${v},${v-5},${v-15},${Math.random()*.2})`;
    carpetCtx.fillRect(Math.random()*128, Math.random()*128, 2, 2);
  }
  const carpetTexture = new THREE.CanvasTexture(carpetCanvas);
  carpetTexture.wrapS = carpetTexture.wrapT = THREE.RepeatWrapping;
  carpetTexture.repeat.set(maze.length/2, maze.length/2);

  const floorMat = new THREE.MeshStandardMaterial({map:carpetTexture, color:0xcccccc, roughness:0.9});
  const ceilingMat = new THREE.MeshStandardMaterial({color:0x777060, roughness:0.9});
  const wallMat = new THREE.MeshStandardMaterial({color:0xaaa080, roughness:0.9});

  loader.load('./assets/textures/wall.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.needsUpdate = true;
    wallMat.map = tex; wallMat.needsUpdate = true; 
  });
  loader.load('./assets/textures/floor.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(maze.length/2, maze.length/2); 
    tex.needsUpdate = true;
    floorMat.map = tex; floorMat.needsUpdate = true; 
  });
  loader.load('./assets/textures/ceiling.jpeg', tex => { 
    tex.image = resizeTextureImage(tex.image, CONFIG.maxTextureSize);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(maze.length/2, maze.length/2); 
    tex.needsUpdate = true;
    ceilingMat.map = tex; ceilingMat.needsUpdate = true; 
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(maze.length*CONFIG.cellSize, maze.length*CONFIG.cellSize), floorMat);
  floor.rotation.x = -Math.PI/2; floor.position.y = 0; scene.add(floor);
  
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(maze.length*CONFIG.cellSize, maze.length*CONFIG.cellSize), ceilingMat);
  ceiling.rotation.x = Math.PI/2; ceiling.position.y = CONFIG.wallHeight; scene.add(ceiling);

  let wallCount = 0;
  for(let z=0; z<maze.length; z++) for(let x=0; x<maze.length; x++) if(maze[z][x]===1) wallCount++;
  
  const wallGeo = new THREE.BoxGeometry(CONFIG.cellSize, CONFIG.wallHeight, CONFIG.cellSize);
  const wallInstancedMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  let wIdx = 0;
  const dummy = new THREE.Object3D();
  
  for(let z=0; z<maze.length; z++) for(let x=0; x<maze.length; x++){
    if(maze[z][x]===1){
      const p = cellWorld(x, z, maze.length);
      dummy.position.set(p.x, CONFIG.wallHeight/2, p.z);
      dummy.updateMatrix();
      wallInstancedMesh.setMatrixAt(wIdx++, dummy.matrix);
    }
  }
  scene.add(wallInstancedMesh);

  // ★ 段差 & トラップモンスター生成（段差＝床/壁と同色の黄色 #aaa080、トラップ＝ほんのり赤みの黄色 #bb9368）
  const { elevations, traps } = createStepsAndTraps(scene, maze);

  const pointLightsList = [];
  for(let z=1; z<maze.length-1; z+=2) for(let x=1; x<maze.length-1; x+=2){
    if(maze[z][x]===0){
      const p = cellWorld(x, z, maze.length);
      const isRedLight = Math.random() < 0.4;
      const lightColor = isRedLight ? 0xff3333 : 0xfffae6;
      const lampEmissive = isRedLight ? 0x661111 : 0x444433;

      const lampMat = new THREE.MeshStandardMaterial({
        color: lightColor,
        emissive: lampEmissive,
        emissiveIntensity: 0.3,
        roughness: 0.8
      });
      const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, .06, .4), lampMat);
      lampMesh.position.set(p.x, CONFIG.wallHeight - .04, p.z);
      scene.add(lampMesh);

      const baseInt = isRedLight ? 12.0 : 15.0;
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

  return { scene, pointLightsList, elevations, traps };
}

function createStepsAndTraps(scene, maze) {
  const openCells = [];
  for (let z = 2; z < maze.length - 2; z++) {
    for (let x = 2; x < maze.length - 2; x++) {
      if (maze[z][x] === 0 && !(x <= 2 && z <= 2) && !(x >= maze.length - 3 && z >= maze.length - 3)) {
        openCells.push({ x, z });
      }
    }
  }

  const totalCount = Math.floor(Math.random() * (CONFIG.totalElevationObjectsMax - CONFIG.totalElevationObjectsMin + 1)) + CONFIG.totalElevationObjectsMin;
  const usedCells = new Set();
  const elevations = [];
  const traps = [];

  // 段差の色：壁や床と同じ黄色 (0xaaa080)
  const stepMat = new THREE.MeshStandardMaterial({ color: 0xaaa080, roughness: 0.85 });
  // トラップモンスターの色：壁や床の黄色よりほんのり赤い黄色 (0xbb9368)
  const trapMat = new THREE.MeshStandardMaterial({ color: 0xbb9368, roughness: 0.80 });

  let remaining = totalCount;
  while (remaining > 0 && openCells.length > 0) {
    const idx = Math.floor(Math.random() * openCells.length);
    const baseCell = openCells.splice(idx, 1)[0];
    const key = `${baseCell.x},${baseCell.z}`;
    if (usedCells.has(key)) continue;

    const isTrap = Math.random() < CONFIG.trapProbability;

    usedCells.add(key);
    const p1 = cellWorld(baseCell.x, baseCell.z, maze.length);
    const h1 = CONFIG.stepHeight1;
    // 壁にピッタリ密着できる full cellSize 幅で生成
    const mesh1 = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.cellSize, h1, CONFIG.cellSize), isTrap ? trapMat : stepMat);
    mesh1.position.set(p1.x, h1 / 2, p1.z);
    scene.add(mesh1);

    const obj1 = { mesh: mesh1, position: p1, height: h1, steps: 1, isTrap, cell: baseCell, active: true };
    if (isTrap) traps.push(obj1);
    else elevations.push(obj1);
    remaining--;

    if (remaining > 0) {
      const neighbors = [
        { x: baseCell.x + 1, z: baseCell.z }, { x: baseCell.x - 1, z: baseCell.z },
        { x: baseCell.x, z: baseCell.z + 1 }, { x: baseCell.x, z: baseCell.z - 1 }
      ].filter(c => maze[c.z]?.[c.x] === 0 && !usedCells.has(`${c.x},${c.z}`));

      if (neighbors.length > 0) {
        const nCell = neighbors[Math.floor(Math.random() * neighbors.length)];
        const nKey = `${nCell.x},${nCell.z}`;
        usedCells.add(nKey);

        const isTrap2 = Math.random() < CONFIG.trapProbability;
        const p2 = cellWorld(nCell.x, nCell.z, maze.length);
        const h2 = CONFIG.stepHeight2;
        const mesh2 = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.cellSize, h2, CONFIG.cellSize), isTrap2 ? trapMat : stepMat);
        mesh2.position.set(p2.x, h2 / 2, p2.z);
        scene.add(mesh2);

        const obj2 = { mesh: mesh2, position: p2, height: h2, steps: 2, isTrap: isTrap2, cell: nCell, active: true };
        if (isTrap2) traps.push(obj2);
        else elevations.push(obj2);
        remaining--;
      }
    }
  }

  return { elevations, traps };
}

export function setupMapRockets(scene, openCells, mazeLength, spawnPos) {
  const mapItems = [];
  const count = 1 + Math.floor(Math.random() * 2);

  const candidates = openCells.filter(c => {
    const p = cellWorld(c.x, c.z, mazeLength);
    return Math.hypot(p.x - spawnPos.x, p.z - spawnPos.z) >= CONFIG.rocketSpawnMinDist;
  });
  const pool = candidates.length ? candidates : openCells;

  loader.load(ROCKET_IMAGE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    for (let i = 0; i < count; i++) {
      const cell = pool[Math.floor(Math.random() * pool.length)];
      const rPos = cellWorld(cell.x, cell.z, mazeLength);
      rPos.y = 0.8;

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
