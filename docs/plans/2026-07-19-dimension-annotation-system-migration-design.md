# 新尺寸标注系统移植与 API 设计方案

日期：2026-07-19

状态：架构共识已确认；正式实现仍受 [Wayfinder 地图](https://github.com/happyrust/plant3d-web/issues/28) 中未关闭调查阻塞。地图完成后依次执行 `to-spec` 与 `to-tickets`，本文不替代最终规格和实施票。

## 1. 目标

删除当前尺寸标注子系统，参考 `../solvespace` 的尺寸呈现、布局、命中和编辑交互语义，建设一个独立、完整、易用的尺寸标注系统：

- 首版覆盖线性尺寸、投影线性尺寸、角度尺寸、径向/直径尺寸。
- 不移植 SolveSpace 几何约束求解器，不用尺寸驱动模型几何。
- 用户尺寸进入正式校审快照与回放。
- 外部/MBD 尺寸仍由来源系统拥有，通过能力适配器进入共享呈现系统。
- 旧 V5 `dimensions` 数据必须有明确迁移路径；删除旧代码不等于删除用户数据。
- 面向约 10,000 条加载、2,000 条同屏可见的工厂模型场景设计。

## 2. 领域边界

尺寸标注系统只拥有尺寸标注的创建、编辑、呈现和生命周期，不吞并：

- classic measurement 或 Xeokit measurement；
- 文字、云线、矩形、OBB 等校审批注；
- 焊缝、坡度等具有独立领域语义的外部标注；
- 外部/MBD 后端记录。

呈现能力可以复用，但领域记录、持久化与编辑权限必须保持分离。

## 3. 总体架构

```text
Vue / Ribbon / Panels
        |
        v
Friendly staged facade ----------------------+
        |                                    |
        v                                    v
DimensionDocument                       DimensionViewport (0..N)
- user records                          - camera/view transform
- drafts                                - incremental layout cache
- shared selection                      - local hover
- command history                       - spatial hit index
- recovery journal/review commit        - Canvas2D painter/glyph cache
- immutable snapshots/events            - pointer interaction
        |                                    |
        +---------------+--------------------+
                        v
              pure command/event core
                        |
        +---------------+----------------+
        |                                |
        v                                v
pure SolveSpace-like layout         source capabilities
- four dimension kinds              - writable user source
- renderer-neutral primitives       - read-only MBD/external sources
- shared visual/hit geometry        - temporary viewport visibility
        |
        v
single Canvas2D painter per viewport
```

架构遵守以下 ADR：

- ADR 0001：从零重建并删除旧尺寸标注子系统；
- ADR 0002：共享呈现，但不统一领域所有权；
- ADR 0003：纯布局函数加薄画家；
- ADR 0004：SolveSpace 布局语义作为样式基线；
- ADR 0005：锚点采用设计坐标快照加可重解析语义引用；
- ADR 0006：Document/Viewport 分离的意图级 API；
- ADR 0007–0017：统一布局结果、Design Space、放置意图、Canvas2D/LFF、派生标签、主题、碰撞与失效驱动；
- ADR 0019–0022：校审记录所有权、乐观版本、V5 失效迁移和删除前冻结 fixtures；
- ADR 0023–0029：投影/角度语义、SnapPort、意图事务、外部只读和 `STALE` 呈现；
- ADR 0030–0037：可访问列表、PNG/SVG 导出、结构化 golden、编辑权限、本地恢复日志、精度、显示单位和首版范围；
- ADR 0038–0039：构建全绿删除旧系统，完整验收后一次启用；
- ADR 0040：10k 加载/2k 可见的大型工厂模型性能预算（取代 ADR 0018）。

## 4. 公共 API 方向

### 4.1 系统入口

```ts
export interface DimensionSystem {
  readonly document: DimensionDocument;

  createViewport(port: DimensionViewportPort): DimensionViewport;

  attachSource<S, C extends DimensionSourceCapabilities<S>>(
    adapter: DimensionSourceAdapter<S, C>,
  ): Promise<Result<AttachedDimensionSource<S, C>, DimensionError>>;

  close(options?: {
    flush?: boolean;
    signal?: AbortSignal;
  }): Promise<Result<void, DimensionError>>;
}

export function openDimensionSystem(
  options: OpenDimensionSystemOptions,
): Promise<Result<DimensionSystem, DimensionError>>;
```

`openDimensionSystem` 注入 repository、锚点解析器、主题、格式策略、ID/时钟、当前操作者和来源适配器。核心内部不得自行创建网络客户端、读取 Vue store 或访问全局 `window`。

### 4.2 文档接口

```ts
export interface DimensionDocument {
  snapshot(): DimensionDocumentSnapshot;
  subscribe(listener: DimensionDocumentListener): Unsubscribe;

  beginLinear(options: BeginDraftOptions): LinearDraftStart;
  beginProjectedLinear(
    options: BeginDraftOptions,
  ): ProjectedLinearDraftStart;
  beginAngle(options: BeginDraftOptions): AngleDraftStart;
  beginRadial(options: BeginDraftOptions): RadialDraftStart;

  actions(
    handle: DimensionHandle,
  ): Result<BoundDimensionActions, DimensionError>;

  undo(): Result<void, DimensionError>;
  redo(): Result<void, DimensionError>;
  retrySave(): Promise<Result<void, DimensionError>>;
  flush(signal?: AbortSignal): Promise<Result<void, DimensionError>>;
}
```

规则：

- 只公开四个具名、分阶段的 draft 入口，不再公开通用 `addDimension(record)`。
- 未收集足够锚点的 draft 在类型上没有 `commit()`。
- `actions(handle)` 返回已经绑定并校验过的操作；UI 不拼装任意 patch。外部尺寸只返回查看来源详情、选择和当前视口临时隐藏等只读动作。
- 用户尺寸的持久编辑、重绑和删除只向作者本人或管理员返回；其他参与者只能选择、查看并在评论中引用。
- snapshot 不可变；变化通过类型化事件通知，Vue composable 只是薄适配器。
- 选择属于文档并跨视口共享；hover、pointer capture 和拖拽预览属于各视口。
- `retrySave()` 与 `flush()` 只保证本地恢复日志落盘；后端权威状态随现有校审保存、确认或提交事务一次写入。

### 4.3 分阶段 draft

```ts
const result = await document
  .beginProjectedLinear({ viewport })
  .from(anchorA)
  .to(anchorB)
  .along(axisAnchor)
  .useAbsoluteProjection()
  .placeAtScreen(pointer)
  .commit();
```

各类 draft 的完成条件：

- 线性尺寸：两个尺寸锚点；
- 投影线性尺寸：两个尺寸锚点和投影方向；
- 角度尺寸：顶点和两条有向射线上的锚点；
- 径向尺寸：圆/圆弧语义锚点，并选择半径或直径显示语义。

draft 拥有锚点收集、预览、校验、撤回当前锚点、提交和取消。pointer move 只更新预览；`commit()` 才生成一个领域事务、一个 undo 项和一条本地恢复日志记录。

### 4.4 视口接口

```ts
export interface DimensionViewport {
  snapshot(): DimensionViewportSnapshot;
  subscribe(listener: DimensionViewportListener): Unsubscribe;

  hitTest(screen: Vec2, tolerancePx?: number): readonly DimensionHit[];

  attachPointerController(
    element: HTMLElement,
    options?: DimensionPointerControllerOptions,
  ): Disposable;

  dispose(): void;
}
```

核心 API 只认识语义操作和平台无关的 pointer sample。可选 `DimensionPointerController` 负责把 DOM 鼠标、触控、修饰键和 pointer capture 映射为 draft/edit 命令；自动化和其他输入设备可以绕过它直接调用语义接口。

## 5. 内部状态机

公共 facade 后只有一个纯 command/event reducer：

```text
intent command
    -> validate/decide
    -> domain events
    -> pure reduce
    -> effects
    -> repository / anchor resolver / source adapter
    -> typed completion command
```

该状态机负责：

- draft 阶段与几何不变量；
- create/edit/delete；
- undo/redo 和拖拽事务合并；
- selection；
- anchor resolution 与失效态；
- 本地恢复日志、校审事务提交和乐观版本冲突；
- 外部来源刷新和过期响应丢弃。

调用方不直接 dispatch 内部 command，也不解释 effect。内部 reducer 是确定性回放、迁移和契约测试的主要 seam。

## 6. 尺寸锚点

锚点包含：

- 稳定来源标识；
- 几何语义和候选 key；
- 所属模型/坐标 frame；
- 以米为单位、未应用查看器重心平移或场景变换的设计坐标快照；
- resolved、degraded 或 unresolved 状态。

模型版本切换时批量重解析，不逐帧查询来源。解析失败时：

- 保留设计坐标快照，由各视口转换到当前场景坐标后降级显示；
- 不重新计算并伪装为当前值；
- 使用明确警告样式和状态；
- 提供重新绑定或删除操作；
- 校审回放保留原始证据。

锚点同时声明精度等级。只要包含模型表面点等近似锚点，尺寸仍可正常求值，但必须成为“近似尺寸”，在标签和详情中与精确尺寸区分；锚点无法解析时才进入“失效尺寸”。

投影线性尺寸的投影轴必须是稳定的 Design Space 方向，可来自 X/Y/Z、可重解析的边、管轴或工作平面轴，不能使用相机方向或屏幕水平/垂直。

## 7. 来源与能力

用户尺寸来源具备：

- create；
- persistent edit；
- delete；
- history；
- local recovery journal/flush；
- review snapshot commit。

外部/MBD 来源保持只读，适配器可提供：

- read；
- anchor resolve/pick；
- 当前视口会话内的临时 visibility；
- 来源详情与 authoritative label。

外部尺寸不允许移动尺寸线或标签、修改文字与样式、保存 override，也不复制为用户尺寸。不提供的能力在类型和运行时均不可调用；通用 UI 只使用 `actions(handle)` 返回的 bound actions，不持有来源泛型。

## 8. 布局、绘制与命中

每类尺寸有一个纯布局函数，输入：

- 规范化尺寸定义；
- 已解析锚点快照；
- `DimensionTheme` 与 `DimensionFormatPolicy`；
- camera/view/projection；
- viewport CSS size 和 DPR。

输出与 Three.js 无关的图元：

- line/polyline；
- V 形或填充箭头；
- text frame、姿态和背景框；
- drag handles；
- hit regions。

每个 `DimensionViewport` 在 Three.js 画面上维护一张透明、DPR-aware 的 Canvas2D overlay。薄 Canvas2D painter 只负责：

- 批量清理并绘制可见图元；
- LFF 矢量 glyph path 与精确 bounds 缓存；
- DPR、合成顺序和 viewport resize；
- 与 WebGL 画面的 PNG 合成；
- 从同一 `LayoutResult` 生成 SVG 尺寸叠层。

尺寸不创建 DOM、Object3D、Line2 或 Mesh，首版统一置于模型之前且不参与深度测试。视觉、hit-test、SVG 和导出必须消费同一份布局图元，禁止分别重算几何；布局不得依赖平台 `measureText()`。

SolveSpace 语义基线包括界线超出、箭头长度与半角、文字框切线、短尺寸外置、角度最小弧半径、径向 R/⌀ 前缀和参考尺寸表现。常量由统一 `DimensionTheme` 提供，不能散落在各类布局或画家对象中。

## 9. 主题与格式

`DimensionTheme` 是唯一视觉映射，把普通、外部参考、近似、失效等语义角色，以及 normal、hovered、selected 交互状态，映射为：

- 颜色和线型；
- 箭头和界线像素常数；
- LFF 字形和背景；
- 近似与 `STALE` 标识；
- SolveSpace 默认布局常数。

来源适配器和单条尺寸不得传入任意原始颜色、材质或画家参数。显示单位和精度由用户/视口级 `DimensionFormatPolicy` 管理，不进入 `DimensionDocument`，格式切换不产生文档版本；PNG/SVG 导出记录实际格式策略。

每条尺寸只保存有领域意义的结构化语义，例如：

- radius/diameter；
- minor/major angle；
- 自动或手工 label/line placement。

参考尺寸只能由外部工程来源声明，用户尺寸不提供“切换为参考尺寸”的动作。尺寸值始终由类型和锚点几何派生：长度以米、角度以弧度保存；用户尺寸不保存可背离几何的 `textOverride`，尺寸标签由统一单位、精度、符号和结构化前后缀格式化，只有外部只读来源可以声明权威标签文字。公差与 GD&T 不进入首版 schema，也不预留 nullable 占位字段。

Canvas context、glyph path cache 和其他运行时画家细节不得进入领域记录。

## 10. 错误、保存与历史

预期业务失败返回可判别 `Result` 和稳定错误码，例如：

- `INVALID_ANCHOR`；
- `DEGENERATE_GEOMETRY`；
- `READ_ONLY_SOURCE`；
- `DIMENSION_NOT_FOUND`；
- `STALE_REVISION`；
- `REPOSITORY_CONFLICT`；
- `SOURCE_UNAVAILABLE`。

真正的程序不变量破坏才抛异常；不得静默 `catch`。

保存采用“本地恢复日志 + 校审事务提交”：

- 每条已确认的意图命令异步追加本地恢复日志；
- snapshot 暴露 `clean | dirty | saving | retrying | failed`；
- `retrySave()` 与 `flush()` 处理本地日志落盘；
- 未提交状态在离开前明确提示；
- 后端权威尺寸文档只随校审保存、确认或提交事务携带 `baseVersion` 一次写入；
- 后端版本冲突时不 last-write-wins，由用户确认是否在最新文档上重放本地 command log。

撤销/重做覆盖用户尺寸的 create/edit/delete/placement/rebind。一次 pointer drag 合并为一个事务；selection、hover、显示格式和外部临时隐藏不进入历史。

## 11. 性能策略

目标：约 10,000 条加载、2,000 条同屏可见。

因此必须：

- 使用增量 document event，不在每次变化后重排全部记录；
- 按 document revision、anchor revision、theme revision、camera 和 viewport 缓存布局；
- 做视锥/屏幕裁剪，只布局或绘制可见候选；
- 使用屏幕空间空间索引进行 hit-test；
- 批量解析锚点和批量提交 painter 图元；
- 对 pointer move 合帧，避免每个原始事件触发完整布局；
- 缓存 LFF glyph path、文字 bounds、布局结果和 Canvas 绘制批次；
- 用真实 10k/2k 固定数据集建立性能验收。

## 12. 测试策略

主要 seam 是公开 `DimensionDocument` / `DimensionViewport` facade 的契约测试，使用：

- in-memory repository；
- fake anchor resolver/source adapter；
- headless projection adapter；
- renderer-neutral layout primitives；
- deterministic ID/clock。

契约测试覆盖：

- 四类 draft 完整阶段；
- 不完整/近似/失效/非法几何；
- create/edit/delete；
- shared selection/local hover；
- undo/redo 与 drag coalescing；
- recovery journal/retry/flush/review version conflict；
- capability enforcement；
- external read-only capability 与临时视口隐藏；
- V5 migration；
- review snapshot/replay。

布局层使用 SolveSpace 行为结构化图元 golden，不做脆弱的整图像素复制。真实浏览器只保留：

- Canvas2D painter、DPR 与 resize 测试；
- 少量像素冒烟；
- pointer controller 与浏览器事件 E2E；
- 多视口、模型版本切换和校审回放 E2E；
- PNG 合成与 SVG 叠层导出；
- 10k/2k 性能基准。

## 13. 移植阶段

这些阶段是开发顺序约束，不是最终 tickets；正式 tracer-bullet 拆分由 `to-tickets` 完成。

### 阶段 0：冻结保留契约

- 固化旧 V5 数据 schema、真实样例和迁移断言；
- 固化四类领域术语和外部来源所有权；
- 固化旧 `worldPos` 到设计坐标的转换依据和模型矩阵样例；
- 保存旧系统可观察行为清单，区分要保留与明确废弃的行为；
- 标记旧计划 `2026-02-06-solvespace-dimension-unify.md` 已被本方案取代。

### 阶段 1：删除旧尺寸标注子系统

- 删除旧领域状态、UI 模式、preview、渲染类、交互写回、样式 store 和持久化写路径；
- 只保留隔离的 V5 读取 DTO、固定样例和迁移测试资产；
- 删除后保持 type-check/build 通过，尺寸功能可按 ADR 0001 暂时不可用；
- measurement 与其他校审批注不得被连带删除。

### 阶段 2：建立纯领域核心与 facade

- 定义四类尺寸、锚点、主题角色、错误和 snapshot；
- 实现 command/event reducer、history 和 immutable events；
- 实现 Document facade、四类 staged drafts、bound actions；
- 以 in-memory repository 完成第一条端到端契约测试。

### 阶段 3：移植 SolveSpace 布局

- 建立 renderer-neutral primitive schema；
- 按线性、投影线性、角度、径向顺序移植布局语义；
- 为每类建立固定输入和图元 golden；
- 统一 visual geometry、drag handles 与 hit regions。

### 阶段 4：实现 Viewport 与 Canvas2D painter

- 实现 camera/world-per-pixel 适配；
- 实现单 Canvas2D overlay、LFF glyph cache、裁剪、布局缓存和 hit index；
- 实现 shared selection/local hover；
- 接入 optional PointerController 和拖拽事务。

### 阶段 5：恢复用户尺寸工作流

- 增加 Vue composable 薄适配；
- 恢复 Ribbon、创建面板、属性编辑、主题/格式设置和状态反馈；
- 接入语义锚点 pick、重新绑定和失效尺寸提示；
- 接入键盘、右键、撤销/重做和连续创建。
- 提供由 `DimensionDocument` 驱动的 HTML 语义尺寸列表，承担 aria、键盘导航、详情与 bound actions。

### 阶段 6：恢复并升级持久化与校审闭环

- 实现 V5 到新 schema 的兼容读取；
- 将旧 `worldPos` 明确迁移为米制设计坐标，禁止把查看器重心平移后的场景坐标写入新记录；
- 保持 project/db scope；
- 接入本地恢复日志、retry/flush 和未提交提示；
- 使用乐观 `baseVersion` 将用户尺寸随校审事务纳入确认、证据快照、导入导出和回放；
- 验证无法迁移记录的显式降级与告警。

### 阶段 7：接入外部/MBD 来源

- 建立 MBD source adapter；
- 映射来源尺寸与语义锚点；
- 只开放 hover、select、来源详情与当前视口临时隐藏；
- 验证来源刷新、断线、版本变化和临时隐藏清理；
- 禁止外部记录进入用户 repository。

### 阶段 8：规模与删除完成验收

- 跑 10k 加载/2k 可见、60 FPS 目标性能基准；
- 跑 facade 契约、layout golden、painter、E2E 和校审回放；
- 搜索并删除旧 `dim_` manager、旧 dimension store、旧 CSS2D/3D dimension API、失效样式与文档；
- 验证旧 V5 样例全部得到迁移结果或明确告警；
- 验证可访问尺寸列表、作者/管理员编辑权限、PNG 合成与 SVG 叠层导出；
- 发布 API 使用文档和来源适配指南。

## 14. Wayfinder 后续

本文已经解决“API 调用者与易用性目标”，但以下调查仍由地图中的独立票负责：

- SolveSpace 四类尺寸源码与行为事实；
- 旧系统完整删除边界；
- 四类用户工作流的细节；
- 真实原型反馈；
- 最终共享呈现内核接口；
- V5/校审/外部生命周期细则；
- 验收 seam 与 golden 数据。

这些票关闭后，`to-spec` 将本文和所有 resolution comments 合成为正式规格；`to-tickets` 再按可独立验收的 tracer bullet 建立 GitHub Issues 和阻塞关系。
