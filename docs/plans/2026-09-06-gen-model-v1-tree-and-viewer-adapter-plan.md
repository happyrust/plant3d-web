# plant3d-web 接入 gen-model `/api/v1`：模型树与三维模型加载重构方案

- 日期：2026-09-06
- 状态：**已拍板**（2026-09-06，D1–D7 全按推荐项）。进度：P0 已落地（gen-model 提交 `1eefbd577`，2026-09-07 对 `:18082` 运行实例 live 验证通过，见 §8.1）；P1 已落地（本仓，见 §8.2）；P2 已落地（见 §8.3；P2-4 徽标后补于 §8.11）；P3 已落地（见 §8.4，D6 对拍 ≤ 0.002 mm；P3-c 进度弹窗与 `show_dbnum` 整库入口后补于 §8.9）；P4 已落地（见 §8.5）；P5 已落地（见 §8.6，WS 已连、drain 对齐走 REST——服务端今天不发 `model_drain` 事件）；P6 文档与脚本已落地（见 §8.7）；P7 浏览器实跑通过 + 一次显示一次 ensure（见 §8.8）；P3-c 进度弹窗 + `show_dbnum` 整库入口已落地并在浏览器里实跑（见 §8.9），**默认开关未翻**（等 `:3100` 起来做两源对拍）
- 范围：`D:\work\plant-code\old\plant3d-web`（前端，主战场）+ `D:\work\plant-code\old\gen-model`（后端，只做最小增补）
- 术语以两仓 `CONTEXT.md` 为准：plant3d-web 的「显式显示操作 / 按需模型生成 / 模型资产补齐 / 模型加载」，gen-model 的「生成根 / 最小交付单元 / 模型面 / 库一致性判决」。

---

## 0. 一句话

把 plant3d-web 里「模型树」与「三维模型」两条数据链的**数据源**从旧后端 `plant-model-gen`（`:3100`，`/api/e3d/*` + parquet/DuckDB-WASM + `/files/meshes/**.glb`）切到本仓 gen-model 的 `/api/v1`（`:8022`，`tree/*` + `model/ensure` + `model/records` + `/assets/meshes/*.mesh`），方式是**在前端加一层数据源端口（port）+ 两个适配器（legacy / gen-model-v1）**，旧链路保留在开关后面直到对拍通过；gen-model 侧只补三个小接口缺口。

## 1. 目标 / 非目标

**目标**

1. 模型树面板（`ModelTreePanel.vue` → `usePdmsOwnerTree.ts`）能以 gen-model `/api/v1/tree/*` + `/api/v1/search` 为数据源完成：根节点、按需展开子节点、搜索、按 refno 定位（祖先链展开）。
2. 三维视口（`ViewerPanel.vue` → `useDbnoInstancesDtxLoader.ts` → DTX 层）能以 `/api/v1/model/ensure` + `/api/v1/model/records` + 网格文件为数据源加载并显示任意树节点（SITE/ZONE/BRAN/EQUI/…）范围内的几何实例。
3. 属性面板改读 `/api/v1/element/attributes`（顺手，否则树能显示但点开属性是空的）。
4. 旧链路（parquet / `/api/e3d/*`）**不删**，放在数据源开关后面，直到 §7 对拍全绿；删除另立计划。

**非目标（本期不做）**

- 尺寸标注 / MBD / 测量 / 校审批注等其它 `/api/*` 依赖的迁移（它们不属于「模型树 + 三维模型显示」）。
- 版本对比（`model-version`、`modelUnitVersionApi`）迁移——gen-model 的 `model/history/*` 存在但契约与前端现有版本视图差距大，另立计划。
- 鉴权、多租户、生产部署拓扑。
- 把 DuckDB-WASM / parquet 整条链从 bundle 里拿掉。

## 2. 现状盘点（两边各自的形状）

### 2.1 plant3d-web 现在怎么拿数据

| 关注点 | 现状 | 代码位置 |
| --- | --- | --- |
| 后端地址 | `VITE_GEN_MODEL_API_BASE_URL=http://localhost:3100`，dev 走 Vite 代理 `/api`、`/files`、`/model-version` → `:3100`；`?backendPort=` / `?backend=` 可覆盖 | `vite.config.ts`、`src/utils/apiBase.ts` |
| 模型树 | `e3dGetWorldRoot / e3dGetChildren / e3dGetAncestors / e3dSearch / e3dGetSubtreeRefnos / e3dGetVisibleInsts / e3dGetSiteNodes`；默认 `e3d_source=parquet`（DuckDB-WASM 直接查 `/files/output/<project>/parquet/*.parquet`），`e3d_source=backend` 走 `/api/e3d/*` | `src/api/genModelE3dApi.ts`、`genModelE3dParquetApi.ts`、`genModelE3dTypes.ts` |
| 树状态机 | 懒加载 children、勾选态、过滤、搜索、按 refno 定位、可见实例缓存 | `src/composables/usePdmsOwnerTree.ts`（1109 行） |
| 几何实例 | `useDbnoInstancesParquetLoader.queryInstanceEntriesByRefnos(dbno, refnos)` → `InstanceEntry { geo_hash, matrix[16], uniforms{refno,noun,owner_refno…}, aabb }` | `useDbnoInstancesParquetLoader.ts`（2353 行）、`src/utils/instances/instanceManifest.ts` |
| 网格 | 按 `geo_hash` 拉 `/files/meshes/lod_{L1}/{geo_hash}_{L1}.glb` → `parseGlbGeometry` → three `BufferGeometry`；`geo_hash` 为 `1/2/3` 与 `tubi_*/t_*` 在前端本地造单位盒 / 单位圆柱 / 单位球 | `useDbnoInstancesDtxLoader.ts` `ensureGeometryForGeoHash` |
| 场景对象 | `dtxLayer.addObject(objectId="o:<refno>:<n>", geoHash, matrix, color, material, aabb)`；相机 `up=(0,0,1)`（Z-up，坐标原样用） | `useDbnoInstancesDtxLoader.ts` `loadDbnoInstancesForVisibleRefnosDtx`、`DtxViewer.ts` |
| dbnum 归属 | `useDbMetaInfo.ts` 读 `/files/output/.../scene_tree/db_meta_info.json` 建 `ref0 → dbnum`；DTX 缓存、可见性、选中都按 dbno 分桶 | `useDbMetaInfo.ts`、`cachesByDbno` |
| 按需生成 | `useModelGeneration.ts`（1249 行）：SSE 批量生成、parquet 增量导出、`modelShowByRefno` 等旧后端任务接口 | `useModelGeneration.ts`、`genModelStreamGenerateApi.ts`、`genModelTaskApi.ts`、`genModelRealtimeApi.ts` |
| refno 键 | 前端内部统一 `dbno_seqno`（`17496_106028`），发旧后端时转 `a/b` | `normalizeRefnoKey`、`toBackendRefno` |

其它事实：plant3d-web 目录**不是 git 仓库**（`git status` 报 not a repository）；SurrealDB 直连（`useSurrealDB.ts` / `useSurrealModelQuery.ts`）是更早一代的遗留路径，本期不碰。

### 2.2 gen-model 现在提供什么（`src/web_service/`，spec：`docs/specs/web-service-api.md`）

默认形态（共识 d-581）：`store_mode=spawned-mem` + `data_face=read-through`（零摄入）——**SurrealDB 里没有 `pe`/`pe_owner` 行**，树和属性只能从 e3d-io 直读接口来；模型投影在进程内存（`model/records` 回 `source:"model-memory"`）。`DbOption.toml`：`http_api_addr="0.0.0.0:8022"`、`http_api_cors=["*"]`、`project_name="AvevaMarineSample"`、`mdb_name="ALL"`、`surreal_ns=1516`。

| 端点 | 请求 | 响应要点 | 备注 |
| --- | --- | --- | --- |
| `GET /api/v1/health` | — | `project`、`delivery_unit_types`、`initialization`、`model_update_pending`、`sul_db` … | 服务身份与就绪探针 |
| `GET /api/v1/tree/roots` | `?project&mdb&namespace`（可省） | `{source:"direct", project, mdb, nodes: EleTreeNode[]}`；节点 = 每个 DESI 库 WORL 下的 **SITE** | 没有单一 WORL 根；多库多 SITE 平铺 |
| `GET /api/v1/tree/children?refno=a/b` | refno 必须 `a/b` | `{source, parent:"a/b", nodes: EleTreeNode[]}`，按成员表存储顺序 | |
| `GET /api/v1/tree/ancestors?refno=a/b` | | `{source, refnos:["a_b",…]}`，**自己在前、向上到库顶** | |
| `GET /api/v1/search?query=&limit=&cursor=` | NAME 子串 | `{items:[{name, refno:"a/b", dbnum}], total, truncated, next_cursor, epoch, session_vector}` | **没有 `noun`** |
| `POST /api/v1/element/attributes` | `{refno:"a/b"}` | `{source:"e3d-io", complete, attributes:[{name, value_type, display, is_unset, editable, is_uda}], diagnostics}` | 属性面板数据源 |
| `POST /api/v1/model/ensure` | `{refno:"a/b", force?:bool}` | `OnDemandModelResult` + 读透形态附 `generation_roots:[…]`、`snapshot_epoch`、`publication_status`；`status ∈ Generated / AlreadyAvailable / NoRenderableGeometry` | 直读模式下对任意节点（含 SITE/ZONE）按子树解全部生成根并逐根 ensure；同步等待 **120 s**，超时回 504（后台继续）；忙根 409、无此元素 404、Ref0 归属 503/409 |
| `POST /api/v1/model/records` | `{generation_root:"a/b", limit≤5000, cursor}` | `{source:"model-memory"\|"model-database", items: GeomInstQuery[], total, truncated, next_cursor, snapshot_epoch, session_vector}` | 一根一页游标 |
| `GET /assets/meshes/{geo_hash}.mesh` | 静态 `ServeDir` | **rkyv 0.7 归档的 `PlantMesh`**（`indices:Vec<u32>, vertices:Vec<Vec3>, normals:Vec<Vec3>, wire_vertices:Vec<Vec<Vec3>>, aabb:Option<Aabb>`） | 浏览器不能直接用；`1/2/3.mesh` 是单位盒 / 单位圆柱 / 单位球 |
| `GET /api/v1/ws` | `subscribe {topics:["tasks"]}` | `task_started / task_progress / task_finished`（`kind=data_batch / model_drain / room_recalc`） | 只有 `tasks` 主题，没有「模型变更通告」 |
| `GET /api/v1/dbnums` | | 每库水位 + `model_verdict`（in_sync / lagging / not_judged） | 面板用 |
| `POST /api/v1/query` | `{tool, arguments}` | 固定只读工具集：`e3d.element.identity / owner_chain / attributes / members / transform`、`e3d.geometry.parameters`、`model.generation_root`… | 部分依赖 E3D TTY |

