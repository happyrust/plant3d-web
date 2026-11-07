# 极坐标极轴改用求解器直段轴线后的复测（2026-11-07）

对应 #103 交付顺序第 2 步 / 新计划 M0-1：plant3d-web `48fed2d9`（契约接受 `meta.isolines[].axis`，`polarInputForLabel` 优先取它）+ plant-mbd `3db2d92`（直段表产出 `axis`，PML `isoline.line`）。

**结论：极轴修正本身没有改变 `mbd_3d=0&mbd_polar=1` 的重叠读数。** 修正后，`polar` 记录的极轴落在管身轴线上（旧逻辑落在尺寸线上，离管 114.3–146.7 mm），没有同直段长度尺寸的位号也能拿到 polar 输入（`24381_145018` 远景 12 → 13 条）。但屏幕校验层（`0d4011a2`）要求「画出的框不压任何已画物」，密集簇里几乎找不到这样的位置，候选绝大多数退回原位，重叠对数与改前持平。D5 不变：默认关、只在平面呈现生效；真正的避让收益要等摆位进求解器（新计划 M2a）。

## 环境

- 几何 8022（另一会话的 rocksdb 档）；MBD 8023：gen-model `972b06cfa`（`refactor`）worktree `gen-model-mbd-all`，plant-mbd `3db2d92`，mem 档。8023 下两条 BRAN 的直段全部带 `axis`（11 / 11、1 / 1），`meta.source_version` 分别为 `7997@435`、`7999@230`。
- 前端：main `48fed2d9` 的干净 worktree，dev server 3131。
- 生成器：`e2e/mbd-label-overlap.spec.ts`（口径同 r2：已绘制、未被 LOD 隐藏的 `labelBounds` 两两交叠宽高都 > 1 px 记一对；far = 自动 fit，mid ×0.4，near ×0.2）。

```powershell
$env:MBD_LABEL_OVERLAP = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:MBD_LABEL_OVERLAP_MBD_BASE = 'http://127.0.0.1:8023'
$env:MBD_LABEL_OVERLAP_OUT = 'docs/verification/mbd-polar-axis-ab-2026-11-07'
$env:MBD_LABEL_OVERLAP_MODES = 'flat,flat-polar'
$env:MBD_LABEL_OVERLAP_PERF_RUNS = '0'
$env:PLAYWRIGHT_PORT = '3131'
npx playwright test e2e/mbd-label-overlap.spec.ts --config=playwright.novideo.config.ts --workers=1
```

4 个用例全部通过，非有限值 0、pageerror 0。

## 结果（标签重叠对数 far / mid / near）

| BRAN | `mbd_3d=0` | `mbd_3d=0&mbd_polar=1` 改前（`065761e0`） | 改后（本次） | 改后 polar 记录 / 回退（far · mid · near） |
| --- | --- | --- | --- | --- |
| `24381_145018` | 71 / 21 / 5 | 70 / 21 / 5 | **70 / 21 / 5** | 13 / 12 · 9 · 8（改前 12 / 11 · 9 · 9） |
| `24383_91813` | 16 / 19 / 18 | 16 / 19 / 18 | **16 / 19 / 18** | 2 / 2 · 2 · 2（改前 2 / 2 · 2 · 2） |

涉及 polar 记录的重叠对（`polarOverlaps`）：`24381_145018` 42 / 13 / 1，`24383_91813` 4 / 3 / 3——这些是退回原位后的原有重叠，不是 polar 新造的。

## 判读

- 极轴修正是正确的几何前提：没有它，管身障碍圈套在尺寸行上，任何避让都无从谈起。它也让「直段没有长度尺寸」的位号进入 polar（第 13 条）。
- 读数不变的原因不在极轴：前端 polar 只有管身整环、同组候选与锚点这几类障碍，入参没有 PML 的半径带、轴向区间与优选方向，摆完又必须过屏幕校验，结果候选大多回原位。
- 下一步不在前端继续调：新计划 M2a 把 PML `polarsystem` 的障碍生成、半径带、主尺寸方向与跨段传递放进求解器，由求解器给出最终位置；届时用同一生成器、同一口径再复测，前端 `kernel/layout/polar/place/**` 视结果退役。
