/**
 * 多 BRAN 同屏的**编排**部分（2026-11-02）。
 *
 * `ViewerPanel.vue` 里这段原本写在启动回调里：解析 dbnum → 按库分组 → 逐包查可见子实例 →
 * 合并根 refno → 得到「每个库要装哪些 refno」。它只做取数与归集，不碰 `dtxLayer` /
 * `compat`，所以能搬出来单测——多 BRAN 的第一个真问题是「跨库分组有没有真的接进加载
 * 路径」，而组件没有测试文件时这一点没有任何证据。
 *
 * 依赖全部注入（解析库号、查可见子实例、解释无几何原因），调用方负责接真实实现：
 * `ViewerPanel` 传 `getDbnumByRefno` / `getModelSource().tree.visibleInsts` /
 * `describeNoGeometryReason`，测试传表。
 *
 * 失败隔离分三层：
 * - **单 refno**：`visibleInsts` 抛错 → 回退为只装根 refno，记一条 hint，不中断该组；
 * - **原因查询**：`describeNoGeometry` 抛错 → 只是拿不到原因（`noGeometryReason` 留空），
 *   不影响该组装载——解释文字失败不该让模型消失；
 * - **单组**：整组处理中逃逸出来的错误 → 记进 `failures`，**其余组继续**。
 *
 * 第二个真问题（一个坏包连坐其余好包）就在第三层：单 BRAN 时代只有一组，外层一个大
 * `try/catch` 够用；多 BRAN 之后必须按组隔离。`runBranLoadPlan` 把装载阶段的同一套
 * 串行 + 隔离也抽了出来，组件只留 `loadDbnoInstancesForVisibleRefnosDtx` 这一句副作用。
 */
import { groupRefnosByDbnum } from '@/utils/refnoDbnumGroup';
import { normalizeRefnoList } from '@/utils/refnoListParam';

/** 一个库（dbnum）要装的 refno 集合，以及「这个库为什么可能画不出东西」的说明。 */
export type PreparedGroup = {
  dbno: number;
  refnos: string[];
  noGeometryReason: string | null;
};

/** 某一组整体失败（prepare 或 load 阶段）。`refnos` 是**请求的** refno，不是装成功的。 */
export type GroupFailure = {
  dbno: number;
  refnos: readonly string[];
  error: string;
};

/** `tree.visibleInsts` 的最小形状；多一层包装是为了让测试不必构造完整响应。 */
export type VisibleInstsResult = {
  success?: boolean;
  refnos?: readonly string[];
} | null;