**`EleTreeNode` JSON 形状**（`RefU64` 序列化为 `"a_b"`，`RefnoEnum` untagged → 同样 `"a_b"`）：

```json
{ "refno": "24381_2", "noun": "SITE", "name": "/1WCC-PIPE", "owner": "24381_1",
  "order": 0, "children_count": 12, "op": "…", "mod_cnt": null,
  "children_updated": null, "status_code": null }
```

**`GeomInstQuery` JSON 形状**（每条 = 一个构件下的一个几何实例；`world_trans` / `insts[].transform` 是 bevy `Transform`，`world_aabb` 是 parry `Aabb`）：

```json
{ "refno": "24381_100817", "old_refno": null, "owner": "24381_100677",
  "world_aabb": { "mins": [x,y,z], "maxs": [x,y,z] },
  "world_trans": { "translation": [x,y,z], "rotation": [x,y,z,w], "scale": [sx,sy,sz] },
  "insts": [ { "geo_hash": "10000256467819498479", "transform": { "translation": […], "rotation": […], "scale": […] },
              "is_tubi": false, "is_invalid_tubi": false } ],
  "has_neg": false, "generic": "ELBO", "pts": null, "date": null }
```

- 普通规范原语：最终矩阵 = `world_trans × insts[i].transform`；直管（`is_tubi`）：`insts[i].transform` 恒为单位阵，`world_trans` 已折进全部姿态与缩放。
- `owner` 字段填的是**生成根**（不是直接属主）——`model_records` 就是按根投影出来的。

参考消费者：`plant-ui`（Rust/egui/Bevy 桌面端，`D:\work\plant-code\old\plant-ui`）已经用同一套接口跑通「树 → ensure → records → assets/meshes」，`crates/plant-ui-app/src/model_update_api.rs` 与 `data.rs` 是可照抄的调用序列（ensure(force=false) 拿 `generation_roots` → 逐根分页 `model/records` → 合并 → 按 `geo_hash` 取网格）。

## 3. 契约映射：旧 → 新

| 前端现有调用 | 旧后端 | gen-model `/api/v1` 对应 | 差距 / 处理 |
| --- | --- | --- | --- |
| `e3dGetWorldRoot()` | `/api/e3d/world-root` → 单个 WORL | `tree/roots` → 多个 SITE | 前端合成**虚拟根**（一个「项目 / MDB」根，或按 dbnum 分组两层），见 D4 |
| `e3dGetChildren(refno, limit)` | `/api/e3d/children/{refno}` → `{children: TreeNodeDto[], truncated}` | `tree/children?refno=a/b` → `nodes: EleTreeNode[]` | 字段映射：`refno("a_b")→id`、`noun→type`、`name`、`children_count`；服务端不截断，前端自己按 `limit` 截 |
| `e3dGetAncestors(refno)` | `/api/e3d/ancestors/{refno}` | `tree/ancestors?refno=a/b`（自己在前） | 现有定位算法已声明「不依赖顺序」，只需 `"a_b"` 归一 |
| `e3dSearch({keyword, nouns, limit})` | `/api/e3d/search` → 带 `noun` | `search?query=&limit=&cursor=` → **无 `noun`** | **缺口 G1**：gen-model 给 `items[].noun`（骨架里有），否则前端按类型过滤搜索结果做不了 |
| `e3dGetSubtreeRefnos(refno)` | `/api/e3d/subtree-refnos/{refno}` | 无直接端点 | 现只用于「勾选一棵子树 → 算要加载/隐藏哪些 refno」。新链路下**改用 `model/records` 返回的 refno 集**（即「这棵子树下有几何的构件」）替代，语义更准；纯树遍历需求用 `tree/children` BFS 兜底 |
| `e3dGetVisibleInsts(refno)` | `/api/e3d/visible-insts/{refno}` → 有几何的叶子 refno 列表 | `model/ensure(force=false)` 的 `generation_roots` + `model/records` | 语义变化：旧的是「已生成的可见实例」，新的是「补齐后的全部实例」（显式显示操作 ⇒ 模型资产补齐），与 CONTEXT「显式显示操作」一致 |
| `e3dGetSiteNodes(site)` | `/api/e3d/site-nodes/{refno}` → 带 AABB 的层级 | 无 | 只在 xeokit 旧层级构建里用，本期不迁 |
| `queryInstanceEntriesByRefnos(dbno, refnos)` | parquet | `model/records` × 生成根 | 新增适配：`GeomInstQuery → InstanceEntry`（§5 P3） |
| `/files/meshes/lod_L1/{hash}_L1.glb` | GLB | `/assets/meshes/{hash}.mesh`（rkyv） | **缺口 G2**：格式不可直接用，见 D1；无 LOD 概念，`lodAssetKey` 固定一档 |
| `useDbMetaInfo`（ref0→dbnum） | `db_meta_info.json` | 无 | **缺口 G3**：树节点与 records 里都没有 `dbnum`；`search` 有。见 D3 |
| `pdmsGetUiAttr / pdmsGetTypeInfo` | `/api/pdms/*` | `element/attributes` | 形状不同，写一个 `AttributeSource` 适配 |
| `useModelGeneration`（SSE 批量生成、parquet 导出、任务轮询） | 多个旧任务接口 | `model/ensure`（同步 ≤120 s；504/202 后台继续）+ WS `tasks` | 大幅简化：一个显式显示操作 = 一次 ensure；容器过大时按子节点拆批（§5 P3-c） |
| `?show_dbnum=` 整库显示 | parquet 整库 | `tree/roots` 里该库的 SITE → 逐 SITE ensure/records | 整库 ensure 可能远超 120 s，需要分批与进度 |

## 4. 需要拍板的设计决策

> 每条给出推荐项（**加粗**）。批注时直接改这一节即可。

### D1 网格怎么到浏览器（缺口 G2）

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. gen-model 新增 `GET /api/v1/meshes/{geo_hash}.glb`** | 读 `meshes_path/{hash}.mesh` → `PlantMesh` → 现场拼 GLB（POSITION/NORMAL f32 + indices u32；`wire_vertices` 可选作第二个 LINES primitive）；`Cache-Control: public, max-age=31536000, immutable`（geo_hash 是内容寻址，永不变）；可选落 `{hash}.glb` 旁路缓存 | 前端零改动复用 `parseGlbGeometry` 与整条 DTX 网格缓存；rkyv 版本变化对前端不可见；plant-ui 不受影响 | gen-model 多 ~150 行 Rust + 测试；首拉一次 CPU |
| B. 前端解 rkyv | 按 rkyv 0.7 布局手写解码（根在缓冲区尾部，`ArchivedVec{ptr:i32 相对偏移, len:u32}`） | 后端零改动 | 与 rkyv 0.7.42 / glam 布局强耦合，任何一边升级就静默读歪；`unsafe archived_root` 那套校验前端没有 |
| C. gen-model 落盘时旁写 `.glb` | 生成期同时写两份 | 静态即可服务 | 磁盘翻倍；历史 48k 个网格要回填；耦合进模型发布队列的持久边界（`verify_meshes`） |

推荐 **A**。plant3d-web 侧只改 URL 模板 `buildBackendUrl('/api/v1/meshes/${hash}.glb')`；保留 `1/2/3`、`tubi_*` 本地造几何的分支（gen-model 侧 `1/2/3.mesh` 语义一致：单位盒 / 单位圆柱 / 单位球——**P0 要用 `2.mesh` 与前端 `getUnitTubiGeometry()` 对一次半径/高度/轴向**）。

### D2 数据源切换与回退

| 方案 | 说明 |
| --- | --- |
| **A. 端口 + 适配器 + 开关** | 新建 `src/model-source/` 定义 `TreeSource / ModelRecordSource / MeshSource / AttributeSource` 四个接口；`legacy` 适配器包住现有 parquet / `/api/e3d/*` 代码，`genModelV1` 适配器包新接口；开关 `?model_source=gen-model-v1|legacy` + `VITE_MODEL_SOURCE`，默认先 `legacy`，对拍通过后翻默认 |
| B. 直接改写 | 在 `genModelE3dApi.ts` / `useDbnoInstancesDtxLoader.ts` 里就地替换 | 快，但没有回退，也没法并排对拍 |

推荐 **A**。plant3d-web 有大量 `*.test.ts` 依赖旧函数签名，端口层让这些测试不动。

### D3 dbnum 归属（缺口 G3）

DTX 缓存、可见性、选中、材质配置全按 `dbno` 分桶，短期不可能去掉。来源候选：

| 方案 | 说明 |
| --- | --- |
| **A. gen-model 在 `tree/roots`、`tree/children`、`search` 的节点上加 `dbnum` 字段，并在 `GET /api/v1/dbnums` 每行加 `ref0s:[…]`** | 服务端本来就有 `skeleton.dbnum_of_ref0()`；`EleTreeNode` 是 aios_core 类型，不动它——在 handler 里 `json!` 外包一层 `{…node, dbnum}`（plant-ui 用 serde 解 `EleTreeNode`，多余字段被忽略，兼容） |
| B. 前端用 `search` 的 `dbnum` 慢慢学 | 不完整，首屏拿不到 |
| C. 前端把「dbno」退化成「项目/MDB 一个桶」 | 触及 `cachesByDbno` 及十几个 `resolveDtx*ByRefno(dbno, …)` 调用点，改动面比 A 大得多 |

推荐 **A**；前端 `useDbMetaInfo` 新增一个 `genModelV1` 装载分支：从 `/api/v1/dbnums` 的 `ref0s` 建 `ref0→dbnum` 表（与现有 IndexedDB 缓存兼容）。

### D4 模型树根的形状

`tree/roots` 给的是多库多 SITE 平铺。选一种呈现：

| 方案 | 说明 |
| --- | --- |
| **A. 一层虚拟根**：`<project>/<mdb>` 作为唯一根（id 形如 `root:AvevaMarineSample:/ALL`，不是 refno），children = 全部 SITE | 与现有 `usePdmsOwnerTree` 的「单根」假设零冲突；祖先链定位时把虚拟根当终点 |
| B. 两层：项目根 → 每个 dbnum 一个库节点 → SITE | 多库时更清楚，但树里多一层非 refno 节点要在勾选/过滤/定位处处特判 |

