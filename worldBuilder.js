import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { CONFIG } from "./config.js";
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
  
  // マップ内の壁をランダム間引いて適度に開けた迷路に
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[z][x] !== 1 || Math.random() > 0.35) continue; 
      const horizontal = grid[z][x-1] === 0 && grid[z][x+1] === 0;
      const vertical = grid[z-1][x] === 0 && grid[z+1][x] === 0;
      if (horizontal || vertical) grid[z][x] = 0;
    }
  }

  // ゴール周辺・スタート周辺（15セル内側）の通行確保
  grid[1][1] = 0; grid[1][2] = 0; grid[2][1] = 0;
  grid[size-2][size-2] = 0; grid[size-2][size-3] = 0; grid[size-3][size-2] = 0;

  return grid;
}

export function buildScene(maze, enableFog) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a08);
  
  if (enableFog) {
    scene.fog = new THREE.Fog(0x0a0a08, CONFIG.fogNear, CONFIG.fogFar);
  }

  // ★ ステージ全体の明るさを現在の「2倍」に変更 (環境光 1.0 -> 2.0 / ディレクショナル 0.15 -> 0.4)
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

  // ★ 天井ライトの改善：
  // 電球自体のメッシュの発光（MeshStandardMaterial + emissive）は控えめにし、周囲を照らすPointLightの強さをアップ！
  const pointLightsList = [];
  for(let z=1; z<maze.length-1; z+=2) for(let x=1; x<maze.length-1; x+=2){
    if(maze[z][x]===0){
      const p = cellWorld(x, z, maze.length);
      const isRedLight = Math.random() < 0.4;
      const lightColor = isRedLight ? 0xff3333 : 0xfffae6;
      const lampEmissive = isRedLight ? 0x661111 : 0x444433; // 自体発光は控えめ

      // 電球自体の発光は抑えめ
      const lampMat = new THREE.MeshStandardMaterial({
        color: lightColor,
        emissive: lampEmissive,
        emissiveIntensity: 0.3, // 控えめ
        roughness: 0.8
      });
      const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, .06, .4), lampMat);
      lampMesh.position.set(p.x, CONFIG.wallHeight - .04, p.z);
      scene.add(lampMesh);

      // 周囲を強く照らすポイントライト (baseIntensityを大幅強化 12.0/15.0)
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

  return { scene, pointLightsList };
}
