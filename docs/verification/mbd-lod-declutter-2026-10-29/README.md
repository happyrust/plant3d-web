# W0-2 T7.6 前后对比（2026-10-30）

`mbd_lod=1`（LOD 隐藏）在 T7.6 前后的视觉对照。固定相机，远 / 中 / 近三档，
两组的相机参数逐位一致（`mid` 档 position 有一位 1e-14 的浮点往返噪声）。

- **before** = `12f4bb1e^`（`62262a9e`，T7.6 之前），dev server `127.0.0.1:3111`
  （worktree `p3w-w02-before`，junction `node_modules`）
- **after** = `5574463f`（当前 main），dev server `127.0.0.1:3101`
- 后端 `GEN_MODEL_V1_BASE_URL=http://127.0.0.1:8022`（rocksdb 档常驻）
- 生成器：`e2e/dimension-camera-baseline.spec.ts`，
  `DIMENSION_CAMERA_BASELINE=1 npx playwright test --config=playwright.novideo.config.ts`

## LOD 计数（cameras.json 侧车）

`24381_145018`（63 条记录）：

| 档 | before drawn / lodHidden | after drawn / lodHidden |
| --- | --- | --- |
| far | 11 / 52 | 21 / 42 |
| mid | 11 / 52 | 21 / 42 |
| near | 16 / 47 | 29 / 34 |

`24383_91813`（18 条记录）：两树三档全部 18 / 0——记录少时 LOD 不触发，
这条作为「改动不影响小场景」的对照。

## 视觉结论（mid 档）

- before：secondary 档按投影高度隐藏后只剩 11 条，且幸存的标签全部横排
  堆叠在管线起点附近，互相盖住、盖住管件；管件右半段一条标注都没有。
- after：`lodSecondaryMinPx = 0` 让长度标注沿线正常排布
  （2640.89 / 1902.35 / 2515.13 …），标高卡（PE +13301 …）散布到各特征点，
  同屏 21 条互不重叠。
- 差异全部来自 LOD 阈值拆分（T7.6）与退化四边形去重叠回退 AABB——相机、
  记录数、后端数据完全一致。

## 钉子用例

`theme.test.ts` 钉住 `lodSecondaryMinPx = 0` / `lodDetailMinPx = 18`（Q5，
2026-10-29）。
