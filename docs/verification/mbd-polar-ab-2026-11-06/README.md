# MBD 极坐标放置 label · A/B 实景取证（T3.6a，2026-11-06）

对应任务：为 T3.6a（`?mbd_polar=1`，默认关）收集真实场景证据，供 Lead 判断是否转默认（D5）。
判据：截图对照通过 + 无 NaN / 越界 + P95 不退化。

**结论先说：当前两个测试 BRAN（`24381_145018` / `24383_91813`）里没有任何记录带 `polar` 字段，
`mbd_polar=1` 在这两个场景下是纯粹的 no-op（截图字节级相同），本轮取证实质上只验证了
「开关不触发时不产生副作用」，**没有**覆盖极坐标放置本身的视觉效果、NaN/越界风险或性能代价。
详见下方「结论与建议」。

## 环境

| 项 | 值 |
| --- | --- |
| 仓库 / 提交 | `plant3d-web`，HEAD `01c8ac6eb3753c1bffd0156fb4e512070cb1ee3e`（`9eafa763` 是其祖先，已用 `git merge-base --is-ancestor` 确认，T3.6a 代码在工作树内）|
| 后端 | `http://127.0.0.1:8022`（rocksdb 档，本轮未启停，仅读取）|
| 前端 dev | `http://127.0.0.1:3101`。**注意**：任务开始时实测端口未监听（`Invoke-WebRequest` 拒绝连接、`netstat` 无 LISTENING），与交接信息「已在运行、不要停」不符，推断是在交接之后、取证开始之前已经退出。本轮用 `npm run dev` 方式重新拉起，详见下方「踩坑」|
| 窗口 | 1920×1080（`dimension-camera-baseline.spec.ts` 的 `test.use`）|
| Playwright 配置 | `--config=playwright.novideo.config.ts`（按交接要求，避免录像拖住 teardown）|
| 日期 / 操作人 | 2026-11-06 / worker |

## 踩坑：dev server 起不来，已用临时覆盖绕过（已清理）

1. **第一次 `npx playwright test` 直接报 `webServer` 启动失败**：`'vite' is not recognized`。根因是
   3101 端口当时确实没有监听，Playwright 的 `reuseExistingServer` 判空后尝试自己起
   `npm run dev -- --host 127.0.0.1 --port 3101 --strictPort`，但那个子进程的 shell 环境解析不到
   `vite`（`node_modules/.bin` 没有正确进 PATH）。
2. 于是我自己用 `npx vite --host 127.0.0.1 --port 3101 --strictPort`（`node_modules/.bin/vite.cmd`
   确认存在）单独起 dev server，结果 **Vite 自身的 fs watcher 在 `.scratch/redeploy-sandbox/run/.gen-model.instance.lock`
   上 `EBUSY` 崩溃退出**（该锁文件当时被另一个并行任务独占，无法读取，推断是另一个联调/sandbox
   任务在跑）。根配置 `vite.config.ts` 里本来就有一条注释写明 `tmp/**` 要排除是因为同类问题，
   但覆盖范围没有包含 `.scratch/redeploy-sandbox/**`。
3. 按任务约束**不能改 `src/` 下代码、也不新增 `e2e/` 之外的持久文件**，所以没有改仓库根
   `vite.config.ts`，而是在 `docs/verification/mbd-polar-ab-2026-11-06/` 下建了一个**临时**
   `vite.dev-watch-fix.config.ts`：`import` 根配置的工厂函数、原样调用取到 base config，只在
   `server.watch.ignored` 里追加 `**/.scratch/**`，再用 `npx vite --config <该文件>` 起服务。
   成功监听 3101 后，**已把该临时配置文件删除**（dev server 进程仍在跑，不需要配置文件常驻磁盘）。
4. 为了跑一个诊断用、放在 `docs/verification/` 下而不在 `e2e/` 里的 spec，还临时建了
   `playwright.verification-scope.config.ts`（复用 `playwright.novideo.config.ts`，只把
   `testDir` 从 `./e2e` 改到仓库根），跑完同样已删除。
5. 这两个临时配置文件 + 两个临时诊断 spec（`check-polar-presence.spec.ts`、
   `perf-polar-ab.spec.ts`）**全部已删除**，当前目录只剩截图产物与本 README（见下方「写入文件清单」）。

