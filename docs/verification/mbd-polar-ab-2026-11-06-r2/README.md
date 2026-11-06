# MBD 极坐标放置 label · 真实载荷 A/B 复测（T3.6a + T3.6b，2026-11-06 第二轮）

上午那轮（`../mbd-polar-ab-2026-11-06/README.md`）是空转：8022 的后端二进制早于 plant-mbd 的契约补字段提交，label 没有 `isoline_idx`、`meta` 没有 `isolines`，`mbd_polar=1` 一条记录都没挂上。本轮用含 `cb046f7` 的后端重测。

**结论：不建议把 `mbd_polar` 转默认（D5）。** 非有限值为 0、性能不退化，但标签可读性明显变差：默认 3D 模式下 `24381_145018` 远景标签重叠从 2 对涨到 39 对；`24383_91813` 的 2 条 label 在三档都全部降级回原位，只是丢了卡片样式。

**同日已修正**：polar 改为只在 `mbd_3d=0` 下生效，三维呈现下开 `mbd_polar=1` 与默认逐字段相同、卡片保留（见文末「修正」一节）。

## 环境

| 项 | 值 |
| --- | --- |
| 前端 | `plant3d-web` HEAD `bbd224bc`（含 `9eafa763` T3.6a、`6417dbd6` T3.6b），dev server `127.0.0.1:3101` |
| 几何后端 | `127.0.0.1:8022`（共享常驻实例，rocksdb 档，未改动） |
| MBD 后端 | `127.0.0.1:8023`：gen-model worktree `D:\work\plant-code\old\gen-model-mbd-polar`（`refactor` @ `98af94cb5`，detached），`vendor/plant-mbd` @ `cb046f7`；`cargo build --bin aios-database`（dev profile，冷编 4 分 45 秒）；`AIOS_STORE_MODE=mem`（不拿实例锁、不写 8009）；worktree 的 `DbOption.toml` 只改 `http_api_addr = "127.0.0.1:8023"`、`startup_autorun = false` |
| 分流 | 页面参数 `gm_backend=http://127.0.0.1:8022&mbdBackend=http://127.0.0.1:8023`：几何走 8022，MBD 走 8023 |
| 窗口 | 1920×1080，canvas 1220×778 CSS px，`playwright.novideo.config.ts`，单 worker |

## 载荷核对（8022 vs 8023）

| BRAN | 图元数 / kind 分布 | `meta.coverage` | `meta.isolines` | label 带 `isoline_idx` | 可挂 polar 的 label |
| --- | --- | --- | --- | --- | --- |
| `24381_145018` | 77，两边逐 kind 相同 | 8022 无 / 8023 8 种 | 0 / 11 | 0 / 13 | 0 / **12** |
| `24383_91813` | 20，两边逐 kind 相同 | 8022 无 / 8023 8 种 | 0 / 1 | 0 / 2 | 0 / **2** |

8023 只多字段、不改图元，与 `cb046f7` 提交说明一致。

## 方法

临时 Playwright 脚本（跑完已删除）对每个 BRAN × 四种模式（`off` / `polar=mbd_polar=1` / `flat=mbd_3d=0` / `flat-polar`）各开一次页面，相机取景与 `e2e/dimension-camera-baseline.spec.ts` 相同（far = 自动 fit，mid ×0.4，near ×0.2），每档记录：

- 挂上 `polar` / `polarObstacle` 的记录数；`getLayouts()` 里 `primitives` / `scenePrimitives` / `labelBounds` / `derived` 的非有限数；`viewport.getPolarDiagnostics()`；
- 重叠对数：已绘制、未被 LOD 隐藏的布局两两比 `labelBounds`，交叠宽高都 > 1 px 记一对（AABB 口径，旋转文字会偏多，只作同口径横比）；
- 截图与原始数据：`diag/<模式>/<BRAN>/{far,mid,near}.png`、`diag.json`。

性能：`off` / `polar` 两种模式在 far 档按 `docs/verification/mbd-perf-baseline-2026-10-29/README.md` 的绕轨脚本跑，**每步 `flushProjection()` 强制全量布局**（每帧都真算一次 polar），热身 30 帧后 120 帧 × 3 次，读 `window.__dimensionFrameStats.summary()`。

## 结果

### 触发与健壮性