推荐 **A**（库信息用 D3 的 `dbnum` 字段在行尾显示徽标即可）。

### D5 「显示一个节点」在新链路下的语义

| 方案 | 说明 |
| --- | --- |
| **A. 显式显示 = `ensure(force=false)` → `records`**（照抄 plant-ui） | 与 CONTEXT「显式显示操作 → 模型资产补齐（幂等）」一致；已生成的根服务端零成本命中 `AlreadyAvailable` |
| B. 先只读 `records`，缺了再 `ensure` | 需要「列生成根但不生成」的接口（gen-model 现在没有，**可选缺口 G4**：`model/ensure` 加 `preview:true` 或新端点 `model/roots?refno=`），前端多一轮；换来的是「生成预检 / 需确认生成」能落地 |

推荐 **A** 起步，G4 列为 P0 的可选项——只有当用户确认要「大范围显示前先弹确认」时再做。

### D6 坐标与单位

gen-model 的 `world_trans` / 网格顶点是 E3D 原生 **mm、Z-up**；plant3d-web 视口 `camera.up=(0,0,1)`，现有 parquet 链路也未见换算，推断两边同一口径。**但这是推断不是证据**：P3 第一件事是用 BRAN `24381/145018`（两仓多处夹具用它）对拍 `world_aabb` 与旧链路 `aabb`，差异 > 1 mm 就停下来查。

### D7 版本控制

plant3d-web 不是 git 仓库。建议在 P1 动第一行代码前 `git init` + 首次提交（否则 Plannotator `review`、回退、对拍差异都无从谈起）。**需用户确认**——这是对目录状态的改变。

## 5. 目标架构与分阶段实施

```
components/model-tree/ModelTreePanel.vue      components/dock_panels/ViewerPanel.vue
            │                                             │
   composables/usePdmsOwnerTree.ts            composables/useDbnoInstancesDtxLoader.ts
            │ TreeSource                                  │ ModelRecordSource + MeshSource
            ▼                                             ▼
   src/model-source/index.ts  ── resolveModelSource(): 'legacy' | 'gen-model-v1'
        ├── ports.ts          TreeSource / ModelRecordSource / MeshSource / AttributeSource（纯类型）
        ├── legacy/           包住 genModelE3dApi + genModelE3dParquetApi + /files/meshes glb
        └── genModelV1/       api client + 映射（EleTreeNode→TreeNodeDto, GeomInstQuery→InstanceEntry）
                    │
                    ▼  src/api/genModelV1Api.ts（fetch + 身份 + 错误码分型）
              gen-model :8022  /api/v1/*  /api/v1/meshes/*.glb
```

### P0 · gen-model 侧最小增补（后端仓，独立可交付）

| # | 改动 | 文件 | 验收 |
| --- | --- | --- | --- |
| P0-1 | `GET /api/v1/meshes/{geo_hash}.glb`（D1-A）：读 `meshes_path` → `PlantMesh::des_mesh_file` → GLB；`immutable` 缓存头；缺文件 404 `not_found`；hash 只允许 `[0-9a-zA-Z_]+`（防目录穿越） | `src/web_service/handlers.rs`、`mod.rs`（route）、新 `src/web_service/mesh_glb.rs` | 单测：`1.mesh` 转出的 GLB 头部 magic/长度合法、顶点数 = `vertices.len()`；`cargo test --lib web_service`；`curl -I` 200 + 缓存头 |
| P0-2 | `tree/roots` / `tree/children` 节点外包 `dbnum`；`search` items 加 `noun`（D3-A / G1） | `handlers.rs` `tree_*`、`search`；`direct_tree.rs` `search_names` 返回 noun | 单测：JSON 含新字段；plant-ui 既有 serde 反序列化不受影响（多余字段忽略） |
| P0-3 | `GET /api/v1/dbnums` 每行加 `ref0s:[u32]`（D3-A） | `handlers.rs` `dbnums`（从 `mdb_memory_store` 骨架 `locator_parts()` 取） | 单测 + `docs/specs/web-service-api.md` §4.7 同步一行 |
| P0-4（可选，G4） | `model/ensure` 加 `preview:bool`：只解生成根、统计 cached/uncached，不生成 | `handlers.rs` `model_ensure`、`on_demand_model` | 只在 D5 选 B 或要「需确认生成」时做 |
| P0-5 | 校验 `2.mesh` / `3.mesh` 的单位几何参数与前端 `getUnitTubiGeometry()` / `getUnitSphereGeometry()` 一致（半径、高度、轴向） | 一次性脚本，结论写进本计划 §8 | 不一致则前端造几何改参数，不改服务端 |

P0 全部是**加字段 / 加端点**，不改既有响应形状；写锁范围只在 `src/web_service/`。

### P1 · 前端接入底座

| # | 改动 | 文件 |
| --- | --- | --- |
| P1-1 | `src/api/genModelV1Api.ts`：`fetchJson` 基座、身份三元组（`project/mdb/namespace`，来自 `/health` 或 env，可省）、`ApiError{code,status,message}` 分型（`not_found / container / precondition / ref0_affiliation_* / generation_pending / timeout`）、refno 双向转换（`a_b ⇄ a/b`） | 新文件 + `genModelV1Api.test.ts`（fixture JSON 即 §2.2 的样例） |
| P1-2 | 地址：新增 `VITE_GEN_MODEL_V1_BASE_URL`（默认 `http://localhost:8022`）与 `?gm_backend=` 覆盖；gen-model CORS 已放开，**直连不走代理**；dev 额外加一个 `/gm` 前缀代理（rewrite 去前缀）供不想跨域时用 | `vite.config.ts`、`src/utils/apiBase.ts`（新增 `getGenModelV1BaseUrl()`，不动现有函数）、`.env.example`、`.env.development` |
| P1-3 | `src/model-source/ports.ts` + `index.ts`（`resolveModelSource()` 读 `?model_source=` / `VITE_MODEL_SOURCE`，默认 `legacy`）；`legacy/` 适配器原样委托现有函数 | 新目录；`usePdmsOwnerTree` / `useDbnoInstancesDtxLoader` 此时**还不改** |
| P1-4 | 健康探针：启动时 `GET /health`，把 `project / delivery_unit_types / initialization.model_ready` 放进一个 `useGenModelV1Health` store，供树面板顶部显示「已连接 gen-model :8022 · AvevaMarineSample · 模型门 开/关」 | 新 composable + 小组件 |

验收：`npm run type-check && npm run lint && npm test` 全绿；`model_source=legacy` 下行为与今天逐字节相同（对拍：同一 URL 两个 tab）。

### P2 · 模型树接 `tree/*` + `search`

| # | 改动 | 文件 |
| --- | --- | --- |
| P2-1 | `genModelV1/treeSource.ts`：`worldRoot()` 合成虚拟根（D4-A）；`children(id, limit)` → `tree/children`（虚拟根 → `tree/roots`）；`ancestors(id)` → `tree/ancestors`；`search({keyword, nouns, limit})` → `search`（noun 过滤在前端做，依赖 P0-2）；节点映射 `EleTreeNode → TreeNodeDto`（`refno "a_b"` 直接当 id；`children_count` 透传，0 视为叶子） | 新文件 + 单测（fixture） |
| P2-2 | `usePdmsOwnerTree.ts` 改为通过 `TreeSource` 取数：替换 7 处直接调用（`initTree` / `loadChildren` / 搜索 watch / `querySubtreeRefnos` / `queryVisibleInstRefnos` / 两处 `e3dGetAncestors`）；`querySubtreeRefnos` 在 v1 源下改为「`ModelRecordSource.recordsOf(node)` 的 refno 集 ∪ BFS children」 | 只改取数，不改状态机 |
| P2-3 | 定位（`locateRefno`）：祖先链到虚拟根为止；`"a_b"` 归一沿用 `normalizeRefnoKey` | 同上 |
| P2-4 | `ModelTreeRow.vue`：行尾 `dbnum` 徽标（可选） | |

验收：CLI 先证接口——

```powershell
curl "http://localhost:8022/api/v1/tree/roots"
curl "http://localhost:8022/api/v1/tree/children?refno=24381/2"
curl "http://localhost:8022/api/v1/tree/ancestors?refno=24381/145018"
curl "http://localhost:8022/api/v1/search?query=PIPE&limit=20"
```

再开 `http://127.0.0.1:3101/?model_source=gen-model-v1`：根展开可见全部 SITE；展开三层不报错；搜索 `1WCC` 有结果且能定位；`ModelTreePanel.test.ts` / `versionDiff.test.ts` 不新增 fail。

### P3 · 三维模型接 `model/ensure` + `model/records` + GLB

| # | 改动 | 文件 |
| --- | --- | --- |
| P3-a | `genModelV1/modelRecordSource.ts`：`ensureAndCollect(rootRefno)`：`POST model/ensure {refno, force:false}` → `generation_roots`（空则用自身）→ 逐根 `POST model/records` 翻页（`limit 5000`）→ 合并去重（同 refno+geo_hash+matrix） | 新文件 + 单测 |
| P3-b | 映射 `GeomInstQuery → InstanceEntry[]`：`matrix = compose(world_trans) × compose(inst.transform)`（three `Matrix4.compose(translation, quaternion, scale)`，列主序 `toArray()`）；`uniforms = {refno:"a_b", noun: generic, owner_refno: owner(生成根), is_tubi}`；`aabb = {min: mins, max: maxs}`；`lod_mask=1`；`is_invalid_tubi` 的实例给一个可配置的告警色 | `genModelV1/instanceMapping.ts` + 单测（手算一条 90° 旋转 + 缩放的样例） |
| P3-c | 大范围与超时：ensure 超 120 s 服务端回 504 `timeout` / 202 `generation_pending` → 前端**不重试同一 refno**，改为「展开一层，对子节点逐个 ensure」（服务端契约 §4.5：容器展开一层）；进度用现有 `ModelGenerationProgressModal.vue`（done/total = 已处理子节点数） | `modelRecordSource.ts` + `useModelGeneration.ts` 新分支 |
| P3-d | `MeshSource`：v1 源下 URL 模板换成 `/api/v1/meshes/${geoHash}.glb`（P0-1）；`1/2/3`、`tubi_*` 本地分支保留；`lodAssetKey` 忽略 | `useDbnoInstancesDtxLoader.ts` `ensureGeometryForGeoHash` 提取 URL 构造为可注入函数 |
| P3-e | `loadDbnoInstancesForVisibleRefnosDtx` 增加 `dataSource: 'gen-model-v1'`：跳过 parquet 可用性检查，`index = await modelRecordSource.instanceEntriesByRefnos(dbno, refnos)`；其余（材质、objectId、AABB、缓存）不动 | 同文件 |
| P3-f | `ViewerPanel.vue` 的 `show_refno` / `show_dbnum` / 树勾选三条入口：把 `e3dGetVisibleInsts` 换成 `ModelRecordSource.ensureAndCollect`；`show_dbnum` 在 v1 源下 = 该库全部 SITE 逐个走 P3-c | `ViewerPanel.vue`（只动 3 处调用点） |
| P3-g | `useDbMetaInfo.ts` 新装载分支：`/api/v1/dbnums` 的 `ref0s`（P0-3） | |

