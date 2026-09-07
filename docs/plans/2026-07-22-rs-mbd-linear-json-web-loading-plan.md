# rs-mbd 线性尺寸 JSON Web 加载验证开发计划

日期：2026-07-22
状态：M1–M3 已实施；范围仅为 plant3d-web 直接加载 rs-mbd JSON
预计：约 1.75 人日

## 1. 目标

用 `rs-mbd-cli` 真实生成的 `MbdV2PipeData` JSON，打通并验证以下最小纵向链路：

`rs-mbd fixture → CLI JSON → Playwright 注入 plant3d-web → V2 契约校验 → source_mm 坐标转换 → externalRegistry → Canvas2D → SVG 导出`

本轮只证明 plant3d-web 能正确消费**线性外部尺寸 JSON**。不接入 `plant-model-gen` 或其他真实后端，也不宣称完整 MBD 已满足；角度尺寸、公差、基准、GD&T、特征控制框及真实 BRAN 联调均在本轮范围外。`DIMENSION_V2_CUTOVER` 保持关闭。

## 2. 已确认决策

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 里程碑边界 | 先完成 rs-mbd 线性尺寸纵切，暂缓角度、公差、基准和 GD&T |
| 2 | 测试边界 | 默认 CI 只使用确定性 fixture E2E，不访问真实 API 或外部服务 |
| 3 | fixture 管理 | 提交 rs-mbd CLI 生成物并记录复现命令；前端 CI 不编译 Rust |
| 4 | 视觉验收 | 结构化语义断言是门禁；截图仅作为人工审阅附件，不做像素 golden |
| 5 | 样本规模 | 首轮只用 `linear-small-dimension` 一个正向样本，并覆盖一个错误负载 |
| 6 | 失败策略 | 外部 JSON 整包校验、整包替换；失败清空来源并显示诊断，见 ADR 0046 |
| 7 | 发布开关 | 本轮不启用全局 `DIMENSION_V2_CUTOVER`，继续遵守 ADR 0039 |

既有边界继续有效：外部 MBD 尺寸只读且不写入用户尺寸文档（ADR 0019、0028）；SVG 使用当前视口布局导出（ADR 0031、0032）。

## 3. 实施前基线与已知问题

- `src/api/mbdV2Api.ts` 已提供前端 JSON 消费入口；E2E 使用 `page.route` 注入 fixture 响应。
- `src/composables/useMbdExternalSync.ts` 已完成 API/parquet 通道选择和竞态保护。
- `src/dimension/adapters/mbdV2Contract.ts` 已对注入的 JSON 负载做严格 V2 校验。
- `src/fixtures/mbd-v2/rs-mbd-cli-linear.json` 已存在工作区草稿，包含一个 `linear_dim`。
- `src/dimension/adapters/mbdV2ExternalAnnotations.test.ts` 的 CLI fixture 坐标期望仍写成 `-0.3`；当前 JSON 为 `-500 mm` 且矩阵缩放为 `0.001`，正确设计坐标应为 `-0.5 m`。
- 当前同步流程会记录 `mapped.skipped` 后继续替换部分记录；这与新确认的 ADR 0046 原子失败策略不一致。

实施时保留并整理上述现有工作区改动，不覆盖或回退无关修改。

## 4. 实施里程碑

### M1：冻结可复现的 CLI fixture 与单元基线（约 0.5 人日）

在 `rs-mbd` 仓库使用准确命令重新生成样本：

```powershell
cargo run -p rs-mbd-cli -- layout --fixture fixtures/p2-linear-dimensions.json --case linear-small-dimension --pretty --data-only
```

任务：

1. 人工比较输出与 `src/fixtures/mbd-v2/rs-mbd-cli-linear.json`，确认只包含一个 `linear_dim`，`input_refno=fixture:linear-small-dimension`，`geometry_space=source_mm`。
2. 提交 JSON 生成物，并记录生成命令、输出 SHA-256 及 rs-mbd 工作树状态；不在 plant3d-web CI 中增加 Rust、Cargo 或跨仓复制脚本。
3. 修正 `mbdV2ExternalAnnotations.test.ts` 的陈旧期望，固定关键转换结果：
   - 尺寸线：`[0, -0.5, 0] → [0.08, -0.5, 0]`
   - 标签锚点：`[0.116, -0.5, 0]`
   - 第一条箭头线：`[0, -0.5, 0] → [-0.024, -0.507, 0]`
4. 保留 `mbdV2Contract.test.ts` 直接读取该 fixture 的契约漂移守卫。

退出条件：契约与适配器单测全绿，重生成输出与 fixture 字节一致，来源记录不把带未提交改动的 rs-mbd HEAD 误写成独立可复现版本。

### M2：落实外部 JSON 负载的原子失败策略（约 0.5 人日）

涉及文件：

- `src/composables/useMbdExternalSync.ts`
- `src/composables/useMbdExternalSync.test.ts`
- 必要时补充 `src/dimension/adapters/mbdV2Contract.test.ts`

