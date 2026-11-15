# YAJU ESCAPE v23.9 (オフライン対応＆演出強化版)

## 主な実装・変更内容
1. **Three.jsのローカルオフライン化**:
   - `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js` を取得し、`js/libs/three.module.js` として同梱。すべてのモジュールインポートをローカルパス `./libs/three.module.js` に切り替え、完全なオフライン環境での動作を実現しました。
2. **Dead Stage 演出の強化**:
   - **BGM連続再生**: dead stage移行時から `inmuking.mp4` が流れるまでの間、プレイヤーに `yarimasune.mp3` をループ連続再生します。
   - **時間延長**: 追跡者が四方からプレイヤーに近づいていく演出時間を3秒から **6秒** に引き延ばしました。
   - **うずまき移動（60rpm）**: 直線移動ではなく、プレイヤーを中心に回転（60rpm ≒ 1回転/秒）しながら徐々にプレイヤーに収束して近づく軌道に変更しました。