验收（对拍，CLI 先行）：

```powershell
curl -X POST http://localhost:8022/api/v1/model/ensure -H "content-type: application/json" -d '{"refno":"24381/145018"}'
curl -X POST http://localhost:8022/api/v1/model/records -H "content-type: application/json" -d '{"generation_root":"24381/145018","limit":5000}'
curl -I  http://localhost:8022/api/v1/meshes/1.glb
```

浏览器：`?model_source=gen-model-v1&show_refno=24381_145018` 与 `?model_source=legacy&show_refno=24381_145018&data_source=parquet` 两个 tab：实例数、场景 AABB（`sceneBoundingBox`）逐轴差 ≤ 1 mm、截图肉眼一致；再取一个 EQUI、一个 SUPPO、一个 ZONE 重复。`useModelGeneration.*.test.ts`、`useDbnoInstancesParquetLoader.test.ts` 不新增 fail。

### P4 · 属性与搜索收口

| # | 改动 |
| --- | --- |
| P4-1 | `AttributeSource`：v1 源下 `pdmsGetUiAttr(refno)` → `POST element/attributes`，映射为现有属性面板行（`name / display / value_type / is_uda`），`diagnostics.undecoded` 非空时面板尾部给一行提示 |
| P4-2 | `pdmsGetTypeInfo(refno)`（`useModelGeneration` 用它判 BRAN/HANG 根注入）在 v1 源下直接用 `TreeSource` 已缓存的 `noun`，不再请求 |
| P4-3 | 搜索结果按 `noun` 过滤（依赖 P0-2） |

### P5 · 实时与状态（可选，独立交付）

- WS `/api/v1/ws` 订阅 `tasks`：`task_finished` 且 `kind=model_drain` 时，对 `detail.roots[]` ∩ 已加载生成根做 `forceReloadRefnos`（复用现有 `forceRetryNotFound` 路径）；
- 树面板顶部显示 `/dbnums` 的 `model_verdict`（in_sync / lagging / not_judged 三态，**不判不画成告警**——共识 d-594）。

### P6 · 收尾

- 默认开关翻到 `gen-model-v1`；`legacy` 保留一个发布周期；
- `CONTEXT.md` 补词条：「模型数据源 (Model Source)」「生成根投影 (Generation-Root Projection)」；
- 写 ADR `docs/adr/0054-load-model-tree-and-geometry-from-gen-model-v1.md`（决策 = D1–D5 的拍板结果）；
- `docs/guides/` 加一页「本地联调：gen-model :8022 + plant3d-web :3101」。

## 6. 工作量与顺序

| 阶段 | 估算 | 依赖 |
| --- | --- | --- |
| P0 | 1–1.5 天（P0-1 占大半） | 无；可与 P1 并行 |
| P1 | 0.5 天 | 无 |
| P2 | 1 天 | P0-2（noun/dbnum）、P1 |
| P3 | 2 天（含对拍） | P0-1、P0-3、P1 |
| P4 | 0.5 天 | P2 |
| P5 | 0.5 天 | P3 |
| P6 | 0.5 天 | 全部 |

关键路径：P0-1（GLB 端点）→ P3。P0-1 没落地之前，P3 可以先用**前端临时 rkyv 解码器**（D1-B）打通链路做对拍，但不合并。

## 7. 验证策略（按 AGENTS.md：CLI + 真实数据优先，不为联调新增独立测试）

1. **接口层**：§5 各阶段的 `curl` 序列写成 `scripts/verify-gen-model-v1.ps1`（只读，不改任何数据），输出节点数 / 根数 / 实例数 / 网格 200 数；
2. **对拍**：同一 refno 在 legacy 与 gen-model-v1 两源下的 `loadedObjects`、`sceneBoundingBox`、截图；用 `24381_145018`（BRAN）、一个 EQUI、一个 ZONE；
3. **回归**：`npm run type-check`、`npm run lint`、`npm test`；触及 `ViewerPanel.vue` 的 PR 附截图；
4. **不做**：不为一次性联调新增 `*.test.ts`；只有映射函数（`instanceMapping.ts`、`treeSource.ts` 的 DTO 映射）这类纯函数补最小单测，因为 CLI 覆盖不到矩阵合成的正确性。

## 8. 风险与开放问题

| # | 风险 / 问题 | 缓解 |
| --- | --- | --- |
| R1 | 整库 / 大 ZONE 的 ensure 远超 120 s，且服务端「忙根 409 不排队」 | P3-c 分批 + 进度；必要时 P0-4 预检先算根数再决定要不要弹确认 |
| R2 | `model/records` 在 `store_mode` 持久形态下走 SurrealDB（`source:"model-database"`），与内存形态可能有细微差异（`owner` 语义、`pts`） | 对拍时两种形态各跑一次；前端只依赖 `refno / owner / world_trans / insts / generic / world_aabb` 六个字段 |
| R3 | 单位 / 轴向推断错误（D6） | P3 第一步就对拍 AABB，错了立刻停 |
| R4 | `search` 是 NAME 子串 + 全库扫描，大库慢 | 前端 300 ms 防抖 + `limit 50` 已有；不够再谈服务端索引 |
| R5 | 旧后端与 gen-model 同时被同一页面用（尺寸、MBD 走 :3100，树/模型走 :8022） | 这是过渡期形态，明确写进联调指南；两套 base URL 变量名不重叠 |
| R6 | plant3d-web 无 git，重构途中无回退点 | D7：先 `git init` |
| Q1 | 树里要不要显示 ISOD 库（`membership.element_databases()` 含 ISOD）？ | 待定；默认显示，可加过滤 |
| Q2 | `is_invalid_tubi` 的实例怎么画？plant-ui 用专用 WGSL 画虚线 | 先用告警色实体，后续再议 |
| Q3 | 版本对比 / `model/history/*` 何时迁 | 另立计划 |

### 8.1 P0 落地记录与 P0-5 单位几何对表结论（2026-09-07）

- P0-1/2/3/5 全部在 gen-model 提交 `1eefbd577` 落地（`src/web_service/mesh_glb.rs` 新模块 + `handlers.rs` / `mod.rs` / `direct_tree.rs`），`docs/specs/web-service-api.md` 同步 §4.7 `ref0s`、新增 §4.10 / §4.11；P0-4（`preview`）按 D5-A 未做。gen-model 侧单测 `cargo test --lib -- web_service` 36 passed。
- **live 验证**（2026-09-07 15:50，对 plant-1 `run5-7997-bounded` 的运行实例 `127.0.0.1:18082`，`AvevaMarineSample//ALL`，只读 GET）：
  - `GET /api/v1/tree/roots` → 37 个 SITE，节点带 `dbnum`（如 `9304_2 /1RS-CIVI dbnum=1112`）；
  - `GET /api/v1/search?query=PIPE&limit=3` → `total=306`，items 带 `noun`（ZONE / SITE）与 `dbnum`；
  - `GET /api/v1/dbnums` → 41 行，DESI 行带 `ref0s`（如 `1112 → [9304,17496,25688]`）；
  - `GET /api/v1/meshes/12240963882128803248.glb` → 200 `model/gltf-binary`，`Cache-Control: public, max-age=31536000, immutable`，`ETag: "12240963882128803248"`，GLB 头 `glTF`/总长一致，`POSITION`+`NORMAL`+u32 indices，372 顶点；
  - 错误分型：缺文件 `1.glb` → 404 `{"code":"not_found"}`（该运行实例的 `meshes_path` 下没有 `1.mesh`，仓内 `assets/meshes/1|2|3.mesh` 才有）；后缀不对 `1.mesh` → 400 `bad_request`；`../1.glb` → 404（路径归一后进不了 handler）。
- **P0-5 结论**（`cargo test -- --nocapture` 实测包围盒）：`1.mesh` 单位盒 `[-0.5,-0.5,-0.5]..[0.5,0.5,0.5]`；`2.mesh` 单位圆柱 `[-0.5,-0.5,0]..[0.5,0.5,1]`（半径 0.5、高 1、Z 轴、底面在 z=0）；`3.mesh` 单位球 `[-0.5,-0.5,-0.5]..[0.5,0.5,0.5]`（半径 0.5、原点居中）。与本仓 `useDbnoInstancesDtxLoader.ts` 的 `getUnitBoxGeometry()` / `getUnitTubiGeometry()`（`CylinderGeometry(0.5,0.5,1)` → `rotateX(π/2)` → `translate(0,0,0.5)`）/ `getUnitSphereGeometry()`（`SphereGeometry(0.5)`）在半径、高度、轴向、原点上**逐项一致**，前端本地造几何**不必改参数**；只有细分数不同（前端 16 段，仓内 `2.mesh` 124 面、`3.mesh` 1080 面），那是光滑度不是位置。
- 注意：内容寻址的烘焙网格（如上面的 `12240963882128803248`）包围盒是 `[-1,-1,0]..[1,1,1]`——它们是真实几何、由 `insts[].transform` 缩放到位，与 `1/2/3` 三份单位几何不是一回事，前端不要拿它们套 `getUnit*Geometry()`。

### 8.2 P1 落地记录（2026-09-07）

