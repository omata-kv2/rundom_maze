import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CONFIG = {
  mazeCells: 21,
  cellSize: 4,
  wallHeight: 6.8,
  playerRadius: 0.5,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  goalMinStraightDistance: 32,
  
  enemyWalkSpeed: 3.2, 
  enemyChaseSpeed: 5.8,
  
  enemyDetectDistance: 20, // 視認距離を20mに修正
  enemyFovDegrees: 360,    // 全方位に目を設定 (360度)
  enemyCatchDistance: 1.5,
  enemySpawnMinDistance: 48,
  enemyRepathInterval: 0.65,
  radarGreenDist: 24,
  radarYellowDist: 12,
  captureWaitTime: 27
};

const CHASER_IMAGES = [
  "./assets/chasers/inmu_king.png",
];

let scene, camera, renderer, clock;
let maze, player, enemy, goalMesh;
let running = false, ended = false, isFirstPlay = true;
let stamina = CONFIG.maxStamina;
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0,z:0};
let sprintHeld = false;
let enemyState = "patrol";
let enemyTarget = null, enemyNextPatrolCell = null;
let lastRegenTick = 0, lastUseTick = 0;
let messageTimer = 0;
let enemyRepathTimer = 0;
let spawnCell = {x:1, z:1};

let provokePos = null;
let provokeMesh = null;
// 挑発の当たり判定を少し大きくする
const PROVOKE_HIT_RADIUS = 2.5; // 元は1.5

const raycaster = new THREE.Raycaster();
const loader = new THREE.TextureLoader();

const $ = id => document.getElementById(id);
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const cellKey = (x,z)=>`${x},${z}`;
const worldToCell = v => Math.round(v / CONFIG.cellSize);

function generateMaze(size) {
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
  const roomCount = 7;
  for (let i = 0; i < roomCount; i++) {
    const rw = 2 + Math.floor(Math.random() * 3);
    const rh = 2 + Math.floor(Math.random() * 3);
    const rx = 2 + Math.floor(Math.random() * Math.max(1, size - rw - 3));
    const rz = 2 + Math.floor(Math.random() * Math.max(1, size - rh - 3));
    for (let z = rz; z < Math.min(size - 1, rz + rh); z++) {
      for (let x = rx; x < Math.min(size - 1, rx + rw); x++) grid[z][x] = 0;
    }
  }
  
  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[z][x] !== 1 || Math.random() > 0.35) continue; 
      const horizontal = grid[z][x-1] === 0 && grid[z][x+1] === 0;
      const vertical = grid[z-1][x] === 0 && grid[z+1][x] === 0;
      if (horizontal || vertical) grid[z][x] = 0;
    }
  }
  let secretCount = 0;
  for (let z = 2; z < size - 2 && secretCount < 4; z++) {
    for (let x = 2; x < size - 2 && secretCount < 4; x++) {
      if (grid[z][x] !== 1) continue;
      const horizontal = grid[z][x-1] === 0 && grid[z][x+1] === 0;
      const vertical = grid[z-1][x] === 0 && grid[z+1][x] === 0;
      if ((horizontal || vertical) && Math.random() < 0.22) {
        grid[z][x] = 0;
        secretCount++;
      }
    }
  }
  return grid;
}

function findPath(start, end) {
  const sx=clamp(Math.round(start.x),0,maze.length-1), sz=clamp(Math.round(start.z),0,maze.length-1);
  const ex=clamp(Math.round(end.x),0,maze.length-1), ez=clamp(Math.round(end.z),0,maze.length-1);
  const q=[[sx,sz]], prev=new Map([[cellKey(sx,sz),null]]);
  const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
  for(let qi=0;qi<q.length;qi++){
    const [x,z]=q[qi];
    if(x===ex&&z===ez) break;
    for(const [dx,dz] of dirs){
      const nx=x+dx,nz=z+dz,k=cellKey(nx,nz);
      if(nx<0||nz<0||nx>=maze.length||nz>=maze.length||maze[nz][nx]===1||prev.has(k)) continue;
      prev.set(k,cellKey(x,z));q.push([nx,nz]);
    }
  }
  const endKey=cellKey(ex,ez);
  if(!prev.has(endKey)) return [];
  const path=[];let k=endKey;
  while(k){const [x,z]=k.split(",").map(Number);path.push({x,z});k=prev.get(k);}
  return path.reverse();
}

