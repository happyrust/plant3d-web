# 最小交付单元混合版本查看开发计划

日期：2026-07-22

## 目标

plant3d-web 通过参考号进入最小交付单元版本查看：目标单元按 `(dbnum, unit_refno, sesno)` 加载 DuckLake 不可变模型，周边对象始终来自一次对比会话内固定的 dbnum 最新汇总模型。默认使用单 viewport 切换 A/B，并支持双 viewport 分屏。

首个真实验收对象为 BRAN `24381_145018`：自动解析 `dbnum=7997`，A 为 `sesno=897` 且复用 `artifact_sesno=791`，B 为位置变化后的 `sesno=898`。

## 已确认约束

- 模型提交的业务身份是 sesno，不增加 `model_version_id`、release 或 `content_hash`。
- BRAN、HANG、EQUI、WALL、FLOOR 是最小交付单元根；HVAC 是单元内模型分类，不是新的根类型。
- 其他类型不建立历史，继续按 dbnum 汇总导出最新模型。
- dbnum 由参考号解析，界面不要求用户输入。
- 对比时只从环境模型隐藏目标单元完整子树；其他对象，包括其他最小交付单元，均保持最新。
- 环境模型在打开对比时固定；切换 A/B 或进入分屏不刷新，只有“刷新环境”或重新打开对比才更新。
- 环境或版本资产加载失败时不得静默使用旧缓存或不完整画面。

## 阶段 1：补齐后端模型状态契约

### 1.1 Tombstone 模型提交

修改 `plant-model-gen/src/version_management/cli.rs`、`src/web_server/model_runtime.rs` 和前端 `src/api/modelUnitVersionApi.ts`：

- 当增量证据表明最小交付单元根被删除时，使用上一提交保存的 `unit_noun`，记录 `impact_kind=tombstone`。
- tombstone 不生成或复用模型 manifest；API 的 `manifest_url` 返回 `null`。
- 前端版本侧类型允许 `manifestUrl=null`，只有 tombstone 可以缺少 manifest；其他影响类型缺少 manifest 必须报错。
- 保持现有 DuckLake 提交主键 `(dbnum, unit_refno, sesno)`，不新增删除表。
- 保持存量 schema 的 `artifact_sesno` 非空约束；tombstone 写入当前 sesno 作为兼容值，但 API 和 UI 不把它展示为模型资产。

最小检查：扩展 `src/version_store/model_unit_commit.rs` 现有测试，并增加 CLI 临时 DuckLake smoke，覆盖“存在 → tombstone”和幂等重试。

### 1.2 原子替换 dbnum 最新汇总模型

在 `plant-model-gen/src/fast_model/export_model/export_dbnum_instances_parquet.rs` 的 dbnum 全量导出调用路径中：

1. 将“写本地 artifact manifest”和“写 dbnum latest pointer”分开；`root_refno` 非空的最小交付单元导出不得写 latest pointer。
2. 将本次 dbnum 汇总文件写入独立 staging/generation 目录。
3. 验证 manifest 中声明的文件存在且行数/基础 schema 可读。
4. 将 generation 目录转为稳定可读目录。
5. 最后以同目录临时文件加 rename 的方式替换 `manifest_{dbnum}.json`。
6. 任一步失败都删除 staging，并保留上一份 latest manifest。

最小交付单元的 `model_units/{dbnum}/{unit_refno}/{sesno}/` 不走该 latest 替换路径，继续保持不可变。

第一阶段不实现会话感知的自动清理；先保留旧 generation 目录，待明确最长会话时间后再增加按时长清理，避免删除仍被 DuckDB 延迟读取的文件。

最小检查：在临时输出目录分别模拟中途失败和成功，断言失败后指针不变、成功后 manifest 引用的所有文件都属于同一 generation。

## 阶段 2：单 viewport 混合时间查看

修改 `plant3d-web/src/components/dock_panels/ViewerPanel.vue`、`src/components/model-version/ModelUnitVersionComparePanel.vue`、`src/utils/modelUnitVersionCompare.ts` 和现有 Parquet loader：