- D7：本仓 `git init`，基线提交为改动前的目录原样（`tmp/` 补进 `.gitignore`——138 MB 的一次性日志与验证残留，与已忽略的 `.tmp/` 同类）。
- P1-1 `src/api/genModelV1Api.ts`（+ `genModelV1Api.test.ts`）：`fetchJson` 基座、`GenModelV1ApiError{code,status,message,detail}` 分型（服务端 `{code,message,detail}` 信封原样透出；网络层失败 `code='network'`；202 `generation_pending` 也走 error 通道，`retryAfterMs` 取自 `Retry-After`）、身份三元组按需附加、refno 双向转换 `toV1Refno("a_b")→"a/b"` / `fromV1Refno("a/b")→"a_b"`、`genModelV1MeshUrl(hash)`。
- P1-2：`VITE_GEN_MODEL_V1_BASE_URL`（默认 `http://localhost:8022`，直连不走代理——gen-model CORS 已放开）、`?gm_backend=<url|/prefix|port>` / `?gm_backend_port=<port>` 覆盖、写 `/gm` 走 dev 代理（`vite.config.ts` 新增 `/gm` → `VITE_GEN_MODEL_V1_PROXY_TARGET`（缺省取绝对形式的 `VITE_GEN_MODEL_V1_BASE_URL`，再缺省 `:8022`），rewrite 去前缀，`ws:true`）；`apiBase.ts` 新增 `resolveGenModelV1BaseUrl()` / `getGenModelV1BaseUrl()` / `buildGenModelV1Url()`，既有函数一行没动。一条与旧后端同口径的保护：从局域网 IP 打开页面时，环境变量 / 默认值给的 loopback 地址折到 `/gm`（否则请求打到访问者自己的电脑）；URL 参数明确要的 loopback 不折。生产构建没配环境变量时退到同源 `/gm`。
- P1-3：`src/model-source/{ports.ts,index.ts,legacy/index.ts}`：四个端口 `TreeSource / ModelRecordSource / MeshSource / AttributeSource`；`resolveModelSourceKind()` 读 `?model_source=` → `VITE_MODEL_SOURCE` → 默认 `legacy`；`legacy` 适配器原样委托 `genModelE3dApi` / `useDbnoInstancesParquetLoader` / `/files/meshes/lod_*` URL / `genModelPdmsAttrApi`。`genModelV1` 适配器留给 P2/P3（`index.ts` 里 `gen-model-v1` 目前回退到 legacy 并 `console.warn`，开关先能切、行为不变）。`usePdmsOwnerTree` / `useDbnoInstancesDtxLoader` 此时**未改**。
- P1-4：`useGenModelV1Health.ts`（进程内单例 store：`GET /api/v1/health` → `project / mdb / namespace / version / delivery_unit_types / initialization.{data_ready, model_ready, model_phase_open} / data_face`，60 s 轮询，状态 `idle / loading / ok / error`，失败时保留上一次身份）+ `GenModelV1HealthBadge.vue`（状态点 + 摘要「已连接 gen-model :8022 · AvevaMarineSample /ALL · 模型门 开」，点击重探）挂在 `ModelTreePanel.vue` 顶部工具条 PDMS/ROOM 页签右侧；只在 `model_source=gen-model-v1` 或显式 `?gm_health=1` 时渲染，`legacy` 下不发请求、DOM 不变。
- **P1 验证**（2026-09-07 16:06）：
  - `npm run type-check` 通过；ESLint 对本轮触及的全部文件 0 问题（仓内既有 18 个文件的 86 个 lint 问题全在 `harness/` / `scripts/` / 根目录脚本等，与本轮无关，未动）；
  - `npx vitest run` 全量：baseline（基线提交 `328ca8b`）1860 tests / 1829 passed / 31 failed / 18 failed files → after 1885 / 1859 / 26 / 14，**新增 fail 0**（新增 25 条全绿：`genModelV1Api.test.ts` 12、`model-source/index.test.ts` 7、`apiBase.test.ts` +6；基线里 4 个 review/annotation store 测试文件本轮转绿属既有偶发，与本轮无关）；
  - live 冒烟（一次性 vitest 文件，跑完已删；对 `127.0.0.1:18082`）：用 P1-1 客户端实调 `health`（`AvevaMarineSample /ALL`，`model_ready=true`、`model_phase_open=true`）、`tree/roots`（37 SITE，全部带 `dbnum`）、`tree/children?refno=9304_2`（`a_b` 写法被服务端接受，回 `parent:"9304/2"`，3 个 ZONE 带 `dbnum=1112`）、`tree/ancestors?refno=17496_8518` → `["17496_8518","9304_2","9304_0"]`、`search?query=PIPE&limit=5`（306 命中，items 带 `noun`/`dbnum`）、`dbnums`（41 行，28 行带 `ref0s`）、`meshes/12240963882128803248.glb`（200 / `model/gltf-binary` / `immutable` / `glTF` 魔数 11148 B）、`meshes/1.glb` → 404 `not_found` 分型。
  - **顺手发现（gen-model 侧，未改）**：`tree/children?refno=1/1`（Ref0 不在 MDB）回 **500 `internal`**「ref0 1 反查不到 dbnum」，按 spec §4.5 的口径这应是 404 `not_found`（或 503 `ref0_affiliation_unavailable`）；客户端现在把它归为不可负缓存的 `internal`。建议 P2 前在 gen-model `tree_*` handler 里把 `DirectStoreError` 之外的「Ref0 不在骨架」分型出来。

### 8.3 P2 落地记录（2026-09-07）

- P2-1 `src/model-source/genModelV1/treeSource.ts`（`createGenModelV1TreeSource`，API 可注入）：
  - 虚拟根 id `gm-root:<project>:<mdb>`（D4-A；`/` `,` `<` `>` 一律替换成 `_`——`usePdmsOwnerTree.normalizeRefnoKey` 会改写这些字符，含了就对不上），`worldRoot()` 合成它，`children(虚拟根)` 复用同一份 `tree/roots`（60 s 缓存），children = 全部 SITE；
  - `eleTreeNodeToDto`：`refno`/`owner` 归一 `a_b`，空名退回 noun，`dbnum` 透传（`TreeNodeDto` 加了可选 `dbnum`，legacy 源不填）；`children(refno, limit)` 服务端不截断、这里按 limit 截并置 `truncated`；
  - `ancestors`：服务端链（自己在前到库顶 WORL）末尾补虚拟根；`node(refno)`：gen-model 没有单节点端点，用「祖先链第二项 = 属主 → 属主 children 里捞自己」两跳实现；
  - `search`：NAME 子串在服务端，`nouns` 过滤在客户端（靠 P0-2 的 `noun`），不够一页翻下一页，扫描上限 2000；
  - `subtreeRefnos`：BFS `tree/children`（一个节点一次请求，上限 512 次请求，`children_count=0` 不再请求），撞上限置 `truncated`；虚拟根拒绝；
  - `visibleInsts` = **D5-A**：`ensureAndCollectRecords`（见下）→ 记录里构件 refno 去重；虚拟根拒绝（整 MDB 的 ensure 不是一次点击该做的事，P3-c 另开入口）。
  - 一切 `GenModelV1ApiError` 折成 `{ success:false, error_message }`——现有调用方按 `success` 分支。
- P3-a 提前：`src/model-source/genModelV1/modelRecords.ts` `ensureAndCollectRecords(refno)`：`ensure(force=false)` → `generation_roots`（缺省用自身）→ 逐根分页 `records`（页 5000）→ 拼接；容器 `422 container` 按契约展开一层递归（`maxContainerDepth` 默认 3，`maxRoots` 默认 128，超出进 `truncatedRoots`）；`202 generation_pending` / `504 timeout` 进 `pending` 不重试；`not_found` / `precondition` / `NoRenderableGeometry` 进 `empty`；`records` 409（还没进投影）当 pending。只收记录，`InstanceEntry` 映射留给 P3-b。
- P2-2 `usePdmsOwnerTree.ts`：7 处取数（`initTree` / `ensureChildrenLoaded` / 搜索 watch / `querySubtreeRefnos` / `queryVisibleInstRefnos` / 两处 ancestors）改为 `getModelSource().tree.*`，状态机一行没动；`legacy` 下每个方法就是原函数的一次转发。`genModelV1/index.ts` 组装：`tree` v1、`meshes` v1（`/api/v1/meshes/{hash}.glb`）、`records` / `attributes` 仍委托 legacy（P3-b / P4 再换，此刻没人经端口读它们）。
- 未做：P2-3 定位无需改（现有「从根向下逐层找」不依赖顺序，虚拟根即终点，live 已证）；P2-4 行尾 `dbnum` 徽标（可选）未做。
- **P2 验证**（2026-09-07 16:22）：
  - `npm run type-check` 通过；触及文件 ESLint 0 问题；
  - `vitest` 全量 baseline 1860/1829/31 → after 1900/1870/30，**新增 fail 0**（新增 15 条：`treeSource.test.ts` 10、`modelRecords.test.ts` 5；`index.test.ts` 改为断言 v1 的树不再碰旧后端、records/attributes 仍委托 legacy）；
  - live（一次性 vitest 文件，跑完已删；`127.0.0.1:18082`，注入 baseUrl 的真 API）：`worldRoot` → `gm-root:AvevaMarineSample:ALL`（37 SITE，全部带 `dbnum`）→ `children(/1WCC-PIPE)` → `ancestors(24381_145018)` 末尾是虚拟根 → `search 1WCC nouns=[SITE,ZONE]` 只回 SITE/ZONE → `node(24381_145018)` 两跳定位到 BRAN `/Copy-of-RCS0014-1R43012新`（owner `24381_144975`，17 子）→ `visibleInsts(BRAN 24381_145018)` 22 条记录 / 12 个构件 refno，1.2 s → `visibleInsts(ZONE 24381_101410)` 成功 11 条 / 7 个 refno，1.1 s（该实例是摄入形态，ZONE 直接被 ensure 接受）。
  - **未验证**：浏览器里 `?model_source=gen-model-v1` 的树面板实际交互（展开 / 搜索 / 勾选眼睛）——勾选后几何仍走 parquet（P3 前预期为空），这一步留给 P3 一起在浏览器对拍。

### 8.4 P3 落地记录（2026-09-07）