任务：

1. 保持当前顺序：先完成 JSON 契约解析与全部图元映射，再调用 `replaceExternalSource`。
2. 外部负载出现契约错误或任何 `mapped.skipped` 时，不提交部分记录；进入统一失败分支，清空 `mbd` 来源并写入 `loadError`。
3. parquet 装载阶段已有的逐行跳过继续保留；但转换成统一 V2 负载后出现映射失败时同样不得部分提交。
4. 增加最小单元检查：先装入旧记录，再返回含重复 id 或不可映射图元的负载，断言旧记录被清空、没有部分新记录、诊断包含失败原因。
5. 保持现有过期请求保护：旧请求的迟到响应不得恢复已被新请求清空的数据。

退出条件：ADR 0046 的“先校验、后原子替换、失败清空”由单元测试锁定。

### M3：增加确定性的 Web fixture E2E（约 0.75 人日）

新增 `e2e/dimension-mbd-v2-fixture.spec.ts`，直接复用现有应用入口和 `mbd_refno` 通道，通过 Playwright `page.route` 拦截前端请求并返回已提交的 CLI JSON；不启动或接入真实后端，不增加测试专用业务入口、mock 服务或依赖。

正向场景断言：

1. 页面使用 `?dimension_demo=1&mbd_refno=linear-small-dimension` 启动，HTTP 响应为 200。
2. `externalRegistry` 中恰有一个 `source=mbd` 记录，id、文本 `80`、角色和 M1 的设计坐标完全一致。
3. 该记录不进入 `DimensionDocument`；尝试删除或编辑返回失败，注册表记录保持不变。
4. 视口得到一个可见布局，Dimension Canvas 存在非透明像素，标签边界在可视区内。
5. `dimensionSystem.exportSvg()` 包含该尺寸 id、线和 LFF path，证明外部尺寸进入同一导出布局。
6. 生成 Playwright screenshot attachment 供人工查看，不提交像素基线。

错误场景断言：

1. 先成功装载正向 fixture，再切换到返回 200 但包含未支持 `angle_dim` 的无效 V2 负载。
2. 当前 `mbd` 来源被清空，不保留旧记录、不显示部分新记录。
3. 打开尺寸面板后，`[data-testid="mbd-load-error"]` 显示契约错误。

退出条件：该 E2E 在没有 rs-mbd 或任何后端进程时可重复通过，并进入默认 CI 门禁。

## 5. 验证顺序

```powershell
npx vitest run src/dimension/adapters/mbdV2Contract.test.ts src/dimension/adapters/mbdV2ExternalAnnotations.test.ts src/composables/useMbdExternalSync.test.ts src/dimension/facade/createDimensionSystem.test.ts
npm run type-check
npx playwright test e2e/dimension-mbd-v2-fixture.spec.ts
npm run lint
```

若修改 `ReviewPanel.vue` 或 `DesignerCommentHandlingPanel.vue`，还必须执行仓库指南规定的五套“双胞胎面板”回归；本计划正常实现不应触碰这两个文件。

| 门禁 | 必需内容 | 允许的结论 |
| --- | --- | --- |
| A：默认 CI | M1–M3 全部通过 | Web 已稳定接受该 rs-mbd 线性 fixture |

该门禁不等于真实服务集成或完整 MBD 生产切换；全局切换仍由 ADR 0039 的完整 Gate 5 决定。

## 6. 完成定义

- rs-mbd CLI 生成物与 Web fixture 有明确的来源命令、输出校验和及真实工作树状态记录。
- 契约、毫米到米转换、注册表、只读行为、Canvas 和 SVG 在同一浏览器测试中闭环。
- 无效外部负载原子失败，旧数据和部分数据都不会残留。
- 默认 CI 不依赖 Rust 构建、真实 API 或任何后端进程。
- 截图用于审阅但不作为跨平台像素门禁。
- `DIMENSION_V2_CUTOVER` 仍为 `false`。
- 不新增依赖、不引入每类型 feature flag、不扩大到非线性 MBD 图元。

## 7. 后置项

- 真实 BRAN、生产 API 与后端宿主集成必须另立计划，不作为本计划的验收项。
- 补齐 `angle_dim`、`aid_arc`、`aid_circle` 显式几何后再扩展 Web 契约。
- 完成 PNG 产品导出接线、校审往返、权限与性能 Gate 5 后，按 ADR 0039 评估统一生产切换。
- 公差、基准、GD&T 和特征控制框另立里程碑，不在本计划预埋字段或 UI。

## 8. 相关文档

- `docs/adr/0039-enable-the-new-dimension-system-only-after-complete-acceptance.md`
- `docs/adr/0043-adapt-mbd-data-only-through-the-frozen-v2-contract-shape.md`
- `docs/adr/0046-reject-invalid-live-mbd-payloads-atomically.md`
- `docs/plans/2026-07-20-mbd-external-annotation-primitives-dev-plan.md`
- `CONTEXT.md`（外部尺寸、尺寸标注系统、设计坐标）
