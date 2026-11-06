# 安装角度成组去重（前端止损，2026-11-06）

改动：`angle_dim` 与它的两条方向小字（`aid_text` `<angle id>:dirtext1/2`）以名次 500 进入成对去重（`declutterOverlaps`），三条记录同组——任一条撞上已保留的标签，三条一起隐藏，同组之间互不淘汰。名次排在三维长度主尺寸（1000+）之后、ATTA 子尺寸（0+）之前。无 `group` 的布局行为与改前逐位相同（goldens 快照不变）。

## 环境与命令

几何 `127.0.0.1:8022`，MBD `127.0.0.1:8023`（gen-model worktree，plant-mbd `cb046f7`），1920×1080，生成器 `e2e/mbd-label-overlap.spec.ts`：

```powershell
$env:MBD_LABEL_OVERLAP = '1'; $env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8023'; $env:MBD_LABEL_OVERLAP_MODES = 'off,flat'
$env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/mbd-angle-declutter-2026-11-06'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1   # 4 passed
```

## 结果（标签重叠对数 far / mid / near；改前数字取自 `../mbd-polar-ab-2026-11-06-r2/`）

| BRAN | 模式 | 改前 | 改后 | 改后被成组隐藏的记录 |
| --- | --- | --- | --- | --- |
| `24383_91813` | 默认三维 | 23 / 16 / 15 | **6 / 12 / 15** | 9 / 3 / 0 |
| `24383_91813` | `mbd_3d=0` | 27 / 19 / 18 | 16 / 19 / 18 | 6 / 0 / 0 |
| `24381_145018` | 默认三维 | 2 / 3 / 1 | 2 / 3 / 1 | 不变（无角度） |
| `24381_145018` | `mbd_3d=0` | 71 / 21 / 5 | 71 / 21 / 5 | 不变 |

非有限值 0、pageerror 0。

**剩余重叠全部在同一组角度内部**（`24383_91813` 默认三维三档：同组 6 / 12 / 15，跨组 0 / 0 / 0，与非角度记录 0 / 0 / 0）：每个角度的值与它自己的两条方向小字在求解器里就摆得互相压住。这不是去重能解决的，归求解器 `angle.rs` 的文字摆位（polar 避让 T5.3 / 角度近似收敛）。

视觉：`off/24383_91813/far.png`——五组角度只留上下两组，中间的长度 `13500` 不再被压住；每组内部的三段文字仍然叠在一起。
