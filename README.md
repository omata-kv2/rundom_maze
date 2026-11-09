# MAZE ESCAPE - Backrooms Edition (v9)

## 概要
Three.jsを使用した、iPad対応の一人称視点ホラー迷路ゲームの第9次アップデート版です。

## 更新内容 (v9)
- **ロケットの弾数制限（1発のみ）＆発射後消去**:
  - ロケットアイテム取得時、所持数は1発限定となります。
  - 発射すると即座にロケットを消費し、画面右下のロケット画像（HUD）および「発射」ボタンが画面上から消去されます。
- **10秒のクールダウン後、プレイヤー半径10〜15m以内に再生成**:
  - ロケット発射後、10秒間のクールダウンタイマーがカウント開始されます。
  - 10秒が経過すると、プレイヤーを中心とした半径 10〜15m の円形範囲（壁のない通路）内に新しい `rocket.png` が再生成されます。

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
