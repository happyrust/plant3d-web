# plant3d-web AABB 预计算优化

## 优化背景

在 plant3d-web 项目中，instances.json 文件已经包含了预计算的 AABB（轴对齐包围盒）数据，但之前的代码在加载时会重新计算所有对象的 AABB，造成了不必要的性能开销。

## 优化内容

### 一、数据结构增强

在 `instanceManifest.ts` 中，为 `InstanceEntry` 类型添加了 `aabb` 字段：

```typescript
export type InstanceEntry = {
  geo_hash: string
  matrix: number[]
  // ... 其他字段
  aabb?: Aabb | null // 预计算的世界空间 AABB（来自 instances.json）
}

type Aabb = {
  min: number[]
  max: number[]
}
```

### 二、保留预计算 AABB

修改了 `flattenInstances` 函数，在扁平化实例数据时保留 AABB 信息：

#### 1. Groups 格式处理

```typescript
// 获取并传递 child 的预计算 AABB
const childAabb = (child as any).aabb ?? null

out.push({
  // ... 其他字段
  aabb: childAabb, // 保留预计算的 AABB
})

// 管道的 AABB 也同样保留
out.push({
  // ... 其他字段
  aabb: tubing.aabb ?? null,
})
```

#### 2. FlatInstanceV0 格式处理

```typescript
const instAabb = inst?.aabb ?? null // 获取该 refno 级别的预计算 AABB

list.push({
  // ... 其他字段
  aabb: instAabb, // 传递预计算的 AABB
})
```

### 三、DTXLayer 支持预计算 AABB

修改 `DTXLayer.addObject` 方法，支持接收预计算的 AABB：

```typescript
addObject(
  objectId: string,
  geoHash: string,
  matrix: Matrix4,
  color: Color = new Color(0xffffff),
  pbr: PBRParams = {},
  precomputedAabb?: { min: number[]; max: number[] } | null // 新增参数
): ObjectHandle {
  // ...
  
  // 计算或使用预计算的世界包围盒
  if (precomputedAabb && precomputedAabb.min && precomputedAabb.max) {
    // 使用 instances.json 中预计算的 AABB，避免重复计算
    obj.boundingBox.set(
      new Vector3(precomputedAabb.min[0], precomputedAabb.min[1], precomputedAabb.min[2]),
      new Vector3(precomputedAabb.max[0], precomputedAabb.max[1], precomputedAabb.max[2])
    );
    if (this._debug) {
      console.log(`📦 使用预计算 AABB: ${objectId}`, precomputedAabb);
    }
  } else {
    // 动态计算对象的世界包围盒（兜底逻辑）
    const geoBBox = this._computeGeometryLocalBBox(geoHandle);
    obj.boundingBox.copy(geoBBox).applyMatrix4(matrix);
    if (this._debug) {
      console.log(`🔧 动态计算 AABB: ${objectId}`);
    }
  }
  // ...
}
```

### 四、加载器传递预计算 AABB

修改 `useDbnoInstancesDtxLoader.ts`，在加载时传递预计算的 AABB：

```typescript
for (const inst of insts) {
  // ...
  
  // 获取预计算的 AABB（如果 instances.json 中提供了）
  const precomputedAabb = (inst as any).aabb ?? null

  dtxLayer.addObject(
    objectId,
    geoHash,
    matrix,
    resolved.color,
    {
      metalness: resolved.metalness,
      roughness: resolved.roughness,
    },
    precomputedAabb // 传递预计算的 AABB
  )
}
```

## 优化效果

### 性能提升

1. **避免重复计算**：不再需要遍历几何体的所有顶点来计算包围盒
2. **减少内存分配**：减少 Box3 和 Vector3 对象的创建
3. **加快加载速度**：特别是在大规模场景中，可以显著减少加载时间

### 兜底机制

即使 instances.json 中没有提供 AABB 数据，代码也会自动回退到动态计算模式，确保功能正常工作。

## 数据来源

预计算的 AABB 数据来自后端生成的 instances.json 文件：

```
@gen_model-dev/output/instances/instances_{dbno}.json
```

文件中的 AABB 格式示例：

```json
{
  "groups": [
    {
      "owner_refno": "1112_/P101",
      "owner_aabb": {
        "min": [100.0, 200.0, 300.0],
        "max": [150.0, 250.0, 350.0]
      },
      "children": [
        {
          "refno": "1112_/P101-E01",
          "aabb": {
            "min": [105.0, 205.0, 305.0],
            "max": [145.0, 245.0, 345.0]
          }
        }
      ]
    }
  ]
}
```

## 调试验证

在 DTXLayer 的 debug 模式下，可以看到每个对象是使用了预计算 AABB 还是动态计算：

```javascript
// 启用 debug 模式
const dtxLayer = new DTXLayer({
  debug: true,
  // ...
})

// 控制台输出：
// 📦 使用预计算 AABB: o:1112_/P101:0 { min: [...], max: [...] }
// 🔧 动态计算 AABB: o:1112_/P102:1
```

## 相关文件

- `src/utils/instances/instanceManifest.ts` - 实例数据类型定义和扁平化逻辑
- `src/utils/three/dtx/DTXLayer.ts` - DTX 渲染层，添加对象时使用 AABB
- `src/composables/useDbnoInstancesDtxLoader.ts` - 实例数据加载器

## 总结

这个优化通过利用后端预计算的 AABB 数据，避免了前端的重复计算，提升了场景加载性能。同时保留了兜底机制，确保在没有预计算数据时功能依然正常。

### 关键点

✅ 保留 instances.json 中的预计算 AABB 数据  
✅ DTXLayer 优先使用预计算 AABB  
✅ 保留动态计算作为兜底机制  
✅ 支持多种 instances.json 格式（groups、instances、V0）  
✅ 提供 debug 模式验证优化效果
