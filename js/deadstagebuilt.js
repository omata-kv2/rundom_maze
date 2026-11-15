import * as THREE from "./libs/three.module.js";

export function buildDeadStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const enemiesGroup = new THREE.Group();
  scene.add(enemiesGroup);
  return { scene, enemiesGroup };
}