export type BranLoadPlan = {
  /** 按 dbnum 首次出现的顺序，可直接逐组串行装载。 */
  prepared: PreparedGroup[];
  /** 解析不出 dbnum 的 BRAN（保持输入顺序）。 */
  unresolved: string[];
  /** 给用户的降级提示（可见子实例为 0 / 查询失败回退）。 */
  hints: string[];
  /** 整组失败；`prepared` 里不会出现这些 dbno。 */
  failures: GroupFailure[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 拿「为什么没有几何」的说明；查不到就返回 null，绝不把异常抛给调用方。 */
async function describeNoGeometrySafely(
  describeNoGeometry: (refno: string) => Promise<string | null>,
  refno: string,
): Promise<string | null> {
  try {
    return await describeNoGeometry(refno);
  } catch {
    return null;
  }
}

/**
 * 根 refno 与可见子实例合并：归一化（`toRefnoKey` 口径）、保序、去重。
 *
 * 容器节点本身通常没有几何，必须把 `visibleInsts` 回的构件一起交给装载器；根节点
 * 也保留，否则「容器自己就是一个可画对象」的场景会漏。
 *
 * 与 `ViewerPanel` 里旧的私有实现同义，只是归一化改用 `refnoListParam` 的口径，
 * 免得 `show_refno` 与 `mbd_refno` 两份解析规则分叉。
 */
export function mergeRootRefnoWithVisibleRefnos(
  rootRefno: string,
  visibleRefnos: readonly (string | null | undefined)[],
): string[] {
  return [...normalizeRefnoList([rootRefno, ...visibleRefnos])];
}

/**
 * 产出「每组装哪些 refno」的加载计划。
 *
 * @param refnos 原始 BRAN 列表（`show_refno` 已解析过一遍，这里再归一化一次无害）
 * @param resolveDbno 解析单个 BRAN 的库号；返回 `null` / 抛错 / 非正数都算解析失败
 * @param visibleInsts 查某个 BRAN 下「有几何的可见构件」；抛错按「回退只装根」处理
 * @param describeNoGeometry 解释某个 BRAN 为什么没有几何；抛错会让**该组**整体失败
 */
export async function prepareBranLoadPlan(
  refnos: readonly (string | null | undefined)[],
  resolveDbno: (refno: string) => number | null,
  visibleInsts: (refno: string) => Promise<VisibleInstsResult>,
  describeNoGeometry: (refno: string) => Promise<string | null>,
): Promise<BranLoadPlan> {
  const grouping = groupRefnosByDbnum(refnos, resolveDbno);
  const prepared: PreparedGroup[] = [];
  const hints: string[] = [];
  const failures: GroupFailure[] = [];

  for (const group of grouping.groups) {
    try {
      const loadRefnos: string[] = [];
      const seen = new Set<string>();
      const pushMerged = (entries: readonly string[]): void => {
        for (const entry of entries) {
          if (seen.has(entry)) continue;
          seen.add(entry);
          loadRefnos.push(entry);
        }
      };

      let groupNoGeometryReason: string | null = null;

      for (const refno of group.refnos) {
        let visibleInstsUserHint: string | null = null;
        try {
          const visResp = await visibleInsts(refno);
          const visRefnos = Array.isArray(visResp?.refnos) ? visResp.refnos : [];
          if (visRefnos.length > 0) {
            pushMerged(mergeRootRefnoWithVisibleRefnos(refno, visRefnos));
          } else if (visResp?.success) {
            // 接口说查成功但一个构件都没有：可能是容器、可能是零尺寸 BOX。
            pushMerged(mergeRootRefnoWithVisibleRefnos(refno, []));
            if (groupNoGeometryReason === null) {
              groupNoGeometryReason = await describeNoGeometrySafely(describeNoGeometry, refno);
            }
            visibleInstsUserHint =
              `可见子实例为 0（refno=${refno}），仅加载根节点；` +
              `${groupNoGeometryReason || '若为容器可能没有几何，请检查可见性或数据'}`;
          } else {
            // `success: false`（如不存在的 BRAN）：旧行为是静默只装根，交给装载器报缺失。
            pushMerged(mergeRootRefnoWithVisibleRefnos(refno, []));
          }
        } catch {
          pushMerged(mergeRootRefnoWithVisibleRefnos(refno, []));
          visibleInstsUserHint = `查询可见子实例失败（refno=${refno}），已回退为仅加载根 refno`;
        }
        if (visibleInstsUserHint) hints.push(visibleInstsUserHint);
      }

      prepared.push({
        dbno: group.dbno,
        refnos: loadRefnos,
        noGeometryReason: groupNoGeometryReason,
      });
    } catch (error) {
      failures.push({
        dbno: group.dbno,
        refnos: [...group.refnos],
        error: errorMessage(error),
      });
    }
  }

  return {
    prepared,
    unresolved: [...grouping.unresolved],
    hints,
    failures,
  };
}

/**
 * `show_dbnum` 是否该覆盖 `getDbnumByRefno` 的解析结果。
 *
 * `show_dbnum` 的语义是「整库显示」，历史上与单值 `show_refno` 同时出现时用它兜底
 * （那时 BRAN 一定属于那个库）。多值 `show_refno` 明确表达了**跨库**意图，再用它覆盖
 * 就会把第二个库的包按第一个库的实例表去查，静默查不到几何——正是本轮要修的现象。
 * 所以只在单 BRAN 时允许覆盖，多 BRAN 一律逐条解析。
 */
export function resolveShowDbnumOverride(
  showDbnum: number | null,
  refnoCount: number,
): number | null {
  return refnoCount <= 1 ? showDbnum : null;
}

/** 把失败列表压成一行提示：`dbnum 7997（1 个 refno）失败：<原因>；…`。 */
export function formatGroupFailures(failures: readonly GroupFailure[]): string {
  return failures
    .map(failure => `dbnum ${failure.dbno}（${failure.refnos.length} 个 refno）失败：${failure.error}`)
    .join('；');
}

/** 把「装载成功但收尾失败」压成一行提示。 */
export function formatSideEffectFailures(failures: readonly GroupSideEffectFailure[]): string {
  return failures
    .map(failure => `dbnum ${failure.dbno} 已装载但收尾失败：${failure.error}`)
    .join('；');
}

/** 已经装进场景的一组：URL 里哪些 BRAN 促成了它，以及实际装进去的 refno。 */
export type AppliedShowGroup = {
  dbno: number;
  /** 这组对应 URL 里的哪些 BRAN（已归一化）。 */
  rootRefnos: readonly string[];
  /** 实际装进场景的 refno（根 + 可见子实例）。 */
  loadedRefnos: readonly string[];
};

export type ShowRefnoDelta = {
  /** 要整组撤下的已装组。 */
  evict: AppliedShowGroup[];
  /** 要新装的 BRAN，保持 URL 顺序。 */
  load: string[];
  /** 已由保留组覆盖、无需动的 BRAN，保持 URL 顺序。 */
  unchanged: string[];
};

/**
 * 对比「已装的组」与 URL 里新的 `show_refno`，得出增量：撤哪些组、装哪些 BRAN。
 *
 * 组是撤除的最小单位：组里**任一** BRAN 不在新列表里就整组撤下，免得半个包留在
 * 场景里（同库多 BRAN 是一次装进去的，没法按 BRAN 拆出各自的子实例）。整组撤下后，
 * 该组里仍在新列表中的 BRAN 不再被覆盖，会自然落进 `load` 重装。
 */
export function planShowRefnoDelta(
  applied: readonly AppliedShowGroup[],
  nextRefnos: readonly string[],
): ShowRefnoDelta {
  const next = normalizeRefnoList(nextRefnos);
  const nextSet = new Set(next);
  const evict: AppliedShowGroup[] = [];
  const covered = new Set<string>();

  for (const group of applied) {
    const roots = normalizeRefnoList(group.rootRefnos);
    if (roots.some(refno => !nextSet.has(refno))) {
      evict.push(group);
    } else {
      for (const refno of roots) covered.add(refno);
    }
  }

  const load: string[] = [];
  const unchanged: string[] = [];
  for (const refno of next) {
    (covered.has(refno) ? unchanged : load).push(refno);
  }
  return { evict, load, unchanged };
}
/** 装载成功的一组。`value` 是装载器原始返回值，编排层不解释它。 */
export type GroupLoadOutcome<T> = {
  dbno: number;
  refnos: readonly string[];
  value: T;
};

/** 装载成功、但**装载后副作用**失败的一组。几何已经在场景里，不能算这一组装载失败。 */
export type GroupSideEffectFailure = {
  dbno: number;
  error: string;
};

export type BranLoadPlanRunOptions<T> = {
  /** 每组开始前触发，用于进度日志。它抛错不影响装载。 */
  onGroupStart?: (group: PreparedGroup) => void;
  /**
   * 一组装载成功后的副作用：刷新空间索引、重放可见性、单位归一化、auto-fit 等。
   *
   * 它抛错**不算**这一组失败。几何此刻已经在场景里了，若把整组记成失败，统计会报
   * 0 对象、提示会报「N 组中 M 组成功」，而画面里模型明明在——「提示说失败、画面有
   * 模型」比不报错更糟。这类错误单独进 `sideEffectFailures`，按警告呈现。
   */
  afterGroupLoaded?: (group: PreparedGroup, value: T) => void;
};

/**
 * 串行执行装载计划，**按组隔离失败**。
 *
 * 串行是硬要求：多组并发装几何会把后端与内存打爆（实测 OOM）。隔离也是硬要求：
 * 单 BRAN 时代只有一组，一个 `try/catch` 兜住整批没问题；多 BRAN 之后一个坏包
 * 连坐其余好包，与「多 BRAN 同屏」的目标直接冲突。
 *
 * `loadGroup` 的副作用（`dtxLayer` 写入、`compat.__dtxAfterInstancesLoaded`）留在
 * 调用方注入的函数里——编排层只管顺序、归集与失败隔离，不碰三维对象，才能单测。
 *
 * 三层错误语义，别混：
 * - `loadGroup` 抛错 → `failures`（这一组真的没装进来）；
 * - `afterGroupLoaded` 抛错 → `sideEffectFailures`（装进来了，收尾动作失败）；
 * - `onGroupStart` 抛错 → 忽略（只是日志）。
 */
export async function runBranLoadPlan<T>(
  prepared: readonly PreparedGroup[],
  loadGroup: (group: PreparedGroup) => Promise<T>,
  options: BranLoadPlanRunOptions<T> = {},
): Promise<{
  succeeded: GroupLoadOutcome<T>[];
  failures: GroupFailure[];
  sideEffectFailures: GroupSideEffectFailure[];
}> {
  const succeeded: GroupLoadOutcome<T>[] = [];
  const failures: GroupFailure[] = [];
  const sideEffectFailures: GroupSideEffectFailure[] = [];

  for (const group of prepared) {
    try {
      options.onGroupStart?.(group);
    } catch {
      // 进度日志失败不该影响装载。
    }
    try {
      const value = await loadGroup(group);
      succeeded.push({ dbno: group.dbno, refnos: group.refnos, value });
      if (options.afterGroupLoaded) {
        try {
          options.afterGroupLoaded(group, value);
        } catch (error) {
          sideEffectFailures.push({ dbno: group.dbno, error: errorMessage(error) });
        }
      }
    } catch (error) {
      failures.push({
        dbno: group.dbno,
        refnos: [...group.refnos],
        error: errorMessage(error),
      });
    }
  }

  return { succeeded, failures, sideEffectFailures };
}