| BRAN | 挂 polar | 挂 polarObstacle | 非有限值 | pageerror | 静态降级 far / mid / near | 绕轨期间单帧降级最大值 |
| --- | --- | --- | --- | --- | --- | --- |
| `24381_145018` | 12 | 18 | 0（四模式三档） | 0 | 2 / 0 / 7（共 12） | **12**（某些角度全部降级） |
| `24383_91813` | 2 | 1 | 0 | 0 | **2 / 2 / 2**（共 2） | 2（始终全部降级） |

### 重叠对数（far / mid / near）

| BRAN | off | polar | flat | flat-polar |
| --- | --- | --- | --- | --- |
| `24381_145018` | 2 / 3 / 1 | **39 / 20 / 3**（其中涉及 polar 记录 37 / 17 / 2） | 71 / 21 / 5 | 93 / 33 / 9 |
| `24383_91813` | 23 / 16 / 15 | 27 / 19 / 18 | 27 / 19 / 18 | 27 / 19 / 18 |

`24381_145018` polar far 的重叠对几乎都是「极坐标位号卡 `tag:elbo:*` × 同直段长度数值 `main:*`」。

### 标签位移（polar 记录，屏幕 px）

- `off → polar`：远景 57–218、中景 71–234、近景最大 555。billboard 卡片被剥成平面文字，从避让后的卡片位置回到管子旁边。
- `flat → flat-polar`：远景 0–17、中景 14–54；包围盒从约 53×23 变成约 50×51，文字被旋转。
- `24383_91813` 两种对照下位移都是 0（全部降级回求解器原位）；`off → polar` 的 123 px 来自卡片 → 平面文字。

### 性能（far 档，三次 P95 的中位数，单位 ms）

| BRAN | 模式 | layoutMs | paintMs | frameMs |
| --- | --- | --- | --- | --- |
| `24381_145018` | off | 3.70 | 21.10 | 23.50 |
| `24381_145018` | polar | 3.50 | 22.10 | 24.30 |
| `24383_91813` | off | 2.50 | 19.90 | 21.40 |
| `24383_91813` | polar | 1.90 | 20.80 | 21.90 |

paint 多约 1 ms（+4.5～4.7 %），在 D5 的 10 % 线内；layout 在噪声范围内。

### 视觉

- `diag/off/24381_145018/far.png` vs `diag/polar/24381_145018/far.png`：默认模式下位号卡沿引线散开、互不遮挡；开 polar 后 12 张卡片变成平面文字挤在管子上，多处旋转、互相压住，基本读不出来。
- `diag/flat/24381_145018/mid.png` vs `diag/flat-polar/24381_145018/mid.png`：位移不大，但多行位号（`X 9201 / Y 9147 / PE 18747`、`Copy-of-…`）整体旋转后行仍按屏幕竖直堆叠，几行错位叠在一起；右上转角簇没有变清楚。

## 根因（对照代码）

1. **屏幕校验看不到别的标签。** `layoutViewport.ts:258` 的 `polarOccupancy` 只装本帧其它 polar 候选；同管 `linear_dim` 只以锚点换算成极坐标障碍（`seedSiblingObstacles`），其屏幕文字框（`dimension3d` 的 `declutter.quad`）不进占用网格，所以 polar 选位照样压在数值文字上。
2. **摆完之后没有任何一步解冲突。** `polarReplacesTag` 剥掉 `tag` 后，记录不再进 billboard 避让轮；又因 `layoutAuthority = 'solver'`（pinned），`resolveLabelCollisions` 只占位不移动。
3. **文字被旋转。** `resolvePolarAnchor` 把 `labelAlong` 换成 `guard.chosen.textOri.x`（`layoutViewport.ts:231`、`:314`），多行文字的行距方向未随之旋转（W3-4 已记的 kernel 尾巴）。
4. **降级时也丢了卡片。** 全部候选被否决时保留求解器锚点，但 `tag` 已在同步层剥掉，结果是「位置不变、样式变差」（`24383_91813` 全程如此）。

## 给 D5 的建议

不转默认。若继续推进，按影响排序：

1. ~~降级（`allRejected` / `RangeError`）时回到 billboard 呈现，而不是只保留锚点的平面文字~~ → 随第 2 条一并成立（见下节）；
2. ~~在 3D 默认模式下让 polar 结果驱动卡片的锚点 / 引线方向，保留 billboard，不剥 `tag`；或者先把 polar 限定在 `mbd_3d=0`~~ → **已按后一种做法改**（见下节）；
3. 屏幕校验的占用网格预先装入已布局的 `dimension3d` 文字框与已摆好的卡片；
4. 多行文字旋转时同步旋转行距方向，或 polar 只改锚点、不改 `labelAlong`。

