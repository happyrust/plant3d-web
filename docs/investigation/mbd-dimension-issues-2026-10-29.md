# MBD 尺寸标注：缺陷与风险排查（2026-10-29）

范围：`?mbd_refno` → HTTP 取数 → 冻结 v2 契约 → 图元映射 → 外部注册表 → 尺寸内核布局 → 覆盖层绘制。
证据固定到 `62be3e9`（HEAD）。结论按「确认缺陷 / 设计风险 / 覆盖缺口」分类，未做任何代码改动。

## 摘要

链路本身是自洽的（单通道、原子拒绝、覆盖层后置渲染），风险集中在**失败时的可用性**与**契约的向前兼容**：
一条图元不合法就让整条分支的标注全部消失，而界面只在成功路径弹 toast，失败只在面板里留一行文字；
契约对未知 kind 与新增字段一律整包拒绝，后端一旦先行发布新图元，前端会「一片空白」而不是「少画一条」。
另有若干未使用的参数/死代码，以及指针交互触发的全量重排。

## 确认缺陷

| # | 位置 | 现象 | 影响 |
| --- | --- | --- | --- |
| D1 | `src/composables/useMbdExternalSync.ts:148-157`、`:198-200` | 第 148 行只要 `skipped` 非空就抛错，第 198 行的 `console.warn('[dimension-v2] skipped…')` 永远执行不到 | 死代码；排查时容易误以为有该日志 |
| D2 | `src/composables/useMbdExternalSync.ts:193` vs `:201-212` | `emitToast` 只在「成功但 issues 里有 error」时调用；`catch` 分支只 `diagnostics.set` + `console.warn`，不弹任何提示 | 取数失败/整包拒绝时，3D 视口直接空白，用户没有可见提示（除非主动打开尺寸面板） |
| D3 | `src/composables/useMbdExternalSync.ts:28` | `MbdExternalSyncOptions.forceRefresh` 声明后从未被读取；`ViewerPanel.vue:2856` 仍在传 `{ forceRefresh: true }` | 参数是空操作，读代码的人会以为存在「强制刷新/绕过缓存」语义 |
| D4 | `src/dimension/adapters/mbdV2Contract.ts:469-472` | 成功分支返回 `diagnostics: []`，契约层从不产出逐条诊断；`useMbdExternalSync.ts:142` 的 `channelSkipped` 因此恒为空数组 | 契约层的「跳过」语义只存在于注释与类型里，实际全部走 `ok:false` 单条错误 |
| D5 | `src/dimension/ui/DimensionPanelDock.vue:728-740` | 诊断按 severity 全量 `v-for` 渲染，无上限、无虚拟化 | 求解器一次回报上千条 issue 时，面板会一次性挂载同样多的 DOM 节点 |

### 修复状态（2026-10-29 第一轮：快速清理批次 B1 / B4 / C3 / D3）

| # | 状态 | 落地方式 |
| --- | --- | --- |
| D1 | 已修 | 删除 `useMbdExternalSync.ts` 里执行不到的 `console.warn('skipped MBD primitives')` 分支 |
| D2 | 已修 | `catch` 分支新增 `toastFailure()`：`error` 级、文案 `MBD 标注装载失败：<原因>`；**同一 refno 的同一句原因只弹一次**（换源或成功一次后复位），诊断仍每次写入 |
| D3 | 已修 | 删除 `MbdExternalSyncOptions.forceRefresh` 与 `ViewerPanel.vue` 的传参；`handleMbdLocationChange` 直接 `sync`（原本就没有缓存层可绕）。全仓其余 `forceRefresh` 属 DTX 装载器 / 模型源，与本链路无关 |
| D4 | 部分 | 未改行为，仅在 `MbdV2ParseResult.diagnostics` 上加类型注释说明「当前恒空，等 A3」；真正产出留给阶段 A |
| D5 | 已修 | 面板按组截断 50 条 + 「显示全部（还有 N 条）」按钮；标题仍报全量条数。`skipped` 列表同样截断 |

第二轮（B2 / B3）：D2 的可见性在面板侧补齐——「0 条记录 + `loadError`」时 BRAN 行挂「! 装载失败」角标，点开即诊断；R2（全有或全无）新增 `?mbd_partial=1` 开关，打开后跳过项只进诊断、其余照常渲染，并在面板常驻「已跳过 N 条」。注意契约层「一条图元非法 → `ok:false`」的路径仍未被覆盖，那要等 A2/A3。

对应的风险项：R3（失败不可见，产品层）随 D2 一并缓解；R4（后端基址可被 URL 改写）按 C3 收紧——`?mbdBackend` 现在只在开发构建或构建期显式 `VITE_MBD_ALLOW_QUERY_BACKEND=1` 时生效，否则忽略并 `console.warn` 一次（`?mbdBackendPort` 只能改端口、不能改主机，未动）。

## 设计风险

### R1（高）契约向前兼容：未知图元 / 新增字段 = 整包归零

- `mbdV2Contract.ts:304-350` 的 `isPrimitive` 对 `kind` 走 `switch`，`default: return false`。
- `:322-324` 的 `linear_dim` 守卫要求 `value.offset === undefined && value.suppressed_reason === undefined`——即**携带这两个字段的负载一律判为非法**（`MbdV2LinearDim` 类型里也没有它们）。
- `:452-459` 只要命中第一个非法图元就整体 `ok:false`，再由 `useMbdExternalSync.ts:148` 整包拒绝、清空来源。

