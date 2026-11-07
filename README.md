# MAZE ESCAPE - Backrooms Edition (v6)

## 概要
Three.jsを使用した、iPad対応の一人称視点ホラー迷路ゲームの第6次アップデート版です。

## 更新内容 (v6)
- **追跡者の視認能力を強化 (全方位・無条件)**:
  - 追跡者の視野角（FOV）を360度に変更しました。
  - 半径20m以内にプレイヤーが入り、かつ壁に遮られていなければ（目が合えば）、後ろを向いていても無条件で即座に追跡モード（Chase）に移行します。
- **挑発マーカーの当たり判定拡大**:
  - 挑発地点の当たり判定半径を1.5から2.5へ少し大きくし、敵がマーカー周辺に到達した際にパトロールへ戻りやすくなりました。
- **テクスチャ（床・天井・壁）の自由変更**:
  - `game.js`内に、壁・床・天井それぞれのテクスチャを自由に変更できる設定行（ダミー）を追加しました。

## ファイル構成と配置方法
以下の構成になるようにファイルを配置してください。
（ZIP内にはダミーファイルが含まれているため、本物のファイルで上書きしてください）

```
MAZE_ESCAPE_Backrooms/
├── index.html
├── style.css
├── game.js
├── README.md
└── assets/
    ├── chasers/
    │   └── inmu_king.png (本物の画像に差し替えてください)
    ├── sounds/
    │   ├── yarimasune.mp3 (ご自身で用意してください)
    │   └── 114514.mp3 (ご自身で用意してください)
    └── videos/
        └── inmuking.mp4  (本物の動画に差し替えてください)
```

## 壁・床・天井のテクスチャ（模様）を自由に変更する方法
1. お好きな画像（例: `wall.jpg`, `floor.jpg`, `ceiling.jpg`）を用意し、`assets/textures/` フォルダなどに保存します。
2. `game.js` ファイルをテキストエディタで開きます。
3. `buildWorld()` 関数の中に以下の行があります。
   ```javascript
   // loader.load('./assets/textures/wall.jpg', tex => { wallMat.map = tex; wallMat.needsUpdate = true; });
   // loader.load('./assets/textures/floor.jpg', tex => { tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(maze.length/2,maze.length/2); floorMat.map = tex; floorMat.needsUpdate = true; });
   // loader.load('./assets/textures/ceiling.jpg', tex => { tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(maze.length/2,maze.length/2); ceilingMat.map = tex; ceilingMat.needsUpdate = true; });
   ```
   適用したい箇所の行の先頭にある `//` （コメントアウト）を消去し、ファイルパスを合わせたうえで保存してください。それぞれ対応する部位がその画像に張り替わります。

## 起動方法
ローカルサーバー（VSCodeのLive Server拡張機能など）を使用して `index.html` を開いてください。
