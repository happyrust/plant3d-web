# 管道建模模块 — 操作流程与 UI 设计方案

> 基于 AVEVA E3D Design 源码 (`pipeEditor.pmlfrm` setTask 状态机) + 在线教程分析

---

## 1. E3D 管道建模核心状态机

从 `pipeEditor.pmlfrm` 的 `setTask()` 方法提取的状态流转：

```
Initialise → createPipe → modifyPipe → editBranch → editHead/editTail → connectEnd
                                ↑              ↓
                          modifyPipeData   modifyBranchData
                                ↑              ↓
                              warning ←→ resumeTask
```

### 状态定义

| 状态 | 含义 | 对应 UI 面板 |
|------|------|-------------|
| `Initialise` | 初始化，隐藏所有面板 | — |
| `createPipe` | 创建新管道 | 管道编辑器 → 管道信息区 |
| `modifyPipe` | 修改管道（选择分支） | 管道编辑器 → 分支列表 |
| `modifyPipeData` | 修改管道属性 | 管道编辑器 → 管道信息编辑 |
| `editBranch` | 编辑分支 | 管道编辑器 → 分支详情 |
| `modifyBranchData` | 修改分支属性 | 管道编辑器 → 规格/工艺参数 |
| `editHead` | 编辑 Head 端 | 管道编辑器 → Head Tab |
| `editTail` | 编辑 Tail 端 | 管道编辑器 → Tail Tab |
| `connectEnd` | 连接端点 | 管道编辑器 → 连接选择 |
| `warning` | 警告/提示 | 警告对话框 |

---

## 2. 标准管道建模操作流程

### 流程一：手动管道建模（Manual Pipe Routing）

```
步骤 1: 进入 PIPING 模块
  ├─ 操作: 点击 Ribbon → "管道" Tab
  └─ UI:   Module Tabs 切换到 "管道"

步骤 2: 创建管道 (Pipe)
  ├─ 操作: 点击 Ribbon → 创建组 → "管道" 按钮
  ├─ UI:   打开管道编辑器面板 (pipe-editor-panel)
  ├─ 输入: 管道名称 (/100-P-001)
  ├─ 输入: 选择主系统 (Re System)
  ├─ 输入: 选择管道规格 (CS/150 Carbon Steel 150#)
  ├─ 输入: 设置保温/伴热 (可选)
  └─ 动作: 点击"创建管线"按钮

步骤 3: 创建分支 (Branch)
  ├─ 操作: 在分支列表中点击"添加分支"
  ├─ UI:   分支列表区域展开
  ├─ 输入: 分支名称自动生成 (/100-P-001-B1)
  ├─ 输入: 选择分支规格（继承管道或自定义）
  ├─ 输入: 设置公称直径 (DN150)
  └─ 动作: 分支创建完成，进入分支编辑模式

步骤 4: 设置 Head 端连接
  ├─ 操作: 切换到 "Head 端" Tab
  ├─ UI:   Head/Tail 标签页 → Head 端
  ├─ 方式 A: 输入坐标 (E/N/U)
  ├─ 方式 B: 拾取 3D 视图中的设备管口 (Nozzle)
  ├─ 方式 C: 连接到已有分支端点
  ├─ 输入: Head 端方向 (Direction)
  └─ 输入: Head 端公称直径

步骤 5: 设置 Tail 端连接
  ├─ 操作: 切换到 "Tail 端" Tab
  ├─ UI:   Head/Tail 标签页 → Tail 端
  └─ (同 Head 端操作)

步骤 6: 管道路由（放置管件组件）
  ├─ 操作: 沿管道路径逐个放置管件
  ├─ UI:   管件编辑器面板 (component-editor-panel)
  ├─ 6.1: 选择管件类型（弯头/三通/异径管/法兰/阀门等）
  ├─ 6.2: 选择子类型（长半径/短半径/RFWN/RFSO 等）
  ├─ 6.3: 设置参数（角度/半径/公称直径）
  ├─ 6.4: 拾取放置或选择创建
  └─ 重复直到管道路径完成

步骤 7: 验证管道连通性
  ├─ 操作: 检查分支连接状态
  ├─ UI:   分支列表中 Head/Tail 列显示连接状态
  └─ 检查: OPEN / 已连接设备 / 已连接其他分支

步骤 8: 设置工艺参数
  ├─ 操作: 展开工艺参数区
  ├─ 输入: 设计温度 (120°C)
  ├─ 输入: 设计压力 (1.6 MPa)
  └─ 动作: 点击"应用"
```

### 流程二：2D 草图管道建模（Auto-Route / Easy Editor）

