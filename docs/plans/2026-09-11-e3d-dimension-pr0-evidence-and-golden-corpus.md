# E3D 尺寸标注移植 PR0：IDA 证据合同与实机金样语料

日期：2026-09-11  
状态：证据整理与采集规格已完成；001–003 首次采集被 E3D 启动故障阻塞  
后续：PR1 设计空间尺寸框架与验证器

## 1. 本阶段目标

PR0 不写业务实现。它先固定三件事：

- E3D 尺寸标注的可验证事实，以及每条事实的二进制来源；
- 哪些结论仍只是推断，禁止提前写入产品合同；
- 一套可重复的 E3D 实机采集清单，后续布局、交互、格式和错误行为都从金样生成测试。

结构化产物：

- IDA 证据矩阵：`docs/reverse-engineering/e3d-dimension-ida-evidence.json`
- E3D 实机金样清单：`docs/verification/e3d-dimension-golden-corpus.json`

## 2. 分析范围与方法

本轮通过 `ida-bridge` 只读查询下列已连接数据库：

- 主证据：`D:\ida_scratch\plant3\Core3D.dll.i64`
- 辅助排查：`D:\ida_scratch\plant3\core.dll.i64`
- 辅助排查：`D:\ida_scratch\plant210\core.dll.i64`
- 排除项：`libgeom.dll`、`libgm.dll`、`expdri.dll` 未发现本主题的尺寸呈现实现。

主库中使用了有界 `strings`、`string_refs`、`names`、`funcs`、`callers`、
`callees` 和 `pseudocode` 查询。没有修改函数名、类型、注释或 IDB。

可复核入口：

```powershell
ida-bridge exec idalib-49136 --sql "SELECT string_value, func_name, func_addr, ref_addr FROM string_refs WHERE string_value LIKE 'dimutil/%' OR string_value LIKE 'dimact/%' OR string_value LIKE 'dimension/%' ORDER BY string_value LIMIT 300"
ida-bridge exec idalib-49136 --sql "SELECT n, line FROM pseudocode WHERE func_ea = 0x101a3954 AND line != '' ORDER BY n LIMIT 360"
ida-bridge exec idalib-49136 --sql "SELECT string_value, func_name, func_addr, ref_addr FROM string_refs WHERE string_value LIKE 'STRU_GridAnnotations::%' ORDER BY string_value LIMIT 200"
```

`client_id` 只代表本次 IDA 进程；重开后应先执行 `ida-bridge list`，按 IDB 路径重新选择，
不要把 `idalib-49136` 当成长期标识。

## 3. 冻结的行为合同

### 3.1 两套子系统必须分离

E3D 至少存在两条尺寸链。

第一条是 Draft 持久尺寸：

```text
LINDIM
  ├─ DIMPPT（有序尺寸点、对象关联、位置/方向）
  └─ DIMPLI（投影/界线语义）
       ↓
DMCHEK → 尺寸/投影/视向验证 → Draft 绘制
```

第二条是结构网格自动标注：

```text
DrawList GRIDPL/GRIDCY
  → 收集可见网格图元
  → 按视图求标注位置
  → 生成距离文字、箭头和线
  → drawlist 增删或切换视图时清除并重建
```

移植约束：

- Draft 用户尺寸进入 `DimensionDocument`、权限、恢复日志、撤销重做和校审快照。
- 自动网格尺寸只能作为只读 external source 进入共享画家。
- MBD 保持现有只读 external source，不与上述两者合并所有权。

### 3.2 领域数据与呈现几何分离

E3D 的命名符号和伪属性读取表明，尺寸点和投影线是数据库语义对象，最终位置可以从对象引用重新求值。
因此 Web 记录必须保留：

- 设计坐标快照；
- 可重解析语义引用；
- 尺寸方向；
- 投影/界线方向；
- 尺寸平面；
- 设计单位下的偏移和文字放置意图。

相机、屏幕法向、CSS 像素和当前投影结果不能写入领域记录。

### 3.3 方向是三个不同概念

后续 schema 不得继续混用：

- measured axis：投影尺寸实际求值所沿的轴；
- dimension direction：尺寸线在设计空间中的方向；
- projection direction：锚点到尺寸线的投影/界线方向。

