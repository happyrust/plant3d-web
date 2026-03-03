# Plant3D CAD 渲染风格 - 最终参数表（阶段 A/B/C）

> 目标风格：工程视图（浅灰背景、低饱和材质、深灰细边线、弱透视默认）

## 1. 默认参数（当前落地）

### 1.1 渲染器与相机

| 项目 | 默认值 | 位置 |
|---|---:|---|
| Tone Mapping | `ACESFilmicToneMapping` | `src/viewer/dtx/DtxViewer.ts` |
| Exposure | `0.95` | `src/viewer/dtx/DtxViewer.ts` |
| 相机默认模式 | `cad_weak` | `src/components/dock_panels/ViewerPanel.vue` |
| `cad_weak` FOV | `30` | `ViewerPanel.vue` -> `getCameraFovByMode` |
| `cad_flat` FOV | `18` | `ViewerPanel.vue` -> `getCameraFovByMode` |
| `normal` FOV | `45` | `ViewerPanel.vue` -> `getCameraFovByMode` |

### 1.2 灯光

| 灯光 | 强度 | 位置 |
|---|---:|---|
| Ambient | `0.22` | `DtxViewer._setupDefaultLights` |
| Directional #0 | `1.05` | `DtxViewer._setupDefaultLights` |
| Directional #1 | `0.18` | `DtxViewer._setupDefaultLights` |

### 1.3 背景

| 模式 | 顶色 | 底色 |
|---|---|---|
| `gradient_solidworks` | `#edf1f7` | `#cfd7e6` |

### 1.4 全局工程边线（Global Edge）

| 项目 | 默认值 | 备注 |
|---|---:|---|
| 开关 | `on` | 设置面板可切换 |
| 线色 | `0x4b5563` | 深灰细线 |
| 填充 | `off` | `showFill=false` |
| `edgeThresholdAngle` | `20` | 可调范围 `1~60` |

### 1.5 选中高亮（Selection Overlay）

| 项目 | 默认值 |
|---|---:|
| `fillColor` | `0x94a3b8` |
| `fillOpacity` | `0.22` |
| `edgeColor` | `0x4b5563` |
| `edgeThresholdAngle` | `20` |
| `edgeAlwaysOnTop` | `false` |

### 1.6 关键材质（noun）

| noun | color | metalness | roughness |
|---|---|---:|---:|
| `EQUI` | `#c6ab6a` | `0.18` | `0.46` |
| `VALV` | `#c9ad69` | `0.22` | `0.44` |
| `TUBI` | `#c9cdd3` | `0.06` | `0.62` |
| `ELBO` | `#c9cdd3` | `0.06` | `0.62` |
| `FLAN` | `#ceb06e` | `0.20` | `0.48` |

---

## 2. 可调参数入口

### 2.1 右侧“查看工具设置”面板

- 相机视角：`弱透视 / 近平行 / 标准`
- 全局工程边线：`开关 + 边线角阈值（1~60）`
- 场景背景：现有 presets

### 2.2 URL 参数（便于对比/验收）

| 参数 | 示例 | 说明 |
|---|---|---|
| `dtx_camera_mode` | `cad_weak` / `cad_flat` / `normal` | 相机模式 |
| `dtx_global_edges` | `1` / `0` | 全局边线开关 |
| `dtx_edge_angle` | `20` | 全局边线角阈值 |
| `dtx_grid` | `1` / `0` | CAD 网格开关（已有） |

---

## 3. 截图对比清单（验收）

建议固定同一视点与模型，输出 6 组图：

1. `cad_weak + edges:on(20)`（默认基准）
2. `cad_flat + edges:on(20)`
3. `normal + edges:on(20)`
4. `cad_weak + edges:on(12)`（边线更密）
5. `cad_weak + edges:on(30)`（边线更稀）
6. `cad_weak + edges:off`

每组截图记录：

- FPS（拖拽旋转时）
- 管道/法兰交界清晰度
- 远近透视夸张程度
- 选中对象可辨识度

---

## 4. 建议的最终默认值（当前即默认）

- 相机：`cad_weak (FOV=30)`
- 全局边线：`on`
- 边线阈值：`20`
- 选中 overlay：`fill 0.22 + 深灰边`
- 背景：`gradient_solidworks (#edf1f7 -> #cfd7e6)`