function cellWorld(x,z){
  const offset=(maze.length-1)*CONFIG.cellSize/2;
  return new THREE.Vector3(x*CONFIG.cellSize-offset,0,z*CONFIG.cellSize-offset);
}
function worldCell(pos){
  const offset=(maze.length-1)*CONFIG.cellSize/2;
  return {x:Math.round((pos.x+offset)/CONFIG.cellSize),z:Math.round((pos.z+offset)/CONFIG.cellSize)};
}
function isWallAt(x,z){
  const c=worldCell(new THREE.Vector3(x,0,z));
  return c.x<0||c.z<0||c.x>=maze.length||c.z>=maze.length||maze[c.z][c.x]===1;
}
function canStand(x,z){
  const r=CONFIG.playerRadius;
  return !isWallAt(x-r,z-r)&&!isWallAt(x+r,z-r)&&!isWallAt(x-r,z+r)&&!isWallAt(x+r,z+r);
}

function buildWorld(){
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x77715a);
  scene.fog=new THREE.Fog(0x77715a,12,72);
  camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,180);
  camera.rotation.order="YXZ";
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  $("game").appendChild(renderer.domElement);
  clock=new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xd8cda7,0x29251b,0.9));
  const light=new THREE.DirectionalLight(0xffe6ad,.22);
  light.position.set(5,12,4);scene.add(light);

  maze=generateMaze(CONFIG.mazeCells);
  const carpetCanvas=document.createElement("canvas");
  carpetCanvas.width=256; carpetCanvas.height=256;
  const carpetCtx=carpetCanvas.getContext("2d");
  carpetCtx.fillStyle="#8b8058"; carpetCtx.fillRect(0,0,256,256);
  for(let i=0;i<5200;i++){
    const v=105+Math.floor(Math.random()*45);
    carpetCtx.fillStyle=`rgba(${v},${v-9},${v-30},${Math.random()*.22})`;
    carpetCtx.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*2,1+Math.random()*2);
  }
  const carpetTexture=new THREE.CanvasTexture(carpetCanvas);
  carpetTexture.wrapS=carpetTexture.wrapT=THREE.RepeatWrapping;
  carpetTexture.repeat.set(maze.length/2,maze.length/2);
  
  const floorMat=new THREE.MeshStandardMaterial({map:carpetTexture,color:0xffffff,roughness:1});
  const ceilingMat=new THREE.MeshStandardMaterial({color:0x9c936e,roughness:1});
  const wallMat=new THREE.MeshStandardMaterial({color:0xb9ad78,roughness:1});
  
  loader.load('./assets/textures/wall.jpeg', tex => { wallMat.map = tex; wallMat.needsUpdate = true; });
  loader.load('./assets/textures/floor.jpeg', tex => { tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(maze.length/2,maze.length/2); floorMat.map = tex; floorMat.needsUpdate = true; });
  loader.load('./assets/textures/ceiling.jpeg', tex => { tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(maze.length/2,maze.length/2); ceilingMat.map = tex; ceilingMat.needsUpdate = true; });

  const floor=new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.mazeCells*CONFIG.cellSize,CONFIG.mazeCells*CONFIG.cellSize),floorMat);
  floor.rotation.x=-Math.PI/2;floor.position.y=0;scene.add(floor);
  const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.mazeCells*CONFIG.cellSize,CONFIG.mazeCells*CONFIG.cellSize),ceilingMat);
  ceiling.rotation.x=Math.PI/2;ceiling.position.y=CONFIG.wallHeight;scene.add(ceiling);

  const wallGeo=new THREE.BoxGeometry(CONFIG.cellSize,CONFIG.wallHeight,CONFIG.cellSize);
  let wallCount = 0;
  for(let z=0;z<maze.length;z++) for(let x=0;x<maze.length;x++) if(maze[z][x]===1) wallCount++;
  
  const wallInstanced = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
  let wIdx = 0;
  const dummy = new THREE.Object3D();
  
  for(let z=0;z<maze.length;z++) for(let x=0;x<maze.length;x++){
    if(maze[z][x]===1){
      const p=cellWorld(x,z);
      dummy.position.set(p.x,CONFIG.wallHeight/2,p.z);
      dummy.updateMatrix();
      wallInstanced.setMatrixAt(wIdx++, dummy.matrix);
    }
  }
  scene.add(wallInstanced);

  for(let z=1;z<maze.length-1;z+=4) for(let x=1;x<maze.length-1;x+=4){
    if(maze[z][x]===0){
      const p=cellWorld(x,z);
      const lamp=new THREE.Mesh(new THREE.BoxGeometry(1.5,.08,.45),new THREE.MeshBasicMaterial({color:0xfff5d4}));
      lamp.position.set(p.x,CONFIG.wallHeight-.08,p.z);scene.add(lamp);
      const pl=new THREE.PointLight(0xffedc5,.45,11);pl.position.set(p.x,2.8,p.z);scene.add(pl);
    }
  }

  const open=[];
  for(let z=1;z<maze.length-1;z++)for(let x=1;x<maze.length-1;x++)if(maze[z][x]===0)open.push({x,z});
  const spawnPos=cellWorld(spawnCell.x,spawnCell.z);
  player={position:new THREE.Vector3(spawnPos.x,1.65,spawnPos.z)};
  camera.position.copy(player.position);

  const candidates=open.filter(c=>{
    const p=cellWorld(c.x,c.z);
    return Math.hypot(p.x-spawnPos.x,p.z-spawnPos.z)>=CONFIG.goalMinStraightDistance;
  });
  const goalCell=(candidates.length?candidates:open.filter(c=>c.x!==1||c.z!==1))[Math.floor(Math.random()*(candidates.length?candidates:open.filter(c=>c.x!==1||c.z!==1)).length)];
  const gp=cellWorld(goalCell.x,goalCell.z);
  goalMesh=new THREE.Group();goalMesh.position.set(gp.x,0,gp.z);
  const frameMat=new THREE.MeshStandardMaterial({color:0x4b4637,roughness:.85});
  const doorMat=new THREE.MeshStandardMaterial({color:0x6f755f,roughness:.7});
  const postGeo=new THREE.BoxGeometry(.18,3.0,.22);
  const leftPost=new THREE.Mesh(postGeo,frameMat);leftPost.position.set(-.78,1.5,0);goalMesh.add(leftPost);
  const rightPost=leftPost.clone();rightPost.position.x=.78;goalMesh.add(rightPost);
  const lintel=new THREE.Mesh(new THREE.BoxGeometry(1.72,.2,.24),frameMat);lintel.position.set(0,2.95,0);goalMesh.add(lintel);
  const door=new THREE.Mesh(new THREE.BoxGeometry(1.35,2.75,.12),doorMat);door.position.set(0,1.38,-.04);goalMesh.add(door);
  const signCanvas=document.createElement("canvas");signCanvas.width=256;signCanvas.height=96;
  const signCtx=signCanvas.getContext("2d");signCtx.fillStyle="#183c2a";signCtx.fillRect(0,0,256,96);
  signCtx.strokeStyle="#d7e8c9";signCtx.lineWidth=8;signCtx.strokeRect(5,5,246,86);
  signCtx.fillStyle="#f0f4df";signCtx.font="bold 54px Arial";signCtx.textAlign="center";signCtx.fillText("EXIT",128,67);
  const signTex=new THREE.CanvasTexture(signCanvas);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.38),new THREE.MeshBasicMaterial({map:signTex}));
  sign.position.set(0,2.52,.09);goalMesh.add(sign);
  const glow=new THREE.PointLight(0x8aff9d,1.1,8);glow.position.set(0,2.6,1);goalMesh.add(glow);
  scene.add(goalMesh);
  goalMesh.userData.cell=goalCell;

  const enemyCandidates=open.filter(c=>{
    const p=cellWorld(c.x,c.z);
    return Math.hypot(p.x-spawnPos.x,p.z-spawnPos.z)>=CONFIG.enemySpawnMinDistance &&
      Math.hypot(p.x-gp.x,p.z-gp.z)>16;
  });
  const enemyPool=enemyCandidates.length?enemyCandidates:open.filter(c=>Math.abs(c.x-spawnCell.x)+Math.abs(c.z-spawnCell.z)>8);
  const enemyCell=enemyPool[Math.floor(Math.random()*enemyPool.length)] || open[open.length-1];
  const ep=cellWorld(enemyCell.x,enemyCell.z);
  enemy=new THREE.Group();enemy.position.set(ep.x,0,ep.z);scene.add(enemy);
  const selected=CHASER_IMAGES[0];
  loader.load(selected,texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(2.15,2.15),mat);
    plane.position.y=1.08;enemy.add(plane);
  }, undefined, err => console.warn("Failed to load enemy image", err));
  enemy.userData.cell={...enemyCell};
  enemyState="patrol";enemyTarget=null;
  
  // スタート時にゴールの方角を向くように初期角度を設定
  const dx = goalMesh.position.x - spawnPos.x;
  const dz = goalMesh.position.z - spawnPos.z;
  yaw = Math.atan2(-dx, -dz);
  camera.rotation.set(0, yaw, 0);
}

