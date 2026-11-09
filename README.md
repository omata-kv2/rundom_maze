# MAZE ESCAPE - Performance Optimized Edition (v11)

## 概要
Three.jsを使用したホラー迷路ゲームのパフォーマンスタスク徹底最適化版です。

## 適用された徹底最適化設定
1. **徹底的なオクルージョン & Frustum カリング**
   - 視界外（Frustum外）にあるオブジェクト、ゴール、ロケット、ライト、敵を自動で計算し非非表示化・カリング処理。
2. **解像度スケール（レンダリング解像度）の低減**
   - `CONFIG.renderScale: 0.75` による高負荷軽減と描画スケールダウン。
   - `setPixelRatio` の制限およびアンチエイリアス無効化・シャドウ非活性化。
3. **徹底的なLOD (Level of Detail) & 描画距離制限**
   - 描画限界距離（`drawDistance: 36m`）を設定し、描画外の光源・オブジェクトを無効化。
   - ポイントライトの有効距離（`lightDrawDistance: 20m`）制限と動的な光・点灯無効化。
   - 弾丸やマーカーなど動的オブジェクトの幾何ポリゴン数削減。
4. **テクスチャ解像度制限 (最大 512×512 以下)**
   - 壁・床・天井・エネミー画像などの読み込み時に自動ダウンサンプリング処理を実施（最大 512×512 以下に収まるよう自動調整）。

## ファイル構成
```
MAZE_ESCAPE_Backrooms/
├── index.html
├── style.css
├── game.js
├── README.md
└── assets/
    ├── chasers/
    │   ├── inmu_king.png
    │   └── boom.gif
    ├── items/
    │   └── rocket.png
    ├── sounds/
    │   ├── yarimasune.mp3
    │   └── 114514.mp3
    └── videos/
        └── inmuking.mp4
```
