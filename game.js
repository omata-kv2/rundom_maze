import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const CONFIG = {
  mazeCells: 21,          // 迷路の一辺（奇数推奨）
  cellSize: 4,             // 1マスの幅（仮設定）
  wallHeight: 3.4,
  playerRadius: 0.34,
  walkSpeed: 3.2,
  runSpeed: 6.0,
  maxStamina: 20,
  staminaUsePerSecond: 1,
  staminaRegenPerSecond: 1,
  goalMinStraightDistance: 32, // スポーンからの直線距離（ワールド単位）
  enemyWalkSpeed: 2.0,
  enemyChaseSpeed: 3.0,
  enemyDetectDistance: 22,
  enemyFovDegrees: 105,
  enemyCatchDistance: 1.25
};

const CHASER_IMAGES = [
  "./assets/chasers/dddn_scare.png",
  "./assets/chasers/inmu_king.png",
  "./assets/chasers/nazi_enemy.png"
];

let scene, camera, renderer, clock;
let maze, player, enemy, goalMesh;
let running = false, ended = false;
let stamina = CONFIG.maxStamina;
let yaw = 0, pitch = 0;
let keys = {};
let joystick = {x:0,z:0};
let sprintHeld = false;
let enemyState = "patrol";
let enemyTarget = null;
let lastRegenTick = 0, lastUseTick = 0;
let messageTimer = 0;
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
  return grid;
}

function findPath(start, end) {
  const sx=clamp(Math.round(start.x),0,maze.length-1), sz=clamp(Math.round(start.z),0,maze.length-1);
  const ex=clamp(Math.round(end.x),0,maze.length-1), ez=clamp(Math.round(end.z),0,maze.length-1);
  const q=[[sx,sz]], prev=new Map([[cellKey(sx,sz),null]]);
  const dirs=[[0,-1],[1,0],[0,1],[-1,0]];
  while(q.length){
    const [x,z]=q.shift();
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
  scene.background=new THREE.Color(0x777568);
  scene.fog=new THREE.Fog(0x777568,10,58);
  camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,180);
  camera.rotation.order="YXZ";
  renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));
  renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;
  $("game").appendChild(renderer.domElement);
  clock=new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xe5e0c8,0x37352b,1.45));
  const light=new THREE.DirectionalLight(0xfff2ce,.55);
  light.position.set(5,12,4);scene.add(light);

  maze=generateMaze(CONFIG.mazeCells);
  const floorMat=new THREE.MeshStandardMaterial({color:0x9c9679,roughness:1});
  const wallMat=new THREE.MeshStandardMaterial({color:0xb7ae83,roughness:1});
  const ceilingMat=new THREE.MeshStandardMaterial({color:0xaaa58d,roughness:1});
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.mazeCells*CONFIG.cellSize,CONFIG.mazeCells*CONFIG.cellSize),floorMat);
  floor.rotation.x=-Math.PI/2;floor.position.y=0;scene.add(floor);
  const ceiling=new THREE.Mesh(new THREE.PlaneGeometry(CONFIG.mazeCells*CONFIG.cellSize,CONFIG.mazeCells*CONFIG.cellSize),ceilingMat);
  ceiling.rotation.x=Math.PI/2;ceiling.position.y=CONFIG.wallHeight;scene.add(ceiling);

  const wallGeo=new THREE.BoxGeometry(CONFIG.cellSize,CONFIG.wallHeight,CONFIG.cellSize);
  for(let z=0;z<maze.length;z++) for(let x=0;x<maze.length;x++){
    if(maze[z][x]===1){
      const wall=new THREE.Mesh(wallGeo,wallMat);
      const p=cellWorld(x,z);wall.position.set(p.x,CONFIG.wallHeight/2,p.z);scene.add(wall);
    }
  }
  // 簡易蛍光灯
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
  const spawn={x:1,z:1};
  const spawnPos=cellWorld(spawn.x,spawn.z);
  player={position:new THREE.Vector3(spawnPos.x,1.65,spawnPos.z)};
  camera.position.copy(player.position);

  const candidates=open.filter(c=>{
    const p=cellWorld(c.x,c.z);
    return Math.hypot(p.x-spawnPos.x,p.z-spawnPos.z)>=CONFIG.goalMinStraightDistance;
  });
  const goalCell=(candidates.length?candidates:open.filter(c=>c.x!==1||c.z!==1))[Math.floor(Math.random()*(candidates.length?candidates:open.filter(c=>c.x!==1||c.z!==1)).length)];
  const gp=cellWorld(goalCell.x,goalCell.z);
  goalMesh=new THREE.Group();goalMesh.position.set(gp.x,0,gp.z);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.8,.12,10,32),new THREE.MeshBasicMaterial({color:0x7dffad}));
  ring.position.y=1.15;goalMesh.add(ring);
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.2,8),new THREE.MeshBasicMaterial({color:0x70ff9b,transparent:true,opacity:.35}));
  beam.position.y=1.1;goalMesh.add(beam);scene.add(goalMesh);
  goalMesh.userData.cell=goalCell;

  const enemyCell=open.filter(c=>Math.abs(c.x-spawn.x)+Math.abs(c.z-spawn.z)>7)[Math.floor(Math.random()*Math.max(1,open.filter(c=>Math.abs(c.x-spawn.x)+Math.abs(c.z-spawn.z)>7).length))] || open[open.length-1];
  const ep=cellWorld(enemyCell.x,enemyCell.z);
  enemy=new THREE.Group();enemy.position.set(ep.x,0,ep.z);scene.add(enemy);
  const selected=CHASER_IMAGES[Math.floor(Math.random()*CHASER_IMAGES.length)];
  loader.load(selected,texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide});
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(2.15,2.15),mat);
    plane.position.y=1.08;enemy.add(plane);
  });
  enemy.userData.cell={...enemyCell};
  enemyState="patrol";enemyTarget=null;
}