**这个 dev server 现状如何处理**：本轮结束时 3101 仍在监听（用上述工作区绕过起的进程），
我没有停掉它——停掉会让后续任何人再次撞见同一个 `.scratch/redeploy-sandbox` EBUSY 问题。
**遗留问题**：`vite.config.ts` 的 `server.watch.ignored` 目前只覆盖 `tmp/**`，不覆盖
`.scratch/**`，只要再有并行任务在 `.scratch/redeploy-sandbox/run/` 下放锁文件，任何人正常
`npm run dev` 都会复现这次的 Vite 崩溃。这是本仓配置的既有缺口，不在本任务改码范围内，
建议报给负责人另开工单修 `vite.config.ts`。

## 执行的命令（按顺序，退出码全部 0）

```powershell
cd 'D:\work\plant-code\old\plant3d-web'

# 确认后端 / 前端
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:8022/api/v1/health --max-time 10   # 200
netstat -ano | Select-String ":8022"                                                        # LISTENING

# dev server（绕过 .scratch EBUSY，临时配置已删除，见上文）
npx vite --config 'docs/verification/mbd-polar-ab-2026-11-06/vite.dev-watch-fix.config.ts' `
  --host 127.0.0.1 --port 3101 --strictPort   # fireAndForget，确认 3101 返回 200 后继续

# 四组截图（exit=0 x4）
$env:DIMENSION_CAMERA_BASELINE = '1'
$env:GEN_MODEL_V1_BASE_URL = 'http://127.0.0.1:8022'
$env:DIMENSION_CAMERA_BASELINE_OUT_DIR = '...\docs\verification\mbd-polar-ab-2026-11-06\default'
$env:DIMENSION_CAMERA_BASELINE_LABEL = 'default'
$env:DIMENSION_CAMERA_BASELINE_EXTRA_QUERY = ''
npx playwright test e2e/dimension-camera-baseline.spec.ts --config=playwright.novideo.config.ts --reporter=line
# 同上，OUT_DIR=...\polar      LABEL=polar      EXTRA_QUERY='mbd_polar=1'
# 同上，OUT_DIR=...\flat       LABEL=flat       EXTRA_QUERY='mbd_3d=0'
# 同上，OUT_DIR=...\flat-polar LABEL=flat-polar EXTRA_QUERY='mbd_3d=0&mbd_polar=1'

# 诊断：polar 字段是否真的出现在渲染层（临时 spec，已删除）
npx playwright test "docs/verification/mbd-polar-ab-2026-11-06/check-polar-presence.spec.ts" `
  --config="docs/verification/mbd-polar-ab-2026-11-06/playwright.verification-scope.config.ts" --reporter=line

# 性能：24381_145018 默认 vs mbd_polar=1（临时 spec，已删除）
npx playwright test "docs/verification/mbd-polar-ab-2026-11-06/perf-polar-ab.spec.ts" `
  --config="docs/verification/mbd-polar-ab-2026-11-06/playwright.verification-scope.config.ts" --reporter=line --workers=1
