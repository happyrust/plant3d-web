# Ptset API Reference

## 1. Core Summary

Ptset API 是后端提供的 REST 端点，用于查询元件的连接点数据。客户端通过 `pdmsGetPtset(refno)` 函数调用该 API，获得包含点位置、方向向量、管道外径等信息的点集数据列表和世界坐标变换矩阵。

## 2. Source of Truth

- **Backend API:** `gen-model-fork/src/web_api/ptset_api.rs` - Rust 后端实现，从 `inst_info` 表查询 ptset 数据，或回退到 `resolve_axis_params`，返回包含世界变换矩阵的完整响应。

- **Frontend Type Definition:** `src/api/genModelPdmsAttrApi.ts` - TypeScript 类型定义和调用函数实现。

- **Frontend Integration:** `src/components/viewer.vue:57-79` - viewer 组件中的 ptset 可视化请求处理。

## 3. Data Types

### PtsetPoint

单个连接点的数据结构：

```typescript
interface PtsetPoint {
  number: number;                          // 点编号
  pt: [number, number, number];           // 3D 坐标 [x, y, z]
  dir: [number, number, number] | null;   // 方向向量（可选）
  dir_flag: number;                        // 方向标志
  ref_dir: [number, number, number] | null; // 参考方向（可选）
  pbore: number;                           // 管道外径
  pwidth: number;                          // 宽度
  pheight: number;                         // 高度
  pconnect: string;                        // 连接信息
}
```

### PtsetResponse

API 返回的完整响应：

```typescript
interface PtsetResponse {
  success: boolean;                   // 是否成功
  refno: string;                      // 元件参考号
  ptset: PtsetPoint[];               // 点集数据列表
  world_transform: number[][] | null; // 4x4 世界坐标变换矩阵
  error_message?: string | null;     // 错误信息
}
```

## 4. API Endpoint

**路由:** `/api/pdms/ptset/{refno}`

**方法:** GET

**路径参数:**
- `refno` (string, required): 元件参考号，格式为 `24383_84631`（使用下划线分隔）

**响应:** PtsetResponse JSON 对象

**示例:**
```
GET /api/pdms/ptset/24383_84631
```

**成功响应 (200):**
```json
{
  "success": true,
  "refno": "24383_84631",
  "ptset": [
    {
      "number": 1,
      "pt": [100.5, 200.3, 300.1],
      "dir": [0.0, 1.0, 0.0],
      "dir_flag": 1,
      "ref_dir": null,
      "pbore": 50.0,
      "pwidth": 60.0,
      "pheight": 70.0,
      "pconnect": "FLANGE"
    }
  ],
  "world_transform": [
    [1.0, 0.0, 0.0, 100.0],
    [0.0, 1.0, 0.0, 200.0],
    [0.0, 0.0, 1.0, 300.0]
  ]
}
```

**错误响应 (404):**
```json
{
  "success": false,
  "error_message": "Element not found"
}
```

## 5. Frontend Function

### pdmsGetPtset

```typescript
export async function pdmsGetPtset(refno: string): Promise<PtsetResponse>
```

**参数:**
- `refno` (string): 元件参考号

**返回:** 返回 Promise<PtsetResponse>

**示例:**
```typescript
const response = await pdmsGetPtset('24383_84631');
if (response.success) {
  console.log(`Found ${response.ptset.length} points`);
  response.ptset.forEach(p => {
    console.log(`Point #${p.number}: (${p.pt[0]}, ${p.pt[1]}, ${p.pt[2]})`);
  });
}
```

## 6. Integration Points

- **Viewer Component:** `src/components/viewer.vue:64` - 调用 pdmsGetPtset 获取 ptset 数据

- **Visualization Composable:** `src/composables/usePtsetVisualization.ts:211` - renderPtset 接收 PtsetResponse 并处理数据

- **Model Tree Context Menu:** `src/components/model-tree/ModelTreePanel.vue:446` - 触发 ptset 可视化请求的入口