当前 `layoutProjected()` 的 axis 只覆盖第一个概念；`layoutLinearBetween()` 使用屏幕法向生成偏移，
不等于 E3D 的后两个概念。

### 3.4 先验证，后布局

PR1 需要将 `DMCHEK` 的事实映射成稳定错误，而不是复制错误号：

- `DIMENSION_DIRECTION_PARALLEL_VIEW`
- `PROJECTION_DIRECTION_PARALLEL_VIEW`
- `PROJECTION_DIRECTION_PARALLEL_DIMENSION`
- `DEGENERATE_DIMENSION_DIRECTION`
- `DEGENERATE_PROJECTION_DIRECTION`
- `UNRESOLVED_DIMENSION_POINT`
- `INVALID_DIMENSION_POINT_TYPE`

观察到的常量：

- 三维近似平行判断使用 `5e-5`；
- 二维投影行列式判断使用 `0.0025`；
- `DMANGL` 将 `angle / 90` 距最近整数小于 `0.01` 的角度吸附为 90° 倍数。

这些值先作为“E3D 观测值”进入金样，不直接成为最终 Web 常量。最终阈值必须同时通过实机边界样例、
设计空间单位分析和浏览器数值稳定性测试。

### 3.5 创建与编辑是事务状态机

E3D 的 action 入口大量使用 `SAVE`、`RESTORE` 和 `LABORT`。Web 不移植全局调度器，
而是映射为显式会话：

```text
pick-first
  → pick-second / pick-third
  → choose-axis-or-frame
  → place
  → ready
  → commit

任意中间态 → cancel/back → 无残留或恢复编辑前状态
```

当前 `editSession.ts` 已有类型化会话和 command journal，但收完锚点后直接进入 `ready`；
线性偏移固定为 `0.15m`，圆捕捉后的径向尺寸也会直接 ready。PR2 起必须补真正的 `place` 阶段，
不得只增加 UI 文案。

### 3.6 格式是策略，不是几何字段

`TXUVAL` 证明 E3D 集中执行长度/角度单位和精度格式化。Web 继续使用集中
`DimensionFormatPolicy`：

- 用户尺寸只持久化米/弧度语义值；
- 单位、精度、尾零和符号由显示策略产生；
- MBD 的权威文字仍是只读来源例外；
- 英制和角度格式在取得实机字符串前不得凭 IDA 除数自行补齐。

### 3.7 继续使用现有场景画家

`STRU_DrawLinearDimension` 已显示 E3D 使用场景线、矢量/挤出文字和填充箭头。
当前 `ThreeSceneDimensionPainter` 已采用批量 stroke quad、scene anchor + pixel offset、
矢量 LFF 文字、填充三角箭头和 depth-disabled overlay，方向与 E3D 事实一致。

因此 PR1–PR7：

- 不恢复旧 DOM、CSS2D、逐尺寸 Object3D 或 Canvas2D 方案；
- 只调整输入图元、布局和失效驱动；
- 保持用户尺寸、MBD、测量结果和自动网格来源共享画家但不共享领域所有权。

## 4. 当前代码基线

已经具备：

- 四类用户尺寸领域记录和纯布局入口；
- P-Point、实例原点、Primitive Key Point、模型表面点、圆/弧和方向捕捉；
- command reducer、undo/redo、恢复日志、校审持久化；
- Three.js 批量场景画家、命中索引、SVG；
- MBD 和测量结果的外部只读接入。

PR1 前确认的缺口：

- 线性尺寸用屏幕法向确定偏移方向，相机旋转会改变布局框架；
- measured axis、dimension direction、projection direction 未建模分离；
- 创建会话没有真实放置阶段；
- 缺少链式尺寸；
- 工具栏不显示当前步骤、Snap、方向或失败原因；
- E3D 样式常量与文本格式尚无实机合同；
- GRIDPL/GRIDCY 自动标注尚无独立 external source。

## 5. 实机金样采集 SOP

### 5.1 采集前

