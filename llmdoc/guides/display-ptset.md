# How to Display Ptset (Connection Points) in 3D Viewer

显示元件的连接点（ptset）数据是一个快速的操作流程。以下是具体步骤：

1. **在模型树中找到目标元件:** 在左侧模型树面板中，使用搜索框或滚动查找要显示连接点的元件。元件名称应该清晰可见。参考 `/llmdoc/architecture/ptset-visualization-system.md` 了解树形结构的工作原理。

2. **右键点击元件:** 在模型树中右键点击目标元件，会弹出上下文菜单，包含多个选项如"聚焦飞行"、"隔离"等。`src/components/model-tree/ModelTreePanel.vue:656` 定义了菜单项。

3. **选择"显示点集"菜单项:** 在右键菜单中点击"显示点集"按钮。系统会验证该元件的 refno 格式是否正确（格式如 `24383_84631`，使用下划线分隔）。`src/components/model-tree/ModelTreePanel.vue:442-449` 实现了这个验证逻辑。

4. **等待数据加载:** 系统向后端 `/api/pdms/ptset/{refno}` API 发起请求。加载过程中会显示吐司提示消息"正在加载点集数据: {refno}"。参考 `src/api/genModelPdmsAttrApi.ts:79-81` 了解 API 调用的实现。

5. **查看可视化效果:** 数据加载成功后，3D 场景会自动飞行到点集视图，显示：
   - **绿色球体:** 每个连接点的位置，球体大小与管道外径成正比
   - **橙色箭头:** 方向向量，指示连接点的朝向
   - **黑色标签:** 包含点号、坐标、管道外径等信息，实时跟踪相机视角

   实现细节见 `src/composables/usePtsetVisualization.ts:211-361`。

6. **与可视化交互:** 可以执行以下操作：
   - **旋转视角:** 使用鼠标中键或右键拖动相机，标签会自动更新位置。相机追踪实现见 `src/composables/usePtsetVisualization.ts:366-390`。
   - **缩放:** 使用鼠标滚轮缩放，标签投影位置同步更新。
   - **平移:** 使用鼠标拖动平移视角。

7. **验证显示成功:** 如果操作成功，吐司提示会显示"已显示 N 个连接点"（N 为实际点数）。如果失败，会显示错误信息或"未找到点集数据"。参考 `src/components/viewer.vue:63-75` 的错误处理逻辑。

**注意:** 只有具有有效 refno 格式的元件才能显示点集。房间树（ROOM）中的元件通常不支持此功能。请在 PDMS 树中选择元件。

