# YAJU ESCAPE v19 (高速ダイレクト再生・boom.png版)

## v19 での修正・変更内容
1. **`main.js` 内での動画要素ダイレクト生成 & 超高速呼び出し**:
   - `index.html` の静的タグ依存をなくし、捕獲時（CAUGHT）に `main.js` から直接 `document.createElement("video")` で要素を生成・再生[cite: 26, 29]。
   - iPad等のブラウザ環境で事前にDOM取得待ちや読み込み遅延が発生せず、捕まった瞬間に即時動画再生＆27秒間の全画面タッチブロックが発動[cite: 26, 29]。

2. **爆破テクスチャの統一 (`boom.png`)**:
   - `BOOM_IMAGE` の参照先を `boom.gif` から **`boom.png`** へ変更[cite: 26, 29]。
