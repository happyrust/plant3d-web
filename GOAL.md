# Goal: MBD 三维交互管道尺寸标注生产级交付

## 当前任务

在 `plant3d-web` 前端与 `plant-model-gen-cata-closure` 后端配合下，生产级实现真实 AVEVA/E3D BRAN 管道的 MBD 三维交互尺寸标注。用户应能在普通三维页面中，通过模型树右键菜单或 Ribbon 菜单打开真实管道的尺寸标注。标注必须绑定真实三维锚点，随相机旋转、缩放、平移保持正确位置和可读性，并提供设置页面配置尺寸线、箭头、文字、引线、管道轮廓、管件强调、标签、避让和可见性。

首个真实验收 BRAN:

- `2013286704/476`
- URL/key 兼容形式: `2013286704_476`
- 测试站点: `D:\AVEVA\Projects\E3D2.1\AvevaPlantSample\aps000\aps250160_0001`
- 元件库依赖: `D:\AVEVA\Projects\E3D2.1\AvevaCatalogue`
- 后端部署包来源: `D:\work\plant-code\plant-model-gen-cata-closure\dist\package`

当前新增真实验收 BRAN:

- `24381_145018`
- dbnum: `7997`
- 项目: `AvevaMarineSample`
- 数据要求: 默认使用本地生成数据链路，即配置的 `output_root` 下的 cache/parquet；不能因为 SurrealDB 或旧 JSON 缺失而只显示部分模型。
- 当前诊断目标: 先修复模型树、`visible-insts`、MBD parquet API 对同一份 `output_root` 的一致使用，再进入三维 MBD 标注验证。

## Done 定义

完成不是“能跑起来”，而是满足以下条件:

- 真实用户可以打开普通三维页面，选择真实 BRAN，并通过菜单开启 MBD 三维标注。
- 标注不是截图、固定 overlay 或固定 drawing 视角；旋转和缩放相机后仍与管道锚点一致。
- `full/drawing/length` 仅作为兼容 preset；内部架构采用五轴模型: `requestIntent`、`dataScope`、`layoutMode`、`renderMode`、`styleProfile`。
- 后端负责相机无关的语义数据、拓扑、尺寸、材料、标签、layout hint、issues/capabilities；前端负责相机相关投影、billboard、避让、LOD、样式和交互。
- 样式设置页面可配置并热更新当前标注，且有默认值、输入清洗、持久化和迁移策略。
- 至少覆盖真实 BRAN `2013286704_476` 的菜单/Ribbon 端到端验证；逐步扩展到多 BRAN corpus。
- 所有新增/改动逻辑有单元测试、集成测试或明确的真实浏览器验证。
- 文档包含架构、文件结构、错误处理、测试矩阵、性能策略、交接说明。
- 最终 review pass 对所有需求逐项给出当前证据，不留下明显生产风险。

## 成功标准

### 用户体验

- 模型树右键菜单中可以对 BRAN 触发 `生成 MBD 标注`。
- Ribbon 中可以触发 `MBD -> 生成标注` 和 `MBD -> 标注设置`。
- 普通 `mbd_refno` URL 默认进入三维交互 `full`，显式 drawing preset 才进入固定图纸。
- `2013286704_476` 能显示核心长度，例如 `600`、`1073`、`783`。
- 标注线、箭头、文字、材料/坐标/PE 标签在相机变化后仍跟随真实模型锚点。
- 后端失败、数据缺失、模型预加载失败时有 toast/debug issue，页面不崩溃。

### 架构

- 请求层通过兼容 preset 映射到五轴 MBD 请求。
- Viewer 编排从大型组件中逐步抽出: preset mapping、API 参数、request gate、model preload、response adapter、debug snapshot。
- 渲染层逐步拆分: projection、screen avoidance、LOD、dimension renderer、label renderer、leader renderer、pipe/fitting emphasis。
- 样式层从 `drawing` 命名升级为通用 MBD annotation style，并拆分 style/visibility/layout profile。
- 后端 `mbd_pipe_api.rs` 保留兼容 route，但逐步拆出 contract/service/repository/domain/adapter。

### 验证

- 每个实质步骤后记录验证结果到 `.planning/2026-06-19-mbd-interactive-3d-annotations/progress.md`。
- 前端最小验证集:
  - `npm run type-check`
  - 聚焦 Vitest: URL preset、request mapper、API param builder、renderer/style
  - Playwright: Ribbon、模型树右键、竞态、样式设置
- 真实后端验证:
  - `MBD_REAL_UI_E2E=1`
  - `MBD_REAL_BACKEND_URL=http://127.0.0.1:18082`
  - `MBD_REAL_OUTPUT_PROJECT=aps250160-mbd-cata2`
  - `MBD_REAL_REFNO=2013286704_476`
- 多 BRAN 验证在 `aps250160-mbd-multibran` 可用时扩展到 `2013286704_497`、`2013286704_508`、`2013286704_488`。

## 当前架构决策

- 保留: 菜单/Ribbon 默认 `displayMode='full'`，显式 drawing preset 才走固定图纸。
- 保留: V2 API 优先、V1 兼容 fallback。
- 保留: `showInlineTubeLengthDims` 和 `showPipeVisualEmphasis` 与 drawing preset 解耦。
- 改进: 把 `displayMode` 作为外部兼容层，内部转为五轴请求。
- 改进: 对 `layout_result` 缺失的 full 模式做 semantic fallback，不作为 fatal。
- 改进: 所有 API/渲染问题通过标准 issue/capability 表达，便于 UI、测试和后端排查。
- 改进: 多 BRAN 真实验证不再只依赖 `18082/aps250160-mbd-cata2`；`18083/aps250160-mbd-multibran` 已通过真实浏览器 corpus 验证，覆盖 `2013286704_497`、`2013286704_508`、`2013286704_488`。
- 改进: `2013286704_497/508` 暴露出的 dense label overlap 已通过通用避让/LOD/语义槽位策略修复；生产代码未加入 refno 特例，也未放宽 severe-overlap 预算。
- 禁止: 为单个 BRAN/refno 写特殊规则。
- 禁止: 用截图、固定 overlay 或 drawing fixed-view 假装三维交互标注。
- 禁止: 为了让页面看起来有树或有模型，在前端创建假根、假子节点或绕过后端数据错误的兜底路径。真实 BRAN 加载失败时必须定位后端数据源、TreeIndex、parquet/cache 或站点输出配置问题。

## 进度文件

阶段进度和验证记录维护在:

- `.planning/2026-06-19-mbd-interactive-3d-annotations/progress.md`
- `.planning/2026-06-19-mbd-interactive-3d-annotations/findings.md`
- `.planning/2026-06-19-mbd-interactive-3d-annotations/task_plan.md`

架构文档维护在:

- `docs/plans/2026-06-19-mbd-interactive-3d-annotation-architecture-plan.md`
- `docs/plans/2026-06-19-mbd-oracle-architecture-development-plan.md`

## 下一阶段计划

1. 把本轮最终 review 结果写入进度文件，按 Done 定义逐项给证据。
2. 保持聚焦 MBD Vitest、`npm run type-check`、真实 primary BRAN UI E2E、真实 multibran corpus E2E、race E2E 和 build 作为交接验证矩阵。
3. 渐进抽出 request gate/model preload/response adapter、projection/avoidance/LOD/renderer 子模块，保持现有 E2E 行为不变。
4. 扩展 style/visibility profile 的命名、迁移和项目级/用户级覆盖策略。
5. 后续若要标记整个仓库无风险，需要单独处理既有非 MBD `npm test` 全量失败。
