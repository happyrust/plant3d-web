# 极坐标放置（仅 `mbd_3d=0`）：占位网格看得见其它标签 + 只改锚点（2026-11-06）

对应：N2-2（Q2 已裁决做）的 ① + ③。改动在 `src/dimension/kernel/viewport/layoutViewport.ts`：

- 两遍布局：先布局全部记录（极坐标记录按求解器原位），把它们的文字框装进 `polarOccupancy`（带视口裁剪），再逐条为极坐标记录找位置；屏幕校验与最终验收都忽略本记录自己的原位框（`LabelOccupancy.overlapsExcluding`、`screenGuard` 的 `exclude`）。
- 挪位以**实际画出的框**验收：按候选位置重新布局后，框若压到任何已占位（本记录原位框除外）就退回原位、计一次 fallback；过关的才登记框、记入同组障碍与跨帧状态。
- 只改锚点、不改 `labelAlong`：多行位号不再旋转错行。
- 没有极坐标记录时跳过这一整段（默认三维呈现下 polar 已被剥掉，零额外开销）。

## 命令

```powershell
$env:MBD_LABEL_OVERLAP = '1'; $env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8023'; $env:MBD_LABEL_OVERLAP_MODES = 'flat,flat-polar'
$env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/mbd-polar-flat-occupancy-2026-11-06'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1   # 4 passed
```

几何 8022，MBD 8023（plant-mbd `cb046f7`），1920×1080；`24383_91813` 的数字已含同日的角度成组去重。

## 结果（标签重叠对数 far / mid / near）

| BRAN | `mbd_3d=0` | `mbd_3d=0&mbd_polar=1` 改前（r2） | 改后 | 改后 fallback（共挂 polar） |
| --- | --- | --- | --- | --- |
| `24381_145018` | 71 / 21 / 5 | 93 / 33 / 9 | **70 / 21 / 5** | 11 / 9 / 9（12） |
| `24383_91813` | 16 / 19 / 18 | 27 / 19 / 18（未含角度去重） | **16 / 19 / 18** | 2 / 2 / 2（2） |

判据「`mbd_3d=0&mbd_polar=1` 三档不高于 `mbd_3d=0`」达成，非有限值 0、pageerror 0。

**如实记录收益**：挪位必须过「画出的框不压任何东西」这一关后，这两个样本里绝大多数 polar 记录都退回原位（`24381_145018` 远景 12 条只挪了 1 条），只有远景少 1 对重叠。也就是说现在的 polar 是「不添乱」，但在密集场景里几乎找不到更好的位置；默认仍关、仍只在平面呈现生效（D5 不变）。真正的避让收益要等求解器侧的 polarsystem（T5.3）。
