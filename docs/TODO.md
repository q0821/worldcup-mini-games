# TODO

## 人物擬真化（PK 模式，方案 A：GPT sprite sheet）

> 背景已是照片級夜景，Canvas 火柴人是目前最大違和源。
> 改用 gpt-image-2 生成「半寫實 3D 遊戲資產風」透明底 sprite，程式裁切替換。
> 風格 prompt 基調：semi-realistic stylized 3D game-asset style, flat even lighting,
> fully transparent background, no ground shadows（影子由程式的 drawContactShadow 畫）。

- [x] **門將背影 sprite**（2026-06-11 完成）
  - 4 姿勢單張 sheet（預備蹲姿／左撲／右撲／撲高球）→ `assets/sprites/keeper-back.webp`（95KB 含 alpha）
  - 連通元件自動裁切重組，座標寫死於 `pkScene.js` 的 `KEEPER_SPRITE.poses`
  - `drawKeeperBack()` 載入成功用 sprite、失敗退回向量版
- [ ] **電腦門將正面 sprite**（射手回合）
  - 姿勢：站姿微晃／左撲／右撲（金黃球衣，與玩家門將區分）
  - 取代 `drawKeeper()`；比例：站立頭頂約到橫楣 3/4（1.8m / 2.44m）
- [ ] **射手 sprite**（門將回合遠景，占比小、優先度最低）
  - 姿勢：待機／助跑兩幀／出腳（紅衣白褲、背號 10）
  - 取代 `drawStriker()`
- [ ] **整合注意事項**
  - 透明邊緣白邊：必要時預處理去邊或繪製時收縮 1px
  - 多姿勢一致性不佳就重 roll；撲救動作的腳朝向常需要 2 次內修正
  - 影子一律沿用 `drawContactShadow()`（見 ball-realism.md），sprite 本身不帶影子
  - 撲救動畫仍用程式位移／旋轉（sprite 只換外觀，不做逐幀動畫）
  - 行動裝置記憶體：單張 sheet 控制在 2048px 內、轉 WebP