function resetWorld(){
  const spawnPos = cellWorld(spawnCell.x, spawnCell.z);
  player.position.set(spawnPos.x, 1.65, spawnPos.z);
  camera.position.copy(player.position);
  
  if (provokeMesh) provokeMesh.visible = false;
  provokePos = null;
  
  const open=[];
  for(let z=1;z<maze.length-1;z++)for(let x=1;x<maze.length-1;x++)if(maze[z][x]===0)open.push({x,z});
  const enemyCandidates=open.filter(c=>{
    const p=cellWorld(c.x,c.z);
    return Math.hypot(p.x-spawnPos.x,p.z-spawnPos.z)>=CONFIG.enemySpawnMinDistance;
  });
  const enemyPool=enemyCandidates.length?enemyCandidates:open.filter(c=>Math.abs(c.x-spawnCell.x)+Math.abs(c.z-spawnCell.z)>8);
  const enemyCell=enemyPool[Math.floor(Math.random()*enemyPool.length)] || open[open.length-1];
  const ep=cellWorld(enemyCell.x,enemyCell.z);
  enemy.position.set(ep.x,0,ep.z);
  enemyState="patrol"; enemyTarget=null; enemyNextPatrolCell=null; enemyRepathTimer=0;
  
  const dx = goalMesh.position.x - spawnPos.x;
  const dz = goalMesh.position.z - spawnPos.z;
  yaw = Math.atan2(-dx, -dz);
  camera.rotation.set(0, yaw, 0);
}

