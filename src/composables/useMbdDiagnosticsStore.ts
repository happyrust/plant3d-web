import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

import type { MbdV2Isoline, MbdV2Issue, MbdV2SourceVersion } from '@/dimension';

export type MbdDiagnosticsChannel = 'api';

export type MbdDiagnosticsSnapshot = Readonly<{
  loadedAt: number | null;
  channel: MbdDiagnosticsChannel | null;
  /** refno（API 通道）。 */
  sourceId: string | null;
  /** 后端排版 issues，对标 PML wronglines。 */
  issues: readonly MbdV2Issue[];
  /** 通道与映射层跳过的图元诊断。 */
  skipped: readonly Readonly<{ id: string; reason: string }>[];
  /** 求解器自报的排版模式（`meta.layout_mode`）；缺省时为 null。 */
  layoutMode: string | null;
  /** 求解器自报的排版备注（`meta.notes`）。 */
  notes: readonly string[];
  /**
   * 求解器自报的数据时点（`meta.source_version`，T4.5，与 `/spatial/centerline` 的
   * `source_version` 同形）；缺省 / `null` 时为 null。
   */
  sourceVersion: MbdV2SourceVersion | null;
  /** 求解器自报的直段表（`meta.isolines`，T4.6）；缺省 / `null` 时为空数组。 */
  isolines: readonly MbdV2Isoline[];
  /** 通道级装载失败原因（API 传输或契约错误）；成功时为 null。 */
  loadError: string | null;
}>;

type MbdDiagnosticsUpdate =
  Omit<
    MbdDiagnosticsSnapshot,
    'loadedAt' | 'loadError' | 'layoutMode' | 'notes' | 'sourceVersion' | 'isolines'
  >
  & Readonly<{
    layoutMode?: string | null;
    notes?: readonly string[];
    sourceVersion?: MbdV2SourceVersion | null;
    isolines?: readonly MbdV2Isoline[] | null;
    loadError?: string | null;
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
        loadedAt: Date.now(),
      };
    },
    clear() {
      snapshot.value = EMPTY_SNAPSHOT;
    },
  };
}
