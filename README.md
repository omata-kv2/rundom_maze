# MAZE ESCAPE - Backrooms Edition (v12)

## 概要
Three.jsを使用した、iPad・PC対応の一人称視点ホラー迷路ゲームの第12次アップデート版です。

## 更新内容 (v12)
- **効果音（SE）の拡充**:
  - 爆破判定時（ロケット命中時）: `boom.mp3` 再生
  - 撃破判定時（爆破演出終了・消滅時）: `yaju_bark.mp3` 再生
  - ゲーム開始時（初回・新ステージ生成時）: `start.mp3` 再生
  - 再挑戦時: `restart.mp3` 再生
  - ステージクリア時（ゴール到達時）: `clear.mp3` 再生
- **ランダム追加追跡者（+0〜4体）**:
  - ステージ生成ごとに 0〜4 体の追加追跡者をランダム生成（合計1〜5体）。
  - 追跡者同士の生成・巡回位置が被らないよう均等配置アルゴリズムを適用。
  - 複数の追跡者がいる場合、少なくとも1体はプレイヤーのスポーン地点へ向かって巡回。
- **マルチコンパス針（色分け表示）**:
  - YAJUレーダー（コンパス）に、生成された追跡者の数と同数の針を動的配置。
  - 各針は異なるカラー（赤、ピンク、シアン、黄色、オレンジなど）で個別の敵を正確に指し示します。
- **ロケット所持弾数を 2発 に増加**:
  - ロケットアイテム取得時の最大所持数を 2発 に変更。

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
    │   ├── 114514.mp3
    │   ├── boom.mp3
    │   ├── yaju_bark.mp3
    │   ├── start.mp3
    │   ├── restart.mp3
    │   └── clear.mp3
    └── videos/
        └── inmuking.mp4
```