```

| 命令 | 退出码 |
| --- | --- |
| 后端健康检查 `curl /api/v1/health` | 200（curl 本身 exit 0）|
| 四组截图各一次 `playwright test e2e/dimension-camera-baseline.spec.ts` | 0 / 0 / 0 / 0（均 `2 passed`）|
| 诊断 spec `check-polar-presence.spec.ts` | 0（`2 passed`）|
| 性能 spec `perf-polar-ab.spec.ts` | 0（`2 passed`）|

## 四组截图目录与相机核对

```
docs/verification/mbd-polar-ab-2026-11-06/
├── default/{24381_145018,24383_91813}/{far,mid,near}.png + cameras.json   # 无附加 query
├── polar/{...}/...                                                        # mbd_polar=1
├── flat/{...}/...                                                         # mbd_3d=0
└── flat-polar/{...}/...                                                   # mbd_3d=0&mbd_polar=1
```

每组每个 BRAN 的 `cameras.json` 里 `far`/`mid`/`near` 三档的 `position`/`target` 在四组之间逐字段核对，
四组之间的浮点差异在 `1e-14` 级（例如 `24381_145018` 的 `position.y`：
`13.360428955078117`(default) vs `13.360428955078103`(polar) vs `13.360428955078117`(flat) vs
`13.360428955078117`(flat-polar)），属于取景/阻尼回写的浮点噪声，**不是取景口径漂移**，
四组截图可直接两两对照。`near`/`far` 裁剪面同理只有 ulp 级差异。

## 四组 drawn / lodHidden 对照表

| BRAN | 档位 | records | default drawn/lodHidden | polar drawn/lodHidden | flat drawn/lodHidden | flat-polar drawn/lodHidden |
| --- | --- | --- | --- | --- | --- | --- |
| 24381_145018 | far | 63 | 21 / 42 | 21 / 42 | 28 / 35 | 28 / 35 |
| 24381_145018 | mid | 63 | 29 / 34 | 29 / 34 | 31 / 32 | 31 / 32 |
| 24381_145018 | near | 63 | 30 / 33 | 30 / 33 | 31 / 32 | 31 / 32 |
| 24383_91813 | far | 18 | 18 / 0 | 18 / 0 | 18 / 0 | 18 / 0 |
| 24383_91813 | mid | 18 | 18 / 0 | 18 / 0 | 18 / 0 | 18 / 0 |
| 24383_91813 | near | 18 | 18 / 0 | 18 / 0 | 18 / 0 | 18 / 0 |

**读法**：`default` 与 `polar` 的 drawn/lodHidden **逐格相同**；`flat` 与 `flat-polar` 同样逐格相同
（`mbd_3d=0` 本身会让更多记录画出来——`dimension3d` 和 `tag` 被剥掉后走更简单的呈现路径，LOD 隐藏数因此下降，
这是 `mbd_3d` 的已知效应，与 `mbd_polar` 无关）。`mbd_polar` 这一个变量单独看，在这两个数据集里**完全没有
改变任何一格的计数**。

## 为什么没有变化：两个 BRAN 都没有 polar 数据

用临时诊断 spec（已删除）在 `mbd_polar=1` 下读取 `externalRegistry.snapshot.visibleRecords`，
统计有多少条记录的 `layout` 里带 `polar` 字段：

```
[polar-presence] 24383_91813  {"recordCount":18,"polarRecordCount":0,"polarIds":[],"layoutCount":18,"drawnCount":18,...}
[polar-presence] 24381_145018 {"recordCount":63,"polarRecordCount":0,"polarIds":[],"layoutCount":63,"drawnCount":21,...}
```

两个 BRAN 的 `polarRecordCount` 都是 **0**。对照 `src/composables/useMbdExternalSync.ts:535`
（`polarInputForLabel`）的三个前提——label 所在 isoline 要有同 isoline 的 `linear_dim`、
且该 isoline 声明了外径——任一条件缺失就不挂 `polar` 字段。用原始后端数据核对
（`GET /api/mbd/v2/pipe/{refno}`）：`24381_145018` 有 77 个图元、14 个 `label` kind；
`24383_91813` 有 20 个图元、2 个 `label` kind；但两边原始 `label` 图元的字段只有
`{kind, id, text, position}`，说明无论 isoline 关联与否，这两个数据集里没有一条 label 同时满足
polar 挂载的前提。

**这意味着本轮的「截图对照通过」「无 NaN/越界」「性能不退化」三条判据，实际上只验证了
`mbd_polar=1` 在无 polar 数据时是纯粹的 no-op（代码路径被安全跳过），完全没有执行到
`polarInputForLabel` 返回非 `undefined`、也没有执行到 `polarReplacesTag` 剥 `tag`、
更没有执行到内核的 `layoutViewport` 里 `polarPlace` + 屏幕净空校验那一段逻辑。**
要真正验证 D5（转默认）的视觉效果，需要先找到或构造一个 isoline 同时有
`linear_dim` + 声明外径 + `label` 的真实 BRAN（或联调一个合成数据集），否则换任何 refno
重跑这套取证都可能仍然是 no-op。

## 视觉观察（基于已读取的截图）

- `default` vs `polar`：字节级完全相同（SHA256 一致），四张/组、两个 BRAN、三档全部确认。
  因为没有记录带 `polar`，`withoutPolar` 和 `polarReplacesTag` 两条分支在这两个场景下
  走的是同一份数据，**图像不同才是异常**，图像相同是预期之内。
- `flat` vs `flat-polar`：`far`、`near` 两档字节相同；**`24381_145018` 的 `mid` 档文件大小与
  哈希不同**（`flat` 396,702 字节 vs `flat-polar` 416,496 字节）。Read 工具取两张图肉眼比对
  （`docs/verification/mbd-polar-ab-2026-11-06/flat/24381_145018/mid.png` 与
  `docs/verification/mbd-polar-ab-2026-11-06/flat-polar/24381_145018/mid.png`），**内容在肉眼层面看不出差异**：
  同样的标签文字、同样的位置、同样的重叠区域。结合「两个 BRAN 都没有 polar 数据」的结论，
  这个字节差异不可能来自极坐标放置本身，更可能是 PNG 编码的非确定性或亚像素级抗锯齿差异
  （两次独立渲染帧，相机 target 的浮点噪声在 1e-14 级，足以让某些像素的抗锯齿取整翻转，
  PNG 压缩器对翻转像素块的编码长度敏感）。**未能排除**的可能性：也许存在某些我们没有枚举到的
  字段交互（比如 `mbd_3d=0` 的 `withoutPresentation3d` 和 `mbd_polar=1` 的 `polarReplacesTag`
  都在改 `tag` 字段，两者顺序/叠加是否有极端情况打出微小差异没有进一步排查）。**这一项建议
  Lead 决策前再核实一次**，但从肉眼读图看不构成功能性回归。
- **已确认的、与 `mbd_polar` 无关的既有问题**（两个变量取值下都存在，供记录）：
  - `default`／`polar` 的 `24381_145018` far 档：右侧管件转角处 5 个标签卡片
    （`PE +14074`、`PE +13301`、`PE +18644`、`PE +14060` 等）紧密挤在一起，文字边框互相重叠，
    读不清楚哪个数字对应哪条引线（`docs/verification/mbd-polar-ab-2026-11-06/default/24381_145018/far.png`）。
  - `default`／`polar` 的 `24383_91813` far/mid/near 三档：竖直管道上 5 处 `-X ... ° Y` 角度标签
    完全重叠堆叠在同一位置，肉眼只能看出一团黑字（`docs/verification/mbd-polar-ab-2026-11-06/default/24383_91813/far.png`）。
  - `flat`／`flat-polar` 的 `24381_145018` mid 档：右上角转角处 `89.69°`/`89.81°`/坐标值/`PE`值
    等多条文字叠在一起无法分辨；下方 `388571°`/`PBPE1407135`、`90752A-0.55`/`272.03` 两处同样
    重叠（`docs/verification/mbd-polar-ab-2026-11-06/flat/24381_145018/mid.png`，
    `flat-polar` 同位置同样重叠，见上条字节差异说明）。
  这些重叠在 `polar=1` 与 `polar=0` 下**完全一样**，说明极坐标放置层目前对这两个数据集
  没有产生任何改善或恶化——因为它根本没被触发。

## NaN / 越界检查

诊断 spec 读取 `viewport.getLayouts()` 的每条 `primitives`（`position`/`from`/`to`/`points`）
以及 `derived.labelAnchor` / `derived.screenAnchor`，逐值检查 `Number.isFinite`：

```
24383_91813:  anchorIssueCount: 0
24381_145018: anchorIssueCount: 0
```

两个 BRAN 在 `mbd_polar=1` 下 **均未发现 NaN 或非有限值**。但同样要强调：这是在
`polarRecordCount = 0` 的前提下测的，极坐标放置代码（`polarPlace`、`screenGuard`、
`layoutViewport.ts` 里的 `polarNext`/`polarFallbacks` 分支）在这两个场景里从未真正执行过，
这条「无 NaN」结论**不能当作对极坐标放置算法本身的验证**，只能证明开关管线在无数据分支下是安全的。

关于 `polarFallbacks`/`polarNext`：按交接说明，这两个字段是内核 `layoutViewport` 返回值的
一部分，`dimensionFrameStats.ts`（`window.__dimensionFrameStats`）只挂了 `onFrame` 上报的
`layoutMs`/`paintMs`/`kind` 三元组，**不转发** `polarFallbacks`/`polarNext`。翻查
`src/dimension/viewport/dimensionViewport.ts:766`（`this.polarPrevious = batch.polarNext`）
和 `src/components/dock_panels/ViewerPanel.vue` 全文，没有任何地方把这两个字段挂到 `window`
或任何可被 e2e 读取的调试钩子上。**按任务要求，此处没有改 `src/` 补暴露通道，只能如实报告：
没有线上/dev 可读的渠道能验证 `polarFallbacks` 计数，想要这个数字只能加单元测试直接调
`layoutViewport()` 并断言返回值（不在本轮允许改动范围内）。**

## 性能：24381_145018，默认 vs mbd_polar=1

方法：临时 spec（已删除）打开页面，热身 60 帧绕轨后，`120` 帧绕轨 × 3 次，每次前 `stats.reset()`，
读 `window.__dimensionFrameStats.summary()`；绕轨**不强制 `flushProjection()`**，贴近日常真实交互
（相机连续运动走 `DimensionViewport.setProjector` 的节流路径，120 帧大约只放行 19～20 次全量布局，
与 `docs/verification/mbd-perf-baseline-2026-10-29/README.md` 的「节流实测」口径一致）。
`__dimensionFrameStats` 已确认存在（`hasFrameStats: true`，dev 构建挂载，生产构建不挂）。

三次原始读数（`layoutMs`/`paintMs` 的 P95，单位 ms）：

| 变量 | 次 | frames | layoutFrames | layoutMs P95 | paintMs P95 |
| --- | --- | --- | --- | --- | --- |
| default | 1 | 20 | 20 | 3.10 | 17.60 |
| default | 2 | 19 | 19 | 4.60 | 20.70 |
| default | 3 | 19 | 19 | 6.90 | 19.50 |
| polar | 1 | 19 | 19 | 7.80 | 18.60 |
| polar | 2 | 20 | 20 | 4.30 | 17.30 |
| polar | 3 | 20 | 20 | 4.20 | 17.20 |

三次中位数：

| 变量 | layoutMs P95 中位数 | paintMs P95 中位数 |
| --- | --- | --- |
| default | **4.600** | **19.500** |
| polar | **4.300** | **17.300** |

`polar` 的两个指标都略**低于** `default`（layoutMs -6.5%，paintMs -11.3%），在三次样本的方差范围内
（default 的 layoutMs 单次就从 3.10 跳到 6.90，波动本身就有 ±2 ms 级），不构成有意义的差异，
更谈不上退化。**但这组数字同样建立在 `polarRecordCount = 0` 之上**：测的是「判断要不要走极坐标
分支」这一步的开销（必然是常数级的字段检查），不是「真的算一次极坐标放置 + 屏幕净空校验」的开销。
如果转默认后线上数据集里有大量 label 真正触发 `polar` 分支，这组数字**不能**代表那时的性能，
需要用含 polar 数据的场景重新测一轮。

## 写入的文件清单

**保留（最终交付物）**：

```
docs/verification/mbd-polar-ab-2026-11-06/README.md
docs/verification/mbd-polar-ab-2026-11-06/default/24381_145018/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/default/24383_91813/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/polar/24381_145018/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/polar/24383_91813/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/flat/24381_145018/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/flat/24383_91813/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/flat-polar/24381_145018/{far,mid,near}.png, cameras.json
docs/verification/mbd-polar-ab-2026-11-06/flat-polar/24383_91813/{far,mid,near}.png, cameras.json
```

**临时产物，已在本轮内创建并删除，不留痕**：

- `docs/verification/mbd-polar-ab-2026-11-06/vite.dev-watch-fix.config.ts`（绕过 `.scratch` EBUSY 的 dev 覆盖配置）
- `docs/verification/mbd-polar-ab-2026-11-06/playwright.verification-scope.config.ts`（把 `testDir` 指到仓库根的覆盖配置）
- `docs/verification/mbd-polar-ab-2026-11-06/check-polar-presence.spec.ts`（polar 字段存在性 + NaN/越界诊断）
- `docs/verification/mbd-polar-ab-2026-11-06/perf-polar-ab.spec.ts`（性能 A/B 脚本）

没有触碰 `src/` 或 `e2e/` 下任何文件；没有执行任何 `git add`/`git commit`/`git stash`。
`git status --porcelain -- src e2e` 在任务开始前与结束后输出完全一致（均为 15 个既有改动中的
`src/components/increment/IncrementRecordsPanel.vue` 等文件 + 7 个既有未跟踪文件，详见下方
「git 状态核对」），确认本轮没有引入任何新的 `src`/`e2e` 改动。

## git 状态核对

任务开始时与结束时各跑一次 `git status --porcelain -- src e2e`，两次输出逐行相同（均属于
本任务开始前就存在、与 rvm-check/increment 相关的既有改动，与 T3.6a/mbd_polar 无关）：

```
 M src/components/increment/IncrementRecordsPanel.vue
 M src/components/model-tree/ModelTreePanel.vue
 M src/components/model-tree/ModelTreeRow.rvmStatus.test.ts
 M src/components/model-tree/ModelTreeRow.vue
 M src/components/model-tree/ModelTreeStatusIcon.vue
 M src/components/project/RedeployDialog.vue
 M src/components/rvm-check/RvmCheckPanel.vue
 M src/components/rvm-check/RvmCheckResult.test.ts
 M src/components/rvm-check/RvmCheckResult.vue
 M src/components/rvm-check/RvmCheckTreeNode.vue
 M src/components/rvm-check/RvmStatusIcon.vue
 M src/composables/redeployRvmFollowUp.test.ts
 M src/composables/redeployRvmFollowUp.ts
 M src/composables/useRedeployRvmFollowUp.ts
 M src/composables/useRvmCheckStore.ts
