/**
 * 云线渲染演进的阶段开关（2026-09-14 方案 §11）。每个阶段独立可回退：关掉开关 = 回到上一阶段行为。
 *
 * - `cloudLabelLayoutV1`（P1）：带 `labelLayoutV1` 的云线记录按屏幕像素意图布局文字框，引线取「可见云线边界 — 文字框」最近点对；
 *   关掉后所有云线回到旧的 `leaderEndWorldPos` 世界点布局，记录里的 `labelLayoutV1` 只是不被读。
 * - `cloudDirtyCache`（P1）：分阶段脏标记——相机 / 视口 / 目标 / 样式都没变时不重建轮廓、不 `setPoints`、不重排文字框；
 *   关掉后恢复每帧重建（现状）。
 * - `cloudProjectedEnvelope`（P2，= 交互方案 `annotationUx.projectedEnvelope`）：
 *   新建云线写 `regionV1(obb-union, origin:'members')` + `viewpointV1.creation` + `presentationV1.algorithm='region-v1'`；
 *   `region-v1` 记录按「范围体齐次裁剪 → 屏幕凸包 → 圆角外扩 → 单侧余弦波纹」呈现，bbox3d 画同一范围体的真实盒边。
 *   关掉后：新建只写旧字段（漏斗补 `legacy-v0`），已有 `region-v1` 记录按旧管线兼容显示，新字段原样保留不丢。
 * - `annotationSharedRegion`（P3，方案 §7）：rect / obb 新建也写 `regionV1(obb-union, origin:'members')`——每个成员对象一个真实放置盒
 *   （`primitiveFromPlacement`），线框按这些盒画（多成员多盒，不再用一个合并 AABB 冒充 OBB）；`obb` 旧字段照旧双写。
 *   关掉后：新建只写 `obb`，已带 `regionV1` 的记录按 `obb` 线框兼容显示，字段保留。旧记录任何时候都不自动迁移。
 *
 * 默认全部开启。覆盖方式（优先级从高到低）：
 * 1. URL `?cloud_render_flags=cloudLabelLayoutV1:0,cloudDirtyCache:1`
 * 2. localStorage `plant3d.cloudRenderFlags` = `{"cloudLabelLayoutV1":false}`
 * 3. 默认值
 */

export type CloudRenderFlag = 'cloudLabelLayoutV1' | 'cloudDirtyCache' | 'cloudProjectedEnvelope' | 'annotationSharedRegion';

export const CLOUD_RENDER_FLAG_STORAGE_KEY = 'plant3d.cloudRenderFlags';
export const CLOUD_RENDER_FLAG_URL_PARAM = 'cloud_render_flags';

const DEFAULTS: Readonly<Record<CloudRenderFlag, boolean>> = Object.freeze({
  cloudLabelLayoutV1: true,
  cloudDirtyCache: true,
  cloudProjectedEnvelope: true,
  annotationSharedRegion: true,
});

const FLAG_NAMES = Object.keys(DEFAULTS) as CloudRenderFlag[];

let overrides: Partial<Record<CloudRenderFlag, boolean>> | null = null;

function isFlagName(name: string): name is CloudRenderFlag {
  return (FLAG_NAMES as string[]).includes(name);
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return null;
}

function readOverrides(): Partial<Record<CloudRenderFlag, boolean>> {
  const out: Partial<Record<CloudRenderFlag, boolean>> = {};
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(CLOUD_RENDER_FLAG_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      if (parsed && typeof parsed === 'object') {
        for (const [name, value] of Object.entries(parsed)) {
          if (isFlagName(name) && typeof value === 'boolean') out[name] = value;
        }
      }
    } catch {
      // 坏 JSON 当没设
    }
  }
  if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
    const raw = new URLSearchParams(window.location.search).get(CLOUD_RENDER_FLAG_URL_PARAM);
    if (raw) {
      for (const item of raw.split(',')) {
        const [name, value] = item.split(':');
        if (!name || !isFlagName(name.trim())) continue;
        const parsed = value === undefined ? true : parseBool(value);
        if (parsed !== null) out[name.trim() as CloudRenderFlag] = parsed;
      }
    }
  }
  return out;
}

export function isCloudRenderFlagEnabled(flag: CloudRenderFlag): boolean {
  if (!overrides) overrides = readOverrides();
  return overrides[flag] ?? DEFAULTS[flag];
}

/** 运行时切换并持久化到 localStorage（URL 覆盖仍然优先）。 */
export function setCloudRenderFlag(flag: CloudRenderFlag, enabled: boolean): void {
  if (typeof localStorage !== 'undefined') {
    let current: Record<string, unknown> = {};
    try {
      current = JSON.parse(localStorage.getItem(CLOUD_RENDER_FLAG_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    } catch {
      current = {};
    }
    current[flag] = enabled;
    localStorage.setItem(CLOUD_RENDER_FLAG_STORAGE_KEY, JSON.stringify(current));
  }
  overrides = null;
}

/** 丢掉已读缓存，下次访问重读 localStorage / URL（测试与调试用）。 */
export function resetCloudRenderFlagCache(): void {
  overrides = null;
}
