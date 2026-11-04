# 多 BRAN 同屏端到端验证（2026-11-02）

把多 BRAN 链路（编解码、同步层、诊断、面板、模型树、几何侧 `show_refno`）第一次在**真实后端**上跑通：三条 BRAN 跨两个库同时带标注与几何，另加一个「混入不存在 BRAN」的逐包降级用例。

- 后端：`aios-database.exe` `:8022`（rocksdb 档，`/api/v1/health` 200，工程 `AvevaMarineSample`）
- 前端：Vite dev server `:3101`
- 验证脚本：本轮用的临时 spec `e2e/multi-bran-e2e-tmp.spec.ts` 已删除。2026-11-05 起回归用例入库为
  `e2e/multi-bran-show-refno.spec.ts`（`.gitignore` 白名单），覆盖跨库同屏与「面板移除 / 再追加」的增量撤装；
  下方「复跑脚本要点」照旧是它的断言口径。
- 运行：`npx playwright test e2e/multi-bran-e2e-tmp.spec.ts --workers=1 --reporter=line`，2 passed（约 19 秒）

## 场景与 URL

```
/?model_source=gen-model-v1&output_project=AvevaMarineSample
  &mbd_refno=24381_145018,24381_146979,24383_91813
  &show_refno=24381_145018,24381_146979,24383_91813
```

三条 BRAN 分属两个库（`/api/v1/dbnums` 的 ref0 映射）：`24381_* → dbnum 7997`，`24383_* → dbnum 7999`。

## 结果（multi-bran.json）

| 指标 | 值 |
| --- | --- |
| 标注画出数 `viewport.getLayouts().length` | **247**（63 + 166 + 18，断言 ≥ 200 通过）|
| 记录 id 重复 | **0**（`replaceExternalSource` 走完没抛）|
| 几何对象 `__dtxLayer.getStats().totalObjects` | **85**（单 BRAN 基线 22）|
| 装载过的库 `__dtxLoadedDbnos` | **[7997, 7999]**（跨库同屏成立，断言 `toEqual([7997, 7999])`）|
| `__dimensionSystemError` | **null** |
| 页面异常 `pageerror` | 0 |

单 BRAN 对照（single-bran.json）：只装 dbnum 7997、22 个对象、63 条标注、`loadedDbnos = [7997]`。

> **断言口径（2026-11-02 修正）**：早期版本只断言 `multi.totalObjects > single.totalObjects`，
> 实测数据下 `85 > 22` 会通过，但当时 `24381` 一个都没装——多出来的对象全来自单个库的包，
> 跨库同屏根本没成立。现行断言要求 `loadedDbnos` **同时**含 7997 与 7999、且两个 ref0 前缀
> 都有 refno，才认为通过。`snapshot()` 也只读 `__dtxLastLoadedDbno`（最后一个库）改为读累计的
> `__dtxLoadedDbnos`，否则「只装了一个库」会被伪装成成功。

### 逐包取数（multiLoad.succeeded）

| 库 | refno 数 | 装载对象 | 缺失 |
| --- | --- | --- | --- |
| 7997 | 54（两条 BRAN 的可见子实例合并根节点）| 80 | — |
| 7999 | 6 | 5 | `24383_91813`（容器自身无几何，只装了根 refno 的 5 个子实例对象）|

注意 `missingRefnos` 里的 `24383_91813` 不是失败：该 BRAN 是容器节点，可见子实例接口成功返回但容器自身无几何行，装载器按缺失记账、其余照装——这正是「一包弱几何不连坐整批」的逐包语义。

## 失败包处理（degraded-with-missing-bran.json）

URL 追加第四个不存在的 `24381_999999`（`/api/mbd/v2/pipe/24381_999999` → 404）：

- 两个真库照常装载：`loadedDbnos = [7997, 7999]`，对象 85，标注 247 条，id 无重复
- 不存在的 BRAN 在 7997 组内被装载器记为 `missingRefnos`，**没有任何一组整体失败**（`multiLoad.failures = []`）
- 控制台出现的 400 / 404 是故意请求不存在 BRAN 的预期结果；401 是样例库对本机匿名请求的凭证限制（环境问题，不作为通过条件）
- `__dimensionSystemError` 仍为 null，页面异常 0

两个场景的可区分性（修复前两份 JSON 逐字节相同、两张 PNG 的 sha256 都是
`FF41F98DB421BB4AE7FA67D4A9B4992A73188635D0981B2812735A5A8E1AD780`，等于「脚本没区分场景」）：

| 证据 | multi-bran | degraded |
| --- | --- | --- |
| `multiLoad.prepared` | `7997:54, 7999:6` | `7997:55, 7999:6` |
| dbnum 7997 的 `missingRefnos` | `[]` | `["24381_999999"]` |
| JSON sha256 | 与右侧不同 | 与左侧不同 |

