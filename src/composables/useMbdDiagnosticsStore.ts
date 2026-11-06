import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

import type { MbdV2Isoline, MbdV2Issue, MbdV2SourceVersion } from '@/dimension';

export type MbdDiagnosticsChannel = 'api';

/**
 * 一个 BRAN 包的逐源诊断视图（多 BRAN 同屏，2026-11-02）：`mbd_refno=A,B`
 * 时每个来源一包，字段与顶层聚合快照同名、但只覆盖本包。`refno` 是包级
 * 归因的锚点——`issues[].refno` 指向的是构件不是包，按包拆开展示只能靠它。
 */
export type MbdDiagnosticsSourceSnapshot = Readonly<{
  /** 该包的 BRAN refno（`mbd_refno` 列表里那一项，已归一化）。 */
  refno: string;
  /** 该包后端排版 issues，对标 PML wronglines。 */
  issues: readonly MbdV2Issue[];
  /** 该包通道与映射层跳过的图元诊断。 */
  skipped: readonly Readonly<{ id: string; reason: string }>[];
  /** 该包求解器自报的排版模式（`meta.layout_mode`）；缺省时为 null。 */
  layoutMode: string | null;
  /** 该包求解器自报的排版备注（`meta.notes`）与同步层追加的调试提示。 */
  notes: readonly string[];
  /** 该包求解器自报的数据时点（`meta.source_version`）；缺省 / `null` 时为 null。 */
  sourceVersion: MbdV2SourceVersion | null;
  /** 该包求解器自报的直段表（`meta.isolines`）；缺省 / `null` 时为空数组。 */
  isolines: readonly MbdV2Isoline[];
  /**
   * 该包求解器声明的产出类别（`meta.coverage`）；缺省 / `null` = 没声明（老后端），
   * 面板据此退回按 `layoutMode` 的兜底判断。
   */
  coverage?: readonly string[] | null;
  /**
   * 该包通道级装载失败原因（API 传输、契约错误或单包原子拒绝）；成功时为 null。
   * 逐包拒绝（2026-11-02）下一包失败只记在这里，不掀翻其它包。
   */
  loadError: string | null;
}>;

export type MbdDiagnosticsSnapshot = Readonly<{
  loadedAt: number | null;
  channel: MbdDiagnosticsChannel | null;
  /**
   * 全部来源的 refno 逗号拼接（`mbd_refno=A,B` → `A,B`）；单源时就是那个
   * refno，与旧语义一致。无来源时为 null。
   */
  sourceId: string | null;
  /** 聚合视图：各源 `issues` 按 `mbd_refno` 顺序拼接。 */
  issues: readonly MbdV2Issue[];
  /** 聚合视图：各源 `skipped` 按 `mbd_refno` 顺序拼接。 */
  skipped: readonly Readonly<{ id: string; reason: string }>[];
  /** 聚合视图：第一个非空源的排版模式；全缺省时为 null。 */
  layoutMode: string | null;
  /** 聚合视图：各源 `notes` 顺序拼接；多源时每条加 `refno：` 前缀便于归因。 */
  notes: readonly string[];
  /**
   * 聚合视图：第一个非空源的数据时点；全缺省时为 null。多源各报各的时点，
   * 需要逐包对账时读 `sources[].sourceVersion`。
   */
  sourceVersion: MbdV2SourceVersion | null;
  /**
   * 聚合视图：各源 `isolines` 顺序拼接。注意各来源的 `index` 编号空间各自
   * 独立，跨源同号直段在聚合表里并存——按源区分请读 `sources[].isolines`。
   */
  isolines: readonly MbdV2Isoline[];
  /** 聚合视图：任一源失败时的汇总句（单源即原句）；全部成功时为 null。 */
  loadError: string | null;
  /** 按包拆开的逐源视图（多 BRAN 同屏）；单源时一项，无来源或旧调用方未给时为空数组。 */
  sources: readonly MbdDiagnosticsSourceSnapshot[];
}>;

type MbdDiagnosticsUpdate =
  Omit<
    MbdDiagnosticsSnapshot,
    'loadedAt' | 'loadError' | 'layoutMode' | 'notes' | 'sourceVersion' | 'isolines' | 'sources'
  >
  & Readonly<{
    layoutMode?: string | null;
    notes?: readonly string[];
    sourceVersion?: MbdV2SourceVersion | null;
    isolines?: readonly MbdV2Isoline[] | null;
    loadError?: string | null;
    sources?: readonly MbdDiagnosticsSourceSnapshot[];
  }>;

export type MbdDiagnosticsStore = Readonly<{
  snapshot: ShallowRef<MbdDiagnosticsSnapshot>;
  set(next: MbdDiagnosticsUpdate): void;
  clear(): void;
}>;

const EMPTY_SNAPSHOT: MbdDiagnosticsSnapshot = {
  loadedAt: null,
  channel: null,
  sourceId: null,
  issues: [],
  skipped: [],
  layoutMode: null,
  notes: [],
  sourceVersion: null,
  isolines: [],
  loadError: null,
  sources: [],
};

const snapshot = shallowRef<MbdDiagnosticsSnapshot>(EMPTY_SNAPSHOT);

/** 最近一次 MBD 装载的诊断单例，ViewerPanel 写入、尺寸面板读取。 */
export function useMbdDiagnosticsStore(): MbdDiagnosticsStore {
  return {
    snapshot,
    set(next) {
      snapshot.value = {
        ...next,
        layoutMode: next.layoutMode ?? null,
        notes: next.notes ?? [],
        sourceVersion: next.sourceVersion ?? null,
        isolines: next.isolines ?? [],
        loadError: next.loadError ?? null,
        sources: next.sources ?? [],
        loadedAt: Date.now(),
      };
    },
    clear() {
      snapshot.value = EMPTY_SNAPSHOT;
    },
  };
}
