# Verification · DTX 房间凸壳裁剪

> 每个 Phase 完成后，在这里追加：命令 / 输出 / 截图 / 性能数据。

## 模板

每条验证记录使用以下结构：

```
### YYYY-MM-DD HH:MM · Phase X · Task X.Y

**命令**：
\`\`\`
$ <command>
\`\`\`

**关键输出**：
<片段>

**截图**：
- assets/verify-<phase>-<task>-<topic>.png

**结论**：✅ / ⚠️ / ❌  +  说明
```

---

## 待验证清单（拉清单先放这里，验完搬到上方记录区）

### Phase 1

- [ ] 后端 `extract_world_planes` 单元 cargo check 通过
- [ ] `curl /api/room/clip-config?ids=<立方体房间>` 返回合理的 plane 集合
- [ ] 前端 `DTXClipController.setRooms([oneRoom])` 不 throw
- [ ] shader 编译通过（控制台无 GLSL error，验证 cacheKey 已升）
- [ ] 立方体房间裁剪：视觉切口正确
- [ ] picking shader：被裁区域点不中

### Phase 2

- [ ] 立方体房间 API 返回 `mode=aabb`
- [ ] L 型房间 API 返回 `mode=convex_hulls`
- [ ] DB `room_clip_mode` 表写入正确
- [ ] 阈值环境变量覆盖生效

### Phase 3

- [ ] mesh_to_sdf bake 球罐房间 < 30s
- [ ] CLI `room_sdf_inspect` 输出 z-slice PNG 看起来正确
- [ ] `sdf/{hash}.rkyv` 大小符合预期
- [ ] 失效检测：mesh 改变后重 bake

### Phase 4

- [ ] `sampler2DArray` 上传不阻塞主线程
- [ ] 球罐裁剪视觉正确（无折面感）
- [ ] LRU 卸载：32+ 房间切换流畅
- [ ] `?clipDebugForceMode=sdf` 强制覆盖生效

### Phase 5

- [ ] 5 类房间端到端通过
- [ ] FPS drop < 10%
- [ ] Mac Intel / Windows NVIDIA / Linux Mesa 兼容
- [ ] E2E spec 稳定通过

---

## 性能 baseline（在 Phase 1 启动前记一份，便于对比）

待补：

- 测试场景：__待填写__
- 设备/GPU：__待填写__
- 关闭裁剪 FPS：__待填写__
- 单房间 X-ray FPS：__待填写__
- 多房间 X-ray FPS：__待填写__