?? src/components/project/RedeployRvmSites.vue
?? src/components/rvm-check/RvmOutdatedBadge.vue
?? src/components/rvm-check/incrementalRvmTargets.test.ts
?? src/components/rvm-check/incrementalRvmTargets.ts
?? src/composables/useIncrementalRvmCheck.integration.test.ts
?? src/composables/useIncrementalRvmCheck.ts
?? src/composables/useRvmCheckRun.ts
```

e2e/ 下无任何改动（输出中没有一行属于 `e2e/`）。

## 结论与建议

1. **截图对照「通过」，但判据没被真正运行到**：`default` 与 `polar` 逐 BRAN、逐档字节级相同；
   `flat` 与 `flat-polar` 除一个档位的字节差异外（肉眼不可辨，疑似 PNG 编码/抗锯齿噪声）同样一致。
   根因是两个测试 BRAN 都没有满足 polar 挂载前提（同 isoline 的 `linear_dim` + 声明外径）的
   `label` 记录，`mbd_polar=1` 全程走的是「剥字段」分支的反向空路径，从未进入
   `polarPlace`/`screenGuard` 的真实计算。
2. **NaN/越界「无问题」，同样是在未触发分支下测的**，不能当作极坐标算法本身无风险的证据。
3. **性能「不退化」（甚至略好），但测的是分支判断开销，不是极坐标放置的真实计算开销**。
4. **不建议仅凭本轮数据把 `mbd_polar` 转默认（D5）**：三条判据表面通过，但都没有覆盖到功能
   本身。建议下一步：
   - 找一个或构造一个真实/合成 BRAN，确保至少一条 `label` 同时满足 polar 挂载的三个前提，
     重跑同一套四组截图 + NaN/越界 + 性能对照；
   - 顺带修一下 `vite.config.ts` 的 `server.watch.ignored`（补 `.scratch/**` 或更精确的
     `redeploy-sandbox` 路径），避免下次联调任务并行时再撞见本轮的 `EBUSY` 崩溃（本轮未改，
     仅临时绕过）；
   - 若要验证 `polarFallbacks`/`polarNext`，需要内核单元测试直接断言 `layoutViewport()` 返回值，
     现有 dev 调试钩子（`__dimensionFrameStats`）不转发这两个字段。
5. 本轮发现的标签重叠问题（`24381_145018` far 档右侧转角 5 个卡片互压、`24383_91813` 三档角度
   标签完全堆叠、`flat` 模式 mid 档多处文字重叠）与 `mbd_polar` 无关，`polar=0`/`polar=1` 下
   表现完全一致，按任务要求**仅报告，不在本轮修复**。

