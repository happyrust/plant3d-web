# 7997 模型 spec_value 显示验证指南

## 已完成

1. **Parquet 数据**：已将带 spec_value 的 7997 parquet 复制到 `public/files/output/AvevaMarineSample/parquet/`
2. **spec_value 分布**（已验证）：
   - instances: 0→760, 3(仪表)→4998, 4(暖通)→1458
   - tubings: 0→222, 3→4790, 4→90
3. **按专业着色已实现**：
   - `materialConfig.ts`：`resolveMaterialForInstance` 支持 `spec_value` 和 `disciplineOverrides`
   - `useDbnoInstancesDtxLoader.ts`：传递 `spec_value` 到材质解析，缓存 `objectIdToSpecValue`
   - `model-display.config.json`：`disciplineOverrides`: 0=蓝, 3=绿, 4=橙
4. **Mesh 资源**：已从 plant-model-gen 复制 `lod_L1` 到 `public/files/meshes/lod_L1/`

## 手动验证步骤

### 1. 启动前端

```bash
cd D:\work\plant-code\plant3d-web
npm run dev
```

### 2. 加载 7997 模型

在浏览器访问：

```
http://localhost:5173/?output_project=AvevaMarineSample&show_dbnum=7997
```

（端口以终端输出为准，如 5174/5175/5176）

### 3. 预期行为

- **加载阶段**：应看到 Toast「正在加载 dbnum=7997 的 Parquet 模型数据...」，随后「发现 X 个 refno，开始分批加载...」
- **完成**：Toast 显示「加载完成: 对象 X 已加载 Y...」
- **模型显示**：3D 视图中应出现管道、设备等几何体，并按专业着色：
  - spec_value=0：蓝色 (#2196F3)
  - spec_value=3：绿色 (#4CAF50，仪表)
  - spec_value=4：橙色 (#FF9800，暖通)

### 4. 常见问题

| 现象 | 可能原因 |
|------|----------|
| 404 / 加载失败 | 检查 `public/files/output/AvevaMarineSample/parquet/` 下是否有 manifest_7997.json 和 7997/ 子目录 |
| 大量 mesh 缺失 | 后端报告 missing_geo_hashes=5，部分 geo_hash 无 GLB；可忽略或补充 mesh |
| 模型全灰/单色 | 检查 model-display.config.json 中 disciplineOverrides 是否生效，或清除 localStorage 缓存 |

## 数据流概览

```
Parquet instances/tubings (含 spec_value)
    → useDbnoInstancesParquetLoader (uniforms.spec_value)
    → useDbnoInstancesDtxLoader (传 spec_value 给材质 + 缓存 objectIdToSpecValue)
    → resolveMaterialForInstance(config, refno, noun, spec_value)
    → disciplineOverrides[spec_value] 覆盖颜色
    → DTXLayer 显示颜色
```