```
步骤 1-3: 同手动建模（创建管道和分支）

步骤 4: 切换到草图模式
  ├─ 操作: 在 Application Dock 中切换到 "草图" Tab
  ├─ UI:   管道草图面板 (pipe-sketching-panel)
  └─ 说明: 使用 2D 概念进行 3D 管道路径定义

步骤 5: 定义路径点
  ├─ 操作: 点击"创建点"工具 (pickPoints)
  ├─ UI:   路径点工具栏 → 第1个按钮
  ├─ 5.1: 在 3D 视图中拾取点，或手动输入 E/N/U 坐标
  ├─ 5.2: 每个点自动添加到路径点列表
  ├─ 5.3: 可启用正交模式 (Orthogonal) 限制方向
  ├─ 5.4: 可启用偏移模式 (Offset) 相对定位
  └─ 重复直到路径定义完成

步骤 6: 插入管件组
  ├─ 操作: 使用快捷操作按钮
  ├─ 6.1: 点击"法兰组" → 自动插入 法兰+垫片+法兰
  ├─ 6.2: 点击"阀组" → 自动插入 法兰+垫片+阀门+垫片+法兰
  └─ UI:   快捷操作区域的按钮

步骤 7: 自动路由
  ├─ 操作: 系统根据路径点自动生成管道路由
  ├─ UI:   Quick Pipe Router 开关
  ├─ 选项: 使用弯头 (Use Bends) 或弯管 (Use Bends off)
  └─ 结果: 自动放置弯头/直管连接各路径点

步骤 8: 镜像（可选）
  ├─ 操作: 选择已有管道元素 → 点击"镜像"按钮
  ├─ UI:   镜像面板 (Mirror Selection)
  ├─ 输入: 镜像方向 / 镜像位置
  └─ 结果: 创建对称管道分支
```

### 流程三：管道分割与合并

```
步骤 1: 打开分割面板
  ├─ 操作: 在 Application Dock 中切换到 "分割" Tab
  └─ UI:   管道分割面板 (pipe-splitting-panel)

步骤 2: 选择模式
  ├─ 分割: 将一条分支拆分为两条
  ├─ 合并: 将两条分支合并为一条
  └─ 平面分割: 按平面切割管道

步骤 3: 拾取元素
  ├─ 操作: 点击"拾取元素"按钮
  ├─ UI:   元素拾取列表显示选中的元素
  └─ 动作: 在 3D 视图中点击要分割/合并的分支

步骤 4: 执行分割/合并
  ├─ 选项: 保留原始元素 (开关)
  └─ 动作: 确认执行
```

### 流程四：管道坡度设置

```
步骤 1: 打开坡度面板
  ├─ 操作: 在 Application Dock 中切换到 "坡度" Tab
  └─ UI:   管道坡度面板 (pipe-slope-panel)

步骤 2: 设置坡度参数
  ├─ 输入: 坡度值 (如 1:100)
  ├─ 输入: 坡度方向 (Head→Tail / Tail→Head)
  └─ 说明: 坡度用于排液/排气需求

步骤 3: 查看分支腿状态
  ├─ UI:   分支腿列表显示各分支坡度设置状态
  └─ 状态: 已设(绿色) / 未设(灰色)
```

---

## 3. 当前 UI 设计对流程的覆盖分析

### ✅ 已完整覆盖

| 流程步骤 | 对应面板 | 覆盖度 |
|----------|----------|--------|
| 创建管道 | pipe-editor-panel | 100% |
| 创建/选择分支 | pipe-editor-panel (分支列表) | 100% |
| Head/Tail 连接设置 | pipe-editor-panel (Head/Tail Tabs) | 90% |
| 管件选择与放置 | component-editor-panel | 90% |
| 2D 草图路径定义 | pipe-sketching-panel | 80% |
| 管道分割/合并 | pipe-splitting-panel | 85% |
| 管道坡度设置 | pipe-slope-panel | 80% |
| 规格选择 | pipe-spec-panel | 90% |
| 管道路由设置 | pipe-router-panel | 70% |
| 装配管理 | Assembly Manager panel | 85% |

### 🔲 需要补充/改进的 UI 功能

#### 高优先级

1. **管道路由 — 规则集配置**
   - pipe-router-panel 目前只有基本设置和方向变更
   - 需要添加：规则集选择列表、错误处理模式、输出日志

2. **分支详情 — 坐标拾取交互**
   - Head/Tail Tab 目前只显示坐标信息
   - 需要添加：拾取按钮 (Pick Position)、偏移方向/距离控制

3. **管件编辑器 — 更多管件类型**
   - 目前 8 种基本管件
   - E3D 支持 14+ 种：补充 OLET、REDUCER、TEE、CROSS、TRAP、INSTRUMENT 等

4. **草图面板 — 正交/偏移/膨胀环/复制/镜像**
   - 目前有基本的点工具栏和法兰组/阀组
   - 需要补充：正交模式开关、偏移输入、膨胀环插入、复制选择、镜像面板

#### 中优先级

5. **管道 Tapping 面板**
   - 支管接入点管理（Stub-in/Boss/Olet）
   - 对应 E3D: `pipetappings.pmlfrm` + `pipestubin.pmlfrm`

6. **组件方向/偏移编辑器**
   - 组件精确定位和旋转
   - 对应 E3D: `componentorioff.pmlfrm`

7. **数据一致性检查面板**
   - 对应 Ribbon 工具组中的"数据一致性"按钮
   - 检查管道规格匹配、连接状态、坡度设置等

#### 低优先级

