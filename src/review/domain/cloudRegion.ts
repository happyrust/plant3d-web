/**
 * 云线「空间范围体」记录字段——2026-09-14《三维云线批注：空间范围体 + 屏幕云线呈现重构方案》§6 的类型与 P0 补齐规则。
 *
 * 四个概念分开存，相机更新不能改写前三者：
 * - 问题目标：`bindings[].role === 'member'`（ADR-0049，不在本文件）；
 * - 指认范围：`regionV1`——创建时的世界空间范围体快照（凸单元集合）+ 来源身份；
 * - 呈现版本：`presentationV1`——算法版本与像素参数；
 * - 运行时布局：每帧派生，不持久化。
 *
 * 只增不改：这四个字段都是可选新增，旧字段（`selectionBbox / screenOffset / cloudSize / leaderEndWorldPos`）原样保留。
 * 读取时由 `fillCloudRegionFieldDefaults` 在 `normalizeCloudAnnotationRecord` 单一漏斗里补默认值：
 * **判据是字段缺不缺（不存在 / undefined），不是值是不是 null**——显式 `null` 是「没有」这一真实状态，不再重新推导；
 * 未知版本 / 形状原样保留（不在这里校验，也不交给几何执行器，那是渲染层 P2 的事）。
 *
 * 本文件是纯类型 + 纯函数：无 three / Vue 依赖，矩阵按 three.js 列主序 16 数存。
 */

export type V3 = readonly [number, number, number];
/** three.js `Matrix4.elements` 列主序 16 数 */
export type M4 = readonly number[];

/**
 * 来源身份。缺失一律 `null`，不能用当前打开模型的信息冒充创建来源。
 *
 * - `modelSnapshotId`：几何来源快照。parquet 环境 / 最小交付单元版本 = `${dbno}:parquet:${generated_at}`；
 *   gen-model-v1 records 回包带 `snapshot_epoch` 但适配层尚未透传，先 `null`；backend 实时查询没有身份。
 * - `globalModelMatrix`：世界坐标系身份 = DTX `globalModelMatrix` 本身。它由 dbno × 单位缩放 × 是否重心归零决定，
 *   重心平移取该 dbno 首批加载内容的 bbox 中心，跨会话不稳定——存矩阵才能在不一致时做 G_new · G_old⁻¹ 重映射。
 * - `coordinateFrameId`：人可读键 `${dbno}:${scale}:${recenter ? 1 : 0}`，只作展示与快速比对。
 */
export type SourceStamp = {
  projectKey: string | null;
  modelSnapshotId: string | null;
  globalModelMatrix: M4 | null;
  coordinateFrameId: string | null;
};

/** 面 = ≥3 个顶点索引，封闭、朝向一致（齐次裁剪封口需要面连接关系，不是无拓扑角点列表） */
export type ConvexCellFace = readonly number[];

export type ConvexCell = {
  /** 稳定身份，供波纹相位锚定 */
  id: string;
  /** 来源说明，不替代 bindings */
  memberRefno: string | null;
  /** 顺序持久稳定 */
  vertices: readonly V3[];
  faces: readonly ConvexCellFace[];
};

export type ObbSnapshot = {
  id: string;
  memberRefno: string | null;
  center: V3;
  /** 必须单位化且相互正交；剪切矩阵下退成 `ConvexCell`，不正交化冒充 OBB */
  axes: readonly [V3, V3, V3];
  halfSize: V3;
};

/**
 * - `members`：由目标元素集合的对象变换盒构成（默认路线）；
 * - `user-volume`：用户显式画的局部范围（后置能力），不承诺包住全部 member；
 * - `legacy-snapshot`：由旧记录 `selectionBbox` 派生的单位轴盒，来源身份未知。
 */
export type RegionV1Origin = 'members' | 'user-volume' | 'legacy-snapshot';