画面内容本身**应当**一致（不存在的 BRAN 不渲染任何几何），所以截图前在画布左上角盖场景标签
（场景名 / 请求 refno / 已装库 / 对象数），让两张 PNG 自带身份。

## 截图

- `multi-bran-viewport.png`：三条 BRAN 同屏（顶栏烙印：请求 refno、已装库 7997 + 7999、对象 85）
- `multi-bran-degraded.png`：混入不存在 BRAN 后的降级场景（烙印里带 `degraded` 与缺失的 refno）

## 内存观察

三组几何**串行**装载（`runBranLoadPlan` 逐组 await），整个用例约 10 秒内完成，无 OOM、无页面崩溃——与「多组并发装几何会 OOM」的风险假设一致，串行是必要的。

## 三层错误语义（别混）

`runBranLoadPlan` 把「失败」拆成三类，混在一起会让提示与画面对不上：

| 层 | 触发点 | 归到哪 | 呈现 |
| --- | --- | --- | --- |
| 这一组没装进来 | `loadGroup` 抛错 | `failures` | 错误；提示「N 组中 M 组成功」 |
| 装进来了、收尾动作失败 | `afterGroupLoaded` 抛错 | `sideEffectFailures` | **警告**；`dbnum 7997 已装载但收尾失败：…` |
| 只是进度日志 | `onGroupStart` 抛错 | 忽略 | 无 |

第二条是 2026-11-02 补的：`__dtxAfterInstancesLoaded`（刷新空间索引、重放可见性、单位归一化、
auto-fit）原先在 `loadGroup` 内部调用，一旦它抛错，这一组会被记成「装载失败」——但几何此刻
**已经在场景里**了，统计会报 0 对象、提示会说这一组失败，而画面里模型明明在。「提示说失败、
画面有模型」比不报错更糟，所以收尾失败单独记、按警告报，绝不混进 `failures`。

真机实测 `sideEffectFailures` 为空（`multiLoad.sideEffectFailures = []`），说明这条路径正常；
单测里用注入的抛错副作用覆盖了它。

## 复跑脚本要点

正式 spec `e2e/multi-bran-show-refno.spec.ts` 已按下面几条实现，复跑：

```powershell
$env:MULTI_BRAN_E2E = '1'
npx playwright test e2e/multi-bran-show-refno.spec.ts --workers=1 --reporter=line
```

未设 `MULTI_BRAN_E2E=1` 或后端 `/api/v1/health` 不通时整文件 skip。改写或另起用例时这几处是**必需的**，否则会重现本轮修掉的问题：

1. **断言 `loadedDbnos` 等于 `[7997, 7999]`**，而不是 `totalObjects > 单 BRAN`。
   `snapshot()` 读 `__xeokitViewer.__dtxLoadedDbnos`（累计）与 `__dtxLastMultiBranLoad`（分组明细），
   不要只读 `__dtxLastLoadedDbno`。
2. **`test.use({ video: 'off', trace: 'off' })`**。headless Chrome 录 WebGL 画布时
   `context.close()` 会挂在帧采集上，用例主体 10 秒跑完却在 teardown 报
   `Tearing down "context" exceeded the test timeout`，证据不可信。
3. **关页前主动收尾**：关闭页面里记录的 WebSocket → dispose 渲染器 → 跳 `about:blank` → `page.close()`。
4. **控制台错误分类**：401 记 `environmentLimit: true` 不作通过条件；400/404 只在降级用例里
   允许（记 `expectedResourceMiss`）；其余错误与全部 `pageerror` 必须为空。
5. **截图盖场景标签**，否则两个场景产出同一张 PNG。
6. **断言 `sideEffectFailures` 为空**（`multiLoad.sideEffectFailures = []`），与 `failures` 分开检查。
7. **撤下按可见对象数断言**（2026-11-05）：`evictDtxRefnos` 只隐藏对象，`getStats().totalObjects` 不会减少；
   用例按 refno 前缀数 `visible` 对象，并用 `window.__dtxShowRefnoApplied` 判断这一轮增量已生效。

## 验收命令（本轮全绿）

```powershell
npx vitest run src/components/dock_panels/multiBranLoadPlan.test.ts   # 27 通过
npx vitest run src/utils/refnoListParam.test.ts src/utils/refnoDbnumGroup.test.ts `
              src/dimension/ui/DimensionPanelDock.test.ts src/utils/mbdRefnoParam.test.ts  # 61 通过
npx vitest run                                            # 427 文件 / 4256 通过 / 1 todo / 0 失败
npm run type-check                                        # 0 条错误；基线 0；新增 0
npx playwright test e2e/multi-bran-e2e-tmp.spec.ts --workers=1 --reporter=line  # 2 passed ×2 次（18.4s / 18.5s）
```
