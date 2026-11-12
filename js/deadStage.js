import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function buildDeadStageScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020202);
  scene.add(new THREE.AmbientLight(0x444444, 1.0));
  return { scene };
}
