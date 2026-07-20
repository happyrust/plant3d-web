import { shallowRef } from 'vue';
import type { ShallowRef } from 'vue';

import type { MbdV2Issue } from '@/dimension';

export type MbdDiagnosticsChannel = 'api' | 'parquet';

export type MbdDiagnosticsSnapshot = Readonly<{
  loadedAt: number | null;
  channel: MbdDiagnosticsChannel | null;
  /** refno（API 通道）或 dbno（parquet 通道）。 */
  sourceId: string | null;
  /** 后端排版 issues，对标 PML wronglines。 */
  issues: readonly MbdV2Issue[];
  /** 通道与映射层跳过的图元诊断。 */
  skipped: readonly Readonly<{ id: string; reason: string }>[];
  /** 通道级装载失败原因（API/parquet 传输或契约错误）；成功时为 null。 */
  loadError: string | null;
}>;

type MbdDiagnosticsUpdate =
  Omit<MbdDiagnosticsSnapshot, 'loadedAt' | 'loadError'>
  & Readonly<{ loadError?: string | null }>;

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
        loadError: next.loadError ?? null,
        loadedAt: Date.now(),
      };
    },
    clear() {
      snapshot.value = EMPTY_SNAPSHOT;
    },
  };
}