export type RegionV1 = {
  version: 1;
  space: 'world';
  source: SourceStamp;
  origin: RegionV1Origin;
} & (
  | { kind: 'obb-union'; boxes: readonly ObbSnapshot[] }
  | { kind: 'hull'; hull: ConvexCell }
  | { kind: 'lasso-prism'; cells: readonly ConvexCell[] }
);

export type CloudPresentationAlgorithm = 'legacy-v0' | 'region-v1';

export type CloudPresentationV1 = {
  version: 1;
  /** `legacy-v0` = 现有「锚点 + 像素偏移 + AABB 贴合」渲染；`region-v1` = 范围体投影云线。旧记录默认前者，显式升级才切后者 */
  algorithm: CloudPresentationAlgorithm;
  contour: 'convex-hull' | 'screen-rect';
  paddingPx: number;
  wavelengthPx: number;
  amplitudePx: number;
  /** 波纹相位锚定的稳定特征身份（cell / vertex）；`legacy-v0` 为 null */
  phaseAnchor: { featureId: string; offsetPx: number } | null;
};

export type CloudLabelLayoutV1 = {
  version: 1;
  anchor: { kind: 'contour-bounds'; uv: readonly [number, number]; labelPoint: 'top-left' };
  /** 只保存用户意图偏移（CSS 像素）；视口夹紧位移不回写 */
  offsetPx: { x: number; y: number };
};

/** 与同日《三维批注交互改进方案》§6.1 同形；`creation` 是创建证据，不是当前相机缓存 */
export type ViewSnapshotV1 = {
  version: 1;
  capturedAt: number;
  position: V3;
  target: V3;
  up: V3;
  projection:
    | { kind: 'perspective'; verticalFovDeg: number; zoom: number; near: number; far: number }
    | { kind: 'orthographic'; worldHeight: number; zoom: number; near: number; far: number };
  viewportCss: { width: number; height: number };
  devicePixelRatio?: number;
  coordinateFrameId?: string;
  modelSnapshotId?: string;
  clipPlanes?: readonly { normal: V3; constant: number }[];
  capturedContext: readonly ('camera' | 'clipping' | 'visibility')[];
};

export type CloudViewpointV1 = {
  creation?: ViewSnapshotV1 | null;
  representative?: ViewSnapshotV1 | null;
};

/** 记录上新增的四个可选字段（`CloudAnnotationRecord` 与之交叉） */
export type CloudRegionFields = {
  regionV1?: RegionV1 | null;
  presentationV1?: CloudPresentationV1 | null;
  viewpointV1?: CloudViewpointV1 | null;
  labelLayoutV1?: CloudLabelLayoutV1 | null;
};

/** 产品参数初值：λ 52 px（与现有 52 px/波一致）、A 4 px、padding 14 px（= `CLOUD_FIT_PADDING_PX`） */
export const CLOUD_PRESENTATION_DEFAULTS = Object.freeze({
  paddingPx: 14,
  wavelengthPx: 52,
  amplitudePx: 4,
});

export function createNullSourceStamp(): SourceStamp {
  return { projectKey: null, modelSnapshotId: null, globalModelMatrix: null, coordinateFrameId: null };
}

/** 旧记录 / 未显式升级记录的呈现版本：一切照旧渲染 */
export function createLegacyCloudPresentationV1(): CloudPresentationV1 {
  return {
    version: 1,
    algorithm: 'legacy-v0',
    contour: 'screen-rect',
    paddingPx: CLOUD_PRESENTATION_DEFAULTS.paddingPx,
    wavelengthPx: CLOUD_PRESENTATION_DEFAULTS.wavelengthPx,
    amplitudePx: CLOUD_PRESENTATION_DEFAULTS.amplitudePx,
    phaseAnchor: null,
  };
}