1. 打开对比时通过参考号解析 dbnum，并以 `forceRefresh` 读取真实的最新汇总 manifest；记录其 `generated_at` 和本次环境加载范围。对比路径禁止使用 loader 当前的“缺 manifest 时按固定文件名合成 manifest”兜底。
2. 使用最新树/可见范围查询取得目标单元完整子树，而不是只使用 A/B 差异 refno 并集。
3. 主环境层只隐藏目标子树，不再隐藏全部可见对象。
4. A/B 层沿用主环境层的全局坐标变换，不执行当前的左右平移和重新居中。
5. 默认只显示 B；A/B 切换只改变版本层显隐，不重新读取环境或移动相机。
6. 环境保留原始材质，A 使用蓝色、B 使用绿色。
7. 顶部持续显示 A/B 的 `sesno + generated_at + artifact_sesno`、环境 `generated_at`，以及“环境不是目标 sesno 历史全场状态”的提示。
8. “刷新环境”复用 loader 已有 `forceRefresh`，刷新成功后再替换当前环境；失败则保留错误状态，不把旧环境标成最新。
9. 校验版本 manifest 的 `dbnum` 和 `root_refno` 与所选单元一致；环境 manifest 必须属于解析出的 dbnum，且不能是 root-scoped artifact。
10. tombstone 侧显示“该版本单元已删除”，零对象不再统一解释为加载失败。

退出对比时恢复目标子树原显隐状态、释放 A/B 层，并保留用户进入对比前的其他环境显隐设置。

## 阶段 3：双 viewport 分屏

新增一个只服务版本查看的轻量分屏组件，例如 `src/components/model-version/ModelUnitSplitCompare.vue`；不复制完整 `ViewerPanel` 工具集。

- 左侧固定 A，右侧固定 B；两侧使用阶段 2 固定下来的同一环境 manifest、`generated_at` 和已加载 refno 范围。
- 两侧都隐藏目标单元最新子树，并在原始设计坐标加载对应版本；tombstone 侧为空态。
- 任意一侧旋转、平移、缩放时双向同步相机、投影模式和裁剪面，并用重入保护避免同步循环。
- 点击差异 refno 时两侧定位同一设计空间位置；某侧不存在该对象时不显示替代对象。
- 从单视口进入分屏时继承相机；从分屏返回时显示最后操作的一侧，未操作时显示 B。
- 第二个 WebGL viewport 创建或加载失败时释放其资源，回退单 viewport 并显示明确提示。
- 第一阶段不在右侧复制测量、标注和编辑工具。

退出分屏必须释放第二个 renderer、scene、事件监听和 GPU 资源。

## 阶段 4：验证与验收

### 自动检查

- 后端：tombstone 提交、NoOp 复用、原子 latest 替换失败/成功各保留一个最小测试或 CLI smoke。
- 前端 Vitest：默认 B、A/B 切换不刷新环境、只隐藏目标子树、环境时间提示、tombstone 空态、分屏状态切换和失败降级。
- 前端类型检查：`npm run type-check`。
- 浏览器：增加聚焦版本查看的 Playwright 流程；真实数据测试用环境开关启用，不让普通 CI 依赖本机输出目录。

### BRAN `24381_145018` 真实验收

1. 仅输入参考号并确认自动解析 `dbnum=7997`。
2. 版本列表显示 897、898 及各自生成时间；897 明确显示复用 artifact 791。
3. 单 viewport 默认显示绿色 B；切换 A 后显示蓝色 A，环境和相机不变化。
4. 最新环境模型保持可见，目标 BRAN 最新子树不存在重复几何。
5. 环境标签显示最新汇总 `generated_at`，并声明混合时间语义。
6. 分屏左侧 A、右侧 B，各加载 67 个对象；移动任一侧相机后另一侧保持同步。
7. 898 的位置变化在原始工程坐标及周边最新环境中可见。
8. 退出分屏和退出对比后，原查看器显隐与相机状态恢复，第二 viewport 资源已释放。
9. 保存单视口 A、单视口 B、分屏三张截图作为验收证据。

### 性能记录

用浏览器开发工具记录打开分屏前后 GPU/JS 内存、首次可交互时间和相机操作帧率。当前阶段只记录基线，不引入资源共享层；只有真实 BRAN 验收显示双份 GPU 数据不可接受时，才规划共享几何或单 renderer scissor 优化。

## 明确暂不实施

- 不为 dbnum 最新汇总模型建立 sesno 历史或 DuckLake 模型提交。
- 不增加自动轮询或 WebSocket 推送最新环境。
- 不增加第三种闪烁、透明混合或热力图对比模式。
- 不实现跨 viewport 测量、标注或编辑同步。
- 不重写既有不可变模型产物；矩阵布局继续使用现有 manifest/Parquet 兼容读取，出现新格式需求时再单独演进。
