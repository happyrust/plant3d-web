# MBD 长度尺寸三维标注呈现 · 实机验证（2026-09-12）

对应：ADR 0057（长度尺寸）、ADR 0058（标签 billboard，见下「标签 billboard」段）、PRD `docs/plans/2026-09-12-mbd-annotation-reference-style-prd.md`、效果图 `docs/design/mbd-annotation-mockup-2026-09-12/`。

## 环境

- plant3d-web dev `http://127.0.0.1:3101`（Vite HMR），隔离 gen-model `http://127.0.0.1:18084`（embedded-mem，`AvevaMarineSample`）。
- 真实 Chrome（Playwright `channel: 'chrome'`），视口 1920×1080、DPR 2；BRAN `24381_145018`（18 条 `linear_dim`：11 main / 7 atta，`cheight_mm=27`）。
- URL（只看长度尺寸，不选中管体）：

  ```text
  /?output_project=AvevaMarineSample&show_refno=24381_145018&show_refno_select=0
    &mbd_refno=24381_145018&mbd_kinds=linear_dim
    &gm_backend=http://127.0.0.1:18084&mbdBackend=http://127.0.0.1:18084
  ```

- 固定相机 = 效果图同一套 fit（`maxDim × 1.7`，`position ≈ (8.33, −11.36, 6.81)`，target 原点）；近景 = 阀门端簇 fit ×2.8。

## 结果（`viewport.getLayouts()` 逐条统计）

| 视角 | 记录 | 绘制 | 隐藏（原因） | 三维文字 | 实心箭头 | 文字外置 | 投影字高 px | 管轴→尺寸线 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 远景 | 18 | 11 | 7（atta 远景 6 / 短段 1：`173`） | 11 / 11 | 22 | 758.89 / 1340.05 / 567.89 / 900.51 | 12.2–13.9 | row 0 ≈ 241–298 mm，row 1 ≈ 426–543 mm（管表面 114 mm，`h` 由 13 px 下限决定） |
| 近景（阀门端） | 18 | 12 | 6（atta 远景 6） | 12 / 12 | 24 | 173 | 12.4–15.7 | row 0 ≈ 176–232 mm，row 1 ≈ 267–384 mm |
| `mbd_3d=0` | 18 | — | — | 0（全部回到平面呈现） | 0 | — | — | 求解器原位（114.3 / 146.7 mm） |

- 两次同相机运行统计逐字相同（远景 / 近景各跑 3 次）。
- 无 `pageerror`；控制台仅有与尺寸无关的 3 条 gen-model 400。
- 单测：`npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → 53 文件 / 288 通过；eslint 0；`npm run type-check` 新增 0（当日基线外唯一新增 `src/measurement/kernel/pickDerivation.test.ts` 为他人未提交文件）；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

## 截图

| 文件 | 说明 |
| --- | --- |
| `3d-far.png` | 远景：尺寸线离开管体、尺寸界线超出、实心箭头、数字在三维平面里沿线排布（`2652` / `1902.35` 竖排向上可读） |
| `3d-near-valve.png` | 阀门端近景：字高随 cheight 放大，`173` 文字外置 |
| `3d-near-valve-cluster.png` | 近景局部放大：粗体黑字 + 白色光晕压在管体上仍可读，小数点可见 |
| `flat-far-mbd_3d=0.png` | 同相机 `mbd_3d=0`：求解器原位平面呈现（对照 / 回退） |

## 标签 billboard（PRD T3，同日补验；ADR 0058）

同一 URL 去掉 `mbd_kinds`（全类别 77 图元），脚本 `pw-tag-verify.mjs` + `tag-stats.js`（`%TEMP%\plant3d-mbd-debug`），同一套 fit 与阀门端 zoom。
14 条 `leader_line` 各配进自己的 `label` 记录（先按 `<label id>:leader` 命名、再按引线起点 = 标签位置配对），记录数 77 → 63。

| 视角 | 标签 | 绘制（卡片 / 方框 / 药丸） | 隐藏（原因） | 换位 | 标签↔标签 / 标签↔尺寸数字相压 | 细节辅助隐藏 | 尺寸（绘 / 隐） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 远景（fit ×1.7） | 14 | 4（3 / 1 / 0）：头端 `X 1516 / Y 8157 / PE 13293`、顶部 `X 9201 / Y 9147 / PE 18747`、尾端 `接 Copy-of-RCS0014-1R43013新 / X 9770 / Y 10220 / PE 18665`、位号 `Copy-of-1RCS002VP` | 10（弯头药丸 9 `secondary-far` / 分支名 1 `detail-far`） | 0 | 0 / 0 | 31（坡度 7 + skew 文字 3 + 辅助线 21） | 11 / 7（不变） |
| 阀门端中景（×2.8） | 14 | 4（3 / 1 / 0） | 10 | 1（`X 9201` 让开 `2640.89`，取第 3 个候选位） | 0 / 0 | 31 | 12 / 6 |
| 阀门端近景（×1.2） | 14 | 6（3 / 1 / 2）：药丸 `PE +18657`、`90° / PE +18665`（角度行在投影字高 ≥ 18 px 时才出现） | 8（7 `secondary-far` / 分支名 `detail-far`） | 2 | 0 / 0 | 25（`slope 0.4%` 等 6 条已显示） | 12 / 6（`402` 为 `overlap`） |

- 每个绘出的标签都带引线；填充多边形数 = 卡片体 + 卡片圆点 + 方框体（远景 7、近景 9）。
- 锚点在视口外的标签（中景 `X 1516`、近景 `PE +18657`）整体落在视口外，是预期行为（候选位先按「整块在屏内」排序，全都不在时保持首选位）。
- 远景 / 中景各重复 2 次统计逐字相同；无 `pageerror`。
- 单测 `npx vitest run src/dimension src/composables/useMbdExternalSync.test.ts` → **54 文件 / 299 通过**（新增 `tagBillboard.test.ts` 7，mapper +3，painter +1，panel 文案 +1）；eslint 16 个相关文件 0；`npm run type-check` 基线外唯一新增仍是他人未提交的 `src/measurement/kernel/pickDerivation.test.ts`；`e2e/dimension-mbd-v2-fixture.spec.ts` 2/2。

| 文件 | 说明 |
| --- | --- |
| `tags-far.png` | 远景全类别：三张坐标卡片 + 位号方框，引线到管端并带圆点；弯头药丸、坡度 / skew 辅助按 LOD 隐去 |
| `tags-near-valve.png` | 阀门端中景：`X 9201` 卡片让开 `2640.89` 换到第 3 个候选位 |
| `tags-close-valve.png` | 阀门端近景：弯头药丸 `90° / PE +18665` 出现，`slope 0.4%` 等细节辅助显示 |

## 已知未做

- 标签体只避让尺寸数字与其它标签，不避让管件几何（近景尾端卡片压在阀体上）；卡片与三维尺寸线相交时不换位。
- 分支名药丸（`detail` 级）在本样本三个视角都没到显示阈值；视口右上角的坐标 gizmo 是独立覆盖层，标签不知道它。
- `surfaceM` 取本分支尺寸界线的下四分位（= 求解器最内行 `od`）；本样本 DTX 管体视半径略大于该值，尺寸界线起点略在管体轮廓内。
- SVG 导出把三维文字近似为按投影字高 / 基线角旋转的平面字形（无透视缩短）；实心箭头在 SVG 中仍为三条描边（与用户尺寸一致）。