/** 新建（P2 开关开）或显式「升级为空间云线」的呈现版本：范围体投影 + 凸包 + 恒像素单侧波纹 */
export function createRegionCloudPresentationV1(): CloudPresentationV1 {
  return {
    version: 1,
    algorithm: 'region-v1',
    contour: 'convex-hull',
    paddingPx: CLOUD_PRESENTATION_DEFAULTS.paddingPx,
    wavelengthPx: CLOUD_PRESENTATION_DEFAULTS.wavelengthPx,
    amplitudePx: CLOUD_PRESENTATION_DEFAULTS.amplitudePx,
    // 相位锚定特征由运行时按确定顺序（`src:` 优先、字典序）选取并在帧间转移，不需要持久化才稳定
    phaseAnchor: null,
  };
}

function isFiniteV3(value: unknown): value is V3 {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** 合法 = min / max 都是 3 个有限数且逐轴 `min <= max`（允许零厚度） */
export function isValidSelectionBbox(bbox: unknown): bbox is { min: V3; max: V3 } {
  if (!bbox || typeof bbox !== 'object') return false;
  const { min, max } = bbox as { min?: unknown; max?: unknown };
  if (!isFiniteV3(min) || !isFiniteV3(max)) return false;
  return min[0] <= max[0] && min[1] <= max[1] && min[2] <= max[2];
}

/**
 * 由旧记录的 `selectionBbox`（创建时目标 AABB 快照）派生 `legacy-snapshot` 范围体：单位轴 OBB，来源身份全 `null`。
 * 没有合法 `selectionBbox` 就返回 `null`——只有像素框的旧记录不能无证据升级。
 */
export function deriveLegacySnapshotRegion(selectionBbox: unknown): RegionV1 | null {
  if (!isValidSelectionBbox(selectionBbox)) return null;
  const { min, max } = selectionBbox;
  const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const halfSize: V3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2];
  return {
    version: 1,
    space: 'world',
    source: createNullSourceStamp(),
    origin: 'legacy-snapshot',
    kind: 'obb-union',
    boxes: [
      {
        id: 'legacy-snapshot:0',
        memberRefno: null,
        center,
        axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        halfSize,
      },
    ],
  };
}

/** 经 `fillCloudRegionFieldDefaults` 之后四个字段恒在（值可为 null） */
export type CloudRegionFieldsFilled = {
  regionV1: RegionV1 | null;
  presentationV1: CloudPresentationV1 | null;
  viewpointV1: CloudViewpointV1 | null;
  labelLayoutV1: CloudLabelLayoutV1 | null;
};

/**
 * 读取漏斗里的默认值补齐（方案 §6.3）。返回新对象，不改输入；幂等：`fill(fill(x))` 与 `fill(x)` 深相等。
 * 「缺失」= 字段不存在或值为 `undefined`（JSON 里不可能出现，只有程序里拼出来的记录会有）；显式 `null` 不算缺失。
 *
 * | 缺失项 | 补齐 |
 * |---|---|
 * | `regionV1` | 有合法 `selectionBbox` → `legacy-snapshot` 单位轴 OBB；否则 `null` |
 * | `presentationV1` | `legacy-v0`（有派生范围不意味着用户已同意改变旧记录观感） |
 * | `viewpointV1` | `null`（不能从锚点、拖框尺寸或当前相机推回创建视点） |
 * | `labelLayoutV1` | `null`（继续走旧世界点布局） |
 */
export function fillCloudRegionFieldDefaults<T extends object>(rec: T): T & CloudRegionFieldsFilled {
  const src = rec as T & CloudRegionFields & { selectionBbox?: unknown };
  const out = { ...src } as T & CloudRegionFieldsFilled;
  if (src.regionV1 === undefined) out.regionV1 = deriveLegacySnapshotRegion(src.selectionBbox);
  if (src.presentationV1 === undefined) out.presentationV1 = createLegacyCloudPresentationV1();
  if (src.viewpointV1 === undefined) out.viewpointV1 = null;
  if (src.labelLayoutV1 === undefined) out.labelLayoutV1 = null;
  return out;
}