function lineOfSight(from,to){
  const start=worldCell(from), end=worldCell(to);
  const a=start.x, b=start.z;
  const c=end.x, d=end.z;
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
  const forward=new THREE.Vector3(Math.sin(enemy.rotation.y),0,Math.cos(enemy.rotation.y));
  const toward=new THREE.Vector3(dx,0,dz).normalize();
  const angle=THREE.MathUtils.radToDeg(Math.acos(clamp(forward.dot(toward),-1,1)));
  return angle<CONFIG.enemyFovDegrees/2 && lineOfSight(enemy.position,player.position);
}
function pickPatrolTarget(){
  const c=worldCell(enemy.position);
  const options=[[0,-1],[1,0],[0,1],[-1,0]].map(([dx,dz])=>({x:c.x+dx,z:c.z+dz}))
    .filter(p=>maze[p.z]?.[p.x]===0);
  if(options.length)enemyTarget=options[Math.floor(Math.random()*options.length)];
}
function moveEnemy(dt){
  if(canEnemySeePlayer())enemyState="chase";
  else if(enemyState==="chase" && !lineOfSight(enemy.position,player.position)) enemyState="patrol";
  $("status").textContent=enemyState==="chase"?"発見された！":"探索中";
  let target;
  if(enemyState==="chase"){
    const path=findPath(worldCell(enemy.position),worldCell(player.position));
    if(path.length>1)target=cellWorld(path[1].x,path[1].z);
  }else{
    if(!enemyTarget||Math.hypot(enemy.position.x-cellWorld(enemyTarget.x,enemyTarget.z).x,enemy.position.z-cellWorld(enemyTarget.x,enemyTarget.z).z)<.35)pickPatrolTarget();
    if(enemyTarget)target=cellWorld(enemyTarget.x,enemyTarget.z);
  }
  if(target){
    const dx=target.x-enemy.position.x,dz=target.z-enemy.position.z,len=Math.hypot(dx,dz);
    if(len>.08){
      const speed=enemyState==="chase"?CONFIG.enemyChaseSpeed:CONFIG.enemyWalkSpeed;
      enemy.position.x+=dx/len*speed*dt;enemy.position.z+=dz/len*speed*dt;
      enemy.rotation.y=Math.atan2(dx,dz);
    }
  }
  enemy.lookAt(player.position.x,1.1,player.position.z);
  if(Math.hypot(player.position.x-enemy.position.x,player.position.z-enemy.position.z)<CONFIG.enemyCatchDistance)finish(false);
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
  $("end-title").textContent=win?"ESCAPED":"CAUGHT";
  $("end-text").textContent=win?"ゴールに到達した。迷路から脱出した。":"追跡者に捕まった。";
  $("end-overlay").classList.remove("hidden");
  if(document.pointerLockElement)document.exitPointerLock();
}
function showMessage(text){
  $("message").textContent=text;
  $("message").style.opacity="1";
  clearTimeout(messageTimer);
  messageTimer=setTimeout(()=>$("message").style.opacity=".7",2500);
}
function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  if(running&&!ended){
    movePlayer(dt);moveEnemy(dt);
    goalMesh.rotation.y+=dt*.7;
    if(Math.hypot(player.position.x-goalMesh.position.x,player.position.z-goalMesh.position.z)<1.25)finish(true);
  }
  if(renderer && scene && camera) renderer.render(scene,camera);
}
function startGame(){
  $("overlay").classList.add("hidden");$("end-overlay").classList.add("hidden");
  $("game").innerHTML="";
  stamina=CONFIG.maxStamina;yaw=0;pitch=0;ended=false;keys={};joystick={x:0,z:0};sprintHeld=false;
  buildWorld();clock.start();running=true;showMessage("ゴールを探せ。追跡者に注意。");
  if(matchMedia("(pointer:fine)").matches)renderer.domElement.requestPointerLock?.();
}
$("start-button").addEventListener("click",startGame);
$("restart-button").addEventListener("click",startGame);
addEventListener("resize",()=>{
  if(!camera||!renderer)return;
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);
});
addEventListener("keydown",e=>{keys[e.code]=true;if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code))e.preventDefault();});
addEventListener("keyup",e=>keys[e.code]=false);
addEventListener("mousemove",e=>{
  if(document.pointerLockElement&&running){yaw-=e.movementX*.0022;pitch=clamp(pitch-e.movementY*.0022,-1.35,1.35);}
});
rendererSafeTouch();
function rendererSafeTouch(){
  const joy=$("joystick"),stick=$("stick"),look=$("look-pad"),sprint=$("sprint-button");
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
}
animate();