后果：后端若先发布「新增一种图元」「给长度尺寸加 `suppressed_reason`（抑制尺寸）」这类演进，前端不是少画一条，而是**该 BRAN 的所有标注全部消失**，且 `?mbd_kinds` 过滤器也无法兜底（过滤发生在此校验之后）。

建议：区分「未知 kind」与「已知 kind 字段非法」。前者降级为一条 skipped 诊断并继续渲染其余图元（配横幅提示），后者维持整包拒绝；`offset`/`suppressed_reason` 要么进契约、要么明确在契约文档里禁止。

### R2（高）全有或全无：一条坏图元 = 整个分支空白

`useMbdExternalSync.ts:143-157`：`mapped.skipped` 非空即抛。ADR 0046 的初衷是防止「半对」的标注误导使用者，但没有提供「其余照画 + 顶部告警」的折中态。
在 3000+ 图元的真实 BRAN 上，单条重复 id 或单个未配对引线就会让整张图回到无标注状态。

建议：保留原子模式作为默认，但增加一个显式的降级开关（例如面板上的「部分显示（N 条被跳过）」），让工程现场至少有可用视图。

### R3（中）失败不可见（与 D2 同源，但属于产品层）

失败路径只写 `diagnostics.loadError`。面板是 dock，用户不打开就看不到；`loadError` 也没有写进 toast、没有在视口角落显示。
建议：失败时至少一次 toast（或视口角标），文案沿用后端信封里的中文 message。

### R4（中）后端基址可被 URL 任意改写

`src/api/mbdV2Api.ts:32-56`：`?mbdBackend=` 接受任意 `http(s)` 主机，`?mbdBackendPort=` 接受任意端口，二者优先于 `VITE_MBD_API_BASE_URL` 与 `buildBackendUrl`。
这是调试钩子，但会随构建进入生产：一个构造过的链接就能把标注数据请求指向第三方主机（客户端数据外流 / 钓鱼页面）。
建议：生产构建禁用该参数，或加主机白名单。

### R5（中）取数无超时、无取消

`src/api/mbdV2Api.ts:92-115` 的 `fetchMbdV2PipeData` 只在调用方给 `signal` 时才可中断；`useMbdExternalSync.ts:143` 调用时没传 `AbortSignal`。
`invalidate()` 只是让结果作废，网络请求仍在跑；后端挂起时 `sync()` 永不返回，界面没有 loading/超时提示。
建议：加 `AbortController` + 超时（例如 15s），超时也走统一失败分支。

### R6（中）大负载无大小护栏

`parseJsonResponse`（`src/utils/fileValidation.ts:153-160`）会 `await response.text()` 后整体 `JSON.parse`，没有体积上限。
MBD 负载随管道数量增长，超大数据会在主线程一次性解析并阻塞渲染。
建议：先看 `Content-Length`，超阈值（例如 20MB）给出明确的“数据过大”错误，或改流式解析。

### R7（中）指针交互触发全量重排

`dimensionViewport.ts:458-520`：只有 `reasons` 恰为 `{'interaction'}` 且有待重绘 id 时才走增量重样式；其余情况一律跑完整 `layoutViewport`。
`flushProjection()`（`:347-354`）用 `{'camera'}` 强行 `render()`，而它被 `pointerController.ts:136` 在每次指针交互时调用（`ViewerPanel.vue:3099` 也在用）。
`layoutViewport.ts:100-107` 每次重排都会重算去重叠、标签 billboard、标签避让，并在检视模式下对每条记录做一次射线（`occlusionPolicy.ts:124-146`），最后重建命中索引。
后果：拖拽/点选尺寸时按帧全量重排，图元多时掉帧。建议先看 `onFrame` 已经上报的 `layoutMs`，再决定是给 `{'camera'}` 走缓存还是给遮挡/命中索引做增量。

## 覆盖缺口

| 项 | 现状 |
| --- | --- |
| `src/dimension/adapters/pipeInformation.ts`（23 KB） | 无同名单测，负责管道属性到信息面板的映射 |
| `src/dimension/adapters/normalizeUserDimensions.ts` | 无单测（外部记录有 `normalizeExternalDimensions.test.ts`） |
| refno 归一化 | 两处规则不一致：`ViewerPanel.vue:227-233` 用 `\d+[\/_-]\d+` 且返回 `A_B`；`DimensionPanelDock.vue` 写 URL 时只 `replace('/','_')`（仅首个斜杠）。多段 refno 会得到不同字符串 |
| 公差 / GD&T | 仍是延期项（ADR 0037），契约与内核均无字段 |
| 端到端 | 有 `e2e/mbd-*.spec.ts`，但缺「后端返回未知 kind / 多一条非法图元」的回归用例 |

## 建议的修复顺序

1. **R1 + R2**：契约分层拒绝 + 显式降级模式（决定产品行为，需与后端约定演进策略）。
2. **R3 + D2**：失败必须可见（toast/角标），同时删掉 D1 死代码、D3 空参数。
3. **R5 + R6**：超时、取消、体积护栏——改动小、收益直接。
4. **R4**：生产禁用调试基址参数。
5. **R7**：先量 `layoutMs` 再优化；**D5**：诊断列表加截断或虚拟滚动。
6. 补 `pipeInformation` / `normalizeUserDimensions` 单测与 R1/R2 的回归用例。

## 未确认项

- 后端是否**已经**在产生 `offset` / `suppressed_reason`（若已产生，R1 是现网故障而非未来风险）。
- 真实 BRAN 的图元规模与 `layoutMs` 分位数（可跑现有 `perf` 脚本或打开 `onFrame` 指标采集）。
- `?mbdBackend` 的使用方是否包含外部交付物（决定 R4 能否直接在生产禁用）。