## 修正：polar 只在 `mbd_3d=0` 下生效（同日复测）

改动只在同步层（`src/composables/useMbdExternalSync.ts`）：`polarApplied = mbd_polar=1 && mbd_3d=0`，否则照默认剥掉 `polar` / `polarObstacle`；删掉 `polarReplacesTag`（平面呈现里 `withoutPresentation3d` 已剥 `tag`，它不再有事可做）。三维呈现下带 `mbd_polar=1` 时面板注记改为「三维呈现下不生效，标签保留卡片；需同时加 mbd_3d=0」。

第 1 条为什么不另做：平面呈现本来没有卡片，全部候选被否决时 `resolvePolarAnchor` 返回 `null`、输入原样进 `layoutDimension`，与不开 polar 逐字段相同，不丢任何东西；而 polar 已不再进入三维呈现，没有记录会同时带 `tag` 与 `polar`，内核里的「降级回卡片」路径会是死代码。将来要把 polar 接回三维呈现时再做，且要防住逐帧在卡片与平面文字之间来回切（绕轨实测某些角度 12 条全部降级）。

用例：`useMbdExternalSync.test.ts` 的 `mbd_polar=1 opts a label into polar placement only with mbd_3d=0; default strips it`——三维呈现下 `mbd_polar=1` 的记录与默认逐字段相等（`toEqual`），`mbd_3d=0&mbd_polar=1` 才挂 `polar`、保留 `linear_dim` 的 `polarObstacle`。

门禁：`npx vitest run src/composables/useMbdExternalSync.test.ts` 27 / 27；S2 87 文件 / 858 通过；eslint 0；`npm run type-check` 新增 1 条，但在 `src/composables/useIncrementalRvmCheck.ts`（RVM 线未跟踪文件，与本改动无关），尺寸链 0 条。

复测（同一 8023 载荷，`diag-after/`；只保留与 `diag/` 同名文件字节不同的 9 张截图，其余 15 张字节相同已删，`diag.json` 全留）：

| BRAN | 三维 off vs 三维 `mbd_polar=1` | 平面 `mbd_3d=0&mbd_polar=1`（改动前 vs 后） |
| --- | --- | --- |
| `24381_145018` | 三档指标逐项相同（重叠 2 / 3 / 1、卡片 14 张、polar 0），截图三档字节相同 | 指标逐项相同（重叠 93 / 33 / 9、降级 2 / 0 / 7），截图三档字节相同 |
| `24383_91813` | 指标逐项相同（重叠 23 / 16 / 15），far 字节相同；mid / near 有 7 000 / 12 369 个像素不同 | 指标逐项相同（重叠 27 / 19 / 18、降级 2 / 2 / 2）；mid 48 像素不同 |

`24383_91813` 的像素差异：相机位置逐位相同，差异图显示红色区域全部落在竖直管身的几何上，尺寸线、卡片与文字没有差异——是模型网格的渲染时机差异（粗网格补拉），不是尺寸层。

平面呈现下 polar 的问题（第 3、4 条）没有动，`mbd_3d=0&mbd_polar=1` 仍比 `mbd_3d=0` 重叠多（far 71 → 93）。

## 命令

```powershell
# 后端（独立 worktree，不碰主工作区与 8022）
cd 'D:\work\plant-code\old\gen-model'; git worktree add --detach 'D:\work\plant-code\old\gen-model-mbd-polar' refactor
cd 'D:\work\plant-code\old\gen-model-mbd-polar'
$env:CARGO_TARGET_DIR = "$PWD\target"; cargo build --bin aios-database          # exit 0，4m45s
$env:AIOS_STORE_MODE = 'mem'; $env:RUST_MIN_STACK = '134217728'
.\target\debug\aios-database.exe serve                                           # 8023 /api/v1/health 200

# 诊断（临时脚本已删除）
cd 'D:\work\plant-code\old\plant3d-web'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'; $env:MBD_POLAR_DIAG_MBD_BASE = 'http://127.0.0.1:8023'
npx playwright test e2e/tmp-mbd-polar-diag.spec.ts --config=playwright.novideo.config.ts --reporter=line --workers=1   # 8 passed (1.5m)
```