- P3-b `genModelV1/instanceMapping.ts`：`GeomInstQuery → InstanceEntry[]`。`matrix = compose(world_trans) × compose(inst.transform)`（three `Matrix4.compose`，T·R·S，四元数 `[x,y,z,w]`，`toArray()` 列主序）；`uniforms = { refno(a_b), noun: generic | 'TUBI'(is_tubi), owner_refno: 生成根, owner_noun: 同批记录里认（认不出直管给 BRAN）, generic, is_tubi, is_invalid_tubi, has_neg }`；`aabb = {min: mins, max: maxs}`；`lod_mask = 1`；`refno_transform = compose(world_trans)` 只给非直管（直管的 `world_trans` 折进了缩放，不是刚体位姿）。非法 / 缺失字段退回单位量，不产出 NaN。
- P3-a/e `genModelV1/modelRecordSource.ts`（`createGenModelV1ModelRecordSource`）：`instanceEntriesByRefnos(dbno, refnos)` **按根收、按构件缓存**——第一个构件的 `ensure` 让服务端解到根、`records` 回整根记录并映射进缓存，同根其它构件直接命中（一根一次）；请求到但整根记录里没有的构件记空数组；`forceRefresh` 清掉请求到的构件再问；`forceRegenerate` 只让**第一次** ensure 带 `force=true`；`invalidate()` / `peek()` 给外部用。`dbno` 只是调用方的分桶键。
- P3-d/e `useDbnoInstancesDtxLoader.ts`：`ensureGeometryForGeoHash` 的 GLB URL 改经 `getModelSource().meshes.meshUrl(geoHash, lod)`（legacy 逐字同前）；`dataSource` 加 `'gen-model-v1'` 分支；**页面开关 `model_source=gen-model-v1` 生效时把 `parquet` / `backend` 改写成 `gen-model-v1`**（同一页面只该有一个几何数据源），调用方自带 `instanceEntriesByRefno` / `parquetManifestUrl` / `parquetManifest`（不可变清单 / 版本对比）时不改写。
- P3-f 三处入口：`useModelGeneration.showModelByRefno`（树勾选眼睛 / 定位的那条）加 v1 分支——范围查询（`queryLoadScopeRefnos`→`tree.visibleInsts`/`subtreeRefnos`，`resolveActualModelLoadScope`→`attributes.typeInfo`）已经过端口，v1 下直接 `loadDbnoInstancesForVisibleRefnosDtx(..., {dataSource:'gen-model-v1'})`，`regenerate` = `forceReloadRefnos + replaceExistingObjects + forceRefreshGeometries`（记录源侧 = `ensure(force=true)`），不再走 realtime / parquet / 自动导出 / SSE；`ViewerPanel.vue` 的 `show_refno` / `debug_refno` / `getTargetRefnos` / `collectDescendantRefnos` 四处 `e3dGetVisibleInsts` / `e3dGetChildren` 改经 `getModelSource().tree.*`（`ds` 不用改，加载器会改写）。
- P3-g `useDbMetaInfo.ts`：v1 下 `ensureDbMetaInfoLoaded()` 从 `GET /api/v1/dbnums` 的 `ref0s` 建 `ref0 → dbnum`（`dbnumsToDbMetaInfoJson` 转成与 `db_meta_info.json` 同形的 `{db_files}`，复用同一套校验与 IndexedDB 缓存；缓存键带 gen-model base URL，换后端不串表；没 `ref0s` 的行跳过）。
- 顺带：`typeInfo` 的 v1 实现 `typeInfoFromTree`（`tree.node()` 两跳，noun / owner / owner_noun 都在节点上；P4-2 提前）；`model-source/kind.ts` 把「现在是哪个源」拆成不带适配器依赖的轻模块（`useDbMetaInfo` / `ModelTreePanel` 引它，别把 DuckDB 拖进来）。
- **未做**：P3-c 的进度弹窗（`ModelGenerationProgressModal` 接 `ensureAndCollectRecords.onRootDone`）与 `show_dbnum` 整库入口（v1 下 = 该库全部 SITE 逐个 ensure，要分批 + 进度）；`is_invalid_tubi` 的告警色（uniforms 里已带，材质层未接，Q2）。
- **P3 验证**（2026-09-07 16:36）：
  - `npm run type-check` 通过；触及文件 ESLint 0 问题；
  - `vitest` 全量 baseline 1860/1829/31 → after 1912/1881/31，**新增 fail 0**，失败文件集合与基线**完全相同**（新增 12 条：`instanceMapping.test.ts` 8——含手算一条 90° 旋转 + 缩放 + 局部平移的样例与直管样例、`modelRecordSource.test.ts` 4）；
  - **D6 对拍（live，`127.0.0.1:18082`，一次性 vitest 文件已删）**：BRAN `24381/145018` `ensure → records` 22 条记录（11 个构件 ELBO/OLET/VALV + 11 条直管），每条记录用 P3-b 合成矩阵把真实 GLB 顶点（内容寻址网格 `e3d_baked_*` / 直管 `175598…`，经 `/api/v1/meshes/{hash}.glb`）变到世界系再取 AABB，与服务端 `world_aabb` 逐轴比：**22/22 每条 Δmax ≤ 0.002 mm，整根 union Δ = 0.0006 mm**（server `[1510.3,8099.8,13236.1]..[10417.3,11844.6,19867.8]`，尺寸 `8907 × 3745 × 6632` mm）。矩阵合成 / 四元数顺序 / 列主序 / mm 单位四件事一次证完，D6 的推断成立。
  - **未验证**：浏览器里两个 tab 的 legacy vs gen-model-v1 截图对拍（`:3100` 旧后端此刻没起；上面的 server/client 对拍是同一数据源的自洽，不是两源对拍）；EQUI / SUPPO / ZONE 三类的对拍；树勾选眼睛 → 几何出现的浏览器交互。

### 8.5 P4 落地记录（2026-09-07）

- P4-1 `genModelV1/attributeSource.ts`（`createGenModelV1AttributeSource`）：`uiAttr(refno)` → `POST /api/v1/element/attributes` → `PdmsUiAttrResponse`：`attributes[]` 摊成 `attrs`，`is_unset` 不进（E3D 的 unset 就是没有值，BRAN 上 23 条 unset 挤进面板只会淹掉有值的）；UDA 名加 `:` 前缀（面板按 `:` 分到「UDA属性」组，`uiAttrKey`）；`bool` / `real` / `int` 转 JS 布尔 / 数值，其余保留 `display` 原文（`ref` 是 `a/b`）；`full_name` 取以 `/` 开头的 `NAME`；`ref_full_names` 不给（要逐个回查，本期不做）。`PdmsUiAttrResponse` 加可选 `diagnostics {source, complete, undecoded[], shape_conflicts[]}`，`useSelectionStore.propertiesDiagnostics` 透出，`PropertiesPanel.vue` 尾部一行「e3d-io 直读：43 个属性未解码，2 个属性形状与声明不符」（悬停列名字；旧后端没有这一格，不渲染）。
- `useSelectionStore` 的属性查询改经 `getModelSource().attributes.uiAttr`（动态引入，不把整套适配器拖进每个引用 selection store 的组件）；legacy 下仍是 `pdmsGetUiAttr` 一次转发。其它直接调 `pdmsGetUiAttr` 的地方（`ViewerPanel` ptset / 校审 / 房间面板）不属于「模型树 + 三维显示」，未动。
- P4-2 `typeInfo` 走树节点两跳（P3 已做，本轮挪进 `attributeSource.ts`）；P4-3 搜索按 noun 过滤（P2 已做）。
- **P4 验证**（2026-09-07 16:45）：`npm run type-check` 通过；触及文件 ESLint 0 问题；`vitest` 全量 baseline 1860/1829/31 → 1917/1886/31，失败文件集合与基线相同（新增 5 条：`attributeSource.test.ts`）；live（`:18082`，一次性文件已删）`uiAttr(24381_145018)`：70 条有值属性（含 `:H-*` / `:MDS*` / `:PSIWEIGHT` 等 UDA 带 `:` 前缀，`AEXCES=0`、`BUIL=false` 已转型，`DUTY="反应堆冷却剂"`），`full_name=/Copy-of-RCS0014-1R43012新`，`diagnostics = {source:e3d-io, complete:false, undecoded:43, shape_conflicts:[TYPEX,SPAMAP]}`；`typeInfo(24381_145018)` → `BRAN`，owner `24381_144975` `PIPE`。**未验证**：属性面板在浏览器里的实际渲染（含尾部诊断行）。

### 8.6 P5 落地记录（2026-09-07）

- **服务端事实（改变了 P5 的形状）**：读 gen-model 源码，`model_drain` 任务只进 `TaskRegistry`（`insert_running_model_drain` / `finish`），**不发 WS 事件**——`task_started` / `task_finished` 只有 `data_batch`（`batch_worker.rs`）、`room_recalc`、`batch_scheduler` 在发，且 `task_finished` 的 payload 是 `{task_id, state, result}`，**没有 `kind`、没有根列表**；根只在任务的 `detail.roots[].target_refno`（`a/b`）里，要 `GET /api/v1/tasks` 读。所以计划里「`task_finished` 且 `kind=model_drain` → `detail.roots[]`」今天在服务端不存在。
- 落地成两条线合一条（`useGenModelV1ModelSync.ts`）：
  1. `src/api/genModelV1Ws.ts`：WS 客户端按 spec §5——信封 `{type, seq, ts, task_id, payload}`、连上即 `subscribe {topics:['tasks']}`、30 s `ping`、`pong` 过滤、`seq` 空洞回调 `onGap`、断线 1 s→30 s 指数退避重连、`stop()` 后不重连、`WebSocket` 可注入；`toGenModelV1WsUrl` 把 `http(s)://…` / `/gm` 换成 `ws(s)://…/api/v1/ws`。任何 `task_finished`（数据批次收口通常紧跟一页模型消化）与重连成功都触发一次对齐。
  2. REST 对齐（默认 15 s）：`GET /api/v1/tasks?kind=model_drain&limit=100` → 水位之后、没处理过、已收口（`succeeded/partial/failed/yielded`）的 drain → `detail.roots[].target_refno` 归一 `a_b` → ∩ 记录源 `collectedRoots()`（P3 的记录源新增 `collectedRoots / leavesOfRoot / invalidateRoot`，按生成根归档构件）→ `invalidateRoot` → 派 `showModelByRefnos {refnos, reload:true, flyTo:false}` → `ViewerPanel` 接住 → `showModelByRefno(root, {reload:true})`。首次连上只推水位（之前收口的 drain 与本页面无关；水位 `''` 表示推过但还没有 drain）。
  - `showModelByRefno` 新增 `reload` 选项：跳过「已在场景」的早退，v1 分支 `forceReloadRefnos + replaceExistingObjects + forceRefreshGeometries` 但 **不带 force**（服务端已重算，`ensure(force=false)` 回 `AlreadyAvailable` + 新记录）；`regenerate` 现在真的带 `force`（P3 时 `forceRegenerate` 没从 `LoaderOptions` 传到记录源，本轮补上）。
