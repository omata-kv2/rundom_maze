import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// deadstage: 壁・床・天井・ライトのない2×2セルの空間、静的定義でメモリ軽量化
export function buildDeadStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  
  // イベント開始時、4体の追跡者が3秒かけて端から中央へ接近する用コンテナ
  const enemiesGroup = new THREE.Group();
  scene.add(enemiesGroup);

  return { scene, enemiesGroup };
}