8. **制造弯管机管理器** — `fabmachinemgr.pmlfrm`
9. **Spool 图纸生成** — `pipespooldwg.pmlfrm`
10. **等轴测图预览** — `isdpreviewiso.pmlfrm`

---

## 4. 建议的实施路线图

### Phase 1: 核心管道建模（当前阶段 → 完善中）

```
目标：完成手动管道建模全流程
├── ✅ 管道创建/编辑 (pipe-editor)
├── ✅ 管件选择/放置 (component-editor)
├── ✅ 规格管理 (pipe-spec)
├── 🔲 补充 Head/Tail 坐标拾取交互
├── 🔲 补充更多管件类型（14种完整）
└── 🔲 管道路由规则集配置
```

### Phase 2: 高效建模工具

```
目标：提供快速建模能力
├── ✅ 2D 草图 (pipe-sketching)
├── ✅ 管道路由器基础 (pipe-router)
├── 🔲 草图正交/偏移模式
├── 🔲 膨胀环/复制/镜像
├── 🔲 Auto-Route 集成
└── 🔲 Quick Pipe Router
```

### Phase 3: 管道修改与检查

```
目标：支持管道修改和质量检查
├── ✅ 管道分割/合并 (pipe-splitting)
├── ✅ 管道坡度 (pipe-slope)
├── 🔲 Tapping/Stub-in 面板
├── 🔲 数据一致性检查
├── 🔲 组件方向/偏移编辑
└── 🔲 连通性验证
```

### Phase 4: 装配与输出

```
目标：装配管理和工程输出
├── ✅ 装配管理器 (Assembly Manager)
├── 🔲 Spool 图纸生成
├── 🔲 等轴测图预览/导出
├── 🔲 制造 NC 数据
└── 🔲 BOM 材料清单
```

---

## 5. Ribbon 工具按钮与面板对应关系

| Ribbon 按钮 | 功能 | 对应面板/操作 | 状态 |
|-------------|------|--------------|------|
| 管道 | 创建/编辑管道 | → pipe-editor-panel (编辑器 Tab) | ✅ |
| 元件 | 创建管件 | → component-editor-panel (管件 Tab) | ✅ |
| 管道元件 ▾ | 管道+管件联合 | → pipe-editor + component-editor | ✅ |
| 规格 | 选择/修改规格 | → pipe-spec-panel (规格 Tab) | ✅ |
| 删除 | 删除管道元素 | → 3D 视图选择 + 确认对话框 | 🔲 |
| 删除范围 | 批量删除 | → 范围选择 + 确认 | 🔲 |
| 管道路由 | 自动路由 | → pipe-router-panel (路由 Tab) | ✅ |
| 坡度管 ▾ | 设置管道坡度 | → pipe-slope-panel (坡度 Tab) | ✅ |
| 管道分割 | 分割/合并 | → pipe-splitting-panel (分割 Tab) | ✅ |
| 管系 ▾ | 管系系统管理 | → 管系选择对话框 | 🔲 |
| 数据一致性 | 检查数据 | → 数据检查面板 | 🔲 |
| 集成模式 | 集成模式切换 | → 状态栏模式指示 | 🔲 |
| 管道 (贯穿) | 管道贯穿 | → 贯穿配置面板 | 🔲 |
| 孔洞 | 创建孔洞 | → 孔洞配置面板 | 🔲 |
| 等轴测图 | 生成等轴测图 | → 等轴测图面板 | 🔲 |
| 尺寸 | 管道尺寸标注 | → 尺寸标注面板 | 🔲 |
| 管道支撑 | 管道支撑设计 | → 支撑设计面板 | 🔲 |
| 浏览器 | 管道浏览器 | → Model Explorer | ✅ |
| 建模 ▾ | 制造建模 | → 制造面板 | 🔲 |
| 卷盘检查 ▾ | Spool 检查 | → Spool 检查面板 | 🔲 |
| 图纸 | Spool 图纸 | → Spool 图纸面板 | 🔲 |
| 制造NC数据 | NC 输出 | → NC 数据面板 | 🔲 |
| 配置 ▾ | 制造配置 | → 弯管机管理面板 | 🔲 |
| 默认值 | 默认设置 | → 设置面板 | 🔲 |

**统计**: ✅ 已设计 10 / 🔲 待设计 16 / 总计 26 个按钮功能

---

## 6. 下一步建议

### 立即可做（基于已有面板完善）

1. **补充 pipe-editor-panel 的坐标拾取按钮** — 在 Head/Tail Tab 中添加 Pick Position 按钮和偏移控制
2. **补充 component-editor-panel 的管件类型** — 添加 OLET、REDUCER 等 6 种管件
3. **补充 pipe-sketching-panel 的高级工具** — 正交/偏移开关、膨胀环、镜像面板
4. **补充 pipe-router-panel 的规则集** — 添加规则集列表和错误处理配置

### 需要新建面板

5. **管道 Tapping 面板** — 支管接入点管理
6. **数据一致性检查面板** — 管道数据验证结果展示
7. **删除/删除范围确认面板** — 选择确认 + 影响范围预览
