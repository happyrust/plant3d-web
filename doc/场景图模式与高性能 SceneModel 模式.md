# xeokit SceneGraph 处理机制分析报告

xeokit SDK 在处理场景图（SceneGraph）时采用了双重架构：一种是面向通用场景的 **经典场景图 (Classic Scene Graph)**，另一种是专门为大规模 BIM/CAD 模型设计的 **高性能模型 (SceneModel)**。

---

## 1. 经典场景图节点存储 (`Node`)

对于一般的场景组织，xeokit 采用了内存中的树状结构。

### A. 引用与层级
- **双向引用**: 每个 `Node` 持有 `_children`（子节点数组）和 `_parentNode`（父节点引用）。
- **扁平化索引**: 无论层级深浅，所有节点都会以其唯一 ID 注册在 `Scene.components` 映射表中，支持 1 阶复杂度的直接检索。

### B. 变换与同步机制
- **本地与世界矩阵**: 节点同时维护 `_localMatrix` 和 `_worldMatrix`。
- **脏标记系统 (Dirty Flags)**: 
    - 当修改 `position`/`rotation` 等属性时，会触发 `_setLocalMatrixDirty()`。
    - 该操作会递归标记所有子节点的 `_worldMatrixDirty = true`。
- **懒计算推导**: 只有在查询 `worldMatrix` 且标记为脏时，才会执行矩阵乘法：`worldMatrix = parent.worldMatrix * localMatrix`。

---

## 2. 高性能模型模式 (`SceneModel`)

专门用于处理包含构件海量（如百万级三角形）的大型模型。

### A. 聚合存储 (Entity-Mesh)
- 不再使用深层递归的 `Node` 树，而是通过 `SceneModel` 聚合 `SceneModelEntity` 和 `SceneModelMesh`。
- **Entity**：对应 BIM 构件。
- **Mesh**：管理具体的几何数据引用。

### B. 核心技术：数据纹理 (DTX)
- **像素化存储**: 构件的变换矩阵、颜色、PickID 和偏移量被存储在 GPU 纹理的像素中。
- **极速访问**: GPU Shader 可以在渲染时直接采样该纹理获取对象状态，彻底消除了 CPU 遍历场景树并逐个发送 Uniform 变量的性能开销。

---

## 3. XKT 文件存储内容分析

XKT 文件不仅仅是几何数据的容器，它更像是一个“预解析”的场景快照。

### A. 存储的物理数据
通过分析 `XKTLoader` 的解析逻辑，发现 `.xkt` 二进制文件中包含了以下核心字段：
- **`metadata`**: 存储了 IFC 类型的层级结构（Metamodel）。这就是为什么加载 XKT 后能看到完整的构件树的原因。
- **`matrices`**: 存储了所有构件的变换矩阵。
- **`eachEntityId`**: 构件的唯一标识符（GUID）。
- **`positions` / `indices`**: 经过高度量化压缩的几何顶点和索引。
- **`eachTileAABB`**: 场景的分块空间坐标。

### B. 与分析数据的关系
用户在代码中看到的场景树节点、矩阵和构件状态，**绝大部分都预先存储在 XKT 文件中**。
- 加载过程：`XKTLoader` 读取二进制 -> 解压 (Inflate) -> `Parser` 解析分段数据 -> 调用 `SceneModel.createEntity/createMesh`。
- **加载即恢复**：XKT 文件将大量在其他引擎中需要运行期计算的工作（如 AABB 合成、层级展开、矩阵计算）在导出阶段就已完成并打平存储。

---

## 4. 两种模式对比

| 特性 | 经典场景图 (`Node`/`Mesh`) | 高性能模型 (`SceneModel`) |
| :--- | :--- | :--- |
| **存储结构** | 内存中的 O(N) 引用树 | GPU 纹理中的 O(1) 像素行 |
| **同步逻辑** | 递归向上/向下遍历 | Shader 内像素采样 |
| **适用场景** | 交互式辅助物、复杂动画小对象 | 静态海量 BIM/CAD 构件 |

---

## 总结
xeokit 通过 `Node` 提供灵活的层级控制，同时通过 `SceneModel` 与 **DTX 技术** 将数据“拍扁”存入显存，从而实现了从小型模型到超大规模工业场景的全覆盖支持。
