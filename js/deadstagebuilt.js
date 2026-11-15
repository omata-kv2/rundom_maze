import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function buildDeadStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const enemiesGroup = new THREE.Group();
  scene.add(enemiesGroup);
  return { scene, enemiesGroup };
}
