# E3D 测量操作模式开发方案 · 2026-07-10

## 0. 结论

本方案只做“E3D 风格的测量/捕捉操作模式”，不做完整 E3D 建模、Positioning Control 或 PowerWheel。理由很简单：当前代码已经有测量草稿、点源配置、P-Point 可视化、测量记录、面板和浮动条，最小有效路径是在这些现有能力上修正操作心智。

一期目标：

- Object Snap Filter 像过滤器，而不是黑盒自动裁决。
- P-Point 和 Item 原点是 E3D 模式的默认精确捕捉点。
- 模型表面点默认只是自由点/近似点，用户显式开启后才捕捉。
- P-Point 加载中不静默落成模型表面点。
- 捕捉提示直接告诉用户当前点源。
- 已完成测量支持右键菜单和连续距离测量。

## 1. 已确认的现状

当前主路径：

- 点源定义和排序：`src/composables/useMeasurementPickSources.ts`
- 测量工具主流程：`src/composables/useXeokitMeasurementTools.ts`
- 测量样式和点源持久化：`src/composables/useXeokitMeasurementStyleStore.ts`
- 测量记录和草稿状态：`src/composables/useToolStore.ts`
- 浮动测量条：`src/components/tools/MeasurementOverlayBar.vue`
- 测量面板：`src/components/tools/MeasurementPanel.vue`
- 面板提示格式：`src/composables/xeokitMeasurementUi.ts`
- 操作教程：`docs/guides/MEASUREMENT_TUTORIAL.md`

当前已经完成的基线：

- `position` 已改为 `Item 原点`。
- `mesh_pick_point` 已改为 `模型表面点`。
- E3D 默认点源策略已接近目标：P-Point 和 Item 原点默认捕捉，模型表面点默认不捕捉。
- 候选点排序已改成距离优先，近距离再用 priority 打平。
- 相关 Vitest 和 `npm run type-check` 已通过。

## 2. Grill 问题和推荐答案

### Q1：一期是否只做测量/捕捉，不做 E3D 定位和移动命令？

推荐答案：是。

原因：Positioning Control 是另一个产品域，涉及坐标输入、轴向约束、元素移动、权限和持久化。把它塞进本期会拖慢真正影响测量体验的改动。

### Q2：E3D 模式是否作为默认行为，而不是新增一个隐藏高级开关？

推荐答案：是。

原因：当前用户诉求就是“像 E3D”。同时保留模型表面点的显式开关，已有 Web 自由测量能力不会消失。

### Q3：浮动条点源开关应该控制 show 还是 snap？

推荐答案：只控制 snap。

原因：Object Snap Filter 的心智是“哪些点可以被捕捉”。候选点是否显示属于样式设置，放在测量面板里即可。

### Q4：P-Point 加载中，如果模型表面点捕捉也开着，是否允许落成表面点？

推荐答案：E3D 模式不允许。

原因：这正是用户觉得“第一次点不准”的来源。只有用户明确切到自由表面点模式，才允许表面点兜底。

## 3. 分阶段开发

### Phase 1 · E3D 捕捉模式契约

目标：把“E3D 模式”的行为固定成可测契约。

任务：

- 在点源配置中补一个明确的模式字段，建议叫 `measurementPickMode: 'e3d' | 'free_surface'`。
- `e3d` 模式默认：`ptset.snap=true`、`position.snap=true`、`mesh_pick_point.snap=false`。
- `free_surface` 模式允许模型表面点参与捕捉。
- 浮动条的 P-Point / Item 原点 / 模型表面点按钮只改 `snap`，不改 `show`。
- 面板保留 show/snap/threshold 的完整设置。

影响文件：

- `src/composables/useXeokitMeasurementStyleStore.ts`
- `src/components/tools/MeasurementOverlayBar.vue`
- `src/components/tools/MeasurementPanel.vue`

测试：

- `MeasurementOverlayBar.test.ts` 验证浮动条只切 `snap`。
- `MeasurementPanel.test.ts` 验证模式切换后的点源状态。
- `useMeasurementPickSources.test.ts` 保留距离优先和 tie-break 测试。