- 徽标（`GenModelV1HealthBadge.vue`）：`useGenModelV1Health` 新增 `/dbnums` 三态汇总 `verdict {inSync, lagging, notJudged, total, byDbnum, laggingDbnums}`（只数本 MDB 内未排除的 DESI，一行不剩退回全部 DESI；`/dbnums` 慢、单独一条线、`/health` 没通不问），文本「库 同步 1 · 滞后 0 · 未判 28」，`lagging>0` 才把状态点画成 warning，`not_judged` 只陈述（d-594）；右侧再一个小点表示 WS 连接态；悬停列滞后库、同步状态与最近重载的根。同步只在数据源真的是 gen-model-v1 时起，`?gm_health=1` 只看不动场景。
- **P5 验证**（2026-09-07 17:00）：`npm run type-check` 通过；触及文件 ESLint 0 问题；新增单测 16 条全绿（`genModelV1Ws.test.ts` 4：subscribe/ping/pong 过滤/事件、seq 空洞、退避重连与 stop；`useGenModelV1ModelSync.test.ts` 4：水位 null/''/值、seen、非终态与别的 kind 不算、根归一去重；`useGenModelV1Health.test.ts` 3；`modelRecordSource.test.ts` +1 按根归档/清根）；live（`:18082`，一次性文件已删）：Node 26 原生 `WebSocket` 连上 `ws://127.0.0.1:18082/api/v1/ws`，`connecting → open`，subscribe 与 ping 无错、pong 被过滤；`GET /tasks?kind=model_drain` 读通（该实例此刻 0 条 drain、13 条 data_batch 全 succeeded）。
- `vitest` 全量 baseline 1860/1829/31 → after 1929/1897/32：**多出的 1 条是 `AnnotationPanel.test.ts › reviewer path hides legacy OBB affordances`**——它在基线里就要 4.3 s（默认超时 5 s），P4 那轮 4.99 s 险过，本轮两次全量都 5.02 s 超时；单独跑 HEAD（P4）与工作树各 1.30 / 1.34 s 一样快，`AnnotationPanel` 也不引本轮任何模块（只引 review store / screenshot / user store）。判定为**机器负载下的既有临界超时**（同机还有别的会话在 `cargo build`），不是本轮引入；不改它的超时（不属于本计划范围），记在这里。
- **未验证**：真的有一页 `model_drain` 收口时端到端重载（该实例空闲、别的实例是别的会话的，不去触发重算）；浏览器里徽标三态与 WS 小点的实际渲染。
- **建议（gen-model 侧）**：给 `model_drain` 补 `task_started` / `task_finished` WS 事件，payload 带 `kind` 与 `detail.roots`（或至少 `task_id`），第一条线就能独立工作、REST 轮询可以拉长到分钟级。

### 8.7 P6 落地记录（2026-09-07）

- ADR `docs/adr/0054-load-model-tree-and-geometry-from-gen-model-v1.md`：决策 = D1–D5 的拍板结果（端口 + 两个适配器 + 页面级开关、服务端只加字段 / 加端点、虚拟根、显式显示 = ensure + records、mm/Z-up 不换算），否决的备选各一句。
- `CONTEXT.md` 新增「模型数据源」一节五个词条：模型数据源 (Model Source)、数据源端口 (Model Source Port)、虚拟根 (Virtual Root)、生成根投影 (Generation-Root Projection)、模型变更同步 (Model Change Sync)，每条带 _Avoid_。
- `docs/guides/gen-model-v1-local-dev.md`：起 gen-model（`http_api_addr` / `http_api_cors`）→ 起 plant3d-web → URL 开关表（`model_source` / `gm_backend(_port)` / `gm_health` / `show_refno` / `debug_refno`）→ 先脚本证接口再开浏览器 → 两种 `data_face` 形态的差别 → 两源对拍步骤（翻默认开关的前提）→ 常见故障表 → 回退。
- `scripts/verify-gen-model-v1.ps1`（`.gitignore` 的 `scripts/*` 白名单加了它）：默认只读 GET 七步；`-Ensure` 才 `POST model/ensure(force=false)` + 逐根分页 `records` + 记录里每个 `geo_hash` `HEAD .glb`；每步一行「端点 → 状态 / 条数 / 关键字段」，任何一步失败以 1 退出。
- **默认开关不翻**：`VITE_MODEL_SOURCE` 仍缺省 `legacy`（D2 说的「对拍通过后翻默认」——两源对拍要 `:3100` 旧后端在跑，见 §8.4 未验证项）。
- **P6 验证**（2026-09-07 17:10）：`pwsh scripts/verify-gen-model-v1.ps1 -BaseUrl http://127.0.0.1:18082 -Refno 24381/145018 -Ensure` **10/10 通过，exit 0**（health `AvevaMarineSample /ALL` model_ready；roots 37 SITE 全带 dbnum；children(9304/2) 3 ZONE；ancestors 链到 `16189_0`；search PIPE total 306 全带 noun；dbnums 41 行 / DESI 29 / 28 带 ref0s / verdict in_sync=1 not_judged=28；`1.glb` 404（该运行目录无 1.mesh，端点在）；ensure `AlreadyAvailable` 1 根 22 实例；records 1 页 22 条 12 构件 11 直管 `source=model-database`；10 个 geo_hash HEAD 全 200）；无后端时 7 步失败、**exit 1**。文档三件是文字，未另验。

### 8.8 P7 浏览器实跑 + 一次显示一次 ensure（2026-09-07）

- 起因：P6 之后第一次在浏览器里跑 `?model_source=gen-model-v1`，ZONE 级显示明显慢——`subtreeRefnos` 逐节点串行 BFS（一个 ZONE 几百次请求）、一次 ensure 解出多根后 `records` 串行、树的 `visibleInsts` 与几何加载各自 ensure 一遍同一个根。
- 改动（全在 v1 适配器内，legacy 路径未动）：
  - `genModelV1/modelRecords.ts`：`mapWithConcurrency`（有界并发、结果按输入顺序）；一次 ensure 解出的多根**并发**取 `records`（`recordsConcurrency` 默认 6），结果仍按根顺序拼回，409 → pending、其它错误各归各的分型不变；`onRootDone` 每根一次。
  - `genModelV1/treeSource.ts`：`subtreeRefnos` 改**按层 BFS**，一层内并发 `SUBTREE_CONCURRENCY = 8` 路 `tree/children`；`limit` / `maxDepth` / `SUBTREE_MAX_REQUESTS` 截断语义与层内顺序不变。
  - `genModelV1/index.ts` + `modelRecordSource.ts`：树的 `visibleInsts` 复用记录源的 `ensureAndCollect`（同一份缓存）；`ensureAndCollect` 在结果干净（无 pending、无错误）时给**请求的节点与生成根**各记一笔空数组——`show_refno` / 选中显示都会把「根 + 构件」一起交给 `instanceEntriesByRefnos`，ZONE 自己不是任何记录的 refno，原本会为它再 ensure 一遍同一个根。浏览器 trace：ZONE 的一次显示从 **2×ensure + 2×records → 1 + 1**。
  - `useModelGeneration.showModelByRefno`：v1 下、目标未真加载（树占位）时不再为 flyTo 先做子树 BFS，直接落到加载路（加载完自会 flyTo）；legacy 一次请求，照旧。
- **浏览器验证**（2026-09-07 18:24–18:33；Playwright 1.58 + 本机 Chrome headless；dev server 由一次性脚本起停，脚本不进仓；gen-model `127.0.0.1:18082`，`data_face=ingest`）：
  - `?model_source=gen-model-v1&gm_backend_port=18082&show_refno=24381_145018`（BRAN）：树自动展开到 `ZONE › PIPE › BRAN Copy-of-RCS0014-1R43012新`，三维里 12 refno / 10 个 GLB 绘出（弯头 + 阀门 + 直管），属性面板 54/54（NAME / REFNO / TYPE / OWNER + 元件属性 38 + UDA），徽标「已连接 gen-model :18082 · AvevaMarineSample /ALL · 模型门 开 · 库 同步 1 · 滞后 0 · 未判 0」+ WS 已连；`:18082` 请求：health 1、tasks 1、dbnums 2、tree/roots 1、tree/children 3、tree/ancestors 1、model/ensure **1**、model/records **1**、element/attributes 1、meshes 10；`pageerror` 0；**零** `/files/**.parquet` / `db_meta_info.json` / 旧 `/api/e3d/*` 请求。
  - `show_refno=24381_101410`（ZONE `/1PCS-LX-PIPE`）：8 refno / 11 对象，toast「[成功] 对象 11（已加载 8，跳过 0，mesh 缺失 0，无几何 1）」（无几何的 1 个是 ZONE 自己），属性 43 条（元件 9 + UDA 30）；修复前 ensure 2 / records 2，修复后 **1 / 1**。
  - 树交互：放大镜 → 输入 `1WCC` → `search?query=1WCC&limit=100` 50 命中（`/1WCC-PIPE-RX ZONE · 24383_66457`、`/1WCC-PIPEBJ SITE`、STRU / HANG / REST…）→ 双击第一条 → 树定位并选中 `SITE 1WCC-PIPEBJ › ZONE 1WCC-PIPE-RX`（ancestors + children 各 1 次）。
  - 不带参数（缺省 legacy）：**零** `:18082` 请求，树走 `world_sites.parquet` / `db_meta_info.json`（`:3100` 没起 → 500，属预期），无徽标——默认开关确实还在 legacy。
  - 页面上其余 500（`/api/projects` / `/api/users*` / `/api/review/*`）都是旧后端 `:3100` 未起，与本计划无关。
- 观察（未改）：每次页面加载 `/dbnums` 至少两次（`useDbMetaInfo` 的 ref0→dbnum 一次——之后有 IndexedDB 缓存；徽标三态一次），单次 1.3–8.9 s，是 v1 首屏最慢的一段，可合并成一次并共享；`records` 单根 1.7 s 在服务端。
- **P7 验证**：`npm run type-check` 通过；触及文件 ESLint 0；新增单测 6 条全绿（`mapWithConcurrency` 2、records 并发 1、`subtreeRefnos` 层内并发 1、记录源记空 / pending 不记 2）；`vitest` 全量 baseline 1860/1829/31 → 1936/1904/32，唯一多出的 fail 仍是 §8.6 记过的 `AnnotationPanel.test.ts › reviewer path…` 临界超时（本轮与浏览器脚本并行、5016 ms；单跑 1497 ms 通过）。
- **仍未验证**：两源对拍（要 `:3100`）；EQUI / SUPPO 两类；`model_drain` 收口时的端到端重载（该实例空闲）。

### 8.9 P3-c 进度弹窗 + `show_dbnum` 整库入口（2026-09-07）

