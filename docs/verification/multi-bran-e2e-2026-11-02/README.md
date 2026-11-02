# 多 BRAN 同屏端到端验证（2026-11-02）

把多 BRAN 链路（编解码、同步层、诊断、面板、模型树、几何侧 `show_refno`）第一次在**真实后端**上跑通：三条 BRAN 跨两个库同时带标注与几何，另加一个「混入不存在 BRAN」的逐包降级用例。

- 后端：`aios-database.exe` `:8022`（rocksdb 档，`/api/v1/health` 200，工程 `AvevaMarineSample`）
- 前端：Vite dev server `:3101`
- 验证脚本：`e2e/multi-bran-e2e-tmp.spec.ts`（临时 spec，`e2e/*` 不入库，验证完即删）
- 运行：`npx playwright test e2e/multi-bran-e2e-tmp.spec.ts --workers=1 --timeout=420000`，2 passed

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
| 几何对象 `__dtxLayer.getStats().totalObjects` | **85**（单 BRAN 基线 22；断言严格大于通过）|
| 装载过的库 `__dtxLoadedDbnos` | **[7997, 7999]**（跨库同屏成立）|
| `__dimensionSystemError` | **null** |
| 最近一次全量布局分解 | `layoutMs` 21.2 / `paintMs` 9.1 |
| 页面异常 `pageerror` | 0 |

单 BRAN 对照（single-bran.json）：只装 dbnum 7997、22 个对象、63 条标注。

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

## 截图

- `multi-bran-viewport.png`：三条 BRAN 同屏（顶栏烙印：请求 refno、已装库 7997 + 7999、对象 85）
- `multi-bran-degraded.png`：混入不存在 BRAN 后的降级场景

## 内存观察

三组几何**串行**装载（`runBranLoadPlan` 逐组 await），整个用例约 10 秒内完成，无 OOM、无页面崩溃——与「多组并发装几何会 OOM」的风险假设一致，串行是必要的。

## 验收命令（本轮全绿）

```powershell
npx vitest run src/dimension src/composables src/utils   # 241 文件 / 2238 通过
npm run type-check                                        # 新增 0 / 已消失 0
npx eslint src/components/dock_panels/ViewerPanel.vue src/dimension/ui/DimensionPanelDock.vue src/utils/
```