function lineOfSight(from,to){
  const start=worldCell(from), end=worldCell(to);
  const a=start.x, b=start.z, c=end.x, d=end.z;
  let x=a,z=b,dx=Math.abs(c-a),dz=Math.abs(d-b),sx=a<c?1:-1,sz=b<d?1:-1,err=dx-dz;
  while(!(x===c&&z===d)){
    if(!(x===a&&z===b)&&maze[z]?.[x]===1)return false;
    const e2=2*err;
    if(e2>-dz){err-=dz;x+=sx;}
    if(e2<dx){err+=dx;z+=sz;}
    if(x<0||z<0||x>=maze.length||z>=maze.length)return false;
  }
  return true;
}

function canEnemySeePlayer(){
  const dx=player.position.x-enemy.position.x,dz=player.position.z-enemy.position.z;
  const dist=Math.hypot(dx,dz);
  if(dist>CONFIG.enemyDetectDistance)return false;
  
  // 今回の修正：敵は「全方位(360度)」に目を持ち、「プレイヤーと目が合う＝無条件」ではなく、
  // 「距離20m以内で壁に遮られていなければ視認する」仕様となりました。
  // FOVを360度にしているので、実質的に距離と壁の有無だけで判定します。
  return lineOfSight(enemy.position,player.position);
}