- **进度**：记录源 `GenModelV1ModelRecordSource.subscribeProgress(listener)`——任何一次 `ensureAndCollect`（树的 `visibleInsts`、几何加载、整库入口）每收完一个生成根发一条 `{refno, root, done, total}`；`model-source/index.ts` 导出 `subscribeModelSourceProgress`（legacy 下空订阅）与 `getGenModelV1ModelSource()`（legacy 下 `null`）。`useModelGeneration.showModelByRefno` 在整个显示流程期间订阅：`totalCount / currentIndex / currentRefno / statusMessage / progress(10→30)` 跟着走，**多于一个生成根才把 `ModelGenerationProgressModal` 挂出来**（单根 BRAN 不弹），结束或出错都退订并关掉。构件超过一页（1000）时 DTX 装入也分批（进度 30→95，每批让出一帧）；重生成 / 重载**不分批**——它们要 forceRefresh，分了批每批都会把同一个根再 ensure 一遍（重生成还会再提交一次生成）。
- **整库**：`genModelV1/collectDbnum.ts` `collectDbnumRefnos(tree, records, dbnum)`：虚拟根下 `dbnum` 相等的 SITE（`listSitesOfDbnum`）逐个（串行）`ensureAndCollect`（每 SITE 上限根 4096 / 深 4），回构件 refno 集 + 生成根 / pending / 截断 / 错误 / 跳过的 SITE，进度两级（`sites` / `roots`）。`GenModelV1ModelSource.collectDbnum()` 组装在 `genModelV1/index.ts`。`useModelGeneration.showModelByDbnum` 在 v1 源下（且不带 `manifestUrl`——版本对比仍走 parquet，Q3）转到 `showModelByDbnumGenModelV1`：收集阶段进度 5→55（SITE 之间按个数、SITE 内按生成根），装入阶段 55→95 分批，汇总 toast。`ViewerPanel` 的 `show_dbnum` 处理分支：v1 下调 `showModelByDbnum` 后就返回（parquet 的分层 / 三角形预算 / Tile LOD 不走），`window.__dtxLastShowDbnumLoadResult` 带 `source:'gen-model-v1'`、`status: loaded | partial | empty | error`、`budgetLimited`。
- **安全概览预算**（浏览器里跑出来的事实逼出来的）：摄入形态的服务端对 SITE 一次 ensure 就直接解出几百个生成根（`/SSC测试` 335 根，dbnum 7997 的 13 个 SITE 合计上千），每根一次 `model/records` 0.5–10 s、服务端忙时单次能到 2–4 分钟——不设预算的整库跑了 8 分钟只走到 SITE 4/13（356 次 records）。于是 `EnsureAndCollectOptions.maxRecordsRoots`（一次调用最多为多少个根取 records，超出记 `truncatedRoots`、预算用完后队列里的容器子节点也不再 ensure；缺省不限）+ `CollectDbnumOptions.maxTotalRoots`（跨 SITE 累计，缺省 `DEFAULT_DBNUM_ROOTS_BUDGET = 200`，`?show_dbnum_full=1` → 不限），撞预算 `budgetLimited=true`，toast「[提示] 安全概览 dbnum=7997：13 个 SITE / 200 个生成根，已加载 4203 个实例（2100 个 refno），预算外未取 179 根，未轮到 9 个 SITE。请从模型树按需加载；整库全量可加 show_dbnum_full=1。」——与 legacy `show_dbnum` 的「安全概览 + `show_dbnum_full=1`」同一口径。
- **顺手修掉的第二处双 ensure**：树勾一次眼睛 `visibleInsts(节点)` 会被问两遍（`showModelByRefno` 的加载范围 + 树的可见性传播），SITE 1RB-CIVI 一次点击原本 2×ensure + 23×records。记录源给 `ensureAndCollect` 加了按请求节点的**结果备忘**（干净且无截断的结果才记；任何 `invalidate` / `invalidateRoot` 清掉；`force` 绕过；带 `maxRecordsRoots` 的不查），第二遍零请求 → 1×ensure + 17×records（浏览器 trace 实证）。
- **浏览器验证**（2026-09-07 19:01–19:10；同 §8.8 的一次性脚本 + Chrome headless；`:18082`）：
  - `?model_source=gen-model-v1&gm_backend_port=18082&show_dbnum=7997`：左下角覆盖层「gen-model：SITE 1/13 /1RB-CIVI，正在 ensure… 5%」→「SITE 4/13 /SSC测试，生成根 N/335」；结束 `[model-load] gen-model-v1 dbnum=7997 sites=13 roots=200 refno_count=2100 loaded_refnos=2100 instance_count=4203 mesh404=0 no_geo=0 pending=0 truncated_roots=179 skipped_sites=9 errors=0 ms=269039`，三维里 1RB-CIVI / 1RC-CIVI / 仪控 / SSC 的土建与设备几何绘出，`__dtxLastShowDbnumLoadResult = {status:'partial', source:'gen-model-v1', refnoCount:2100, loadedObjects:4203, budgetLimited:true}`；请求 ensure 4、records **200**（预算精确）、DTX 分 3 批（1000/1000/100）。269 s 里绝大部分是服务端 `records` 的长尾（205 s / 143 s / 44 s 三次）。
  - 树勾眼睛 `SITE 1RB-CIVI`（24381_42520）：弹窗「正在生成模型 3/17 · 当前: 24381_44280 · gen-model 生成 / 取回记录：2/17 个生成根 · 已完成 2 / 17 个」→ 7/17 → 加载完自动关闭；24 refno / 48 对象，ensure **1** / records 17；`tree/children` 180 次是树可见性传播的子树 BFS（8 路并发，每次 ~10 ms）。
- **P3-c 验证**：`npm run type-check` 通过；触及文件 ESLint 0；新增单测 15 条全绿（`collectDbnum.test.ts` 6、`useModelGeneration.genModelV1.test.ts` 9、`modelRecordSource.test.ts` +2、`modelRecords.test.ts` +1、`index.test.ts` +1）；`vitest` 全量 baseline 1860/1829/31 → **1955/1925/30**，新增 fail 0。
- **给 gen-model 的第三条建议**：整库 / 大 SITE 的瓶颈不在前端而在「一根一次 `model/records`」——加一个按库或按多根批量取记录的端点（或让 `records` 接受 `generation_roots[]`），v1 整库才能从「安全概览」变成真正可用的整库。
- **未做**：`show_dbnum` 的 v1 路没有 legacy 那套「分层 / 三角形预算 / Tile LOD」（DTX 单层装几千对象在本样本上没问题，大库要再看）。

### 8.10 `/dbnums` 首屏合一 + 三态五分钟一次（2026-09-07）

- `src/composables/useGenModelV1Dbnums.ts`：`GET /api/v1/dbnums` 的进程内共享缓存——在飞的共用、拉回来的按 gen-model base URL 缓存一段新鲜度窗口（`DBNUMS_DEFAULT_MAX_AGE_MS = 5 min`），`force` 重拉（在飞的仍共用），`peekGenModelV1Dbnums()` 只看不拉。不是 store，没有响应式。
- `useDbMetaInfo`（ref0→dbnum）与 `useGenModelV1Health`（库三态）都改走它：首屏两处并发要同一份 → **一次请求**。`useGenModelV1Health.start()`：`/health` 仍每 60 s（便宜、连接态要及时），三态每 `DEFAULT_VERDICT_POLL_INTERVAL_MS = 5 min` 且 `force`（用 `/health` 的节拍数，一张表；`/health` 之前没通导致三态没拿到的，通了下一拍就补）；首屏那次不 `force`（与 `useDbMetaInfo` 共用）；人点徽标「重探」两者都 `force`。
- 验证：`useGenModelV1Dbnums.test.ts` 3 条（并发合一 / 窗口 / force / 失败不写缓存 / 换 base URL 不认旧缓存）、`useGenModelV1Health.test.ts` +2（假时钟：60 s 节拍、5 min 三态、首屏不 force、重探 force、/health 不通不问）；浏览器（`show_refno=24381_145018`）首屏 `:18082` 请求 `dbnums` **1**（此前 2），徽标三态照常「库 同步 1 · 滞后 0 · 未判 0」。

### 8.11 P2-4 行尾 dbnum 徽标（2026-09-07）

- `useModelTree.ts`：`TreeNode` / `FlatRow` 加可选 `dbnum?: number`；`usePdmsOwnerTree.dtoToTreeNode` 只在 DTO 的 `dbnum` 是有限数时写这一格（legacy 的 DTO 没有 → 节点对象与从前逐字段相同），`flatRows` 透传。
- `ModelTreeRow.vue`：眼睛按钮之前一枚小徽标 `data-testid="model-tree-dbnum-badge"`（`row.dbnum !== undefined && !ghost` 才渲染，悬停「所属库 dbnum 7997」）。
- 验证：`ModelTreeRow.dbnum.test.ts` 2 条（v1 行画、legacy 行与幽灵不画、位置在眼睛之前）；浏览器（`:18082`）v1 树 40 行 39 枚徽标（虚拟根没有），SITE `9304_2 → 1112`、其余 SITE / ZONE `→ 7997`；缺省 legacy 页面 DOM 里徽标 **0**。截图 `%TEMP%\gm-v1-badge-tree.png`。

## 9. 交付物清单

- gen-model：P0-1/2/3（+可选 P0-4），`docs/specs/web-service-api.md` 同步，`changelog.md` 一条；——**已交**（`1eefbd577`；P0-4 未做）
- plant3d-web：`src/api/genModelV1Api.ts`、`src/model-source/**`、`usePdmsOwnerTree.ts` / `useDbnoInstancesDtxLoader.ts` / `useDbMetaInfo.ts` / `ViewerPanel.vue` 的取数点改动、`vite.config.ts` / `.env.*`、`scripts/verify-gen-model-v1.ps1`、ADR 0054、联调指南；——**已交**（`3f1c2e2` → `65cb31a` → `be0da07` → `a920c82` → `b7dafa2` → P6 提交；另加 `src/api/genModelV1Ws.ts`、`useGenModelV1Health.ts`、`useGenModelV1ModelSync.ts`、`GenModelV1HealthBadge.vue`、`useModelGeneration.ts` / `useSelectionStore.ts` / `PropertiesPanel.vue` 的取数点）
- 本计划按批注修订后作为 `docs/plans/` 的执行基线。——§8 是逐阶段的落地与验证记录。
- **仍欠**：默认开关翻到 `gen-model-v1`（等 `:3100` 起来做两源对拍；单源浏览器实跑已过，见 §8.8 / §8.9）、`is_invalid_tubi` 告警色；gen-model 侧三条建议（`model_drain` WS 事件、`tree/*` 的 Ref0-不在-MDB 分型、按库 / 多根批量 `records`）。
