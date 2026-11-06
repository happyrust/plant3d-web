# 支架 MBD 标注显示验证（2026-11-07，#103 M4 / M5 / M7）

EM4 支架与 EM9 仪表管支架的端到端显示：gen-model 统一端点出支架包，前端按 `mbd_refno` 取数、按 `show_refno` 装支架（STRU，
有配对 REST 的一并装入）几何，三档相机截图。生成器 `e2e/mbd-label-overlap.spec.ts`。

## 版本与环境

| 部分 | 版本 |
|---|---|
| plant-mbd | `feat/mbd-all-types` @ `290fea5` 之后（EM4 / EM9 支架求解器、找墙接线、文字框中心） |
| gen-model | `feat/mbd-host-support` @ `d7faa907b`（支架视图读取器），本机 `127.0.0.1:8024`，`AIOS_STORE_MODE=mem` |
| plant3d-web | `feat/mbd-all-types` @ `9b7384e4`（多行整块居中、非管道 LOD 三档、平贴引线截断） |
| 几何后端 | `127.0.0.1:8022`（AMS rocksdb 档，只读几何） |

```powershell
$env:MBD_LABEL_OVERLAP = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8024'
$env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/mbd-support-display-2026-11-07'
$env:MBD_LABEL_OVERLAP_MODES = 'off,flat'
$env:MBD_LABEL_OVERLAP_REFNOS = '24383_69033,24383_69063,24383_90901,24384_48,24384_24946,24381_177936'
$env:MBD_LABEL_OVERLAP_SHOW_EXTRA = '24383_69033=24383_69027;24383_69063=24383_69071;24381_177936=24381_177946'
$env:MBD_LABEL_OVERLAP_PERF_RUNS = '0'
$env:PLAYWRIGHT_PORT = '3131'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1
```

10 个用例通过、2 个跳过，无页面错误、无非有限值。

## 结果

| 支架 | 类型 | 绘制（远 / 中 / 近） | 重叠对 `off` | `flat` |
|---|---|---|---|---|
| `24383_69033`（+ REST `69027`） | EM4：一级尺寸 15、二级尺寸 9、钢板孔洞信息 2 | 16 / 21 / 24 | 4 / 2 / 1 | 20 / 6 / 2 |
| `24383_69063`（+ REST `69071`） | EM4：一级尺寸 11 | 7 / 9 / 10 | 2 / 0 / 0 | 6 / 2 / 0 |
| `24383_90901` | EM4：一级尺寸、管道信息、管道中心标识 | 4 / 4 / 4 | 1 / 1 / 1 | 6 / 6 / 2 |
| `24384_48` | EM4：管道信息、管道中心标识 | 跳过 | — | — |
| `24384_24946` | EM4（风管支架）：二级尺寸 7、管道信息 | 7 / 10 / 10 | 1 / 3 / 3 | 12 / 7 / 3 |
| `24381_177936`（+ REST `177946`） | EM9 仪表管支架：一级尺寸 6 | 3 / 6 / 6 | 0 / 1 / 1 | 2 / 1 / 0 |

## 观察

- EM4 框架支架读起来就是支架图：吊杆一级链（85 / 41 / 336 / 112 / 266.75）、板与孔（100 / 100 / 219.08，两处「孔 17」）、型钢截面尺寸各沿构件（`off/24383_69033/mid.png`）。
- EM9 仪表管支架的立柱高 910、管卡与底板尺寸清楚（`off/24381_177936/near.png`）。
- `24384_24946` 两块 FITT 端板的尺寸齐全；两根 SCTN 的 SPRE 在库 5052 里悬空，没有截面尺寸（宿主报 `part_geometry_missing`）。剩下的重叠是 270 mm 小板上几道尺寸字挤在一起（`off/24384_24946/mid.png`）。
- `24384_48` 跳过：三根 SCTN 没有 SPRE，几何库里没有它们的网格，生成器等不到几何就跳过；端点照常出管道信息与中心标识。
- AMS 没有 SUPPO、RACK 仪表支架、指向墙板的 LNKI，EM9 仪表支架的墙定位与坐标标签、墙装判据（宿主按 `|POSE − POSS|` 给 `CUTL`）在真数据上没有覆盖。
