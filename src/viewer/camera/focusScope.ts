/**
 * 定位（取景）范围的统一解析。
 *
 * 对应 plant-ui `fix(focus)` 系列 `36cc91f2d`「定位统一走子树范围，任意层级可用」：
 * 那边三个入口（树右键 / 工具栏 / F 键）原来各发各的命令，只认已加载记录的包围盒，
 * SITE / ZONE / PIPE 取不到就**静默不动**。这里把同样的收口做在 plant3d-web 侧。
 *
 * plant3d-web 原来有六个定位入口，各自实现取 AABB 的方式：
 * - 工具栏「定位并显示选中」`ViewerPanel.vue`：`scene.getAABB(targetRefnos)`
 * - 房间树右键 `useRoomTree.ts`：直段走服务端盒，其余 `await collectRefnos` 后 `getAABB`
 * - 属主树 `usePdmsOwnerTree.ts`：**只认已加载的**，一个都没有就 `return`（就是那个静默不动）
 * - 房间信息「聚焦飞行」`useRoomInfo.ts`：只认 `scene.objects` 里有的
 * - 空间查询直段 `useSpatialQuery.ts`：服务端直段盒
 * - 房间裁剪 `useRoomClip.ts`：世界毫米盒转场景
 *
 * 本模块只负责「算出该飞哪儿」，不飞。飞行由 `flyToScope` 做，它同时登记相机意图。
 */
import type { Aabb6, DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { beginCameraIntent } from '@/viewer/camera/cameraIntent';

/** 定位发起方。只为日志与排查用，不影响判定。 */
export type FocusSource = 'toolbar' | 'tree' | 'room' | 'spatial' | 'clip' | 'compare' | 'review';

export type FocusScopeInput = {
  /** 场景里已知的构件 refno（`a_b` 或 `a/b`，`getAABB` 内部会归一）。 */
  refnos?: string[];
  /**
   * 范围根：自身没几何时按子树算。`getSubtreeAABB` 是本地索引、不发网络请求，
   * 只并「已加载的」子树对象——比 `refnos` 强，但没装进场景的仍然取不到。
   */
  scopeRefnos?: string[];
  /** 场景里一个对象都没装时的最后兜底：按子树查一次 refno 清单再算盒。需要调用方注入取数函数。 */
  allowSubtreeQuery?: boolean;
  lookupSubtreeRefnos?: (refno: string) => Promise<string[]>;
  source: FocusSource;
};

export type FocusScopeMiss = 'no-viewer' | 'no-target' | 'no-geometry';

export type FocusScopeResult =
  | { ok: true; aabb: Aabb6; refnos: string[]; via: 'direct' | 'subtree-aabb' | 'subtree-query' }
  | { ok: false; reason: FocusScopeMiss };

/**
 * 算定位目标该用的包围盒（场景坐标）。
 *
 * 顺序：`refnos` 直接并 → `scopeRefnos` 的**子树**并集 → （可选）查一次子树 refno 清单再并。
 * 三级都空就是 `no-geometry`——调用方应当提示「先加载模型」，不要静默不动。
 */
export async function resolveFocusScope(
  viewer: DtxCompatViewer | null | undefined,
  input: FocusScopeInput,
): Promise<FocusScopeResult> {
  if (!viewer) return { ok: false, reason: 'no-viewer' };

  const refnos = uniqueNonEmpty(input.refnos);
  const scopeRefnos = uniqueNonEmpty(input.scopeRefnos);
  if (refnos.length === 0 && scopeRefnos.length === 0) return { ok: false, reason: 'no-target' };

  // 1. 直接并集：构件自己的对象
  if (refnos.length > 0) {
    const aabb = viewer.scene.getAABB(refnos);
    if (aabb) return { ok: true, aabb, refnos, via: 'direct' };
  }

  // 2. 子树并集（本地索引）：SITE / ZONE / PIPE 这类自己没几何的范围根靠这一档
  const subtreeRoots = scopeRefnos.length > 0 ? scopeRefnos : refnos;
  if (subtreeRoots.length > 0 && typeof viewer.scene?.getSubtreeAABB === 'function') {
    const aabb = viewer.scene.getSubtreeAABB(subtreeRoots);
    if (aabb) return { ok: true, aabb, refnos: subtreeRoots, via: 'subtree-aabb' };
  }

  // 3. 最后兜底：问一次子树清单（网络），把已装进场景的那部分并起来
  if (input.allowSubtreeQuery && input.lookupSubtreeRefnos && subtreeRoots.length > 0) {
    const collected: string[] = [];
    for (const root of subtreeRoots) {
      try {
        const found = await input.lookupSubtreeRefnos(root);
        for (const refno of found) {
          const key = String(refno ?? '').trim();
          if (key) collected.push(key);
        }
      } catch {
        // 查不到就跳过这个根：定位失败要落到 no-geometry，不能因为一次网络错就抛给调用方
      }
    }
    const merged = uniqueNonEmpty(collected);
    if (merged.length > 0) {
      const aabb = viewer.scene.getAABB(merged);
      if (aabb) return { ok: true, aabb, refnos: merged, via: 'subtree-query' };
    }
  }

  return { ok: false, reason: 'no-geometry' };
}

/**
 * 解析 + 飞。解析成功就登记一次相机意图（作废在途的旧意图）再飞。
 *
 * 注意：这是**同步发起**的取景，所以登记意图是安全的。异步路径（等模型装完再飞）不能直接用这个——
 * 那些路径要在 `await` 之前 `beginCameraIntent()` 拿戳、落地后 `isCameraIntentCurrent(stamp)` 核对，
 * 见 `ViewerPanel.vue` 的 `showModelByRefnos` 分支。
 */
export async function flyToScope(
  viewer: DtxCompatViewer | null | undefined,
  input: FocusScopeInput,
): Promise<FocusScopeResult> {
  const resolved = await resolveFocusScope(viewer, input);
  if (!resolved.ok) return resolved;
  beginCameraIntent();
  viewer!.cameraFlight.flyTo({ aabb: resolved.aabb, duration: 0.8, fit: true });
  return resolved;
}

function uniqueNonEmpty(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const key = String(raw ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}