### Phase 2 · P-Point pending 防误捕捉

目标：P-Point 还在加载时，不创建错误的表面点测量。

任务：

- 复用 `requestedPtsetRefnos`、`ptsetResponseByRefno`、`ptsetErrorByRefno`，增加一个很小的判定函数，例如 `getPtsetLoadState(refno)`。
- 在 `pickSurfacePoint()` 中判断：E3D 模式、P-Point 捕捉开启、当前 refno 已触发请求但尚无候选时，返回 `hit:null` 和 pending reason。
- 已经有 preview 时只显示候选，不创建 draft 或 record。
- pending 文案复用 `ptsetMissReason()`，避免再造一套状态提示。

影响文件：

- `src/composables/useXeokitMeasurementTools.ts`
- `src/composables/useXeokitMeasurementTools.test.ts`

测试：

- `ptset.snap=true`、`mesh_pick_point.snap=true`，第一次 hover 触发异步加载但 promise 未 resolve。
- 立即 pointerup 不创建 distance draft 或 record。
- ptset resolve 后再次 pointerup，创建 `sourceInfo.source === 'ptset'` 的测量点。

### Phase 3 · 捕捉提示语义化

目标：用户看到的是业务点源，不是内部优先级和像素调试信息。

任务：

- `getPointerLensText()` 不再显示 `优先级`。
- 命中 P-Point 显示 `P-Point #n`。
- 命中 Item 原点显示 `Item 原点`。
- 命中模型表面点显示 `模型表面点（近似）`。
- `formatXeokitHoverHint()` 同步使用业务文案。

影响文件：

- `src/composables/useXeokitMeasurementTools.ts`
- `src/composables/xeokitMeasurementUi.ts`
- `src/composables/xeokitMeasurementUi.test.ts`
- `src/composables/useXeokitMeasurementTools.test.ts`

测试：

- 命中不同点源时 pointer lens 的 title/subtitle 正确。
- 未命中时显示当前启用的 snap filter。

### Phase 4 · 候选点范围扩展

目标：不只考虑当前射线命中的 `surfaceRefno`，补齐“鼠标附近 P-Point 可被捕捉”的 E3D 体验。

任务：

- 把 `buildPtsetCandidates(base, refno)` 改成接收 refno 列表。
- 候选 refno 来源先只取：`surfaceRefno`、`currentHoverRefno`、`lockedMeasurementRefnos`。
- 可选使用已缓存 P-Point，但限制屏幕距离和数量。
- 不扫描全场景。

影响文件：

- `src/composables/useXeokitMeasurementTools.ts`
- `src/composables/useXeokitMeasurementTools.test.ts`

测试：

- 射线命中 A，但已缓存 B 的 P-Point 更靠近鼠标，期望命中 B。
- locked 起点所在 refno 在终点捕捉阶段继续显示和参与候选。

### Phase 5 · 测量右键菜单

目标：补齐 E3D 最常用的完成后操作入口。

第一版菜单项：

- Display Axis
- Change Unit
- Copy Distance
- Copy XYZ Components
- Delete Measurement
- Repeat Measure

最小实现：

- 不新建复杂菜单框架。
- 在 viewer overlay 中监听测量 annotation 的 contextmenu。
- 右键时设置 `activeXeokitMeasurementId`。
- 菜单 actions 调现有能力：`updateStyle()`、`unitSettings`、`removeMeasurement()`、`flyToMeasurement()` 或新增最小 copy helper。

影响文件：

- `src/composables/useXeokitMeasurementTools.ts`
- `src/components/tools/MeasurementOverlayBar.vue` 或新增一个很小的 `MeasurementContextMenu.vue`
- `src/composables/useXeokitMeasurementStyleStore.ts`
- `src/composables/useUnitSettingsStore.ts`

测试：