function pickPatrolTarget(){
  const open = [];
  for(let z=1;z<maze.length-1;z++)for(let x=1;x<maze.length-1;x++)if(maze[z][x]===0)open.push({x,z});
  const c=worldCell(enemy.position);
  const candidates = open.filter(p => {
    const dist = Math.abs(p.x - c.x) + Math.abs(p.z - c.z);
    return dist > 5 && dist < 20;
  });
  if(candidates.length) {
    enemyTarget = candidates[Math.floor(Math.random()*candidates.length)];
  } else {
    enemyTarget = open[Math.floor(Math.random()*open.length)];
  }
}

function provoke() {
  if (ended || !running) return;
  const se = $("se-provoke");
  se.currentTime = 0;
  se.volume = 1.0;
  se.play().catch(e=>console.warn("Provoke SE failed", e));

  if (!provokeMesh) {
    const markerGeo = new THREE.CircleGeometry(CONFIG.cellSize/1.5, 32);
    const markerMat = new THREE.MeshBasicMaterial({color: 0xff0000, transparent: true, opacity: 0.5});
    provokeMesh = new THREE.Mesh(markerGeo, markerMat);
    provokeMesh.rotation.x = -Math.PI / 2;
    scene.add(provokeMesh);
  }
  
  provokePos = {x: player.position.x, z: player.position.z};
  provokeMesh.position.set(provokePos.x, 0.01, provokePos.z);
  provokeMesh.visible = true;
  
  if(enemyState !== "chase") {
      enemyState = "provoked";
      enemyRepathTimer = 0;
  }
}

function moveEnemy(dt){
  let target;
  let speed = CONFIG.enemyWalkSpeed;

  // どんな状態であれ、20m以内で壁に遮られず視認（目が合う）したら"chase"を最優先する
  if (canEnemySeePlayer() && enemyState !== "chase") {
      enemyState = "chase";
      enemyRepathTimer = 0;
      enemyTarget = null;
      if (provokeMesh && provokeMesh.visible) {
          provokeMesh.visible = false;
          provokePos = null;
      }
  }

  if (enemyState === "provoked") {
    enemyRepathTimer -= dt;
    if (enemyRepathTimer <= 0) {
      enemyRepathTimer = CONFIG.enemyRepathInterval;
      if(provokePos) {
        const path = findPath(worldCell(enemy.position), worldCell(new THREE.Vector3(provokePos.x, 0, provokePos.z)));
        if (path.length > 1) enemyTarget = {x: path[1].x, z: path[1].z};
        else enemyTarget = worldCell(new THREE.Vector3(provokePos.x, 0, provokePos.z));
      }
    }
    speed = CONFIG.enemyChaseSpeed; 
    if (enemyTarget) target = cellWorld(enemyTarget.x, enemyTarget.z);

    // 挑発地点の当たり判定を PROVOKE_HIT_RADIUS (2.5) に拡大
    if (provokePos && Math.hypot(enemy.position.x - provokePos.x, enemy.position.z - provokePos.z) < PROVOKE_HIT_RADIUS) {
      enemyState = "patrol";
      provokeMesh.visible = false;
      provokePos = null;
      enemyTarget = null;
    }
  } else if (enemyState === "chase") {
    if(!lineOfSight(enemy.position,player.position)){
      enemyState="patrol"; enemyTarget=null; enemyNextPatrolCell=null;
    } else {
      speed = CONFIG.enemyChaseSpeed;
      enemyRepathTimer -= dt;
      if(enemyRepathTimer <= 0){
        enemyRepathTimer = CONFIG.enemyRepathInterval;
        const path=findPath(worldCell(enemy.position),worldCell(player.position));
        if(path.length>1) enemyTarget={x:path[1].x,z:path[1].z};
      }
      if(enemyTarget) target=cellWorld(enemyTarget.x,enemyTarget.z);
    }
  } else {
    speed = CONFIG.enemyWalkSpeed;
    if(!enemyTarget || Math.hypot(enemy.position.x-cellWorld(enemyTarget.x,enemyTarget.z).x,enemy.position.z-cellWorld(enemyTarget.x,enemyTarget.z).z)<1.5){
      pickPatrolTarget();
      enemyRepathTimer = 0; 
    }
    enemyRepathTimer -= dt;
    if(enemyRepathTimer <= 0){
      enemyRepathTimer = CONFIG.enemyRepathInterval;
      if(enemyTarget){
        const path=findPath(worldCell(enemy.position), enemyTarget);
        if(path.length>1) {
          enemyNextPatrolCell = {x:path[1].x, z:path[1].z};
        } else {
          enemyNextPatrolCell = null;
          enemyTarget = null;
        }
      }
    }
    if(enemyNextPatrolCell) target=cellWorld(enemyNextPatrolCell.x,enemyNextPatrolCell.z);
  }
  
  if (enemyState === "chase") $("status").textContent = "発見された！";
  else if (enemyState === "provoked") $("status").textContent = "挑発中";
  else $("status").textContent = "探索中";
  
  if(target){
    const dx=target.x-enemy.position.x,dz=target.z-enemy.position.z,len=Math.hypot(dx,dz);
    if(len>.08){
      enemy.position.x+=dx/len*speed*dt;enemy.position.z+=dz/len*speed*dt;
      enemy.rotation.y=Math.atan2(dx,dz);
    }
  }
  if(Math.hypot(player.position.x-enemy.position.x,player.position.z-enemy.position.z)<CONFIG.enemyCatchDistance)finish(false);
}

