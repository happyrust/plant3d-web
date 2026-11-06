# 设备 MBD 标注显示验证（2026-11-07，#103 M3 / M7）

第一种非管道类型的端到端显示：gen-model 统一端点 `GET /api/mbd/v2/object/{refno}` 出设备包，前端按 `mbd_refno` 取数、按
`show_refno` 装设备几何，三档相机截图。生成器 `e2e/mbd-label-overlap.spec.ts`（`MBD_LABEL_OVERLAP_REFNOS` 指定对象）。

## 版本与环境

| 部分 | 版本 |
|---|---|
| plant-mbd | `feat/mbd-all-types` @ `1b985d5`（设备求解器 + 文字框中心换算） |
| gen-model | `feat/mbd-all-types` @ `d0c170188`（设备视图与找墙候选读取器），本机 `127.0.0.1:8023`，`AIOS_STORE_MODE=mem` |
| plant3d-web | `feat/mbd-all-types` @ `149aee81`（通用端点取数、按类型诊断） |
| 几何后端 | `127.0.0.1:8022`（AMS rocksdb 档；8009 库的写者锁在它手里，本机不能再起第二个 rocksdb 写者，只读取几何） |

```powershell
$env:MBD_LABEL_OVERLAP = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8023'
$env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/mbd-equipment-display-2026-11-07'
$env:MBD_LABEL_OVERLAP_MODES = 'off,flat'
$env:MBD_LABEL_OVERLAP_REFNOS = '24383_76416,24383_76360,24381_156667,24384_24873'
$env:MBD_LABEL_OVERLAP_PERF_RUNS = '0'
$env:PLAYWRIGHT_PORT = '3131'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1
```

`off` 是缺省呈现（标签为三维卡片），`flat` 是 `mbd_3d=0`（标签按求解器的文字平面平贴）。8 个用例全部通过，无页面错误、无非有限值。

## 结果

| 设备 | 类型 | 端点图元 | 绘制记录 | 重叠对（远 / 中 / 近）`off` | `flat` |
|---|---|---|---|---|---|
| `24383_76416` | EM4 | 12：设备名 + 引线、坐标块、轴名线与字、两道定位尺寸与墙名、楼板名 / 标高 / 厚度 | 11 | 0 / 0 / 0 | 3 / 1 / 1 |
| `24383_76360` | EM4 | 12（同上；24 个管口缺 P1） | 11 | 1 / 1 / 0 | 4 / 2 / 1 |
| `24381_156667` | EM9 | 8：设备名、坐标块、偏转角（弧 + 字 + 两条小字）、楼板标高 / 厚度；`locate.no_wall` | 7 | 3 / 3 / 3 | 5 / 5 / 4 |
| `24384_24873` | EM4（只有 ELCONN） | 9：以 ELCONN 为基准点；两面曲墙挡住 → `locate.no_wall`、楼板 | 8 | 1 / 0 / 0 | 2 / 0 / 0 |

重叠是已绘制标签框两两 AABB 交叠（旋转文字偏多，只作同口径横比）。

## 观察

- 缺省呈现下设备标注完整可读：设备名带引线指向基准点，坐标块是卡片，两道定位尺寸沿墙法向、墙名与楼板三行各自成卡（`off/24383_76416/mid.png`）。
- `24381_156667` 的三对重叠来自偏转角：角度字与两条半字高方向字挤在基准点处的弧旁（PML 同样画在那里）。
- 平贴呈现的问题都在前端多行布局上：坐标块是一条三行标签，求解器现在下发整块框中心（字段字典裁决 8），前端仍把首行放在 position、其余行沿屏幕向下 1.5 倍字高叠放——行不沿文字自己的 `text_up` 走，块位置也不对，坐标块与设备名在远景压叠（`flat/24383_76416/far.png`）。前端多行布局（整块居中、沿 `text_up` 按 1.2 倍字高叠行）改完后重跑。
- 平贴呈现下楼板标高 / 厚度两行（字高 70、PML 行距 105）在远景互相压住：小字被放大到可读字号后超过了 PML 的行距。
- 只装了设备几何（`show_refno` = 设备），定位用的墙与楼板没有显示，墙名和楼板标签看上去悬在空中；下一轮把找到的墙板一并加进 `show_refno`。
