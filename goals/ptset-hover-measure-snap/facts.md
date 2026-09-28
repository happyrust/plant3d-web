# Facts（可测试/可验证的事实）

> 说明：以下事实由对 `plant3d-web` / `plant-model-gen` 的代码勘察推导得出（plannotator-setup-goal 允许“可由代码勘察回答的，直接勘察而非询问”）。带 [V] 标记的建议纳入自动化验证。

1. 关键点数据可通过 `pdmsGetPtset(refno)`（`/api/pdms/ptset/{refno}`）按构件获取，返回每点的局部坐标 `pt`、方向 `dir`、口径 `pbore` 及 `world_transform`、`unit_info`。
2. `usePtsetVisualizationThree` 已把关键点换算为场景坐标 `worldPos` 并存于 `visualObjects`，与测量拾取点同坐标系。
3. 所有测量取点（hover 预览 + 点击落点）都经过单一函数 `pickSurfacePoint()`（`useXeokitMeasurementTools.ts`）。 [V]
4. 由拾取命中 `objectId` 可解析出 `refno`（`resolveDtxRefnoByObjectId` / `parseRefnoFromObjectId`）。 [V]
5. 进入测量模式 hover 构件时，显示该构件关键点的十字标记；移开/退出后清除。
6. 测量光标与某关键点的屏幕像素距离小于阈值（默认 12px）时，落点被吸附为该关键点的精确场景坐标，并标记 `snapType='keypoint'`。 [V]
7. 吸附发生时给出区别于普通表面命中的视觉反馈（hover 标记变色 + lens 显示点号/口径）。
8. 提供“关键点捕捉”开关与像素阈值设置，可持久化；关闭后回到表面交点行为。
9. 吸附后的测量落点坐标与点集面板中对应点坐标在相同单位下数值一致。 [V]
10. hover 取数有防抖与按 refno 缓存、in-flight 去重；同一构件不重复请求。 [V]
11. `pickSurfacePoint` 保持同步返回；吸附只使用已缓存候选（首次 hover 某构件“先显示、后可吸附”）。
12. 适用四种测量模式：距离 / 角度 / 点标高 / 高差。