function updateCompasses() {
  if (ended) return;

  // 1. EXIT コンパス
  if (goalMesh) {
    const exitDx = goalMesh.position.x - player.position.x;
    const exitDz = goalMesh.position.z - player.position.z;
    const exitDist = Math.hypot(exitDx, exitDz);
    
    $("exit-distance").textContent = Math.floor(exitDist) + "m";

    // atan2の計算基準（数学的）と画面上の針の回転（0度が上）の補正
    // プレイヤーの視点(yaw)も考慮して相対的な角度を出す
    const exitAngle = Math.atan2(-exitDx, -exitDz) - yaw;
    const needleExit = $("exit-needle");
    needleExit.style.transform = `translateX(-50%) rotate(${-exitAngle}rad)`;
  }

  // 2. YAJU コンパス
  if (enemy) {
    const yajuDx = enemy.position.x - player.position.x;
    const yajuDz = enemy.position.z - player.position.z;
    const yajuDist = Math.hypot(yajuDx, yajuDz);
    
    // atan2による正しい方角とプレイヤー視点の補正
    const yajuAngle = Math.atan2(-yajuDx, -yajuDz) - yaw;
    
    const needleYaju = $("radar-needle");
    needleYaju.style.transform = `translateX(-50%) rotate(${-yajuAngle}rad)`;
    
    const radar = $("radar");
    if (yajuDist < CONFIG.radarYellowDist) {
      radar.style.borderColor = "red";
    } else if (yajuDist < CONFIG.radarGreenDist) {
      radar.style.borderColor = "yellow";
    } else {
      radar.style.borderColor = "green";
    }
  }
}

function updateBGM() {
  if (!enemy || ended || !running) {
    $("bgm-yarimasune").volume = 0;
    return;
  }
  const dist = Math.hypot(player.position.x - enemy.position.x, player.position.z - enemy.position.z);
  let vol = 0;
  if (dist <= 5) vol = 1.0;
  else if (dist <= 10) vol = 0.8;
  else if (dist <= 15) vol = 0.6;
  else if (dist <= 20) vol = 0.4;
  else if (dist <= 25) vol = 0.2;
  
  $("bgm-yarimasune").volume = vol;
}

