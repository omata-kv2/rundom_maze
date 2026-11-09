# MAZE ESCAPE - Horror Enhanced Edition (v13)

## 概要
Three.jsを使用した一人称視点ホラー迷路ゲームの第13次アップデート版です。

## 追加・更新内容 (v13)
- **霧のカラー変更（ホラー化）**:
  - 視界を覆う霧（Fog）および背景カラーを「白・黄色系」からホラー感のある**暗い黒（#050505）**に変更。
- **マップ上ロケットの白い発光**:
  - マップ上に配置されているロケットアイテムから周囲を照らす**白い点光源（PointLight）**を照射。
  - 描画距離（`drawDistance` & `lightDrawDistance`）のカリング制御を厳格に適用し、遠くの光は自動減衰・消灯。
- **スタート時のロケット生成数変動（0〜3個）＆画面下通知**:
  - ステージ開始時にマップ上に配置されるロケット数が **0〜3個** のランダム変動になりました。
  - 生成場所は被らないよう均等配置アルゴリズムを適用。
  - スタート時に画面下中央に配置個数を知らせるメッセージを表示（0個の場合は警告表示）。
- **天井ライトの 50% 赤色化**:
  - ステージ生成時、天井にあるライトが **50% の確率で赤い恐怖のライト** に変化。

## 描画距離の変更方法
`game.js` の 3 行目付近にある `CONFIG` オブジェクト内の数値をお好みに応じて変更してください。

```javascript
const CONFIG = {
  // ...
  drawDistance: 36.0,        // 描画限界距離（視界の奥に見える限界の距離[m]）
  lightDrawDistance: 20.0,   // ライト（照明・ロケットの発光）が点灯する限界距離[m]
  fogNear: 4.0,              // 濃い霧が出始める距離[m]
  fogFar: 36.0               // 完全に見えなくなる霧の最深距離[m]
};
```

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