- 固定 E3D 完整版本、补丁号、项目、MDB、单位配置和尺寸样式。
- 使用可提交到测试语料的非敏感模型；记录所有 refno/noun。
- 固定窗口大小和视口投影；关闭会改变视觉结果的系统缩放或记录其值。
- 为每个 case 复制一份干净项目状态，避免前一个尺寸的样式或 current element 污染下一个 case。
- 不先参考 plant3d-web 输出，避免把现有实现反向写成“E3D 期望”。

### 5.2 每个 case

- 按清单执行动作，逐步记录状态栏/命令行提示。
- 在提交前后各截一张图；涉及相机或编辑的，每个关键状态单独截图。
- 导出或抄录尺寸层级、对象类型和全部相关属性。
- 记录锚点设计坐标、方向、相机和显示配置。
- 非法 case 必须保留完整错误号和消息，并确认是否产生了残留数据库元素。
- 保存原始数据，不手工“清洗”数值；派生值放在单独文件。

### 5.3 文件组织

建议落盘：

```text
test/fixtures/e3d-dimension/<case-id>/
  context.json
  actions.txt
  attributes-before.json
  attributes-after.json
  observed.json
  before.png
  after.png
  error.txt
  SHA256SUMS
```

只提交实际存在的文件；成功 case 不创建空 `error.txt`，无 before 状态的 case 不创建占位截图。

### 5.4 复核

- 采集者先填写 `observed.json`，另一人按截图和属性转储复核。
- 所有向量同时记录原始值和归一化值，但原始值是证据。
- 比较使用明确公差；不截断原始浮点数来制造相等。
- 截图只用于视觉复核；结构化属性和几何输出才是自动化 golden 的真源。
- 任何无法解释的 noun/attribute hash 保留原值和上下文，不猜名称。

## 6. 金样清单

`docs/verification/e3d-dimension-golden-corpus.json` 定义了 14 组：

1. 两个精确语义点的普通线性尺寸；
2. 相机旋转时设计空间放置保持不变；
3. World 轴投影尺寸；
4. 管轴语义方向及反向；
5. 正负偏移和取消恢复；
6. 短尺寸文字外置与箭头反转；
7. 三类近似平行非法方向；
8. 四点链式尺寸、退回一步和结束；
9. minor/major 角及近 90° 吸附；
10. 同一圆的半径/直径与 leader 放置；
11. 公制、英制、角度和精度格式矩阵；
12. 引用对象跨模型修订后的重解析与删除；
13. GRIDPL/GRIDCY 自动标注的增删和切视图生命周期；
14. 各创建阶段取消、编辑恢复和单次 undo 边界。

其中 1–12 为 PR1 开工前的 must corpus；13–14 可以与对应功能 PR 并行补齐，但 PR7 收口前必须完成。

## 7. PR0 验收状态

已完成：

- [x] 关键函数、地址、观察、工程含义和置信度已结构化记录。
- [x] 持久 Draft 尺寸与自动网格标注已划清所有权。
- [x] 当前 Web 实现与 E3D 合同的主要差距已定位到具体模块。
- [x] 14 组实机采集 case、必需上下文、产物和断言已定义。
- [x] 未证实项已明确列出，没有把数字 hash 或视觉常量冒充领域事实。

待外部 E3D 环境完成：

- [ ] 填写目标 E3D version/build 和采集机器。
- [ ] 完成 `E3D-GOLDEN-001` 至 `012`。
- [ ] 双人复核 must corpus。
- [ ] 从 observed 数据生成第一批结构化测试 fixtures。
- [ ] 对 plant3 与目标生产 E3D 版本做差异记录。

PR0 的文档与规格工作已经完成，但行为 gate 仍是 `blocked-on-e3d-runtime-capture`。
在 must corpus 未采集前，可以准备 PR1 的类型草案和测试 harness，不能把 IDA 观测阈值、
样式常量或未映射命令 case 直接作为生产默认值。

首次采集记录见
`docs/verification/e3d-dimension-capture-attempt-2026-09-11.json`：
本机 `des.exe` 2.1.0.3 与 `dra.exe` 2.1.0.35 均在创建顶层窗口前以
`System.IO.FileLoadException` 退出。未生成任何尺寸数据或截图；预先存在但无主窗口的
`des.exe` 进程未被终止。