function updateStamina(dt,isRunning,isMoving){
  if(isRunning&&isMoving&&stamina>0){
    stamina=Math.max(0,stamina-CONFIG.staminaUsePerSecond*dt);
  }else{
    stamina=Math.min(CONFIG.maxStamina,stamina+CONFIG.staminaRegenPerSecond*dt);
  }
  $("stamina-fill").style.width=`${stamina/CONFIG.maxStamina*100}%`;
  $("stamina-text").textContent=`${Math.ceil(stamina)} / ${CONFIG.maxStamina}`;
  $("stamina-fill").style.background=stamina<5?"#d66d62":"#82c78c";
}

function movePlayer(dt){
  let x=(keys.KeyD?1:0)-(keys.KeyA?1:0)+joystick.x;
  let z=(keys.KeyS?1:0)-(keys.KeyW?1:0)+joystick.z;
  const len=Math.hypot(x,z);if(len>1){x/=len;z/=len;}
  const isMoving=len>.08;
  const wantsRun=(keys.ShiftLeft||keys.ShiftRight||sprintHeld)&&isMoving;
  const isRunning=wantsRun&&stamina>0;
  updateStamina(dt,isRunning,isMoving);
  const speed=isRunning?CONFIG.runSpeed:CONFIG.walkSpeed;
  const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
  const right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const delta=forward.multiplyScalar(-z).add(right.multiplyScalar(x)).multiplyScalar(speed*dt);
  const nx=player.position.x+delta.x,nz=player.position.z+delta.z;
  if(canStand(nx,player.position.z))player.position.x=nx;
  if(canStand(player.position.x,nz))player.position.z=nz;
  camera.position.copy(player.position);
  camera.rotation.set(pitch,yaw,0);
}

function finish(win){
  if(ended)return;ended=true;running=false;
  
  $("bgm-yarimasune").volume = 0; 
  
  $("end-title").textContent=win?"ESCAPED":"CAUGHT";
  $("end-text").textContent=win?"非常口から脱出した。":"追跡者に捕まった。";
  if(!win){
    const video = $("capture-video");
    video.style.display = "block";
    video.currentTime = 0;
    
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(e => console.warn("Video play error:", e));
    }
    
    $("end-overlay").classList.remove("hidden");
    const restartBtn = $("restart-button");
    restartBtn.disabled = true;
    let timeLeft = CONFIG.captureWaitTime;
    restartBtn.textContent = `再挑戦 (${timeLeft}秒待機...)`;
    
    const timer = setInterval(() => {
      timeLeft--;
      if (timeLeft <= 0) {
        clearInterval(timer);
        restartBtn.disabled = false;
        restartBtn.textContent = "もう一度プレイ";
        video.style.display = "none";
      } else {
        restartBtn.textContent = `再挑戦 (${timeLeft}秒待機...)`;
      }
    }, 1000);
  }else{
    $("end-overlay").classList.remove("hidden");
  }
  if(document.pointerLockElement)document.exitPointerLock();
}

function showMessage(text){
  $("message").textContent=text;
  $("message").style.opacity="1";
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>$("message").style.opacity="0",2500);
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  if(running&&!ended){
    movePlayer(dt);moveEnemy(dt);
    if(enemy?.children[0]) enemy.children[0].lookAt(camera.position.x,enemy.children[0].getWorldPosition(new THREE.Vector3()).y,camera.position.z);
    goalMesh.rotation.y+=dt*.08;
    updateCompasses();
    updateBGM();
    if(Math.hypot(player.position.x-goalMesh.position.x,player.position.z-goalMesh.position.z)<1.35)finish(true);
  }
  if(renderer && scene && camera) renderer.render(scene,camera);
}