- 右键某条 distance measurement 后，菜单绑定当前测量 id。
- Copy Distance 写入剪贴板文本。
- Copy XYZ Components 使用当前显示单位和精度。
- Display Axis 切换 `distanceShowAxisBreakdown`。
- Delete Measurement 删除当前测量。

### Phase 6 · 连续距离测量

目标：距离测量完成后可以继续测下一段。

任务：

- 只支持 distance，不先扩展 angle/elevation。
- 增加一个状态：`continuousDistanceMeasureEnabled`，或先用 Spacebar 触发一次 repeat。
- 完成 A-B 后，如果连续模式开启，创建下一条 draft：origin = B，target = B。
- Repeat Measure 菜单项复用同一逻辑。
- 退出测量或点击空白时清草稿。

影响文件：

- `src/composables/useXeokitMeasurementTools.ts`
- `src/composables/useToolStore.ts`
- `src/components/tools/MeasurementOverlayBar.vue`

测试：

- A-B 完成后，开启连续模式时 records +1，同时新 draft origin 等于 B。
- 下一次点击 C 后生成 B-C。
- 非 distance 模式下 Spacebar 不创建草稿。

### Phase 7 · 操作文档更新

目标：让用户按 E3D 操作心智学习，而不是按内部实现学习。

任务：

- 更新 `docs/guides/MEASUREMENT_TUTORIAL.md`。
- 增加 Object Snap Filter、P-Point pending、Item 原点、表面点自由测量、右键菜单、连续测量章节。
- 示例仍使用 `AvevaMarineSample` 和 BRAN `24381_145018`。

## 4. 不做清单

本期不做：

- 完整 PowerWheel。
- 完整 Positioning Control。
- 元素移动/定位命令。
- 从 mesh 自动生成 Primitive Key Point。
- 全场景 P-Point 扫描。
- 管道拓扑级智能捕捉。
- 测量存储大重构。

这些都不是当前“不像 E3D”的主因。

## 5. 验证计划

最小必跑：

```bash
npx vitest run \
  src/composables/useMeasurementPickSources.test.ts \
  src/composables/useXeokitMeasurementTools.test.ts \
  src/composables/xeokitMeasurementUi.test.ts \
  src/components/tools/MeasurementPanel.test.ts \
  src/components/tools/MeasurementOverlayBar.test.ts

npm run type-check
```

右键菜单完成后补一条 Playwright 或 DOM 集成验证：

- 启动测量。
- 创建 A-B 距离。
- 右键测量。
- 验证菜单项、复制、删除、Display Axis。

人工验收：

- 打开 `AvevaMarineSample`。
- 显示 BRAN `24381_145018`。
- 第一次靠近 P-Point 时不应误生成表面点测量。
- P-Point 加载完成后，提示显示 `P-Point #n`。
- Item 原点提示不再写成中心点。
- 表面点只有显式开启后才能作为测量点。
- A-B 完成后可继续 B-C。

## 6. 推荐提交顺序

1. `feat(measurement): add e3d snap mode contract`
2. `fix(measurement): block mesh fallback while p-point is pending`
3. `feat(measurement): show semantic snap hints`
4. `feat(measurement): include nearby cached p-points`
5. `feat(measurement): add measurement context menu`
6. `feat(measurement): support continuous distance measuring`
7. `docs(measurement): update e3d-style measurement guide`

## 7. 主要风险

- 老用户 localStorage 中已有点源配置，可能覆盖新默认。需要在样式存储里做一次版本迁移。
- P-Point 数据加载速度不稳定，pending 保护必须只挡 E3D 模式，不能让自由表面点模式变得难用。
- 右键菜单需要和 viewer 现有 annotation 选择逻辑配合，避免吞掉浏览器默认事件后没有选中测量。
- 连续测量只先做 distance，避免角度和标高草稿逻辑被牵连。

## 8. 下一步建议

先做 Phase 2。Phase 1 的大部分默认值已经落地，真正会继续制造错误测量的是 P-Point pending 期间的表面点兜底。这个改动小，测试明确，收益最大。
