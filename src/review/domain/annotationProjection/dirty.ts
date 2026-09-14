/**
 * 云线渲染的分阶段脏标记——2026-09-14 方案 §9.1（D11）的纯函数部分。
 *
 * 不能只给渲染循环加一个统一 `dirty`：颜色变了也重建几何、相机没动也每帧 `setPoints`。
 * 依赖按流水线阶段拆开，每个阶段只看自己的输入：
 *
 * | 阶段 | 依赖 |
 * |---|---|
 * | `resolve` 目标解析 | `modelEpoch`（加载器修订）、`targetBounds`、`bindings` |
 * | `project` 投影 | `cameraWorld`、`projection`、`viewportCss`、`overlayTransform`、`globalModelMatrix`、`effectiveRegion` |
 * | `shape` 轮廓几何 | `project` ∪ `shapeStyle`（线宽 / halo / padding / 波幅 / 绘制模式）∪ `presentation` |
 * | `label` 文字框 + 引线 | `shape` ∪ `labelMetrics`（文字、实测尺寸）∪ `labelPreference` |
 * | `paint` 材质 | `paintStyle`（颜色 / 透明度）∪ `presentation` ∪ `dpr` |
 *
 * 版本号由适配层维护（three.js 相机没有矩阵版本计数——用 `createArrayVersionTracker` 比较 16 个元素）；
 * 值没变就不推进。首帧（`prev === null`）全脏。
 */

export type CloudRenderStamp = {
  cameraWorld: number;
  projection: number;
  viewportCss: number;
  overlayTransform: number;
  dpr: number;
  /** 世界坐标系身份：DTX `globalModelMatrix`（单位 / 重心变化不经 `dtxLoaderRevision`，§15 ④） */
  globalModelMatrix: number;
  modelEpoch: number;
  targetBounds: number;
  bindings: number;
  effectiveRegion: number;
  shapeStyle: number;
  paintStyle: number;
  labelMetrics: number;
  labelPreference: number;
  presentation: number;
};

export type CloudDirtyFlags = {
  resolve: boolean;
  project: boolean;
  shape: boolean;
  label: boolean;
  paint: boolean;
};

export const ALL_CLOUD_DIRTY: Readonly<CloudDirtyFlags> = Object.freeze({
  resolve: true,
  project: true,
  shape: true,
  label: true,
  paint: true,
});

export function computeCloudDirty(prev: CloudRenderStamp | null, next: CloudRenderStamp): CloudDirtyFlags {
  if (!prev) return { ...ALL_CLOUD_DIRTY };
  const changed = (...keys: (keyof CloudRenderStamp)[]) => keys.some((k) => prev[k] !== next[k]);
  const resolve = changed('modelEpoch', 'targetBounds', 'bindings');
  const project = changed('cameraWorld', 'projection', 'viewportCss', 'overlayTransform', 'globalModelMatrix', 'effectiveRegion');
  const shape = project || changed('shapeStyle', 'presentation');
  return {
    resolve,
    project,
    shape,
    label: shape || changed('labelMetrics', 'labelPreference'),
    paint: changed('paintStyle', 'presentation', 'dpr'),
  };
}

export function isAnyCloudDirty(flags: CloudDirtyFlags): boolean {
  return flags.resolve || flags.project || flags.shape || flags.label || flags.paint;
}

/**
 * 给「一组数」维护版本号：值逐元素相等就不推进。用于相机 `matrixWorld / projectionMatrix`、
 * 视口尺寸、目标 AABB 六个数等没有自带版本计数的输入。
 */
export type ArrayVersionTracker = {
  /** 比较并记录；返回当前版本（首次调用为 1） */
  update(values: ArrayLike<number>): number;
  /** 当前版本（未 update 过为 0） */
  readonly version: number;
};

export function createArrayVersionTracker(): ArrayVersionTracker {
  let last: Float64Array | null = null;
  let version = 0;
  return {
    update(values) {
      const n = values.length;
      let same = last !== null && last.length === n;
      if (same && last) {
        for (let i = 0; i < n; i++) {
          if (last[i] !== values[i]) { same = false; break; }
        }
      }
      if (!same) {
        if (!last || last.length !== n) last = new Float64Array(n);
        for (let i = 0; i < n; i++) last[i] = values[i]!;
        version += 1;
      }
      return version;
    },
    get version() {
      return version;
    },
  };
}

/** 给「一个可比较值」（引用 / 字串 / 数）维护版本号 */
export type ValueVersionTracker<T> = {
  update(value: T): number;
  readonly version: number;
};

export function createValueVersionTracker<T>(): ValueVersionTracker<T> {
  let has = false;
  let last: T | undefined;
  let version = 0;
  return {
    update(value) {
      if (!has || last !== value) {
        has = true;
        last = value;
        version += 1;
      }
      return version;
    },
    get version() {
      return version;
    },
  };
}