function unlockMedia() {
  const v = $("capture-video");
  if(v) {
      v.muted = true;
      const vp = v.play();
      if(vp !== undefined) vp.then(()=>{ v.pause(); v.currentTime=0; v.muted=false; }).catch(()=>{});
  }
  const bgm = $("bgm-yarimasune");
  if(bgm) {
      bgm.volume = 0;
      const bp = bgm.play();
      if(bp !== undefined) bp.catch(()=>{});
  }
  const se = $("se-provoke");
  if(se) {
      se.volume = 0;
      const sp = se.play();
      if(sp !== undefined) sp.then(()=>{ se.pause(); se.currentTime=0; se.volume=1.0; }).catch(()=>{});
  }
}

function startGame(){
  document.body.classList.add("game-active");
  $("overlay").classList.add("hidden");$("end-overlay").classList.add("hidden");
  
  if (isFirstPlay) {
    $("game").innerHTML="";
    buildWorld();
    isFirstPlay = false;
  } else {
    resetWorld();
  }

  stamina=CONFIG.maxStamina;pitch=0;ended=false;keys={};joystick={x:0,z:0};sprintHeld=false;
  if(clock) { clock.start(); }
  running=true;showMessage("ゴールを探せ。追跡者に注意。");
  if(matchMedia("(pointer:fine)").matches)renderer.domElement.requestPointerLock?.();
}

function handleStart(e) {
  e.preventDefault();
  if (running) return;
  unlockMedia();
  startGame();
}

$("start-button").addEventListener("pointerdown", handleStart);
$("restart-button").addEventListener("pointerdown", handleStart);

addEventListener("resize",()=>{
  if(!camera||!renderer)return;
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
});
addEventListener("keydown",e=>{
  keys[e.code]=true;
  if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();
  if(e.code === "KeyE") provoke();
});
addEventListener("keyup",e=>keys[e.code]=false);
addEventListener("mousemove",e=>{
  if(document.pointerLockElement&&running){yaw-=e.movementX*.0022;pitch=clamp(pitch-e.movementY*.0022,-1.35,1.35);}
});
rendererSafeTouch();
function rendererSafeTouch(){
  const joy=$("joystick"),stick=$("stick"),look=$("look-pad"),sprint=$("sprint-button"),provokeBtn=$("provoke-button");
  let joyId=null,lookId=null,lastX=0,lastY=0;
  joy.addEventListener("pointerdown",e=>{joyId=e.pointerId;joy.setPointerCapture(joyId);updateJoy(e);});
  joy.addEventListener("pointermove",e=>{if(e.pointerId===joyId)updateJoy(e);});
  const resetJoy=()=>{joyId=null;joystick={x:0,z:0};stick.style.transform="translate(0,0)";};
  joy.addEventListener("pointerup",resetJoy);joy.addEventListener("pointercancel",resetJoy);
  function updateJoy(e){
    const r=joy.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
    let dx=e.clientX-cx,dy=e.clientY-cy;const max=36,len=Math.hypot(dx,dy);
    if(len>max){dx=dx/len*max;dy=dy/len*max;}
    joystick.x=dx/max;joystick.z=dy/max;
    stick.style.transform=`translate(${dx}px,${dy}px)`;
  }
  look.addEventListener("pointerdown",e=>{lookId=e.pointerId;lastX=e.clientX;lastY=e.clientY;look.setPointerCapture(lookId);});
  look.addEventListener("pointermove",e=>{
    if(e.pointerId!==lookId)return;
    yaw-=(e.clientX-lastX)*.006;pitch=clamp(pitch-(e.clientY-lastY)*.006,-1.35,1.35);
    lastX=e.clientX;lastY=e.clientY;
  });
  const resetLook=()=>lookId=null;
  look.addEventListener("pointerup",resetLook);look.addEventListener("pointercancel",resetLook);
  
  sprint.addEventListener("pointerdown",e=>{e.preventDefault();sprintHeld=true;});
  sprint.addEventListener("pointerup",()=>sprintHeld=false);
  sprint.addEventListener("pointercancel",()=>sprintHeld=false);
  
  provokeBtn.addEventListener("pointerdown", e => {
      e.preventDefault();
      provoke();
  });
}
animate();
