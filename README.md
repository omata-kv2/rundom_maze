# MAZE ESCAPE - Backrooms Edition (v7)

## 概要
Three.jsを使用した、iPad対応の一人称視点ホラー迷路ゲームの第7次アップデート版です。

## 更新内容 (v7)
- **クリア時の新しいステージ作成機能**:
  - 脱出成功（クリア）時のみ、「再挑戦」ボタンの上に「新しいステージを作成」ボタンが表示されるようになりました。
  - このボタンを押すと迷路やスタート地点・ゴール・敵の位置が完全に再生成された新ステージが開始されます。
- **捕獲時（CAUGHT）のmp4再生中の操作・タップ無効化**:
  - `style.css` の `#capture-video` の `pointer-events` を `none` に変更しました。
  - これにより、動画再生中に画面をタップしても動画への操作が遮断され、再生が止まったり途切れたりしなくなりました。

## ファイル構成
```
MAZE_ESCAPE_Backrooms/
├── index.html
├── style.css
├── game.js
├── README.md
└── assets/
    ├── chasers/
    │   └── inmu_king.png
    ├── sounds/
    │   ├── yarimasune.mp3
    │   └── 114514.mp3
    └── videos/
        └── inmuking.mp4
```
