# 测试 7997 Parquet 数据加载

## 已完成的部署

✅ 已将 7997 的 parquet 数据复制到 plant3d-web：
- 位置：`public/files/output/AvevaMarineSample/parquet/7997/`
- Manifest：`public/files/output/AvevaMarineSample/parquet/manifest_7997.json`

## 数据统计

- **实例数**：7,216 行
- **几何实例数**：20,801 行
- **管道段数**：5,102 行
- **变换矩阵数**：18,085 行
- **包围盒数**：4,990 行
- **总大小**：1.8 MB

## 测试方法

### 方法 1：使用测试页面

1. 启动开发服务器（如果未启动）：
   ```bash
   cd ../plant3d-web
   npm run dev
   ```

2. 访问测试页面：
   ```
   http://localhost:5173/test-parquet-7997.html
   ```

3. 点击"开始测试"按钮，查看加载结果

### 方法 2：在应用中使用

在 plant3d-web 的任何组件中使用 `useDbnoInstancesParquetLoader`：

```typescript
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader'

const loader = useDbnoInstancesParquetLoader()

// 检查 7997 是否可用
const available = await loader.isParquetAvailable(7997)

// 查询实例数据
const refnos = ['24381_100818', '24381_100819'] // 示例 refno
const instances = await loader.queryInstanceEntriesByRefnos(7997, refnos)
```

## 文件清单

```
public/files/output/AvevaMarineSample/parquet/
├── manifest_7997.json          # 元数据清单
└── 7997/
    ├── instances.parquet       # 实例表
    ├── geo_instances.parquet   # 几何实例表
    ├── tubings.parquet         # 管道段表
    ├── transforms.parquet      # 变换矩阵表
    ├── aabb.parquet           # 包围盒表
    └── manifest.json          # 目录级元数据
```
