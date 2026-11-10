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
  for (let i = 0; i < 3; i++) {
    const rw = 2 + Math.floor(Math.random() * 2);
    const rh = 2 + Math.floor(Math.random() * 2);
    const rx = 2 + Math.floor(Math.random() * Math.max(1, size - rw - 3));
    const rz = 2 + Math.floor(Math.random() * Math.max(1, size - rh - 3));
    for (let z = rz; z < Math.min(size - 1, rz + rh); z++) {
      for (let x = rx; x < Math.min(size - 1, rx + rw); x++) grid[z][x] = 0;
    }
  }
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[z][x] !== 1 || Math.random() > 0.3) continue; 
      const horizontal = grid[z][x-1] === 0 && grid[z][x+1] === 0;
      const vertical = grid[z-1][x] === 0 && grid[z+1][x] === 0;
      if (horizontal || vertical) grid[z][x] = 0;
    }
  }
  return grid;
}

export function buildScene(maze, enableFog) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);
  
  if (enableFog) {
    scene.fog = new THREE.Fog(0x050505, CONFIG.fogNear, CONFIG.fogFar);
  }

  scene.add(new THREE.HemisphereLight(0x666666, 0x222222, 1.0));
  const dirLight = new THREE.DirectionalLight(0x666655, .15);
  dirLight.position.set(5, 12, 4);
  scene.add(dirLight);

  const carpetCanvas = document.createElement("canvas");
  carpetCanvas.width = 128; carpetCanvas.height = 128;
  const carpetCtx = carpetCanvas.getContext("2d");
  carpetCtx.fillStyle = "#444030"; carpetCtx.fillRect(0,0,128,128);
  for(let i=0;i<1200;i++){
    const v = 50 + Math.floor(Math.random()*30);
    carpetCtx.fillStyle = `rgba(${v},${v-5},${v-15},${Math.random()*.22})`;
    carpetCtx.fillRect(Math.random()*128, Math.random()*128, 1+Math.random()*2, 1+Math.random()*2);
  }
  const carpetTexture = new THREE.CanvasTexture(carpetCanvas);
  carpetTexture.wrapS = carpetTexture.wrapT = THREE.RepeatWrapping;
  carpetTexture.repeat.set(maze.length/2, maze.length/2);

  const floorMat = new THREE.MeshStandardMaterial({map:carpetTexture, color:0xaaaaaa, roughness:1});
  const ceilingMat = new THREE.MeshStandardMaterial({color:0x555040, roughness:1});
  const wallMat = new THREE.MeshStandardMaterial({color:0x888060, roughness:1});

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

  // 天井ライト
  const pointLightsList = [];
  for(let z=1; z<maze.length-1; z+=2) for(let x=1; x<maze.length-1; x+=2){
    if(maze[z][x]===0){
      const p = cellWorld(x, z, maze.length);
      const isRedLight = Math.random() < 0.5;
      const lightColor = isRedLight ? 0xff1111 : 0xffedc5;
      const lampColor = isRedLight ? 0xff3333 : 0xfff5d4;

      const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, .08, .45), new THREE.MeshBasicMaterial({color: lampColor}));
      lampMesh.position.set(p.x, CONFIG.wallHeight-.08, p.z);
      scene.add(lampMesh);

      const baseInt = isRedLight ? 8.0 : 7.5;
      const pl = new THREE.PointLight(lightColor, baseInt, 20.0);
      pl.position.set(p.x, CONFIG.wallHeight - 1.2, p.z);
      scene.add(pl);

      pointLightsList.push({
        position: new THREE.Vector3(p.x, CONFIG.wallHeight - 1.2, p.z),
        light: pl,
        lampMesh: lampMesh,
        baseIntensity: baseInt
      });
    }
  }

  return { scene, pointLightsList };
}
